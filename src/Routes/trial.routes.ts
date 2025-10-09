import { Router } from 'express';
import axios, { AxiosError } from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { OrdersService } from '../services/orders.service.ts';
import dotenv from 'dotenv';
dotenv.config();

const router = Router();

const TRIAL_SERVICE_URL = process.env.TRIAL_SERVICE_URL;
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;
const TIMEOUT = 30000; // Increased from 10s to 30s for cold starts

/**
 * Retry helper with exponential backoff
 */
async function retryRequest<T>(
  requestFn: () => Promise<T>,
  retries = MAX_RETRIES,
  delay = INITIAL_RETRY_DELAY
): Promise<T> {
  try {
    return await requestFn();
  } catch (error) {
    const axiosError = error as AxiosError;
    const status = axiosError.response?.status;
    
    // Don't retry on client errors (4xx) except 408 (timeout)
    if (status && status >= 400 && status < 500 && status !== 408) {
      throw error;
    }
    
    // Retry on 502, 503, 504, or network errors
    if (retries > 0 && (!status || status >= 502)) {
      console.log(`Retrying request. Attempts remaining: ${retries}`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryRequest(requestFn, retries - 1, delay * 2);
    }
    
    throw error;
  }
}

/**
 * Standardized error handler
 */
function handleProxyError(error: unknown, res: Response, context: string) {
  console.error(`Error ${context}:`, error);
  
  if (axios.isAxiosError(error)) {
    const status = error.response?.status || 503;
    const errorMessage = error.response?.data?.error || 'Trial service unavailable';
    
    return res.status(status).json({
      success: false,
      error: errorMessage,
      context
    });
  }
  
  return res.status(500).json({
    success: false,
    error: 'Internal server error',
    context
  });
}

// Optional service-to-service bypass using a shared token
function serviceKeyAuth(req: any, _res: any, next: any) {
  try {
    const svcToken = process.env.SERVICE_TOKEN;
    const headerToken = (req.headers['x-service-key'] || req.headers['x-service-api-key'] || '') as string;
    const auth = (req.headers['authorization'] || '') as string;
    if (svcToken && (headerToken === svcToken || auth === `Bearer ${svcToken}`)) {
      req.user = req.user || {};
      req.user.permissions = Array.isArray(req.user.permissions)
        ? Array.from(new Set([...req.user.permissions, 'admin:view_trials', 'admin:manage_trials']))
        : ['admin:view_trials', 'admin:manage_trials'];
      return next();
    }
  } catch {}
  return next();
}

// Backward compatibility: handle legacy '/trials/trials/*' paths
router.use('/trials', (req, _res, next) => {
  req.url = req.url.replace(/^\/trials\b/, '');
  next();
});

// Health check endpoint (no auth required, always returns 200)
router.get('/health', async (req, res) => {
  try {
    const resp = await axios.get(`${TRIAL_SERVICE_URL}/health`, { 
      timeout: 5000, 
      validateStatus: () => true 
    });
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

// Get active trials with retry logic
router.get('/status/active', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/active`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying active trials request');
  }
});

// Get expiring trials with retry logic
router.get('/status/expiring', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/status/expiring`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying expiring trials request');
  }
});

// Get trial analytics with safe fallback
router.get('/analytics', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/analytics`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
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

// Get trial by customer ID
router.get('/customer/:customerId', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/customer/${req.params.customerId}`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial by customer request');
  }
});

// Get trial workflow
router.get('/:id/workflow', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/workflow`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial workflow request');
  }
});

// Campaign summary by order
router.get('/order/:orderId/campaigns/summary', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/order/${req.params.orderId}/campaigns/summary`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying campaign summary by order request');
  }
});

// Convert trial (with auto-activation)
router.post('/:id/convert', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req: Request, res: Response) => {
  try {
    const convertResp = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/convert`, 
        req.body,
        { 
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );

    // Best-effort: auto-activate related order when trial converts
    try {
      const trialResp = await axios.get(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, 
        { timeout: 10000 }
      );
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
    handleProxyError(error, res, 'proxying trial conversion request');
  }
});

// Cancel trial
router.post('/:id/cancel', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/trials/${req.params.id}/cancel`, 
        req.body,
        { 
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial cancellation request');
  }
});

// Transition trial state (convert|cancel|expire)
router.post('/:id/transition', serviceKeyAuth, authenticate, authorize(['admin:manage_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.post(
        `${TRIAL_SERVICE_URL}/api/internal/trials/${req.params.id}/transition`, 
        req.body, 
        {
          timeout: TIMEOUT,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial transition request');
  }
});

// Get trial by ID (must be last to avoid shadowing specific routes)
router.get('/:id', serviceKeyAuth, authenticate, authorize(['admin:view_trials']), async (req, res) => {
  try {
    const { data } = await retryRequest(() =>
      axios.get(`${TRIAL_SERVICE_URL}/api/trials/${req.params.id}`, {
        timeout: TIMEOUT,
        headers: { 'Accept': 'application/json' }
      })
    );
    res.json(data);
  } catch (error) {
    handleProxyError(error, res, 'proxying trial request');
  }
});

export default router;