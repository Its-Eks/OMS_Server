import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getOrders, createOrder } from '../Controllers/orders.controller.ts';

const router = Router();

// Protected routes
router.use(authenticate);

router.get('/', authorize(['orders:read']), getOrders);
router.post('/', authorize(['orders:create']), createOrder);

export default router;
