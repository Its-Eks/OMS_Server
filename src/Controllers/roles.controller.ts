import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';

export async function listRoles(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 600);
    const cacheKey = buildCacheKey(['roles:list']);
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) return res.json(cached);

    const result = await db.query('SELECT id, name, description, permissions FROM roles ORDER BY name');
    const payload = { success: true, roles: result.rows };
    await cache.setJson(cacheKey, payload, 600);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function createRole(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { name, description, permissions } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO roles (name, description, permissions) VALUES ($1, $2, $3) RETURNING id',
      [name, description || null, permissions || []]
    );
    // Invalidate cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['roles:list']));
    res.status(201).json({ success: true, roleId: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function updateRole(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const roleId = req.params.id;
  const { name, description, permissions } = req.body;
  try {
    await db.query(
      'UPDATE roles SET name = COALESCE($1, name), description = COALESCE($2, description), permissions = COALESCE($3, permissions), updated_at = NOW() WHERE id = $4',
      [name || null, description || null, permissions || null, roleId]
    );
    // Invalidate cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['roles:list']));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function assignUserRole(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const { userId, roleId } = req.body;
  try {
    await db.query('UPDATE users SET role_id = $1, updated_at = NOW() WHERE id = $2', [roleId, userId]);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}


