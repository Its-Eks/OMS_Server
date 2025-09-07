import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getOrders, createOrder } from '../Controllers/orders.controller.ts';

const router = Router();

// Protected routes
router.use(authenticate);

router.get('/', getOrders);
router.post('/', createOrder);

export default router;
