import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { authenticate, authorize } from '../middleware/authMiddleware.ts';
import { WorkflowABTestingService } from '../services/workflow-ab-testing.service.ts';
import { ConfigurableWorkflowService } from '../services/configurable-workflow.service.ts';

const router = Router();

// Get all A/B tests
router.get('/tests', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const tests = await abTestingService.getAllABTests();
    res.json({ success: true, tests });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get A/B test by ID
router.get('/tests/:id', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const test = await abTestingService.getABTest(req.params.id);
    if (!test) {
      return res.status(404).json({ success: false, error: { message: 'A/B test not found' } });
    }
    res.json({ success: true, test });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Create A/B test
router.post('/tests', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const createdBy = (req as any).user?.userId;
    
    const test = await abTestingService.createABTest(req.body, createdBy);
    res.status(201).json({ success: true, test });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Update A/B test
router.put('/tests/:id', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const test = await abTestingService.updateABTest(req.params.id, req.body);
    res.json({ success: true, test });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Pause A/B test
router.post('/tests/:id/pause', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    await abTestingService.pauseABTest(req.params.id);
    res.json({ success: true, message: 'A/B test paused' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Complete A/B test
router.post('/tests/:id/complete', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    
    // Get results first
    const results = await abTestingService.getABTestResults(req.params.id);
    await abTestingService.completeABTest(req.params.id, results);
    
    res.json({ success: true, message: 'A/B test completed', results });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Get A/B test results
router.get('/tests/:id/results', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const results = await abTestingService.getABTestResults(req.params.id);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get active A/B test for order type
router.get('/active/:orderType', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const test = await abTestingService.getActiveABTest(req.params.orderType);
    res.json({ success: true, test });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Record workflow metric
router.post('/metrics', authenticate, authorize(['orders:update']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const abTestingService = new WorkflowABTestingService(db, workflowService);
    const { orderId, metricName, value, unit, context } = req.body;
    
    await abTestingService.recordMetric(orderId, metricName, value, unit, context);
    res.json({ success: true, message: 'Metric recorded' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

export default router;
