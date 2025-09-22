import type { Pool } from 'pg';
import type { Redis } from 'ioredis';
import { CacheService, buildCacheKey } from './cache.service.ts';

export class CacheWarmingService {
  private db: Pool;
  private cache: CacheService;

  constructor(db: Pool, redis: Redis) {
    this.db = db;
    this.cache = new CacheService(redis);
  }

  async warmCriticalCaches(): Promise<void> {
    console.log('🔥 Starting cache warming...');
    
    try {
      await Promise.all([
        this.warmUserStats(),
        this.warmRolesList(),
        this.warmTrialCustomers(),
        this.warmSystemHealth()
      ]);
      
      console.log('✅ Cache warming completed successfully');
    } catch (error) {
      console.error('❌ Cache warming failed:', error);
    }
  }

  private async warmUserStats(): Promise<void> {
    try {
      const totalRes = await this.db.query('SELECT COUNT(*)::int AS count FROM users');
      const activeRes = await this.db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true');
      const inactiveRes = await this.db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = false');
      const adminRes = await this.db.query(`
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

      await this.cache.setJson(buildCacheKey(['stats:users']), payload, 180);
      console.log('📊 User stats cached');
    } catch (error) {
      console.error('Failed to warm user stats:', error);
    }
  }

  private async warmRolesList(): Promise<void> {
    try {
      const result = await this.db.query('SELECT id, name, description, permissions FROM roles ORDER BY name');
      const payload = { success: true, roles: result.rows };
      await this.cache.setJson(buildCacheKey(['roles:list']), payload, 600);
      console.log('🎭 Roles list cached');
    } catch (error) {
      console.error('Failed to warm roles list:', error);
    }
  }

  private async warmTrialCustomers(): Promise<void> {
    try {
      const result = await this.db.query(`
        SELECT id, customer_number, first_name || ' ' || last_name as name, email, trial_start_date, trial_end_date
        FROM customers WHERE is_trial = true ORDER BY trial_end_date ASC
      `);
      const payload = { success: true, data: { customers: result.rows, total: result.rows.length } };
      await this.cache.setJson(buildCacheKey(['customers:trial']), payload, 300);
      console.log('👥 Trial customers cached');
    } catch (error) {
      console.error('Failed to warm trial customers:', error);
    }
  }

  private async warmSystemHealth(): Promise<void> {
    try {
      // Cache basic system health data
      const dbHealth = await this.db.query('SELECT NOW() as timestamp');
      const payload = {
        success: true,
        data: {
          database: 'healthy',
          timestamp: dbHealth.rows[0].timestamp,
          uptime: process.uptime()
        }
      };
      await this.cache.setJson(buildCacheKey(['system:health']), payload, 60);
      console.log('💚 System health cached');
    } catch (error) {
      console.error('Failed to warm system health:', error);
    }
  }

  async warmUserSpecificCaches(userId: string): Promise<void> {
    try {
      // Cache user's escalations
      const escalationsRes = await this.db.query(
        `SELECT * FROM escalations WHERE escalated_to = $1 AND status <> 'resolved' ORDER BY created_at DESC`,
        [userId]
      );
      const escalationsPayload = { 
        success: true, 
        data: { escalations: escalationsRes.rows, total: escalationsRes.rows.length } 
      };
      await this.cache.setJson(buildCacheKey(['escalations:my', userId]), escalationsPayload, 60);
      
      console.log(`👤 User-specific caches warmed for user ${userId}`);
    } catch (error) {
      console.error('Failed to warm user-specific caches:', error);
    }
  }
}
