import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { authenticate, authorize } from '../middleware/authMiddleware.ts';
import { ConfigurableWorkflowService } from '../services/configurable-workflow.service.ts';

const router = Router();

// Get all workflow definitions
router.get('/definitions', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const definitions = await workflowService.getAllWorkflowDefinitions();
    res.json({ success: true, definitions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get workflow definition by order type
router.get('/definitions/:orderType', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const definition = await workflowService.getWorkflowForOrderType(req.params.orderType);
    if (!definition) {
      return res.status(404).json({ success: false, error: { message: 'Workflow not found' } });
    }
    res.json({ success: true, definition });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Create new workflow definition
router.post('/definitions', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const createdBy = (req as any).user?.userId;
    
    const definition = await workflowService.createWorkflowDefinition(req.body, createdBy);
    res.status(201).json({ success: true, definition });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Update workflow definition
router.put('/definitions/:id', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const definition = await workflowService.updateWorkflowDefinition(req.params.id, req.body);
    res.json({ success: true, definition });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Get workflow states for a definition
router.get('/definitions/:id/states', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const states = await workflowService.getWorkflowStates(req.params.id);
    res.json({ success: true, states });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get workflow transitions for a definition
router.get('/definitions/:id/transitions', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const transitions = await workflowService.getWorkflowTransitions(req.params.id);
    res.json({ success: true, transitions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get workflow instance for an order
router.get('/orders/:orderId/instance', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const instance = await workflowService.getWorkflowInstance(req.params.orderId);
    if (!instance) {
      return res.status(404).json({ success: false, error: { message: 'Workflow instance not found' } });
    }
    res.json({ success: true, instance });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get workflow execution history for an order
router.get('/orders/:orderId/history', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const instance = await workflowService.getWorkflowInstance(req.params.orderId);
    if (!instance) {
      return res.status(404).json({ success: false, error: { message: 'Workflow instance not found' } });
    }
    
    const history = await workflowService.getExecutionHistory(instance.id);
    res.json({ success: true, history });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get valid transitions for an order
router.get('/orders/:orderId/transitions', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const instance = await workflowService.getWorkflowInstance(req.params.orderId);
    if (!instance) {
      return res.status(404).json({ success: false, error: { message: 'Workflow instance not found' } });
    }
    
    const transitions = await workflowService.getValidTransitions(instance.id);
    res.json({ success: true, transitions });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Execute workflow transition
router.post('/orders/:orderId/transitions', authenticate, authorize(['orders:update']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const executedBy = (req as any).user?.userId;
    const { toStateId, reason, executionData } = req.body;
    
    const instance = await workflowService.getWorkflowInstance(req.params.orderId);
    if (!instance) {
      return res.status(404).json({ success: false, error: { message: 'Workflow instance not found' } });
    }
    
    const updatedInstance = await workflowService.executeTransition(
      instance.id,
      toStateId,
      executedBy,
      reason || 'Manual transition',
      executionData || {}
    );
    
    res.json({ success: true, instance: updatedInstance });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

export default router;
