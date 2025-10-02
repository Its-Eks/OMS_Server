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
    // Simple service authentication check
    const serviceApiKey = req.headers['x-service-api-key'] as string;
    const expectedApiKey = process.env.ONBOARDING_SERVICE_API_KEY;
    
    if (serviceApiKey && expectedApiKey && serviceApiKey === expectedApiKey) {
      console.log('[EmailRoute] Service-to-service request authenticated');
    } else if (req.user || req.headers.authorization) {
      console.log('[EmailRoute] User request authenticated');
    } else if (!expectedApiKey || process.env.NODE_ENV === 'development') {
      console.log('[EmailRoute] Development mode, allowing request');
    } else {
      console.log('[EmailRoute] Unauthenticated request (allowed for now)');
    }

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

