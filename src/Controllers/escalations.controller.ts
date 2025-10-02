import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';
import { AuditService } from '../services/audit.service.ts';
import { EscalationWorkflowService } from '../services/escalation-workflow.service.ts'

export async function getMyEscalations(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const userId = (req as any).user?.userId;
  const { status, level, from, to, today } = req.query;
  
  try {
    const cache = new CacheService(redis, 60); // 1 minute cache for escalations
    const cacheKey = buildCacheKey(['escalations:my', userId, status, level]);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Get user role to determine visibility
    const userRole = (req as any).user?.role;
    
    let whereClause = '';
    const params: any[] = [];
    let paramIndex = 1;

    if (userRole === 'System Administrator') {
      // Admins see all escalations
      whereClause = 'WHERE 1=1';
    } else if (userRole === 'Operations Manager') {
      // OMs see their assigned escalations + unassigned escalations + team escalations
      whereClause = `WHERE (e.escalated_to = $${paramIndex} OR e.escalated_to IS NULL OR e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $${paramIndex}))`;
      params.push(userId);
      paramIndex++;
    } else {
      // ICs see their assigned escalations + unassigned escalations they can take
      whereClause = `WHERE (e.escalated_to = $${paramIndex} OR e.escalated_to IS NULL)`;
      params.push(userId);
      paramIndex++;
    }

    // Date window: default to today-only unless overridden
    const useToday = String(today || 'true').toLowerCase() !== 'false';
    if (useToday) {
      whereClause += ` AND DATE(e.created_at) = CURRENT_DATE`;
    } else if (from || to) {
      if (from) {
        whereClause += ` AND e.created_at >= $${paramIndex}`;
        params.push(new Date(String(from as string)));
        paramIndex++;
      }
      if (to) {
        whereClause += ` AND e.created_at < $${paramIndex}`;
        params.push(new Date(String(to as string)));
        paramIndex++;
      }
    }

    if (status) {
      whereClause += ` AND e.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (level) {
      whereClause += ` AND e.escalation_level = $${paramIndex}`;
      params.push(parseInt(level as string));
      paramIndex++;
    }

    const result = await db.query(
      `SELECT 
        e.*,
        o.order_number,
        o.current_state as order_status,
        o.priority as order_priority,
        o.service_type,
        o.assigned_to as order_owner_id,
        (SELECT uo.first_name || ' ' || uo.last_name FROM users uo WHERE uo.id = o.assigned_to) as order_owner_name,
        CONCAT(c.first_name, ' ', c.last_name) as customer_name,
        c.email as customer_email,
        u_from.first_name || ' ' || u_from.last_name as escalated_by_name,
        CASE 
          WHEN e.escalated_to IS NULL THEN NULL
          ELSE u_to.first_name || ' ' || u_to.last_name 
        END as assigned_to_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours,
        e.business_impact,
        CASE 
          WHEN e.status = 'resolved' THEN 'resolved'
          WHEN e.status = 'in_progress' THEN 'in_progress'
          WHEN e.status = 'open' AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24 THEN 'overdue'
          ELSE 'open'
        END as display_status
       FROM escalations e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u_from ON u_from.id = e.escalated_from
       LEFT JOIN users u_to ON u_to.id = e.escalated_to
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    // Group by status for UI tabs
    const escalations = result.rows;
    const grouped = {
      open: escalations.filter(e => e.display_status === 'open'),
      in_progress: escalations.filter(e => e.display_status === 'in_progress'),
      resolved: escalations.filter(e => e.display_status === 'resolved'),
      overdue: escalations.filter(e => e.display_status === 'overdue')
    };

    const payload = { 
      success: true, 
      data: { 
        escalations,
        grouped,
        total: escalations.length,
        summary: {
          open: grouped.open.length,
          in_progress: grouped.in_progress.length,
          resolved: grouped.resolved.length,
          overdue: grouped.overdue.length
        }
      } 
    };
    
    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    console.error('[escalations] getMyEscalations failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

// Team escalations for managers: escalations assigned to direct reports
export async function getTeamEscalations(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const managerId = (req as any).user?.userId;
  const { status, level, from, to, today } = req.query;

  try {
    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey(['escalations:team', managerId, status, level]);

    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    // Team escalations: direct reports + unassigned escalations in manager's domain
    let whereClause = `WHERE (e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $1) OR e.escalated_to IS NULL)`;
    const params: any[] = [managerId];
    let paramIndex = 2;

    // Date window: default to today-only unless overridden
    const useToday = String(today || 'true').toLowerCase() !== 'false';
    if (useToday) {
      whereClause += ` AND DATE(e.created_at) = CURRENT_DATE`;
    } else if (from || to) {
      if (from) {
        whereClause += ` AND e.created_at >= $${paramIndex}`;
        params.push(new Date(String(from)));
        paramIndex++;
      }
      if (to) {
        whereClause += ` AND e.created_at < $${paramIndex}`;
        params.push(new Date(String(to)));
        paramIndex++;
      }
    }

    if (status) {
      whereClause += ` AND e.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (level) {
      whereClause += ` AND e.escalation_level = $${paramIndex}`;
      params.push(parseInt(level as string));
      paramIndex++;
    }

    const result = await db.query(
      `SELECT 
        e.*,
        o.order_number,
        o.current_state as order_status,
        o.priority as order_priority,
        o.service_type,
        o.assigned_to as order_owner_id,
        (SELECT uo.first_name || ' ' || uo.last_name FROM users uo WHERE uo.id = o.assigned_to) as order_owner_name,
        CONCAT(c.first_name, ' ', c.last_name) as customer_name,
        c.email as customer_email,
        u_from.first_name || ' ' || u_from.last_name as escalated_by_name,
        CASE 
          WHEN e.escalated_to IS NULL THEN NULL
          ELSE u_to.first_name || ' ' || u_to.last_name 
        END as assigned_to_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours,
        e.business_impact,
        CASE 
          WHEN e.status = 'resolved' THEN 'resolved'
          WHEN e.status = 'in_progress' THEN 'in_progress'
          WHEN e.status = 'open' AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24 THEN 'overdue'
          ELSE 'open'
        END as display_status
       FROM escalations e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u_from ON u_from.id = e.escalated_from
       LEFT JOIN users u_to ON u_to.id = e.escalated_to
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    const escalations = result.rows;
    const grouped = {
      open: escalations.filter(e => e.display_status === 'open'),
      in_progress: escalations.filter(e => e.display_status === 'in_progress'),
      resolved: escalations.filter(e => e.display_status === 'resolved'),
      overdue: escalations.filter(e => e.display_status === 'overdue')
    };

    const payload = {
      success: true,
      data: {
        escalations,
        grouped,
        total: escalations.length,
        summary: {
          open: grouped.open.length,
          in_progress: grouped.in_progress.length,
          resolved: grouped.resolved.length,
          overdue: grouped.overdue.length
        }
      }
    };

    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    console.error('[escalations] getTeamEscalations failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { orderId, taskId, escalationReason, escalationLevel, escalatedTo, priority, justification } = req.body;
  const escalatedFrom = (req as any).user?.userId;
  try {
    // Allow clients to pass either an order UUID or an order_number string
    let resolvedOrderId: string | null = null;
    const rawOrderId = String(orderId || '').trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (rawOrderId) {
      if (uuidRegex.test(rawOrderId)) {
        resolvedOrderId = rawOrderId;
      } else {
        // Treat as order_number and resolve to UUID
        const lookup = await db.query(`SELECT id FROM orders WHERE order_number = $1 LIMIT 1`, [rawOrderId]);
        if (!lookup.rows[0]?.id) {
          return res.status(400).json({ success: false, error: { message: `Order not found for order_number: ${rawOrderId}` } });
        }
        resolvedOrderId = String(lookup.rows[0].id);
      }
    }

    const result = await db.query(
      `INSERT INTO escalations (order_id, task_id, escalation_level, escalated_from, escalated_to, escalation_reason, status, escalation_type, priority)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'manual', $7) RETURNING id`,
      [resolvedOrderId || null, taskId || null, escalationLevel || 1, escalatedFrom, escalatedTo, escalationReason, priority || 'normal']
    );

    // Start escalation workflow instance
    try {
      const wf = new EscalationWorkflowService(db);
      await wf.startForEscalation(result.rows[0].id);
    } catch {}

    // Get order details for better notifications
    const orderDetails = await db.query(`
      SELECT o.order_number, o.service_type, o.priority as order_priority,
             c.first_name, c.last_name, c.email as customer_email
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE o.id = $1
    `, [resolvedOrderId]);
    
    const order = orderDetails.rows[0];
    const customerName = order ? `${order.first_name} ${order.last_name}`.trim() : 'Unknown Customer';

    // In-app notification for creation (route to Operations Managers by role)
    try {
      const notificationService = req.app.get('notificationService');
      if (notificationService?.createInAppNotification) {
        // Notify Operations Managers
        await notificationService.createInAppNotification({
          type: 'escalation_created',
          title: `New Escalation: ${order?.order_number || rawOrderId}`,
          message: `Level ${escalationLevel || 1} escalation created for ${customerName}. Priority: ${priority || 'normal'}. Reason: ${escalationReason}`,
          targets: { roles: ['Operations Manager'] },
          metadata: { 
            escalationId: result.rows[0].id, 
            orderId: resolvedOrderId || rawOrderId, 
            orderNumber: order?.order_number,
            level: escalationLevel || 1, 
            priority: priority || 'normal', 
            escalationReason,
            customerName,
            url: '/escalations'
          }
        });

        // If assigned to specific user, notify them directly
        if (escalatedTo) {
          const assignedUser = await db.query('SELECT first_name, last_name, email FROM users WHERE id = $1', [escalatedTo]);
          const assignee = assignedUser.rows[0];
          if (assignee) {
            await notificationService.createInAppNotification({
              type: 'escalation_assigned_to_me',
              title: `Escalation Assigned: ${order?.order_number || rawOrderId}`,
              message: `You have been assigned a level ${escalationLevel || 1} escalation for ${customerName}.`,
              targets: { userIds: [escalatedTo] },
              metadata: { 
                escalationId: result.rows[0].id, 
                orderId: resolvedOrderId || rawOrderId,
                orderNumber: order?.order_number,
                level: escalationLevel || 1, 
                priority: priority || 'normal',
                customerName,
                url: '/escalations'
              }
            });
          }
        }
      }
    } catch (notifError) {
      console.warn('Failed to send escalation notifications:', notifError);
    }

    try {
      await new AuditService(db).logAction(String(escalatedFrom || ''), 'manual_escalation', 'order', String(resolvedOrderId || rawOrderId || ''), {}, { escalationId: result.rows[0].id, level: escalationLevel, justification }, String(req.ip || ''), String(req.get('User-Agent') || ''));
    } catch {}

    // Invalidate escalations and dashboard caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['escalations:my']));
    await cache.delByPrefix(buildCacheKey(['escalations:all']));
    await cache.delByPrefix(buildCacheKey(['dashboard:data']));

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error: any) {
    console.error('[escalations] createEscalation failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function resolveEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { id } = req.params;
  const { resolutionNotes } = req.body;
  const resolvedBy = (req as any).user?.userId;
  
  try {
    await db.query(
      `UPDATE escalations 
       SET status = 'resolved', 
           resolved_at = NOW(), 
           resolution_notes = $1,
           escalated_to = $3
       WHERE id = $2`,
      [resolutionNotes || null, id, resolvedBy]
    );

    // Transition workflow to resolved
    try {
      const wf = new EscalationWorkflowService(db);
      await wf.transition(String(id), 'resolve', String(resolvedBy || ''), 'closed_by_user', { resolutionNotes });
    } catch {}

    // Log the resolution action
    try {
      await new AuditService(db).logAction(
        String(resolvedBy || ''), 
        'escalation_resolved', 
        'escalation', 
        String(id), 
        {}, 
        { resolutionNotes }, 
        String(req.ip || ''), 
        String(req.get('User-Agent') || '')
      );
    } catch {}

    // Invalidate escalations and dashboard caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['escalations:my']));
    await cache.delByPrefix(buildCacheKey(['escalations:all']));
    await cache.delByPrefix(buildCacheKey(['dashboard:data']));

    // In-app notification for resolution routed to resolver
    try {
      const notificationService = req.app.get('notificationService');
      if (notificationService?.createInAppNotification) {
        await notificationService.createInAppNotification({
          type: 'escalation_resolved',
          title: `Escalation resolved`,
          message: `Escalation ${id} resolved${resolutionNotes ? ` · ${resolutionNotes}` : ''}`,
          targets: { userIds: [String(resolvedBy || '')] },
          metadata: { escalationId: id, resolutionNotes }
        });
      }
    } catch {}

    res.json({ success: true });
  } catch (error: any) {
    console.error('[escalations] resolveEscalation failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getAllEscalations(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { status, level, orderId, from, to, today } = req.query;
  
  try {
    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey(['escalations:all', String(status || ''), String(level || ''), String(orderId || '')]);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    let whereClause = 'WHERE 1=1';
    const params: any[] = [];
    let paramIndex = 1;

    // Date window: default to today-only unless overridden
    const useToday = String(today || 'true').toLowerCase() !== 'false';
    if (useToday) {
      whereClause += ` AND DATE(e.created_at) = CURRENT_DATE`;
    } else if (from || to) {
      if (from) {
        whereClause += ` AND e.created_at >= $${paramIndex}`;
        params.push(new Date(String(from)));
        paramIndex++;
      }
      if (to) {
        whereClause += ` AND e.created_at < $${paramIndex}`;
        params.push(new Date(String(to)));
        paramIndex++;
      }
    }

    if (status) {
      whereClause += ` AND e.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (level) {
      whereClause += ` AND e.escalation_level = $${paramIndex}`;
      params.push(parseInt(level as string));
      paramIndex++;
    }

    if (orderId) {
      whereClause += ` AND e.order_id = $${paramIndex}`;
      params.push(orderId);
      paramIndex++;
    }

    const result = await db.query(
      `SELECT 
        e.*,
        o.order_number,
        o.current_state as order_status,
        o.priority as order_priority,
        o.service_type,
        o.assigned_to as order_owner_id,
        (SELECT uo.first_name || ' ' || uo.last_name FROM users uo WHERE uo.id = o.assigned_to) as order_owner_name,
        CONCAT(c.first_name, ' ', c.last_name) as customer_name,
        c.email as customer_email,
        u_from.first_name || ' ' || u_from.last_name as escalated_by_name,
        CASE 
          WHEN e.escalated_to IS NULL THEN NULL
          ELSE u_to.first_name || ' ' || u_to.last_name 
        END as assigned_to_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours,
        CASE 
          WHEN e.status = 'resolved' THEN 'resolved'
          WHEN e.status = 'in_progress' THEN 'in_progress'
          WHEN e.status = 'open' AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24 THEN 'overdue'
          ELSE 'open'
        END as display_status
       FROM escalations e
       LEFT JOIN orders o ON o.id = e.order_id
       LEFT JOIN customers c ON c.id = o.customer_id
       LEFT JOIN users u_from ON u_from.id = e.escalated_from
       LEFT JOIN users u_to ON u_to.id = e.escalated_to
       ${whereClause}
       ORDER BY e.created_at DESC`,
      params
    );

    // Group by status for UI tabs
    const escalations = result.rows;
    const grouped = {
      open: escalations.filter(e => e.display_status === 'open'),
      in_progress: escalations.filter(e => e.display_status === 'in_progress'),
      resolved: escalations.filter(e => e.display_status === 'resolved'),
      overdue: escalations.filter(e => e.display_status === 'overdue')
    };

    const payload = { 
      success: true, 
      data: { 
        escalations,
        grouped,
        total: escalations.length,
        summary: {
          open: grouped.open.length,
          in_progress: grouped.in_progress.length,
          resolved: grouped.resolved.length,
          overdue: grouped.overdue.length
        }
      } 
    };
    
    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    console.error('[escalations] getAllEscalations failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

// Team stats for managers
export async function getTeamStats(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const managerId = String((req as any).user?.userId || '');
  try {
    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey(['escalations:stats:team', managerId]);
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      res.set('Cache-Control', 'private, max-age=60');
      return res.json(cached);
    }

    const q = await db.query(`
      SELECT 
        COUNT(*) FILTER (WHERE e.status = 'open') AS open,
        COUNT(*) FILTER (WHERE e.status = 'in_progress') AS in_progress,
        COUNT(*) FILTER (WHERE e.status = 'resolved' AND DATE(e.resolved_at) = CURRENT_DATE) AS resolved_today,
        COUNT(*) FILTER (
          WHERE e.status <> 'resolved' 
            AND EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 > 24
        ) AS overdue
      FROM escalations e
      WHERE e.escalated_to IN (SELECT id FROM users WHERE reporting_manager_id = $1)
        AND DATE(e.created_at) = CURRENT_DATE
    `, [managerId]);
    const payload = { success: true, data: q.rows[0] };
    await cache.setJson(cacheKey, payload, 60);
    res.set('Cache-Control', 'private, max-age=60');
    res.json(payload);
  } catch (e: any) {
    console.error('[escalations] getTeamStats failed:', e?.message);
    if (e?.stack) console.error(e.stack);
    res.status(500).json({ success: false, error: { message: e.message } });
  }
}

export async function escalateFurther(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { id } = req.params;
  const { escalationReason, escalatedTo, priority } = req.body;
  const escalatedFrom = (req as any).user?.userId;
  
  try {
    // Get current escalation details
    const currentEscalation = await db.query(
      'SELECT * FROM escalations WHERE id = $1',
      [id]
    );
    
    if (currentEscalation.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Escalation not found' } });
    }
    
    const current = currentEscalation.rows[0];
    const nextLevel = (current.escalation_level || 1) + 1;
    
    // Create new escalation at next level
    const result = await db.query(
      `INSERT INTO escalations (order_id, task_id, escalation_level, escalated_from, escalated_to, escalation_reason, status, escalation_type, priority)
       VALUES ($1, $2, $3, $4, $5, $6, 'open', 'manual', $7) RETURNING id`,
      [
        current.order_id, 
        current.task_id, 
        nextLevel, 
        escalatedFrom, 
        escalatedTo, 
        escalationReason || `Escalated from Level ${current.escalation_level}`,
        priority || 'normal'
      ]
    );

    // Log the escalation action
    try {
      await new AuditService(db).logAction(
        String(escalatedFrom || ''), 
        'escalation_further', 
        'escalation', 
        String(id), 
        { previousLevel: current.escalation_level }, 
        { newLevel: nextLevel, escalationId: result.rows[0].id }, 
        String(req.ip || ''), 
        String(req.get('User-Agent') || '')
      );
    } catch {}

    // In-app notification for further escalation (route to Operations Managers by role)
    try {
      const notificationService = req.app.get('notificationService');
      if (notificationService?.createInAppNotification) {
        await notificationService.createInAppNotification({
          type: 'escalation_escalated_further',
          title: `Escalated to level ${nextLevel}`,
          message: `Escalation ${id} moved to level ${nextLevel}`,
          targets: { roles: ['Operations Manager'] },
          metadata: { previousId: id, newEscalationId: result.rows[0].id, level: nextLevel }
        });
      }
    } catch {}

    // Invalidate escalations and dashboard caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['escalations:my']));
    await cache.delByPrefix(buildCacheKey(['escalations:all']));
    await cache.delByPrefix(buildCacheKey(['dashboard:data']));

    res.status(201).json({ success: true, id: result.rows[0].id, level: nextLevel });
  } catch (error: any) {
    console.error('[escalations] escalateFurther failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

// Eligible assignees for a given escalation, with load metrics
export async function getEligibleAssignees(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { id } = req.params;
  const { role, limit } = req.query;

  try {
    // Fetch escalation to infer role if not provided
    const esc = await db.query(`
      SELECT e.*, COALESCE(e.escalation_level, 1) AS level
      FROM escalations e WHERE e.id = $1
    `, [id]);
    if (esc.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'Escalation not found' } });
    }

    const targetRole = String(role || 'Operations Manager');
    const max = Math.min(parseInt(String(limit || '25')), 100);

    const q = await db.query(`
      WITH load AS (
        SELECT escalated_to AS uid,
               COUNT(*) FILTER (WHERE status <> 'resolved') AS open_escalations,
               COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS recent_assignments_24h
        FROM escalations
        GROUP BY escalated_to
      )
      SELECT 
        u.id,
        (u.first_name || ' ' || u.last_name) AS name,
        u.email,
        r.name AS role,
        COALESCE(l.open_escalations, 0) AS open_escalations,
        COALESCE(l.recent_assignments_24h, 0) AS recent_assignments_24h,
        u.created_at
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN load l ON l.uid = u.id
      WHERE u.is_active = true
        AND (r.name = $1 OR r.name ILIKE $2)
        AND u.email IS NOT NULL
      ORDER BY open_escalations ASC, recent_assignments_24h ASC, u.created_at ASC
      LIMIT $3
    `, [targetRole, `%${targetRole}%`, max]);

    return res.json({ success: true, data: q.rows });
  } catch (e: any) {
    console.error('[escalations] getEligibleAssignees failed:', e?.message);
    if (e?.stack) console.error(e.stack);
    res.status(500).json({ success: false, error: { message: e.message } });
  }
}

export async function assignEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const escalationId = req.params.id;
  const { assignedTo, assignedToName, broadcast } = req.body;
  const currentUserId = (req as any).user?.userId;
  const currentUserRole = (req as any).user?.role;

  try {
    console.log(`[escalations] Manual assignment request: escalation=${escalationId}, assignedTo=${assignedTo}, assignedToName=${assignedToName}`);

    // Validate required fields
    if (!assignedTo || !assignedToName) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'assignedTo and assignedToName are required' } 
      });
    }

    // Check if escalation exists and get current state
    const escalationCheck = await db.query(
      `SELECT e.*, o.order_number, o.service_type, o.priority as order_priority
       FROM escalations e
       LEFT JOIN orders o ON o.id = e.order_id
       WHERE e.id = $1`,
      [escalationId]
    );

    if (!escalationCheck.rows[0]) {
      return res.status(404).json({ 
        success: false, 
        error: { message: 'Escalation not found' } 
      });
    }

    const escalation = escalationCheck.rows[0];

    // Validate user exists and has appropriate permissions
    const userCheck = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.is_active,
              u.reporting_manager_id,
              r.name AS role,
              r.permissions
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1 AND u.is_active = true`,
      [assignedTo]
    );

    if (!userCheck.rows[0]) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Assigned user not found or inactive' } 
      });
    }

    const assignedUser = userCheck.rows[0];

    // Check if user has escalation permissions
    const hasEscalationPermission = assignedUser.permissions?.includes('escalations:view') || 
                                   assignedUser.role === 'Operations Manager' ||
                                   assignedUser.role === 'System Administrator';

    if (!hasEscalationPermission) {
      return res.status(400).json({ 
        success: false, 
        error: { message: 'Assigned user does not have escalation permissions' } 
      });
    }

    // Check availability (basic check - can be enhanced with workload limits)
    const currentAssignments = await db.query(
      `SELECT COUNT(*) as count 
       FROM escalations 
       WHERE escalated_to = $1 AND status IN ('open', 'in_progress')`,
      [assignedTo]
    );

    const assignmentCount = parseInt(currentAssignments.rows[0].count);
    const maxAssignments = Number(process.env.MAX_ESCALATIONS_PER_USER || 100);

    if (assignmentCount >= maxAssignments) {
      return res.status(400).json({ 
        success: false, 
        error: { message: `User has reached maximum assignment limit (${maxAssignments})` } 
      });
    }

    // Update escalation assignment (table does not have escalated_to_name/assigned_at columns)
    const updateResult = await db.query(
      `UPDATE escalations 
       SET escalated_to = $1,
           status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
       WHERE id = $2
       RETURNING id, escalated_to, status`,
      [assignedTo, escalationId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(500).json({ 
        success: false, 
        error: { message: 'Failed to update escalation assignment' } 
      });
    }

    const updatedEscalation = updateResult.rows[0];
    // Resolve assigned_to_name via users table
    const nameRow = await db.query(`SELECT (first_name || ' ' || last_name) AS name FROM users WHERE id = $1`, [assignedTo]);
    const resolvedAssignedName = nameRow.rows[0]?.name || assignedToName;

    // Clear relevant caches
    const cache = new CacheService(redis, 60);
    await cache.delByPrefix('escalations:my');
    await cache.delByPrefix('escalations:all');
    await cache.delByPrefix('escalations:team');

    // Log assignment activity
    try {
      const auditService = new AuditService(db);
      await auditService.logAction(
        String(currentUserId || ''),
        'escalation_assigned',
        'escalation',
        String(escalationId),
        { previousAssignee: escalation.escalated_to },
        { assignedTo, assignedToName, escalationLevel: escalation.escalation_level, orderNumber: escalation.order_number },
        String(req.ip || ''),
        String(req.get('User-Agent') || '')
      );
    } catch (auditError) {
      console.warn('[escalations] Audit logging failed for assignment:', auditError);
    }

    // Skip email; use in-app notifications only

    // Create in-app notification for assignee
    try {
      const notificationService2 = req.app.get('notificationService');
      if (notificationService2?.createInAppNotification) {
        await notificationService2.createInAppNotification({
          type: 'escalation_assigned',
          title: `Escalation assigned to you`,
          message: `${escalation.order_number || ''} · Level ${escalation.escalation_level}`,
          targets: { userIds: [String(assignedTo)] },
          metadata: { escalationId, assignedTo, assignedToName: resolvedAssignedName }
        });

        // Broadcast to Operations Managers with assignee details
        await notificationService2.createInAppNotification({
          type: 'escalation_assignment_broadcast',
          title: `Escalation assigned`,
          message: `${escalation.order_number || ''} assigned to ${resolvedAssignedName} (L${escalation.escalation_level})`,
          targets: { roles: ['Operations Manager'] },
          metadata: { escalationId, orderNumber: escalation.order_number, assignedTo, assignedToName: resolvedAssignedName, level: escalation.escalation_level }
        });

        // Notify reporting manager of the assignee (if any)
        const rmId = assignedUser.reporting_manager_id ? String(assignedUser.reporting_manager_id) : null;
        if (rmId) {
          await notificationService2.createInAppNotification({
            type: 'escalation_assignment_manager_notice',
            title: `Team assignment`,
            message: `${resolvedAssignedName} received ${escalation.order_number || ''} (L${escalation.escalation_level})`,
            targets: { userIds: [rmId] },
            metadata: { escalationId, orderNumber: escalation.order_number, teamMemberId: assignedTo, teamMemberName: resolvedAssignedName, level: escalation.escalation_level }
          });
        }
      }
    } catch {}

    console.log(`[escalations] Successfully assigned escalation ${escalationId} to ${resolvedAssignedName} (${assignedTo})`);

    res.json({
      success: true,
      data: {
        id: updatedEscalation.id,
        assigned_to: updatedEscalation.escalated_to,
        assigned_to_name: resolvedAssignedName,
        assigned_at: null,
        status: updatedEscalation.status
      }
    });

  } catch (error: any) {
    console.error('[escalations] assignEscalation failed:', error?.message);
    if (error?.stack) console.error(error.stack);
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}