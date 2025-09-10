import nodemailer from 'nodemailer';

type BasicEmail = {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  from?: string;
};

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
export class NotificationService {
  async sendEmail(to: string, subject: string, body: string) {
    // TODO: Integrate with real email service
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
