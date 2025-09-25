import { Router } from 'express';
import axios from 'axios';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { initiateOnboarding, getCustomerOnboarding, completeOnboardingStep, getTrialCustomers, getOnboardingWorkflowState, getOnboardingWorkflowHistory, getOnboardingMetrics, getOnboardingWorkflowTransitions } from '../Controllers/onboarding.controller.ts';
import { NotificationService } from '../services/notification.service.ts';


const router = Router();

router.use(authenticate);

router.post('/initiate', authorize(['onboarding:initiate']), initiateOnboarding);
router.get('/customers/:customerId', authorize(['onboarding:manage']), getCustomerOnboarding);
router.put('/:onboardingId/step/:stepId/complete', authorize(['onboarding:manage']), completeOnboardingStep);
router.get('/:onboardingId/workflow/state', authorize(['onboarding:manage']), getOnboardingWorkflowState);
router.get('/:onboardingId/workflow/history', authorize(['onboarding:manage']), getOnboardingWorkflowHistory);
router.get('/:onboardingId/workflow/transitions', authorize(['onboarding:manage']), getOnboardingWorkflowTransitions);
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

    // Local fallback: list most recent onboarding records
    const r = await db.query(
      `SELECT id, customer_id, order_id, onboarding_type, current_step, completion_percentage, assigned_to, started_at
         FROM customer_onboarding
        WHERE current_step IS NOT NULL
        ORDER BY started_at DESC
        LIMIT 100`
    );
    return res.json({ success: true, data: r.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch active onboardings' } });
  }
});

router.get('/:id', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    try {
      const resp = await axios.get(`${base}/api/onboarding/${req.params.id}`, { timeout: 4000 });
      return res.status(resp.status).json(resp.data);
    } catch {}

    const r = await db.query(`SELECT * FROM customer_onboarding WHERE id = $1 LIMIT 1`, [req.params.id]);
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

router.get('/:id/steps', authorize(['onboarding:manage']), async (req, res) => {
  const db = req.app.get('pgPool');
  try {
    // Reconcile onboarding.current_step with linked order status before returning steps
    try {
      const ob = await db.query(`SELECT id, current_step, order_id FROM customer_onboarding WHERE id = $1 LIMIT 1`, [req.params.id]);
      const orderId = ob.rows[0]?.order_id as string | undefined;
      const currentStep = (ob.rows[0]?.current_step || '') as string;
      if (orderId) {
        const ord = await db.query(`SELECT status FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
        const status = (ord.rows[0]?.status || '') as string;
        const mapStatusToStep = (s: string): string | null => {
          switch (s) {
            case 'validated': return 'initiated';
            case 'enriched': return 'requirements_confirmed';
            case 'fno_submitted': return 'provisioning_requested';
            case 'fno_accepted': return 'provisioning_in_flight';
            case 'installation_scheduled': return 'installation_scheduled';
            case 'installed': return 'installation_complete';
            case 'activated': return 'service_activated';
            case 'completed': return 'completed';
            case 'cancelled': return 'cancelled';
            default: return null;
          }
        };
        const desired = mapStatusToStep(status);
        if (desired && desired !== currentStep) {
          const setCompleted = desired === 'completed' || desired === 'cancelled';
          await db.query(
            `UPDATE customer_onboarding 
               SET current_step = $1::text,
                   completion_percentage = CASE 
                     WHEN $1::text = 'initiated' THEN 10
                     WHEN $1::text = 'requirements_confirmed' THEN 20
                     WHEN $1::text = 'provisioning_requested' THEN 30
                     WHEN $1::text = 'provisioning_in_flight' THEN 50
                     WHEN $1::text = 'installation_scheduled' THEN 60
                     WHEN $1::text = 'installation_complete' THEN 80
                     WHEN $1::text = 'service_activated' THEN 90
                     WHEN $1::text IN ('completed','cancelled') THEN 100
                     ELSE LEAST(100, COALESCE(completion_percentage, 0)) END,
                   updated_at = NOW(),
                   completed_at = CASE WHEN $2::boolean THEN NOW() ELSE completed_at END
             WHERE id = $3::uuid`,
            [desired, setCompleted, req.params.id]
          );
        }
      }
    } catch {}

    try {
      const resp = await axios.get(`${base}/api/onboarding/${req.params.id}/steps`, { timeout: 4000 });
      // Normalize with local current_step to ensure status accuracy
      const r = await db.query(`SELECT current_step FROM customer_onboarding WHERE id = $1 LIMIT 1`, [req.params.id]);
      const rawCurrent = (r.rows[0]?.current_step || 'initiated') as string;
      const alias: Record<string, string> = {
        activated: 'service_activated',
        activation: 'service_activated',
        install_scheduled: 'installation_scheduled',
        install_completed: 'installation_completed',
        rep_contact_scheduled: 'service_setup', // Map old state to new flow
        // PRD name → UI step aliases
        initiated: 'welcome_sent',
        requirements_confirmed: 'service_configuration',
        provisioning_requested: 'equipment_ordered',
        provisioning_in_flight: 'equipment_shipped',
        installation_complete: 'installation_completed'
      };
      const current = alias[rawCurrent] || rawCurrent;
      const items: any[] = Array.isArray((resp.data as any)?.data) ? (resp.data as any).data : (Array.isArray(resp.data) ? resp.data : []);
      if (items.length > 0) {
        const orderedIds = items.map(i => i.id);
        let currentIndex = orderedIds.indexOf(current);
        if (currentIndex === -1) {
          currentIndex = orderedIds.findIndex((id: string) => id === current || id.endsWith(current) || current.endsWith(id));
        }
        if (currentIndex === -1) currentIndex = 0;
        const normalized = items.map((s, idx) => ({
          ...s,
          status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'in_progress' : 'pending'
        }));
        return res.json({ success: true, data: normalized });
      }
      return res.status(resp.status).json(resp.data);
    } catch {}

    // Local fallback: derive steps from current_step using PRD-compliant workflow
    const r = await db.query(`SELECT current_step FROM customer_onboarding WHERE id = $1 LIMIT 1`, [req.params.id]);
    const rawCurrent = (r.rows[0]?.current_step || 'initiated') as string;
    const alias: Record<string, string> = {
      activated: 'service_activated',
      activation: 'service_activated',
      install_scheduled: 'installation_scheduled',
      install_completed: 'installation_completed',
      rep_contact_scheduled: 'service_setup' // Map old state to new flow
    };
    const current = alias[rawCurrent] || rawCurrent;
    
    // PRD-compliant onboarding workflow steps (matches onboarding service)
    const ordered = [
      { id: 'initiated', name: 'Onboarding Initiated', description: 'Onboarding process has been started' },
      { id: 'welcome_sent', name: 'Welcome Email Sent', description: 'Welcome email has been sent to customer' },
      { id: 'service_setup', name: 'Service Configuration', description: 'Configure service parameters and account setup' },
      { id: 'equipment_ordered', name: 'Equipment Ordered', description: 'Equipment has been ordered for installation' },
      { id: 'equipment_shipped', name: 'Equipment Shipped', description: 'Equipment has been shipped to customer' },
      { id: 'installation_scheduled', name: 'Installation Scheduled', description: 'Installation appointment has been scheduled' },
      { id: 'installation_completed', name: 'Installation Completed', description: 'Service installation has been completed' },
      { id: 'service_activated', name: 'Service Activated', description: 'Service has been activated and tested' },
      { id: 'follow_up', name: 'Follow-up & Support', description: 'Post-activation follow-up and support setup' },
      { id: 'completed', name: 'Onboarding Completed', description: 'Onboarding process has been completed successfully' },
    ];
    let currentIndex = ordered.findIndex(s => s.id === current);
    if (currentIndex === -1) {
      currentIndex = ordered.findIndex(s => s.id.endsWith(current) || current.endsWith(s.id));
    }
    if (currentIndex === -1) currentIndex = 0;
    const data = ordered.map((s, idx) => ({
      ...s,
      status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'in_progress' : 'pending'
    }));
    return res.json({ success: true, data });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch onboarding steps' } });
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
