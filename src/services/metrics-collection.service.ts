import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from './cache.service.ts';

export interface MetricDataPoint {
  metric_name: string;
  metric_value: number;
  metric_unit?: string;
  metadata?: Record<string, any>;
}

export interface AggregatedMetric {
  metric_name: string;
  period: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
  start_time: Date;
  end_time: Date;
  avg_value: number;
  min_value: number;
  max_value: number;
  sum_value: number;
  count_value: number;
  metadata?: Record<string, any>;
}

export interface DailySnapshot {
  snapshot_date: Date;
  total_orders: number;
  completed_orders: number;
  cancelled_orders: number;
  avg_processing_time_hours: number;
  escalation_count: number;
  resolved_escalations: number;
  user_adoption_rate: number;
  system_uptime_percentage: number;
  customer_satisfaction_score: number;
  fno_tracking_accuracy: number;
  total_revenue: number;
  metadata?: Record<string, any>;
}

export class MetricsCollectionService {
  private db: Pool;
  private redis: any;

  constructor(db: Pool, redis: any) {
    this.db = db;
    this.redis = redis;
  }

  /**
   * Collect and store current system metrics
   */
  async collectCurrentMetrics(): Promise<void> {
    const client = await this.db.connect();
    try {
      const metrics = await this.gatherSystemMetrics(client);
      
      // Store raw metrics
      for (const metric of metrics) {
        await this.storeMetric(metric);
      }

      // Update daily snapshot
      await this.updateDailySnapshot(client);
      
      console.log(`[MetricsCollection] Collected ${metrics.length} metrics at ${new Date().toISOString()}`);
    } finally {
      client.release();
    }
  }

  /**
   * Aggregate metrics for different time periods
   */
  async aggregateMetrics(period: 'hour' | 'day' | 'week' | 'month'): Promise<void> {
    const client = await this.db.connect();
    try {
      const endTime = new Date();
      const startTime = this.getPeriodStartTime(endTime, period);
      
      // Get all unique metric names
      const metricNames = await this.getMetricNames(client, startTime, endTime);
      
      for (const metricName of metricNames) {
        const aggregated = await this.calculateAggregates(client, metricName, startTime, endTime, period);
        if (aggregated) {
          await this.storeAggregatedMetric(aggregated);
        }
      }
      
      console.log(`[MetricsCollection] Aggregated metrics for ${period} period`);
    } finally {
      client.release();
    }
  }

  /**
   * Get historical metrics for a specific time range
   */
  async getHistoricalMetrics(
    metricName: string,
    startTime: Date,
    endTime: Date,
    granularity: 'raw' | 'hour' | 'day' | 'week' | 'month' = 'day'
  ): Promise<any[]> {
    const client = await this.db.connect();
    try {
      if (granularity === 'raw') {
        return await this.getRawMetrics(client, metricName, startTime, endTime);
      } else {
        return await this.getAggregatedMetrics(client, metricName, startTime, endTime, granularity);
      }
    } finally {
      client.release();
    }
  }

  /**
   * Clean up old metrics data based on retention policy
   */
  async cleanupOldMetrics(): Promise<void> {
    const client = await this.db.connect();
    try {
      // Keep raw metrics for 30 days
      const rawMetricsCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      await client.query('DELETE FROM analytics_metrics WHERE timestamp < $1', [rawMetricsCutoff]);
      
      // Keep hourly aggregates for 90 days
      const hourlyCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      await client.query('DELETE FROM analytics_aggregates WHERE period = $1 AND start_time < $2', ['hour', hourlyCutoff]);
      
      // Keep daily snapshots for 2 years
      const dailyCutoff = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
      await client.query('DELETE FROM daily_metrics_snapshot WHERE snapshot_date < $1', [dailyCutoff]);
      
      console.log('[MetricsCollection] Cleaned up old metrics data');
    } finally {
      client.release();
    }
  }

  // Private helper methods

  private async gatherSystemMetrics(client: any): Promise<MetricDataPoint[]> {
    const metrics: MetricDataPoint[] = [];
    const now = new Date();

    // System performance metrics
    const [ordersResult, escalationsResult, usersResult, systemResult] = await Promise.all([
      client.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN current_state = 'completed' THEN 1 END) as completed_orders,
          COUNT(CASE WHEN current_state = 'cancelled' THEN 1 END) as cancelled_orders,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_processing_time
        FROM orders 
        WHERE created_at >= $1
      `, [new Date(now.getTime() - 24 * 60 * 60 * 1000)]),
      
      client.query(`
        SELECT 
          COUNT(*) as total_escalations,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_escalations
        FROM escalations 
        WHERE created_at >= $1
      `, [new Date(now.getTime() - 24 * 60 * 60 * 1000)]),
      
      client.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN updated_at >= NOW() - INTERVAL '7 days' THEN 1 END) as active_users
        FROM users 
        WHERE is_active = true
      `),
      
      client.query(`
        SELECT 
          COUNT(*) as active_orders,
          COUNT(CASE WHEN current_state = 'in_progress' THEN 1 END) as in_progress_orders
        FROM orders 
        WHERE current_state NOT IN ('completed', 'cancelled')
      `)
    ]);

    // Add metrics
    metrics.push(
      { metric_name: 'total_orders_24h', metric_value: parseInt(ordersResult.rows[0].total_orders), metric_unit: 'count' },
      { metric_name: 'completed_orders_24h', metric_value: parseInt(ordersResult.rows[0].completed_orders), metric_unit: 'count' },
      { metric_name: 'cancelled_orders_24h', metric_value: parseInt(ordersResult.rows[0].cancelled_orders), metric_unit: 'count' },
      { metric_name: 'avg_processing_time_24h', metric_value: parseFloat(ordersResult.rows[0].avg_processing_time || 0), metric_unit: 'hours' },
      { metric_name: 'total_escalations_24h', metric_value: parseInt(escalationsResult.rows[0].total_escalations), metric_unit: 'count' },
      { metric_name: 'resolved_escalations_24h', metric_value: parseInt(escalationsResult.rows[0].resolved_escalations), metric_unit: 'count' },
      { metric_name: 'total_users', metric_value: parseInt(usersResult.rows[0].total_users), metric_unit: 'count' },
      { metric_name: 'active_users_7d', metric_value: parseInt(usersResult.rows[0].active_users), metric_unit: 'count' },
      { metric_name: 'active_orders', metric_value: parseInt(systemResult.rows[0].active_orders), metric_unit: 'count' },
      { metric_name: 'in_progress_orders', metric_value: parseInt(systemResult.rows[0].in_progress_orders), metric_unit: 'count' }
    );

    // Calculate derived metrics
    const totalUsers = parseInt(usersResult.rows[0].total_users);
    const activeUsers = parseInt(usersResult.rows[0].active_users);
    const userAdoptionRate = totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0;
    
    const totalEscalations = parseInt(escalationsResult.rows[0].total_escalations);
    const resolvedEscalations = parseInt(escalationsResult.rows[0].resolved_escalations);
    const escalationResolutionRate = totalEscalations > 0 ? (resolvedEscalations / totalEscalations) * 100 : 0;

    metrics.push(
      { metric_name: 'user_adoption_rate', metric_value: userAdoptionRate, metric_unit: 'percentage' },
      { metric_name: 'escalation_resolution_rate', metric_value: escalationResolutionRate, metric_unit: 'percentage' }
    );

    return metrics;
  }

  private async storeMetric(metric: MetricDataPoint): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query(`
        INSERT INTO analytics_metrics (metric_name, metric_value, metric_unit, metadata)
        VALUES ($1, $2, $3, $4)
      `, [metric.metric_name, metric.metric_value, metric.metric_unit, JSON.stringify(metric.metadata || {})]);
    } finally {
      client.release();
    }
  }

  private async updateDailySnapshot(client: any): Promise<void> {
    const today = new Date().toISOString().split('T')[0];
    
    const [ordersResult, escalationsResult, usersResult] = await Promise.all([
      client.query(`
        SELECT 
          COUNT(*) as total_orders,
          COUNT(CASE WHEN current_state = 'completed' THEN 1 END) as completed_orders,
          COUNT(CASE WHEN current_state = 'cancelled' THEN 1 END) as cancelled_orders,
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_processing_time
        FROM orders 
        WHERE DATE(created_at) = $1
      `, [today]),
      
      client.query(`
        SELECT 
          COUNT(*) as total_escalations,
          COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_escalations
        FROM escalations 
        WHERE DATE(created_at) = $1
      `, [today]),
      
      client.query(`
        SELECT 
          COUNT(*) as total_users,
          COUNT(CASE WHEN updated_at >= NOW() - INTERVAL '7 days' THEN 1 END) as active_users
        FROM users 
        WHERE is_active = true
      `)
    ]);

    const totalUsers = parseInt(usersResult.rows[0].total_users);
    const activeUsers = parseInt(usersResult.rows[0].active_users);
    const userAdoptionRate = totalUsers > 0 ? (activeUsers / totalUsers) * 100 : 0;

    await client.query(`
      INSERT INTO daily_metrics_snapshot (
        snapshot_date, total_orders, completed_orders, cancelled_orders,
        avg_processing_time_hours, escalation_count, resolved_escalations,
        user_adoption_rate, system_uptime_percentage, customer_satisfaction_score,
        fno_tracking_accuracy, total_revenue
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (snapshot_date) DO UPDATE SET
        total_orders = EXCLUDED.total_orders,
        completed_orders = EXCLUDED.completed_orders,
        cancelled_orders = EXCLUDED.cancelled_orders,
        avg_processing_time_hours = EXCLUDED.avg_processing_time_hours,
        escalation_count = EXCLUDED.escalation_count,
        resolved_escalations = EXCLUDED.resolved_escalations,
        user_adoption_rate = EXCLUDED.user_adoption_rate,
        system_uptime_percentage = EXCLUDED.system_uptime_percentage,
        customer_satisfaction_score = EXCLUDED.customer_satisfaction_score,
        fno_tracking_accuracy = EXCLUDED.fno_tracking_accuracy,
        total_revenue = EXCLUDED.total_revenue
    `, [
      today,
      parseInt(ordersResult.rows[0].total_orders),
      parseInt(ordersResult.rows[0].completed_orders),
      parseInt(ordersResult.rows[0].cancelled_orders),
      parseFloat(ordersResult.rows[0].avg_processing_time || 0),
      parseInt(escalationsResult.rows[0].total_escalations),
      parseInt(escalationsResult.rows[0].resolved_escalations),
      userAdoptionRate,
      99.95, // Mock system uptime
      4.3,   // Mock customer satisfaction
      100.0, // Mock FNO tracking accuracy
      0.0    // Mock revenue
    ]);
  }

  private async getMetricNames(client: any, startTime: Date, endTime: Date): Promise<string[]> {
    const result = await client.query(`
      SELECT DISTINCT metric_name 
      FROM analytics_metrics 
      WHERE timestamp >= $1 AND timestamp <= $2
    `, [startTime, endTime]);
    
    return result.rows.map(row => row.metric_name);
  }

  private async calculateAggregates(
    client: any, 
    metricName: string, 
    startTime: Date, 
    endTime: Date, 
    period: string
  ): Promise<AggregatedMetric | null> {
    const result = await client.query(`
      SELECT 
        AVG(metric_value) as avg_value,
        MIN(metric_value) as min_value,
        MAX(metric_value) as max_value,
        SUM(metric_value) as sum_value,
        COUNT(*) as count_value
      FROM analytics_metrics 
      WHERE metric_name = $1 AND timestamp >= $2 AND timestamp <= $3
    `, [metricName, startTime, endTime]);

    if (result.rows[0].count_value === '0') return null;

    return {
      metric_name: metricName,
      period: period as any,
      start_time: startTime,
      end_time: endTime,
      avg_value: parseFloat(result.rows[0].avg_value),
      min_value: parseFloat(result.rows[0].min_value),
      max_value: parseFloat(result.rows[0].max_value),
      sum_value: parseFloat(result.rows[0].sum_value),
      count_value: parseInt(result.rows[0].count_value)
    };
  }

  private async storeAggregatedMetric(aggregated: AggregatedMetric): Promise<void> {
    const client = await this.db.connect();
    try {
      await client.query(`
        INSERT INTO analytics_aggregates (
          metric_name, period, start_time, end_time,
          avg_value, min_value, max_value, sum_value, count_value, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (metric_name, period, start_time) DO UPDATE SET
          avg_value = EXCLUDED.avg_value,
          min_value = EXCLUDED.min_value,
          max_value = EXCLUDED.max_value,
          sum_value = EXCLUDED.sum_value,
          count_value = EXCLUDED.count_value,
          updated_at = CURRENT_TIMESTAMP
      `, [
        aggregated.metric_name,
        aggregated.period,
        aggregated.start_time,
        aggregated.end_time,
        aggregated.avg_value,
        aggregated.min_value,
        aggregated.max_value,
        aggregated.sum_value,
        aggregated.count_value,
        JSON.stringify(aggregated.metadata || {})
      ]);
    } finally {
      client.release();
    }
  }

  private async getRawMetrics(client: any, metricName: string, startTime: Date, endTime: Date): Promise<any[]> {
    const result = await client.query(`
      SELECT metric_name, metric_value, metric_unit, timestamp, metadata
      FROM analytics_metrics 
      WHERE metric_name = $1 AND timestamp >= $2 AND timestamp <= $3
      ORDER BY timestamp ASC
    `, [metricName, startTime, endTime]);
    
    return result.rows;
  }

  private async getAggregatedMetrics(client: any, metricName: string, startTime: Date, endTime: Date, granularity: string): Promise<any[]> {
    const result = await client.query(`
      SELECT metric_name, period, start_time, end_time,
             avg_value, min_value, max_value, sum_value, count_value, metadata
      FROM analytics_aggregates 
      WHERE metric_name = $1 AND period = $2 AND start_time >= $3 AND end_time <= $4
      ORDER BY start_time ASC
    `, [metricName, granularity, startTime, endTime]);
    
    return result.rows;
  }

  private getPeriodStartTime(endTime: Date, period: string): Date {
    const startTime = new Date(endTime);
    
    switch (period) {
      case 'hour':
        startTime.setHours(startTime.getHours() - 1);
        break;
      case 'day':
        startTime.setDate(startTime.getDate() - 1);
        break;
      case 'week':
        startTime.setDate(startTime.getDate() - 7);
        break;
      case 'month':
        startTime.setMonth(startTime.getMonth() - 1);
        break;
      default:
        startTime.setDate(startTime.getDate() - 1);
    }
    
    return startTime;
  }
}
