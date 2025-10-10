import { Request, Response } from 'express';
import { AnalyticsService, ReportFilters, ExportOptions } from '../services/analytics.service.ts';

export class AnalyticsController {
  private analyticsService: AnalyticsService;

  constructor(analyticsService: AnalyticsService) {
    this.analyticsService = analyticsService;
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

      const result = await this.analyticsService.exportReport(reportType, filters, exportOptions);
      
      res.json({
        success: true,
        data: result,
        message: 'Report generation initiated. Download link will be available shortly.'
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
      
      // This would serve the actual report file
      // For now, returning a mock response
      res.json({
        success: true,
        data: {
          filename,
          url: `/api/analytics/reports/files/${filename}`,
          size: '2.3 MB',
          format: filename.split('.').pop()?.toUpperCase() || 'CSV'
        }
      });
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

    if (query.startDate && query.endDate) {
      filters.dateRange = {
        start: query.startDate,
        end: query.endDate
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
