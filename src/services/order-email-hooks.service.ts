import { OrdersTemplatesService, type OrderType } from './orders-templates.service.ts';
import type { Pool } from 'pg';

export interface OrderStatusChangeEvent {
  orderId: string;
  orderNumber: string;
  orderType: OrderType;
  previousStatus: string;
  newStatus: string;
  customerEmail: string;
  customerName?: string;
  orderData: any;
}

/**
 * Service to handle automatic email triggers when order status changes
 */
export class OrderEmailHooksService {
  private templatesService: OrdersTemplatesService;
  private db: Pool;

  constructor(db: Pool, mongoClient?: any) {
    this.db = db;
    this.templatesService = new OrdersTemplatesService(mongoClient);
  }

  /**
   * Main method to handle order status changes and trigger appropriate emails
   */
  async handleOrderStatusChange(event: OrderStatusChangeEvent): Promise<{
    success: boolean;
    emailSent: boolean;
    templateUsed?: string;
    error?: string;
  }> {
    try {
      console.log(`[order-email-hooks] Processing status change for order ${event.orderNumber}: ${event.previousStatus} → ${event.newStatus}`);

      // Check if we should send an email for this status change
      const shouldSendEmail = this.shouldSendEmailForStatus(event.orderType, event.newStatus);
      
      if (!shouldSendEmail) {
        console.log(`[order-email-hooks] No email template configured for ${event.orderType}:${event.newStatus}`);
        return { success: true, emailSent: false };
      }

      // Enrich order data with additional information from database
      const enrichedOrderData = await this.enrichOrderData(event.orderId, event.orderData);

      // Build template data
      const templateData = this.buildTemplateData(event, enrichedOrderData);

      // Send the email using the templates service
      const result = await this.templatesService.sendOrderEmail(
        event.orderType,
        event.newStatus,
        event.customerEmail,
        templateData
      );

      if (result.success) {
        console.log(`[order-email-hooks] ✅ Email sent for order ${event.orderNumber} using template ${result.templateUsed}`);
        
        // Log the email activity in the database
        await this.logEmailActivity(event.orderId, result.templateUsed!, event.customerEmail);
        
        return {
          success: true,
          emailSent: true,
          templateUsed: result.templateUsed
        };
      } else {
        console.error(`[order-email-hooks] ❌ Failed to send email for order ${event.orderNumber}: ${result.error}`);
        return {
          success: false,
          emailSent: false,
          error: result.error
        };
      }

    } catch (error: any) {
      console.error(`[order-email-hooks] ❌ Error processing order status change:`, error);
      return {
        success: false,
        emailSent: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Determine if an email should be sent for a specific order type and status
   */
  private shouldSendEmailForStatus(orderType: OrderType, status: string): boolean {
    const emailTriggerStatuses: Record<OrderType, string[]> = {
      'new_installation': [
        'pending',           // Order received
        'survey_scheduled',  // Site survey scheduled
        'ready_to_install',  // Ready for installation
        'in_progress',       // Installation in progress
        'activated',         // Service activated
        'completed'          // Installation complete
      ],
      'service_change': [
        'pending',           // Change request received
        'scheduled',         // Change scheduled
        'in_progress',       // Change in progress
        'completed'          // Change complete
      ],
      'disconnect': [
        'pending',           // Disconnect request received
        'scheduled',         // Disconnect scheduled
        'completed'          // Service disconnected
      ]
    };

    return emailTriggerStatuses[orderType]?.includes(status) || false;
  }

  /**
   * Enrich order data with additional information from the database
   */
  private async enrichOrderData(orderId: string, baseOrderData: any): Promise<any> {
    try {
      // Get comprehensive order information
      const orderQuery = `
        SELECT 
          o.*,
          c.first_name || ' ' || c.last_name as customer_name,
          c.email as customer_email,
          c.phone as customer_phone,
          c.address as customer_address
        FROM orders o
        LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = $1
      `;
      
      const orderResult = await this.db.query(orderQuery, [orderId]);
      const orderInfo = orderResult.rows[0] || {};

      // Get any scheduled appointments or technician assignments
      const appointmentQuery = `
        SELECT 
          scheduled_date,
          scheduled_time,
          technician_name,
          technician_phone,
          estimated_duration,
          special_instructions
        FROM order_appointments 
        WHERE order_id = $1 
        ORDER BY created_at DESC 
        LIMIT 1
      `;
      
      let appointmentInfo = {};
      try {
        const appointmentResult = await this.db.query(appointmentQuery, [orderId]);
        appointmentInfo = appointmentResult.rows[0] || {};
      } catch (e) {
        // Table might not exist, continue without appointment data
        console.log('[order-email-hooks] No appointment data available');
      }

      return {
        ...baseOrderData,
        ...orderInfo,
        ...appointmentInfo
      };

    } catch (error) {
      console.warn('[order-email-hooks] Failed to enrich order data:', error);
      return baseOrderData;
    }
  }

  /**
   * Build template data object from order event and enriched data
   */
  private buildTemplateData(event: OrderStatusChangeEvent, enrichedData: any): any {
    const now = new Date();
    
    return {
      // Basic order information
      orderId: event.orderId,
      orderNumber: event.orderNumber || enrichedData.order_number || event.orderId,
      customerName: event.customerName || enrichedData.customer_name || enrichedData.first_name || 'Valued Customer',
      customerEmail: event.customerEmail || enrichedData.customer_email,
      serviceType: enrichedData.service_type || enrichedData.package_name || 'Internet Service',
      
      // Address information
      address: enrichedData.installation_address || enrichedData.customer_address || enrichedData.address || '',
      
      // Contact information
      contactNumber: enrichedData.customer_phone || process.env.SUPPORT_PHONE || '+1 (555) 123-4567',
      supportNumber: process.env.SUPPORT_PHONE || '+1 (555) 987-6543',
      billingNumber: process.env.BILLING_PHONE || '+1 (555) 456-7890',
      
      // Appointment and scheduling
      installationDate: enrichedData.scheduled_date || enrichedData.installation_date || '',
      appointmentTime: enrichedData.scheduled_time || enrichedData.appointment_time || '',
      surveyDate: enrichedData.survey_date || '',
      surveyTime: enrichedData.survey_time || '',
      
      // Technician information
      technicianName: enrichedData.technician_name || 'Our Technical Team',
      technicianPhone: enrichedData.technician_phone || process.env.SUPPORT_PHONE || '',
      estimatedDuration: enrichedData.estimated_duration || '2-3 hours',
      
      // Service change specific
      currentService: enrichedData.current_service_type || enrichedData.current_service || '',
      previousService: enrichedData.previous_service_type || enrichedData.previous_service || '',
      changeType: this.getChangeTypeDescription(enrichedData),
      changeDate: enrichedData.change_date || enrichedData.scheduled_date || '',
      changeTime: enrichedData.change_time || enrichedData.scheduled_time || '',
      expectedDowntime: enrichedData.expected_downtime || '15-30 minutes',
      
      // Activation and completion
      activationDate: enrichedData.activation_date || now.toLocaleDateString(),
      completionDate: enrichedData.completion_date || now.toLocaleDateString(),
      wifiNetwork: enrichedData.wifi_network || enrichedData.network_name || '',
      
      // Performance metrics
      downloadSpeed: enrichedData.download_speed || this.getSpeedFromServiceType(enrichedData.service_type, 'download'),
      uploadSpeed: enrichedData.upload_speed || this.getSpeedFromServiceType(enrichedData.service_type, 'upload'),
      latency: enrichedData.latency || '< 10ms',
      testTime: enrichedData.test_time || now.toLocaleString(),
      
      // Features and benefits
      newFeature1: this.getServiceFeature(enrichedData.service_type, 1),
      newFeature2: this.getServiceFeature(enrichedData.service_type, 2),
      newFeature3: this.getServiceFeature(enrichedData.service_type, 3),
      
      // Company information
      customerPortalUrl: process.env.CUSTOMER_PORTAL_URL || 'https://portal.example.com',
      mobileAppName: process.env.MOBILE_APP_NAME || 'MyISP App',
      
      // Instructions and notes
      specialInstructions: enrichedData.special_instructions || '',
      
      // Dates for display
      currentDate: now.toLocaleDateString(),
      currentTime: now.toLocaleTimeString()
    };
  }

  /**
   * Get a user-friendly description of the service change type
   */
  private getChangeTypeDescription(orderData: any): string {
    if (orderData.change_type) return orderData.change_type;
    
    const currentSpeed = this.extractSpeedFromService(orderData.current_service_type);
    const newSpeed = this.extractSpeedFromService(orderData.service_type);
    
    if (currentSpeed && newSpeed) {
      if (newSpeed > currentSpeed) return 'Speed Upgrade';
      if (newSpeed < currentSpeed) return 'Speed Downgrade';
    }
    
    return 'Service Modification';
  }

  /**
   * Extract speed value from service type string
   */
  private extractSpeedFromService(serviceType?: string): number | null {
    if (!serviceType) return null;
    const match = serviceType.match(/(\d+)\s*mbps/i);
    return match ? parseInt(match[1]) : null;
  }

  /**
   * Get expected speed based on service type
   */
  private getSpeedFromServiceType(serviceType?: string, direction: 'download' | 'upload' = 'download'): string {
    if (!serviceType) return '';
    
    const speed = this.extractSpeedFromService(serviceType);
    if (!speed) return '';
    
    if (direction === 'upload') {
      // Typically upload is 10-20% of download speed for residential
      const uploadSpeed = Math.round(speed * 0.1);
      return `${uploadSpeed} Mbps`;
    }
    
    return `${speed} Mbps`;
  }

  /**
   * Get service feature descriptions
   */
  private getServiceFeature(serviceType?: string, featureIndex: number = 1): string {
    const features = [
      'Enhanced speed and reliability',
      'Priority customer support',
      'Advanced security features',
      'No data caps or throttling',
      'Free equipment upgrade',
      'Improved Wi-Fi coverage'
    ];
    
    // Customize based on service type if needed
    if (serviceType?.toLowerCase().includes('fiber')) {
      features[0] = 'Ultra-fast fiber connectivity';
      features[1] = 'Symmetrical upload/download speeds';
    }
    
    return features[featureIndex - 1] || features[0];
  }

  /**
   * Log email activity to the database for tracking
   */
  private async logEmailActivity(orderId: string, templateKey: string, recipientEmail: string): Promise<void> {
    try {
      const logQuery = `
        INSERT INTO order_email_log (
          order_id, 
          template_key, 
          recipient_email, 
          sent_at, 
          status
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `;
      
      await this.db.query(logQuery, [
        orderId,
        templateKey,
        recipientEmail,
        new Date(),
        'sent'
      ]);
    } catch (error) {
      // Don't fail the main process if logging fails
      console.warn('[order-email-hooks] Failed to log email activity:', error);
    }
  }

  /**
   * Initialize the service and ensure database tables exist
   */
  async initialize(): Promise<void> {
    try {
      // Create email log table if it doesn't exist
      const createTableQuery = `
        CREATE TABLE IF NOT EXISTS order_email_log (
          id SERIAL PRIMARY KEY,
          order_id UUID NOT NULL,
          template_key VARCHAR(255) NOT NULL,
          recipient_email VARCHAR(255) NOT NULL,
          sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          status VARCHAR(50) DEFAULT 'sent',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(order_id, template_key, recipient_email)
        );
        
        CREATE INDEX IF NOT EXISTS idx_order_email_log_order_id ON order_email_log(order_id);
        CREATE INDEX IF NOT EXISTS idx_order_email_log_sent_at ON order_email_log(sent_at);
      `;
      
      await this.db.query(createTableQuery);
      
      // Initialize templates service
      await this.templatesService.ensureIndexes();
      
      console.log('[order-email-hooks] ✅ Service initialized successfully');
    } catch (error) {
      console.error('[order-email-hooks] ❌ Failed to initialize service:', error);
      throw error;
    }
  }
}

// Export a helper function to easily trigger emails from other services
export async function triggerOrderStatusEmail(
  db: Pool,
  mongoClient: any,
  event: OrderStatusChangeEvent
): Promise<{ success: boolean; emailSent: boolean; templateUsed?: string; error?: string }> {
  const service = new OrderEmailHooksService(db, mongoClient);
  return await service.handleOrderStatusChange(event);
}
