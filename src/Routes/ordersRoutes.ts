import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getOrders, createOrder, getOrderById, updateOrder } from '../Controllers/orders.controller.ts';
import { normalizeBodyToSnakeCase } from '../Middleware/case-transform.middleware.ts';
import { OrdersService } from '../services/orders.service.ts';
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
    const userId = (req as any).user?.userId || null;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : undefined;
    const nextStatus = typeof req.body?.status === 'string' ? req.body.status : '';
    if (!nextStatus) {
      return res.status(400).json({ success: false, error: { message: 'status is required' } });
    }
    const updated = await svc.transitionOrder(req.params.id, nextStatus, userId || 'system', reason);
    res.json({ success: true, order: updated });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e?.message || 'Failed to transition order' } });
  }
}

// Order workflow state endpoint
async function getOrderWorkflowState(req: Request, res: Response) {
  try {
    const db: Pool = req.app.get('pgPool');
    
    // Get current workflow state for the order
    const result = await db.query(
      `SELECT wi.current_state_id, ws.state_name, ws.display_name, ws.description,
              wd.name as workflow_name, wd.description as workflow_description
       FROM workflow_instances wi
       JOIN workflow_states ws ON wi.current_state_id = ws.id
       JOIN workflow_definitions wd ON wi.workflow_id = wd.id
       WHERE wi.order_id = $1`,
      [req.params.id]
    );
    
    if (result.rows.length === 0) {
      return res.json({ 
        success: true, 
        state: 'created',
        description: 'Order created',
        transitions: []
      });
    }
    
    const currentState = result.rows[0];
    
    // Get valid transitions from current state
    const transitionsResult = await db.query(
      `SELECT wt.transition_name, ws_to.state_name as to_state, ws_to.display_name as to_display_name
       FROM workflow_transitions wt
       JOIN workflow_states ws_from ON wt.from_state_id = ws_from.id
       JOIN workflow_states ws_to ON wt.to_state_id = ws_to.id
       JOIN workflow_instances wi ON ws_from.workflow_id = wi.workflow_id
       WHERE wi.order_id = $1 AND ws_from.id = $2 AND wt.is_active = true`,
      [req.params.id, currentState.current_state_id]
    );
    
    res.json({ 
      success: true, 
      state: currentState.state_name,
      description: currentState.description,
      workflowName: currentState.workflow_name,
      transitions: transitionsResult.rows.map(t => ({
        toState: t.to_state,
        name: t.transition_name,
        displayName: t.to_display_name
      }))
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch workflow state' } });
  }
}

// Order history endpoint (legacy + workflow)
async function getOrderHistory(req: Request, res: Response) {
  try {
    const db: Pool = req.app.get('pgPool');
    
    // Get legacy order state history
    const legacyResult = await db.query(
      `SELECT id, order_id, from_state, to_state, changed_by, change_reason, created_at
       FROM order_state_history
       WHERE order_id = $1
       ORDER BY created_at ASC`,
      [req.params.id]
    );
    
    // Get workflow execution history
    const workflowResult = await db.query(
      `SELECT weh.id, weh.instance_id, weh.from_state_id, weh.to_state_id, weh.executed_by, 
              weh.execution_reason, weh.execution_data, weh.executed_at, weh.duration_seconds,
              ws_from.state_name as from_state_name, ws_to.state_name as to_state_name
       FROM workflow_execution_history weh
       JOIN workflow_instances wi ON weh.instance_id = wi.id
       LEFT JOIN workflow_states ws_from ON weh.from_state_id = ws_from.id
       LEFT JOIN workflow_states ws_to ON weh.to_state_id = ws_to.id
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

export default router;
