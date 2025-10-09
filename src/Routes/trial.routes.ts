import { Router } from 'express';
import axios from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { OrdersService } from '../services/orders.service.ts';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

const TRIAL_SERVICE_URL = process.env.TRIAL_SERVICE_URL;

// Optional service-to-service bypass using a shared token
function serviceKeyAuth(req: any, _res: any, next: any) {
  try {
    const svcToken = process.env.SERVICE_TOKEN;
    const headerToken = (req.headers['x-service-key'] || req.headers['x-service-api-key'] || '') as string;
    const auth = (req.headers['authorization'] || '') as string;
    if (svcToken && (headerToken === svcToken || auth === `Bearer ${svcToken}`)) {
      // Grant minimal permissions for trials
      req.user = req.user || {};
      req.user.permissions = Array.isArray(req.user.permissions)
        ? Array.from(new Set([...req.user.permissions, 'admin:view_trials', 'admin:manage_trials']))
        : ['admin:view_trials', 'admin:manage_trials'];
      return next();
    }
  } catch {}
  return next();
}

// Backward compatibility: handle legacy '/trials/trials/*' paths by stripping the extra segment
router.use('/trials', (req, _res, next) => {
  // Remove the first '/trials' segment so '/trials/trials/status/active' -> '/status/active'
  req.url = req.url.replace(/^\/trials\b/, '');
  next();
});

// IMPORTANT: Place specific routes before parametric ':id' to avoid shadowing

// Proxy to microservice - Get trial by customer ID
router.get('/customer/:customerId', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/customer/${req.params.customerId}`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial by customer request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Proxy to microservice - Get active trials
router.get('/status/active', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/active`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying active trials request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Proxy to microservice - Get expiring trials
router.get('/status/expiring', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/expiring`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying expiring trials request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Proxy to microservice - Get trial analytics
router.get('/analytics', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/analytics`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial analytics request:', error);
    // Return safe defaults to avoid breaking the UI
    return res.status(200).json({
      success: true,
      data: {
        totalTrials: 0,
        activeTrials: 0,
        convertedTrials: 0,
        expiredTrials: 0,
        conversionRate: '0%',
        engagementDistribution: { HOT: 0, WARM: 0, COLD: 0 },
        usageStats: { avgDataUsedGB: 0, avgLogins: 0 },
        campaignStats: { total: 0, sent: 0, failed: 0, pending: 0, successRate: '0%' }
      }
    });
  }
});

// Proxy to microservice - Get trial workflow
router.get('/:id/workflow', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/workflow`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial workflow request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

// Proxy to microservice - Transition trial state (convert|cancel|expire)
router.post('/:id/transition', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    const { data } = await axios.post(`${TRIAL_SERVICE_URL}/api/internal/trials/${req.params.id}/transition`, req.body, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial transition request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});

// Proxy to microservice - Campaign summary by order
router.get('/order/:orderId/campaigns/summary', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/order/${req.params.orderId}/campaigns/summary`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying campaign summary by order request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
});
// Proxy to microservice - Convert trial
router.post('/:id/convert', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req: Request, res: Response) => {
  try {
    const convertResp = await axios.post(
      `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/convert`, 
      req.body,
      { timeout: 10000 }
    );

    // Best-effort: auto-activate related order when trial converts
    try {
      const trialResp = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, { timeout: 10000 });
      const orderId: string | undefined = trialResp?.data?.data?.trial?.orderId || trialResp?.data?.trial?.orderId;
      if (orderId) {
        const db: Pool = req.app.get('pgPool');
        const fnoComm = new (await import('../services/fno-communication.service.ts')).FNOCommunicationService((req.app as any).get('mongoClient'));
        const policy = new (await import('../services/policy.service.ts')).PolicyService((req.app as any).get('mongoClient'));
        const ordersService = new OrdersService(db, fnoComm, policy);
        await ordersService.transitionOrder(orderId, 'activated' as any, 'system', 'Trial converted -> auto-activate');
      }
    } catch (e) {
      console.warn('[trials] post-convert activation skipped:', (e as any)?.message || e);
    }

    res.json(convertResp.data);
  } catch (error) {
    console.error('Error proxying trial conversion request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Proxy to microservice - Cancel trial
router.post('/:id/cancel', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    const { data } = await axios.post(
      `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/cancel`, 
      req.body,
      { timeout: 10000 }
    );
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial cancellation request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

// Internal endpoint for trial service health check (always 200)
router.get('/health', async (req, res) => {
  try {
    const resp = await axios.get(`${TRIAL_SERVICE_URL}/health`, { timeout: 5000, validateStatus: () => true });
    return res.status(200).json({
      success: true,
      status: resp.status,
      data: resp.data,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('Trial service health check failed:', error?.message || error);
    return res.status(200).json({
      success: true,
      status: 503,
      data: { status: 'unreachable' },
      timestamp: new Date().toISOString()
    });
  }
});

// Proxy to microservice - Get trial by ID (must be last to avoid shadowing /health etc.)
router.get('/:id', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, {
      timeout: 10000
    });
    res.json(data);
  } catch (error) {
    console.error('Error proxying trial request:', error);
    if (axios.isAxiosError(error)) {
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Trial service unavailable'
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  }
});

export default router;

