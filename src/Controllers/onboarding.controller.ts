import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from '../services/cache.service.ts';

export async function initiateOnboarding(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { customerId, orderId, onboardingType, assignedTo } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO customer_onboarding (customer_id, order_id, onboarding_type, current_step, completion_percentage, assigned_to)
       VALUES ($1, $2, $3, 'initiated', 0, $4)
       RETURNING id`,
      [customerId, orderId || null, onboardingType, assignedTo || null]
    );

    // Invalidate onboarding cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['onboarding']));

    res.status(201).json({ success: true, id: result.rows[0].id });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getCustomerOnboarding(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { customerId } = req.params as any;
  try {
    const cache = new CacheService(redis, 120); // 2 minute cache for onboarding
    const cacheKey = buildCacheKey(['onboarding:customer', customerId]);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `SELECT * FROM customer_onboarding WHERE customer_id = $1 ORDER BY started_at DESC LIMIT 1`,
      [customerId]
    );
    const payload = { success: true, data: result.rows[0] || null };
    await cache.setJson(cacheKey, payload, 120);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function completeOnboardingStep(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  const { onboardingId, stepId } = req.params as any;
  const { notes } = req.body;
  try {
    // Minimal stub: update current_step and completion
    await db.query(
      `UPDATE customer_onboarding 
         SET current_step = $1, completion_percentage = LEAST(100, completion_percentage + 10), updated_at = NOW(), notes = COALESCE($2, notes)
       WHERE id = $3`,
      [stepId, notes || null, onboardingId]
    );

    // Invalidate onboarding cache
    const cache = new CacheService(redis);
    await cache.delByPrefix(buildCacheKey(['onboarding']));

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}

export async function getTrialCustomers(req: Request, res: Response) {
  const db: Pool = req.app.get('pgPool');
  const redis = req.app.get('redis');
  try {
    const cache = new CacheService(redis, 300); // 5 minute cache for trial customers
    const cacheKey = buildCacheKey(['customers:trial']);
    
    const cached = await cache.getJson<any>(cacheKey);
    if (cached) {
      return res.json(cached);
    }

    const result = await db.query(
      `SELECT id, customer_number, first_name || ' ' || last_name as name, email, trial_start_date, trial_end_date
       FROM customers WHERE is_trial = true ORDER BY trial_end_date ASC`
    );
    const payload = { success: true, data: { customers: result.rows, total: result.rows.length } };
    await cache.setJson(cacheKey, payload, 300);
    res.json(payload);
  } catch (error: any) {
    res.status(500).json({ success: false, error: { message: error.message } });
  }
}
