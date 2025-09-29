import { Router } from 'express';
import axios from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { initiateOnboarding, getCustomerOnboarding, completeOnboardingStep, getTrialCustomers, getOnboardingMetrics } from '../Controllers/onboarding.controller.ts';
import { NotificationService } from '../services/notification.service.ts';


const router = Router();

router.use(authenticate);

router.post('/initiate', authorize(['onboarding:initiate']), initiateOnboarding);
router.get('/customers/:customerId', authorize(['onboarding:manage']), getCustomerOnboarding);
router.put('/:onboardingId/step/:stepId/complete', authorize(['onboarding:manage']), completeOnboardingStep);
// Deprecated workflow-specific endpoints: states, history, transitions
router.get('/:onboardingId/workflow/state', authorize(['onboarding:manage']), (req, res) => res.status(410).json({ success: false, error: { message: 'Deprecated: use orders workflow endpoints' } }));
router.get('/:onboardingId/workflow/history', authorize(['onboarding:manage']), (req, res) => res.status(410).json({ success: false, error: { message: 'Deprecated: use orders workflow endpoints' } }));
router.get('/:onboardingId/workflow/transitions', authorize(['onboarding:manage']), (req, res) => res.status(410).json({ success: false, error: { message: 'Deprecated: use orders workflow endpoints' } }));
router.get('/trial-customers', authorize(['onboarding:view_trials']), getTrialCustomers);
router.get('/metrics', authorize(['onboarding:manage', 'admin:system_monitoring']), getOnboardingMetrics);

// Proxy to onboarding-service
const base = (process.env.ONBOARDING_SERVICE_URL || 'https://microservices-oms.onrender.com').replace(/\/+$/g, '');

router.get('/active', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    // Try external service first
    try {
      const resp = await axios.get(`${base}/api/onboarding/active`, { timeout: 3000 });
      return res.status(resp.status).json(resp.data);
    } catch {}

    // Local fallback: list most recent active onboarding records (exclude completed/cancelled)
    const r = await db.query(
      `SELECT id, customer_id, order_id, onboarding_type, current_step, completion_percentage, assigned_to, started_at
         FROM customer_onboarding
        WHERE current_step IS NOT NULL
          AND (completed_at IS NULL)
          AND LOWER(current_step) NOT IN ('completed','cancelled')
        ORDER BY started_at DESC
        LIMIT 100`
    );
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch active onboardings' } });
  }
});

// Completion metrics: overall and by order_type for a given period
// Query params: periodDays (default 30)
router.get('/metrics/completion', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const periodDays = Math.max(1, Math.min(180, parseInt(String(req.query.periodDays || '30'))));
    const r = await db.query(
      `WITH scoped AS (
         SELECT co.id, co.started_at, co.completed_at, co.completion_percentage, o.order_type
           FROM customer_onboarding co
           LEFT JOIN orders o ON o.id = co.order_id
          WHERE co.started_at >= NOW() - ($1 || ' days')::interval
        )
       SELECT
         'overall' AS bucket,
         NULL::text AS order_type,
         COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_count,
         COUNT(*) AS total_started,
         ROUND(
           CASE WHEN COUNT(*) = 0 THEN 0
                ELSE 100.0 * COUNT(*) FILTER (WHERE completed_at IS NOT NULL) / COUNT(*) END
           , 2) AS completion_rate_pct,
         ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL), 2) AS avg_duration_seconds
       FROM scoped
       UNION ALL
       SELECT
         'by_type' AS bucket,
         order_type,
         COUNT(*) FILTER (WHERE completed_at IS NOT NULL) AS completed_count,
         COUNT(*) AS total_started,
         ROUND(
           CASE WHEN COUNT(*) = 0 THEN 0
                ELSE 100.0 * COUNT(*) FILTER (WHERE completed_at IS NOT NULL) / COUNT(*) END
           , 2) AS completion_rate_pct,
         ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at))) FILTER (WHERE completed_at IS NOT NULL), 2) AS avg_duration_seconds
       FROM scoped
       GROUP BY order_type
       ORDER BY bucket DESC, order_type NULLS LAST`
      , [periodDays]
    );
    return res.json({ success: true, data: r.rows, periodDays });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to compute completion metrics' } });
  }
});

// Alternate path to avoid any router collisions in some environments
router.get('/list/completed', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const r = await db.query(
      `SELECT 
         co.id,
         co.customer_id,
         co.order_id,
         o.order_type,
         co.current_step,
         COALESCE(co.completion_percentage, 100) AS completion_percentage,
         co.started_at,
         co.completed_at,
         EXTRACT(EPOCH FROM (co.completed_at - co.started_at))::bigint AS duration_seconds
       FROM customer_onboarding co
       LEFT JOIN orders o ON o.id = co.order_id
       WHERE co.completed_at IS NOT NULL
       ORDER BY co.completed_at DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch completed onboardings' } });
  }
});

// Completed onboarding records with completion metrics (place BEFORE dynamic :id routes)
// (Removed duplicate later definition to avoid route shadowing)

router.get('/:id', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const id = String(req.params.id || '').trim();
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
    if (!isUuid.test(id)) {
      return res.status(404).json({ success: false, error: { message: 'Onboarding not found' } });
    }
    try {
      const resp = await axios.get(`${base}/api/onboarding/${req.params.id}`, { timeout: 4000 });
      return res.status(resp.status).json(resp.data);
    } catch {}

    const r = await db.query(`SELECT * FROM customer_onboarding WHERE id = $1 LIMIT 1`, [id]);
    if (!r.rows[0]) return res.status(404).json({ success: false, error: { message: 'Onboarding not found' } });
    return res.json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch onboarding' } });
  }
});

router.patch('/:id/assign', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.patch(`${base}/api/onboarding/${req.params.id}/assign`, req.body, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to assign onboarding' } });
  }
});

router.post('/:id/notify', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const { to, subject, html, text, template, context } = req.body || {};
    if (!to) {
      return res.status(400).json({ success: false, error: { message: 'to is required' } });
    }
    const service = new NotificationService();
    if (template) {
      const built = await service.buildTemplateAsync(template, context || {} as any);
      await service.send({ to, subject: built.subject, html: built.html, text: built.text });
    } else {
      if (!subject) {
        return res.status(400).json({ success: false, error: { message: 'subject is required when no template is provided' } });
      }
      await service.send({ to, subject, html, text });
    }
    return res.json({ success: true });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to send notification' } });
  }
});

// Step/Progress management proxies
router.put('/:id/step/:stepId', authorize(['onboarding:manage']), async (req, res) => {
  try {
    const resp = await axios.put(`${base}/api/onboarding/${req.params.id}/step/${req.params.stepId}`, req.body, { timeout: 10000 });
    res.status(resp.status).json(resp.data);
  } catch (e: any) {
    res.status(e?.response?.status || 500).json(e?.response?.data || { success: false, error: { message: 'Failed to update onboarding step' } });
  }
});

// Deprecated: steps endpoint (UI mirrors order workflow; keep SLA/assignment in onboarding)
router.get('/:id/steps', authorize(['onboarding:manage']), async (_req, res) => {
  return res.status(410).json({ success: false, error: { message: 'Deprecated: onboarding steps are mirrored from order workflow' } });
});

// Completed onboarding records with completion metrics
router.get('/completed', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    const r = await db.query(
      `SELECT 
         co.id,
         co.customer_id,
         co.order_id,
         o.order_type,
         co.current_step,
         COALESCE(co.completion_percentage, 100) AS completion_percentage,
         co.started_at,
         co.completed_at,
         EXTRACT(EPOCH FROM (co.completed_at - co.started_at))::bigint AS duration_seconds
       FROM customer_onboarding co
       LEFT JOIN orders o ON o.id = co.order_id
       WHERE co.completed_at IS NOT NULL
       ORDER BY co.completed_at DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch completed onboardings' } });
  }
});

// Danger: dev/reset utility to purge onboarding data for testing
router.delete('/reset-all', authorize(['admin:system_config']), async (req, res) => {
  const db = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    await db.query('BEGIN');
    // Delete workflow instances first (history will cascade)
    await db.query(`DELETE FROM onboarding_workflow_instances`);
    // Delete onboarding records
    await db.query(`DELETE FROM customer_onboarding`);
    await db.query('COMMIT');

    // Best-effort: clear SLA dedupe keys
    try {
      const keys = await redis.keys('sla:*');
      if (keys && keys.length) await redis.del(keys);
    } catch {}

    return res.json({ success: true, message: 'Onboarding data purged' });
  } catch (e: any) {
    try { await db.query('ROLLBACK'); } catch {}
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to reset onboarding data' } });
  }
});

export default router;
