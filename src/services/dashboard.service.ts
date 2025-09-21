import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';
import { CacheService, buildCacheKey } from './cache.service.ts';

export interface DashboardSummary {
  totalOrders: number;
  activeOrders: number;
  escalations: number;
  trialCustomers: number;
  ordersToday: number;
}

export interface RecentOrder {
  id: string;
  orderNumber: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  customerName: string;
  serviceType: string;
  status: string;
  createdAt: string;
}

export interface PendingEscalation {
  id: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  issue: string;
  aging: string;
  level: string;
  createdAt: string;
}

export interface DashboardData {
  summary: DashboardSummary;
  recentOrders: RecentOrder[];
  pendingEscalations: PendingEscalation[];
}

export class DashboardService {
  private db: Pool;
  private mongo: MongoClient | null;
  private redis: any;

  constructor(db: Pool, mongo: MongoClient | null, redis: any) {
    this.db = db;
    this.mongo = mongo;
    this.redis = redis;
  }

  async getDashboardData(userId?: string): Promise<DashboardData> {
    const cache = new CacheService(this.redis, 60); // 1 minute cache
    const cacheKey = buildCacheKey(['dashboard:data', userId || 'anonymous']);
    
    const cached = await cache.getJson<DashboardData>(cacheKey);
    if (cached) {
      return cached;
    }

    const [summary, recentOrders, pendingEscalations] = await Promise.all([
      this.getSummaryStats(),
      this.getRecentOrders(),
      this.getPendingEscalations()
    ]);

    const data: DashboardData = {
      summary,
      recentOrders,
      pendingEscalations
    };

    await cache.setJson(cacheKey, data, 60);
    return data;
  }

  private async getSummaryStats(): Promise<DashboardSummary> {
    const today = new Date().toISOString().split('T')[0];
    
    const [
      totalOrdersResult,
      activeOrdersResult,
      escalationsResult,
      trialCustomersResult,
      ordersTodayResult
    ] = await Promise.all([
      this.db.query('SELECT COUNT(*)::int AS count FROM orders'),
      this.db.query(`
        SELECT COUNT(*)::int AS count 
        FROM orders 
        WHERE current_state IN ('created', 'validated', 'enriched', 'fno_submitted', 'fno_accepted', 'installation_scheduled', 'in_progress')
      `),
      this.db.query(`
        SELECT COUNT(*)::int AS count 
        FROM escalations 
        WHERE status = 'open'
      `),
      this.db.query(`
        SELECT COUNT(*)::int AS count 
        FROM customers 
        WHERE is_trial = true
      `),
      this.db.query(`
        SELECT COUNT(*)::int AS count 
        FROM orders 
        WHERE DATE(created_at) = $1
      `, [today])
    ]);

    return {
      totalOrders: totalOrdersResult.rows[0].count,
      activeOrders: activeOrdersResult.rows[0].count,
      escalations: escalationsResult.rows[0].count,
      trialCustomers: trialCustomersResult.rows[0].count,
      ordersToday: ordersTodayResult.rows[0].count
    };
  }

  private async getRecentOrders(): Promise<RecentOrder[]> {
    const result = await this.db.query(`
      SELECT 
        o.id,
        o.order_number,
        o.priority,
        o.current_state as status,
        o.created_at,
        CONCAT(c.first_name, ' ', c.last_name) as customer_name,
        o.service_type
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      ORDER BY o.created_at DESC
      LIMIT 5
    `);

    return result.rows.map(row => ({
      id: row.id,
      orderNumber: row.order_number,
      priority: row.priority || 'normal',
      customerName: row.customer_name || 'Unknown Customer',
      serviceType: row.service_type || 'Unknown',
      status: row.status,
      createdAt: row.created_at
    }));
  }

  private async getPendingEscalations(): Promise<PendingEscalation[]> {
    const result = await this.db.query(`
      SELECT 
        e.id,
        e.order_id,
        o.order_number,
        e.escalation_reason as issue,
        e.escalation_level as level,
        e.created_at,
        CONCAT(c.first_name, ' ', c.last_name) as customer_name,
        EXTRACT(EPOCH FROM (NOW() - e.created_at))/3600 as aging_hours
      FROM escalations e
      LEFT JOIN orders o ON o.id = e.order_id
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE e.status = 'open'
      ORDER BY e.created_at ASC
      LIMIT 10
    `);

    return result.rows.map(row => ({
      id: row.id,
      orderId: row.order_id,
      orderNumber: row.order_number,
      customerName: row.customer_name || 'Unknown Customer',
      issue: row.issue,
      aging: this.formatAging(row.aging_hours),
      level: `Level ${row.level || 1}`,
      createdAt: row.created_at
    }));
  }

  private formatAging(hours: number): string {
    if (hours < 1) {
      return `${Math.round(hours * 60)} minutes`;
    } else if (hours < 24) {
      return `${Math.round(hours)} hours`;
    } else {
      const days = Math.floor(hours / 24);
      const remainingHours = Math.round(hours % 24);
      return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
    }
  }
}
