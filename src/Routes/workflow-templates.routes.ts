import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { authenticate, authorize } from '../middleware/authMiddleware.ts';
import { WorkflowTemplatesService } from '../services/workflow-templates.service.ts';
import { ConfigurableWorkflowService } from '../services/configurable-workflow.service.ts';
import { CamundaBPMService } from '../services/camunda-bpm.service.ts';

const router = Router();

// Get all workflow templates
router.get('/templates', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const templates = await templatesService.getAllTemplates();
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get template by ID
router.get('/templates/:id', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const template = await templatesService.getTemplate(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, error: { message: 'Template not found' } });
    }
    res.json({ success: true, template });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get templates by category
router.get('/templates/category/:category', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const templates = await templatesService.getTemplatesByCategory(req.params.category);
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get templates for order type
router.get('/templates/order-type/:orderType', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const templates = await templatesService.getTemplatesForOrderType(req.params.orderType);
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Get template recommendations
router.get('/templates/recommendations/:orderType', authenticate, authorize(['orders:read']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const { customerTier } = req.query;
    const templates = await templatesService.getTemplateRecommendations(req.params.orderType, customerTier as string);
    res.json({ success: true, templates });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
});

// Create workflow from template
router.post('/templates/:id/create-workflow', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const createdBy = (req as any).user?.userId;
    const { orderType, customizations } = req.body;
    
    const workflowId = await templatesService.createWorkflowFromTemplate(
      req.params.id,
      orderType,
      customizations,
      createdBy
    );
    
    res.status(201).json({ success: true, workflowId, message: 'Workflow created from template' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Create new template
router.post('/templates', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const createdBy = (req as any).user?.userId;
    
    const template = await templatesService.createTemplate(req.body, createdBy);
    res.status(201).json({ success: true, template });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Update template
router.put('/templates/:id', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    const template = await templatesService.updateTemplate(req.params.id, req.body);
    res.json({ success: true, template });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

// Delete template
router.delete('/templates/:id', authenticate, authorize(['admin:system_config']), async (req: Request, res: Response) => {
  try {
    const db: Pool = req.app.get('pgPool');
    const workflowService = new ConfigurableWorkflowService(db);
    const camundaService = new CamundaBPMService(db);
    const templatesService = new WorkflowTemplatesService(db, workflowService, camundaService);
    await templatesService.deleteTemplate(req.params.id);
    res.json({ success: true, message: 'Template deleted' });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
});

export default router;
