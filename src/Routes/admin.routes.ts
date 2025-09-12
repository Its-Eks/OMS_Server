import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { createUser, updateUser, deactivateUser, getAuditLogs } from '../Controllers/admin.controller.ts';

const router = Router();

router.use(authenticate);

router.post('/users', authorize(['admin:manage_users']), createUser);
router.put('/users/:id', authorize(['admin:manage_users']), updateUser);
router.delete('/users/:id', authorize(['admin:manage_users']), deactivateUser);
router.get('/audit-logs', authorize(['admin:view_audit_logs']), getAuditLogs);

export default router;
