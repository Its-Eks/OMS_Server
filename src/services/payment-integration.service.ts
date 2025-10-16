import axios from 'axios';
import { Pool } from 'pg';

export interface PaymentRequest {
  orderId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  orderType: string;
  servicePackage: {
    name: string;
    speed: string;
    price: number;
    installationFee: number;
    installationType: string;
  };
  serviceAddress: {
    street: string;
    city: string;
    province: string;
    postalCode: string;
  };
}

export interface PaymentLink {
  id: string;
  url: string;
  amount: number;
  currency: string;
  status: string;
  expiresAt: string;
}

export class PaymentIntegrationService {
  private db: Pool;
  private onboardingServiceUrl: string;
  private serviceApiKey: string;

  constructor(db: Pool) {
    this.db = db;
    this.onboardingServiceUrl = process.env.ONBOARDING_SERVICE_URL || 'http://localhost:3004';
    this.serviceApiKey = process.env.ONBOARDING_SERVICE_API_KEY || 'oms-svc-auth-x9k2m8n4p7q1w5e8r3t6y9u2i5o8p1a4s7d0f3g6h9j2k5l8';
  }

  private async checkOnboardingServiceAvailability(): Promise<boolean> {
    try {
      const response = await axios.get(`${this.onboardingServiceUrl}/health`, { timeout: 5000 });
      return response.status === 200;
    } catch (error: any) {
      console.warn(`[PaymentIntegration] Onboarding service not available: ${error?.message || 'Unknown error'}`);
      return false;
    }
  }

  /**
   * Create payment link for an order and send email to customer
   */
  async createPaymentForOrder(orderId: string): Promise<PaymentLink | null> {
    try {
      console.log(`[PaymentIntegration] Creating payment for order: ${orderId}`);

      // Get order details with customer information
      const orderData = await this.getOrderWithCustomer(orderId);
      if (!orderData) {
        console.error(`[PaymentIntegration] Order not found: ${orderId}`);
        return null;
      }

      // Check if onboarding service is available before attempting to call it
      const onboardingServiceAvailable = await this.checkOnboardingServiceAvailability();
      if (!onboardingServiceAvailable) {
        console.warn(`[PaymentIntegration] Onboarding service not available, creating mock payment link for order ${orderId}`);
        
        // Create a mock payment link for development/testing
        const mockPaymentLink: PaymentLink = {
          id: `mock-payment-${orderId}-${Date.now()}`,
          url: `https://mock-payment.example.com/pay/${orderId}`,
          amount: this.getServicePrice(orderData.service_details?.serviceType, orderData.service_details?.bandwidth),
          currency: 'ZAR',
          status: 'pending',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        };
        
        console.log(`[PaymentIntegration] Mock payment link created for order ${orderId}:`, mockPaymentLink);
        return mockPaymentLink;
      }

      // Prepare payment request
      const paymentRequest: PaymentRequest = {
        orderId: orderData.id,
        customerId: orderData.customer_id,
        customerEmail: orderData.customer.email,
        customerName: `${orderData.customer.first_name} ${orderData.customer.last_name}`,
        orderType: orderData.order_type || 'new_install',
        servicePackage: {
          name: orderData.service_details?.serviceType || 'Internet Service',
          speed: orderData.service_details?.bandwidth || 'Unknown',
          price: this.getServicePrice(orderData.service_details?.serviceType, orderData.service_details?.bandwidth),
          installationFee: this.getInstallationFee(orderData.service_details?.installationType),
          installationType: orderData.service_details?.installationType || 'professional'
        },
        serviceAddress: {
          street: orderData.installation_address?.street || 'Not specified',
          city: orderData.installation_address?.city || 'Not specified',
          province: orderData.installation_address?.province || 'Not specified',
          postalCode: orderData.installation_address?.postalCode || 'Not specified'
        }
      };

      // Call onboarding service to create payment link
      console.log(`[PaymentIntegration] Calling onboarding service: ${this.onboardingServiceUrl}/api/payments/create`);
      console.log(`[PaymentIntegration] Using API key: ${this.serviceApiKey.substring(0, 10)}...`);
      
      // Retry logic for transient errors (e.g., 429/503)
      const maxRetries = 4;
      const baseDelayMs = 1000;
      let attempt = 0;
      let response;
      while (true) {
        try {
          response = await axios.post(
            `${this.onboardingServiceUrl}/api/payments/create`,
            paymentRequest,
            {
              headers: {
                'Content-Type': 'application/json',
                'x-service-key': this.serviceApiKey
              },
              timeout: 15000
            }
          );
          break;
        } catch (err: any) {
          const status = err?.response?.status;
          const isTransient = status === 429 || status === 502 || status === 503 || status === 504 || err?.code === 'ECONNRESET' || err?.code === 'ENOTFOUND' || err?.code === 'ETIMEDOUT';
          if (attempt < maxRetries && isTransient) {
            const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
            console.warn(`[PaymentIntegration] Attempt ${attempt + 1} failed (status: ${status || err?.code}). Retrying in ${delay}ms...`);
            await new Promise((res) => setTimeout(res, delay));
            attempt++;
            continue;
          }
          throw err;
        }
      }

      if (response.data.success) {
        const paymentUrl = response.data?.data?.paymentUrl;
        const paymentLinkId = response.data?.data?.paymentLinkId;
        const expiresAt = response.data?.data?.expiresAt;
        if (!paymentUrl) {
          throw new Error('paymentUrl missing in onboarding response');
        }
        console.log(`[PaymentIntegration] Payment link created for order ${orderId}: ${paymentUrl}`);
        return {
          id: paymentLinkId,
          url: paymentUrl,
          amount: 0,
          currency: 'ZAR',
          status: 'pending',
          expiresAt: expiresAt || ''
        } as PaymentLink;
      } else {
        console.error(`[PaymentIntegration] Failed to create payment link for order ${orderId}:`, response.data.error);
        return null;
      }

    } catch (error: any) {
      console.error(`[PaymentIntegration] Error creating payment for order ${orderId}:`, error.message);
      return null;
    }
  }

  /**
   * Get order with customer details
   */
  private async getOrderWithCustomer(orderId: string): Promise<any> {
    try {
      const result = await this.db.query(
        `SELECT 
          o.id, o.customer_id, o.order_type, o.installation_address, o.service_details,
          c.first_name, c.last_name, c.email
        FROM orders o
        JOIN customers c ON o.customer_id = c.id
        WHERE o.id = $1`,
        [orderId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const order = result.rows[0];
      return {
        id: order.id,
        customer_id: order.customer_id,
        order_type: order.order_type,
        installation_address: order.installation_address,
        service_details: order.service_details,
        customer: {
          first_name: order.first_name,
          last_name: order.last_name,
          email: order.email
        }
      };
    } catch (error) {
      console.error(`[PaymentIntegration] Error fetching order ${orderId}:`, error);
      return null;
    }
  }

  /**
   * Get service price based on service type and bandwidth
   */
  private getServicePrice(serviceType?: string, bandwidth?: string): number {
    // Default pricing structure
    const pricing: { [key: string]: { [key: string]: number } } = {
      'internet': {
        '100/20': 749,
        '100/50': 999,
        '200/100': 1299,
        '500/200': 1999,
        '1000/500': 2999
      },
      'wireless': {
        '100/20': 599,
        '100/50': 799,
        '200/100': 1099,
        '500/200': 1799,
        '1000/500': 2499
      },
      'fiber': {
        '100/20': 899,
        '100/50': 1199,
        '200/100': 1499,
        '500/200': 2199,
        '1000/500': 3299
      }
    };

    const typeKey = (serviceType || 'internet').toLowerCase();
    const speedKey = bandwidth || '100/20';
    const pricingForType = pricing[typeKey] ?? pricing['internet'];
    const candidate = pricingForType?.[speedKey];
    if (typeof candidate === 'number') {
      return candidate;
    }
    return pricing['internet']?.['100/20'] ?? 749;
  }

  /**
   * Get installation fee based on installation type
   */
  private getInstallationFee(installationType?: string): number {
    const fees: { [key: string]: number } = {
      'professional_install': 999,
      'professional': 999,
      'self_install': 0,
      'self': 0,
      'standard': 499,
      'premium': 1499
    };

    const typeKey = (installationType || 'professional_install').toLowerCase();
    const candidate = fees[typeKey];
    if (typeof candidate === 'number') {
      return candidate;
    }
    return fees['professional_install'] ?? 999;
  }

  /**
   * Handle payment completion webhook
   */
  async handlePaymentCompleted(orderId: string): Promise<void> {
    try {
      console.log(`[PaymentIntegration] Handling payment completion for order: ${orderId}`);

      // Idempotent update: mark as paid if not already
      await this.db.query(
        `UPDATE orders 
           SET status = 'payment_received', updated_at = NOW()
         WHERE id = $1 AND status <> 'payment_received'`,
        [orderId as unknown as string]
      );

      console.log(`[PaymentIntegration] Order ${orderId} marked as payment received`);
    } catch (error) {
      console.error(`[PaymentIntegration] Error handling payment completion for order ${orderId}:`, error);
    }
  }
}
