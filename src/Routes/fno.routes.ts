import { Router } from 'express';
import { FNOController } from '../Controllers/fno.controller.ts';
import { authenticate } from '../Middleware/authMiddleware.ts';

const router = Router();
const controller = new FNOController();

// Only Operations Manager or System Administrator may handle FNO operations
function requireFNOPrivilegedRole(req: any, res: any, next: any) {
  const role = (req.user?.role || '').toString();
  const normalized = role.trim().toLowerCase();
  const isOpsMgr = normalized === 'operations manager' || normalized === 'operations_manager' || normalized.includes('operations manager');
  const isSysAdmin = normalized === 'system administrator' || normalized === 'system_admin' || normalized.includes('system administrator');
  if (isOpsMgr || isSysAdmin) {
    return next();
  }
  return res.status(403).json({ success: false, error: { message: 'Operations Manager or System Administrator role required' } });
}

// GET /fno - list fnos
router.get('/', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.getFNOs(req, res));

// POST /fno/:fnoId/submit-order
router.post('/:fnoId/submit-order', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.submitOrder(req, res));

// PUT /fno/manual-application/:applicationId
router.put('/manual-application/:applicationId', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.updateManualApplication(req, res));

// GET /fno/fnoConfiguration - configuration dashboard data
router.get('/fnoConfiguration', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.getFNOConfiguration(req, res));

// GET /fno/stats - totals and KPI metrics only
router.get('/stats', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.getFNOStats(req, res));

// GET /fno/integrationLogs - recent integration logs
router.get('/integrationLogs', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.getIntegrationLogs(req, res));

// GET /fno/monitoring - performance and manual processing summaries
router.get('/monitoring', authenticate as any, requireFNOPrivilegedRole, (req, res) => controller.getMonitoring(req, res));

export default router;
