import type { Request, Response } from 'express';
import { AnalyticsService } from '../services/analytics.service.ts';
import { ReportExportService, type ReportFilters, type ExportOptions } from '../services/report-export.service.ts';

export class AnalyticsController {
  private analyticsService: AnalyticsService;
  private reportExportService: ReportExportService;

  constructor(analyticsService: AnalyticsService) {
    this.analyticsService = analyticsService;
    this.reportExportService = new ReportExportService(analyticsService);
  }

  async getKPIMetrics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const metrics = await this.analyticsService.getKPIMetrics(filters);
      
      res.json({
        success: true,
        data: metrics,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting KPI metrics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch KPI metrics',
          code: 'KPI_METRICS_FETCH_FAILED'
        }
      });
    }
  }

  async getAdvancedAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const analytics = await this.analyticsService.getAdvancedAnalytics(filters);
      
      res.json({
        success: true,
        data: analytics,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting advanced analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch advanced analytics',
          code: 'ADVANCED_ANALYTICS_FETCH_FAILED'
        }
      });
    }
  }

  async getPerformanceAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const analytics = await this.analyticsService.getAdvancedAnalytics(filters);
      
      res.json({
        success: true,
        data: analytics.performance,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting performance analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch performance analytics',
          code: 'PERFORMANCE_ANALYTICS_FETCH_FAILED'
        }
      });
    }
  }

  async getTrendAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const analytics = await this.analyticsService.getAdvancedAnalytics(filters);
      
      res.json({
        success: true,
        data: analytics.trends,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting trend analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch trend analytics',
          code: 'TREND_ANALYTICS_FETCH_FAILED'
        }
      });
    }
  }

  async getForecastingAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const analytics = await this.analyticsService.getAdvancedAnalytics(filters);
      
      res.json({
        success: true,
        data: analytics.forecasting,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting forecasting analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch forecasting analytics',
          code: 'FORECASTING_ANALYTICS_FETCH_FAILED'
        }
      });
    }
  }

  async getInsightsAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const analytics = await this.analyticsService.getAdvancedAnalytics(filters);
      
      res.json({
        success: true,
        data: analytics.insights,
        filters,
        generatedAt: new Date().toISOString()
      });
    } catch (error: any) {
      console.error('Error getting insights analytics:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch insights analytics',
          code: 'INSIGHTS_ANALYTICS_FETCH_FAILED'
        }
      });
    }
  }

  async exportReport(req: Request, res: Response): Promise<void> {
    try {
      const { reportType } = req.params;
      const filters: ReportFilters = this.buildFiltersFromQuery(req.query);
      const exportOptions: ExportOptions = {
        format: (req.query.format as any) || 'csv',
        includeCharts: req.query.includeCharts === 'true',
        includeRawData: req.query.includeRawData === 'true',
        customFields: req.query.customFields ? (req.query.customFields as string).split(',') : undefined
      };

      const result = await this.reportExportService.exportReport(reportType, filters, exportOptions);
      
      res.json({
        success: true,
        data: result,
        message: 'Report generated successfully. Download link is ready.'
      });
    } catch (error: any) {
      console.error('Error exporting report:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to export report',
          code: 'REPORT_EXPORT_FAILED'
        }
      });
    }
  }

  async getReportStatus(req: Request, res: Response): Promise<void> {
    try {
      const { reportId } = req.params;
      
      // This would check the status of a report generation job
      // For now, returning a mock response
      res.json({
        success: true,
        data: {
          reportId,
          status: 'completed',
          progress: 100,
          downloadUrl: `/api/analytics/reports/download/${reportId}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        }
      });
    } catch (error: any) {
      console.error('Error getting report status:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to get report status',
          code: 'REPORT_STATUS_FETCH_FAILED'
        }
      });
    }
  }

  async downloadReport(req: Request, res: Response): Promise<void> {
    try {
      const { filename } = req.params;
      
      const { filePath, exists } = await this.reportExportService.getReportFile(filename);
      
      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            message: 'Report file not found',
            code: 'REPORT_NOT_FOUND'
          }
        });
      }

      // Set appropriate headers for file download
      const stats = require('fs').statSync(filePath);
      const fileSize = stats.size;
      const format = filename.split('.').pop()?.toUpperCase() || 'CSV';
      
      res.setHeader('Content-Type', this.getContentType(format));
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', fileSize);
      
      // Stream the file to the response
      const fileStream = require('fs').createReadStream(filePath);
      fileStream.pipe(res);
      
    } catch (error: any) {
      console.error('Error downloading report:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to download report',
          code: 'REPORT_DOWNLOAD_FAILED'
        }
      });
    }
  }

  private getContentType(format: string): string {
    switch (format.toLowerCase()) {
      case 'csv':
        return 'text/csv';
      case 'json':
        return 'application/json';
      case 'pdf':
        return 'application/pdf';
      case 'excel':
      case 'xlsx':
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
      default:
        return 'application/octet-stream';
    }
  }

  async getAvailableReports(req: Request, res: Response): Promise<void> {
    try {
      const reports = [
        {
          id: 'kpi-summary',
          name: 'KPI Summary Report',
          description: 'Comprehensive overview of all key performance indicators',
          category: 'Performance',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 22 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'order-analytics',
          name: 'Order Analytics Report',
          description: 'Detailed analysis of order processing and fulfillment',
          category: 'Operations',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'customer-insights',
          name: 'Customer Insights Report',
          description: 'Customer satisfaction, onboarding, and retention analytics',
          category: 'Customer',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 18 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'fno-performance',
          name: 'FNO Performance Report',
          description: 'Fiber Network Operator integration and performance metrics',
          category: 'Integration',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 16 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'escalation-analysis',
          name: 'Escalation Analysis Report',
          description: 'Escalation patterns, resolution times, and improvement opportunities',
          category: 'Operations',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()
        },
        {
          id: 'system-health',
          name: 'System Health Report',
          description: 'System performance, uptime, and reliability metrics',
          category: 'Infrastructure',
          format: ['csv', 'pdf', 'excel'],
          lastGenerated: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(),
          nextScheduled: new Date(Date.now() + 23 * 60 * 60 * 1000).toISOString()
        }
      ];

      res.json({
        success: true,
        data: reports,
        total: reports.length
      });
    } catch (error: any) {
      console.error('Error getting available reports:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to get available reports',
          code: 'AVAILABLE_REPORTS_FETCH_FAILED'
        }
      });
    }
  }

  private buildFiltersFromQuery(query: any): ReportFilters {
    const filters: ReportFilters = {};

    const normalizeDate = (input: any, isEnd: boolean = false): string | undefined => {
      if (!input || typeof input !== 'string') return undefined;
      const value = input.trim();

      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const date = new Date(value + 'T' + (isEnd ? '23:59:59.999Z' : '00:00:00.000Z'));
        return isNaN(date.getTime()) ? undefined : date.toISOString();
      }

      // YYYY-MM
      if (/^\d{4}-\d{2}$/.test(value)) {
        const [yearStr, monthStr] = value.split('-');
        const year = Number(yearStr);
        const month = Number(monthStr); // 1-12
        if (year >= 1970 && month >= 1 && month <= 12) {
          if (isEnd) {
            const lastDay = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // day 0 of next month = last day of month
            return lastDay.toISOString();
          }
          const firstDay = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
          return firstDay.toISOString();
        }
      }

      // YYYY
      if (/^\d{4}$/.test(value)) {
        const year = Number(value);
        if (year >= 1970) {
          if (isEnd) {
            const end = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
            return end.toISOString();
          }
          const start = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
          return start.toISOString();
        }
      }

      // Fallback: try Date.parse
      const parsed = new Date(value);
      return isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
    };

    const start = normalizeDate(query.startDate, false);
    const end = normalizeDate(query.endDate, true);

    if (start || end) {
      const now = new Date();
      const defaultEnd = end ? new Date(end) : now;
      const defaultStart = start ? new Date(start) : new Date(defaultEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
      filters.dateRange = {
        start: defaultStart.toISOString(),
        end: defaultEnd.toISOString()
      };
    }

    if (query.orderTypes) {
      filters.orderTypes = Array.isArray(query.orderTypes) ? query.orderTypes : [query.orderTypes];
    }

    if (query.serviceTypes) {
      filters.serviceTypes = Array.isArray(query.serviceTypes) ? query.serviceTypes : [query.serviceTypes];
    }

    if (query.fnos) {
      filters.fnos = Array.isArray(query.fnos) ? query.fnos : [query.fnos];
    }

    if (query.users) {
      filters.users = Array.isArray(query.users) ? query.users : [query.users];
    }

    if (query.statuses) {
      filters.statuses = Array.isArray(query.statuses) ? query.statuses : [query.statuses];
    }

    if (query.priorities) {
      filters.priorities = Array.isArray(query.priorities) ? query.priorities : [query.priorities];
    }

    if (query.granularity) {
      filters.granularity = query.granularity as any;
    }

    return filters;
  }
}

export function createAnalyticsController(analyticsService: AnalyticsService): AnalyticsController {
  return new AnalyticsController(analyticsService);
}
