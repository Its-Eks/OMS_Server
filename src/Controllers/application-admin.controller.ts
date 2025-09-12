// Application Admin Controller
import type { Request, Response } from 'express';
import type { Pool } from 'pg';

export async function getInbox(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { page = 1, limit = 20, status, priority, fnoId, overdue } = req.query as any;
  const offset = (Number(page) - 1) * Number(limit);
  try {
    const filters: string[] = [];
    const params: any[] = [];
    if (status) { params.push(status); filters.push(`status = $${params.length}`); }
    if (priority) { params.push(priority); filters.push(`priority = $${params.length}`); }
    if (fnoId) { params.push(fnoId); filters.push(`fno_id = $${params.length}`); }
    if (overdue) { filters.push(`due_date < NOW()`); }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const listSql = `
      SELECT ai.*, o.order_number, o.service_type, c.first_name || ' ' || c.last_name as customer_name, f.name as fno_name
      FROM application_inbox ai
      JOIN orders o ON o.id = ai.order_id
      JOIN customers c ON c.id = o.customer_id
      JOIN fnos f ON f.id = ai.fno_id
      ${where}
      ORDER BY ai.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    const countSql = `SELECT COUNT(*) FROM application_inbox ${where}`;
    const listRes = await db.query(listSql, [...params, Number(limit), offset]);
    const countRes = await db.query(countSql, params);
    res.json({ success: true, data: { applications: listRes.rows, total: Number(countRes.rows[0].count) } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function assignApplication(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { id } = req.params;
  const { assignedTo } = req.body;
  try {
    await db.query('UPDATE application_inbox SET assigned_to = $1, updated_at = NOW() WHERE id = $2', [assignedTo, id]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function completeApplication(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { id } = req.params;
  const { fnoReference, notes } = req.body;
  try {
    // Update inbox
    await db.query('UPDATE application_inbox SET status = $1, completed_at = NOW(), notes = $2 WHERE id = $3', ['completed', notes || null, id]);
    // Update order FNO reference if provided
    if (fnoReference) {
      await db.query(
        'UPDATE orders SET fno_reference = $1, updated_at = NOW() WHERE id = (SELECT order_id FROM application_inbox WHERE id = $2)',
        [fnoReference, id]
      );
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}
