import { Router } from 'express';
import { PaymentProxyController } from '../Controllers/payment-proxy.controller.ts';
import { authenticate } from '../Middleware/authMiddleware.ts';

const router = Router();
const paymentController = new PaymentProxyController();

// All payment routes require authentication except webhooks
router.use((req, res, next) => {
  // Skip auth for webhook endpoint (Peach Payments needs direct access)
  if (req.path === '/webhook' && req.method === 'POST') {
    return next();
  }
  return authenticate(req, res, next);
});

// Create payment request
router.post('/create', paymentController.createPaymentRequest.bind(paymentController));

// Create payment from existing order
router.post('/create-from-order/:orderId', paymentController.createPaymentFromOrder.bind(paymentController));

// Get payment status
router.get('/:paymentId/status', paymentController.getPaymentStatus.bind(paymentController));

// Resend payment email
router.post('/:paymentId/resend', paymentController.resendPaymentEmail.bind(paymentController));

// Handle payment webhooks (public endpoint)
router.post('/webhook', paymentController.handlePaymentWebhook.bind(paymentController));

export default router;
