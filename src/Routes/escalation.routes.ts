import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getMyEscalations, createEscalation, resolveEscalation } from '../Controllers/escalations.controller.ts';

const router = Router();

router.use(authenticate);

router.get('/my-escalations', authorize(['escalations:view']), getMyEscalations);
router.post('/', authorize(['escalations:escalate']), createEscalation);
router.put('/:id/resolve', authorize(['escalations:resolve']), resolveEscalation);

export default router;
