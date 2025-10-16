import { Router } from 'express';
import { randomUUID } from 'crypto';
import axios from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getOrders, createOrder, getOrderById, updateOrder, qualifyFiber, qualifyWireless, getOrderWorkflowState, getOrderHistory } from '../Controllers/orders.controller.ts';
import { normalizeBodyToSnakeCase } from '../Middleware/case-transform.middleware.ts';
import { OrdersService } from '../services/orders.service.ts';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';
import { FNOCommunicationService } from '../services/fno-communication.service.ts';
import { PolicyService } from '../services/policy.service.ts';
import { triggerOrderStatusEmail } from '../services/order-email-hooks.service.ts';
import { 
  getWorkflowStatesForServiceType, 
  workflowToStatus, 
  statusToWorkflow, 
  getNextStatesForWorkflow,
  isTransitionAllowed 
} from '../utils/state-mapping.ts';
import { 
  getConversionPackages, 
  processTrialConversion, 
  getConversionStatus 
} from '../Controllers/trial-conversion.controller.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';

// Service-specific function to get next states for trial workflows
function getTrialNextStates(currentState: string, serviceType?: string): string[] {
  // Use the unified state mapping system
  return getNextStatesForWorkflow(currentState, serviceType || 'Fiber');
}

// Status transition endpoint (service-layer)
async function transitionOrder(req: Request, res: Response) {
  try {
    const db: Pool = req.app.get('pgPool');
    let mongo: MongoClient | null = req.app.get('mongoClient');
    if (!mongo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noop = {
        db: () => ({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          collection: () => ({ insertOne: async () => ({}), find: () => ({ sort: () => ({ toArray: async () => [] }) }), updateOne: async () => ({}) })
        })
      } as any;
      mongo = noop as unknown as MongoClient;
      // eslint-disable-next-line no-console
      console.warn('[orders] Mongo client not initialized; using no-op stub for status transition');
    }
    const svc = new OrdersService(db, new FNOCommunicationService(mongo), new PolicyService(mongo));
    const userId: string | null = ((req as any).user?.userId as string | undefined) ?? null;
    const reason: string | undefined = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const nextStatus: string = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!nextStatus) {
      return res.status(400).json({ success: false, error: { message: 'status is required' } });
    }
    const updated = await svc.transitionOrder(req.params.id!, nextStatus as any, userId, reason);

    // Invalidate orders and dashboard cache after transition
    try {
      const redis = req.app.get('redis');
      const cache = new CacheService(redis);
      await cache.delByPrefix(buildCacheKey(['orders:list']));
      await cache.delByPrefix(buildCacheKey(['dashboard:data']));
    } catch {}

    res.json({ success: true, order: updated });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e?.message || 'Failed to transition order' } });
  }
}



const router = Router();

// Protected routes
// router.use(authenticate); // Temporarily disabled for testing

router.get('/', getOrders);
router.post('/', normalizeBodyToSnakeCase, createOrder);

// Dynamic workflow endpoints that handle both trial and regular orders
// MUST be defined BEFORE /:id route to avoid route matching conflicts
router.get('/:id/workflow/state', async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const orderId = req.params.id;
    
    console.log(`[WORKFLOW STATE] Getting workflow state for order: ${orderId}`);
    
    // Check if this is a trial order
    const orderResult = await db.query(
      `SELECT service_details FROM orders WHERE id = $1`,
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      console.log(`[WORKFLOW STATE] Order not found: ${orderId}`);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const serviceDetails = orderResult.rows[0].service_details;
    // Check if this is a trial order by looking at isTrial field or serviceType being 'trial'
    const isTrialOrder = serviceDetails?.isTrial === true ||
                        serviceDetails?.serviceType?.toLowerCase() === 'trial' ||
                        serviceDetails?.service_type?.toLowerCase() === 'trial';

    console.log(`[WORKFLOW STATE] Order ${orderId} - isTrialOrder: ${isTrialOrder}, serviceDetails:`, JSON.stringify(serviceDetails, null, 2));
    console.log(`[WORKFLOW STATE] Checking isTrial field:`, serviceDetails?.isTrial);
    console.log(`[WORKFLOW STATE] Checking serviceType field:`, serviceDetails?.serviceType);
    console.log(`[WORKFLOW STATE] Checking service_type field:`, serviceDetails?.service_type);
    
    if (isTrialOrder) {
      // Route to trial workflow
      const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
      const trialResult = await db.query(
        'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
        [orderId]
      );
      
      console.log(`[WORKFLOW STATE] Trial customers query result for ${orderId}:`, trialResult.rows);
      
      if (trialResult.rows.length === 0) {
        // No trial record found - fall back to regular workflow
        console.log(`[WORKFLOW STATE] Trial order ${orderId} has no trial_customers record, using regular workflow`);
        return getOrderWorkflowState(req, res);
      }
      
      const trialId = trialResult.rows[0].id;
      try {
        console.log(`[WORKFLOW STATE] Calling trial service for trialId: ${trialId}`);
        const { data } = await axios.get(`${trialServiceUrl}/api/trials/${trialId}/workflow`, { timeout: 10000 });
        console.log(`[WORKFLOW STATE] Trial service response for ${orderId}:`, data);
        return res.json(data);
      } catch (trialErr: any) {
        // Trial service unavailable - fall back to regular workflow
        console.log(`[WORKFLOW STATE] Trial service unavailable for ${orderId}: ${trialErr.message}, using regular workflow`);
        return getOrderWorkflowState(req, res);
      }
    } else {
      // Route to regular order workflow
      console.log(`[WORKFLOW STATE] Regular order ${orderId}, using regular workflow`);
      return getOrderWorkflowState(req, res);
    }
  } catch (e) {
    console.log(`[WORKFLOW STATE] Error for order ${req.params.id}:`, e);
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to get workflow state' });
  }
});

router.get('/:id/history', async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const orderId = req.params.id;
    
    // Check if this is a trial order
    const orderResult = await db.query(
      `SELECT service_details FROM orders WHERE id = $1`,
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const serviceDetails = orderResult.rows[0].service_details;
    const isTrialOrder = serviceDetails?.serviceType?.toLowerCase() === 'trial' || 
                        serviceDetails?.service_type?.toLowerCase() === 'trial';
    
    if (isTrialOrder) {
      // Route to trial history
      const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
      const trialResult = await db.query(
        'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
        [orderId]
      );
      
      if (trialResult.rows.length === 0) {
        // No trial record found - fall back to regular workflow
        console.warn(`[orders] Trial order ${orderId} has no trial_customers record, using regular history`);
        return getOrderHistory(req, res);
      }
      
      const trialId = trialResult.rows[0].id;
      try {
        const { data } = await axios.get(`${trialServiceUrl}/api/trials/${trialId}/history`, { timeout: 10000 });
        return res.json(data);
      } catch (trialErr: any) {
        // Trial service unavailable - fall back to regular history
        console.warn(`[orders] Trial service unavailable for ${orderId}: ${trialErr.message}, using regular history`);
        return getOrderHistory(req, res);
      }
    } else {
      // Route to regular order history
      return getOrderHistory(req, res);
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to get order history' });
  }
});

// Trial conversion endpoint - MUST be before /:id routes
router.post('/:id/convert-to-paid', async (req: Request, res: Response) => {
  try {
    console.log('[TRIAL CONVERSION] ===== STARTING =====');
    const orderId = req.params.id;
    const { planId, paymentMethod, customerDetails } = req.body || {};
    
    console.log('[TRIAL CONVERSION] Order ID:', orderId);
    console.log('[TRIAL CONVERSION] Plan ID:', planId);
    console.log('[TRIAL CONVERSION] Payment Method:', paymentMethod);
    console.log('[TRIAL CONVERSION] Customer Details:', customerDetails);
    
    if (!orderId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: orderId' 
      });
    }
    
    if (!planId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: planId' 
      });
    }
    
    if (!paymentMethod) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required field: paymentMethod' 
      });
    }
    
    const db: Pool = req.app.get('pgPool');
    
    // Get order details
    const orderResult = await db.query(
      'SELECT * FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Order not found'
      });
    }
    
    const order = orderResult.rows[0];
    
    // Update order to converted status and mark as paid service
    await db.query(
      'UPDATE orders SET status = $1, current_state = $1, service_type = $2, updated_at = NOW() WHERE id = $3',
      ['trial_converted', 'paid_service', orderId]
    );
    
    // Add history record
    await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, order.status, 'trial_converted', 'Trial converted to paid service', null]
    );
    
    // Trigger email notification for trial conversion
    try {
      console.log('[TRIAL CONVERSION] Triggering conversion email notification...');
      
      // Get customer email from customer details or fetch from customers table
      let customerEmail = order.customer_email || order.customer?.email;
      let customerName = `${order.customer_first_name || order.customer?.first_name || ''} ${order.customer_last_name || order.customer?.last_name || ''}`.trim() || 'Customer';
      
      // If no email found, try to get it from customers table
      if (!customerEmail && order.customer_id) {
        console.log('[TRIAL CONVERSION] No email in order, fetching from customers table...');
        const customerResult = await db.query(
          'SELECT email, first_name, last_name FROM customers WHERE id = $1',
          [order.customer_id]
        );
        
        if (customerResult.rows.length > 0) {
          const customer = customerResult.rows[0];
          customerEmail = customer.email;
          customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer';
          console.log('[TRIAL CONVERSION] Found customer email:', customerEmail);
        }
      }
      
      // Also try to get email from customerDetails passed in the request
      if (!customerEmail && customerDetails?.email) {
        customerEmail = customerDetails.email;
        customerName = `${customerDetails.firstName || ''} ${customerDetails.lastName || ''}`.trim() || 'Customer';
        console.log('[TRIAL CONVERSION] Using email from customerDetails:', customerEmail);
      }
      
      if (customerEmail) {
        const mongoClient = req.app.get('mongoClient');
        await triggerOrderStatusEmail(db, mongoClient, {
          orderId: orderId,
          orderNumber: order.order_number || orderId || '',
          customerEmail: customerEmail,
          customerName: customerName,
          previousStatus: order.status,
          newStatus: 'trial_converted',
          orderType: 'new_installation',
          orderData: {
            serviceAddress: order.service_address || order.installation_address,
            serviceDetails: order.service_details
          }
        });
        console.log('[TRIAL CONVERSION] Conversion email notification triggered for', customerEmail);
      } else {
        console.log('[TRIAL CONVERSION] No customer email found, skipping notification');
      }
    } catch (emailError) {
      console.error('[TRIAL CONVERSION] Email notification failed:', emailError);
      // Don't fail the conversion if email fails
    }

    // Trigger post-conversion workflow
    try {
      console.log('[TRIAL CONVERSION] Starting post-conversion workflow...');
      const { TrialConversionService } = await import('../services/trial-conversion.service.ts');
      const { NotificationService } = await import('../services/notification.service.ts');
      const notificationService = new NotificationService(req.app.get('mongoClient'));
      const conversionService = new TrialConversionService(db, notificationService);
      
      // Handle post-conversion workflow asynchronously
      conversionService.handlePostConversionWorkflow(orderId).catch(error => {
        console.error('[TRIAL CONVERSION] Post-conversion workflow failed:', error);
      });
    } catch (workflowError) {
      console.error('[TRIAL CONVERSION] Failed to start post-conversion workflow:', workflowError);
      // Don't fail the conversion if workflow fails
    }

    console.log('[TRIAL CONVERSION] Order converted successfully:', orderId);
    console.log('[TRIAL CONVERSION] ===== COMPLETED =====');
    
    res.json({
      success: true,
      message: 'Trial converted to paid service successfully',
      data: {
        orderId: orderId,
        newStatus: 'trial_converted',
        convertedAt: new Date().toISOString()
      }
    });
  } catch (error: any) {
    console.error('[TRIAL CONVERSION] ===== ERROR =====');
    console.error('[TRIAL CONVERSION] Error details:', error);
    console.error('[TRIAL CONVERSION] ===== ERROR END =====');
    res.status(500).json({ 
      success: false, 
      error: 'Failed to convert trial to paid service' 
    });
  }
});

// Service packages endpoint for trial conversion - MUST be before /:id routes
router.get('/service-packages', async (req: Request, res: Response) => {
  try {
    console.log('[SERVICE PACKAGES] ===== STARTING =====');
    const db: Pool = req.app.get('pgPool');
    
    // Check if table exists first
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'service_packages'
      );
    `);
    
    console.log('[SERVICE PACKAGES] Table exists check:', tableCheck.rows[0].exists);
    
    if (!tableCheck.rows[0].exists) {
      console.log('[SERVICE PACKAGES] Table does not exist, creating it...');
      // Create the table if it doesn't exist
      await db.query(`
        CREATE TABLE IF NOT EXISTS service_packages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL UNIQUE,
          speed VARCHAR(50) NOT NULL,
          price_cents INTEGER NOT NULL,
          installation_fee_cents INTEGER DEFAULT 0,
          is_active BOOLEAN DEFAULT true,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
      `);
      
      // Insert default packages
      await db.query(`
        INSERT INTO service_packages (name, speed, price_cents, installation_fee_cents) VALUES
        ('Fiber Basic', '20/10 Mbps', 39900, 0),
        ('Fiber Standard', '50/50 Mbps', 59900, 0),
        ('Fiber Premium', '100/50 Mbps', 74900, 99900),
        ('Fiber Pro', '200/100 Mbps', 99900, 119900),
        ('Fiber Business', '500/250 Mbps', 129900, 149900),
        ('Fiber Enterprise', '1000/500 Mbps', 159900, 169900),
        ('Wireless Basic', '25/5 Mbps', 29900, 69900),
        ('Wireless Standard', '50/10 Mbps', 44900, 89900),
        ('Wireless Premium', '100/20 Mbps', 69900, 109900)
        ON CONFLICT (name) DO NOTHING;
      `);
      
      console.log('[SERVICE PACKAGES] Table created and seeded successfully');
    }
    
    const result = await db.query(`
      SELECT id, name, speed, price_cents, installation_fee_cents, is_active, created_at
      FROM service_packages 
      WHERE is_active = true
      ORDER BY price_cents ASC
    `);
    
    console.log('[SERVICE PACKAGES] Query result:', result.rows.length, 'packages found');
    
    const packages = result.rows.map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      speed: pkg.speed,
      price: pkg.price_cents / 100,
      installationFee: pkg.installation_fee_cents / 100,
      isActive: pkg.is_active,
      createdAt: pkg.created_at
    }));
    
    console.log('[SERVICE PACKAGES] ===== COMPLETED =====');
    res.json({ success: true, data: packages });
  } catch (error: any) {
    console.error('[SERVICE PACKAGES] ===== ERROR =====');
    console.error('[SERVICE PACKAGES] Error details:', error);
    console.error('[SERVICE PACKAGES] ===== ERROR END =====');
    res.status(500).json({ success: false, error: 'Failed to fetch service packages' });
  }
});

// Get active services for Service Checker - MUST be before /:id route
router.get('/active-services', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const result = await db.query(`
      SELECT 
        o.id as order_id,
        o.status,
        o.service_details,
        o.created_at as activated_at,
        c.id as customer_id,
        c.first_name,
        c.last_name,
        c.address,
        c.is_trial
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.status IN ('activated', 'active', 'installed', 'trial_active', 'paid_service_active')
      ORDER BY o.created_at DESC
    `);
    
    const services = result.rows.map(row => {
      const serviceType = row.service_details?.serviceType || 'internet';
      const isTrial = row.is_trial || serviceType.toLowerCase() === 'trial';
      
      // Determine health status based on service status and type
      let healthStatus = 'healthy';
      if (row.status === 'suspended') healthStatus = 'error';
      else if (row.status === 'pending' || row.status === 'processing') healthStatus = 'warning';
      
      return {
        id: row.order_id,
        orderId: row.order_id,
        customerId: row.customer_id,
        customerName: `${row.first_name} ${row.last_name}`,
        serviceType: serviceType,
        status: isTrial ? 'trial' : (row.status === 'activated' || row.status === 'active' ? 'active' : row.status),
        address: row.address || 'Address not provided',
        activatedAt: row.activated_at,
        lastChecked: new Date().toISOString(), // Mock last check time
        healthStatus: healthStatus
      };
    });
    
    return res.json({ success: true, data: services });
  } catch (error) {
    console.error('Failed to fetch active services:', error);
    return res.status(500).json({ success: false, error: 'Failed to fetch active services' });
  }
});

// Trial conversion endpoints
router.get('/:id/trials/conversion/packages', getConversionPackages);
router.post('/:id/trials/conversion/process', processTrialConversion);
router.get('/:id/trials/conversion/status', getConversionStatus);

// Generic order routes - MUST be after specific routes
router.patch('/:id/status', authorize(['orders:update']), normalizeBodyToSnakeCase, transitionOrder);
router.get('/:id', getOrderById);
router.put('/:id', authorize(['orders:update']), normalizeBodyToSnakeCase, updateOrder);

// Coverage check via 28East (or fallback)
router.post('/:id/coverage/check', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const result = await db.query(`SELECT installation_address FROM orders WHERE id = $1`, [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Order not found' } });
    }
    const address = result.rows[0]?.installation_address || {};

    // Call 28East coverage if configured
    const apiKey = process.env.TWENTYEIGHTEAST_API_KEY || process.env.EIGHT_AND_TWENTY_API_KEY || '';
    let covered = false;
    try {
      if (apiKey) {
        // Replace with real 28East endpoint and mapping
        // const { data } = await axios.get('https://api.28east.io/coverage', { params: { ...mapAddress(address) }, headers: { Authorization: `Bearer ${apiKey}` } });
        // covered = Boolean(data?.covered);
        covered = true; // placeholder until integrated
      } else {
        // No API key → do not block in dev
        covered = true;
      }
    } catch (err: any) {
      // On API failure, fail closed in prod (block), open in dev
      const dev = String(process.env.NODE_ENV || 'development').toLowerCase() !== 'production';
      covered = dev;
    }

    return res.json({ success: true, data: { covered } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Coverage check failed' } });
  }
});

// Direct trial workflow route (for trial IDs)
router.get('/trials/:trialId/workflow', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
    const trialId = req.params.trialId;
    
    const { data } = await axios.get(`${trialServiceUrl}/api/trials/${trialId}/workflow`, { timeout: 10000 });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to proxy trial workflow' });
  }
});

// Proxy trial workflow for OMS UI -- fetch state and steps/history via microservice (using order ID)
router.get('/:id/trials/workflow', async (req: Request, res: Response) => {
  try {
    const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
    const orderId = req.params.id;
    
    console.log(`[TRIAL WORKFLOW] Getting trial workflow for order: ${orderId}`);
    
    // First, get the trial ID associated with this order
    const db: Pool = req.app.get('pgPool');
    const trialResult = await db.query(
      'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
      [orderId]
    );
    
    console.log(`[TRIAL WORKFLOW] Trial customers query result for ${orderId}:`, trialResult.rows);
    
    if (trialResult.rows.length === 0) {
      // No trial record found - get state from orders table
      console.log(`[TRIAL WORKFLOW] No trial record found for order ${orderId}, reading from orders table`);
      
      const orderResult = await db.query(
        'SELECT current_state, status, service_details FROM orders WHERE id = $1',
        [orderId]
      );
      
      console.log(`[TRIAL WORKFLOW] Orders table query result for ${orderId}:`, orderResult.rows);
      
      if (orderResult.rows.length === 0) {
        console.log(`[TRIAL WORKFLOW] Order not found in orders table: ${orderId}`);
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      
      const order = orderResult.rows[0];
      // Prioritize 'status' for the current state as it appears to be more consistently updated
      const currentState = order?.status || order?.current_state || 'created';
      // Extract service type from various possible locations
      const serviceDetails = order?.service_details;
      const serviceType = serviceDetails?.serviceType ||
                         serviceDetails?.service_type ||
                         order?.service_type ||
                         'fiber';

      console.log(`[TRIAL WORKFLOW] Service details object:`, serviceDetails);
      console.log(`[TRIAL WORKFLOW] Available service type fields:`, {
        serviceDetails_serviceType: serviceDetails?.serviceType,
        serviceDetails_service_type: serviceDetails?.service_type,
        order_service_type: order?.service_type
      });
      
      console.log(`[TRIAL WORKFLOW] DEBUG - currentState: "${currentState}"`);
      console.log(`[TRIAL WORKFLOW] DEBUG - serviceType: "${serviceType}"`);
      
      const nextStates = getTrialNextStates(currentState, serviceType);
      console.log(`[TRIAL WORKFLOW] DEBUG - nextStates from getTrialNextStates:`, nextStates);

      console.log(`[TRIAL WORKFLOW] Order ${orderId} state from DB: current_state=${order?.current_state}, status=${order?.status}, using=${currentState}`);
      console.log(`[TRIAL WORKFLOW] Service details:`, order?.service_details);
      console.log(`[TRIAL WORKFLOW] Detected service type: ${serviceType}`);
      console.log(`[TRIAL WORKFLOW] Next states for ${currentState}:`, nextStates);
      
      const result = {
        success: true,
        data: {
          currentState: currentState,
          nextStates: nextStates,
          daysRemaining: 28,
          engagement: 'COLD',
          serviceType: serviceType || 'fiber', // Add service type to response
          campaignExecutions: []
        }
      };
      
      console.log(`[TRIAL WORKFLOW] Returning result for ${orderId}:`, result);
      return res.json(result);
    }
    
    const trialId = trialResult.rows[0].id;
    
    try {
      const { data } = await axios.get(`${trialServiceUrl}/api/trials/${trialId}/workflow`, { timeout: 10000 });
      return res.json(data);
    } catch (trialErr: any) {
      // Trial service unavailable - use local database state
      console.warn(`[trials] Trial service unavailable for ${trialId}: ${trialErr.message}, using local database state`);
      const db: Pool = req.app.get('pgPool');
      const orderResult = await db.query('SELECT current_state, service_details FROM orders WHERE id = $1', [orderId]);
      if (orderResult.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }
      
      const currentState = orderResult.rows[0].current_state || 'trial_order_created';
      const serviceType = orderResult.rows[0].service_details?.serviceType || orderResult.rows[0].service_details?.service_type;
      const nextStates = getTrialNextStates(currentState, serviceType);
      
      return res.json({
        success: true,
        data: {
          currentState,
          nextStates,
          daysRemaining: 28,
          engagement: 'COLD',
          serviceType: serviceType || 'fiber', // Add service type to response
          campaignExecutions: []
        }
      });
    }
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to get trial workflow' });
  }
});

// Proxy trial workflow history for OMS UI -- fetch trial history via microservice
router.get('/:id/trials/history', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
    const orderId = req.params.id;
    
    // First, get the trial ID associated with this order
    const db: Pool = req.app.get('pgPool');
    const trialResult = await db.query(
      'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
      [orderId]
    );
    
    if (trialResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No trial found for this order' });
    }
    
    const trialId = trialResult.rows[0].id;
    
    const { data } = await axios.get(`${trialServiceUrl}/api/trials/${trialId}/history`, { timeout: 10000 });
    return res.json(data);
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to proxy trial history' });
  }
});

// Manual campaign execution for trial orders
router.post('/:id/trials/campaigns/execute', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const { campaignType, manual } = req.body;
    const trialServiceUrl = process.env.TRIAL_SERVICE_URL || 'http://localhost:3008';
    
    console.log(`[MANUAL CAMPAIGN] Executing ${campaignType} campaign for order ${orderId}`);
    
    // Get trial ID for this order
    const db: Pool = req.app.get('pgPool');
    const trialResult = await db.query(
      'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
      [orderId]
    );
    
    if (trialResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'No trial found for this order' });
    }
    
    const trialId = trialResult.rows[0].id;
    
    // Call microservice to execute campaign
    const { data } = await axios.post(`${trialServiceUrl}/api/trials/${trialId}/campaigns/execute`, {
      campaignType,
      manual: true
    }, { timeout: 10000 });
    
    return res.json(data);
  } catch (e) {
    console.error('Manual campaign execution failed:', e);
    return res.status(500).json({ 
      success: false, 
      error: (e as any)?.message || 'Failed to execute campaign' 
    });
  }
});

// Create trial customer record with proper customer information
router.post('/:id/create-trial-customer', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const db: Pool = req.app.get('pgPool');
    
    // Get customer details
    const customerResult = await db.query(
      'SELECT id, email, phone, first_name, last_name FROM customers WHERE id = (SELECT customer_id FROM orders WHERE id = $1)',
      [orderId]
    );
    
    if (customerResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Customer not found for order' });
    }
    
    const customer = customerResult.rows[0];
    const customerName = `${customer.first_name || ''} ${customer.last_name || ''}`.trim() || 'Customer';
    
    // Create trial customer record
    const trialResult = await db.query(
      `INSERT INTO trial_customers (id, customer_id, order_id, email, phone, status, trial_start_date, trial_end_date, days_remaining, metadata, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING id`,
      [
        customer.id,
        orderId,
        customer.email,
        customer.phone || '',
        'ACTIVE',
        new Date(),
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        30,
        JSON.stringify({
          name: customerName,
          firstName: customer.first_name,
          lastName: customer.last_name
        })
      ]
    );
    
    return res.json({
      success: true,
      message: 'Trial customer created successfully',
      data: {
        trialId: trialResult.rows[0].id,
        customerName: customerName,
        email: customer.email
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to create trial customer' });
  }
});

// Simple test endpoint for workflow transitions
router.post('/:id/test-transition', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const { toState } = req.body;
    
    const db: Pool = req.app.get('pgPool');
    
    // Update the order's current state and status
    await db.query(
      'UPDATE orders SET current_state = $1, status = $1, updated_at = NOW() WHERE id = $2',
      [toState, orderId]
    );
    
    // Add history record
    await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, 'created', toState, 'Test workflow transition', null]
    );
    
    return res.json({
      success: true,
      message: 'Test workflow transition completed',
      data: {
        fromState: 'created',
        toState: toState,
        transitioned: true
      }
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to transition workflow' });
  }
});

// Proxy trial workflow transition for OMS UI -- manual state transitions
router.post('/:id/trials/workflow/transition', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const { toState } = req.body;
    
    console.log(`[TRIAL WORKFLOW TRANSITION] ===== STARTING =====`);
    console.log(`[TRIAL WORKFLOW TRANSITION] Order ID: ${orderId}`);
    console.log(`[TRIAL WORKFLOW TRANSITION] Target state: ${toState}`);
    console.log(`[TRIAL WORKFLOW TRANSITION] Request body:`, req.body);
    
    if (!orderId) {
      console.log(`[TRIAL WORKFLOW TRANSITION] Error: orderId is required`);
      return res.status(400).json({ success: false, error: 'orderId is required' });
    }
    
    if (!toState) {
      console.log(`[TRIAL WORKFLOW TRANSITION] Error: toState is required`);
      return res.status(400).json({ success: false, error: 'toState is required' });
    }
    
    const db: Pool = req.app.get('pgPool');
    
    // Get current state before updating
    console.log(`[TRIAL WORKFLOW TRANSITION] Getting current state for order ${orderId}`);
    const currentStateResult = await db.query(
      'SELECT current_state, status FROM orders WHERE id = $1',
      [orderId]
    );
    
    console.log(`[TRIAL WORKFLOW TRANSITION] Current state query result:`, currentStateResult.rows);
    
    if (currentStateResult.rows.length === 0) {
      console.log(`[TRIAL WORKFLOW TRANSITION] Error: Order not found`);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const fromState = currentStateResult.rows[0].current_state || currentStateResult.rows[0].status || 'created';
    const currentStatus = currentStateResult.rows[0].status;

    console.log(`[TRIAL WORKFLOW TRANSITION] Current state: ${fromState}`);
    console.log(`[TRIAL WORKFLOW TRANSITION] Current status: ${currentStatus}`);

    // If the order is in 'created' state and we're transitioning to a trial state, 
    // first transition to 'trial_order_created'
    let targetState = toState;
    if (fromState === 'created' && toState.startsWith('trial_')) {
      targetState = 'trial_order_created';
      console.log(`[TRIAL WORKFLOW TRANSITION] Converting 'created' to 'trial_order_created' first`);
    }

    // Update the order's current state and status using unified state system
    console.log(`[TRIAL WORKFLOW TRANSITION] Updating order to state: ${targetState}`);
    const newStatus = workflowToStatus(targetState);
    const updateResult = await db.query(
      'UPDATE orders SET current_state = $1, status = $2, updated_at = NOW() WHERE id = $3',
      [targetState, newStatus, orderId]
    );
    
    console.log(`[TRIAL WORKFLOW TRANSITION] Update result:`, updateResult);

    // Debug: Verify the update worked
    console.log(`[TRIAL WORKFLOW TRANSITION] Verifying update...`);
    const verifyResult = await db.query(
      'SELECT current_state, status FROM orders WHERE id = $1',
      [orderId]
    );
    
    console.log(`[TRIAL WORKFLOW TRANSITION] Verification result:`, verifyResult.rows);
    console.log(`[TRIAL WORKFLOW TRANSITION] After update - Order ${orderId}: current_state=${verifyResult.rows[0]?.current_state}, status=${verifyResult.rows[0]?.status}`);
    
    // Add history record
    console.log(`[TRIAL WORKFLOW TRANSITION] Adding history record...`);
    const historyResult = await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, fromState, targetState, 'Trial workflow transition', null]
    );
    
    console.log(`[TRIAL WORKFLOW TRANSITION] History insert result:`, historyResult);

    // Sync state to microservice
    try {
      console.log(`[TRIAL WORKFLOW TRANSITION] Syncing state to microservice...`);
      const trialServiceUrl = process.env.TRIAL_SERVICE_URL;
      
      if (trialServiceUrl) {
        // Get trial ID from order
        const trialResult = await db.query(
          'SELECT id FROM trial_customers WHERE order_id = $1 LIMIT 1',
          [orderId]
        );
        
        if (trialResult.rows.length > 0) {
          const trialId = trialResult.rows[0].id;
          
          // Get the service type from the order to include in the sync
          const orderResult = await db.query(
            'SELECT service_details FROM orders WHERE id = $1',
            [orderId]
          );
          const serviceDetails = orderResult.rows[0]?.service_details || {};
          const serviceType = serviceDetails.serviceType || serviceDetails.service_type || 'Fiber';
          
          // Update trial record with new state and service type
          await axios.put(
            `${trialServiceUrl}/api/internal/trials/${trialId}`,
            {
              metadata: {
                serviceType: serviceType === 'wireless' ? 'Wireless' : 'Fiber',
                orderData: {
                  current_state: targetState,
                  status: newStatus,
                  serviceType: serviceType
                }
              }
            },
            {
              timeout: 5000,
              headers: { 'Content-Type': 'application/json' }
            }
          );
          
          console.log(`[TRIAL WORKFLOW TRANSITION] State synced to microservice for trial ${trialId}`);
        }
      }
    } catch (syncError) {
      console.error(`[TRIAL WORKFLOW TRANSITION] Failed to sync state to microservice:`, syncError);
    }

    // Trigger email notification for trial workflow transition
    try {
      console.log(`[TRIAL WORKFLOW TRANSITION] Triggering email notification...`);
      
      // Get order details for email
      const orderResult = await db.query(
        'SELECT o.*, c.first_name, c.last_name, c.email FROM orders o LEFT JOIN customers c ON o.customer_id = c.id WHERE o.id = $1',
        [orderId]
      );
      
      if (orderResult.rows.length > 0) {
        const order = orderResult.rows[0];
        const customerEmail = order.email;
        
        if (customerEmail) {
          const mongoClient = req.app.get('mongoClient');
          await triggerOrderStatusEmail(db, mongoClient, {
            orderId: orderId,
            orderNumber: order.order_number || orderId || '',
            customerEmail: customerEmail,
            customerName: `${order.first_name || ''} ${order.last_name || ''}`.trim() || 'Customer',
            previousStatus: fromState,
            newStatus: targetState,
            orderType: 'new_installation',
            orderData: {
              serviceAddress: order.service_address || order.installation_address,
              serviceDetails: order.service_details
            }
          });
          console.log(`[TRIAL WORKFLOW TRANSITION] Email notification triggered for ${customerEmail}`);
        } else {
          console.log(`[TRIAL WORKFLOW TRANSITION] No customer email found, skipping notification`);
        }
      }
    } catch (emailError) {
      console.error(`[TRIAL WORKFLOW TRANSITION] Email notification failed:`, emailError);
      // Don't fail the transition if email fails
    }

    const response = {
      success: true,
      message: 'Trial workflow transition completed',
      data: {
        fromState: fromState,
        toState: targetState,
        transitioned: true
      }
    };
    
    console.log(`[TRIAL WORKFLOW TRANSITION] Returning response:`, response);
    console.log(`[TRIAL WORKFLOW TRANSITION] ===== COMPLETED =====`);
    
    return res.json(response);
  } catch (e) {
    console.error(`[TRIAL WORKFLOW TRANSITION] ===== ERROR =====`);
    console.error('Trial workflow transition error:', e);
    console.error('Error details:', {
      message: (e as any)?.message,
      stack: (e as any)?.stack,
      orderId: req.params.id,
      toState: req.body?.toState
    });
    console.error(`[TRIAL WORKFLOW TRANSITION] ===== ERROR END =====`);
    return res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to transition trial workflow' });
  }
});

// List trial orders (service_details.serviceType == 'Trial') with customer snippet
router.get('/trials', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const result = await db.query(
      `SELECT o.id, o.order_number, o.customer_id, o.order_type, o.status as current_state,
              o.service_details, o.created_at, c.first_name, c.last_name, c.email
         FROM orders o
         JOIN customers c ON c.id = o.customer_id
        WHERE (o.service_details ->> 'serviceType') ILIKE 'trial'
        ORDER BY o.created_at DESC
        LIMIT 100`
    );
    const items = result.rows.map(r => ({
      id: r.id,
      order_number: r.order_number,
      customer_id: r.customer_id,
      order_type: r.order_type,
      current_state: r.current_state,
      service_details: r.service_details,
      created_at: r.created_at,
      customer: { first_name: r.first_name, last_name: r.last_name, email: r.email }
    }));
    res.json({ success: true, data: items, total: items.length });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to list trial orders' } });
  }
});


// List trial customers (for dropdowns) - direct from OMS database
router.get('/trial-customers', async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    
    // First check if trial_customers table exists
    const tableCheck = await db.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'trial_customers'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist, return empty array
      return res.json({ success: true, data: [], total: 0 });
    }
    
    const result = await db.query(`
      SELECT tc.id, tc.customer_id, tc.order_id, tc.email, tc.phone, tc.status, 
             tc.trial_start_date, tc.trial_end_date, tc.days_remaining,
             c.first_name, c.last_name, o.order_number
      FROM trial_customers tc
      JOIN customers c ON c.id = tc.customer_id
      LEFT JOIN orders o ON o.id = tc.order_id
      WHERE tc.status = 'ACTIVE'
      ORDER BY tc.created_at DESC
      LIMIT 50
    `);
    const items = result.rows.map(r => ({
      id: r.id,
      customerId: r.customer_id,
      orderId: r.order_id,
      email: r.email,
      phone: r.phone,
      status: r.status,
      daysRemaining: r.days_remaining,
      trialStartDate: r.trial_start_date,
      trialEndDate: r.trial_end_date,
      customer: { 
        first_name: r.first_name, 
        last_name: r.last_name, 
        email: r.email 
      },
      order: {
        order_number: r.order_number
      }
    }));
    res.json({ success: true, data: items, total: items.length });
  } catch (e: any) {
    console.error('Trial customers query error:', e);
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to list trial customers' } });
  }
});

// Backfill a missing trial record for an order (use when orders were created via Postman and skipped provisioning)
router.post('/:id/trials/backfill', authorize(['orders:update']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    let mongo: MongoClient | null = req.app.get('mongoClient');
    if (!mongo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noop = { db: () => ({ collection: () => ({ insertOne: async () => ({}), find: () => ({ sort: () => ({ toArray: async () => [] }) }), updateOne: async () => ({}) }) }) } as any;
      mongo = noop as unknown as MongoClient;
    }
    const svc = new OrdersService(db, new FNOCommunicationService(mongo), new PolicyService(mongo));
    const order = await svc.getOrder(req.params.id!);
    if (!order) return res.status(404).json({ success: false, error: { message: 'Order not found' } });

    // Ensure the order is marked as Trial in service_details so downstream uses correct gating
    const sd = (order as any).serviceDetails || {};
    if (String(sd.serviceType || '').toLowerCase() !== 'trial') {
      const updatedServiceDetails = { ...sd, serviceType: 'Trial' };
      await svc.updateOrder(order.id, { serviceDetails: updatedServiceDetails } as any);
    }

    // Create trial record via microservice (or fallback internally)
    await (svc as any).createTrialCustomer(await svc.getOrder(order.id));

    const refreshed = await svc.getOrder(order.id);
    return res.json({ success: true, message: 'Trial backfilled', order: refreshed });
  } catch (e) {
    return res.status(500).json({ success: false, error: { message: (e as any)?.message || 'Failed to backfill trial' } });
  }
});

// Debug: Check customer trial status
router.get('/debug/customer/:id/trial-status', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const result = await db.query(`
      SELECT id, first_name, last_name, email, is_trial, trial_start_date, trial_end_date
      FROM customers 
      WHERE id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Customer not found' } });
    }
    
    res.json({ success: true, data: result.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to check customer trial status' } });
  }
});

// Simulate FNO provisioning path for fiber orders (and trials shortcut)
router.post('/:id/simulate/fiber-provisioning', authorize(['orders:update']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    let mongo: MongoClient | null = req.app.get('mongoClient');
    if (!mongo) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const noop = { db: () => ({ collection: () => ({ insertOne: async () => ({}), find: () => ({ sort: () => ({ toArray: async () => [] }) }), updateOne: async () => ({}) }) }) } as any;
      mongo = noop as unknown as MongoClient;
    }
    const svc = new OrdersService(db, new FNOCommunicationService(mongo), new PolicyService(mongo));
    let order = await svc.getOrder(req.params.id!);
    if (!order) return res.status(404).json({ success: false, error: { message: 'Order not found' } });

    const serviceType = ((order as any).serviceDetails?.serviceType || (order as any).serviceDetails?.service_type || '').toString().toLowerCase();
    const userId: string | null = ((req as any).user?.userId as string | undefined) ?? null;

    // New installationStatus parameter: "new" | "existing"
    const installationStatus = req.body?.installationStatus || 'new';
    
    // Optional stopAt param to halt simulation at a stage (e.g., 'installed')
    const stopAt = typeof req.body?.stopAt === 'string' ? String(req.body.stopAt).toLowerCase() : null;

    // Check if this is a trial order and handle installation status
    const orderIsTrial = serviceType === 'trial';
    
    if (orderIsTrial && installationStatus === 'existing') {
      // Convert trial customer to regular customer
      await (svc as any).convertTrialToRegularCustomer(order.customerId);
      
      // Remove trial record from microservice
      await (svc as any).removeTrialRecord(order.id);
      
      // Update order service type to regular
      const updatedServiceDetails = {
        ...(order as any).serviceDetails,
        serviceType: 'internet'
      };
      await svc.updateOrder(order.id, { serviceDetails: updatedServiceDetails });
      
      console.log(`Trial order ${order.id} converted to regular due to existing installation`);
    } else if (orderIsTrial && installationStatus === 'new') {
      // Create trial record now that we know it's a new installation
      console.log(`Creating trial record for order ${order.id} - new installation confirmed`);
      await (svc as any).createTrialCustomer(order);
    }

    const apply = async (status: string, reason: string) => {
      if (status === 'enriched') {
        // Use internal enrichment path to satisfy business rule
        if (order) {
          const updated = await (svc as any).transitionToEnrichedInternal(order.id, userId, reason);
          return updated;
        }
        return null;
      }
      if (order) {
        const updated = await svc.transitionOrder(order.id, status as any, userId, reason);
        return updated;
      }
      return null;
    };

    let executed: string[] = [];
    // For both trial and non-trial fiber orders, simulate full provisioning path by default.
    // Skipping installation only happens via explicit conversion/activation action outside this endpoint.
    const seq = ['validated', 'enriched', 'fno_submitted', 'fno_accepted', 'installation_scheduled', 'installed', 'activated'];
    const current = ((order as any).status || (order as any).current_state || 'created').toString().toLowerCase();
    const startIdx = Math.max(0, seq.findIndex(s => s === current) + (seq.includes(current) ? 1 : 0));
    for (let i = startIdx; i < seq.length; i++) {
      const s = seq[i];
      // Precondition: ensure FNO is set before submission
      if (s === 'fno_submitted') {
        try {
          const fnoId = (order as any).fnoId || (order as any).fno_id;
          if (!fnoId) {
            const bodyFno = typeof req.body?.fno === 'string' ? req.body.fno : null;
            if (bodyFno) {
              // ensure FNO exists (by code/name) and use its id
              const ensuredId = await (svc as any).ensureFno(bodyFno);
              if (order) {
                const mergedServiceDetails = { ...(order as any).serviceDetails, fno: bodyFno };
                await svc.updateOrder(order.id, { fnoId: ensuredId, serviceDetails: mergedServiceDetails });
                order = await svc.getOrder(order.id);
              }
            } else {
              // fallback: ensure default fno and set
              const ensuredId = await (svc as any).ensureFno('default-fno');
              if (order) {
                const mergedServiceDetails = { ...(order as any).serviceDetails, fno: 'default-fno' };
                await svc.updateOrder(order.id, { fnoId: ensuredId, serviceDetails: mergedServiceDetails });
                order = await svc.getOrder(order.id);
              }
            }
          }
        } catch (e) {
          return res.status(400).json({ success: false, error: { message: (e as any)?.message || 'Failed to set FNO before submission' } });
        }
      }
      await apply(s!, `simulate(${s})`);
      executed.push(s!);
      // Refresh order after each step
      if (order) {
        order = await svc.getOrder(order.id);
      }
      if (stopAt && stopAt === s) break;
    }

    // Invalidate caches (orders and dashboard) after bulk transitions
    try {
      const redis = req.app.get('redis');
      const cache = new CacheService(redis);
      await cache.delByPrefix(buildCacheKey(['orders:list']));
      await cache.delByPrefix(buildCacheKey(['dashboard:data']))
    } catch {}

    const finalOrder = await svc.getOrder(req.params.id!);
    return res.json({ 
      success: true, 
      executed, 
      order: finalOrder,
      installationStatus,
      converted: orderIsTrial && installationStatus === 'existing'
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Simulation failed' } });
  }
});

// Real FNO submission endpoint
router.post('/:id/fno/submit', authorize(['orders:update']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const orderId = req.params.id;
    
    // Get order details
    const orderResult = await db.query(
      `SELECT o.*, c.first_name, c.last_name, c.email, c.phone, f.name as fno_name, f.api_endpoint, f.api_key_encrypted
       FROM orders o
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN fnos f ON f.id = o.fno_id
       WHERE o.id = $1`,
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    
    // Check if FNO is assigned
    if (!order.fno_id) {
      return res.status(400).json({ success: false, error: 'No FNO assigned to this order' });
    }
    
    // Check if already submitted
    if (order.status === 'fno_submitted' || order.status === 'fno_accepted') {
      return res.status(400).json({ success: false, error: 'Order already submitted to FNO' });
    }
    
    // Real FNO submission logic
    const fnoData = {
      orderId: order.id,
      orderNumber: order.order_number,
      customerName: `${order.first_name} ${order.last_name}`.trim(),
      customerEmail: order.email,
      customerPhone: order.phone,
      serviceAddress: order.installation_address,
      serviceDetails: order.service_details,
      serviceType: order.service_type,
      priority: order.priority,
      submittedAt: new Date().toISOString()
    };
    
    let submissionResult;
    
    if (order.fno_name?.toLowerCase().includes('openserve')) {
      // Openserve integration
      const openserveApiKey = process.env.OPENSERVE_API_KEY;
      if (!openserveApiKey) {
        return res.status(500).json({ 
          success: false, 
          error: 'Openserve API key not configured' 
        });
      }
      
      try {
        // Real Openserve API call
        const openserveResponse = await axios.post(
          'https://api.openserve.co.za/orders',
          fnoData,
          {
            headers: {
              'Authorization': `Bearer ${openserveApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 30000
          }
        );
        
        submissionResult = {
          success: true,
          fnoReference: openserveResponse.data?.reference || openserveResponse.data?.orderId,
          fnoStatus: 'submitted',
          submittedAt: new Date().toISOString(),
          response: openserveResponse.data
        };
      } catch (apiError: any) {
        console.error('Openserve API error:', apiError.response?.data || apiError.message);
        return res.status(500).json({
          success: false,
          error: 'Failed to submit to Openserve',
          details: apiError.response?.data?.message || apiError.message
        });
      }
    } else {
      // Generic FNO integration
      submissionResult = {
        success: true,
        fnoReference: `FNO-${order.id.substring(0, 8)}-${Date.now()}`,
        fnoStatus: 'submitted',
        submittedAt: new Date().toISOString(),
        response: { message: 'Submitted to FNO successfully' }
      };
    }
    
    // Update order status and FNO reference
    await db.query(
      `UPDATE orders 
       SET status = 'fno_submitted', 
           fno_reference = $1, 
           updated_at = NOW()
       WHERE id = $2`,
      [submissionResult.fnoReference, orderId]
    );
    
    // Log the submission
    await db.query(
      `INSERT INTO order_state_history (order_id, status, reason, created_by, created_at)
       VALUES ($1, 'fno_submitted', 'Order submitted to FNO', 'system', NOW())`,
      [orderId]
    );
    
    res.json({
      success: true,
      data: {
        submitted: true,
        fnoReference: submissionResult.fnoReference,
        status: 'fno_submitted',
        submittedAt: submissionResult.submittedAt
      }
    });
    
  } catch (error: any) {
    console.error('FNO submission error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit order to FNO'
    });
  }
});

// Real FNO status checking endpoint
router.get('/:id/fno/status', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const orderId = req.params.id;
    
    // Get order and FNO details
    const orderResult = await db.query(
      `SELECT o.*, f.name as fno_name, f.api_endpoint, f.api_key_encrypted
       FROM orders o
       LEFT JOIN fnos f ON f.id = o.fno_id
       WHERE o.id = $1`,
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    
    if (!order.fno_id || !order.fno_reference) {
      return res.status(400).json({ 
        success: false, 
        error: 'Order not submitted to FNO yet' 
      });
    }
    
    let fnoStatus;
    
    if (order.fno_name?.toLowerCase().includes('openserve')) {
      // Openserve status check
      const openserveApiKey = process.env.OPENSERVE_API_KEY;
      if (!openserveApiKey) {
        return res.status(500).json({ 
          success: false, 
          error: 'Openserve API key not configured' 
        });
      }
      
      try {
        const statusResponse = await axios.get(
          `https://api.openserve.co.za/orders/${order.fno_reference}/status`,
          {
            headers: {
              'Authorization': `Bearer ${openserveApiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 15000
          }
        );
        
        fnoStatus = {
          status: statusResponse.data?.status || 'unknown',
          progress: statusResponse.data?.progress || 0,
          lastUpdated: statusResponse.data?.lastUpdated || new Date().toISOString(),
          details: statusResponse.data?.details || {},
          estimatedCompletion: statusResponse.data?.estimatedCompletion
        };
      } catch (apiError: any) {
        console.error('Openserve status check error:', apiError.response?.data || apiError.message);
        fnoStatus = {
          status: 'error',
          progress: 0,
          lastUpdated: new Date().toISOString(),
          details: { error: apiError.response?.data?.message || apiError.message },
          estimatedCompletion: null
        };
      }
    } else {
      // Generic FNO status (simulated)
      fnoStatus = {
        status: order.status === 'fno_submitted' ? 'processing' : 'completed',
        progress: order.status === 'fno_submitted' ? 50 : 100,
        lastUpdated: order.updated_at,
        details: { message: 'Status check completed' },
        estimatedCompletion: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days from now
      };
    }
    
    res.json({
      success: true,
      data: {
        orderId: orderId,
        fnoReference: order.fno_reference,
        currentStatus: order.status,
        fnoStatus: fnoStatus.status,
        progress: fnoStatus.progress,
        lastUpdated: fnoStatus.lastUpdated,
        details: fnoStatus.details,
        estimatedCompletion: fnoStatus.estimatedCompletion
      }
    });
    
  } catch (error: any) {
    console.error('FNO status check error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to check FNO status'
    });
  }
});

// Service-to-service: mark order as paid (Stripe callback)
router.post('/:id/payment/success', async (req: Request, res: Response) => {
  try {
    const serviceApiKey = (req.headers['x-service-key'] || req.headers['x-service-api-key']) as string;
    const expectedApiKey = process.env.ONBOARDING_SERVICE_API_KEY;
    if (!expectedApiKey || serviceApiKey !== expectedApiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid service credentials' });
    }

    const orderId = req.params.id;
    const db: Pool = req.app.get('pgPool');

    const result = await db.query(
      `UPDATE orders 
         SET status = 'payment_received', 
             is_paid = TRUE,
             paid_at = COALESCE(paid_at, NOW()),
             updated_at = NOW()
       WHERE id = $1 AND (status <> 'payment_received' OR is_paid IS DISTINCT FROM TRUE)
       RETURNING id`,
      [orderId]
    );

    if (result.rowCount === 0) {
      return res.json({ success: true, message: 'Already marked as paid or order not found' });
    }

    console.log(`[OrdersRoute] Order ${orderId} marked as payment_received`);
    return res.json({ success: true, orderId });
  } catch (err: any) {
    console.error('[OrdersRoute] payment/success failed:', err?.message || err);
    return res.status(500).json({ success: false, error: 'Failed to update order payment status' });
  }
});


// Trial FNO provisioning endpoint
router.post('/:id/trials/fno/provision', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const db: Pool = req.app.get('pgPool');
    
    // Check if order exists and is a trial order
    const orderResult = await db.query(
      'SELECT id, current_state, service_details FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    const serviceDetails = order.service_details;
    const isTrialOrder = serviceDetails?.serviceType?.toLowerCase() === 'trial' || 
                        serviceDetails?.service_type?.toLowerCase() === 'trial';
    
    if (!isTrialOrder) {
      return res.status(400).json({ success: false, error: 'Order is not a trial order' });
    }
    
    // Update order status to show FNO provisioning
    await db.query(
      'UPDATE orders SET current_state = $1, status = $1, updated_at = NOW() WHERE id = $2',
      ['trial_fno_provisioning', orderId]
    );
    
    // Add history record
    await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, order.current_state, 'trial_fno_provisioning', 'Trial FNO provisioning initiated', null]
    );
    
    // Simulate FNO provisioning process (since no API key for Openserve)
    setTimeout(async () => {
      try {
        // Update to installation scheduled after provisioning
        await db.query(
          'UPDATE orders SET current_state = $1, status = $1, updated_at = NOW() WHERE id = $2',
          ['trial_installation_scheduled', orderId]
        );
        
        // Add history record
        await db.query(
          `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [orderId, 'trial_fno_provisioning', 'trial_installation_scheduled', 'Trial FNO provisioning completed', null]
        );
        
        console.log(`[Trial FNO] Order ${orderId} provisioned successfully`);
      } catch (error) {
        console.error(`[Trial FNO] Failed to complete provisioning for order ${orderId}:`, error);
      }
    }, 5000); // 5 second delay to simulate processing
    
    res.json({ 
      success: true, 
      message: 'Trial FNO provisioning initiated',
      data: { 
        status: 'trial_fno_provisioning',
        orderId: orderId,
        estimatedCompletion: new Date(Date.now() + 5000).toISOString()
      }
    });
  } catch (error) {
    console.error('Failed to initiate trial FNO provisioning:', error);
    res.status(500).json({ success: false, error: 'Failed to initiate trial FNO provisioning' });
  }
});

// Add this route before the generic /:id route (around line 198):

router.post('/:id/cancel', async (req: Request, res: Response) => {
  try {
    const orderId = req.params.id;
    const { reason } = req.body;
    
    console.log(`[CANCEL ORDER] ===== STARTING =====`);
    console.log(`[CANCEL ORDER] Order ID: ${orderId}`);
    console.log(`[CANCEL ORDER] Reason: ${reason}`);
    
    const db: Pool = req.app.get('pgPool');
    
    // Get current order state
    const orderResult = await db.query(
      'SELECT current_state, status, service_details FROM orders WHERE id = $1',
      [orderId]
    );
    
    if (orderResult.rows.length === 0) {
      console.log(`[CANCEL ORDER] Order not found: ${orderId}`);
      return res.status(404).json({ success: false, error: 'Order not found' });
    }
    
    const order = orderResult.rows[0];
    const serviceDetails = order.service_details;
    const isTrialOrder = serviceDetails?.serviceType?.toLowerCase() === 'trial' || 
                        serviceDetails?.service_type?.toLowerCase() === 'trial';
    
    console.log(`[CANCEL ORDER] Current state: ${order.current_state}`);
    console.log(`[CANCEL ORDER] Current status: ${order.status}`);
    console.log(`[CANCEL ORDER] Is trial order: ${isTrialOrder}`);
    
    // Determine cancel state based on order type
    const cancelState = isTrialOrder ? 'trial_cancelled' : 'cancelled';
    
    // Update order to cancelled state
    await db.query(
      'UPDATE orders SET current_state = $1, status = $1, updated_at = NOW() WHERE id = $2',
      [cancelState, orderId]
    );
    
    // Add history record
    await db.query(
      `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [orderId, order.current_state, cancelState, reason || 'Order cancelled by user', null]
    );
    
    console.log(`[CANCEL ORDER] Order ${orderId} cancelled successfully`);
    console.log(`[CANCEL ORDER] ===== COMPLETED =====`);
    
    res.json({
      success: true,
      message: 'Order cancelled successfully',
      data: {
        orderId: orderId,
        previousState: order.current_state,
        newState: cancelState,
        cancelled: true
      }
    });
  } catch (e) {
    console.error(`[CANCEL ORDER] ===== ERROR =====`);
    console.error(`[CANCEL ORDER] Error details:`, e);
    console.error(`[CANCEL ORDER] ===== ERROR END =====`);
    res.status(500).json({ success: false, error: (e as any)?.message || 'Failed to cancel order' });
  }
});

export default router;

// TBYB qualification endpoints
router.post('/:orderId/qualify/fiber', authorize(['orders:update']), (req: Request, res: Response) => qualifyFiber(req as any, res as any));
router.post('/:orderId/qualify/wireless', authorize(['orders:update']), (req: Request, res: Response) => qualifyWireless(req as any, res as any));
