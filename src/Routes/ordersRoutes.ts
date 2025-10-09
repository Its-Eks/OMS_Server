import { Router } from 'express';
import { randomUUID } from 'crypto';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getOrders, createOrder, getOrderById, updateOrder, qualifyFiber, qualifyWireless } from '../Controllers/orders.controller.ts';
import { normalizeBodyToSnakeCase } from '../Middleware/case-transform.middleware.ts';
import { OrdersService } from '../services/orders.service.ts';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';
import { FNOCommunicationService } from '../services/fno-communication.service.ts';
import { PolicyService } from '../services/policy.service.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';

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
    const userId: string = ((req as any).user?.userId as string | undefined) || 'system';
    const reason: string | undefined = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const nextStatus: string = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!nextStatus) {
      return res.status(400).json({ success: false, error: { message: 'status is required' } });
    }
    const updated = await svc.transitionOrder(req.params.id, nextStatus, userId, reason);

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

// Order workflow state endpoint
async function getOrderWorkflowState(req: Request, res: Response) {
  try {
    const db: Pool = req.app.get('pgPool');

    // Attempt to load current workflow state for the order. If no instance, return safe default.
    let currentState: any | null = null;
    try {
      const result = await db.query(
        `SELECT wi.current_state_id, ws.state_name, ws.display_name, ws.description,
                wd.name as workflow_name, wd.description as workflow_description
         FROM workflow_instances wi
         JOIN workflow_states ws ON wi.current_state_id = ws.id
         JOIN workflow_definitions wd ON wi.workflow_id = wd.id
         WHERE wi.order_id = $1`,
        [req.params.id]
      );
      currentState = result.rows[0] || null;
    } catch (innerErr: any) {
      // If the workflow tables are missing/misconfigured, do not fail the request
      // eslint-disable-next-line no-console
      console.warn('[orders] getOrderWorkflowState instance query failed, returning default:', innerErr?.message);
      currentState = null;
    }

    if (!currentState) {
      return res.json({
        success: true,
        state: 'created',
        description: 'Order created',
        transitions: []
      });
    }

    // Try to fetch valid transitions; on error, fall back to empty list
    let transitions: Array<{ toState: string; name: string; displayName?: string }> = [];
    try {
      const transitionsResult = await db.query(
        `SELECT wt.transition_name, ws_to.state_name as to_state, ws_to.display_name as to_display_name
         FROM workflow_transitions wt
         JOIN workflow_states ws_from ON wt.from_state_id = ws_from.id
         JOIN workflow_states ws_to ON wt.to_state_id = ws_to.id
         JOIN workflow_instances wi ON ws_from.workflow_id = wi.workflow_id
         WHERE wi.order_id = $1 AND ws_from.id = $2`,
        [req.params.id, currentState.current_state_id]
      );
      transitions = (transitionsResult.rows || []).map(t => ({
        toState: t.to_state,
        name: t.transition_name,
        displayName: t.to_display_name
      }));
    } catch (innerErr: any) {
      // eslint-disable-next-line no-console
      console.warn('[orders] getOrderWorkflowState transitions query failed, defaulting to none:', innerErr?.message);
      transitions = [];
    }

    res.json({
      success: true,
      state: currentState.state_name,
      description: currentState.description,
      workflowName: currentState.workflow_name,
      transitions
    });
  } catch (e: any) {
    // Final safety: never 500 this endpoint; return safe default
    // eslint-disable-next-line no-console
    console.warn('[orders] getOrderWorkflowState fatal error, returning default:', e?.message);
    res.json({ success: true, state: 'created', description: 'Order created', transitions: [] });
  }
}

// Order history endpoint (legacy + workflow)
async function getOrderHistory(req: Request, res: Response) {
  try {
    const db: Pool = req.app.get('pgPool');
    
    // Get legacy order state history
    const legacyResult = await db.query(
      `SELECT osh.id, osh.order_id, osh.from_state, osh.to_state, osh.changed_by,
              u.first_name AS actor_first_name, u.last_name AS actor_last_name,
              osh.change_reason, osh.created_at
         FROM order_state_history osh
         LEFT JOIN users u ON u.id = osh.changed_by
        WHERE osh.order_id = $1
        ORDER BY osh.created_at ASC`,
      [req.params.id]
    );
    
    // Get workflow execution history
    const workflowResult = await db.query(
      `SELECT weh.id, weh.instance_id, weh.from_state_id, weh.to_state_id, weh.executed_by,
              u.first_name AS actor_first_name, u.last_name AS actor_last_name,
              weh.execution_reason, weh.execution_data, weh.executed_at, weh.duration_seconds,
              ws_from.state_name as from_state_name, ws_to.state_name as to_state_name
         FROM workflow_execution_history weh
         JOIN workflow_instances wi ON weh.instance_id = wi.id
         LEFT JOIN workflow_states ws_from ON weh.from_state_id = ws_from.id
         LEFT JOIN workflow_states ws_to ON weh.to_state_id = ws_to.id
         LEFT JOIN users u ON u.id = weh.executed_by
        WHERE wi.order_id = $1
        ORDER BY weh.executed_at ASC`,
      [req.params.id]
    );
    
    res.json({ 
      success: true, 
      legacyHistory: legacyResult.rows,
      workflowHistory: workflowResult.rows,
      totalHistory: [...legacyResult.rows, ...workflowResult.rows].sort((a, b) => 
        new Date(a.created_at || a.executed_at).getTime() - new Date(b.created_at || b.executed_at).getTime()
      )
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch history' } });
  }
}

const router = Router();

// Protected routes
router.use(authenticate);

router.get('/', authorize(['orders:read']), getOrders);
router.post('/', authorize(['orders:create']), normalizeBodyToSnakeCase, createOrder);
router.patch('/:id/status', authorize(['orders:update']), normalizeBodyToSnakeCase, transitionOrder);
router.get('/:id', authorize(['orders:read']), getOrderById);
router.put('/:id', authorize(['orders:update']), normalizeBodyToSnakeCase, updateOrder);
router.get('/:id/workflow/state', authorize(['orders:read']), getOrderWorkflowState);
router.get('/:id/history', authorize(['orders:read']), getOrderHistory);

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
router.get('/trial-customers', authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
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
    const order = await svc.getOrder(req.params.id);
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
    let order = await svc.getOrder(req.params.id);
    if (!order) return res.status(404).json({ success: false, error: { message: 'Order not found' } });

    const serviceType = ((order as any).serviceDetails?.serviceType || (order as any).serviceDetails?.service_type || '').toString().toLowerCase();
    const userId: string = ((req as any).user?.userId as string | undefined) || 'system';

    // New installationStatus parameter: "new" | "existing"
    const installationStatus = req.body?.installationStatus || 'new';
    
    // Optional stopAt param to halt simulation at a stage (e.g., 'installed')
    const stopAt = typeof req.body?.stopAt === 'string' ? String(req.body.stopAt).toLowerCase() : null;

    // Check if this is a trial order and handle installation status
    const orderIsTrial = serviceType === 'trial';
    
    if (orderIsTrial && installationStatus === 'existing') {
      // Convert trial customer to regular customer
      await (svc as any).convertTrialToRegularCustomer(order.customer_id);
      
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
        const updated = await (svc as any).transitionToEnrichedInternal(order.id, userId, reason);
        return updated;
      }
      const updated = await svc.transitionOrder(order.id, status as any, userId, reason);
      return updated;
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
              const mergedServiceDetails = { ...(order as any).serviceDetails, fno: bodyFno };
              await svc.updateOrder(order.id, { fnoId: ensuredId, serviceDetails: mergedServiceDetails });
            } else {
              // fallback: ensure default fno and set
              const ensuredId = await (svc as any).ensureFno('default-fno');
              const mergedServiceDetails = { ...(order as any).serviceDetails, fno: 'default-fno' };
              await svc.updateOrder(order.id, { fnoId: ensuredId, serviceDetails: mergedServiceDetails });
            }
            order = await svc.getOrder(order.id);
          }
        } catch (e) {
          return res.status(400).json({ success: false, error: { message: (e as any)?.message || 'Failed to set FNO before submission' } });
        }
      }
      await apply(s, `simulate(${s})`);
      executed.push(s);
      // Refresh order after each step
      order = await svc.getOrder(order.id);
      if (stopAt && stopAt === s) break;
    }

    // Invalidate caches (orders and dashboard) after bulk transitions
    try {
      const redis = req.app.get('redis');
      const cache = new CacheService(redis);
      await cache.delByPrefix(buildCacheKey(['orders:list']));
      await cache.delByPrefix(buildCacheKey(['dashboard:data']))
    } catch {}

    const finalOrder = await svc.getOrder(req.params.id);
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

export default router;

// TBYB qualification endpoints
router.post('/:orderId/qualify/fiber', authorize(['orders:update']), (req: Request, res: Response) => qualifyFiber(req as any, res as any));
router.post('/:orderId/qualify/wireless', authorize(['orders:update']), (req: Request, res: Response) => qualifyWireless(req as any, res as any));
