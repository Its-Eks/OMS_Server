import type { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.ts';

export class NotificationsController {
  private getService(req: Request) {
    return new NotificationService(req.app.get('mongoClient'));
  }

  async my(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const limit = parseInt(String(req.query.limit || '50'), 10);
      const svc = this.getService(req);
      const rows = await svc.getMyNotifications(user.userId, user.role);
      res.json({ success: true, data: rows });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async markRead(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const { notificationIds } = req.body as { notificationIds: string[] };
      const svc = this.getService(req);
      const count = await svc.markRead(user.userId, notificationIds || []);
      res.json({ success: true, data: { updated: count } });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async admin(req: Request, res: Response) {
    try {
      const svc = this.getService(req);
      const rows = await svc.getMyNotifications('any', 'System Administrator');
      res.json({ success: true, data: rows });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async upsertRule(req: Request, res: Response) {
    try {
      const svc = this.getService(req);
      const result = await svc.upsertRule(req.body);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async emitEvent(req: Request, res: Response) {
    try {
      const svc = this.getService(req);
      const result = await svc.emitEvent(req.body);
      res.json({ success: true, data: result });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
}


