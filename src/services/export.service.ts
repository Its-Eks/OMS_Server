import fs from 'fs/promises';
import path from 'path';
import { Pool } from 'pg';
import { AnalyticsService, KPIMetrics, AdvancedAnalytics } from './analytics.service.js';

export interface ExportOptions {
  format: 'csv' | 'pdf' | 'excel' | 'json';
  includeCharts?: boolean;
  includeRawData?: boolean;
  customFields?: string[];
  dateRange?: {
    start: string;
    end: string;
  };
}

export interface ExportResult {
  id: string;
  filename: string;
  url: string;
  size: number;
  format: string;
  expiresAt: string;
  status: 'generating' | 'completed' | 'failed';
  progress: number;
  error?: string;
}

export class ExportService {
  private db: Pool;
  private analyticsService: AnalyticsService;
  private exports: Map<string, ExportResult> = new Map();
  private exportDir: string;

  constructor(db: Pool, analyticsService: AnalyticsService) {
    this.db = db;
    this.analyticsService = analyticsService;
    this.exportDir = path.join(process.cwd(), 'exports');
    this.ensureExportDir();
  }

  private async ensureExportDir(): Promise<void> {
    try {
      await fs.access(this.exportDir);
    } catch {
      await fs.mkdir(this.exportDir, { recursive: true });
    }
  }

  async exportReport(
    reportType: string,
    filters?: any,
    options: ExportOptions = { format: 'csv' }
  ): Promise<ExportResult> {
    const exportId = this.generateExportId();
    const filename = this.generateFilename(reportType, options.format);
    
    const exportResult: ExportResult = {
      id: exportId,
      filename,
      url: `/api/analytics/exports/${filename}`,
      size: 0,
      format: options.format.toUpperCase(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      status: 'generating',
      progress: 0
    };

    this.exports.set(exportId, exportResult);

    // Start export generation in background
    this.generateReport(exportId, reportType, filters, options).catch(error => {
      const export_ = this.exports.get(exportId);
      if (export_) {
        export_.status = 'failed';
        export_.error = error.message;
        export_.progress = 100;
      }
    });

    return exportResult;
  }

  async getExportStatus(exportId: string): Promise<ExportResult | null> {
    return this.exports.get(exportId) || null;
  }

  async getExportFile(filename: string): Promise<Buffer | null> {
    try {
      const filePath = path.join(this.exportDir, filename);
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  private async generateReport(
    exportId: string,
    reportType: string,
    filters?: any,
    options: ExportOptions = { format: 'csv' }
  ): Promise<void> {
    const export_ = this.exports.get(exportId);
    if (!export_) return;

    try {
      export_.progress = 10;

      // Fetch data based on report type
      let data: any;
      switch (reportType) {
        case 'kpi-summary':
          data = await this.analyticsService.getKPIMetrics(filters);
          break;
        case 'order-analytics':
          data = await this.generateOrderAnalytics(filters);
          break;
        case 'customer-insights':
          data = await this.generateCustomerInsights(filters);
          break;
        case 'fno-performance':
          data = await this.generateFNOPerformance(filters);
          break;
        case 'escalation-analysis':
          data = await this.generateEscalationAnalysis(filters);
          break;
        case 'system-health':
          data = await this.generateSystemHealth(filters);
          break;
        default:
          throw new Error(`Unknown report type: ${reportType}`);
      }

      export_.progress = 50;

      // Generate file based on format
      let fileContent: Buffer;
      switch (options.format) {
        case 'csv':
          fileContent = await this.generateCSV(data, reportType);
          break;
        case 'json':
          fileContent = await this.generateJSON(data);
          break;
        case 'excel':
          fileContent = await this.generateExcel(data, reportType);
          break;
        case 'pdf':
          fileContent = await this.generatePDF(data, reportType);
          break;
        default:
          throw new Error(`Unsupported format: ${options.format}`);
      }

      export_.progress = 80;

      // Save file
      const filePath = path.join(this.exportDir, export_.filename);
      await fs.writeFile(filePath, fileContent);

      export_.progress = 100;
      export_.status = 'completed';
      export_.size = fileContent.length;

    } catch (error: any) {
      export_.status = 'failed';
      export_.error = error.message;
      export_.progress = 100;
    }
  }

  private async generateOrderAnalytics(filters?: any): Promise<any> {
    const client = await this.db.connect();
    try {
      const [
        orderStats,
        statusDistribution,
        serviceTypeStats,
        processingTimeStats,
        escalationStats
      ] = await Promise.all([
        client.query(`
          SELECT 
            COUNT(*) as total_orders,
            COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as orders_today,
            COUNT(CASE WHEN current_state = 'completed' THEN 1 END) as completed_orders,
            COUNT(CASE WHEN current_state NOT IN ('completed', 'cancelled') THEN 1 END) as active_orders,
            AVG(CASE 
              WHEN current_state = 'completed' 
              THEN EXTRACT(EPOCH FROM (updated_at - created_at))/3600 
            END) as avg_processing_time
          FROM orders
        `),
        client.query(`
          SELECT current_state, COUNT(*) as count
          FROM orders 
          GROUP BY current_state 
          ORDER BY count DESC
        `),
        client.query(`
          SELECT service_type, COUNT(*) as count,
                 AVG(CASE 
                   WHEN current_state = 'completed' 
                   THEN EXTRACT(EPOCH FROM (updated_at - created_at))/3600 
                 END) as avg_processing_time
          FROM orders 
          GROUP BY service_type 
          ORDER BY count DESC
        `),
        client.query(`
          SELECT 
            DATE_TRUNC('day', created_at) as date,
            COUNT(*) as orders,
            AVG(CASE 
              WHEN current_state = 'completed' 
              THEN EXTRACT(EPOCH FROM (updated_at - created_at))/3600 
            END) as avg_processing_time
          FROM orders 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE_TRUNC('day', created_at)
          ORDER BY date DESC
        `),
        client.query(`
          SELECT 
            escalation_level,
            COUNT(*) as count,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_time
          FROM escalations 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY escalation_level
          ORDER BY escalation_level
        `)
      ]);

      return {
        summary: orderStats.rows[0],
        statusDistribution: statusDistribution.rows,
        serviceTypeStats: serviceTypeStats.rows,
        processingTimeTrend: processingTimeStats.rows,
        escalationStats: escalationStats.rows
      };
    } finally {
      client.release();
    }
  }

  private async generateCustomerInsights(filters?: any): Promise<any> {
    const client = await this.db.connect();
    try {
      const [
        customerStats,
        satisfactionStats,
        trialStats,
        onboardingStats
      ] = await Promise.all([
        client.query(`
          SELECT 
            COUNT(*) as total_customers,
            COUNT(CASE WHEN is_trial = true THEN 1 END) as trial_customers,
            COUNT(CASE WHEN created_at >= CURRENT_DATE THEN 1 END) as new_customers_today,
            COUNT(CASE WHEN created_at >= NOW() - INTERVAL '30 days' THEN 1 END) as new_customers_month
          FROM customers
        `),
        client.query(`
          SELECT 
            satisfaction_score,
            COUNT(*) as count
          FROM customer_feedback 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY satisfaction_score
          ORDER BY satisfaction_score DESC
        `),
        client.query(`
          SELECT 
            COUNT(*) as total_trials,
            COUNT(CASE WHEN trial_end_date IS NOT NULL AND trial_end_date < NOW() THEN 1 END) as converted_trials,
            AVG(CASE 
              WHEN trial_end_date IS NOT NULL AND trial_end_date < NOW() 
              THEN EXTRACT(EPOCH FROM (trial_end_date - trial_start_date))/86400 
            END) as avg_conversion_time
          FROM customers 
          WHERE is_trial = true
        `),
        client.query(`
          SELECT 
            current_step,
            COUNT(*) as count,
            AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/86400) as avg_time
          FROM onboarding_instances 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY current_step
          ORDER BY avg_time DESC
        `)
      ]);

      return {
        customerSummary: customerStats.rows[0],
        satisfactionDistribution: satisfactionStats.rows,
        trialConversion: trialStats.rows[0],
        onboardingSteps: onboardingStats.rows
      };
    } finally {
      client.release();
    }
  }

  private async generateFNOPerformance(filters?: any): Promise<any> {
    const client = await this.db.connect();
    try {
      const [
        fnoStats,
        applicationStats,
        performanceStats
      ] = await Promise.all([
        client.query(`
          SELECT 
            f.name as fno_name,
            COUNT(o.id) as total_orders,
            COUNT(CASE WHEN o.current_state = 'completed' THEN 1 END) as completed_orders,
            AVG(CASE 
              WHEN o.current_state = 'completed' 
              THEN EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/3600 
            END) as avg_processing_time
          FROM orders o
          JOIN fnos f ON f.id = o.fno_id
          WHERE o.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY f.id, f.name
          ORDER BY total_orders DESC
        `),
        client.query(`
          SELECT 
            f.name as fno_name,
            f.integration_type,
            COUNT(a.id) as total_applications,
            COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_applications,
            AVG(CASE 
              WHEN a.status = 'completed' 
              THEN EXTRACT(EPOCH FROM (a.updated_at - a.created_at))/3600 
            END) as avg_processing_time
          FROM fno_applications a
          JOIN fnos f ON f.id = a.fno_id
          WHERE a.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY f.id, f.name, f.integration_type
          ORDER BY total_applications DESC
        `),
        client.query(`
          SELECT 
            f.name as fno_name,
            DATE_TRUNC('day', o.created_at) as date,
            COUNT(*) as orders,
            AVG(CASE 
              WHEN o.current_state = 'completed' 
              THEN EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/3600 
            END) as avg_processing_time
          FROM orders o
          JOIN fnos f ON f.id = o.fno_id
          WHERE o.created_at >= NOW() - INTERVAL '30 days'
          GROUP BY f.id, f.name, DATE_TRUNC('day', o.created_at)
          ORDER BY date DESC, f.name
        `)
      ]);

      return {
        fnoSummary: fnoStats.rows,
        applicationSummary: applicationStats.rows,
        performanceTrend: performanceStats.rows
      };
    } finally {
      client.release();
    }
  }

  private async generateEscalationAnalysis(filters?: any): Promise<any> {
    const client = await this.db.connect();
    try {
      const [
        escalationStats,
        resolutionStats,
        trendStats,
        reasonStats
      ] = await Promise.all([
        client.query(`
          SELECT 
            COUNT(*) as total_escalations,
            COUNT(CASE WHEN status = 'open' THEN 1 END) as open_escalations,
            COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved_escalations,
            AVG(CASE 
              WHEN status = 'resolved' 
              THEN EXTRACT(EPOCH FROM (resolved_at - created_at))/3600 
            END) as avg_resolution_time
          FROM escalations
          WHERE created_at >= NOW() - INTERVAL '30 days'
        `),
        client.query(`
          SELECT 
            escalation_level,
            COUNT(*) as count,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_time,
            MIN(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as min_resolution_time,
            MAX(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as max_resolution_time
          FROM escalations 
          WHERE status = 'resolved' 
          AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY escalation_level
          ORDER BY escalation_level
        `),
        client.query(`
          SELECT 
            DATE_TRUNC('day', created_at) as date,
            COUNT(*) as escalations,
            COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_time
          FROM escalations 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE_TRUNC('day', created_at)
          ORDER BY date DESC
        `),
        client.query(`
          SELECT 
            escalation_reason,
            COUNT(*) as count,
            AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))/3600) as avg_resolution_time
          FROM escalations 
          WHERE created_at >= NOW() - INTERVAL '30 days'
          GROUP BY escalation_reason
          ORDER BY count DESC
          LIMIT 10
        `)
      ]);

      return {
        summary: escalationStats.rows[0],
        resolutionByLevel: resolutionStats.rows,
        trend: trendStats.rows,
        topReasons: reasonStats.rows
      };
    } finally {
      client.release();
    }
  }

  private async generateSystemHealth(filters?: any): Promise<any> {
    // Mock system health data - would integrate with actual monitoring
    return {
      uptime: 99.95,
      responseTime: 245,
      errorRate: 0.2,
      activeConnections: 45,
      memoryUsage: 67.8,
      cpuUsage: 34.2,
      diskUsage: 45.6,
      incidents: [
        {
          timestamp: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          severity: 'warning',
          description: 'High memory usage detected',
          resolved: true
        }
      ]
    };
  }

  private async generateCSV(data: any, reportType: string): Promise<Buffer> {
    const csvRows: string[] = [];
    
    // Add header
    csvRows.push(`Report Type: ${reportType}`);
    csvRows.push(`Generated: ${new Date().toISOString()}`);
    csvRows.push('');

    // Convert data to CSV format
    if (Array.isArray(data)) {
      // Array data
      if (data.length > 0) {
        const headers = Object.keys(data[0]);
        csvRows.push(headers.join(','));
        
        for (const row of data) {
          const values = headers.map(header => {
            const value = row[header];
            return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
          });
          csvRows.push(values.join(','));
        }
      }
    } else {
      // Object data - flatten to key-value pairs
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          csvRows.push('');
          csvRows.push(`${key}:`);
          if (value.length > 0 && typeof value[0] === 'object') {
            const headers = Object.keys(value[0]);
            csvRows.push(headers.join(','));
            for (const item of value) {
              const values = headers.map(header => {
                const val = item[header];
                return typeof val === 'string' && val.includes(',') ? `"${val}"` : val;
              });
              csvRows.push(values.join(','));
            }
          } else {
            csvRows.push(value.join(','));
          }
        } else if (typeof value === 'object' && value !== null) {
          csvRows.push(`${key}:`);
          for (const [subKey, subValue] of Object.entries(value)) {
            csvRows.push(`${subKey},${subValue}`);
          }
        } else {
          csvRows.push(`${key},${value}`);
        }
      }
    }

    return Buffer.from(csvRows.join('\n'), 'utf-8');
  }

  private async generateJSON(data: any): Promise<Buffer> {
    const jsonData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        version: '1.0'
      },
      data
    };

    return Buffer.from(JSON.stringify(jsonData, null, 2), 'utf-8');
  }

  private async generateExcel(data: any, reportType: string): Promise<Buffer> {
    // For now, return CSV format - would integrate with Excel library like 'xlsx'
    return this.generateCSV(data, reportType);
  }

  private async generatePDF(data: any, reportType: string): Promise<Buffer> {
    // For now, return JSON format - would integrate with PDF library like 'puppeteer'
    return this.generateJSON(data);
  }

  private generateExportId(): string {
    return `export_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateFilename(reportType: string, format: string): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `${reportType}_${timestamp}.${format}`;
  }

  // Cleanup expired exports
  async cleanupExpiredExports(): Promise<void> {
    const now = new Date();
    for (const [id, export_] of this.exports.entries()) {
      if (new Date(export_.expiresAt) < now) {
        try {
          const filePath = path.join(this.exportDir, export_.filename);
          await fs.unlink(filePath);
        } catch {
          // File might not exist, ignore error
        }
        this.exports.delete(id);
      }
    }
  }
}
