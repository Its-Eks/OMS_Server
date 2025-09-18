import type { MongoClient, Db, Collection } from 'mongodb';

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

export class NotificationService {
  private mongo: MongoClient;
  private db: Db;
  private notifications!: Collection<NotificationDoc>;
  private rules!: Collection<NotificationRuleDoc>;
  private events!: Collection<UserEventDoc>;

  constructor(mongo: MongoClient) {
    this.mongo = mongo;
    this.db = mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    this.notifications = this.db.collection<NotificationDoc>('notifications');
    this.rules = this.db.collection<NotificationRuleDoc>('notification_rules');
    this.events = this.db.collection<UserEventDoc>('user_events');
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
    // Supports:
    // - Direct user targeting via targets.userIds
    // - Role broadcast via targets.roles (exact roleName)
    // - Global broadcast via special role marker '__all__' OR missing targets
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
      delete filter.$or; // System Admin sees all
    }
    const rows = await this.notifications.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    return rows;
  }

  async markRead(userId: string, notificationIds: string[]): Promise<number> {
    const res = await this.notifications.updateMany(
      { _id: { $in: notificationIds.map((id) => (typeof id === 'string' ? id : id)) } as any },
      { $addToSet: { readBy: userId }, $set: { status: 'read' as NotificationStatus } }
    );
    return res.modifiedCount;
  }

  async upsertRule(rule: Omit<NotificationRuleDoc, '_id' | 'createdAt'>) {
    const doc: NotificationRuleDoc = { ...rule, createdAt: new Date() };
    await this.rules.updateOne(
      { eventType: doc.eventType },
      { $set: doc },
      { upsert: true }
    );
    return { ok: true };
  }

  async emitEvent(evt: Omit<UserEventDoc, '_id' | 'createdAt' | 'processed'>) {
    const doc: UserEventDoc = { ...evt, createdAt: new Date(), processed: false };
    const r = await this.events.insertOne(doc);
    // Optimistic realtime emit to sockets
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
          // dedupe window
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
          // Authoritative realtime emit after persistence
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
}

// Optional email helpers (dev-friendly). Comment out nodemailer if types unavailable.
// import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
dotenv.config();

type BasicEmail = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
};

/*
function buildTransport() {
  // Phase 1: Local dev defaults to MailHog
  const host = process.env.EMAIL_HOST || 'localhost';
  const port = parseInt(process.env.EMAIL_PORT || '1025', 10);
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  const secure = process.env.EMAIL_SECURE === 'true' ? true : false;

  if (host === 'ethereal') {
    // Ethereal dynamic account for ad-hoc testing
    return nodemailer.createTestAccount().then((account) =>
      nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: { user: account.user, pass: account.pass },
      })
    );
  }

  // MailHog or production SMTP
  return Promise.resolve(
    nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user && pass ? { user, pass } : undefined,
      tls: {
        rejectUnauthorized: false // Allow self-signed certificates
      }
    })
  );
}

export async function sendEmail(message: BasicEmail) {
  const transporter = await buildTransport();
  const fromAddress =
    message.from || process.env.EMAIL_FROM || 'OMS <no-reply@local.dev>';

  const info = await transporter.sendMail({
    from: fromAddress,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });

  const previewUrl = (nodemailer as any).getTestMessageUrl
    ? (nodemailer as any).getTestMessageUrl(info)
    : undefined;

  return { messageId: info.messageId, previewUrl };
}

export async function sendTestEmail(to: string) {
  return sendEmail({
    to,
    subject: 'OMS Dev Test Email',
    text: 'Hello from OMS Mailer (dev)!',
    html: '<p>Hello from <b>OMS Mailer</b> (dev)!</p>',
  });
}
*/
export class NotificationDeliveryService {
  async sendEmail(to: string, subject: string, body: string) {
    console.log(`Email to ${to}: ${subject} - ${body}`);
    return { success: true };
  }

  async sendSMS(to: string, message: string) {
    // TODO: Integrate with real SMS service
    console.log(`SMS to ${to}: ${message}`);
    return { success: true };
  }

  async sendEscalationNotification(escalation: any) {
    // TODO: Send escalation notification to assigned user
    console.log(`Escalation notification: ${escalation.reason}`);
    return { success: true };
  }

  async sendSLABreachNotification(order: any) {
    // TODO: Send SLA breach notification
    console.log(`SLA breach notification for order ${order.id}`);
    return { success: true };
  }

  async sendOrderStatusUpdate(order: any, customerEmail: string) {
    // TODO: Send order status update to customer
    console.log(`Order status update sent to ${customerEmail} for order ${order.id}`);
    return { success: true };
  }
}

// Simple stubbed email export for modules importing sendEmail
export async function sendEmail(message: { to: string; subject: string; text?: string; html?: string; from?: string }) {
  const fromAddress = message.from || process.env.EMAIL_FROM || 'OMS <no-reply@local.dev>';
  console.log('[EmailStub] sendEmail', {
    from: fromAddress,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html
  });
  return { messageId: 'dev-stub', previewUrl: undefined } as any;
}

export async function sendTestEmail(to: string) {
  return sendEmail({
    to,
    subject: 'OMS Dev Test Email',
    text: 'Hello from OMS Mailer (dev)!',
    html: '<p>Hello from <b>OMS Mailer</b> (dev)!</p>'
  });
}

