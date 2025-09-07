import type { Request, Response } from 'express';
import { AuditService } from '../services/audit.service.ts';
import { Pool } from 'pg';

// Assume db pool is available via req.app.get('pgPool')

export async function createUser(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { email, firstName, lastName, password, roleId } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO users (email, first_name, last_name, password_hash, role_id, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW()) RETURNING id`,
      [email, firstName, lastName, password, roleId]
    );
    res.json({ success: true, userId: result.rows[0].id });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function updateUser(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { firstName, lastName, roleId } = req.body;
  const userId = req.params.id;
  try {
    await db.query(
      `UPDATE users SET first_name = $1, last_name = $2, role_id = $3, updated_at = NOW() WHERE id = $4`,
      [firstName, lastName, roleId, userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function deactivateUser(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = req.params.id;
  try {
    await db.query(
      `UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [userId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}

export async function getAuditLogs(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const auditService = new AuditService(db);
  try {
    const logs = await auditService.getAuditLogs(100);
    res.json({ success: true, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
}
