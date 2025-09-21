import nodemailer from 'nodemailer';
import { mongodb } from '../Database/main.ts';

import dotenv from 'dotenv';
dotenv.config();

export type EmailTemplateType = 'welcome_email' | 'generic_notification';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html?: string | undefined;
  text?: string | undefined;
}

export class NotificationService {
  private transporter: any | null = null;

  constructor() {
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
      // eslint-disable-next-line no-console
      console.warn('[notification] SMTP not fully configured; emails will be no-ops');
    }
  }

  async buildTemplateAsync(type: string, context: any = {}): Promise<{ subject: string; html: string | undefined; text: string | undefined }> {
    try {
      if (!mongodb) {
        // Fallback to code templates when MongoDB is not connected
        return this.buildTemplate(type as EmailTemplateType, context);
      }
      const col = mongodb.collection('email_templates');
      const doc = await col.findOne({ key: type, isActive: { $ne: false } });
      if (!doc) {
        return this.buildTemplate(type as EmailTemplateType, context);
      }
      const subject = this.interpolate(String(doc.subject || ''), context) || 'Notification';
      const html: string | undefined = this.interpolate(String(doc.html || ''), context) || undefined;
      const text: string | undefined = this.interpolate(String(doc.text || ''), context) || (html ? undefined : '');
      return { subject, html, text };
    } catch {
      return this.buildTemplate(type as EmailTemplateType, context);
    }
  }

  private interpolate(template: string, context: Record<string, any>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
      const parts = String(key).split('.');
      let val: any = context;
      for (const p of parts) {
        if (val && typeof val === 'object' && p in val) val = val[p]; else return '';
      }
      return val == null ? '' : String(val);
    });
  }

  async send(options: SendEmailOptions): Promise<void> {
    if (!this.transporter) {
      // eslint-disable-next-line no-console
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

  buildTemplate(type: EmailTemplateType | string, context: any = {}): { subject: string; html: string; text: string } {
    switch (type) {
      case 'welcome_email': {
        const name = context.name || 'Customer';
        const companyName = context.companyName || 'Your ISP';
        const supportEmail = context.supportEmail || 'support@isp.local';
        const supportPhone = context.supportPhone || '+27 00 000 0000';
        const subject = `Welcome to ${companyName}`;
        const text = `Hi ${name},\n\nWelcome to ${companyName}! Your onboarding has started and our team will guide you through each step. A representative will contact you shortly and keep you updated via email.\n\nIf you need assistance, reach us at ${supportEmail} or ${supportPhone}.\n\nRegards,\n${companyName}`;
        const html = `<p>Hi ${name},</p>
<p>Welcome to <strong>${companyName}</strong>! Your onboarding has started and our team will guide you through each step. A representative will contact you shortly and keep you updated via email.</p>
<p>If you need assistance, reach us at <a href="mailto:${supportEmail}">${supportEmail}</a> or ${supportPhone}.</p>
<p>Regards,<br/>${companyName}</p>`;
        return { subject, html, text };
      }
      case 'onboarding_rep_contact_scheduled': {
        const name = context.name || 'Customer';
        const companyName = context.companyName || 'Your ISP';
        const orderNumber = context.orderNumber ? ` (Order ${context.orderNumber})` : '';
        const supportEmail = context.supportEmail || 'support@isp.local';
        const supportPhone = context.supportPhone || '+27 00 000 0000';
        const subject = `Your ${companyName} representative will contact you${orderNumber}`;
        const text = `Hi ${name},\n\nWe have scheduled a ${companyName} representative to contact you to confirm details and next steps${orderNumber}. You'll receive updates by email.\n\nQuestions? ${supportEmail} | ${supportPhone}.\n\nRegards,\n${companyName}`;
        const html = `<p>Hi ${name},</p>
<p>We have scheduled a <strong>${companyName}</strong> representative to contact you to confirm details and next steps${orderNumber}. You'll receive updates by email.</p>
<p>Questions? <a href="mailto:${supportEmail}">${supportEmail}</a> | ${supportPhone}</p>
<p>Regards,<br/>${companyName}</p>`;
        return { subject, html, text };
      }
      case 'onboarding_installation_scheduled': {
        const name = context.name || 'Customer';
        const companyName = context.companyName || 'Your ISP';
        const orderNumber = context.orderNumber ? ` (Order ${context.orderNumber})` : '';
        const installDate = context.context?.installationDate || context.installationDate || undefined;
        const windowText = installDate ? ` on ${installDate}` : '';
        const supportEmail = context.supportEmail || 'support@isp.local';
        const supportPhone = context.supportPhone || '+27 00 000 0000';
        const subject = `Installation scheduled${windowText}${orderNumber}`;
        const text = `Hi ${name},\n\nYour installation has been scheduled${windowText}${orderNumber}. We'll keep you updated if anything changes.\n\nNeed to reschedule? Contact us at ${supportEmail} or ${supportPhone}.\n\nRegards,\n${companyName}`;
        const html = `<p>Hi ${name},</p>
<p>Your installation has been scheduled${windowText}${orderNumber}. We'll keep you updated if anything changes.</p>
<p>Need to reschedule? <a href="mailto:${supportEmail}">${supportEmail}</a> or ${supportPhone}.</p>
<p>Regards,<br/>${companyName}</p>`;
        return { subject, html, text };
      }
      case 'onboarding_documents_received': {
        const name = context.name || 'Customer';
        const companyName = context.companyName || 'Your ISP';
        const orderNumber = context.orderNumber ? ` (Order ${context.orderNumber})` : '';
        const estimatedWindow = context.estimatedWindow || '3–7 business days';
        const supportEmail = context.supportEmail || 'support@isp.local';
        const supportPhone = context.supportPhone || '+27 00 000 0000';
        const subject = `Documents received${orderNumber}`;
        const text = `Hi ${name},\n\nWe have received your documents${orderNumber}. We are reviewing them now. You can expect the next update within ${estimatedWindow}.\n\nIf you have questions, contact ${supportEmail} or ${supportPhone}.\n\nRegards,\n${companyName}`;
        const html = `<p>Hi ${name},</p>
<p>We have received your documents${orderNumber}. We are reviewing them now. You can expect the next update within ${estimatedWindow}.</p>
<p>If you have questions, contact <a href="mailto:${supportEmail}">${supportEmail}</a> or ${supportPhone}.</p>
<p>Regards,<br/>${companyName}</p>`;
        return { subject, html, text };
      }
      case 'onboarding_activated': {
        const name = context.name || 'Customer';
        const companyName = context.companyName || 'Your ISP';
        const orderNumber = context.orderNumber ? ` (Order ${context.orderNumber})` : '';
        const supportEmail = context.supportEmail || 'support@isp.local';
        const supportPhone = context.supportPhone || '+27 00 000 0000';
        const subject = `Service activated${orderNumber}`;
        const text = `Hi ${name},\n\nGreat news! Your service is now active${orderNumber}. If you need help with setup or have any issues, our team is here to assist.\n\nSupport: ${supportEmail} | ${supportPhone}.\n\nThank you for choosing ${companyName}.`;
        const html = `<p>Hi ${name},</p>
<p><strong>Great news!</strong> Your service is now active${orderNumber}. If you need help with setup or have any issues, our team is here to assist.</p>
<p>Support: <a href="mailto:${supportEmail}">${supportEmail}</a> | ${supportPhone}</p>
<p>Thank you for choosing ${companyName}.</p>`;
        return { subject, html, text };
      }
      case 'onboarding_sla_warning': {
        const assignee = context.assigneeName || 'Team Member';
        const onboardingId = context.onboardingId || '';
        const currentState = context.currentState || '';
        const dueAt = context.dueAt || '';
        const elapsed = context.elapsedHours || 0;
        const sla = context.slaHours || 0;
        const subject = `SLA warning: onboarding ${onboardingId} in ${currentState}`;
        const text = `Hi ${assignee},\n\nThis is a reminder that onboarding ${onboardingId} has spent ${elapsed}h in state '${currentState}'. SLA is ${sla}h and is due at ${dueAt}.\n\nPlease take action to avoid a breach.`;
        const html = `<p>Hi ${assignee},</p>
<p>This is a reminder that onboarding <strong>${onboardingId}</strong> has spent <strong>${elapsed}h</strong> in state '<strong>${currentState}</strong>'. SLA is <strong>${sla}h</strong> and is due at <strong>${dueAt}</strong>.</p>
<p>Please take action to avoid a breach.</p>`;
        return { subject, html, text };
      }
      case 'onboarding_sla_breach': {
        const assignee = context.assigneeName || 'Team Member';
        const manager = context.managerName || 'Manager';
        const onboardingId = context.onboardingId || '';
        const currentState = context.currentState || '';
        const elapsed = context.elapsedHours || 0;
        const sla = context.slaHours || 0;
        const subject = `SLA breached: onboarding ${onboardingId} in ${currentState}`;
        const text = `Team,\n\nOnboarding ${onboardingId} breached SLA in state '${currentState}'. Elapsed: ${elapsed}h, SLA: ${sla}h.\n\n${assignee}, please action. ${manager}, escalated for visibility.`;
        const html = `<p><strong>SLA breached</strong> for onboarding <strong>${onboardingId}</strong> in state '<strong>${currentState}</strong>'.</p>
<p>Elapsed: <strong>${elapsed}h</strong> | SLA: <strong>${sla}h</strong>.</p>
<p>${assignee}, please action. ${manager}, escalated for visibility.</p>`;
        return { subject, html, text };
      }
      case 'onboarding_sla_reescalation': {
        const onboardingId = context.onboardingId || '';
        const currentState = context.currentState || '';
        const elapsed = context.elapsedHours || 0;
        const sla = context.slaHours || 0;
        const subject = `SLA re-escalation: onboarding ${onboardingId} in ${currentState}`;
        const text = `Ops,\n\nOnboarding ${onboardingId} remains in breach (state '${currentState}'). Elapsed: ${elapsed}h, SLA: ${sla}h. Further escalation required.`;
        const html = `<p><strong>SLA re-escalation</strong> for onboarding <strong>${onboardingId}</strong> in state '<strong>${currentState}</strong>'.</p>
<p>Elapsed: <strong>${elapsed}h</strong> | SLA: <strong>${sla}h</strong>.</p>
<p>Further escalation required.</p>`;
        return { subject, html, text };
      }
      default: {
        const subject = context.subject || 'Notification';
        const body = context.body || 'Hello from OMS.';
        return { subject, html: `<p>${body}</p>`, text: String(body) };
      }
    }
  }
}

// Back-compat helper for modules importing { sendEmail }
export async function sendEmail(to: string, subject: string, body: string): Promise<{ success: boolean }> {
  const svc = new NotificationService();
  await svc.send({ to, subject, text: body, html: `<p>${body}</p>` });
    return { success: true };
  }

export async function sendTestEmail(to: string): Promise<{ success: boolean }> {
  const subject = 'OMS Test Email';
  const body = 'This is a test email from OMS.';
  return sendEmail(to, subject, body);
}

