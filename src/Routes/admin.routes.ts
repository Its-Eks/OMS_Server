import { Router } from 'express';
import { createUser, updateUser, deactivateUser, getAuditLogs } from '../controllers/admin.controller.ts';

const router = Router();

router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deactivateUser);
router.get('/audit-logs', getAuditLogs);

export default router;
