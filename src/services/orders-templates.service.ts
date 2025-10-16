import { mongoClient, mongodb } from '../Database/main.ts';
import type { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import { NotificationService } from './notification.service.ts';

export type OrderType = 'new_installation' | 'service_change' | 'disconnect';

export interface OrderEmailTemplate {
  _id?: any;
  key: string; // Unique identifier like "new_installation_confirmed"
  orderType: OrderType;
  triggerStatus: string; // Order status that triggers this email
  serviceType?: string; // Optional service type (fiber, wireless, etc.)
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

  async findTemplateForOrder(orderType: OrderType, status: string, serviceType?: string): Promise<OrderEmailTemplate | null> {
    // First try to find a service-specific template
    if (serviceType) {
      const serviceSpecificTemplate = await this.templates.findOne({
        orderType,
        triggerStatus: status,
        serviceType: serviceType.toLowerCase(),
        isActive: true
      });
      
      if (serviceSpecificTemplate) {
        console.log(`[orders-templates] ✅ Found service-specific template for ${serviceType}:${status}`);
        return serviceSpecificTemplate;
      }
    }
    
    // Fall back to generic template
    const genericTemplate = await this.templates.findOne({
      orderType,
      triggerStatus: status,
      isActive: true
    });
    
    if (genericTemplate) {
      return genericTemplate;
    }
    
    // Fallback to hardcoded trial templates if no database template found
    const fallbackTemplate = this.getFallbackTrialTemplate(orderType, status, serviceType);
    if (fallbackTemplate) {
      console.log(`[orders-templates] 🔄 Using fallback template for ${orderType}:${status}`);
      return fallbackTemplate;
    }
    
    return null;
  }

  private getFallbackTrialTemplate(orderType: OrderType, status: string, serviceType?: string): OrderEmailTemplate | null {
    // Only provide fallbacks for trial states
    if (!status.startsWith('trial_')) {
      return null;
    }

    const isFiber = serviceType?.toLowerCase() === 'fiber' || serviceType?.toLowerCase() === 'trial';
    const isWireless = serviceType?.toLowerCase() === 'wireless';

    const templates: Record<string, OrderEmailTemplate> = {
      'trial_order_created': {
        key: `fallback_${orderType}_${status}`,
        orderType,
        triggerStatus: status,
        serviceType: serviceType || 'fiber',
        subject: isWireless ? 'Your Wireless Trial Order is Confirmed - {{customerName}}' : 'Your Fiber Trial Order is Confirmed - {{customerName}}',
        html: isWireless ? `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #7c3aed;">📡 Welcome to Your Wireless Trial!</h2>
            <p>Hi {{customerName}},</p>
            <p>Your wireless internet trial order has been confirmed and is being processed.</p>
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Service Type:</strong> Wireless Internet</p>
              <p><strong>Address:</strong> {{address}}</p>
              <p><strong>Trial Duration:</strong> 30 days</p>
            </div>
            <p>Your wireless device will be shipped to your address within 1-2 business days.</p>
            <p>You'll receive tracking information once your device ships.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        ` : `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">🎉 Welcome to Your Fiber Trial!</h2>
            <p>Hi {{customerName}},</p>
            <p>Your fiber internet trial order has been confirmed and is being processed.</p>
            <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Service Type:</strong> Fiber Internet</p>
              <p><strong>Address:</strong> {{address}}</p>
              <p><strong>Trial Duration:</strong> 30 days</p>
            </div>
            <p>Our team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.</p>
            <p>You'll receive updates as we progress through the setup process.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        `,
        text: isWireless ? 
          `Welcome to Your Wireless Trial!\n\nHi {{customerName}},\n\nYour wireless internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nAddress: {{address}}\nTrial Duration: 30 days\n\nYour wireless device will be shipped to your address within 1-2 business days.\n\nYou'll receive tracking information once your device ships.\n\nBest regards,\nThe Team` :
          `Welcome to Your Fiber Trial!\n\nHi {{customerName}},\n\nYour fiber internet trial order has been confirmed and is being processed.\n\nOrder Number: {{orderNumber}}\nService Type: Fiber Internet\nAddress: {{address}}\nTrial Duration: 30 days\n\nOur team will contact the Fiber Network Operator (FNO) to provision your fiber line. This process typically takes 3-5 business days.\n\nYou'll receive updates as we progress through the setup process.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      'trial_fno_provisioning': {
        key: `fallback_${orderType}_${status}`,
        orderType,
        triggerStatus: status,
        serviceType: 'fiber',
        subject: 'Fiber Line Application Submitted - {{customerName}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #2563eb;">🔧 Fiber Line Application Submitted</h2>
            <p>Hi {{customerName}},</p>
            <p>Great news! We've submitted your fiber line application to the network operator.</p>
            <div style="background: #f0f9ff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #2563eb;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Status:</strong> FNO Provisioning in Progress</p>
              <p><strong>Expected Timeline:</strong> 3-5 business days</p>
            </div>
            <p>What happens next:</p>
            <ul>
              <li>FNO reviews your application</li>
              <li>Fiber line is provisioned to your address</li>
              <li>We schedule your installation appointment</li>
            </ul>
            <p>We'll keep you updated on the progress!</p>
            <p>Best regards,<br>The Team</p>
          </div>
        `,
        text: `Fiber Line Application Submitted\n\nHi {{customerName}},\n\nGreat news! We've submitted your fiber line application to the network operator.\n\nOrder Number: {{orderNumber}}\nStatus: FNO Provisioning in Progress\nExpected Timeline: 3-5 business days\n\nWhat happens next:\n- FNO reviews your application\n- Fiber line is provisioned to your address\n- We schedule your installation appointment\n\nWe'll keep you updated on the progress!\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      'trial_installation_scheduled': {
        key: `fallback_${orderType}_${status}`,
        orderType,
        triggerStatus: status,
        serviceType: 'fiber',
        subject: 'Installation Appointment Confirmed - {{customerName}}',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a;">✅ Installation Appointment Confirmed</h2>
            <p>Hi {{customerName}},</p>
            <p>Your fiber installation appointment has been confirmed!</p>
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Installation Date:</strong> {{appointmentDate}}</p>
              <p><strong>Time Slot:</strong> {{appointmentTime}}</p>
              <p><strong>Technician:</strong> {{technicianName}}</p>
            </div>
            <p><strong>What to expect:</strong></p>
            <ul>
              <li>Professional technician will arrive at scheduled time</li>
              <li>Fiber line will be connected to your premises</li>
              <li>Service will be tested and activated</li>
              <li>You'll receive your trial login credentials</li>
            </ul>
            <p>Please ensure someone is available at the property during the appointment.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        `,
        text: `Installation Appointment Confirmed\n\nHi {{customerName}},\n\nYour fiber installation appointment has been confirmed!\n\nOrder Number: {{orderNumber}}\nInstallation Date: {{appointmentDate}}\nTime Slot: {{appointmentTime}}\nTechnician: {{technicianName}}\n\nWhat to expect:\n- Professional technician will arrive at scheduled time\n- Fiber line will be connected to your premises\n- Service will be tested and activated\n- You'll receive your trial login credentials\n\nPlease ensure someone is available at the property during the appointment.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      },
        'trial_device_shipping': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: 'wireless',
          subject: 'Your Wireless Device is Being Shipped - {{customerName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7c3aed;">📦 Your Wireless Device is Being Shipped!</h2>
              <p>Hi {{customerName}},</p>
              <p>Great news! Your wireless internet device has been prepared and is now being shipped to your address.</p>
              <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Wireless Internet</p>
                <p><strong>Shipping Address:</strong> {{address}}</p>
                <p><strong>Expected Delivery:</strong> 1-2 business days</p>
              </div>
              <p><strong>What happens next:</strong></p>
              <ul>
                <li>You'll receive tracking information via SMS/email</li>
                <li>Device will be delivered to your address</li>
                <li>Follow the self-installation guide included</li>
                <li>Contact us if you need assistance</li>
              </ul>
              <p>We'll notify you once your device is delivered!</p>
              <p>Best regards,<br>The Team</p>
            </div>
          `,
          text: `Your Wireless Device is Being Shipped!\n\nHi {{customerName}},\n\nGreat news! Your wireless internet device has been prepared and is now being shipped to your address.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nShipping Address: {{address}}\nExpected Delivery: 1-2 business days\n\nWhat happens next:\n- You'll receive tracking information via SMS/email\n- Device will be delivered to your address\n- Follow the self-installation guide included\n- Contact us if you need assistance\n\nWe'll notify you once your device is delivered!\n\nBest regards,\nThe Team`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        'trial_device_delivered': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: 'wireless',
          subject: 'Your Wireless Device Has Been Delivered - {{customerName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #16a34a;">📦 Your Wireless Device Has Been Delivered!</h2>
              <p>Hi {{customerName}},</p>
              <p>Great news! Your wireless internet device has been successfully delivered to your address.</p>
              <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Wireless Internet</p>
                <p><strong>Delivery Address:</strong> {{address}}</p>
                <p><strong>Delivery Status:</strong> Delivered</p>
              </div>
              <p><strong>Next Steps - Self Installation:</strong></p>
              <ol>
                <li>Unpack your wireless device and accessories</li>
                <li>Follow the installation guide included in the package</li>
                <li>Connect the device to power and position it near a window</li>
                <li>Use the provided credentials to connect to your trial network</li>
                <li>Test your internet connection</li>
              </ol>
              <p><strong>Need Help?</strong> Contact our support team if you encounter any issues during setup.</p>
              <p>Your 30-day trial period starts now!</p>
              <p>Best regards,<br>The Team</p>
            </div>
          `,
          text: `Your Wireless Device Has Been Delivered!\n\nHi {{customerName}},\n\nGreat news! Your wireless internet device has been successfully delivered to your address.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nDelivery Address: {{address}}\nDelivery Status: Delivered\n\nNext Steps - Self Installation:\n1. Unpack your wireless device and accessories\n2. Follow the installation guide included in the package\n3. Connect the device to power and position it near a window\n4. Use the provided credentials to connect to your trial network\n5. Test your internet connection\n\nNeed Help? Contact our support team if you encounter any issues during setup.\n\nYour 30-day trial period starts now!\n\nBest regards,\nThe Team`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        'trial_self_install': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: 'wireless',
          subject: 'Ready for Self-Installation - {{customerName}}',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #7c3aed;">🔧 Ready for Self-Installation!</h2>
              <p>Hi {{customerName}},</p>
              <p>Your wireless device is ready for self-installation. Follow these simple steps to get your trial internet up and running.</p>
              <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Wireless Internet</p>
                <p><strong>Installation Type:</strong> Self-Installation</p>
                <p><strong>Estimated Setup Time:</strong> 15-30 minutes</p>
              </div>
              <p><strong>Installation Steps:</strong></p>
              <ol>
                <li><strong>Unpack:</strong> Remove device and all accessories from packaging</li>
                <li><strong>Position:</strong> Place device near a window for best signal</li>
                <li><strong>Power On:</strong> Connect power adapter and turn on device</li>
                <li><strong>Connect:</strong> Use provided WiFi credentials to connect</li>
                <li><strong>Test:</strong> Visit a website to verify internet connection</li>
              </ol>
              <p><strong>Support Available:</strong> If you need help, our technical support team is standing by!</p>
              <p>Once connected, your 30-day trial will be active!</p>
              <p>Best regards,<br>The Team</p>
            </div>
          `,
          text: `Ready for Self-Installation!\n\nHi {{customerName}},\n\nYour wireless device is ready for self-installation. Follow these simple steps to get your trial internet up and running.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nInstallation Type: Self-Installation\nEstimated Setup Time: 15-30 minutes\n\nInstallation Steps:\n1. Unpack: Remove device and all accessories from packaging\n2. Position: Place device near a window for best signal\n3. Power On: Connect power adapter and turn on device\n4. Connect: Use provided WiFi credentials to connect\n5. Test: Visit a website to verify internet connection\n\nSupport Available: If you need help, our technical support team is standing by!\n\nOnce connected, your 30-day trial will be active!\n\nBest regards,\nThe Team`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        'trial_engaged': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: serviceType || 'fiber',
          subject: isWireless ? 'Your Wireless Trial is Going Great! - {{customerName}}' : 'Your Fiber Trial is Going Great! - {{customerName}}',
          html: isWireless ? `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #16a34a;">🎉 Your Wireless Trial is Going Great!</h2>
              <p>Hi {{customerName}},</p>
              <p>We're thrilled to see you're actively using your wireless internet trial! Your engagement shows you're enjoying the service.</p>
              <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Wireless Internet</p>
                <p><strong>Engagement Level:</strong> High</p>
                <p><strong>Trial Status:</strong> Active & Engaged</p>
              </div>
              <p><strong>What this means:</strong></p>
              <ul>
                <li>You're actively using your wireless internet</li>
                <li>Your trial is progressing well</li>
                <li>You're on track for a successful conversion</li>
                <li>We're here to support your internet needs</li>
              </ul>
              <p>Keep enjoying your trial! If you have any questions, don't hesitate to reach out.</p>
              <p>Best regards,<br>The Team</p>
            </div>
          ` : `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #16a34a;">🎉 Your Fiber Trial is Going Great!</h2>
              <p>Hi {{customerName}},</p>
              <p>We're thrilled to see you're actively using your fiber internet trial! Your engagement shows you're enjoying the service.</p>
              <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Fiber Internet</p>
                <p><strong>Engagement Level:</strong> High</p>
                <p><strong>Trial Status:</strong> Active & Engaged</p>
              </div>
              <p><strong>What this means:</strong></p>
              <ul>
                <li>You're actively using your fiber internet</li>
                <li>Your trial is progressing well</li>
                <li>You're on track for a successful conversion</li>
                <li>We're here to support your internet needs</li>
              </ul>
              <p>Keep enjoying your trial! If you have any questions, don't hesitate to reach out.</p>
              <p>Best regards,<br>The Team</p>
            </div>
          `,
          text: isWireless ? 
            `Your Wireless Trial is Going Great!\n\nHi {{customerName}},\n\nWe're thrilled to see you're actively using your wireless internet trial! Your engagement shows you're enjoying the service.\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nEngagement Level: High\nTrial Status: Active & Engaged\n\nWhat this means:\n- You're actively using your wireless internet\n- Your trial is progressing well\n- You're on track for a successful conversion\n- We're here to support your internet needs\n\nKeep enjoying your trial! If you have any questions, don't hesitate to reach out.\n\nBest regards,\nThe Team` :
            `Your Fiber Trial is Going Great!\n\nHi {{customerName}},\n\nWe're thrilled to see you're actively using your fiber internet trial! Your engagement shows you're enjoying the service.\n\nOrder Number: {{orderNumber}}\nService Type: Fiber Internet\nEngagement Level: High\nTrial Status: Active & Engaged\n\nWhat this means:\n- You're actively using your fiber internet\n- Your trial is progressing well\n- You're on track for a successful conversion\n- We're here to support your internet needs\n\nKeep enjoying your trial! If you have any questions, don't hesitate to reach out.\n\nBest regards,\nThe Team`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        'trial_converted': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: serviceType || 'fiber',
          subject: isWireless ? 'Congratulations! Your Wireless Trial Converted - {{customerName}}' : 'Congratulations! Your Fiber Trial Converted - {{customerName}}',
          html: isWireless ? `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #16a34a;">🎉 Congratulations! Your Wireless Trial Converted!</h2>
              <p>Hi {{customerName}},</p>
              <p>Fantastic news! Your wireless internet trial has been successfully converted to a paid service. Welcome to our valued customer family!</p>
              <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Wireless Internet</p>
                <p><strong>Status:</strong> Converted to Paid Service</p>
                <p><strong>Next Steps:</strong> Continue enjoying your service</p>
              </div>
              <p><strong>What happens next:</strong></p>
              <ul>
                <li>Your service continues uninterrupted</li>
                <li>You'll receive your first billing cycle details</li>
                <li>Access to premium customer support</li>
                <li>Priority for any service upgrades</li>
              </ul>
              <p>Thank you for choosing us! We're excited to continue serving your internet needs.</p>
              <p>Best regards,<br>The Team</p>
            </div>
          ` : `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #16a34a;">🎉 Congratulations! Your Fiber Trial Converted!</h2>
              <p>Hi {{customerName}},</p>
              <p>Fantastic news! Your fiber internet trial has been successfully converted to a paid service. Welcome to our valued customer family!</p>
              <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
                <p><strong>Order Number:</strong> {{orderNumber}}</p>
                <p><strong>Service Type:</strong> Fiber Internet</p>
                <p><strong>Status:</strong> Converted to Paid Service</p>
                <p><strong>Next Steps:</strong> Continue enjoying your service</p>
              </div>
              <p><strong>What happens next:</strong></p>
              <ul>
                <li>Your service continues uninterrupted</li>
                <li>You'll receive your first billing cycle details</li>
                <li>Access to premium customer support</li>
                <li>Priority for any service upgrades</li>
              </ul>
              <p>Thank you for choosing us! We're excited to continue serving your internet needs.</p>
              <p>Best regards,<br>The Team</p>
            </div>
          `,
          text: isWireless ? 
            `Congratulations! Your Wireless Trial Converted!\n\nHi {{customerName}},\n\nFantastic news! Your wireless internet trial has been successfully converted to a paid service. Welcome to our valued customer family!\n\nOrder Number: {{orderNumber}}\nService Type: Wireless Internet\nStatus: Converted to Paid Service\nNext Steps: Continue enjoying your service\n\nWhat happens next:\n- Your service continues uninterrupted\n- You'll receive your first billing cycle details\n- Access to premium customer support\n- Priority for any service upgrades\n\nThank you for choosing us! We're excited to continue serving your internet needs.\n\nBest regards,\nThe Team` :
            `Congratulations! Your Fiber Trial Converted!\n\nHi {{customerName}},\n\nFantastic news! Your fiber internet trial has been successfully converted to a paid service. Welcome to our valued customer family!\n\nOrder Number: {{orderNumber}}\nService Type: Fiber Internet\nStatus: Converted to Paid Service\nNext Steps: Continue enjoying your service\n\nWhat happens next:\n- Your service continues uninterrupted\n- You'll receive your first billing cycle details\n- Access to premium customer support\n- Priority for any service upgrades\n\nThank you for choosing us! We're excited to continue serving your internet needs.\n\nBest regards,\nThe Team`,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        },
        'trial_active': {
          key: `fallback_${orderType}_${status}`,
          orderType,
          triggerStatus: status,
          serviceType: serviceType || 'fiber',
          subject: isWireless ? 'Your Wireless Trial is Now Active! - {{customerName}}' : 'Your Fiber Trial is Now Active! - {{customerName}}',
        html: isWireless ? `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a;">🚀 Your Wireless Trial is Now Active!</h2>
            <p>Hi {{customerName}},</p>
            <p>Congratulations! Your wireless internet trial is now active and ready to use.</p>
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Service Status:</strong> Active</p>
              <p><strong>Trial Duration:</strong> 30 days</p>
              <p><strong>Login Credentials:</strong> Check your welcome packet</p>
            </div>
            <p><strong>Your trial includes:</strong></p>
            <ul>
              <li>Reliable wireless internet</li>
              <li>Unlimited data usage</li>
              <li>24/7 customer support</li>
              <li>Self-installation setup</li>
            </ul>
            <p>Enjoy your trial! If you have any questions, don't hesitate to contact us.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        ` : `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #16a34a;">🚀 Your Fiber Trial is Now Active!</h2>
            <p>Hi {{customerName}},</p>
            <p>Congratulations! Your fiber internet trial is now active and ready to use.</p>
            <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #16a34a;">
              <p><strong>Order Number:</strong> {{orderNumber}}</p>
              <p><strong>Service Status:</strong> Active</p>
              <p><strong>Trial Duration:</strong> 30 days</p>
              <p><strong>Login Credentials:</strong> Check your welcome packet</p>
            </div>
            <p><strong>Your trial includes:</strong></p>
            <ul>
              <li>High-speed fiber internet</li>
              <li>Unlimited data usage</li>
              <li>24/7 customer support</li>
              <li>Professional installation</li>
            </ul>
            <p>Enjoy your trial! If you have any questions, don't hesitate to contact us.</p>
            <p>Best regards,<br>The Team</p>
          </div>
        `,
        text: isWireless ? 
          `Your Wireless Trial is Now Active!\n\nHi {{customerName}},\n\nCongratulations! Your wireless internet trial is now active and ready to use.\n\nOrder Number: {{orderNumber}}\nService Status: Active\nTrial Duration: 30 days\nLogin Credentials: Check your welcome packet\n\nYour trial includes:\n- Reliable wireless internet\n- Unlimited data usage\n- 24/7 customer support\n- Self-installation setup\n\nEnjoy your trial! If you have any questions, don't hesitate to contact us.\n\nBest regards,\nThe Team` :
          `Your Fiber Trial is Now Active!\n\nHi {{customerName}},\n\nCongratulations! Your fiber internet trial is now active and ready to use.\n\nOrder Number: {{orderNumber}}\nService Status: Active\nTrial Duration: 30 days\nLogin Credentials: Check your welcome packet\n\nYour trial includes:\n- High-speed fiber internet\n- Unlimited data usage\n- 24/7 customer support\n- Professional installation\n\nEnjoy your trial! If you have any questions, don't hesitate to contact us.\n\nBest regards,\nThe Team`,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    };

    return templates[status] || null;
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
      console.log(`[orders-templates] 🔍 Looking for template: ${orderType}:${status} (service: ${templateData.serviceType || 'generic'})`);
      
      // Find the appropriate template
      const template = await this.findTemplateForOrder(orderType, status, templateData.serviceType);
      
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