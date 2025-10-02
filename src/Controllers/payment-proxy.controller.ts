import type { Request, Response } from 'express';
import axios from 'axios';

/**
 * Payment Proxy Controller
 * Proxies payment requests to the onboarding-service while adding authentication
 * and validation. This ensures only the main server can access payment endpoints.
 */
export class PaymentProxyController {
  private onboardingServiceUrl: string;
  private serviceApiKey: string;

  constructor() {
    this.onboardingServiceUrl = process.env.ONBOARDING_SERVICE_URL || 'http://localhost:3004';
    this.serviceApiKey = process.env.ONBOARDING_SERVICE_API_KEY || 'default-service-key';
  }

  /**
   * Create payment request
   * POST /api/payments/create
   */
  async createPaymentRequest(req: Request, res: Response): Promise<void> {
    try {
      console.log('[PaymentProxy] Creating payment request for order:', req.body.orderId);

      // Validate required fields
      const { orderId, customerEmail, servicePackage } = req.body;
      if (!orderId || !customerEmail || !servicePackage?.name) {
        res.status(400).json({
          success: false,
          error: { message: 'Missing required fields: orderId, customerEmail, servicePackage.name' }
        });
        return;
      }

      // Add authentication headers and forward to onboarding-service
      const response = await axios.post(
        `${this.onboardingServiceUrl}/api/payments/create`,
        req.body,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceApiKey,
            'x-user-id': req.user?.userId || 'system',
            'x-forwarded-from': 'oms-server'
          },
          timeout: 30000
        }
      );

      console.log('[PaymentProxy] Payment request created successfully:', response.data.data?.paymentLinkId);
      res.json(response.data);

    } catch (error: any) {
      console.error('[PaymentProxy] Create payment request failed:', error.message);
      
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else if (error.code === 'ECONNREFUSED') {
        res.status(503).json({
          success: false,
          error: { message: 'Payment service temporarily unavailable' }
        });
      } else {
        res.status(500).json({
          success: false,
          error: { message: 'Internal server error' }
        });
      }
    }
  }

  /**
   * Get payment status
   * GET /api/payments/:paymentId/status
   */
  async getPaymentStatus(req: Request, res: Response): Promise<void> {
    try {
      const { paymentId } = req.params;
      console.log('[PaymentProxy] Getting payment status for:', paymentId);

      const response = await axios.get(
        `${this.onboardingServiceUrl}/api/payments/${paymentId}/status`,
        {
          headers: {
            'x-service-key': this.serviceApiKey,
            'x-user-id': req.user?.userId || 'system',
            'x-forwarded-from': 'oms-server'
          },
          timeout: 10000
        }
      );

      res.json(response.data);

    } catch (error: any) {
      console.error('[PaymentProxy] Get payment status failed:', error.message);
      
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({
          success: false,
          error: { message: 'Failed to get payment status' }
        });
      }
    }
  }

  /**
   * Resend payment email
   * POST /api/payments/:paymentId/resend
   */
  async resendPaymentEmail(req: Request, res: Response): Promise<void> {
    try {
      const { paymentId } = req.params;
      console.log('[PaymentProxy] Resending payment email for:', paymentId);

      const response = await axios.post(
        `${this.onboardingServiceUrl}/api/payments/${paymentId}/resend`,
        req.body,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceApiKey,
            'x-user-id': req.user?.userId || 'system',
            'x-forwarded-from': 'oms-server'
          },
          timeout: 30000
        }
      );

      res.json(response.data);

    } catch (error: any) {
      console.error('[PaymentProxy] Resend payment email failed:', error.message);
      
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({
          success: false,
          error: { message: 'Failed to resend payment email' }
        });
      }
    }
  }

  /**
   * Handle payment webhooks (public endpoint for Peach Payments)
   * POST /api/payments/webhook
   */
  async handlePaymentWebhook(req: Request, res: Response): Promise<void> {
    try {
      console.log('[PaymentProxy] Handling payment webhook');

      // Forward webhook to onboarding-service
      const response = await axios.post(
        `${this.onboardingServiceUrl}/api/payments/webhook`,
        req.body,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceApiKey,
            'x-forwarded-from': 'oms-server',
            'x-webhook-source': 'peach-payments'
          },
          timeout: 30000
        }
      );

      res.json(response.data);

    } catch (error: any) {
      console.error('[PaymentProxy] Webhook handling failed:', error.message);
      
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({
          success: false,
          error: { message: 'Webhook processing failed' }
        });
      }
    }
  }

  /**
   * Create payment request from order data
   * POST /api/payments/create-from-order/:orderId
   */
  async createPaymentFromOrder(req: Request, res: Response): Promise<void> {
    try {
      const { orderId } = req.params;
      console.log('[PaymentProxy] Creating payment from order:', orderId);

      // Get order details from database
      const pgPool = req.app.get('pgPool');
      const orderResult = await pgPool.query(`
        SELECT 
          o.*,
          c.email as customer_email,
          c.first_name,
          c.last_name,
          c.id as customer_id
        FROM orders o
        LEFT JOIN customers c ON o.customer_id = c.id
        WHERE o.id = $1
      `, [orderId]);

      if (orderResult.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: { message: 'Order not found' }
        });
        return;
      }

      const order = orderResult.rows[0];
      
      // Build payment request from order data
      const paymentRequest = {
        orderId: order.id,
        customerId: order.customer_id,
        customerEmail: order.customer_email,
        customerName: `${order.first_name || ''} ${order.last_name || ''}`.trim() || 'Customer',
        orderType: order.order_type,
        servicePackage: {
          name: order.service_details?.serviceType || 'Internet Service',
          speed: order.service_details?.bandwidth || 'Standard',
          price: parseFloat(req.body.price || '899.00'),
          installationFee: parseFloat(req.body.installationFee || '0.00'),
          installationType: order.service_details?.installationType || 'standard'
        },
        serviceAddress: order.installation_address || order.service_address || {
          street: 'Address not specified',
          city: 'City not specified',
          province: 'Province not specified',
          postalCode: '0000'
        }
      };

      // Forward to create payment endpoint
      const response = await axios.post(
        `${this.onboardingServiceUrl}/api/payments/create`,
        paymentRequest,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceApiKey,
            'x-user-id': req.user?.userId || 'system',
            'x-forwarded-from': 'oms-server'
          },
          timeout: 30000
        }
      );

      console.log('[PaymentProxy] Payment created from order successfully');
      res.json(response.data);

    } catch (error: any) {
      console.error('[PaymentProxy] Create payment from order failed:', error.message);
      
      if (error.response) {
        res.status(error.response.status).json(error.response.data);
      } else {
        res.status(500).json({
          success: false,
          error: { message: 'Failed to create payment from order' }
        });
      }
    }
  }
}
