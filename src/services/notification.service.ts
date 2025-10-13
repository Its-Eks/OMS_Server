import nodemailer from 'nodemailer';
import axios from 'axios';
import { mongoClient, mongodb } from '../Database/main.ts';
import type { MongoClient, Db, Collection } from 'mongodb';
import dotenv from 'dotenv';
dotenv.config();

type RoleName = string;

export type NotificationStatus = 'pending' | 'delivered' | 'read' | 'expired';

export interface NotificationDoc {
  _id?: any;
  type: string;
  title: string;
  message: string;
  targets: { userIds?: string[]; roles?: RoleName[] };
  visibility?: { systemAdminOnly?: boolean };
  metadata?: any;
  status: NotificationStatus;
  createdAt: Date;
  deliveredAt?: Date;
  readBy?: string[];
}

export interface NotificationRuleDoc {
  _id?: any;
  eventType: string;
  routeTo: { roles?: RoleName[]; userIds?: string[] };
  systemAdminOnly?: boolean;
  dedupeWindowMinutes?: number;
  createdAt: Date;
}

export interface UserEventDoc {
  _id?: any;
  type: string;
  userId: string;
  metadata?: any;
  createdAt: Date;
  processed?: boolean;
}

export type EmailTemplateType =
  | 'welcome_email'
  | 'generic_notification'
  | 'escalation_assigned'
  | 'escalation_created'
  | 'escalation_resolved'
  | 'onboarding_rep_contact_scheduled'
  | 'onboarding_installation_scheduled'
  | 'onboarding_documents_received'
  | 'onboarding_activated'
  | 'onboarding_sla_warning'
  | 'onboarding_sla_breach'
  | 'onboarding_sla_reescalation'
  | 'email_verification';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string | undefined;
  html?: string | undefined;
  from?: string | undefined;
}

/**
 * NotificationService (MongoDB-based persistence for in-app notifications)
 */
export class NotificationService {
  private mongo: MongoClient | null = null;
  private db: Db;
  private notifications!: Collection<NotificationDoc>;
  private rules!: Collection<NotificationRuleDoc>;
  private events!: Collection<UserEventDoc>;

  private transporter: any | null = null;
  private isTransporterReady: boolean = false;
  private useResend: boolean = false;

  // Singleton transport across instances to prevent repeated SMTP setup/verify
  private static sharedTransporter: any | null = null;
  private static sharedReady: boolean = false;
  private static initialized: boolean = false;

  // Dev memory fallback when NOTIFICATIONS_DEV_NO_MONGO=true
  private readonly devNoMongo: boolean = false;
  private static memoryStore: NotificationDoc[] = [];

  constructor(mongoOrDb?: MongoClient | Db) {
    // Accept either a MongoClient or a Db for flexibility
    const fallbackClient = mongoClient as unknown as MongoClient | undefined;
    const fallbackDb = mongodb as unknown as Db | undefined;

    const devNoMongo = String(process.env.NOTIFICATIONS_DEV_NO_MONGO || '').toLowerCase() === 'true';
    this.devNoMongo = devNoMongo;

    if (devNoMongo) {
      // Dev mode: skip Mongo entirely; email-only notifications
      // Initialize a dummy in-memory DB substitute to satisfy types
      // @ts-expect-error dev mode without Mongo
      this.db = { collection: () => ({
        createIndex: async () => {},
        updateOne: async () => ({}),
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
        updateMany: async () => ({ modifiedCount: 0 }),
        insertOne: async () => ({ insertedId: null }),
        findOne: async () => null,
      }) } as Db;
    } else if (mongoOrDb && typeof (mongoOrDb as any).db === 'function') {
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
      // If no Mongo available and not explicitly dev mode, degrade to dev mode
      console.warn('[notification] MongoDB not available - falling back to dev no-mongo mode');
      // @ts-expect-error dev mode without Mongo
      this.db = { collection: () => ({
        createIndex: async () => {},
        updateOne: async () => ({}),
        find: () => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }),
        updateMany: async () => ({ modifiedCount: 0 }),
        insertOne: async () => ({ insertedId: null }),
        findOne: async () => null,
      }) } as Db;
    }

    this.notifications = this.db.collection<NotificationDoc>('notifications');
    this.rules = this.db.collection<NotificationRuleDoc>('notification_rules');
    this.events = this.db.collection<UserEventDoc>('user_events');

    // Prefer Resend API if configured, but always initialize SMTP as fallback
    this.useResend = !!process.env.RESEND_API_KEY;
    if (this.useResend) {
      console.log('[notification] ✅ Resend API enabled (with SMTP fallback)');
    } else {
      console.log('[notification] 📧 Using SMTP as primary email service');
    }
    
    // Always initialize or reuse a shared SMTP transporter for fallback
    if (NotificationService.sharedTransporter) {
      this.transporter = NotificationService.sharedTransporter;
      this.isTransporterReady = NotificationService.sharedReady;
    } else {
      this.initializeTransporter();
    }
  }

  private initializeTransporter(): void {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      console.warn('[notification] SMTP not fully configured; emails will be no-ops');
      console.warn(`Missing: ${!host ? 'SMTP_HOST ' : ''}${!user ? 'SMTP_USER ' : ''}${!pass ? 'SMTP_PASS' : ''}`);
      return;
    }

    try {
      // Special handling for Gmail
      if (host === 'smtp.gmail.com') {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: { user, pass },
          tls: {
            rejectUnauthorized: false  // Fix for certificate issues
          }
        });
        console.log('[notification] ✅ Gmail SMTP transporter configured');
      } else {
        // Generic SMTP configuration
        const secure = port === 465; // Implicit TLS on 465
        const transportOptions: any = {
      host,
      port,
      secure,
          auth: { user, pass },
      tls: {
            minVersion: 'TLSv1.2',
            rejectUnauthorized: false,  // Fix for self-signed certificates
            secureProtocol: 'TLSv1_2_method'
          },
        };
        
        // STARTTLS typical on 587
        if (!secure) {
          transportOptions.requireTLS = true;
        }
        
        this.transporter = nodemailer.createTransport(transportOptions);
        console.log('[notification] ✅ Generic SMTP transporter configured');
      }
      // Share transporter across instances
      NotificationService.sharedTransporter = this.transporter;

      // Mark not ready until verify completes
      this.isTransporterReady = false;
      NotificationService.sharedReady = false;
      // Test the connection on startup (non-blocking)
      this.testConnectionAsync();
    } catch (error: any) {
      console.error('[notification] ❌ Failed to initialize SMTP transporter:', error.message);
    }
  }

  private async testConnectionAsync(): Promise<void> {
    if (!this.transporter) return;
    
    try {
      await this.transporter.verify();
      this.isTransporterReady = true;
      NotificationService.sharedReady = true;
      console.log('[notification] ✅ SMTP connection verified successfully');
    } catch (error: any) {
      this.isTransporterReady = false;
      NotificationService.sharedReady = false;
      console.error('[notification] ❌ SMTP connection failed:', error.message);
      
      // Provide helpful error messages
      if (error.code === 'ESOCKET') {
        console.error('   → Check SMTP host and port configuration');
      } else if (error.code === 'EAUTH') {
        console.error('   → Check SMTP credentials (use Gmail App Password for Gmail)');
      } else if (error.code === 'CERT_HAS_EXPIRED' || error.message.includes('certificate')) {
        console.error('   → Certificate issue - verify TLS configuration');
      }
    }
  }

  async buildTemplateAsync(type: EmailTemplateType, data: any): Promise<{ subject: string; html: string; text: string }> {
    switch (type) {
      case 'escalation_assigned': {
        const subject = `Escalation assigned: ${data.orderNumber} (L${data.level})`;
        const html = `<p><strong>Order:</strong> ${data.orderNumber}<br/><strong>Level:</strong> ${data.level}<br/><strong>Priority:</strong> ${data.priority || 'normal'}<br/><strong>Assigned to:</strong> ${data.assignedToName}${data.agingHours != null ? `<br/><strong>Aging:</strong> ${Math.round(data.agingHours)}h` : ''}${data.businessImpact ? `<br/><strong>Impact:</strong> ${data.businessImpact}` : ''}</p>`;
        const text = `Escalation assigned for ${data.orderNumber} (L${data.level}) to ${data.assignedToName}${data.agingHours != null ? ` | Aging: ${Math.round(data.agingHours)}h` : ''}${data.businessImpact ? ` | Impact: ${data.businessImpact}` : ''}`;
        return { subject, html, text };
      }
      case 'escalation_created': {
        const subject = `Escalation created: ${data.orderNumber} (L${data.level})`;
        const html = `<p><strong>Order:</strong> ${data.orderNumber}<br/><strong>Level:</strong> ${data.level}<br/><strong>Reason:</strong> ${data.reason}${data.agingHours != null ? `<br/><strong>Aging:</strong> ${Math.round(data.agingHours)}h` : ''}${data.businessImpact ? `<br/><strong>Impact:</strong> ${data.businessImpact}` : ''}</p>`;
        const text = `Escalation created for ${data.orderNumber} (L${data.level}). Reason: ${data.reason}${data.agingHours != null ? ` | Aging: ${Math.round(data.agingHours)}h` : ''}${data.businessImpact ? ` | Impact: ${data.businessImpact}` : ''}`;
        return { subject, html, text };
      }
      case 'escalation_resolved': {
        const subject = `Escalation resolved: ${data.orderNumber}`;
        const html = `<p><strong>Order:</strong> ${data.orderNumber}<br/><strong>Resolution:</strong> ${data.notes || 'Resolved'}${data.agingHours != null ? `<br/><strong>Aging at resolve:</strong> ${Math.round(data.agingHours)}h` : ''}</p>`;
        const text = `Escalation resolved for ${data.orderNumber}.${data.agingHours != null ? ` Aging at resolve: ${Math.round(data.agingHours)}h.` : ''}`;
        return { subject, html, text };
      }
      case 'email_verification': {
        const subject = 'Verify Your Email Address - OMS Platform';
        const verificationUrl = data.verificationUrl || '#';
        const userEmail = data.email || 'User';
        
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
              <h2 style="color: #333; text-align: center;">Welcome to OMS Platform!</h2>
              <p style="color: #666; font-size: 16px;">
                Thank you for registering with OMS Platform. Please verify your email address to complete your registration.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${verificationUrl}" 
                   style="background-color: #007bff; color: white; padding: 12px 30px; 
                          text-decoration: none; border-radius: 5px; display: inline-block;
                          font-weight: bold;">
                  Verify Email Address
                </a>
              </div>
              <p style="color: #999; font-size: 14px;">
                If you didn't create an account with us, please ignore this email.
              </p>
              <p style="color: #999; font-size: 14px;">
                This verification link will expire in 24 hours.
              </p>
            </div>
            <div style="text-align: center; margin-top: 20px;">
              <p style="color: #999; font-size: 12px;">
                © 2025 Xnext OMS Platform. All rights reserved.
              </p>
            </div>
          </div>
        `;
        
        const text = `Welcome to OMS Platform! Please verify your email address by visiting: ${verificationUrl}. This link will expire in 24 hours. If you didn't create an account, please ignore this email.`;
        
        return { subject, html, text };
      }
      
      case 'onboarding_sla_warning': {
        const subject = `SLA warning: ${data.currentState} (due ${data.dueAt})`;
        const text = `Approaching SLA for onboarding ${data.onboardingId} in state ${data.currentState}. Elapsed ${Math.round(data.elapsedHours)}h / SLA ${data.slaHours}h. Due at ${data.dueAt}.`;
        const html = `<p><strong>Approaching SLA</strong> for onboarding <strong>${data.onboardingId}</strong> in state <strong>${data.currentState}</strong>.<br/>Elapsed ${Math.round(data.elapsedHours)}h / SLA ${data.slaHours}h.<br/>Due at ${data.dueAt}.</p>`;
        return { subject, html, text };
      }
      
      case 'onboarding_sla_breach': {
        const subject = `SLA breached: ${data.currentState}`;
        const text = `SLA breached for onboarding ${data.onboardingId} in state ${data.currentState}. Elapsed ${Math.round(data.elapsedHours)}h.`;
        const html = `<p><strong>SLA breached</strong> for onboarding <strong>${data.onboardingId}</strong> in state <strong>${data.currentState}</strong>.<br/>Elapsed ${Math.round(data.elapsedHours)}h.</p>`;
        return { subject, html, text };
      }
      
      case 'onboarding_sla_reescalation': {
        const subject = `SLA re-escalation: ${data.currentState}`;
        const text = `Extended SLA breach for onboarding ${data.onboardingId} in state ${data.currentState}. Elapsed ${Math.round(data.elapsedHours)}h.`;
        const html = `<p><strong>Extended SLA breach</strong> for onboarding <strong>${data.onboardingId}</strong> in state <strong>${data.currentState}</strong>.<br/>Elapsed ${Math.round(data.elapsedHours)}h.</p>`;
        return { subject, html, text };
      }
      
      case 'welcome_email': {
        const subject = 'Welcome to OMS Platform';
        const html = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #333;">Welcome to OMS Platform!</h2>
            <p>Your account has been successfully created.</p>
            <p>You can now log in to access your dashboard and start using our services.</p>
          </div>
        `;
        const text = 'Welcome to OMS Platform! Your account has been successfully created.';
        return { subject, html, text };
      }
      
      default: {
        const subject = 'OMS Platform Notification';
        const text = 'This is a notification from OMS Platform.';
        const html = `<p>${text}</p>`;
        return { subject, html, text };
      }
    }
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.notifications.createIndex({ 'targets.userIds': 1, status: 1, createdAt: -1 }),
      this.notifications.createIndex({ 'targets.roles': 1, status: 1, createdAt: -1 }),
      this.notifications.createIndex({ createdAt: -1 }),
      this.rules.createIndex({ eventType: 1 }),
      this.events.createIndex({ type: 1, createdAt: -1 }),
      this.events.createIndex({ processed: 1 })
    ]);
  }

  async ensureDefaultRules(): Promise<void> {
    const defaults: NotificationRuleDoc[] = [
      { eventType: 'user_first_login', routeTo: { roles: ['System Administrator'] }, systemAdminOnly: true, dedupeWindowMinutes: 1440, createdAt: new Date() },
      { eventType: 'password_link_expired', routeTo: { roles: ['System Administrator'] }, systemAdminOnly: true, dedupeWindowMinutes: 60, createdAt: new Date() },
      { eventType: 'fno_submit_api', routeTo: { roles: ['Operations Manager'] }, systemAdminOnly: false, dedupeWindowMinutes: 0, createdAt: new Date() },
      { eventType: 'fno_submit_manual', routeTo: { roles: ['Application Administrator'] }, systemAdminOnly: false, dedupeWindowMinutes: 0, createdAt: new Date() },
      { eventType: 'fno_manual_completed', routeTo: { roles: ['Operations Manager', 'Application Administrator'] }, systemAdminOnly: false, dedupeWindowMinutes: 0, createdAt: new Date() },
      { eventType: 'email_verification_needed', routeTo: { roles: ['System Administrator'] }, systemAdminOnly: true, dedupeWindowMinutes: 60, createdAt: new Date() }
    ];
    
    for (const rule of defaults) {
      await this.rules.updateOne({ eventType: rule.eventType }, { $setOnInsert: rule }, { upsert: true });
    }
  }

  async getMyNotifications(userId: string, roleName: RoleName, limit = 50) {
    // Dev memory fallback
    if (this.devNoMongo) {
      const items = NotificationService.memoryStore
        .filter(n => n.status === 'pending' || n.status === 'delivered')
        .filter(n => {
          const targets = n.targets || {} as any;
          const userMatch = Array.isArray(targets.userIds) && targets.userIds.includes(userId);
          const roleMatch = Array.isArray(targets.roles) && targets.roles.includes(roleName);
          const allMatch = Array.isArray(targets.roles) && targets.roles.includes('__all__');
          const noTargets = !targets.userIds && !targets.roles;
          return userMatch || roleMatch || allMatch || noTargets;
        })
        .sort((a, b) => (b.createdAt?.getTime?.() || 0) - (a.createdAt?.getTime?.() || 0))
        .slice(0, limit);
      return items;
    }
    const normalizedRole = String(roleName || '').trim().toLowerCase();
    const isSysAdmin = normalizedRole === 'system administrator';
    const baseFilter: any = { status: { $in: ['pending', 'delivered'] } };

    // Visibility filter for non-admins (hide systemAdminOnly)
    const nonAdminVisibilityFilter = {
      $or: [
        { 'visibility.systemAdminOnly': { $ne: true } },
        { visibility: { $exists: false } }
      ]
    } as const;

    if (isSysAdmin) {
      // System Administrators ONLY see:
      // - notifications explicitly targeted to their userId
      // - notifications targeted to the 'System Administrator' role
      // - notifications marked systemAdminOnly
      const filter: any = {
        ...baseFilter,
        $or: [
          { 'targets.userIds': userId },
          { 'targets.roles': 'System Administrator' },
          { 'visibility.systemAdminOnly': true }
        ]
      };
      const notifications = await this.notifications
        .find(filter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      return notifications.map(n => ({
        ...n,
        readAt: n.readBy && n.readBy.includes(userId) ? n.deliveredAt || n.createdAt : null
      }));
    }

    // Non-admin users ONLY see notifications explicitly targeted to them by userId or by their role
    const filter: any = {
      ...baseFilter,
      $and: [
        {
          $or: [
            { 'targets.userIds': userId },
            { 'targets.roles': roleName }
          ]
        },
        nonAdminVisibilityFilter
      ]
    };

    return this.notifications
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async markRead(userId: string, notificationIds: string[]): Promise<number> {
    const res = await this.notifications.updateMany(
      { _id: { $in: notificationIds } as any },
      { $addToSet: { readBy: userId }, $set: { status: 'read' as NotificationStatus } }
    );
    return res.modifiedCount;
  }

  async upsertRule(rule: Omit<NotificationRuleDoc, '_id' | 'createdAt'>) {
    const doc: NotificationRuleDoc = { ...rule, createdAt: new Date() };
    await this.rules.updateOne({ eventType: doc.eventType }, { $set: doc }, { upsert: true });
    return { ok: true };
  }

  async emitEvent(evt: Omit<UserEventDoc, '_id' | 'createdAt' | 'processed'>) {
    const doc: UserEventDoc = { ...evt, createdAt: new Date(), processed: false };
    const r = await this.events.insertOne(doc);
    
    try {
      const { SocketService } = await import('./socket.service.ts');
      SocketService.emitNotification({
        type: evt.type,
        title: this.titleForEvent(evt.type),
        message: this.messageForEvent(doc as any),
        targets: { userIds: [evt.userId] },
        status: 'pending',
        createdAt: new Date(),
        metadata: evt.metadata
      });
    } catch (error) {
      console.warn('[notification] Failed to emit socket notification:', error);
    }
    
    return { id: r.insertedId };
  }

  async processEventsOnce(): Promise<{ created: number; processed: number; errors: number }> {
    let created = 0, processed = 0, errors = 0;
    const batch = await this.events.find({ processed: { $ne: true } }).limit(100).toArray();
    
    for (const evt of batch) {
      try {
        const rules = await this.rules.find({ eventType: evt.type }).toArray();
        
        for (const rule of rules) {
          const since = new Date(Date.now() - (rule.dedupeWindowMinutes || 0) * 60000);
          const exists = await this.notifications.findOne({
            type: evt.type,
            'metadata.userId': evt.userId,
            createdAt: { $gte: since }
          });
          
          if (exists) continue;
          
          const notif: NotificationDoc = {
            type: evt.type,
            title: this.titleForEvent(evt.type),
            message: this.messageForEvent(evt),
            targets: rule.routeTo || {},
            visibility: { systemAdminOnly: !!rule.systemAdminOnly },
            metadata: { userId: evt.userId, ...evt.metadata },
            status: 'pending',
            createdAt: new Date()
          };
          
          const ins = await this.notifications.insertOne(notif);
          
          try {
            const { SocketService } = await import('./socket.service.ts');
            SocketService.emitNotification({ ...notif, _id: ins.insertedId });
          } catch (error) {
            console.warn('[notification] Failed to emit socket notification:', error);
          }
          
          created++;
        }
        
        await this.events.updateOne({ _id: evt._id }, { $set: { processed: true } });
        processed++;
      } catch (error) {
        console.error('[notification] Error processing event:', error);
        errors++;
      }
    }
    
    return { created, processed, errors };
  }

  private titleForEvent(type: string): string {
    switch (type) {
      case 'user_first_login': return 'First login successful';
      case 'password_link_expired': return 'Password setup link expired';
      case 'email_verification_needed': return 'Email verification required';
      default: return 'System notification';
    }
  }

  private messageForEvent(evt: UserEventDoc): string {
    switch (evt.type) {
      case 'user_first_login':
        return `User ${evt.metadata?.email || evt.userId} logged in for the first time.`;
      case 'password_link_expired':
        return `Password setup link expired for ${evt.metadata?.email || evt.userId}.`;
      case 'email_verification_needed':
        return `Email verification required for ${evt.metadata?.email || evt.userId}.`;
      default:
        return evt.metadata?.message || 'A system event occurred.';
    }
  }

  async send(options: SendEmailOptions): Promise<boolean> {
    // Prefer Resend API when configured
    if (this.useResend) {
      try {
        const fromHeader = options.from || process.env.RESEND_FROM || process.env.SMTP_FROM || 'no-reply@oms.local';
        const apiKey = process.env.RESEND_API_KEY as string;
        const payload: any = {
          from: fromHeader,
          to: Array.isArray(options.to) ? options.to : [options.to],
          subject: options.subject,
          html: options.html,
          text: options.text
        };
        await axios.post('https://api.resend.com/emails', payload, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        });
        console.log('[notification] ✅ Email sent via Resend:', { to: options.to, subject: options.subject });
        return true;
      } catch (err: any) {
        console.error('[notification] ❌ Resend email failed:', err?.response?.data || err?.message || err);
        console.log('[notification] 🔄 Falling back to SMTP...');
        // fall through to SMTP if available
      }
    }

    // SMTP fallback
    if (!this.transporter) {
      console.log('[notification] ❌ No SMTP transporter available for fallback');
      console.log('[notification] send (noop - no transporter):', options.subject, '->', options.to);
      return false;
    }
    
    if (!this.isTransporterReady) {
      // Attempt a synchronous verify to avoid race conditions on first send
      try {
        await this.transporter.verify();
        this.isTransporterReady = true;
        NotificationService.sharedReady = true;
      } catch (err) {
        console.warn('[notification] send (transporter not ready and verify failed):', options.subject, '->', options.to);
        return false;
      }
    }
    
    try {
      const result = await this.transporter.sendMail({
        from: options.from || process.env.SMTP_FROM || 'no-reply@oms.local',
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      
      const method = this.useResend ? 'SMTP (fallback)' : 'SMTP';
      console.log(`[notification] ✅ Email sent successfully via ${method}:`, {
        to: options.to,
        subject: options.subject,
        messageId: result.messageId
      });
      
      return true;
    } catch (error: any) {
      console.error('[notification] ❌ Failed to send email:', {
        to: options.to,
        subject: options.subject,
        error: error.message,
        code: error.code
      });
      
      return false;
    }
  }

  async sendTemplatedEmail(templateType: EmailTemplateType, to: string, data: any): Promise<boolean> {
    try {
      const template = await this.buildTemplateAsync(templateType, data);
      return await this.send({
        to,
        subject: template.subject,
        html: template.html,
        text: template.text
      });
    } catch (error: any) {
      console.error('[notification] Failed to send templated email:', error.message);
      return false;
    }
  }

  // Create a persisted in-app notification and emit via sockets
  async createInAppNotification(arg: {
    type: string;
    title: string;
    message: string;
    targets: { userIds?: string[]; roles?: RoleName[] };
    metadata?: any;
  }): Promise<{ id: any } | null> {
    try {
      const notif: NotificationDoc = {
        type: arg.type,
        title: arg.title,
        message: arg.message,
        targets: arg.targets || {},
        visibility: { systemAdminOnly: false },
        metadata: arg.metadata || {},
        status: 'pending',
        createdAt: new Date()
      };
      // Dev memory fallback
      if (this.devNoMongo) {
        // Simulate insert id
        (notif as any)._id = String(Date.now()) + Math.random().toString(36).slice(2);
        NotificationService.memoryStore.unshift(notif);
        try {
          const { SocketService } = await import('./socket.service.ts');
          SocketService.emitNotification({ ...(notif as any) });
        } catch (error) {
          console.warn('[notification] Failed to emit socket notification (dev):', error);
        }
        return { id: (notif as any)._id };
      }

      const ins = await this.notifications.insertOne(notif as any);
      try {
        const { SocketService } = await import('./socket.service.ts');
        SocketService.emitNotification({ ...(notif as any), _id: ins.insertedId });
      } catch (error) {
        console.warn('[notification] Failed to emit socket notification:', error);
      }
      return { id: ins.insertedId };
    } catch (error) {
      console.error('[notification] Failed to create in-app notification:', (error as any)?.message || error);
      return null;
    }
  }

  // Public method to test connection
  async testConnection(): Promise<{ ok: boolean; message?: string; details?: any }> {
    if (this.useResend) {
      return { ok: true, message: 'Resend enabled', details: { provider: 'resend' } };
    }
    if (!this.transporter) {
      return { 
        ok: false, 
        message: 'SMTP transporter not configured',
        details: {
          hasHost: !!process.env.SMTP_HOST,
          hasUser: !!process.env.SMTP_USER,
          hasPass: !!process.env.SMTP_PASS,
          host: process.env.SMTP_HOST,
          port: process.env.SMTP_PORT
        }
      };
    }
    
    try {
      await this.transporter.verify();
      this.isTransporterReady = true;
      console.log('[notification] ✅ Email transport verification successful');
      return { ok: true, message: 'SMTP connection verified' };
    } catch (err: any) {
      this.isTransporterReady = false;
      console.error('[notification] ❌ Email transport verification failed:', err);
      return { 
        ok: false, 
        message: err?.message || String(err),
        details: {
          code: err.code,
          errno: err.errno,
          syscall: err.syscall
        }
      };
    }
  }
}

// Backward compatibility functions
export async function sendEmail(
  arg: { to: string; subject: string; html?: string; text?: string } | string, 
  subject?: string, 
  body?: string
): Promise<{ success: boolean; previewUrl?: string }> {
  // Backward-compatible signature: (to, subject, body) or ({ to, subject, html?, text? })
  const options = typeof arg === 'string' 
    ? { to: arg, subject: subject || '', html: body ? `<p>${body}</p>` : undefined, text: body } 
    : arg;
  
  const svc = new NotificationService(mongodb as unknown as Db);
  const success = await svc.send({ 
    to: options.to, 
    subject: options.subject, 
    html: options.html, 
    text: options.text 
  });
  
  return { success };
}

export async function sendTestEmail(to: string): Promise<{ success: boolean; error?: string }> {
  try {
    const subject = 'OMS Platform - SMTP Test - ' + new Date().toISOString();
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">OMS Platform - SMTP Test</h2>
        <p>This is a test email from your OMS Platform.</p>
        <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
        <p><strong>Configuration:</strong></p>
        <ul>
          <li>SMTP Host: ${process.env.SMTP_HOST}</li>
          <li>SMTP Port: ${process.env.SMTP_PORT}</li>
          <li>SMTP User: ${process.env.SMTP_USER}</li>
        </ul>
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
          If you received this email, your SMTP configuration is working correctly! ✅
        </p>
      </div>
    `;
    
    const result = await sendEmail({ 
      to, 
      subject, 
      html, 
      text: 'OMS SMTP Test Email - Configuration is working!' 
    });
    
    return { success: result.success };
  } catch (error: any) {
    console.error('Test email failed:', error);
    return { success: false, error: error.message };
  }
}

export async function verifyEmailTransport(): Promise<{ ok: boolean; message?: string; details?: any }> {
  try {
    const svc = new NotificationService(mongodb as unknown as Db);
    return await svc.testConnection();
  } catch (err: any) {
    return { 
      ok: false, 
      message: err?.message || String(err),
      details: { error: 'Failed to create notification service' }
    };
  }
}

// Convenience function for sending verification emails
export async function sendVerificationEmail(email: string, verificationToken: string): Promise<boolean> {
  const svc = new NotificationService(mongodb as unknown as Db);
  const verificationUrl = `${process.env.APP_BASE_URL || 'http://localhost:3003'}/verify-email?token=${verificationToken}`;
  
  return await svc.sendTemplatedEmail('email_verification', email, {
    email,
    verificationUrl,
    verificationToken
  });
}