import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';
import { NotificationService } from '../services/notification.service.ts';
import { OnboardingWorkflowService } from '../services/onboarding-workflow.service.ts';

export async function getOnboardingWorkflowTransitions(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { onboardingId } = req.params as any;
  try {
    const wf = new OnboardingWorkflowService(db);
    const definitionId = await wf.getActiveDefinitionId();
    const inst = await wf.ensureInstance(onboardingId);
    const states = await wf.getStates(definitionId);
    const byId = new Map(states.map(s => [s.id, s] as const));
    const current = byId.get(inst.currentStateId as any);
    const fromId = inst.currentStateId;
    const transitions = await wf.getValidTransitions(definitionId, fromId);
    const payload = transitions.map(t => ({
      fromState: byId.get(t.fromStateId)?.stateName || 'unknown',
      toState: byId.get(t.toStateId)?.stateName || 'unknown',
      name: t.transitionName || null
    }));
    return res.json({ success: true, data: { current: current?.stateName || 'initiated', transitions: payload } });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch transitions' } });
  }
}

export async function initiateOnboarding(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { customerId, orderId, onboardingType, assignedTo } = req.body;
  try {
    // Enforce: only one active onboarding per customer
    const active = await db.query(
      `SELECT id FROM customer_onboarding 
         WHERE customer_id = $1 
           AND (completed_at IS NULL) 
           AND (current_step IS NULL OR current_step <> 'completed')
         ORDER BY started_at DESC LIMIT 1`,
      [customerId]
    );
    if (active.rows[0]) {
      return res.status(400).json({ success: false, error: { message: 'Customer already has an active onboarding' } });
    }

    // Require an associated order: ensure at least one order exists for this customer
    const orderRow = await db.query(
      `SELECT id FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [customerId]
    );
    const effectiveOrderId = orderId || orderRow.rows[0]?.id || null;
    if (!effectiveOrderId) {
      return res.status(400).json({ success: false, error: { message: 'Onboarding requires an existing order for the customer' } });
    }

    // Resolve customer snapshot info
    const cust = await db.query(
      `SELECT email, first_name, last_name FROM customers WHERE id = $1 LIMIT 1`,
      [customerId]
    );
    const snapEmail = cust.rows[0]?.email || null;
    const snapFirst = cust.rows[0]?.first_name || null;
    const snapLast = cust.rows[0]?.last_name || null;

    const result = await db.query(
      `INSERT INTO customer_onboarding (customer_id, order_id, onboarding_type, current_step, completion_percentage, assigned_to, customer_email, customer_first_name, customer_last_name)
       VALUES ($1, $2, $3, 'welcome_sent', 10, $4, $5, $6, $7)
       RETURNING id`,
      [customerId, effectiveOrderId, onboardingType, assignedTo || null, snapEmail, snapFirst, snapLast]
    );

    // Invalidate onboarding cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['onboarding']));

    // Send welcome email (non-blocking best-effort)
    try {
      const svc = new NotificationService();
      // Fetch customer email and name
      const customer = await db.query(
        `SELECT COALESCE(co.customer_email, c.email) AS email,
                COALESCE(co.customer_first_name, c.first_name) AS first_name,
                COALESCE(co.customer_last_name, c.last_name) AS last_name
           FROM customer_onboarding co
           LEFT JOIN customers c ON c.id = co.customer_id
          WHERE co.id = $1
          LIMIT 1`,
        [result.rows[0].id]
      );
      const to = (customer.rows[0]?.email || undefined) as string | undefined;
      if (to) {
        // Fetch order number if provided
        let orderNumber: string | undefined;
        if (orderId) {
          const order = await db.query(`SELECT order_number FROM orders WHERE id = $1 LIMIT 1`, [orderId]);
          orderNumber = order.rows[0]?.order_number as string | undefined;
        }
        const name = [customer.rows[0]?.first_name, customer.rows[0]?.last_name].filter(Boolean).join(' ') || 'Customer';
        const companyName = process.env.COMPANY_NAME || 'Your ISP';
        const supportEmail = process.env.SUPPORT_EMAIL || 'support@isp.local';
        const supportPhone = process.env.SUPPORT_PHONE || '+27 00 000 0000';
        const estimatedWindow = process.env.ONBOARDING_ESTIMATE || '3–7 business days';

        const built = await svc.buildTemplateAsync('welcome_email', {
          name,
          companyName,
          orderNumber,
          estimatedWindow,
          supportEmail,
          supportPhone,
          to,
        });
        await svc.send({ to, subject: built.subject, html: built.html, text: built.text });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] welcome email failed:', e);
    }

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getCustomerOnboarding(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { customerId } = req.params as any;
  try {
    const cache = new CacheService(redis, 120); // 2 minute cache for onboarding
    const cacheKey = buildCacheKey(['onboarding:customer', customerId]);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `SELECT * FROM customer_onboarding WHERE customer_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [customerId]
    );
    const payload = { success: true, data: result.rows[0] || null };
    await cache.setJson(cacheKey, payload, 120);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function completeOnboardingStep(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { onboardingId, stepId } = req.params as any;
  const { notes, reason, context } = req.body || {};
  try {
    // Guard: disallow updates when onboarding is in a terminal state
    const term = await db.query(
      `SELECT current_step FROM customer_onboarding WHERE id = $1 LIMIT 1`,
      [onboardingId]
    );
    const current = (term.rows[0]?.current_step || '').toString();
    if (current === 'cancelled' || current === 'completed') {
      return res.status(400).json({ success: false, error: { message: `Onboarding is ${current}; steps cannot be updated` } });
    }

    // Enforce workflow
    const wf = new OnboardingWorkflowService(db);
    const actorId = (req as any).user?.userId as string | undefined;

    // Compute duration_seconds since last transition
    const inst = await db.query(
      `SELECT i.id
         FROM onboarding_workflow_instances i
        WHERE i.onboarding_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [onboardingId]
    );
    let durationSeconds = 0;
    if (inst.rows[0]) {
      const last = await db.query(
        `SELECT occurred_at FROM onboarding_workflow_execution_history WHERE instance_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [inst.rows[0].id]
      );
      if (last.rows[0]) {
        const diffMs = Date.now() - new Date(last.rows[0].occurred_at).getTime();
        durationSeconds = Math.max(0, Math.floor(diffMs / 1000));
      }
    }

    const result = await wf.transition(onboardingId, stepId, actorId, reason || notes || null, context || null);

    // Update friendly progress fields
    await db.query(
      `UPDATE customer_onboarding 
         SET current_step = $1, completion_percentage = LEAST(100, completion_percentage + 10), updated_at = NOW(), notes = COALESCE($2, notes)
       WHERE id = $3`,
      [result.currentStateName, notes || null, onboardingId]
    );

    // Invalidate onboarding cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['onboarding']));

    // Send step-specific email notification (best-effort, non-blocking)
    try {
      const svc = new NotificationService();
      const customer = await db.query(
        `SELECT email, first_name, last_name FROM customers WHERE id = (SELECT customer_id FROM customer_onboarding WHERE id = $1) LIMIT 1`,
        [onboardingId]
      );
      const to = customer.rows[0]?.email as string | undefined;
      if (to) {
        let orderNumber: string | undefined;
        const ord = await db.query(
          `SELECT o.order_number FROM orders o JOIN customer_onboarding co ON co.order_id = o.id WHERE co.id = $1 LIMIT 1`,
          [onboardingId]
        );
        orderNumber = ord.rows[0]?.order_number as string | undefined;
        const name = [customer.rows[0]?.first_name, customer.rows[0]?.last_name].filter(Boolean).join(' ') || 'Customer';
        const companyName = process.env.COMPANY_NAME || 'Your ISP';
        const supportEmail = process.env.SUPPORT_EMAIL || 'support@isp.local';
        const supportPhone = process.env.SUPPORT_PHONE || '+27 00 000 0000';
        const estimatedWindow = process.env.ONBOARDING_ESTIMATE || '3–7 business days';

        const templateKey = `onboarding_${result.currentStateName}`;
        const built = await svc.buildTemplateAsync(templateKey, {
          name,
          companyName,
          orderNumber,
          supportEmail,
          supportPhone,
          estimatedWindow,
          to,
          context: context || {},
        });
        await svc.send({ to, subject: built.subject, html: built.html, text: built.text });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[onboarding] step email failed:', e);
    }

    res.json({ success: true, state: result.currentStateName, durationSeconds });
  } catch (error: any) {
    const message = error?.message || 'Failed to complete onboarding step';
    if (/Invalid transition|Unknown onboarding state|No start state/.test(message)) {
      return res.status(400).json({ success: false, error: { message } });
    }
    res.status(500).json({ success: false, error: { message } });
  }
}

export async function getOnboardingWorkflowState(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { onboardingId } = req.params as any;
  try {
    const def = await db.query(`SELECT id FROM onboarding_workflow_definitions WHERE is_active = true ORDER BY version DESC LIMIT 1`);
    if (!def.rows[0]) return res.status(404).json({ success: false, error: { message: 'No active onboarding workflow' } });
    const inst = await db.query(
      `SELECT i.id, s.state_name AS state
         FROM onboarding_workflow_instances i
         JOIN onboarding_workflow_states s ON s.id = i.current_state_id
        WHERE i.definition_id = $1 AND i.onboarding_id = $2
        LIMIT 1`,
      [def.rows[0].id, onboardingId]
    );
    if (!inst.rows[0]) return res.json({ success: true, state: 'initiated' });
    res.json({ success: true, state: inst.rows[0].state });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch state' } });
  }
}

export async function getOnboardingWorkflowHistory(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { onboardingId } = req.params as any;
  try {
    const rows = await db.query(
      `SELECT h.occurred_at,
              fs.state_name AS from_state,
              ts.state_name AS to_state,
              h.transition_name,
              h.actor_id,
              h.actor_type,
              h.reason,
              h.duration_seconds
         FROM onboarding_workflow_instances i
         JOIN onboarding_workflow_execution_history h ON h.instance_id = i.id
         LEFT JOIN onboarding_workflow_states fs ON fs.id = h.from_state_id
         LEFT JOIN onboarding_workflow_states ts ON ts.id = h.to_state_id
        WHERE i.onboarding_id = $1
        ORDER BY h.occurred_at ASC`,
      [onboardingId]
    );
    res.json({ success: true, history: rows.rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e?.message || 'Failed to fetch history' } });
  }
}

export async function getTrialCustomers(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 300); // 5 minute cache for trial customers
    const cacheKey = buildCacheKey(['customers:trial']);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `SELECT id, customer_number, first_name || ' ' || last_name as name, email, trial_start_date, trial_end_date
       FROM customers WHERE is_trial = true ORDER BY trial_end_date ASC`
    );
    const payload = { success: true, data: { customers: result.rows, total: result.rows.length } };
    await cache.setJson(cacheKey, payload, 300);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getOnboardingMetrics(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 60); // 1 minute cache for metrics
    const cacheKey = buildCacheKey(['onboarding:metrics']);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get SLA status for all active onboarding instances
    const slaData = await db.query(
      `SELECT 
         i.onboarding_id,
         s.state_name AS current_state,
         s.sla_hours,
         co.assigned_to,
         au.first_name || ' ' || au.last_name AS assignee_name,
         au.email AS assignee_email,
         (SELECT h.occurred_at
            FROM onboarding_workflow_execution_history h
           WHERE h.instance_id = i.id
           ORDER BY h.occurred_at DESC
           LIMIT 1) AS last_change,
         (SELECT COUNT(*)
            FROM onboarding_workflow_execution_history h2
           WHERE h2.instance_id = i.id
             AND h2.transition_name IN ('sla_warning', 'sla_breach', 'sla_reescalation')) AS sla_alerts_count
       FROM onboarding_workflow_instances i
       JOIN onboarding_workflow_states s ON s.id = i.current_state_id
       JOIN customer_onboarding co ON co.id = i.onboarding_id
       LEFT JOIN users au ON au.id = co.assigned_to
      WHERE s.sla_hours IS NOT NULL AND s.sla_hours > 0`
    );

    const now = Date.now();
    const slaStatuses = slaData.rows.map((r: any) => {
      const last = r.last_change ? new Date(r.last_change).getTime() : null;
      if (!last) return { ...r, slaStatus: 'unknown', elapsedHours: 0, dueAt: null, slaPercentage: 0 };
      
      const elapsedHours = (now - last) / 1000 / 3600;
      const slaHours = Number(r.sla_hours);
      const slaPercentage = (elapsedHours / slaHours) * 100;
      const dueAt = new Date(last + slaHours * 3600 * 1000).toISOString();
      
      let slaStatus = 'ok';
      if (slaPercentage >= 150) slaStatus = 'reescalated';
      else if (slaPercentage >= 100) slaStatus = 'breached';
      else if (slaPercentage >= 75) slaStatus = 'warning';
      
      return {
        onboardingId: r.onboarding_id,
        currentState: r.current_state,
        slaHours,
        elapsedHours,
        slaPercentage,
        dueAt,
        slaStatus,
        assigneeName: r.assignee_name,
        assigneeEmail: r.assignee_email,
        slaAlertsCount: Number(r.sla_alerts_count)
      };
    });

    // Calculate summary metrics
    const total = slaStatuses.length;
    const warning = slaStatuses.filter(s => s.slaStatus === 'warning').length;
    const breached = slaStatuses.filter(s => s.slaStatus === 'breached').length;
    const reescalated = slaStatuses.filter(s => s.slaStatus === 'reescalated').length;
    const avgTimeInState = slaStatuses.length > 0 
      ? slaStatuses.reduce((sum, s) => sum + s.elapsedHours, 0) / slaStatuses.length 
      : 0;

    const payload = {
      success: true,
      data: {
        summary: {
          total,
          warning,
          breached,
          reescalated,
          avgTimeInState: Math.round(avgTimeInState * 100) / 100
        },
        slaStatuses
      }
    };
    
    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}
