import { Pool } from 'pg';
import { NotificationService } from './notification.service.ts';
import { TrialPaymentWorkflowService } from './trial-payment-workflow.service.ts';

export interface TrialCustomer {
  id: string;
  customer_id: string;
  order_id: string;
  email: string;
  phone: string;
  trial_start_date: string;
  trial_end_date: string;
  days_remaining: number;
  status: string;
  engagement_level: string;
  engagement_score: number;
  last_login_date?: string;
  total_data_usage_gb: number;
  login_count: number;
  converted_at?: string;
  converted_plan_id?: string;
  cancellation_reason?: string;
  metadata: any;
  created_at: string;
  updated_at: string;
}

export interface CampaignExecution {
  id: string;
  trial_customer_id: string;
  campaign_day: number;
  campaign_name: string;
  status: string;
  sent_at?: string;
  channels: string[];
  content: any;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

export class TrialCampaignService {
  private db: Pool;
  private notificationService: NotificationService;
  private paymentWorkflowService: TrialPaymentWorkflowService;

  constructor(db: Pool, notificationService: NotificationService) {
    this.db = db;
    this.notificationService = notificationService;
    this.paymentWorkflowService = new TrialPaymentWorkflowService(db, notificationService);
  }

  /**
   * Run daily campaign checks for trial customers
   */
  async runDailyCampaigns(): Promise<void> {
    try {
      console.log('[TRIAL CAMPAIGN] ===== STARTING DAILY CAMPAIGNS =====');
      
      // Get active trial customers
      const trialCustomers = await this.getActiveTrialCustomers();
      console.log(`[TRIAL CAMPAIGN] Found ${trialCustomers.length} active trial customers`);
      
      for (const customer of trialCustomers) {
        await this.processCustomerCampaigns(customer);
      }
      
      console.log('[TRIAL CAMPAIGN] ===== DAILY CAMPAIGNS COMPLETED =====');
    } catch (error) {
      console.error('[TRIAL CAMPAIGN] Error running daily campaigns:', error);
    }
  }

  /**
   * Get active trial customers
   */
  private async getActiveTrialCustomers(): Promise<TrialCustomer[]> {
    const result = await this.db.query(`
      SELECT * FROM trial_customers 
      WHERE status = 'ACTIVE' 
        AND trial_end_date > NOW()
      ORDER BY trial_start_date ASC
    `);
    
    return result.rows;
  }

  /**
   * Process campaigns for a specific trial customer
   */
  private async processCustomerCampaigns(customer: TrialCustomer): Promise<void> {
    try {
      const daysSinceStart = this.calculateDaysSinceStart(customer.trial_start_date);
      const daysRemaining = customer.days_remaining;
      
      console.log(`[TRIAL CAMPAIGN] Processing customer ${customer.email} - Day ${daysSinceStart}, ${daysRemaining} days remaining`);
      
      // Define campaign triggers
      const campaigns = this.getCampaignTriggers(daysSinceStart, daysRemaining, customer.engagement_level);
      
      for (const campaign of campaigns) {
        await this.executeCampaign(customer, campaign);
      }
    } catch (error) {
      console.error(`[TRIAL CAMPAIGN] Error processing campaigns for customer ${customer.email}:`, error);
    }
  }

  /**
   * Calculate days since trial start
   */
  private calculateDaysSinceStart(trialStartDate: string): number {
    const start = new Date(trialStartDate);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  }

  /**
   * Get campaign triggers based on trial progress
   */
  private getCampaignTriggers(daysSinceStart: number, daysRemaining: number, engagementLevel: string): Array<{
    name: string;
    day: number;
    type: 'welcome' | 'engagement' | 'conversion' | 'expiry_warning' | 'expiry_urgent';
    priority: 'high' | 'medium' | 'low';
  }> {
    const campaigns = [];
    
    // Welcome campaign (Day 1)
    if (daysSinceStart === 1) {
      campaigns.push({
        name: 'Trial Welcome',
        day: 1,
        type: 'welcome',
        priority: 'high'
      });
    }
    
    // Engagement campaigns (Days 3, 7, 14)
    if ([3, 7, 14].includes(daysSinceStart)) {
      campaigns.push({
        name: 'Trial Engagement',
        day: daysSinceStart,
        type: 'engagement',
        priority: engagementLevel === 'COLD' ? 'high' : 'medium'
      });
    }
    
    // Conversion campaigns (7, 3, 1 days remaining) - send package selection emails
    if ([7, 3, 1].includes(daysRemaining)) {
      campaigns.push({
        name: `Trial Conversion Reminder (${daysRemaining} days)`,
        day: daysSinceStart,
        type: 'conversion',
        priority: daysRemaining === 1 ? 'high' : 'medium'
      });
    }
    
    return campaigns;
  }

  /**
   * Execute a campaign for a customer
   */
  private async executeCampaign(customer: TrialCustomer, campaign: any): Promise<void> {
    try {
      // Check if campaign already executed
      const existingExecution = await this.db.query(
        'SELECT id FROM campaign_executions WHERE trial_customer_id = $1 AND campaign_name = $2 AND campaign_day = $3',
        [customer.id, campaign.name, campaign.day]
      );
      
      if (existingExecution.rows.length > 0) {
        console.log(`[TRIAL CAMPAIGN] Campaign ${campaign.name} already executed for customer ${customer.email}`);
        return;
      }
      
      // For conversion campaigns, use the payment workflow service
      if (campaign.type === 'conversion') {
        const emailSent = await this.paymentWorkflowService.sendTrialConversionEmail(customer.order_id);
        
        if (emailSent) {
          // Record successful execution
          await this.db.query(
            `INSERT INTO campaign_executions (trial_customer_id, campaign_day, campaign_name, status, sent_at, channels, content)
             VALUES ($1, $2, $3, 'SENT', NOW(), $4, $5)`,
            [customer.id, campaign.day, campaign.name, ['email'], { type: 'conversion_email' }]
          );
          
          console.log(`[TRIAL CAMPAIGN] ✅ Conversion email sent to ${customer.email}`);
        } else {
          // Record failed execution
          await this.db.query(
            `INSERT INTO campaign_executions (trial_customer_id, campaign_day, campaign_name, status, channels, content, error_message)
             VALUES ($1, $2, $3, 'FAILED', $4, $5, 'Conversion email failed')`,
            [customer.id, campaign.day, campaign.name, ['email'], { type: 'conversion_email' }]
          );
          
          console.error(`[TRIAL CAMPAIGN] ❌ Failed to send conversion email to ${customer.email}`);
        }
      } else {
        // Generate campaign content for other campaigns
        const content = this.generateCampaignContent(customer, campaign);
        
        // Send email
        const emailSent = await this.notificationService.send({
          to: customer.email,
          subject: content.subject,
          html: content.html,
          text: content.text
        });
        
        if (emailSent) {
          // Record successful execution
          await this.db.query(
            `INSERT INTO campaign_executions (trial_customer_id, campaign_day, campaign_name, status, sent_at, channels, content)
             VALUES ($1, $2, $3, 'SENT', NOW(), $4, $5)`,
            [customer.id, campaign.day, campaign.name, ['email'], content]
          );
          
          console.log(`[TRIAL CAMPAIGN] ✅ Campaign ${campaign.name} sent to ${customer.email}`);
        } else {
          // Record failed execution
          await this.db.query(
            `INSERT INTO campaign_executions (trial_customer_id, campaign_day, campaign_name, status, channels, content, error_message)
             VALUES ($1, $2, $3, 'FAILED', $4, $5, 'Email delivery failed')`,
            [customer.id, campaign.day, campaign.name, ['email'], content]
          );
          
          console.error(`[TRIAL CAMPAIGN] ❌ Failed to send campaign ${campaign.name} to ${customer.email}`);
        }
      }
    } catch (error) {
      console.error(`[TRIAL CAMPAIGN] Error executing campaign ${campaign.name}:`, error);
      
      // Record error
      await this.db.query(
        `INSERT INTO campaign_executions (trial_customer_id, campaign_day, campaign_name, status, channels, content, error_message)
         VALUES ($1, $2, $3, 'ERROR', $4, $5, $6)`,
        [customer.id, campaign.day, campaign.name, ['email'], {}, error instanceof Error ? error.message : 'Unknown error']
      );
    }
  }

  /**
   * Generate campaign content based on type
   */
  private generateCampaignContent(customer: TrialCustomer, campaign: any): {
    subject: string;
    html: string;
    text: string;
  } {
    const customerName = customer.email.split('@')[0]; // Simple name extraction
    const daysRemaining = customer.days_remaining;
    
    switch (campaign.type) {
      case 'welcome':
        return {
          subject: 'Welcome to Your Free Trial! 🎉',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">Welcome to Your Free Trial!</h2>
              <p>Hi ${customerName},</p>
              <p>Welcome to your 28-day free trial! We're excited to have you on board.</p>
              <p>Your trial includes:</p>
              <ul>
                <li>High-speed internet access</li>
                <li>24/7 customer support</li>
                <li>No setup fees</li>
              </ul>
              <p>If you have any questions, don't hesitate to reach out to our support team.</p>
              <p>Best regards,<br>The OMS Team</p>
            </div>
          `,
          text: `Welcome to your free trial! Your 28-day trial includes high-speed internet access, 24/7 support, and no setup fees.`
        };
        
      case 'engagement':
        return {
          subject: 'How is your trial going? 📊',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">How is your trial going?</h2>
              <p>Hi ${customerName},</p>
              <p>We hope you're enjoying your free trial! You have ${daysRemaining} days remaining.</p>
              <p>Need help getting the most out of your service? Our support team is here to help!</p>
              <p>Best regards,<br>The OMS Team</p>
            </div>
          `,
          text: `How is your trial going? You have ${daysRemaining} days remaining. Need help? Our support team is here!`
        };
        
      case 'conversion':
        return {
          subject: 'Ready to continue? Convert your trial! 💳',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #333;">Ready to continue your service?</h2>
              <p>Hi ${customerName},</p>
              <p>Your trial is going great! You have ${daysRemaining} days remaining.</p>
              <p>Ready to continue? Convert your trial to a paid plan and keep enjoying our service!</p>
              <p>Best regards,<br>The OMS Team</p>
            </div>
          `,
          text: `Ready to continue? Convert your trial to a paid plan! You have ${daysRemaining} days remaining.`
        };
        
      case 'expiry_warning':
        return {
          subject: `Trial ending in ${daysRemaining} days ⏰`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #e74c3c;">Trial ending in ${daysRemaining} days</h2>
              <p>Hi ${customerName},</p>
              <p>Your free trial will end in ${daysRemaining} days. Don't lose access to your service!</p>
              <p>Convert to a paid plan now to continue enjoying our service.</p>
              <p>Best regards,<br>The OMS Team</p>
            </div>
          `,
          text: `Trial ending in ${daysRemaining} days! Convert to a paid plan to continue your service.`
        };
        
      case 'expiry_urgent':
        return {
          subject: 'URGENT: Trial ends tomorrow! 🚨',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <h2 style="color: #e74c3c;">URGENT: Trial ends tomorrow!</h2>
              <p>Hi ${customerName},</p>
              <p>Your free trial ends tomorrow! This is your final reminder.</p>
              <p>Convert to a paid plan now to avoid service interruption.</p>
              <p>Best regards,<br>The OMS Team</p>
            </div>
          `,
          text: `URGENT: Trial ends tomorrow! Convert now to avoid service interruption.`
        };
        
      default:
        return {
          subject: 'Trial Update',
          html: '<p>Trial update</p>',
          text: 'Trial update'
        };
    }
  }
}
