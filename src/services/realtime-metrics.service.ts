import { EventEmitter } from 'events';
import type { Pool } from 'pg';

export interface RealtimeMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  timestamp: string;
  status: 'normal' | 'warning' | 'critical';
  threshold?: {
    warning: number;
    critical: number;
  };
}

export interface MetricAlert {
  id: string;
  metricId: string;
  metricName: string;
  severity: 'warning' | 'critical';
  message: string;
  value: number;
  threshold: number;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'critical';
  uptime: number;
  responseTime: number;
  errorRate: number;
  activeConnections: number;
  memoryUsage: number;
  cpuUsage: number;
  diskUsage: number;
  lastUpdated: string;
}

export class RealtimeMetricsService extends EventEmitter {
  private db: Pool;
  private metrics: Map<string, RealtimeMetric> = new Map();
  private alerts: Map<string, MetricAlert> = new Map();
  private health: SystemHealth;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(db: Pool) {
    super();
    this.db = db;
    this.health = {
      status: 'healthy',
      uptime: 0,
      responseTime: 0,
      errorRate: 0,
      activeConnections: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      diskUsage: 0,
      lastUpdated: new Date().toISOString()
    };
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.intervalId = setInterval(() => {
      this.updateMetrics();
    }, 5000); // Update every 5 seconds

    console.log('🔄 Realtime metrics service started');
  }

  stop(): void {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    console.log('⏹️ Realtime metrics service stopped');
  }

  getMetrics(): RealtimeMetric[] {
    return Array.from(this.metrics.values());
  }

  getAlerts(): MetricAlert[] {
    return Array.from(this.alerts.values());
  }

  getSystemHealth(): SystemHealth {
    return this.health;
  }

  acknowledgeAlert(alertId: string, acknowledgedBy: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    alert.acknowledgedBy = acknowledgedBy;
    alert.acknowledgedAt = new Date().toISOString();

    this.emit('alertAcknowledged', alert);
    return true;
  }

  private async updateMetrics(): Promise<void> {
    try {
      await Promise.all([
        this.updateOrderMetrics(),
        this.updateSystemMetrics(),
        this.updatePerformanceMetrics(),
        this.updateUserMetrics()
      ]);

      this.updateSystemHealth();
      this.emit('metricsUpdated', this.getMetrics());
    } catch (error) {
      console.error('Error updating metrics:', error);
    }
  }

  private async updateOrderMetrics(): Promise<void> {
    try {
      const [ordersToday, activeOrders, escalations, avgProcessingTime] = await Promise.all([
        this.db.query('SELECT COUNT(*)::int AS count FROM orders WHERE DATE(created_at) = CURRENT_DATE'),
        this.db.query(`
          SELECT COUNT(*)::int AS count 
          FROM orders 
          WHERE current_state NOT IN ('completed', 'cancelled')
        `),
        this.db.query('SELECT COUNT(*)::int AS count FROM escalations WHERE status = \'open\''),
        this.db.query(`
          SELECT AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) AS avg_time
          FROM orders 
          WHERE current_state = 'completed' 
          AND updated_at >= NOW() - INTERVAL '24 hours'
        `)
      ]);

      // Orders Today
      this.updateMetric('orders_today', {
        id: 'orders_today',
        name: 'Orders Created Today',
        value: ordersToday.rows[0].count,
        unit: 'orders',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 50, critical: 100 }
      });

      // Active Orders
      this.updateMetric('active_orders', {
        id: 'active_orders',
        name: 'Active Orders',
        value: activeOrders.rows[0].count,
        unit: 'orders',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 200, critical: 500 }
      });

      // Open Escalations
      this.updateMetric('open_escalations', {
        id: 'open_escalations',
        name: 'Open Escalations',
        value: escalations.rows[0].count,
        unit: 'escalations',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 10, critical: 25 }
      });

      // Average Processing Time
      this.updateMetric('avg_processing_time', {
        id: 'avg_processing_time',
        name: 'Avg Processing Time (24h)',
        value: Math.round((avgProcessingTime.rows[0].avg_time || 0) * 100) / 100,
        unit: 'hours',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 48, critical: 72 }
      });

    } catch (error) {
      console.error('Error updating order metrics:', error);
    }
  }

  private async updateSystemMetrics(): Promise<void> {
    try {
      const [dbConnections, dbResponseTime] = await Promise.all([
        this.db.query('SELECT count(*)::int AS count FROM pg_stat_activity WHERE state = \'active\''),
        this.measureDbResponseTime()
      ]);

      // Database Connections
      this.updateMetric('db_connections', {
        id: 'db_connections',
        name: 'Active DB Connections',
        value: dbConnections.rows[0].count,
        unit: 'connections',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 80, critical: 95 }
      });

      // Database Response Time
      this.updateMetric('db_response_time', {
        id: 'db_response_time',
        name: 'DB Response Time',
        value: dbResponseTime,
        unit: 'ms',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 100, critical: 500 }
      });

      // System Memory Usage (mock - would use actual system metrics)
      const memoryUsage = this.getMockMemoryUsage();
      this.updateMetric('memory_usage', {
        id: 'memory_usage',
        name: 'Memory Usage',
        value: memoryUsage,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: memoryUsage > 90 ? 'critical' : memoryUsage > 80 ? 'warning' : 'normal',
        threshold: { warning: 80, critical: 90 }
      });

      // CPU Usage (mock - would use actual system metrics)
      const cpuUsage = this.getMockCpuUsage();
      this.updateMetric('cpu_usage', {
        id: 'cpu_usage',
        name: 'CPU Usage',
        value: cpuUsage,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: cpuUsage > 90 ? 'critical' : cpuUsage > 80 ? 'warning' : 'normal',
        threshold: { warning: 80, critical: 90 }
      });

    } catch (error) {
      console.error('Error updating system metrics:', error);
    }
  }

  private async updatePerformanceMetrics(): Promise<void> {
    try {
      const [errorRate, throughput] = await Promise.all([
        this.calculateErrorRate(),
        this.calculateThroughput()
      ]);

      // Error Rate
      this.updateMetric('error_rate', {
        id: 'error_rate',
        name: 'Error Rate (24h)',
        value: Math.round(errorRate * 10000) / 100,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: errorRate > 0.05 ? 'critical' : errorRate > 0.01 ? 'warning' : 'normal',
        threshold: { warning: 1, critical: 5 }
      });

      // Throughput
      this.updateMetric('throughput', {
        id: 'throughput',
        name: 'Orders/Hour (24h)',
        value: Math.round(throughput * 100) / 100,
        unit: 'orders/hour',
        timestamp: new Date().toISOString(),
        status: 'normal'
      });

    } catch (error) {
      console.error('Error updating performance metrics:', error);
    }
  }

  private async updateUserMetrics(): Promise<void> {
    try {
      // Compute active users (best-effort). Some schemas may not have last_login; try fallbacks.
      let activeUsersCount = 0;
      try {
        const res = await this.db.query("SELECT COUNT(*)::int AS count FROM users WHERE last_login >= NOW() - INTERVAL '1 hour'");
        activeUsersCount = res.rows[0]?.count ?? 0;
      } catch {}
      if (activeUsersCount === 0) {
        try {
          const res = await this.db.query("SELECT COUNT(*)::int AS count FROM users WHERE updated_at >= NOW() - INTERVAL '1 hour'");
          activeUsersCount = res.rows[0]?.count ?? 0;
        } catch {}
      }

      // Total users - fallback to COUNT(*) if is_active column not present
      let totalUsersCount = 0;
      try {
        const res = await this.db.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true');
        totalUsersCount = res.rows[0]?.count ?? 0;
      } catch {
        try {
          const res = await this.db.query('SELECT COUNT(*)::int AS count FROM users');
          totalUsersCount = res.rows[0]?.count ?? 0;
        } catch {}
      }

      this.updateMetric('active_users', {
        id: 'active_users',
        name: 'Active Users (1h)',
        value: activeUsersCount,
        unit: 'users',
        timestamp: new Date().toISOString(),
        status: 'normal'
      });

      const adoptionRate = totalUsersCount > 0 ? (activeUsersCount / totalUsersCount) * 100 : 0;
      this.updateMetric('user_adoption', {
        id: 'user_adoption',
        name: 'User Adoption Rate',
        value: Math.round(adoptionRate * 100) / 100,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: adoptionRate < 10 ? 'critical' : adoptionRate < 20 ? 'warning' : 'normal',
        threshold: { warning: 20, critical: 10 }
      });

    } catch (error) {
      // Swallow errors to avoid noisy logs if schema differs; metrics will default via previous values
    }
  }

  private updateMetric(id: string, metric: RealtimeMetric): void {
    const previousMetric = this.metrics.get(id);
    this.metrics.set(id, metric);

    // Check for threshold breaches and generate alerts
    if (metric.threshold) {
      const severity = metric.value >= metric.threshold.critical ? 'critical' : 
                     metric.value >= metric.threshold.warning ? 'warning' : null;

      if (severity && (!previousMetric || previousMetric.status !== severity)) {
        this.createAlert(id, metric, severity);
      }
    }

    // Emit metric update event
    this.emit('metricUpdated', metric);
  }

  private createAlert(metricId: string, metric: RealtimeMetric, severity: 'warning' | 'critical'): void {
    const alertId = `${metricId}_${Date.now()}`;
    const threshold = severity === 'critical' ? metric.threshold!.critical : metric.threshold!.warning;
    
    const alert: MetricAlert = {
      id: alertId,
      metricId,
      metricName: metric.name,
      severity,
      message: `${metric.name} has exceeded ${severity} threshold (${metric.value} ${metric.unit} > ${threshold} ${metric.unit})`,
      value: metric.value,
      threshold,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };

    this.alerts.set(alertId, alert);
    this.emit('alertCreated', alert);
  }

  private updateSystemHealth(): void {
    const metrics = this.getMetrics();
    const criticalMetrics = metrics.filter(m => m.status === 'critical');
    const warningMetrics = metrics.filter(m => m.status === 'warning');

    let status: 'healthy' | 'degraded' | 'critical' = 'healthy';
    if (criticalMetrics.length > 0) {
      status = 'critical';
    } else if (warningMetrics.length > 0) {
      status = 'degraded';
    }

    this.health = {
      ...this.health,
      status,
      lastUpdated: new Date().toISOString()
    };

    this.emit('healthUpdated', this.health);
  }

  private async measureDbResponseTime(): Promise<number> {
    const start = Date.now();
    try {
      await this.db.query('SELECT 1');
      return Date.now() - start;
    } catch (error) {
      return 9999; // Return high value for errors
    }
  }

  private async calculateErrorRate(): Promise<number> {
    try {
      const result = await this.db.query(`
        SELECT 
          COUNT(*)::int as total_requests,
          COUNT(CASE WHEN status_code >= 400 THEN 1 END)::int as errors
        FROM request_logs 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `);
      
      const total = result.rows[0].total_requests;
      const errors = result.rows[0].errors;
      
      return total > 0 ? errors / total : 0;
    } catch (error) {
      // If request_logs table doesn't exist, return mock value
      return 0.002; // 0.2% error rate
    }
  }

  private async calculateThroughput(): Promise<number> {
    try {
      const result = await this.db.query(`
        SELECT COUNT(*)::int as orders
        FROM orders 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `);
      
      return result.rows[0].orders / 24; // orders per hour
    } catch (error) {
      return 2.5; // Mock throughput
    }
  }

  private getMockMemoryUsage(): number {
    // Mock memory usage with some variation
    return Math.min(100, Math.max(20, 60 + Math.sin(Date.now() / 10000) * 20));
  }

  private getMockCpuUsage(): number {
    // Mock CPU usage with some variation
    return Math.min(100, Math.max(10, 40 + Math.sin(Date.now() / 8000) * 30));
  }
}
