import { Pool } from 'pg';
import { NotificationService } from './notification.service.ts';

export interface TrialPaymentWorkflow {
  orderId: string;
  customerEmail: string;
  customerName: string;
  trialEndDate: Date;
  daysRemaining: number;
  servicePackages: any[];
  conversionLink: string;
}

export class TrialPaymentWorkflowService {
  private db: Pool;
  private notificationService: NotificationService;

  constructor(db: Pool, notificationService: NotificationService) {
    this.db = db;
    this.notificationService = notificationService;
  }

  /**
   * Send trial conversion email with package selection options
   */
  async sendTrialConversionEmail(orderId: string): Promise<boolean> {
    try {
      console.log(`[TRIAL PAYMENT WORKFLOW] ===== STARTING CONVERSION EMAIL =====`);
      console.log(`[TRIAL PAYMENT WORKFLOW] Order ID: ${orderId}`);

      // Get order and customer details
      const orderResult = await this.db.query(`
        SELECT 
          o.*, 
          c.email, c.first_name, c.last_name,
          tc.trial_start_date, tc.trial_end_date, tc.days_remaining
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN trial_customers tc ON tc.order_id = o.id
        WHERE o.id = $1
      `, [orderId]);

      if (orderResult.rows.length === 0) {
        console.log(`[TRIAL PAYMENT WORKFLOW] Order not found: ${orderId}`);
        return false;
      }

      const order = orderResult.rows[0];
      const customerEmail = order.email;
      const customerName = `${order.first_name || ''} ${order.last_name || ''}`.trim() || 'Customer';
      
      if (!customerEmail) {
        console.log(`[TRIAL PAYMENT WORKFLOW] No customer email found for order ${orderId}`);
        return false;
      }

      // Get available service packages
      const packagesResult = await this.db.query(`
        SELECT * FROM service_packages 
        WHERE is_active = TRUE 
        ORDER BY price ASC
      `);

      const servicePackages = packagesResult.rows;
      const trialEndDate = order.trial_end_date || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const daysRemaining = order.days_remaining || Math.ceil((trialEndDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));

      // Generate conversion link
      const conversionLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/orders/${orderId}/convert`;

      // Send conversion email
      const emailSent = await this.sendConversionEmail({
        orderId,
        customerEmail,
        customerName,
        trialEndDate: new Date(trialEndDate),
        daysRemaining,
        servicePackages,
        conversionLink
      });

      if (emailSent) {
        // Log the email sent
        await this.db.query(`
          INSERT INTO trial_conversion_emails (order_id, customer_email, sent_at, status)
          VALUES ($1, $2, NOW(), 'sent')
        `, [orderId, customerEmail]);

        console.log(`[TRIAL PAYMENT WORKFLOW] Conversion email sent successfully to ${customerEmail}`);
        console.log(`[TRIAL PAYMENT WORKFLOW] ===== COMPLETED =====`);
        return true;
      }

      return false;
    } catch (error) {
      console.error(`[TRIAL PAYMENT WORKFLOW] Error sending conversion email:`, error);
      return false;
    }
  }

  /**
   * Send the actual conversion email with package options
   */
  private async sendConversionEmail(workflow: TrialPaymentWorkflow): Promise<boolean> {
    try {
      const subject = `Your Trial is Ending Soon - Choose Your Service Package! 🚀`;
      
      // Create package options HTML
      const packageOptions = workflow.servicePackages.map((pkg, index) => `
        <div style="border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px; margin: 10px 0; background: #f9fafb;">
          <h3 style="margin: 0 0 10px 0; color: #1f2937;">${pkg.name}</h3>
          <p style="margin: 5px 0; color: #6b7280;"><strong>Speed:</strong> ${pkg.speed}</p>
          <p style="margin: 5px 0; color: #6b7280;"><strong>Price:</strong> R${pkg.price.toFixed(2)}/month</p>
          <p style="margin: 5px 0; color: #6b7280;"><strong>Installation:</strong> R${pkg.installation_fee.toFixed(2)}</p>
        </div>
      `).join('');

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h1 style="color: #1f2937; text-align: center;">Your Trial is Ending Soon!</h1>
          
          <p>Hi ${workflow.customerName},</p>
          
          <p>Great news! Your 30-day trial is coming to an end in <strong>${workflow.daysRemaining} days</strong> (ending on ${workflow.trialEndDate.toLocaleDateString()}).</p>
          
          <p>We hope you've enjoyed your trial experience! To continue enjoying our high-speed internet service, please select one of our service packages below:</p>
          
          <div style="background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #1f2937; margin-top: 0;">Available Service Packages</h2>
            ${packageOptions}
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${workflow.conversionLink}" 
               style="background: #10b981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
              Choose Your Package & Continue Service
            </a>
          </div>
          
          <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 8px; padding: 15px; margin: 20px 0;">
            <p style="margin: 0; color: #92400e;"><strong>Important:</strong> If you don't select a package before your trial ends, your service will be suspended. Don't worry - you can reactivate anytime!</p>
          </div>
          
          <p>If you have any questions or need help choosing the right package, please don't hesitate to contact our support team.</p>
          
          <p>Thank you for trying our service!</p>
          
          <p>Best regards,<br>The OMS Team</p>
        </div>
      `;

      const text = `
        Your Trial is Ending Soon!
        
        Hi ${workflow.customerName},
        
        Your 30-day trial is ending in ${workflow.daysRemaining} days (${workflow.trialEndDate.toLocaleDateString()}).
        
        Available packages:
        ${workflow.servicePackages.map(pkg => `${pkg.name} - ${pkg.speed} - R${pkg.price}/month`).join('\n')}
        
        Choose your package: ${workflow.conversionLink}
        
        If you don't select a package, your service will be suspended.
        
        Contact us if you need help!
      `;

      await this.notificationService.send({
        to: workflow.customerEmail,
        subject: subject,
        html: html,
        text: text
      });

      return true;
    } catch (error) {
      console.error(`[TRIAL PAYMENT WORKFLOW] Error sending email:`, error);
      return false;
    }
  }

  /**
   * Send conversion reminder emails at specific intervals
   */
  async sendConversionReminders(): Promise<void> {
    try {
      console.log(`[TRIAL PAYMENT WORKFLOW] ===== SENDING CONVERSION REMINDERS =====`);

      // Get trial customers approaching conversion deadlines
      const remindersResult = await this.db.query(`
        SELECT 
          o.id as order_id,
          c.email,
          c.first_name,
          c.last_name,
          tc.trial_end_date,
          tc.days_remaining,
          tce.sent_at as last_email_sent
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN trial_customers tc ON tc.order_id = o.id
        LEFT JOIN trial_customers tc2 ON tc2.order_id = o.id AND tc2.status = 'ACTIVE'
        LEFT JOIN trial_conversion_emails tce ON tce.order_id = o.id
        WHERE o.status = 'trial_active' 
        AND tc2.status = 'ACTIVE'
        AND tc.days_remaining IN (7, 3, 1)
        AND (tce.sent_at IS NULL OR tce.sent_at < NOW() - INTERVAL '1 day')
        ORDER BY tc.days_remaining ASC
      `);

      console.log(`[TRIAL PAYMENT WORKFLOW] Found ${remindersResult.rows.length} customers for reminders`);

      for (const customer of remindersResult.rows) {
        await this.sendTrialConversionEmail(customer.order_id);
      }

      console.log(`[TRIAL PAYMENT WORKFLOW] ===== REMINDERS COMPLETED =====`);
    } catch (error) {
      console.error(`[TRIAL PAYMENT WORKFLOW] Error sending reminders:`, error);
    }
  }
}
