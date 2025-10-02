import { mongoClient, mongodb } from '../Database/main.ts';
import type { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { NotificationService } from './notification.service.ts';

export type OrderType = 'new_installation' | 'service_change' | 'disconnect';

export interface OrderEmailTemplate {
  _id?: any;
  key: string; // Unique identifier like "new_installation_confirmed"
  orderType: OrderType;
  triggerStatus: string; // Order status that triggers this email
  subject: string; // Email subject with template variables
  html: string; // HTML email body with template variables
  text: string; // Plain text email body with template variables
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TemplateData {
  customerName?: string;
  customerEmail?: string;
  orderNumber?: string;
  orderId?: string;
  installationDate?: string;
  serviceType?: string;
  address?: string;
  contactNumber?: string;
  technicianName?: string;
  appointmentTime?: string;
  estimatedDuration?: string;
  specialInstructions?: string;
  [key: string]: any; // Allow additional dynamic fields
}

export class OrdersTemplatesService {
  private mongo: MongoClient | null = null;
  private db: Db;
  private templates!: Collection<OrderEmailTemplate>;
  private notificationService: NotificationService;

  constructor(mongoOrDb?: MongoClient | Db) {
    // Accept either a MongoClient or a Db for flexibility
    const fallbackClient = mongoClient as unknown as MongoClient | undefined;
    const fallbackDb = mongodb as unknown as Db | undefined;

    if (mongoOrDb && typeof (mongoOrDb as any).db === 'function') {
      // It's a MongoClient
      this.mongo = mongoOrDb as MongoClient;
      this.db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    } else if (mongoOrDb && typeof (mongoOrDb as any).collection === 'function') {
      // It's a Db
      this.db = mongoOrDb as Db;
    } else if (fallbackClient) {
      this.mongo = fallbackClient;
      this.db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    } else if (fallbackDb) {
      this.db = fallbackDb;
    } else {
      throw new Error('MongoDB connection required for OrdersTemplatesService');
    }

    this.templates = this.db.collection<OrderEmailTemplate>('order_email_templates');
    this.notificationService = new NotificationService(this.db);
  }

  async ensureIndexes(): Promise<void> {
    try {
      await this.templates.createIndex({ key: 1 }, { unique: true });
      await this.templates.createIndex({ orderType: 1, triggerStatus: 1 });
      await this.templates.createIndex({ isActive: 1 });
      console.log('[orders-templates] ✅ Indexes created');
    } catch (error) {
      console.warn('[orders-templates] ⚠️ Index creation failed:', error);
    }
  }

  async getTemplates(filters?: {
    orderType?: OrderType;
    triggerStatus?: string;
    isActive?: boolean;
  }): Promise<OrderEmailTemplate[]> {
    const query: any = {};
    
    if (filters?.orderType) query.orderType = filters.orderType;
    if (filters?.triggerStatus) query.triggerStatus = filters.triggerStatus;
    if (filters?.isActive !== undefined) query.isActive = filters.isActive;

    return this.templates.find(query).sort({ orderType: 1, triggerStatus: 1 }).toArray();
  }

  async getTemplate(id: string): Promise<OrderEmailTemplate | null> {
    try {
      if (!mongodb) throw new Error('MongoDB not available');
      const { ObjectId } = await import('mongodb');
      return await this.templates.findOne({ _id: new ObjectId(id) });
    } catch (error) {
      // Try finding by key if ObjectId fails
      return await this.templates.findOne({ key: id });
    }
  }

  async getTemplateByKey(key: string): Promise<OrderEmailTemplate | null> {
    return await this.templates.findOne({ key });
  }

  async findTemplateForOrder(orderType: OrderType, status: string): Promise<OrderEmailTemplate | null> {
    return await this.templates.findOne({
      orderType,
      triggerStatus: status,
      isActive: true
    });
  }

  async createTemplate(template: Omit<OrderEmailTemplate, '_id' | 'createdAt' | 'updatedAt'>): Promise<{ id: any }> {
    const now = new Date();
    const doc: OrderEmailTemplate = {
      ...template,
      createdAt: now,
      updatedAt: now
    };

    const result = await this.templates.insertOne(doc as any);
    return { id: result.insertedId };
  }

  async updateTemplate(id: string, updates: Partial<Omit<OrderEmailTemplate, '_id' | 'createdAt'>>): Promise<boolean> {
    try {
      if (!mongodb) throw new Error('MongoDB not available');
      const { ObjectId } = await import('mongodb');
      const result = await this.templates.updateOne(
        { _id: new ObjectId(id) },
        { 
          $set: { 
            ...updates, 
            updatedAt: new Date() 
          } 
        }
      );
      return result.modifiedCount > 0;
    } catch (error) {
      // Try updating by key if ObjectId fails
      const result = await this.templates.updateOne(
        { key: id },
        { 
          $set: { 
            ...updates, 
            updatedAt: new Date() 
          } 
        }
      );
      return result.modifiedCount > 0;
    }
  }

  async deleteTemplate(id: string): Promise<boolean> {
    try {
      if (!mongodb) throw new Error('MongoDB not available');
      const { ObjectId } = await import('mongodb');
      const result = await this.templates.deleteOne({ _id: new ObjectId(id) });
      return result.deletedCount > 0;
    } catch (error) {
      // Try deleting by key if ObjectId fails
      const result = await this.templates.deleteOne({ key: id });
      return result.deletedCount > 0;
    }
  }

  private renderTemplate(template: string, data: TemplateData): string {
    let rendered = template;
    
    // Replace {{variable}} placeholders with actual data
    Object.entries(data).forEach(([key, value]) => {
      const placeholder = new RegExp(`{{${key}}}`, 'g');
      rendered = rendered.replace(placeholder, String(value || ''));
    });

    // Clean up any remaining unreplaced placeholders
    rendered = rendered.replace(/{{[^}]+}}/g, '');
    
    return rendered;
  }

  async sendOrderEmail(
    orderType: OrderType,
    status: string,
    customerEmail: string,
    templateData: TemplateData
  ): Promise<{ success: boolean; templateUsed?: string; error?: string }> {
    try {
      console.log(`[orders-templates] 🔍 Looking for template: ${orderType}:${status}`);
      
      // Find the appropriate template
      const template = await this.findTemplateForOrder(orderType, status);
      
      if (!template) {
        console.warn(`[orders-templates] ❌ No template found for ${orderType}:${status}`);
        // List available templates for debugging
        const allTemplates = await this.getTemplates();
        console.log(`[orders-templates] 📋 Available templates:`, allTemplates.map(t => `${t.orderType}:${t.triggerStatus} (${t.key})`));
        return { 
          success: false, 
          error: `No active template found for order type '${orderType}' and status '${status}'` 
        };
      }

      console.log(`[orders-templates] ✅ Found template: ${template.key}`);

      // Render the template with provided data
      const renderedSubject = this.renderTemplate(template.subject, templateData);
      const renderedHtml = this.renderTemplate(template.html, templateData);
      const renderedText = this.renderTemplate(template.text, templateData);

      // Send the email directly using NotificationService
      const emailSent = await this.notificationService.send({
        to: customerEmail,
        subject: renderedSubject,
        html: renderedHtml,
        text: renderedText
      });

      if (emailSent) {
        console.log(`[orders-templates] ✅ Email sent to ${customerEmail} using template ${template.key}`);
        return { success: true, templateUsed: template.key };
      } else {
        console.error(`[orders-templates] ❌ Failed to send email to ${customerEmail}`);
        return { success: false, error: 'Email delivery failed' };
      }

    } catch (error) {
      console.error('[orders-templates] ❌ Error sending order email:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  async previewTemplate(id: string, data: TemplateData): Promise<{
    subject: string;
    html: string;
    text: string;
  } | null> {
    const template = await this.getTemplate(id);
    if (!template) return null;

    return {
      subject: this.renderTemplate(template.subject, data),
      html: this.renderTemplate(template.html, data),
      text: this.renderTemplate(template.text, data)
    };
  }

  async seedDefaultTemplates(): Promise<{ created: number; skipped: number }> {
    const defaultTemplates: Omit<OrderEmailTemplate, '_id' | 'createdAt' | 'updatedAt'>[] = [
      // NEW INSTALLATION TEMPLATES - Simplified 2-email workflow
      {
        key: 'new_installation_scheduled',
        orderType: 'new_installation',
        triggerStatus: 'scheduled',
        subject: 'Installation Scheduled - {{orderNumber}}',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Installation Scheduled!</h1>
              <p style="color: #e8f0fe; margin: 10px 0 0 0; font-size: 16px;">Your fiber installation appointment is confirmed</p>
            </div>
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Hello {{customerName}},</p>
              <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">
                Great news! Your fiber internet installation has been scheduled. Our certified technician will visit your location to set up your high-speed connection.
              </p>
              
              <div style="background: #e8f5e8; border-left: 4px solid #28a745; padding: 25px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 15px 0; color: #155724; font-size: 18px;">📅 Installation Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Order Number:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{orderNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Service Package:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{serviceType}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Installation Date:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{installationDate}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Time Window:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{appointmentTime}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Installation Address:</td><td style="padding: 8px 0; color: #155724;">{{address}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Technician:</td><td style="padding: 8px 0; color: #155724;">{{technicianName}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Duration:</td><td style="padding: 8px 0; color: #155724;">{{estimatedDuration}}</td></tr>
                </table>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 16px;">📋 What to expect:</h3>
                <ul style="color: #856404; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Fiber cable installation from street to your property</li>
                  <li>Indoor equipment setup and Wi-Fi configuration</li>
                  <li>Speed testing and service activation</li>
                  <li>Brief orientation on your new service</li>
                </ul>
              </div>

              <div style="background: #f0f8ff; border: 1px solid #b3d9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 10px 0; color: #0056b3; font-size: 16px;">⚠️ Important reminders:</h3>
                <ul style="color: #0056b3; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Please ensure someone 18+ is present during installation</li>
                  <li>Clear access to installation areas</li>
                  <li>Our technician will call 30 minutes before arrival</li>
                  <li>Have electrical outlets available near installation points</li>
                </ul>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <p style="color: #888; font-size: 14px;">Questions or need to reschedule?</p>
                <p style="color: #667eea; font-weight: bold; font-size: 18px;">{{contactNumber}}</p>
              </div>
            </div>
          </div>
        `,
        text: `Hello {{customerName}}, your fiber installation is scheduled for {{installationDate}} at {{appointmentTime}}. Order: {{orderNumber}}. Service: {{serviceType}}. Technician: {{technicianName}}. Duration: {{estimatedDuration}}. Please ensure someone 18+ is present. We'll call 30 minutes before arrival. Contact: {{contactNumber}}`,
        isActive: true
      },
      {
        key: 'new_installation_completed',
        orderType: 'new_installation',
        triggerStatus: 'completed',
        subject: 'Welcome to High-Speed Fiber! - {{orderNumber}}',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 40px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 32px;">🎉 Welcome to Fiber!</h1>
              <p style="color: #e8f8ff; margin: 15px 0 0 0; font-size: 18px;">Your high-speed internet is now LIVE!</p>
            </div>
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Congratulations {{customerName}}!</p>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 25px; font-size: 16px;">
                Your fiber internet installation is complete and your service is now <strong style="color: #28a745;">ACTIVE</strong>! Welcome to lightning-fast, reliable internet that will transform your digital experience.
              </p>

              <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 25px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 15px 0; color: #155724; font-size: 18px;">✅ Your Active Service</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Order Number:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{orderNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Service Package:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{serviceType}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Service Address:</td><td style="padding: 8px 0; color: #155724;">{{address}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Activation Date:</td><td style="padding: 8px 0; color: #155724;">{{activationDate}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Wi-Fi Network:</td><td style="padding: 8px 0; color: #155724;">{{wifiNetwork}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Download Speed:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{downloadSpeed}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Upload Speed:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{uploadSpeed}}</td></tr>
                </table>
              </div>

              <div style="background: #f0f8ff; border: 1px solid #b3d9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #0056b3; font-size: 16px;">🚀 Getting Started:</h3>
                <ul style="color: #0056b3; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Test your connection on all devices</li>
                  <li>Download our mobile app for account management</li>
                  <li>Set up parental controls if needed</li>
                  <li>Register for paperless billing and autopay</li>
                  <li>Explore our customer portal for service management</li>
                </ul>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 16px;">📞 Support & Resources:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">24/7 Technical Support:</td><td style="padding: 8px 0; color: #856404; font-weight: bold;">{{supportNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">Customer Portal:</td><td style="padding: 8px 0; color: #856404;">{{customerPortalUrl}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">Mobile App:</td><td style="padding: 8px 0; color: #856404;">{{mobileAppName}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">Billing Inquiries:</td><td style="padding: 8px 0; color: #856404;">{{billingNumber}}</td></tr>
                </table>
              </div>

              <div style="text-align: center; background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Thank you for choosing us!</h3>
                <p style="color: #666; margin: 0; font-size: 16px;">Experience the difference of true high-speed fiber internet.</p>
              </div>
            </div>
          </div>
        `,
        text: `Congratulations {{customerName}}! Your fiber internet service {{serviceType}} is now ACTIVE at {{address}}. Order: {{orderNumber}}. Wi-Fi: {{wifiNetwork}}. Speeds: {{downloadSpeed}} down, {{uploadSpeed}} up. Support: {{supportNumber}}. Welcome to high-speed fiber!`,
        isActive: true
      },

      // SERVICE CHANGE TEMPLATES - Simplified 2-email workflow
      {
        key: 'service_change_scheduled',
        orderType: 'service_change',
        triggerStatus: 'scheduled',
        subject: 'Service Change Scheduled - {{orderNumber}}',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 28px;">Service Change Scheduled</h1>
              <p style="color: #e8f0fe; margin: 10px 0 0 0; font-size: 16px;">Your service upgrade is confirmed</p>
            </div>
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Hello {{customerName}},</p>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">
                Great news! Your service change request has been scheduled. Our technician will visit to upgrade your internet service to the new package you've selected.
              </p>

              <div style="background: #e8f5e8; border-left: 4px solid #28a745; padding: 25px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 15px 0; color: #155724; font-size: 18px;">📅 Service Change Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Order Number:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{orderNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Current Service:</td><td style="padding: 8px 0; color: #155724;">{{currentService}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">New Service:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{serviceType}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Scheduled Date:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{changeDate}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Time Window:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{appointmentTime}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Technician:</td><td style="padding: 8px 0; color: #155724;">{{technicianName}}</td></tr>
                </table>
              </div>

              <div style="background: #f0f8ff; border: 1px solid #b3d9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #0056b3; font-size: 16px;">🔧 What to expect:</h3>
                <ul style="color: #0056b3; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Equipment configuration update</li>
                  <li>Speed and service testing</li>
                  <li>Brief service interruption (typically 15-30 minutes)</li>
                  <li>Confirmation of new service activation</li>
                </ul>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 10px 0; color: #856404; font-size: 16px;">⚠️ Important notes:</h3>
                <ul style="color: #856404; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Please ensure someone 18+ is available during the appointment</li>
                  <li>Our technician will call 30 minutes before arrival</li>
                  <li>Brief internet interruption expected during the change</li>
                  <li>New billing will start from the change date</li>
                </ul>
              </div>

              <div style="text-align: center; margin: 30px 0;">
                <p style="color: #888; font-size: 14px;">Questions or need to reschedule?</p>
                <p style="color: #667eea; font-weight: bold; font-size: 18px;">{{contactNumber}}</p>
              </div>
            </div>
          </div>
        `,
        text: `Hello {{customerName}}, your service change is scheduled for {{changeDate}} at {{appointmentTime}}. Upgrading from {{currentService}} to {{serviceType}}. Order: {{orderNumber}}. Technician: {{technicianName}}. Brief interruption expected. Contact: {{contactNumber}}`,
        isActive: true
      },
      {
        key: 'service_change_completed',
        orderType: 'service_change',
        triggerStatus: 'completed',
        subject: 'Service Change Complete - {{orderNumber}}',
        html: `
          <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff;">
            <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); padding: 40px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 32px;">✅ Service Change Complete!</h1>
              <p style="color: #e8f8ff; margin: 15px 0 0 0; font-size: 18px;">Your upgraded service is now active</p>
            </div>
            <div style="padding: 30px;">
              <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Congratulations {{customerName}}!</p>
              
              <p style="color: #555; line-height: 1.6; margin-bottom: 25px; font-size: 16px;">
                Perfect! Your service change has been completed successfully. Your upgraded internet service is now <strong style="color: #28a745;">ACTIVE</strong> and ready to deliver enhanced performance for all your online activities.
              </p>

              <div style="background: #d4edda; border-left: 4px solid #28a745; padding: 25px; margin: 25px 0; border-radius: 0 8px 8px 0;">
                <h3 style="margin: 0 0 15px 0; color: #155724; font-size: 18px;">✅ Your Updated Service</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Order Number:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{orderNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Previous Service:</td><td style="padding: 8px 0; color: #155724;">{{previousService}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">New Service:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{serviceType}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Service Address:</td><td style="padding: 8px 0; color: #155724;">{{address}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">Completion Date:</td><td style="padding: 8px 0; color: #155724;">{{completionDate}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">New Download Speed:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{downloadSpeed}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #155724; font-weight: 500;">New Upload Speed:</td><td style="padding: 8px 0; color: #155724; font-weight: bold;">{{uploadSpeed}}</td></tr>
                </table>
              </div>

              <div style="background: #f0f8ff; border: 1px solid #b3d9ff; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #0056b3; font-size: 16px;">🚀 What's new with your service:</h3>
                <ul style="color: #0056b3; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                  <li>Enhanced internet speeds for faster browsing and streaming</li>
                  <li>Improved bandwidth for multiple device usage</li>
                  <li>Better performance for video calls and online gaming</li>
                  <li>Updated billing reflects your new service package</li>
                </ul>
              </div>

              <div style="background: #fff3cd; border: 1px solid #ffeaa7; padding: 20px; border-radius: 8px; margin: 25px 0;">
                <h3 style="margin: 0 0 15px 0; color: #856404; font-size: 16px;">📞 Support & Resources:</h3>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">24/7 Technical Support:</td><td style="padding: 8px 0; color: #856404; font-weight: bold;">{{supportNumber}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">Customer Portal:</td><td style="padding: 8px 0; color: #856404;">{{customerPortalUrl}}</td></tr>
                  <tr><td style="padding: 8px 0; color: #856404; font-weight: 500;">Billing Inquiries:</td><td style="padding: 8px 0; color: #856404;">{{billingNumber}}</td></tr>
                </table>
              </div>

              <div style="text-align: center; background: #f8f9fa; padding: 25px; border-radius: 8px; margin: 25px 0;">
                <h3 style="color: #333; margin: 0 0 15px 0;">Thank you for your continued trust!</h3>
                <p style="color: #666; margin: 0; font-size: 16px;">We're committed to providing you with the best internet experience.</p>
              </div>
            </div>
          </div>
        `,
        text: `Great news {{customerName}}! Your service change {{orderNumber}} is complete. Updated from {{previousService}} to {{serviceType}}. New speeds: {{downloadSpeed}} down, {{uploadSpeed}} up. Completed: {{completionDate}}. Support: {{supportNumber}}`,
        isActive: true
      }
    ];

    let created = 0;
    let skipped = 0;

    for (const template of defaultTemplates) {
      try {
        const existing = await this.getTemplateByKey(template.key);
        if (existing) {
          skipped++;
          continue;
        }

        await this.createTemplate(template);
        created++;
      } catch (error) {
        console.error(`Error seeding template ${template.key}:`, error);
      }
    }

    return { created, skipped };
  }
}