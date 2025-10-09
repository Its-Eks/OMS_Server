import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { registerUser } from './RegisterController.ts';
import { generateEmailVerificationToken } from './VerificationController.ts';
import { sendEmail } from '../services/notification.service.ts';
import { generatePasswordResetToken } from './PasswordResetController.ts';
import { AuditService } from '../services/audit.service.ts';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';

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
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 180); // 3 minute cache for stats
    const cacheKey = buildCacheKey(['stats:users']);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const totalRes = await db.query('SELECT COUNT(*)::int AS count FROM users');
    const activeRes = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true');
    const inactiveRes = await db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = false');
    const adminRes = await db.query(`
      SELECT COUNT(*)::int AS count
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE (r.permissions @> '["admin:manage_users"]'::jsonb) = true
    `);

    const payload = {
      success: true,
      data: {
        totalUsers: totalRes.rows[0].count,
        activeUsers: activeRes.rows[0].count,
        inactiveUsers: inactiveRes.rows[0].count,
        administrators: adminRes.rows[0].count
      }
    };
    await cache.setJson(cacheKey, payload, 180);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function listUsers(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const { where, params } = buildFilters(req.query);

    // Sorting whitelist
    const sortable = new Set(['created_at', 'updated_at', 'email', 'first_name', 'last_name']);
    const sort = String(req.query.sort || 'created_at');
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    const sortColumn = sortable.has(sort) ? sort : 'created_at';

    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 1000);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);

    const cache = new CacheService(redis, 60);
    const cacheKey = buildCacheKey([
      'users:list',
      where,
      JSON.stringify(params),
      String(req.query.sort || 'created_at'),
      String(req.query.order || 'desc'),
      String(req.query.limit ?? 50),
      String(req.query.offset ?? 0)
    ]);

    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

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

    const payload = { success: true, data: result.rows, meta: { total: countRes.rows[0].count, limit, offset } };
    await cache.setJson(cacheKey, payload, 60);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getUserDetail(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const userId = req.params.id;
    const cache = new CacheService(redis, 300);
    const cacheKey = buildCacheKey(['users:detail', userId]);
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) return res.json({ success: true, data: cached });

    const result = await db.query(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.is_active, u.created_at, u.updated_at,
              r.id as role_id, r.name as role_name, r.permissions
       FROM users u LEFT JOIN roles r ON r.id = u.role_id WHERE u.id = $1 LIMIT 1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: { message: 'User not found' } });
    }
    await cache.setJson(cacheKey, result.rows[0], 300);
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

    // Generate non-expiring setup token and send email
    let setupToken: string | undefined;
    let emailPreviewUrl: string | undefined;
    try {
      const { UserSetupService } = await import('../services/user-setup.service.ts');
      setupToken = await UserSetupService.generateSetupToken(db, userId);
      
      const appUrl = process.env.APP_URL || `https://oms-server-ntlv.onrender.com`;
      const setupLink = `${appUrl}/auth/setup?token=${encodeURIComponent(setupToken)}`;

      const result = await db.query('SELECT email, first_name, last_name FROM users WHERE id = $1', [userId]);
      const userInfo = result.rows[0];
      const toEmail = userInfo?.email as string;
      const firstName = userInfo?.first_name || 'there';

      // Improved welcome email template
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 40px; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 28px;">Welcome to OMS!</h1>
            <p style="color: #e8f0fe; margin: 15px 0 0 0; font-size: 16px;">Your account is ready to be activated</p>
          </div>
          <div style="padding: 40px;">
            <p style="font-size: 18px; color: #333; margin-bottom: 25px;">Hi ${firstName},</p>
            
            <p style="color: #555; line-height: 1.6; margin-bottom: 25px;">
              Your OMS account has been created by an administrator! To get started, please click the link below to verify your email and set up your password.
            </p>
            
            <div style="text-align: center; margin: 35px 0;">
              <a href="${setupLink}" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Complete Account Setup
              </a>
            </div>
            
            <div style="background: #f8f9ff; border-left: 4px solid #667eea; padding: 20px; margin: 25px 0; border-radius: 0 8px 8px 0;">
              <h3 style="margin: 0 0 10px 0; color: #333; font-size: 16px;">What happens next:</h3>
              <ol style="color: #555; margin: 10px 0; padding-left: 20px; line-height: 1.8;">
                <li>Click the setup link above</li>
                <li>Verify your email address</li>
                <li>Create your secure password</li>
                <li>Access the OMS platform</li>
              </ol>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 30px;">
              <strong>Note:</strong> This setup link does not expire, so you can complete your account setup at your convenience.
            </p>
            
            <p style="color: #666; font-size: 14px;">
              If you did not expect this email or need assistance, please contact your system administrator.
            </p>
          </div>
        </div>
      `;

      const resultSend = await sendEmail({
        to: toEmail,
        subject: 'Welcome to OMS - Complete Your Account Setup',
        html: emailHtml
      });
      emailPreviewUrl = (resultSend as any)?.previewUrl;
    } catch (mailError) {
      console.warn('Failed to send setup email:', mailError);
    }

    // Invalidate stats cache when new user is created
    const cache = new CacheService(redis);
    await cache.del(buildCacheKey(['stats:users']));
    await cache.delByPrefix(buildCacheKey(['users:list']));

    const responseBody: any = { 
      success: true, 
      userId,
      message: 'User created successfully! Setup email sent to user.'
    };
    if (setupToken) responseBody.setupToken = setupToken;
    if (emailPreviewUrl && process.env.NODE_ENV !== 'production') responseBody.emailPreviewUrl = emailPreviewUrl;
    res.status(201).json(responseBody);
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function updateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
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
    // Invalidate caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['users:list']));
    await cache.del(buildCacheKey(['users:detail', userId]));
    await cache.del(buildCacheKey(['stats:users']));
    // Audit
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'update', 'user', String(userId || ''), {}, { firstName, lastName, roleId, roleName }, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function deactivateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const userId = req.params.id;
  try {
    if ((req as any).user?.userId === userId) {
      return res.status(400).json({ success: false, error: { message: 'Cannot deactivate your own account' } });
    }
    await db.query('UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1', [userId]);
    // Invalidate caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['users:list']));
    await cache.del(buildCacheKey(['users:detail', userId]));
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'deactivate', 'user', String(userId || ''), {}, {}, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function reactivateUserAdmin(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const userId = req.params.id;
  try {
    await db.query('UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1', [userId]);
    // Invalidate caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['users:list']));
    await cache.del(buildCacheKey(['users:detail', userId]));
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
  const redis = req.app.get('redis');
  const userId = req.params.id;
  try {
    if ((req as any).user?.userId === userId) {
      return res.status(400).json({ success: false, error: { message: 'Cannot delete your own account' } });
    }
    await db.query('DELETE FROM users WHERE id = $1', [userId]);
    // Invalidate caches
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['users:list']));
    await cache.del(buildCacheKey(['users:detail', userId]));
    try { await new AuditService(db).logAction(String((req as any).user?.userId || ''), 'delete', 'user', String(userId || ''), {}, {}, String(req.ip || ''), String(req.get('User-Agent') || '')); } catch {}
    res.json({ success: true });
  } catch (error: any) {
    res.status(400).json({ success: false, error: { message: error.message } });
  }
}

export async function getUserActivities(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  try {
    const userId = String(req.params.id);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const action = req.query.action ? String(req.query.action) : undefined;
    const resourceType = req.query.resourceType ? String(req.query.resourceType) : undefined;

    const clauses: string[] = ['user_id = $1'];
    const params: any[] = [userId];
    if (action) {
      params.push(action);
      clauses.push(`action = $${params.length}`);
    }
    if (resourceType) {
      params.push(resourceType);
      clauses.push(`resource_type = $${params.length}`);
    }
    const where = 'WHERE ' + clauses.join(' AND ');

    const countSql = `SELECT COUNT(*)::int AS count FROM audit_logs ${where}`;
    const listSql = `
      SELECT id, user_id, action, resource_type, resource_id, old_values, new_values, ip_address, user_agent, created_at
      FROM audit_logs
      ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `;
    const [countRes, listRes] = await Promise.all([
      db.query(countSql, params),
      db.query(listSql, [...params, limit, offset])
    ]);

    res.json({
      success: true,
      data: listRes.rows,
      meta: { total: countRes.rows[0].count, limit, offset }
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}