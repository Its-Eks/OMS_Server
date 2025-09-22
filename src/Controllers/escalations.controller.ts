import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';

export async function getMyEscalations(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const userId = (req as any).user?.userId;
  try {
    const cache = new CacheService(redis, 60); // 1 minute cache for escalations
    const cacheKey = buildCacheKey(['escalations:my', userId]);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `SELECT * FROM escalations WHERE escalated_to = $1 AND status <> 'resolved' ORDER BY created_at DESC`,
      [userId]
    );
    const payload = { success: true, data: { escalations: result.rows, total: result.rows.length } };
    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { orderId, taskId, escalationReason, escalationLevel, escalatedTo, priority } = req.body;
  const escalatedFrom = (req as any).user?.userId;
  try {
    const result = await db.query(
      `INSERT INTO escalations (order_id, task_id, escalation_level, escalated_from, escalated_to, escalation_reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING id`,
      [orderId || null, taskId || null, escalationLevel || 1, escalatedFrom, escalatedTo, escalationReason]
    );

    // Invalidate escalations cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['escalations:my']));

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function resolveEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { id } = req.params;
  const { resolutionNotes } = req.body;
  try {
    await db.query(
      `UPDATE escalations SET status = 'resolved', resolved_at = NOW(), resolution_notes = $1 WHERE id = $2`,
      [resolutionNotes || null, id]
    );

    // Invalidate escalations cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['escalations:my']));

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}
