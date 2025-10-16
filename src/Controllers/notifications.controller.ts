import type { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.ts';

export class NotificationsController {
  private getService(req: Request) {
    return new NotificationService(req.app.get('mongoClient'));
  }

  async my(req: Request, res: Response) {
    try {
      // For testing without authentication, use default values
      const user = (req as any).user || { userId: 'b09a452d-62eb-4bee-9eeb-a19b3a91ea3b', role: 'system_administrator' };
      const limit = parseInt(String(req.query.limit || '50'), 10);
      const svc = this.getService(req);
      const rows = await svc.getMyNotifications(user.userId, user.role, limit);
      res.json({ success: true, data: rows, count: rows.length });
    } catch (e: any) {
      console.error('Notifications error:', e);
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

  async deleteRead(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      
      // Debug: Log the entire request to see what we're receiving
      console.log(`🔍 DELETE request debug:`, {
        body: req.body,
        query: req.query,
        params: req.params,
        headers: req.headers['content-type']
      });
      
      const { notificationIds } = req.body as { notificationIds: string[] };
      
      console.log(`🗑️ Delete request from user ${user.userId} (${user.role}) for notifications:`, notificationIds);
      
      if (!notificationIds || !Array.isArray(notificationIds) || notificationIds.length === 0) {
        return res.status(400).json({ success: false, error: 'notificationIds array is required' });
      }
      
      const svc = this.getService(req);
      const count = await svc.deleteNotifications(user.userId, notificationIds, user.role);
      
      console.log(`✅ Successfully deleted ${count} notifications`);
      res.json({ success: true, data: { deleted: count } });
    } catch (e: any) {
      console.error(`❌ Delete notifications error:`, e);
      res.status(500).json({ success: false, error: e.message });
    }
  }

  async deleteAll(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const svc = this.getService(req);
      const count = await svc.deleteAllNotifications(user.role);
      res.json({ success: true, data: { deleted: count, message: 'All notifications deleted' } });
    } catch (e: any) {
      res.status(403).json({ success: false, error: e.message });
    }
  }

  async admin(req: Request, res: Response) {
    try {
      const user = (req as any).user;
      const role = String(user?.role || '').trim().toLowerCase();
      const isSysAdmin = role === 'system administrator';
      if (!isSysAdmin) {
        return res.status(403).json({ success: false, error: 'Admin only' });
      }
      const svc = this.getService(req);
      const rows = await svc.getMyNotifications(user.userId, 'System Administrator');
      res.json({ success: true, data: rows, count: rows.length });
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

  // Immediate in-app notification (bypass rules/processor)
  async createDirect(req: Request, res: Response) {
    try {
      const { type, title, message, targets, metadata } = req.body || {};
      if (!type || !title || !message || !targets || (!targets.userIds && !targets.roles && !targets.broadcast)) {
        return res.status(400).json({ success: false, error: 'type, title, message and targets{userIds|roles|broadcast} are required' });
      }
      const svc = this.getService(req);
      const out = await svc.createInAppNotification({ type, title, message, targets, metadata });
      if (!out) return res.status(500).json({ success: false, error: 'Failed to create notification' });
      res.json({ success: true, data: { id: out.id } });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  }
}


