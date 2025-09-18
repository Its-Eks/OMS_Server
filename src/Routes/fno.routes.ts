import { Router } from 'express';
import { authenticate, authorize } from '../middleware/authMiddleware.ts';
import { FNOController } from '../Controllers/fno.controller.ts';

const router = Router();
const ctrl = new FNOController();

// Protected routes
router.use(authenticate);

router.get('/', authorize(['admin:read', 'orders:read']), (req, res) => ctrl.list(req, res));
router.get('/active', authorize(['admin:read', 'orders:read']), (req, res) => ctrl.listActive(req, res));
router.get('/:id', authorize(['admin:read', 'orders:read']), (req, res) => ctrl.getById(req, res));

export default router;

