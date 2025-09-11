import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { registerUser } from './RegisterController.ts';
import { generatePasswordResetToken } from './PasswordResetController.ts';
import { AuditService } from '../services/audit.service.ts';

function buildFilters(query: any): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (query.status === 'active') {
    clauses.push('u.is_active = true');
  } else if (query.status === 'inactive') {
    clauses.push('u.is_active = false');
  }

  if (query.roleName) {
    params.push(String(query.roleName));
    clauses.push('LOWER(r.name) = LOWER($' + params.length + ')');
  }

  if (query.search) {
    const term = `%${String(query.search)}%`;
    params.push(term, term, term);
    clauses.push('(u.email ILIKE $' + (params.length - 2) + ' OR u.first_name ILIKE $' + (params.length - 1) + ' OR u.last_name ILIKE $' + params.length + ')');
  }

  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return { where, params };
}

export async function getUserStats(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const totalRes = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const activeRes = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true');
    const inactiveRes = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = false');
    const adminRes = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE (r.permissions @> '["admin:manage_users"]'::jsonb) = true
    `);

    res.json({
      success: true,
      data: {
        totalUsers: totalRes.rows[0].count,
        activeUsers: activeRes.rows[0].count,
        inactiveUsers: inactiveRes.rows[0].count,
        administrators: adminRes.rows[0].count
      }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function listUsers(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const { where, params } = buildFilters(req.query);

    // Sorting whitelist
    const sortable = new Set(['created_at', 'updated_at', 'email', 'first_name', 'last_name']);
    const sort = String(req.query.sort || 'created_at');
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = sortable.has(sort) ? sort : 'created_at';

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 1000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const countRes = await db.query(
      `SELECT COUNT(*)::int AS count FROM users u LEFT JOIN roles r ON r.id = u.role_id ${where}`,
      params
    );

    const result = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.created_at, u.updated_at,
              r.id as role_id, r.name as role_name
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ${where}
       ORDER BY ${sortColumn} ${order}
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    res.json({ success: true, data: result.rows, meta: { total: countRes.rows[0].count, limit, offset } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getUserDetail(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const userId = req.params.id;
    const result = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.created_at, u.updated_at,
              r.id as role_id, r.name as role_name, r.permissions
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const userId = await registerUser(db, redis, req.body);
    // Optionally trigger email here in future
    res.status(201).json({ success: true, userId });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function updateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { firstName, lastName, roleId, roleName } = req.body;
  const userId = req.params.id;
  try {
    // Prevent self role change to avoid locking yourself out unintentionally
    if ((req as any).user?.userId === userId && (roleId || roleName)) {
      return res.status(400).json({ success: false, error: { message: 'Cannot change your own role' } });
    }
    let resolvedRoleId: string | null = null;
    if (roleId) {
      const r = await db.query('SELECT id FROM roles WHERE id = $1', [roleId]);
      if (r.rows.length === 0) throw new Error('Invalid roleId');
      resolvedRoleId = r.rows[0].id;
    } else if (roleName) {
      const r = await db.query('SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1', [String(roleName)]);
      if (r.rows.length === 0) throw new Error('Invalid roleName');
      resolvedRoleId = r.rows[0].id;
    }

    await db.query(
      `UPDATE users SET
         first_name = COALESCE($1, first_name),
         last_name  = COALESCE($2, last_name),
         role_id    = COALESCE($3, role_id),
         updated_at = NOW()
       WHERE id = $4`,
      [firstName || null, lastName || null, resolvedRoleId, userId]
    );
    // Audit
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'update', 'user', String(userId || ''), {}, { firstName, lastName, roleId, roleName }, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function deactivateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = req.params.id;
  try {
    if ((req as any).user?.userId === userId) {
      return res.status(400).json({ success: false, error: { message: 'Cannot deactivate your own account' } });
    }
    await db.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [userId]);
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'deactivate', 'user', String(userId || ''), {}, {}, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function reactivateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = req.params.id;
  try {
    await db.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [userId]);
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'reactivate', 'user', String(userId || ''), {}, {}, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function resetPasswordAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = req.params.id;
  try {
    const result = await db.query('SELECT email FROM users WHERE id = $1', [userId]);
    if (result.rows.length === 0) throw new Error('User not found');
    const email = result.rows[0].email as string;
    const token = await generatePasswordResetToken(db, email);
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'reset_password_request', 'user', String(userId || ''), {}, { token: 'generated' }, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true, resetToken: token });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function deleteUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const userId = req.params.id;
  try {
    if ((req as any).user?.userId === userId) {
      return res.status(400).json({ success: false, error: { message: 'Cannot delete your own account' } });
    }
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'delete', 'user', String(userId || ''), {}, {}, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}


