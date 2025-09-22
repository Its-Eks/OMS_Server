import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { NotificationService } from './notification.service.ts';

export interface SlaSchedulerOptions {
  intervalMs?: number;
  warnThresholdPct?: number; // e.g., 0.75
  reescalateThresholdPct?: number; // e.g., 1.5
  opsEmail?: string | null;
}

export class OnboardingSlaScheduler {
  private timer: NodeJS.Timeout | null = null;
  private readonly db: Pool;
  private readonly redis: Redis;
  private readonly opts: Required<SlaSchedulerOptions>;

  constructor(db: Pool, redis: Redis, opts?: SlaSchedulerOptions) {
    this.db = db;
    this.redis = redis;
    this.opts = {
      intervalMs: opts?.intervalMs ?? Number(process.env.SLA_SCHEDULER_INTERVAL_MS || 300000),
      warnThresholdPct: opts?.warnThresholdPct ?? 0.75,
      reescalateThresholdPct: opts?.reescalateThresholdPct ?? 1.5,
      opsEmail: opts?.opsEmail ?? (process.env.OPS_EMAIL || null),
    } as Required<SlaSchedulerOptions>;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.run().catch(err => console.warn('[sla] run error', err));
    }, this.opts.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async markNotified(key: string): Promise<boolean> {
    // returns true if just set, false if already notified recently
    const existed = await this.redis.get(key);
    if (existed) return false;
    await this.redis.set(key, '1', 'EX', 3600); // 1 hour dedupe
    return true;
  }

  async run(): Promise<void> {
    // fetch active onboarding instances with current state, SLA, last occurred_at, assigned user, manager
    const rows = await this.db.query(
      `SELECT i.id AS instance_id,
              i.onboarding_id,
              s.state_name AS current_state,
              s.sla_hours,
              co.assigned_to,
              au.first_name || ' ' || au.last_name AS assignee_name,
              au.email AS assignee_email,
              mu.first_name || ' ' || mu.last_name AS manager_name,
              mu.email AS manager_email,
              (SELECT h.occurred_at
                 FROM onboarding_workflow_execution_history h
                WHERE h.instance_id = i.id
                ORDER BY h.occurred_at DESC
                LIMIT 1) AS last_change
         FROM onboarding_workflow_instances i
         JOIN onboarding_workflow_states s ON s.id = i.current_state_id
         JOIN customer_onboarding co ON co.id = i.onboarding_id
         LEFT JOIN users au ON au.id = co.assigned_to
         LEFT JOIN users mu ON mu.id = au.reporting_manager_id
        WHERE s.sla_hours IS NOT NULL AND s.sla_hours > 0`
    );

    const now = Date.now();
    let svc: NotificationService | null = null;
    try {
      svc = new NotificationService();
    } catch {
      // Notifications disabled when Mongo is not available
      svc = null;
    }

    for (const r of rows.rows) {
      const last = r.last_change ? new Date(r.last_change).getTime() : null;
      if (!last) continue;
      const elapsedHours = (now - last) / 1000 / 3600;
      const slaHours = Number(r.sla_hours);
      const pct = elapsedHours / slaHours;
      const dueAt = new Date(last + slaHours * 3600 * 1000).toISOString();

      const warnKey = `sla:warn:${r.instance_id}:${Math.floor(slaHours * this.opts.warnThresholdPct)}`;
      const breachKey = `sla:breach:${r.instance_id}`;
      const reescKey = `sla:reesc:${r.instance_id}`;

      // 75% warning
      if (pct >= this.opts.warnThresholdPct && pct < 1) {
        if (await this.markNotified(warnKey)) {
          const to = r.assignee_email || r.manager_email;
          if (svc && to) {
            const built = await svc.buildTemplateAsync('onboarding_sla_warning', {
              assigneeName: r.assignee_name || 'Team Member',
              onboardingId: r.onboarding_id,
              currentState: r.current_state,
              slaHours,
              elapsedHours, 
              dueAt,
            });
            await svc.send({ to, subject: built.subject, html: built.html, text: built.text });
          }
          await this.db.query(
            `INSERT INTO onboarding_workflow_execution_history (instance_id, from_state_id, to_state_id, transition_name, actor_type, reason, duration_seconds)
             VALUES ($1, NULL, NULL, 'sla_warning', 'scheduler', $2, $3)`,
            [r.instance_id, `Approaching SLA in ${r.current_state}`, Math.floor(elapsedHours * 3600)]
          );
        }
      }

      // 100% breach
      if (pct >= 1 && pct < this.opts.reescalateThresholdPct) {
        if (await this.markNotified(breachKey)) {
          const emails: string[] = [];
          if (r.assignee_email) emails.push(r.assignee_email);
          if (r.manager_email) emails.push(r.manager_email);
          const to = emails.join(',');
          if (svc && to) {
            const built = await svc.buildTemplateAsync('onboarding_sla_breach', {
              assigneeName: r.assignee_name || 'Team Member',
              managerName: r.manager_name || 'Manager',
              onboardingId: r.onboarding_id,
              currentState: r.current_state,
              slaHours,
              elapsedHours,
            });
            await svc.send({ to, subject: built.subject, html: built.html, text: built.text });
          }
          await this.db.query(
            `INSERT INTO onboarding_workflow_execution_history (instance_id, from_state_id, to_state_id, transition_name, actor_type, reason, duration_seconds)
             VALUES ($1, NULL, NULL, 'sla_breach', 'scheduler', $2, $3)`,
            [r.instance_id, `SLA breached in ${r.current_state}`, Math.floor(elapsedHours * 3600)]
          );
        }
      }

      // 150% re-escalation
      if (pct >= this.opts.reescalateThresholdPct) {
        if (await this.markNotified(reescKey)) {
          const to = this.opts.opsEmail || r.manager_email || r.assignee_email;
          if (svc && to) {
            const built = await svc.buildTemplateAsync('onboarding_sla_reescalation', {
              onboardingId: r.onboarding_id,
              currentState: r.current_state,
              slaHours,
              elapsedHours,
            });
            await svc.send({ to, subject: built.subject, html: built.html, text: built.text });
          }
          await this.db.query(
            `INSERT INTO onboarding_workflow_execution_history (instance_id, from_state_id, to_state_id, transition_name, actor_type, reason, duration_seconds)
             VALUES ($1, NULL, NULL, 'sla_reescalation', 'scheduler', $2, $3)`,
            [r.instance_id, `Re-escalation: extended SLA breach in ${r.current_state}`, Math.floor(elapsedHours * 3600)]
          );
        }
      }
    }
  }
}


