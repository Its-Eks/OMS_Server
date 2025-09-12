import type { Request, Response } from 'express';
import type { Pool } from 'pg';

export async function getMyEscalations(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = (req as any).user?.userId;
  try {
    const result = await db.query(
      `SELECT * FROM escalations WHERE escalated_to = $1 AND status <> 'resolved' ORDER BY created_at DESC`,
      [userId]
    );
    res.json({ success: true, data: { escalations: result.rows, total: result.rows.length } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { orderId, taskId, escalationReason, escalationLevel, escalatedTo, priority } = req.body;
  const escalatedFrom = (req as any).user?.userId;
  try {
    const result = await db.query(
      `INSERT INTO escalations (order_id, task_id, escalation_level, escalated_from, escalated_to, escalation_reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'open') RETURNING id`,
      [orderId || null, taskId || null, escalationLevel || 1, escalatedFrom, escalatedTo, escalationReason]
    );
    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function resolveEscalation(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { id } = req.params;
  const { resolutionNotes } = req.body;
  try {
    await db.query(
      `UPDATE escalations SET status = 'resolved', resolved_at = NOW(), resolution_notes = $1 WHERE id = $2`,
      [resolutionNotes || null, id]
    );
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}
