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
      
      const response = await axios.post(
        `${this.onboardingServiceUrl}/api/payments/create`,
        paymentRequest,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-service-key': this.serviceApiKey
          },
          timeout: 10000
        }
      );

      if (response.data.success) {
        console.log(`[PaymentIntegration] Payment link created for order ${orderId}: ${response.data.paymentLink.url}`);
        return response.data.paymentLink;
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

    const type = serviceType?.toLowerCase() || 'internet';
    const speed = bandwidth || '100/20';
    
    return pricing[type]?.[speed] || pricing['internet']['100/20'];
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

    const type = installationType?.toLowerCase() || 'professional_install';
    return fees[type] || fees['professional_install'];
  }

  /**
   * Handle payment completion webhook
   */
  async handlePaymentCompleted(orderId: string): Promise<void> {
    try {
      console.log(`[PaymentIntegration] Handling payment completion for order: ${orderId}`);

      // Update order status to indicate payment received
      await this.db.query(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
        ['payment_received', orderId]
      );

      console.log(`[PaymentIntegration] Order ${orderId} marked as payment received`);
    } catch (error) {
      console.error(`[PaymentIntegration] Error handling payment completion for order ${orderId}:`, error);
    }
  }
}
