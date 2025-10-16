import { Router } from 'express';
import axios, { AxiosError } from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { OrdersService } from '../services/orders.service.ts';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

const TRIAL_SERVICE_URL = process.env.TRIAL_SERVICE_URL;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const TIMEOUT = 30000;

/**
 * Retry helper with exponential backoff
 */
async function retryRequest<T>(
  requestFn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = INITIAL_RETRY_DELAY
): Promise<T> {
  try {
    return await requestFn();
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    
    // Don't retry on client errors (4xx) except 408 (timeout)
    if (status && status >= 400 && status < 500 && status !== 408) {
      throw error;
    }
    
    // Retry on 502, 503, 504, or network errors
    if (retries > 0 && (!status || status >= 502)) {
      console.log(`Retrying request. Attempts remaining: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryRequest(requestFn, retries - 1, delay * 2);
    }
    
    throw error;
  }
}

/**
 * Standardized error handler
 */
function handleProxyError(error: unknown, res: Response, context: string) {
  console.error(`Error ${context}:`, error);
  
  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 503;
    const errorMessage = error.response?.data?.error || 'Trial service unavailable';
    
    return res.status(status).json({
      success: false,
      error: errorMessage,
      context
    });
  }
  
  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    context
  });
}

/**
 * Service-to-service authentication bypass
 */
function serviceKeyAuth(req: any, _res: any, next: any) {
  try {
    const svcToken = process.env.SERVICE_TOKEN;
    const headerToken = (req.headers['x-service-key'] || req.headers['x-service-api-key'] || '') as string;
    const auth = (req.headers['authorization'] || '') as string;
    
    if (svcToken && (headerToken === svcToken || auth === `Bearer ${svcToken}`)) {
      req.user = req.user || {};
      req.user.permissions = Array.isArray(req.user.permissions)
        ? Array.from(new Set([...req.user.permissions, 'admin:view_trials', 'admin:manage_trials']))
        : ['admin:view_trials', 'admin:manage_trials'];
      return next();
    }
  } catch {}
  return next();
}

// ✅ CRITICAL: Ensure req.body exists for all POST/PUT/PATCH requests
router.use((req: Request, res: Response, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    // Ensure body is at least an empty object
    if (!req.body || typeof req.body !== 'object') {
      req.body = {};
    }
  }
  next();
});

// Health check endpoint (no auth required)
router.get('/health', async (req, res) => {
  try {
    const resp = await axios.get(`${TRIAL_SERVICE_URL}/health`, { 
      timeout: 5000, 
      validateStatus: () => true 
    });
    return res.status(200).json({
      success: true,
      status: resp.status,
      data: resp.data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Trial service health check failed:', error?.message || error);
    return res.status(200).json({
      success: true,
      status: 503,
      data: { status: 'unreachable' },
      timestamp: new Date().toISOString()
    });
  }
});

// Get active trials
router.get('/status/active', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/active`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying active trials request');
  }
});

// Get expiring trials
router.get('/status/expiring', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/expiring`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying expiring trials request');
  }
});

// Get trial analytics
router.get('/analytics', async (req, res) => {
  try {
    console.log('[TRIAL ANALYTICS] ===== STARTING =====');
    
    // Try external service first (temporarily disabled to use local fallback)
    try {
      // Force local fallback to use enhanced service type detection
      throw new Error('Using local fallback for enhanced service type detection');
      
      const { data } = await retryRequest(() =>
        axios.get(`${TRIAL_SERVICE_URL}/api/trials/analytics`, {
          timeout: TIMEOUT,
          headers: { 'Accept': 'application/json' }
        })
      );
      console.log('[TRIAL ANALYTICS] External service response received');
      return res.json(data);
    } catch (externalError) {
      console.log('[TRIAL ANALYTICS] External service unavailable, using local fallback');
    }
    
    // Local fallback: calculate analytics from OMS database
    const db: Pool = req.app.get('pgPool');
    
    // Get trial orders from the orders table with customer data
    const trialOrdersResult = await db.query(`
      SELECT 
        o.id,
        o.status,
        o.current_state,
        o.service_details,
        o.service_type,
        o.created_at,
        o.updated_at,
        c.first_name,
        c.last_name,
        c.email as customer_email
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.service_type = 'Trial' 
         OR o.service_details->>'serviceType' = 'Trial'
         OR o.service_details->>'service_type' = 'Trial'
      ORDER BY o.created_at DESC
    `);
    
    const trialOrders = trialOrdersResult.rows;
    console.log('[TRIAL ANALYTICS] Found', trialOrders.length, 'trial orders');
    
    // Debug: Log sample service_details to understand the data structure
    console.log('[TRIAL ANALYTICS] Sample service_details:', trialOrders.slice(0, 3).map(o => ({
      id: o.id,
      service_details: o.service_details,
      service_type: o.service_type
    })));
    
    // Categorize orders by service type with enhanced detection
    const fiberTrials = trialOrders.filter(order => {
      // Check multiple sources for service type
      const serviceDetails = order.service_details || {};
      let serviceType = serviceDetails.serviceType || serviceDetails.service_type || order.service_type;
      
      // If serviceType is "Trial", try to infer from other fields
      if (serviceType === 'Trial' || serviceType === 'trial') {
        // Check if it's a fiber trial by looking for fiber-specific indicators
        if (serviceDetails.package_name && serviceDetails.package_name.toLowerCase().includes('fiber')) {
          serviceType = 'fiber';
        } else if (serviceDetails.avg_speed && parseInt(serviceDetails.avg_speed) >= 100) {
          // High speed usually indicates fiber
          serviceType = 'fiber';
        } else {
          // Default to fiber for trial orders without clear indicators
          serviceType = 'fiber';
        }
      }
      
      // Debug logging
      console.log(`[TRIAL ANALYTICS] Order ${order.id}: original=${serviceDetails.serviceType || serviceDetails.service_type || order.service_type}, inferred=${serviceType}, service_details=${JSON.stringify(serviceDetails)}`);
      
      return serviceType && serviceType.toLowerCase() === 'fiber';
    });
    
    const wirelessTrials = trialOrders.filter(order => {
      // Check multiple sources for service type
      const serviceDetails = order.service_details || {};
      let serviceType = serviceDetails.serviceType || serviceDetails.service_type || order.service_type;
      
      // If serviceType is "Trial", try to infer from other fields
      if (serviceType === 'Trial' || serviceType === 'trial') {
        // Check if it's a wireless trial by looking for wireless-specific indicators
        if (serviceDetails.package_name && serviceDetails.package_name.toLowerCase().includes('wireless')) {
          serviceType = 'wireless';
        } else if (serviceDetails.device_count && parseInt(serviceDetails.device_count) > 0) {
          // Device count usually indicates wireless
          serviceType = 'wireless';
        } else {
          // Skip this order for wireless if no clear indicators
          return false;
        }
      }
      
      return serviceType && serviceType.toLowerCase() === 'wireless';
    });
    
    console.log('[TRIAL ANALYTICS] Service type breakdown:', {
      fiber: fiberTrials.length,
      wireless: wirelessTrials.length,
      unknown: trialOrders.length - fiberTrials.length - wirelessTrials.length
    });
    
    console.log('[TRIAL ANALYTICS] Fiber trials:', fiberTrials.length, 'Wireless trials:', wirelessTrials.length);
    
    // Calculate overall analytics
    const totalTrials = trialOrders.length;
    const activeTrials = trialOrders.filter(order => 
      ['trial_active', 'trial_engaged', 'trial_order_created', 'trial_fno_provisioning', 'trial_installation_pending', 'trial_installation_scheduled'].includes(order.status)
    ).length;
    const convertedTrials = trialOrders.filter(order => 
      order.status === 'trial_converted'
    ).length;
    const expiredTrials = trialOrders.filter(order => 
      order.status === 'trial_expired'
    ).length;
    const cancelledTrials = trialOrders.filter(order => 
      order.status === 'trial_cancelled'
    ).length;
    
    // Calculate service-specific analytics
    const fiberActive = fiberTrials.filter(order => 
      ['trial_active', 'trial_engaged', 'trial_order_created', 'trial_fno_provisioning', 'trial_installation_pending', 'trial_installation_scheduled'].includes(order.status)
    ).length;
    const fiberConverted = fiberTrials.filter(order => order.status === 'trial_converted').length;
    const fiberConversionRate = fiberTrials.length > 0 ? ((fiberConverted / fiberTrials.length) * 100).toFixed(1) + '%' : '0%';
    
    const wirelessActive = wirelessTrials.filter(order => 
      ['trial_active', 'trial_engaged', 'trial_order_created', 'trial_fno_provisioning', 'trial_installation_pending', 'trial_installation_scheduled'].includes(order.status)
    ).length;
    const wirelessConverted = wirelessTrials.filter(order => order.status === 'trial_converted').length;
    const wirelessConversionRate = wirelessTrials.length > 0 ? ((wirelessConverted / wirelessTrials.length) * 100).toFixed(1) + '%' : '0%';
    
    const conversionRate = totalTrials > 0 ? ((convertedTrials / totalTrials) * 100).toFixed(1) + '%' : '0%';
    
    // Engagement distribution (mock data for now)
    const engagementDistribution = { HOT: Math.floor(activeTrials * 0.3), WARM: Math.floor(activeTrials * 0.4), COLD: Math.floor(activeTrials * 0.3) };
    
    // Usage stats (mock data for now)
    const usageStats = { 
      avgDataUsedGB: Math.floor(Math.random() * 50) + 10, 
      avgLogins: Math.floor(Math.random() * 20) + 5 
    };
    
    // Campaign stats (mock data for now)
    const campaignStats = { 
      total: Math.floor(totalTrials * 0.8), 
      sent: Math.floor(totalTrials * 0.6), 
      failed: Math.floor(totalTrials * 0.1), 
      pending: Math.floor(totalTrials * 0.1), 
      successRate: '75%' 
    };
    
    const analytics = {
      success: true,
      data: {
        totalTrials,
        activeTrials,
        convertedTrials,
        expiredTrials,
        cancelledTrials,
        conversionRate,
        engagementDistribution,
        usageStats,
        campaignStats,
        // Service-specific analytics
        serviceBreakdown: {
          fiber: {
            total: fiberTrials.length,
            active: fiberActive,
            converted: fiberConverted,
            conversionRate: fiberConversionRate
          },
          wireless: {
            total: wirelessTrials.length,
            active: wirelessActive,
            converted: wirelessConverted,
            conversionRate: wirelessConversionRate
          }
        },
        recentTrials: trialOrders.slice(0, 10).map(order => {
          // Enhanced service type detection for recent trials
          const serviceDetails = order.service_details || {};
          let serviceType = serviceDetails.serviceType || serviceDetails.service_type || order.service_type || 'Unknown';
          
          // If serviceType is "Trial", try to infer from other fields
          if (serviceType === 'Trial' || serviceType === 'trial') {
            // Check if it's a fiber trial by looking for fiber-specific indicators
            if (serviceDetails.package_name && serviceDetails.package_name.toLowerCase().includes('fiber')) {
              serviceType = 'fiber';
            } else if (serviceDetails.avg_speed && parseInt(serviceDetails.avg_speed) >= 100) {
              // High speed usually indicates fiber
              serviceType = 'fiber';
            } else if (serviceDetails.package_name && serviceDetails.package_name.toLowerCase().includes('wireless')) {
              serviceType = 'wireless';
            } else if (serviceDetails.device_count && parseInt(serviceDetails.device_count) > 0) {
              // Device count usually indicates wireless
              serviceType = 'wireless';
            } else {
              // Default to fiber for trial orders without clear indicators
              serviceType = 'fiber';
            }
          }
          
          console.log(`[TRIAL ANALYTICS] Recent trial ${order.id}: original=${serviceDetails.serviceType || serviceDetails.service_type || order.service_type}, inferred=${serviceType}`);
          
          return {
            id: order.id,
            status: order.status,
            currentState: order.current_state,
            serviceType: serviceType,
            createdAt: order.created_at,
            updatedAt: order.updated_at,
            customer: {
              firstName: order.first_name,
              lastName: order.last_name,
              email: order.customer_email
            }
          };
        })
      }
    };
    
    console.log('[TRIAL ANALYTICS] ===== COMPLETED =====');
    console.log('[TRIAL ANALYTICS] Analytics data:', analytics.data);
    
    res.json(analytics);
  } catch (error: any) {
    console.error('[TRIAL ANALYTICS] ===== ERROR =====');
    console.error('[TRIAL ANALYTICS] Error details:', error);
    console.error('[TRIAL ANALYTICS] ===== ERROR END =====');
    
    // Return safe defaults to avoid breaking the UI
    return res.status(200).json({
      success: true,
      data: {
        totalTrials: 0,
        activeTrials: 0,
        convertedTrials: 0,
        expiredTrials: 0,
        cancelledTrials: 0,
        conversionRate: '0%',
        engagementDistribution: { HOT: 0, WARM: 0, COLD: 0 },
        usageStats: { avgDataUsedGB: 0, avgLogins: 0 },
        campaignStats: { total: 0, sent: 0, failed: 0, pending: 0, successRate: '0%' },
        recentTrials: []
      }
    });
  }
});

// Get trial by customer ID
router.get('/customer/:customerId', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/customer/${req.params.customerId}`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial by customer request');
  }
});

// Get trial workflow
router.get('/:id/workflow', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/workflow`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial workflow request');
  }
});

// Campaign summary by order
router.get('/order/:orderId/campaigns/summary', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/order/${req.params.orderId}/campaigns/summary`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying campaign summary by order request');
  }
});

// Convert trial (with auto-activation)
router.post('/:id/convert', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req: Request, res: Response) => {
  try {
    // Ensure body exists with defaults
    const requestBody = req.body || {};
    
    const convertResp = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/convert`, 
        requestBody,
        { 
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    // Best-effort: auto-activate related order when trial converts
    try {
      const trialResp = await axios.get(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, 
        { timeout: 10000 }
      );
      const orderId: string | undefined = trialResp?.data?.data?.trial?.orderId || trialResp?.data?.trial?.orderId;
      
      if (orderId) {
        const db: Pool = req.app.get('pgPool');
        const fnoComm = new (await import('../services/fno-communication.service.ts')).FNOCommunicationService((req.app as any).get('mongoClient'));
        const policy = new (await import('../services/policy.service.ts')).PolicyService((req.app as any).get('mongoClient'));
        const ordersService = new OrdersService(db, fnoComm, policy);
        await ordersService.transitionOrder(orderId, 'activated' as any, 'system', 'Trial converted -> auto-activate');
      }
    } catch (e) {
      console.warn('[trials] post-convert activation skipped:', (e as any)?.message || e);
    }

    res.json(convertResp.data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial conversion request');
  }
});

// Cancel trial
router.post('/:id/cancel', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    // Ensure body exists with defaults
    const requestBody = req.body || {};
    
    const { data } = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/cancel`, 
        requestBody,
        { 
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial cancellation request');
  }
});

// Transition trial state (convert|cancel|expire)
router.post('/:id/transition', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    // Ensure body exists with defaults
    const requestBody = req.body || {};
    
    const { data } = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/internal/trials/${req.params.id}/transition`, 
        requestBody, 
        {
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial transition request');
  }
});

// Convert trial to paid customer with payment integration
router.post('/:id/convert-to-paid', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req: Request, res: Response) => {
  try {
    // ✅ Validate required fields
    const { planId, paymentMethod, customerDetails } = req.body || {};
    
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
    
    const trialId = req.params.id;
    
    // 1. Get trial details from microservice
    const trialResp = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/${trialId}`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    
    const trial = trialResp.data?.data?.trial || trialResp.data?.trial;
    if (!trial) {
      return res.status(404).json({ success: false, error: 'Trial not found' });
    }
    
    // 2. Get service package details
    const db: Pool = req.app.get('pgPool');
    const packageResult = await db.query(
      'SELECT * FROM service_packages WHERE id = $1 AND is_active = true',
      [planId]
    );
    
    if (packageResult.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Service package not found' });
    }
    
    const servicePackage = packageResult.rows[0];
    
    // 3. Create payment request via MicroServices-OMS
    const paymentRequest = {
      orderId: trial.orderId,
      customerId: trial.customerId,
      customerEmail: trial.email,
      customerName: `${trial.firstName || ''} ${trial.lastName || ''}`.trim(),
      orderType: 'trial_conversion',
      servicePackage: {
        name: servicePackage.name,
        speed: servicePackage.speed,
        price: servicePackage.price_cents / 100,
        installationFee: servicePackage.installation_fee_cents / 100,
        installationType: 'existing_service'
      },
      serviceAddress: trial.address || {},
      paymentMethod: paymentMethod,
      customerDetails: customerDetails || {}
    };
    
    // 4. Call MicroServices-OMS payment service
    const paymentServiceUrl = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3004';
    const paymentResponse = await retryRequest(() =>
      axios.post(`${paymentServiceUrl}/api/payments/create`, paymentRequest, {
        timeout: TIMEOUT,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    
    // 5. Update trial status to converting
    await retryRequest(() =>
      axios.post(`${TRIAL_SERVICE_URL}/api/trials/${trialId}/transition`, {
        status: 'CONVERTING',
        reason: 'Payment initiated'
      }, {
        timeout: TIMEOUT,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    
    res.json({
      success: true,
      data: {
        trialId: trialId,
        paymentUrl: paymentResponse.data.data?.paymentUrl || paymentResponse.data.paymentUrl,
        checkoutId: paymentResponse.data.data?.checkoutId || paymentResponse.data.checkoutId,
        expiresAt: paymentResponse.data.data?.expiresAt || paymentResponse.data.expiresAt,
        servicePackage: servicePackage
      }
    });
    
  } catch (error) {
    handleProxyError(error, res, 'converting trial to paid customer');
  }
});

// Get available service packages
router.get('/service-packages', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const result = await db.query(`
      SELECT id, name, speed, price_cents, installation_fee_cents, is_active, created_at
      FROM service_packages 
      WHERE is_active = true
      ORDER BY price_cents ASC
    `);
    
    const packages = result.rows.map(pkg => ({
      id: pkg.id,
      name: pkg.name,
      speed: pkg.speed,
      price: pkg.price_cents / 100,
      installationFee: pkg.installation_fee_cents / 100,
      isActive: pkg.is_active,
      createdAt: pkg.created_at
    }));
    
    res.json({ success: true, data: packages });
  } catch (error) {
    handleProxyError(error, res, 'fetching service packages');
  }
});

// Payment webhook handler
router.post('/payments/webhook', async (req: Request, res: Response) => {
  try {
    const { orderId, status, paymentMethod, checkoutId } = req.body || {};
    
    if (!orderId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing orderId in webhook payload' 
      });
    }
    
    if (status === 'completed' || status === 'paid') {
      // 1. Find trial by order ID
      const db: Pool = req.app.get('pgPool');
      const trialResult = await db.query(
        'SELECT id FROM trial_customers WHERE order_id = $1',
        [orderId]
      );
      
      if (trialResult.rows.length > 0) {
        const trialId = trialResult.rows[0].id;
        
        // 2. Convert trial to regular customer
        await retryRequest(() =>
          axios.post(`${TRIAL_SERVICE_URL}/api/trials/${trialId}/convert`, {
            reason: 'Payment completed',
            paymentMethod: paymentMethod || 'unknown',
            checkoutId: checkoutId
          }, {
            timeout: TIMEOUT,
            headers: { 'Content-Type': 'application/json' }
          })
        );
        
        // 3. Update order status
        await db.query(
          'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
          ['converted', orderId]
        );
        
        // 4. Send conversion email
        try {
          await retryRequest(() =>
            axios.post(`${TRIAL_SERVICE_URL}/api/trials/${trialId}/welcome`, {
              type: 'conversion_confirmation',
              paymentMethod: paymentMethod || 'unknown'
            }, {
              timeout: TIMEOUT,
              headers: { 'Content-Type': 'application/json' }
            })
          );
        } catch (emailError) {
          console.warn('Failed to send conversion email:', emailError);
        }
        
        console.log(`Trial ${trialId} successfully converted to paid customer`);
      }
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Payment webhook error:', error);
    res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

// Get trial by ID (must be last to avoid shadowing specific routes)
router.get('/:id', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial request');
  }
});

export default router;