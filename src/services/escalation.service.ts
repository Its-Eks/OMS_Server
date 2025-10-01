import { Pool } from 'pg';
import { MongoClient } from 'mongodb';
import { NotificationService } from './notification.service.ts';

export interface EscalationRule {
  id: string;
  name: string;
  orderType?: string;
  fnoId?: string;
  customerTier?: string;
  timeThreshold: number; // in hours
  escalationLevel: number;
  assignedRole: string;
  isActive: boolean;
  maxLevels?: number;
}

export interface Escalation {
  id: string;
  orderId: string;
  escalationLevel: number;
  assignedTo: string;
  assignedRole: string;
  reason: string;
  createdAt: Date;
  resolvedAt?: Date;
  status: 'pending' | 'in_progress' | 'resolved';
}

export class EscalationService {
  private db: Pool;
  private mongoClient: MongoClient;
  private mongoDb: any;
  private notificationService: NotificationService;

  constructor(db: Pool, mongoClient: MongoClient, dbName: string = 'oms_db') {
    this.db = db;
    this.mongoClient = mongoClient;
    this.mongoDb = mongoClient.db(dbName);
    this.notificationService = new NotificationService();
  }

  async checkAndEscalateOrders(): Promise<void> {
    const orders = await this.getOrdersNeedingEscalation();
    for (const order of orders) {
      const rule = await this.getEscalationRule(order);
      if (!rule) continue;

      // Determine next level already applied
      const applied = await this.db.query(
        `SELECT COALESCE(MAX(level), 0) AS max_level
         FROM automated_escalations
         WHERE order_id = $1 AND (rule_id = $2 OR $2 IS NULL)`,
        [order.id, null]
      );
      const nextLevel = Number(applied.rows[0]?.max_level || 0) + 1;
      if (rule.maxLevels && nextLevel > rule.maxLevels) continue;

      await this.escalateOrder(order, rule, nextLevel);
    }
  }

  async escalateOrder(order: any, escalationRule: any, level: number): Promise<void> {

    const escalation: Escalation = {
      id: `${order.id}_${Date.now()}`,
      orderId: order.id,
      escalationLevel: level,
      assignedTo: '', // Will be determined by role
      assignedRole: escalationRule.assignedRole,
      reason: `Order exceeded ${escalationRule.timeThreshold} hour threshold`,
      createdAt: new Date(),
      status: 'pending'
    };

    const escalatedTo = await this.resolveRecipient(order, escalationRule, level);

    // Derive business impact (simple heuristic: priority/tier + age)
    const ageHours = this.getOrderAge(order);
    const priority = (order.priority || 'normal').toLowerCase();
    const impact = priority === 'high' || priority === 'urgent'
      ? (ageHours >= 24 ? 'high' : 'medium')
      : (ageHours >= 48 ? 'medium' : 'low');

    // Record in Postgres escalations table and automated_escalations
    const ins = await this.db.query(
      `INSERT INTO escalations (order_id, escalation_level, escalated_from, escalated_to, escalation_reason, status, escalation_type, business_impact)
       VALUES ($1, $2, NULL, $3, $4, 'open', 'automatic', $5)`,
      [order.id, level, escalatedTo, escalation.reason, impact]
    );
    await this.db.query(
      `INSERT INTO automated_escalations (order_id, rule_id, level) VALUES ($1, $2, $3)
       ON CONFLICT (order_id, level) DO NOTHING`,
      [order.id, null, level]
    );

    // Start escalation workflow instance
    try {
      const { EscalationWorkflowService } = await import('./escalation-workflow.service.ts');
      const wf = new EscalationWorkflowService(this.db);
      const newIdRes = await this.db.query('SELECT id FROM escalations WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [order.id]);
      const escalId = newIdRes.rows[0]?.id || ins.rows?.[0]?.id;
      if (escalId) {
        await wf.startForEscalation(escalId, { level });
      }
    } catch {}

    // Skip email; create in-app notifications for role and assignee
    try {
      // Role-wide notification (Operations Manager or target role)
      const roleName = escalationRule?.assignedRole || escalationRule?.target_role || 'Operations Manager';
      await this.notificationService.createInAppNotification?.({
        type: 'escalation_created',
        title: `Escalation L${level} created`,
        message: `Order ${order.order_number || order.id} · Reason: ${escalation.reason}`,
        targets: { roles: [roleName] },
        metadata: { orderId: order.id, level, reason: escalation.reason, businessImpact: impact, agingHours: ageHours }
      } as any);

      if (escalatedTo) {
        await this.notificationService.createInAppNotification?.({
          type: 'escalation_assigned',
          title: `Escalation assigned to you`,
          message: `${order.order_number || order.id} · L${level}`,
          targets: { userIds: [String(escalatedTo)] },
          metadata: { orderId: order.id, level, businessImpact: impact, agingHours: ageHours }
        } as any);
      }
    } catch {}

    // Log escalation
    console.log(`Order ${order.id} escalated to ${escalationRule.assignedRole}`);
  }

  async getEscalationRule(order: any): Promise<EscalationRule | null> {
    const result = await this.db.query(
      `SELECT * FROM escalation_rules 
       WHERE is_active = true 
       AND (order_type = $1 OR order_type IS NULL)
       AND (task_type = $2 OR task_type IS NULL)
       AND (fno_id = $3 OR fno_id IS NULL)
       AND (priority = $4 OR priority IS NULL)
       AND time_threshold_hours <= $5::numeric
       ORDER BY 
         (order_type IS NOT NULL) DESC,
         (task_type IS NOT NULL) DESC,
         (fno_id IS NOT NULL) DESC,
         (priority IS NOT NULL) DESC,
         time_threshold_hours ASC
       LIMIT 1`,
      [
        order.order_type || order.service_type || 'new_install',
        order.task_type || order.current_state || null,
        order.fno_id || null,
        order.priority || 'normal',
        this.getOrderAge(order)
      ]
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      orderType: row.order_type,
      fnoId: row.fno_id,
      timeThreshold: row.time_threshold_hours,
      escalationLevel: 1, // Will be determined by level parameter
      assignedRole: row.target_role,
      isActive: row.is_active,
      maxLevels: row.max_levels
    };
  }

  async getOrdersNeedingEscalation(): Promise<any[]> {
    const result = await this.db.query(`
      SELECT o.*, 
             EXTRACT(EPOCH FROM (NOW() - o.created_at))/3600 as age_hours
      FROM orders o
      WHERE o.current_state NOT IN ('completed', 'cancelled')
    `);

    return result.rows;
  }

  async getEscalations(status?: string): Promise<Escalation[]> {
    const whereClause = status ? 'WHERE status = $1' : '';
    const params = status ? [status] : [];
    
    const result = await this.db.query(
      `SELECT * FROM escalations ${whereClause} ORDER BY created_at DESC`,
      params
    );

    return result.rows.map(row => ({
      id: row.id,
      orderId: row.order_id,
      escalationLevel: row.escalation_level,
      assignedTo: row.escalated_to || '',
      assignedRole: '', // Not stored in DB, would need to be looked up
      reason: row.escalation_reason,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
      status: row.status as 'pending' | 'in_progress' | 'resolved'
    }));
  }

  async resolveEscalation(escalationId: string, resolvedBy: string): Promise<void> {
    await this.db.query(
      `UPDATE escalations 
       SET status = 'resolved', 
           resolved_at = NOW(), 
           escalated_to = $2
       WHERE id = $1`,
      [escalationId, resolvedBy]
    );
  }

  async monitorSLA(): Promise<void> {
    const orders = await this.getOrdersNeedingEscalation();
    for (const order of orders) {
      const { slaHours, warnPct, reescalatePct } = await this.getSLAForOrder(order);
      const age = this.getOrderAge(order);
      if (slaHours <= 0) continue;

      // Warn
      if (age >= warnPct * slaHours && age < slaHours) {
        try {
          const to = process.env.OPS_EMAIL || 'ops@local';
          await this.notificationService.send({
            to,
            subject: `SLA warning for order ${order.order_number || order.id}`,
            html: `<p>Order ${order.order_number || order.id} is approaching SLA. Elapsed ${age.toFixed(1)}h / SLA ${slaHours}h.</p>`,
            text: `Order ${order.order_number || order.id} approaching SLA. Elapsed ${age.toFixed(1)}h / SLA ${slaHours}h.`
          } as any);
        } catch {}
      }
      // Breach → escalate level
      if (age >= slaHours) {
        const rule = await this.getEscalationRule(order);
        if (rule) {
          const applied = await this.db.query(
            `SELECT COALESCE(MAX(level), 0) AS max_level FROM automated_escalations WHERE order_id = $1`,
            [order.id]
          );
          const nextLevel = Number(applied.rows[0]?.max_level || 0) + 1;
          await this.escalateOrder(order, rule, nextLevel);
        }
      }
      // Re-escalate
      if (age >= reescalatePct * slaHours) {
        const applied = await this.db.query(
          `SELECT COALESCE(MAX(level), 0) AS max_level FROM automated_escalations WHERE order_id = $1`,
          [order.id]
        );
        const nextLevel = Number(applied.rows[0]?.max_level || 0) + 1;
        const rule = await this.getEscalationRule(order);
        if (rule && (!rule.maxLevels || nextLevel <= rule.maxLevels)) {
          await this.escalateOrder(order, rule, nextLevel);
        }
      }
    }
  }

  private getOrderAge(order: any): number {
    const createdAt = new Date(order.created_at);
    const now = new Date();
    return (now.getTime() - createdAt.getTime()) / (1000 * 60 * 60); // hours
  }

  private async getSLAForOrder(order: any): Promise<{ slaHours: number; warnPct: number; reescalatePct: number }> {
    const res = await this.db.query(
      `SELECT sla_hours, warn_threshold_pct, reescalate_threshold_pct
       FROM sla_policies
       WHERE is_active = true AND order_type = $1
       ORDER BY (task_type IS NULL) ASC, (priority IS NULL) ASC
       LIMIT 1`,
      [order.order_type || order.service_type || 'new_install']
    );
    const row = res.rows[0];
    const testMinutes = Number(process.env.SLA_TEST_MINUTES || 0);
    const testHours = testMinutes > 0 ? (testMinutes / 60) : undefined;
    return {
      slaHours: testHours ?? (row?.sla_hours || 48),
      warnPct: Number(row?.warn_threshold_pct || 0.75),
      reescalatePct: Number(row?.reescalate_threshold_pct || 1.5)
    };
  }

  private async resolveRecipient(order: any, escalationRule: any, level: number): Promise<string | null> {
    console.log(`[EscalationService] Resolving recipient for rule: ${escalationRule?.target_role}, level: ${level}`);
    
    // 0) On-call override via system_config (per role)
    if (escalationRule?.target_role) {
      const key = `on_call_${escalationRule.target_role.replace(/\s+/g, '_').toLowerCase()}_user_id`;
      const sc = await this.db.query('SELECT config_value FROM system_config WHERE config_key = $1 LIMIT 1', [key]);
      const onCallUserId = sc.rows[0]?.config_value?.userId || sc.rows[0]?.config_value?.id || null;
      if (onCallUserId) {
        const active = await this.db.query('SELECT 1 FROM users WHERE id = $1 AND is_active = true', [onCallUserId]);
        if (active.rowCount && active.rowCount > 0) {
          console.log(`[EscalationService] Using on-call user: ${onCallUserId}`);
          return onCallUserId;
        }
      }
    }

    // 1) direct assignee for L1; manager for L2
    if (order.assigned_to) {
      if (level === 1) {
        console.log(`[EscalationService] Using direct assignee: ${order.assigned_to}`);
        return order.assigned_to;
      }
      const mgr = await this.db.query('SELECT reporting_manager_id FROM users WHERE id = $1', [order.assigned_to]);
      if (mgr.rows[0]?.reporting_manager_id) {
        console.log(`[EscalationService] Using manager: ${mgr.rows[0].reporting_manager_id}`);
        return mgr.rows[0].reporting_manager_id;
      }
    }

    // 2) role-based with load-based selection (fewest open escalations)
    if (escalationRule?.target_role) {
      console.log(`[EscalationService] Looking for users with role: ${escalationRule.target_role}`);
      
      // Try multiple role name variations
      const roleVariations = [
        escalationRule.target_role,
        escalationRule.target_role.replace(/\s+/g, ''),
        escalationRule.target_role.replace(/\s+/g, '_'),
        escalationRule.target_role.toLowerCase(),
        escalationRule.target_role.replace(/\s+/g, '').toLowerCase()
      ];
      
      for (const roleName of roleVariations) {
        console.log(`[EscalationService] Trying role variation: ${roleName}`);
        
      const candidates = await this.db.query(
          `SELECT u.id, u.first_name, u.last_name, r.name as role_name,
                  COALESCE(e.open_count, 0) AS open_count,
                  COALESCE(e.recent_assignments, 0) AS recent_assignments
         FROM users u
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN (
              SELECT escalated_to AS uid, 
                     COUNT(*) FILTER (WHERE status <> 'resolved') AS open_count,
                     COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS recent_assignments
            FROM escalations
            GROUP BY escalated_to
         ) e ON e.uid = u.id
           WHERE (r.name = $1 OR r.name ILIKE $2) AND u.is_active = true
           ORDER BY open_count ASC, recent_assignments ASC, u.created_at ASC
         LIMIT 1`,
          [roleName, `%${roleName}%`]
        );
        
        if (candidates.rows[0]) {
          console.log(`[EscalationService] Found user: ${candidates.rows[0].first_name} ${candidates.rows[0].last_name} (${candidates.rows[0].role_name}) - Open: ${candidates.rows[0].open_count}, Recent: ${candidates.rows[0].recent_assignments}`);
          return candidates.rows[0].id;
        }
      }
      
      console.log(`[EscalationService] No users found for role: ${escalationRule.target_role}`);
    }

    // 3) Safe fallback: pick any active Operations Manager using load-balancing
    console.log(`[EscalationService] Safe fallback: selecting any active Operations Manager`);
    const fallback = await this.db.query(
      `SELECT u.id, u.first_name, u.last_name, r.name as role_name,
              COALESCE(e.open_count, 0) AS open_count,
              COALESCE(e.recent_assignments, 0) AS recent_assignments
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN (
          SELECT escalated_to AS uid, 
                 COUNT(*) FILTER (WHERE status <> 'resolved') AS open_count,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS recent_assignments
          FROM escalations
          GROUP BY escalated_to
       ) e ON e.uid = u.id
       WHERE (r.name = 'Operations Manager' OR r.name ILIKE '%operations%manager%') 
         AND u.is_active = true
       ORDER BY open_count ASC, recent_assignments ASC, u.created_at ASC
       LIMIT 1`
    );
    if (fallback.rows[0]) {
      console.log(`[EscalationService] Fallback found: ${fallback.rows[0].first_name} ${fallback.rows[0].last_name} (${fallback.rows[0].role_name}) - Open: ${fallback.rows[0].open_count}, Recent: ${fallback.rows[0].recent_assignments}`);
      return fallback.rows[0].id;
    }

    // 4) Final fallback: Process Owner role if defined and active
    console.log(`[EscalationService] Final fallback: selecting any active Process Owner`);
    const po = await this.db.query(
      `SELECT u.id, u.first_name, u.last_name, r.name as role_name,
              COALESCE(e.open_count, 0) AS open_count,
              COALESCE(e.recent_assignments, 0) AS recent_assignments
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN (
          SELECT escalated_to AS uid, 
                 COUNT(*) FILTER (WHERE status <> 'resolved') AS open_count,
                 COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS recent_assignments
          FROM escalations
          GROUP BY escalated_to
       ) e ON e.uid = u.id
       WHERE (r.name = 'Process Owner' OR r.name ILIKE '%process%owner%') 
         AND u.is_active = true
       ORDER BY open_count ASC, recent_assignments ASC, u.created_at ASC
       LIMIT 1`
    );
    if (po.rows[0]) {
      console.log(`[EscalationService] Final fallback found: ${po.rows[0].first_name} ${po.rows[0].last_name} (${po.rows[0].role_name})`);
      return po.rows[0].id;
    }

    console.log(`[EscalationService] No recipient found - escalation remains unassigned`);
    return null;
  }
}
