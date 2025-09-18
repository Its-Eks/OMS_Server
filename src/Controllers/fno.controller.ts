// FNO Controller
import type { Request, Response } from 'express';
import { FNOService } from '../services/fno-integration.service.ts';

export class FNOController {

  async getFNOs(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const page = parseInt(String(req.query.page || '1'), 10);
      const limit = parseInt(String(req.query.limit || '50'), 10);
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const data = await service.getFNOs({ page, limit });
      const nextSteps = await service.getGlobalNextSteps();
      res.json({ success: true, data, guidance: { nextSteps } });
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async submitOrder(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const { fnoId } = req.params as { fnoId: string };
      const { orderId, submissionType } = req.body as { orderId: string; submissionType: 'api' | 'manual' };
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const result = await service.submitOrderToFNO({ fnoId, orderId, submissionType });
      const nextSteps = await service.getNextStepsForFNO(fnoId);
      res.json({ success: true, data: result, guidance: { nextSteps } });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async updateManualApplication(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const { applicationId } = req.params as { applicationId: string };
      const { fnoReference, status, notes } = req.body as { fnoReference: string; status: 'submitted' | 'accepted' | 'rejected' | 'in_progress'; notes?: string };
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const payload: { applicationId: string; fnoReference: string; status: 'submitted' | 'accepted' | 'rejected' | 'in_progress'; notes?: string } = { applicationId, fnoReference, status };
      if (typeof notes === 'string') {
        payload.notes = notes;
      }
      const updated = await service.updateManualApplication(payload);
      const appRow = await req.app.get('pgPool').query('SELECT fno_id FROM application_inbox WHERE id = $1', [applicationId]);
      const fnoId = appRow.rows[0]?.fno_id as string | undefined;
      const nextSteps = fnoId ? await service.getNextStepsForFNO(fnoId) : await service.getGlobalNextSteps();
      res.json({ success: true, data: updated, guidance: { nextSteps } });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getFNOConfiguration(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const redis: any = req.app.get('redis');
      const cacheKey = 'fno:configuration:v1';
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return res.json(JSON.parse(cached));
        } catch {}
      }
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const cfg = await service.getConfigurationDashboard();
      const nextSteps = await service.getGlobalNextSteps();
      const payload = { success: true, data: { items: cfg.items }, guidance: { nextSteps } };
      if (redis) {
        try { await redis.set(cacheKey, JSON.stringify(payload), { EX: 60 }); } catch {}
      }
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getIntegrationLogs(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const limit = parseInt(String(req.query.limit || '50'), 10);
      const redis: any = req.app.get('redis');
      const cacheKey = `fno:logs:v1:${limit}`;
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return res.json(JSON.parse(cached));
        } catch {}
      }
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const data = await service.getRecentIntegrationLogs({ limit });
      const nextSteps = await service.getGlobalNextSteps();
      const payload = { success: true, data, guidance: { nextSteps } };
      if (redis) {
        try { await redis.set(cacheKey, JSON.stringify(payload), { EX: 30 }); } catch {}
      }
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getMonitoring(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const redis: any = req.app.get('redis');
      const cacheKey = 'fno:monitoring:v1';
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return res.json(JSON.parse(cached));
        } catch {}
      }
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const data = await service.getMonitoringSummary();
      const nextSteps = await service.getGlobalNextSteps();
      const payload = { success: true, data, guidance: { nextSteps } };
      if (redis) {
        try { await redis.set(cacheKey, JSON.stringify(payload), { EX: 60 }); } catch {}
      }
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async getFNOStats(req: Request, res: Response) {
    try {
      if (!req.app.get('mongoClient')) {
        try { (await import('../Database/main.ts')).connectMongoDB?.(); } catch {}
      }
      const redis: any = req.app.get('redis');
      const cacheKey = 'fno:stats:v1';
      if (redis) {
        try {
          const cached = await redis.get(cacheKey);
          if (cached) return res.json(JSON.parse(cached));
        } catch {}
      }
      const service = new FNOService(req.app.get('pgPool'), req.app.get('mongoClient'));
      const cfg = await service.getConfigurationDashboard();
      const nextSteps = await service.getGlobalNextSteps();
      const payload = { success: true, data: { totals: cfg.totals, metrics: cfg.metrics }, guidance: { nextSteps } };
      if (redis) {
        try { await redis.set(cacheKey, JSON.stringify(payload), { EX: 60 }); } catch {}
      }
      res.json(payload);
    } catch (error: any) {
      res.status(500).json({ success: false, error: error.message });
    }
  }
}
