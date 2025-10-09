import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { SystemSettingsController as C } from '../Controllers/systemSettings.controller.ts';






const router = Router();

router.use(authenticate);
const adminOnly = authorize(['system_admin', 'admin:system_config']);

router.get('/', adminOnly, C.list);
router.get('/:key', adminOnly, C.getOne);
router.put('/:key', adminOnly, C.upsert);
router.patch('/:key', adminOnly, C.patch);
// Support both route styles for audit to avoid client/server mismatch
router.get('/audit/:key', adminOnly, C.audit);
router.get('/:key/audit', adminOnly, C.audit);
router.post('/validate', adminOnly, C.validate);
router.post('/:key/rollback', adminOnly, C.rollback);

export default router;

// this must use system admin  middleware and only system admin can access this route