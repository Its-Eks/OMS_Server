import { Router } from 'express';
import { sendEmail, sendTestEmail, verifyEmailTransport } from '../services/notification.service.ts';

const router = Router();

router.get('/test', async (req, res) => {
  try {
    const to = (req.query.to as string) || 'test@local.dev';
    const result = await sendTestEmail(to);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.post('/send', async (req, res) => {
  try {
    const { to, subject, text, html, from } = req.body || {};
    if (!to || !subject) {
      return res.status(400).json({ success: false, error: 'to and subject are required' });
    }
    const result = await sendEmail({ to, subject, text, html, from });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, error: String(err) });
  }
});

router.get('/health', async (_req, res) => {
  const status = await verifyEmailTransport();
  res.status(status.ok ? 200 : 500).json({ success: status.ok, ...status });
});

export default router;

