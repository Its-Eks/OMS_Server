import { Router } from 'express';
import type { Request, Response } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { getMyEscalations, createEscalation, resolveEscalation, getAllEscalations, escalateFurther, getTeamEscalations, getTeamStats, assignEscalation, getEligibleAssignees } from '../Controllers/escalations.controller.ts';
import { listEscalationRules, createEscalationRule, updateEscalationRule, listSlaPolicies, createSlaPolicy, updateSlaPolicy, setOnCall, getOnCall } from '../Controllers/escalations-admin.controller.ts';
import type { Pool } from 'pg';
import { EscalationWorkflowService } from '../services/escalation-workflow.service.ts';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';

const router = Router();

router.use(authenticate);



router.get('/my-escalations', authorize(['escalations:view']), getMyEscalations);
// Manager/team visibility per PRD: show escalations assigned to direct reports
router.get('/my-team', authorize(['escalations:view']), getTeamEscalations);
router.get('/all', authorize(['escalations:view', 'admin:manage_roles']), getAllEscalations);
router.post('/', authorize(['escalations:escalate']), createEscalation);
router.post('/:id/escalate-further', authorize(['escalations:escalate']), escalateFurther);
router.put('/:id/resolve', authorize(['escalations:resolve']), resolveEscalation);
router.post('/:id/assign', authorize(['escalations:assign','admin:manage_roles']), assignEscalation);
router.get('/:id/eligible-assignees', authorize(['escalations:view']), getEligibleAssignees);

// Combined escalation + workflow detail
router.get('/:id/detail', authorize(['escalations:view']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  const id = String(req.params.id);
  try {
    const esc = await db.query(
      `SELECT 
         e.*, 
         o.order_number, o.current_state AS order_status, o.priority AS order_priority, o.service_type,
         CONCAT(c.first_name, ' ', c.last_name) AS customer_name,
         c.email AS customer_email,
         u_from.first_name || ' ' || u_from.last_name AS escalated_by_name,
         u_to.first_name || ' ' || u_to.last_name AS assigned_to_name,
         EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 AS aging_hours
       FROM escalations e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u_from ON u_from.id = e.escalated_from
       LEFT JOIN users u_to ON u_to.id = e.escalated_to
       WHERE e.id = $1
       LIMIT 1`,
      [id]
    );
    if (!esc.rows[0]) return res.status(404).json({ success: false, error: { message: 'Escalation not found' } });

    const svc = new EscalationWorkflowService(db);
    const state = await svc.getState(id);
    const history = await svc.history(id);

    res.json({ success: true, data: { escalation: esc.rows[0], workflow: { state, history: history.slice(0, 10) } } });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

// Summary stats for dashboards
router.get('/stats', authorize(['escalations:view', 'admin:manage_roles']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey(['escalations:stats:global']);
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'public, max-age=60');
      return res.json(cached);
    }

    const q = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved' AND DATE(resolved_at) = CURRENT_DATE) AS resolved_today,
        COUNT(*) FILTER (WHERE status <> 'resolved' AND EXTRACT(EPOCH FROM (NOW() - created_at))/3600 > 24) AS overdue
      FROM escalations`);
    const payload = { success: true, data: q.rows[0] };
    await cache.setJson(cacheKey, payload, 60);
    res.set('Cache-Control', 'public, max-age=60');
    res.json(payload);
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.get('/my/stats', authorize(['escalations:view']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const userId = String((req as any).user?.userId || '');
  try {
    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey(['escalations:stats:user', userId]);
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'private, max-age=60');
      return res.json(cached);
    }

    const q = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'open') AS open,
        COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE status = 'resolved' AND DATE(resolved_at) = CURRENT_DATE) AS resolved_today,
        COUNT(*) FILTER (WHERE status <> 'resolved' AND EXTRACT(EPOCH FROM (NOW() - created_at))/3600 > 24) AS overdue
      FROM escalations
      WHERE escalated_to = $1`, [userId]);
    const payload = { success: true, data: q.rows[0] };
    await cache.setJson(cacheKey, payload, 60);
    res.set('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

// Team stats for managers
router.get('/my-team/stats', authorize(['escalations:view']), getTeamStats);

// Admin/config endpoints under /escalation/admin
router.get('/admin/rules', authorize(['admin:manage_roles']), listEscalationRules);
router.post('/admin/rules', authorize(['admin:manage_roles']), createEscalationRule);
router.put('/admin/rules/:id', authorize(['admin:manage_roles']), updateEscalationRule);

router.get('/admin/sla', authorize(['admin:system_config']), listSlaPolicies);
router.post('/admin/sla', authorize(['admin:system_config']), createSlaPolicy);
router.put('/admin/sla/:id', authorize(['admin:system_config']), updateSlaPolicy);

router.post('/admin/on-call', authorize(['admin:system_config']), setOnCall);
router.get('/admin/on-call', authorize(['admin:system_config']), getOnCall);

// Debug endpoint to check escalation assignment
router.get('/debug/assignments', authorize(['admin:manage_roles']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  try {
    // Check all escalations and their assignments
    const escalations = await db.query(`
      SELECT 
        e.id, e.escalated_to, e.escalation_level, e.status, e.created_at,
        o.order_number, o.order_type, o.priority,
        u_to.first_name || ' ' || u_to.last_name as assigned_to_name,
        r.name as assigned_role
      FROM escalations e
      LEFT JOIN orders o ON o.id = e.order_id
      LEFT JOIN users u_to ON u_to.id = e.escalated_to
      LEFT JOIN roles r ON r.id = u_to.role_id
      ORDER BY e.created_at DESC
      LIMIT 20
    `);

    // Check Operations Manager users
    const opsManagers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, r.name as role_name, u.is_active
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE r.name ILIKE '%operations%manager%' OR r.name ILIKE '%operations manager%'
    `);

    // Check escalation rules
    const rules = await db.query(`
      SELECT * FROM escalation_rules 
      WHERE target_role ILIKE '%operations%manager%' OR target_role ILIKE '%operations manager%'
    `);

    res.json({
      success: true,
      data: {
        escalations: escalations.rows,
        operationsManagers: opsManagers.rows,
        escalationRules: rules.rows,
        summary: {
          totalEscalations: escalations.rows.length,
          assignedToOpsManager: escalations.rows.filter(e => e.assigned_role && e.assigned_role.toLowerCase().includes('operations')).length,
          unassigned: escalations.rows.filter(e => !e.escalated_to).length
        }
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

// Fix unassigned escalations endpoint
router.post('/admin/fix-unassigned', authorize(['admin:manage_roles']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  try {
    console.log('🔧 Fixing unassigned escalations...');

    // 1. Find all unassigned escalations
    const unassigned = await db.query(`
      SELECT e.id, e.order_id, e.escalation_level, e.escalation_reason, e.created_at,
             o.order_type, o.priority
      FROM escalations e
      LEFT JOIN orders o ON o.id = e.order_id
      WHERE e.escalated_to IS NULL
      ORDER BY e.created_at DESC
    `);

    if (unassigned.rows.length === 0) {
      return res.json({ success: true, message: 'No unassigned escalations found', assigned: 0 });
    }

    // 2. Find Operations Manager users
    const opsManagers = await db.query(`
      SELECT u.id, u.first_name, u.last_name, r.name as role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE (r.name ILIKE '%operations%manager%' OR r.name ILIKE '%operations manager%') 
        AND u.is_active = true
      ORDER BY u.updated_at DESC
    `);

    if (opsManagers.rows.length === 0) {
      return res.status(400).json({ success: false, error: { message: 'No Operations Manager users found' } });
    }

    // 3. Get load balancing data
    const loadData = await db.query(`
      SELECT escalated_to, COUNT(*) as open_count
      FROM escalations
      WHERE escalated_to IS NOT NULL AND status <> 'resolved'
      GROUP BY escalated_to
    `);

    const loadMap = new Map();
    loadData.rows.forEach(row => {
      loadMap.set(row.escalated_to, parseInt(row.open_count));
    });

    // 4. Assign escalations using load balancing
    let assigned = 0;
    const assignments = [];

    for (const escalation of unassigned.rows) {
      // Find the Operations Manager with the fewest open escalations
      let bestUser = null;
      let minLoad = Infinity;

      for (const user of opsManagers.rows) {
        const currentLoad = loadMap.get(user.id) || 0;
        if (currentLoad < minLoad) {
          minLoad = currentLoad;
          bestUser = user;
        }
      }

      if (bestUser) {
        // Update the escalation
        await db.query(
          'UPDATE escalations SET escalated_to = $1 WHERE id = $2',
          [bestUser.id, escalation.id]
        );

        // Update load map
        loadMap.set(bestUser.id, (loadMap.get(bestUser.id) || 0) + 1);
        assigned++;

        assignments.push({
          escalationId: escalation.id,
          assignedTo: bestUser.id,
          assignedToName: `${bestUser.first_name} ${bestUser.last_name}`,
          load: minLoad
        });
      }
    }

    // 5. Invalidate caches
    const cache = new CacheService(req.app.get('redis'));
    await cache.delByPrefix(buildCacheKey(['escalations:my']));
    await cache.delByPrefix(buildCacheKey(['escalations:all']));
    await cache.delByPrefix(buildCacheKey(['dashboard:data']));

    res.json({
      success: true,
      message: `Successfully assigned ${assigned} escalations`,
      data: {
        totalUnassigned: unassigned.rows.length,
        assigned,
        assignments
      }
    });

  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

// Workflow endpoints under /escalation/workflow
router.get('/workflow/:escalationId/state', authorize(['escalations:view']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  try {
    const svc = new EscalationWorkflowService(db);
    const state = await svc.getState(String(req.params.escalationId));
    res.json({ success: true, data: state });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.get('/workflow/:escalationId/history', authorize(['escalations:view']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  try {
    const svc = new EscalationWorkflowService(db);
    const rows = await svc.history(String(req.params.escalationId));
    res.json({ success: true, data: rows });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

router.post('/workflow/:escalationId/transition', authorize(['escalations:resolve','escalations:escalate']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  const { transition, reason, data } = req.body || {};
  const executedBy = String((req as any).user?.userId || '');
  try {
    const svc = new EscalationWorkflowService(db);
    const out = await svc.transition(String(req.params.escalationId), String(transition), executedBy || undefined, reason, data);
    res.json({ success: true, data: out });
  } catch (e: any) {
    res.status(400).json({ success: false, error: { message: e.message } });
  }
});

// Manual escalation helper: orders + eligible assignees in one call
router.get('/manual/options', authorize(['escalations:view']), async (req: Request, res: Response) => {
  const db: Pool = req.app.get('pgPool');
  const q = String(req.query.q || '').trim();
  const limit = Math.max(1, Math.min(parseInt(String(req.query.limit || '25')) || 25, 100));
  try {
    // 1) Active/ recent orders, optionally filtered by search query
    const params: any[] = [];
    let where = "(o.current_state IS NULL OR o.current_state NOT IN ('completed','cancelled'))";
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (o.order_number ILIKE $${params.length} OR CAST(o.id AS TEXT) ILIKE $${params.length} OR CAST(o.customer_id AS TEXT) ILIKE $${params.length})`;
    }
    params.push(limit);
    const ordersSql = `
      SELECT 
        o.id, o.order_number, o.customer_id, o.priority, o.order_type, o.current_state, 
        c.first_name || ' ' || c.last_name AS customer_name,
        c.email AS customer_email,
        o.created_at
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ${where}
      ORDER BY o.created_at DESC
      LIMIT $${params.length}`;
    const orders = await db.query(ordersSql, params);

    // 2) Eligible assignees. Start with Operations Manager / Escalations-related roles
    const assignees = await db.query(`
      SELECT 
        u.id, u.first_name, u.last_name, u.email, r.name AS role_name
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.is_active = true
        AND (
          r.name ILIKE '%operations%manager%'
          OR r.name ILIKE '%operations manager%'
          OR r.name ILIKE '%support%'
          OR r.name ILIKE '%escalation%'
        )
      ORDER BY u.first_name ASC, u.last_name ASC
    `);

    // 3) Current load per assignee (open escalations)
    const loadRows = await db.query(`
      SELECT escalated_to AS user_id, COUNT(*) AS open_count
      FROM escalations
      WHERE escalated_to IS NOT NULL AND status <> 'resolved'
      GROUP BY escalated_to
    `);
    const loadMap = new Map<string, number>();
    for (const r of loadRows.rows) {
      loadMap.set(String(r.user_id), parseInt(r.open_count, 10));
    }
    const assigneesWithLoad = assignees.rows.map((u: any) => ({
      id: u.id,
      name: `${u.first_name} ${u.last_name}`.trim(),
      email: u.email,
      role: u.role_name,
      openEscalations: loadMap.get(String(u.id)) || 0
    }));

    res.json({
      success: true,
      data: {
        orders: orders.rows,
        assignees: assigneesWithLoad
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: { message: e.message } });
  }
});

export default router;
