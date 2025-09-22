import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getInbox, assignApplication, completeApplication } from '../Controllers/application-admin.controller.ts';

const router = Router();

router.use(authenticate);

router.get('/inbox', authorize(['app_admin:view_inbox']), getInbox);
router.put('/inbox/:id/assign', authorize(['app_admin:assign_applications']), assignApplication);
router.put('/inbox/:id/complete', authorize(['app_admin:process_applications']), completeApplication);

export default router;

