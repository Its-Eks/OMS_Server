import type { Request, Response } from 'express';
import type { Pool } from 'pg';

// ---- Escalation Rules ----
export async function listEscalationRules(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const r = await db.query('SELECT * FROM escalation_rules ORDER BY created_at DESC');
    res.json({ success: true, data: r.rows });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

export async function createEscalationRule(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { name, order_type, fno_id, task_type, priority, time_threshold_hours, reescalate_after_hours, max_levels, target_role, is_active } = req.body || {};
    if (!name || !time_threshold_hours) throw new Error('name and time_threshold_hours are required');
    const q = `INSERT INTO escalation_rules (name, order_type, fno_id, task_type, priority, time_threshold_hours, reescalate_after_hours, max_levels, target_role, is_active)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,true)) RETURNING *`;
    const v = [name, order_type || null, fno_id || null, task_type || null, priority || null, Number(time_threshold_hours), reescalate_after_hours ? Number(reescalate_after_hours) : null, max_levels ? Number(max_levels) : 2, target_role || null, is_active];
    const r = await db.query(q, v);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

export async function updateEscalationRule(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { id } = req.params;
    const fields = ['name','order_type','fno_id','task_type','priority','time_threshold_hours','reescalate_after_hours','max_levels','target_role','is_active'];
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    for (const f of fields) {
      if (f in (req.body || {})) {
        sets.push(`${f} = $${idx++}`);
        vals.push(req.body[f]);
      }
    }
    if (sets.length === 0) throw new Error('No fields to update');
    vals.push(id);
    const r = await db.query(`UPDATE escalation_rules SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`, vals);
    res.json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

// ---- SLA Policies ----
export async function listSlaPolicies(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const r = await db.query('SELECT * FROM sla_policies ORDER BY created_at DESC');
    res.json({ success: true, data: r.rows });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

export async function createSlaPolicy(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { order_type, task_type, priority, sla_hours, warn_threshold_pct, reescalate_threshold_pct, is_active } = req.body || {};
    if (!order_type || !sla_hours) throw new Error('order_type and sla_hours are required');
    const r = await db.query(
      `INSERT INTO sla_policies (order_type, task_type, priority, sla_hours, warn_threshold_pct, reescalate_threshold_pct, is_active)
       VALUES ($1,$2,$3,$4,COALESCE($5,0.75),COALESCE($6,1.5),COALESCE($7,true)) RETURNING *`,
      [order_type, task_type || null, priority || null, Number(sla_hours), warn_threshold_pct ? Number(warn_threshold_pct) : null, reescalate_threshold_pct ? Number(reescalate_threshold_pct) : null, is_active]
    );
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

export async function updateSlaPolicy(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { id } = req.params;
    const fields = ['order_type','task_type','priority','sla_hours','warn_threshold_pct','reescalate_threshold_pct','is_active'];
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    for (const f of fields) {
      if (f in (req.body || {})) {
        sets.push(`${f} = $${idx++}`);
        vals.push(req.body[f]);
      }
    }
    if (sets.length === 0) throw new Error('No fields to update');
    vals.push(id);
    const r = await db.query(`UPDATE sla_policies SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING *`, vals);
    res.json({ success: true, data: r.rows[0] });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

// ---- On-call config ----
export async function setOnCall(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { roleName, userId } = req.body || {};
    if (!roleName || !userId) throw new Error('roleName and userId are required');
    const key = `on_call_${String(roleName).replace(/\s+/g,'_').toLowerCase()}_user_id`;
    await db.query(
      `INSERT INTO system_config (config_key, config_value)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (config_key) DO UPDATE SET config_value = EXCLUDED.config_value, updated_at = NOW()`,
      [key, JSON.stringify({ userId })]
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}

export async function getOnCall(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { roleName } = req.query as { roleName?: string };
    if (!roleName) throw new Error('roleName required');
    const key = `on_call_${String(roleName).replace(/\s+/g,'_').toLowerCase()}_user_id`;
    const r = await db.query('SELECT config_value FROM system_config WHERE config_key = $1 LIMIT 1', [key]);
    res.json({ success: true, data: r.rows[0]?.config_value || null });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
}


