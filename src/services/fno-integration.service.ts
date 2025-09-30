import { Pool } from 'pg';
import type { MongoClient } from 'mongodb';

type SubmitOrderParams = {
  orderId: string;
  fnoId: string;
  submissionType: 'api' | 'manual';
};

type UpdateManualApplicationParams = {
  applicationId: string;
  fnoReference: string;
  status: 'submitted' | 'accepted' | 'rejected' | 'in_progress';
  notes?: string;
};

export class FNOService {
  private db: Pool;
  private mongo: MongoClient;

  constructor(db: Pool, mongo: MongoClient) {
    this.db = db;
    this.mongo = mongo;
  }

  async getConfigurationDashboard() {
    // Aggregate Postgres fnos with orders and mock success rates + last sync from logs
    const fnos = await this.db.query('SELECT id, name, code, integration_type, portal_url, api_endpoint, coverage_areas, is_active FROM fnos ORDER BY name');

    // Orders and success rates via logs
    const db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    const logs = await db.collection('fno_integration_logs').aggregate([
      { $match: {} },
      { $group: {
          _id: { fnoId: '$fnoId' },
          orders: { $sum: { $cond: [{ $eq: ['$action', 'submit'] }, 1, 0] } },
          successCount: { $sum: { $cond: ['$success', 1, 0] } },
          lastSync: { $max: { $cond: [{ $eq: ['$integrationType', 'api'] }, '$createdAt', null] } }
        }
      }
    ]).toArray();

    const byFno: Record<string, any> = {};
    logs.forEach((l: any) => {
      byFno[l._id.fnoId] = l;
    });

    const items = fnos.rows.map((f: any) => {
      const agg = byFno[f.id] || { orders: 0, successCount: 0, lastSync: null };
      const successRate = agg.orders > 0 ? Math.round((agg.successCount / agg.orders) * 1000) / 10 : null;
      const type = f.integration_type;
      const status = type === 'api' ? (agg.lastSync ? 'connected' : 'error') : (f.is_active ? 'active' : 'inactive');
      const coverage = Array.isArray(f.coverage_areas) ? f.coverage_areas : [];
      return {
        id: f.id,
        name: f.name,
        code: f.code,
        type,
        status,
        coverageAreas: coverage,
        orders: agg.orders,
        successRate,
        lastSync: agg.lastSync
      };
    });

    const totals = {
      totalFNOs: items.length,
      active: items.filter(i => i.status === 'connected' || i.status === 'active').length,
      apiIntegrations: items.filter(i => i.type === 'api').length,
      manualIntegrations: items.filter(i => i.type === 'manual').length
    };

    // Monthly metrics
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const db2 = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    const monthAgg = await db2.collection('fno_integration_logs').aggregate([
      { $match: { createdAt: { $gte: startOfMonth } } },
      { $group: {
          _id: null,
          totalSubmits: { $sum: { $cond: [{ $eq: ['$action', 'submit'] }, 1, 0] } },
          successSubmits: { $sum: { $cond: [{ $and: [{ $eq: ['$action', 'submit'] }, '$success'] }, 1, 0] } }
        }
      }
    ]).toArray();
    const m = monthAgg[0] || { totalSubmits: 0, successSubmits: 0 };
    const ordersProcessedThisMonth = m.totalSubmits || 0;
    const averageSuccessRate = m.totalSubmits > 0 ? Math.round((m.successSubmits / m.totalSubmits) * 1000) / 10 : null;

    return { totals, metrics: { ordersProcessedThisMonth, averageSuccessRate }, items };
  }

  async getRecentIntegrationLogs({ limit = 50 }: { limit?: number }) {
    const db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    const rows = await db.collection('fno_integration_logs')
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    return rows.map((r: any) => ({
      timestamp: r.createdAt,
      fnoId: r.fnoId,
      orderId: r.orderId,
      action: r.action,
      status: r.success ? 'success' : 'error',
      responseTimeMs: r.processingTime,
      details: r.errorMessage || (r.action === 'submit' ? 'Order submitted successfully' : 'OK')
    }));
  }

  async getMonitoringSummary() {
    const db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    const agg = await db.collection('fno_integration_logs').aggregate([
      { $group: {
          _id: { fnoId: '$fnoId', integrationType: '$integrationType' },
          orders: { $sum: { $cond: [{ $eq: ['$action', 'submit'] }, 1, 0] } },
          successCount: { $sum: { $cond: ['$success', 1, 0] } }
        }
      }
    ]).toArray();

    const byKey: Record<string, any> = {};
    agg.forEach((a: any) => {
      byKey[`${a._id.fnoId}:${a._id.integrationType}`] = a;
    });

    const fnos = await this.db.query('SELECT id, name, code, integration_type FROM fnos');
    const api = fnos.rows
      .filter((f: any) => f.integration_type === 'api')
      .map((f: any) => {
        const k = `${f.id}:api`;
        const data = byKey[k] || { orders: 0, successCount: 0 };
        const successRate = data.orders > 0 ? Math.round((data.successCount / data.orders) * 1000) / 10 : null;
        // Status inferred from any activity
        const status = data.orders > 0 ? 'connected' : 'error';
        return { name: f.name, code: f.code, status, successRate, orders: data.orders };
      });

    const manual = fnos.rows
      .filter((f: any) => f.integration_type === 'manual')
      .map((f: any) => {
        const k = `${f.id}:manual`;
        const data = byKey[k] || { orders: 0, successCount: 0 };
        const successRate = data.orders > 0 ? Math.round((data.successCount / data.orders) * 1000) / 10 : null;
        const status = 'active';
        return { name: f.name, code: f.code, status, successRate, orders: data.orders };
      });

    return { api, manual };
  }

  async getFNOs({ page = 1, limit = 50 }: { page?: number; limit?: number }) {
    const offset = (page - 1) * limit;
    const [rows, count] = await Promise.all([
      this.db.query('SELECT * FROM fnos WHERE is_active = true ORDER BY name ASC LIMIT $1 OFFSET $2', [limit, offset]),
      this.db.query('SELECT COUNT(1) AS total FROM fnos WHERE is_active = true')
    ]);

    return { fnos: rows.rows, total: parseInt(count.rows[0].total, 10) };
  }

  async submitOrderToFNO({ orderId, fnoId, submissionType }: SubmitOrderParams) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      // Fetch order and FNO
      // Debug log incoming params
      try {
        // eslint-disable-next-line no-console
        console.log('[FNO service] submitOrderToFNO params:', { orderId, fnoId, submissionType });
      } catch {}
      const orderRes = await client.query('SELECT * FROM orders WHERE id = $1', [orderId]);
      if (orderRes.rows.length === 0) throw new Error('Order not found');
      const fnoRes = await client.query('SELECT * FROM fnos WHERE id = $1 AND is_active = true', [fnoId]);
      if (fnoRes.rows.length === 0) throw new Error('FNO not found or inactive');

      const order = orderRes.rows[0];
      const fno = fnoRes.rows[0];

      // Enforce business rule with flexibility for manual submissions
      const currentState = (order.status || order.current_state || '').toString();
      const normalizedType = (submissionType || 'manual').toString().toLowerCase() as 'api' | 'manual';
      const isManual = normalizedType === 'manual';
      const allowedForManual = currentState === 'enriched' || currentState === 'validated' || currentState === 'fno_submitted';
      const alreadySubmitted = currentState === 'fno_submitted';
      if (!isManual && currentState !== 'enriched') {
        throw new Error('Order must be in enriched state before FNO submission');
      }
      if (isManual && !allowedForManual) {
        throw new Error('Manual submission allowed only after validation or enrichment');
      }

      if (normalizedType === 'manual') {
        // 1) Create application inbox entry first
        const inbox = await client.query(
          `INSERT INTO application_inbox (order_id, fno_id, priority, status, created_at, due_date, notes)
           VALUES ($1, $2, $3, $4, NOW(), NOW() + INTERVAL '48 hours', NULL) RETURNING *`,
          [orderId, fnoId, order.priority || 'normal', 'pending']
        );

        // 2) Link FNO to order; set status to fno_submitted only if not already
        if (alreadySubmitted) {
          await client.query(
            'UPDATE orders SET fno_id = $1, updated_at = NOW() WHERE id = $2',
            [fnoId, orderId]
          );
        } else {
          await client.query(
            'UPDATE orders SET fno_id = $1, status = $2, updated_at = NOW() WHERE id = $3',
            [fnoId, 'fno_submitted', orderId]
          );
        }

        await this.logFNOIntegration({
          orderId,
          fnoId,
          integrationType: 'manual',
          action: 'submit',
          request: { method: 'PORTAL', url: fno.portal_url, headers: {}, body: { orderId } },
          response: { statusCode: 200, headers: {}, body: { applicationId: inbox.rows[0].id } },
          processingTime: 0,
          success: true
        });

        // Emit notification event for manual submission
        try {
          const { NotificationService } = await import('./notification.service.ts');
          const notif = new NotificationService(this.mongo);
          await notif.emitEvent({ type: 'fno_submit_manual', userId: String(order.created_by || 'system'), metadata: { orderId, fnoId } });
        } catch {}

        await client.query('COMMIT');
        return { submissionId: inbox.rows[0].id, status: 'pending', message: 'Manual application created' };
      }

      // API submission stub: simulate outbound call
      const start = Date.now();
      // TODO: Replace with real HTTP client integration per FNO API spec
      const simulatedResponse = { statusCode: 202, body: { reference: `FNO-${Date.now()}` } };
      const processingTime = Date.now() - start;

      await client.query('UPDATE orders SET fno_reference = $1, updated_at = NOW() WHERE id = $2', [
        simulatedResponse.body.reference,
        orderId
      ]);

      await this.logFNOIntegration({
        orderId,
        fnoId,
        integrationType: 'api',
        action: 'submit',
        request: { method: 'POST', url: fno.api_endpoint, headers: { 'x-api-key': '********' }, body: order },
        response: { statusCode: simulatedResponse.statusCode, headers: {}, body: simulatedResponse.body },
        processingTime,
        success: true
      });

      // Emit notification event for API submission
      try {
        const { NotificationService } = await import('./notification.service.ts');
        const notif = new NotificationService(this.mongo);
        await notif.emitEvent({ type: 'fno_submit_api', userId: String(order.created_by || 'system'), metadata: { orderId, fnoId, reference: simulatedResponse.body.reference } });
      } catch {}

      // Advance order state for API submissions after reference is captured
      await client.query(
        'UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2',
        ['fno_submitted', orderId]
      );

      await client.query('COMMIT');
      return { submissionId: orderId, fnoReference: simulatedResponse.body.reference, status: 'submitted' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateManualApplication({ applicationId, fnoReference, status, notes }: UpdateManualApplicationParams) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const appRes = await client.query('SELECT * FROM application_inbox WHERE id = $1', [applicationId]);
      if (appRes.rows.length === 0) throw new Error('Application not found');
      const app = appRes.rows[0];

      await client.query(
        `UPDATE application_inbox SET status = $1, notes = COALESCE(notes, '') || $2, completed_at = CASE WHEN $1 = 'completed' THEN NOW() ELSE completed_at END, updated_at = NOW() WHERE id = $3`,
        [status, notes ? `\n${new Date().toISOString()} - ${notes}` : '', applicationId]
      );

      // Update order with FNO reference if provided
      if (fnoReference) {
        await client.query('UPDATE orders SET fno_reference = $1, updated_at = NOW() WHERE id = $2', [
          fnoReference,
          app.order_id
        ]);
      }

      await this.logFNOIntegration({
        orderId: app.order_id,
        fnoId: app.fno_id,
        integrationType: 'manual',
        action: 'status_update',
        request: { method: 'PORTAL', url: null, headers: {}, body: { applicationId, status, fnoReference, notes } },
        response: { statusCode: 200, headers: {}, body: { ok: true } },
        processingTime: 0,
        success: true
      });

      await client.query('COMMIT');
      return { applicationId, status, fnoReference };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async logFNOIntegration(entry: {
    orderId: string;
    fnoId: string;
    integrationType: 'api' | 'manual';
    action: 'submit' | 'status_update' | 'query';
    request: any;
    response: any;
    processingTime: number;
    success: boolean;
    errorMessage?: string;
  }) {
    const db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    await db.collection('fno_integration_logs').insertOne({
      ...entry,
      createdAt: new Date()
    });
  }

  // Guidance: compute next steps for a given FNO id
  async getNextStepsForFNO(fnoId: string) {
    const fnoRes = await this.db.query('SELECT id, name, code, integration_type, api_endpoint, api_key_encrypted, portal_url, is_active FROM fnos WHERE id = $1', [fnoId]);
    if (fnoRes.rows.length === 0) return [];
    const f = fnoRes.rows[0];
    const db = this.mongo.db(process.env.MONGODB_DB || 'isp_oms_logs');
    const lastApiSuccess = await db.collection('fno_integration_logs').find({ fnoId, integrationType: 'api', success: true }).sort({ createdAt: -1 }).limit(1).toArray();
    const steps: Array<{ title: string; description: string; action?: { method: string; url: string; bodyExample?: any } }> = [];

    if (!f.is_active) {
      steps.push({ title: 'Activate FNO', description: 'Enable this FNO to allow submissions.', action: { method: 'PUT', url: `/fno/${fnoId}`, bodyExample: { isActive: true } } });
    }

    if (f.integration_type === 'api') {
      if (!f.api_endpoint) {
        steps.push({ title: 'Set API Endpoint', description: 'Provide the API base URL for this FNO.', action: { method: 'PUT', url: `/fno/${fnoId}`, bodyExample: { apiEndpoint: 'https://api.example.com/orders' } } });
      }
      if (!f.api_key_encrypted) {
        steps.push({ title: 'Add API Key', description: 'Store the API key securely to authenticate requests.', action: { method: 'PUT', url: `/fno/${fnoId}`, bodyExample: { apiKey: 'YOUR-API-KEY' } } });
      }
      if (lastApiSuccess.length === 0) {
        steps.push({ title: 'Test Connection', description: 'Run a test call to verify connectivity.', action: { method: 'POST', url: `/fno/${fnoId}/test` } });
      }
      steps.push({ title: 'Submit Sample Order', description: 'Exercise the integration with a sample order.', action: { method: 'POST', url: `/fno/${fnoId}/submit-order`, bodyExample: { orderId: '<order-uuid>', submissionType: 'api' } } });
    } else {
      steps.push({ title: 'Prepare Manual Workflow', description: 'Ensure application administrators have portal access and SOP.', action: { method: 'GET', url: `/fno/fnoConfiguration` } });
      steps.push({ title: 'Create Manual Application', description: 'Route an order to application inbox for manual processing.', action: { method: 'POST', url: `/fno/${fnoId}/submit-order`, bodyExample: { orderId: '<order-uuid>', submissionType: 'manual' } } });
    }

    return steps;
  }

  // Guidance: global next steps for list/monitoring views
  async getGlobalNextSteps() {
    const rows = await this.db.query('SELECT id, integration_type, is_active, api_endpoint, api_key_encrypted FROM fnos');
    const anyInactive = rows.rows.some((r: any) => !r.is_active);
    const anyApiWithoutKey = rows.rows.some((r: any) => r.integration_type === 'api' && !r.api_key_encrypted);
    const steps: Array<{ title: string; description: string; action?: { method: string; url: string; bodyExample?: any } }> = [];
    if (anyInactive) steps.push({ title: 'Activate inactive FNOs', description: 'Enable disabled FNOs to allow submissions.', action: { method: 'GET', url: '/fno/fnoConfiguration' } });
    if (anyApiWithoutKey) steps.push({ title: 'Add missing API keys', description: 'Some API FNOs are missing credentials.', action: { method: 'GET', url: '/fno/fnoConfiguration' } });
    steps.push({ title: 'Review Integration Logs', description: 'Verify recent errors and timeouts.', action: { method: 'GET', url: '/fno/integrationLogs?limit=50' } });
    steps.push({ title: 'Check Monitoring', description: 'Confirm success rates and order throughput.', action: { method: 'GET', url: '/fno/monitoring' } });
    return steps;
  }
}

// Backwards-compatible minimal wrapper (if referenced elsewhere)
export class FNOIntegrationService {
  async integrateWithFNO(orderId: string, fnoId: string, payload: any) {
    // Placeholder to avoid breaking existing imports; prefer FNOService
    return { success: true };
  }
}
