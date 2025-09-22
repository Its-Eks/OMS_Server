import nodemailer from 'nodemailer';
import { mongodb } from '../Database/main.ts';
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

/**
 * NotificationService (MongoDB-based persistence for in-app notifications)
 */
export class NotificationService {
  private mongo: MongoClient;
  private db: Db;
  private notifications!: Collection<NotificationDoc>;
  private rules!: Collection<NotificationRuleDoc>;
  private events!: Collection<UserEventDoc>;

  private transporter: any | null = null;

  constructor(mongo?: MongoClient) {
    // Allow optional injection; fallback to global app client
    const fallback = (mongodb as unknown as MongoClient) || undefined;
    this.mongo = (mongo || fallback)!;
    if (!this.mongo) {
      throw new Error('MongoDB client not available');
    }
    this.db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    this.notifications = this.db.collection<NotificationDoc>('notifications');
    this.rules = this.db.collection<NotificationRuleDoc>('notification_rules');
    this.events = this.db.collection<UserEventDoc>('user_events');

    // Setup nodemailer transporter
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT || 587);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    if (host && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      console.warn('[notification] SMTP not fully configured; emails will be no-ops');
    }
  }

  async buildTemplateAsync(type: EmailTemplateType, data: any): Promise<{ subject: string; html: string; text: string }> {
    switch (type) {
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
      default: {
        const subject = 'OMS Notification';
        const text = 'This is a notification from OMS.';
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
      { eventType: 'fno_manual_completed', routeTo: { roles: ['Operations Manager', 'Application Administrator'] }, systemAdminOnly: false, dedupeWindowMinutes: 0, createdAt: new Date() }
    ];
    for (const rule of defaults) {
      await this.rules.updateOne({ eventType: rule.eventType }, { $setOnInsert: rule }, { upsert: true });
    }
  }

  async getMyNotifications(userId: string, roleName: RoleName, limit = 50) {
    const isSysAdmin = roleName.trim().toLowerCase().includes('system administrator');
    const filter: any = {
      status: { $in: ['pending', 'delivered'] },
      $or: [
        { 'targets.userIds': userId },
        { 'targets.roles': roleName },
        { 'targets.roles': '__all__' },
        { targets: { $exists: false } }
      ]
    };
    if (isSysAdmin) {
      delete filter.$or;
    }
    return this.notifications.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
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
    } catch {}
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
          } catch {}
          created++;
        }
        await this.events.updateOne({ _id: evt._id }, { $set: { processed: true } });
        processed++;
      } catch {
        errors++;
      }
    }
    return { created, processed, errors };
  }

  private titleForEvent(type: string): string {
    switch (type) {
      case 'user_first_login': return 'First login successful';
      case 'password_link_expired': return 'Password setup link expired';
      default: return 'System notification';
    }
  }

  private messageForEvent(evt: UserEventDoc): string {
    switch (evt.type) {
      case 'user_first_login':
        return `User ${evt.metadata?.email || evt.userId} logged in for the first time.`;
      case 'password_link_expired':
        return `Password setup link expired for ${evt.metadata?.email || evt.userId}.`;
      default:
        return evt.metadata?.message || 'A system event occurred.';
    }
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.transporter) {
      console.log('[notification] send (noop):', options.subject, '->', options.to);
      return;
    }
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@oms.local',
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
    });
  }
}

export type EmailTemplateType =
  | 'welcome_email'
  | 'generic_notification'
  | 'onboarding_rep_contact_scheduled'
  | 'onboarding_installation_scheduled'
  | 'onboarding_documents_received'
  | 'onboarding_activated'
  | 'onboarding_sla_warning'
  | 'onboarding_sla_breach'
  | 'onboarding_sla_reescalation';

export interface SendEmailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
}

// Back-compat helper
export async function sendEmail(to: string, subject: string, body: string): Promise<{ success: boolean }> {
  const svc = new NotificationService(mongodb as unknown as MongoClient);
  await svc.send({ to, subject, text: body, html: `<p>${body}</p>` });
  return { success: true };
}

export async function sendTestEmail(to: string): Promise<{ success: boolean }> {
  const subject = 'OMS Test Email';
  const body = 'This is a test email from OMS.';
  return sendEmail(to, subject, body);
}
