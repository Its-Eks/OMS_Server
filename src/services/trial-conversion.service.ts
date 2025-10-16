import { Pool } from 'pg';
import { NotificationService } from './notification.service.ts';

export interface ConvertedOrder {
  id: string;
  customer_id: string;
  order_number: string;
  service_details: any;
  installation_address: any;
  customer_email?: string;
  customer_name?: string;
}

export class TrialConversionService {
  private db: Pool;
  private notificationService: NotificationService;

  constructor(db: Pool, notificationService: NotificationService) {
    this.db = db;
    this.notificationService = notificationService;
  }

  /**
   * Handle post-conversion workflow for a converted trial order
   */
  async handlePostConversionWorkflow(orderId: string): Promise<void> {
    try {
      console.log(`[TRIAL CONVERSION SERVICE] ===== STARTING POST-CONVERSION WORKFLOW =====`);
      console.log(`[TRIAL CONVERSION SERVICE] Order ID: ${orderId}`);

      // Get order details
      const orderResult = await this.db.query(
        'SELECT * FROM orders WHERE id = $1',
        [orderId]
      );

      if (orderResult.rows.length === 0) {
        console.log(`[TRIAL CONVERSION SERVICE] Order not found: ${orderId}`);
        return;
      }

      const order = orderResult.rows[0];
      console.log(`[TRIAL CONVERSION SERVICE] Order status: ${order.status}`);

      // Only process if order is in trial_converted state
      if (order.status !== 'trial_converted') {
        console.log(`[TRIAL CONVERSION SERVICE] Order is not in trial_converted state, skipping`);
        return;
      }

      // Get customer details
      const customerResult = await this.db.query(
        'SELECT email, first_name, last_name FROM customers WHERE id = $1',
        [order.customer_id]
      );

      const customer = customerResult.rows[0];
      const customerEmail = customer?.email;
      const customerName = `${customer?.first_name || ''} ${customer?.last_name || ''}`.trim() || 'Customer';

      console.log(`[TRIAL CONVERSION SERVICE] Customer: ${customerName} (${customerEmail})`);

      // Determine next state based on service type and current setup
      const nextState = this.determineNextState(order);
      console.log(`[TRIAL CONVERSION SERVICE] Next state: ${nextState}`);

      // Update order to next state
      await this.db.query(
        'UPDATE orders SET current_state = $1, status = $1, updated_at = NOW() WHERE id = $2',
        [nextState, orderId]
      );

      // Add history record
      await this.db.query(
        `INSERT INTO order_state_history (order_id, from_state, to_state, change_reason, changed_by, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [orderId, 'trial_converted', nextState, 'Post-conversion workflow transition', null]
      );

      // Send notification email
      if (customerEmail) {
        await this.sendConversionNotification(order, customerEmail, customerName, nextState);
      }

      console.log(`[TRIAL CONVERSION SERVICE] Post-conversion workflow completed for order ${orderId}`);
      console.log(`[TRIAL CONVERSION SERVICE] ===== COMPLETED =====`);

    } catch (error) {
      console.error(`[TRIAL CONVERSION SERVICE] Error in post-conversion workflow:`, error);
    }
  }

  /**
   * Determine the next state for a converted order
   */
  private determineNextState(order: ConvertedOrder): string {
    const serviceDetails = order.service_details;
    const serviceType = serviceDetails?.serviceType || serviceDetails?.service_type;

    // Route based on service type
    if (serviceType?.toLowerCase() === 'wireless') {
      return 'paid_service_device_shipping'; // Wireless: ship device
    } else if (serviceType?.toLowerCase() === 'fiber') {
      return 'paid_service_installation_pending'; // Fiber: schedule installation
    } else if (serviceType === 'service_change') {
      return 'paid_service_active'; // Service change: immediately active
    } else {
      // Default to fiber workflow for backward compatibility
      return 'paid_service_installation_pending';
    }
  }

  /**
   * Send conversion notification email
   */
  private async sendConversionNotification(
    order: ConvertedOrder, 
    customerEmail: string, 
    customerName: string, 
    nextState: string
  ): Promise<void> {
    try {
      const subject = 'Trial Converted Successfully! 🎉';
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #333;">Welcome to Your Paid Service!</h2>
          <p>Hi ${customerName},</p>
          <p>Great news! Your trial has been successfully converted to a paid service.</p>
          
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="color: #333; margin-top: 0;">Order Details</h3>
            <p><strong>Order Number:</strong> ${order.order_number || order.id}</p>
            <p><strong>Service Type:</strong> ${order.service_details?.serviceType || 'Internet Service'}</p>
            <p><strong>Next Step:</strong> ${this.getNextStepDescription(nextState)}</p>
          </div>

          <p>Our team will be in touch soon to coordinate the next steps for your service.</p>
          
          <p>If you have any questions, please don't hesitate to contact our support team.</p>
          
          <p>Best regards,<br>The OMS Team</p>
        </div>
      `;

      const text = `Welcome to your paid service! Your trial has been converted successfully. Order: ${order.order_number || order.id}. Next step: ${this.getNextStepDescription(nextState)}.`;

      await this.notificationService.send({
        to: customerEmail,
        subject: subject,
        html: html,
        text: text
      });

      console.log(`[TRIAL CONVERSION SERVICE] Conversion notification sent to ${customerEmail}`);
    } catch (error) {
      console.error(`[TRIAL CONVERSION SERVICE] Failed to send conversion notification:`, error);
    }
  }

  /**
   * Get human-readable description of next step
   */
  private getNextStepDescription(state: string): string {
    const descriptions: Record<string, string> = {
      'paid_service_installation_pending': 'Installation scheduling in progress',
      'paid_service_installation_scheduled': 'Installation scheduled',
      'paid_service_active': 'Service is active and ready',
      'completed': 'Service installation completed'
    };

    return descriptions[state] || 'Processing your service';
  }

  /**
   * Process all converted orders that need post-conversion handling
   */
  async processAllConvertedOrders(): Promise<void> {
    try {
      console.log(`[TRIAL CONVERSION SERVICE] ===== PROCESSING ALL CONVERTED ORDERS =====`);

      // Find all orders in trial_converted state that haven't been processed
      const result = await this.db.query(`
        SELECT id, customer_id, order_number, service_details, installation_address, created_at
        FROM orders 
        WHERE status = 'trial_converted' 
        AND current_state = 'trial_converted'
        AND updated_at > NOW() - INTERVAL '1 hour'
        ORDER BY updated_at DESC
      `);

      console.log(`[TRIAL CONVERSION SERVICE] Found ${result.rows.length} converted orders to process`);

      for (const order of result.rows) {
        await this.handlePostConversionWorkflow(order.id);
      }

      console.log(`[TRIAL CONVERSION SERVICE] ===== COMPLETED PROCESSING ALL CONVERTED ORDERS =====`);
    } catch (error) {
      console.error(`[TRIAL CONVERSION SERVICE] Error processing converted orders:`, error);
    }
  }
}
