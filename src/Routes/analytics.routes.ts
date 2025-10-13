import { Router } from 'express';
import type { Request, Response } from 'express';
import { createAnalyticsController, AnalyticsController } from '../Controllers/analytics.controller.ts';

const router = Router();

// Middleware to attach analytics controller to request
const createAnalyticsMiddleware = (analyticsController: AnalyticsController) => {
  return (req: Request, res: Response, next: Function) => {
    (req as any).analyticsController = analyticsController;
    next();
  };
};

/**
 * GET /analytics/kpi
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters:
 *   - startDate: Start date for filtering (ISO 8601)
 *   - endDate: End date for filtering (ISO 8601)
 *   - orderTypes: Comma-separated list of order types
 *   - serviceTypes: Comma-separated list of service types
 *   - fnos: Comma-separated list of FNO IDs
 *   - users: Comma-separated list of user IDs
 *   - statuses: Comma-separated list of statuses
 *   - priorities: Comma-separated list of priorities
 *   - granularity: Data granularity (hour, day, week, month, quarter, year)
 * Description:
 *   Returns comprehensive KPI metrics based on PRD success metrics.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "orderProcessing": {
 *         "averageProcessingTime": 24.5,
 *         "processingTimeReduction": 15.2,
 *         "ordersProcessedToday": 23,
 *         "ordersProcessedThisMonth": 456,
 *         "processingTimeByStatus": [...],
 *         "processingTimeTrend": [...]
 *       },
 *       "orderAccuracy": { ... },
 *       "customerSatisfaction": { ... },
 *       "systemUptime": { ... },
 *       "userAdoption": { ... },
 *       "onboardingCompletion": { ... },
 *       "trialConversion": { ... },
 *       "customerTimeToValue": { ... },
 *       "manualApplicationProcessing": { ... },
 *       "escalationResolution": { ... },
 *       "fnoReferenceTracking": { ... }
 *     },
 *     "filters": { ... },
 *     "generatedAt": "2025-01-18T10:00:00.000Z"
 *   }
 */
router.get('/kpi', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getKPIMetrics(req, res);
});

// New: Overall analytics (used by client fallbacks)
router.get('/overall', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  // Fallback: map overall to KPI metrics for now
  (req as any).analyticsController.getKPIMetrics(req, res);
});

/**
 * GET /analytics/advanced
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters: Same as KPI endpoint
 * Description:
 *   Returns advanced analytics including performance, trends, forecasting, and insights.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "performance": {
 *         "orderVolumeAnalysis": { ... },
 *         "resourceUtilization": { ... },
 *         "qualityMetrics": { ... }
 *       },
 *       "trends": { ... },
 *       "forecasting": { ... },
 *       "insights": { ... }
 *     },
 *     "filters": { ... },
 *     "generatedAt": "2025-01-18T10:00:00.000Z"
 *   }
 */
router.get('/advanced', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getAdvancedAnalytics(req, res);
});

// New: Order trends (used by client fallbacks)
router.get('/order-trends', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getOrderTrends(req, res);
});

// New: FNO performance (used by client fallbacks)
router.get('/fno-performance', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getFNOPerformance(req, res);
});

// New: Escalation metrics
router.get('/escalation-metrics', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getEscalationMetrics(req, res);
});

// New: Customer metrics
router.get('/customer-metrics', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getCustomerMetrics(req, res);
});

/**
 * GET /analytics/performance
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters: Same as KPI endpoint
 * Description:
 *   Returns performance analytics including order volume analysis, resource utilization, and quality metrics.
 */
router.get('/performance', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getPerformanceAnalytics(req, res);
});

/**
 * GET /analytics/trends
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters: Same as KPI endpoint
 * Description:
 *   Returns trend analytics including order trends, customer trends, and operational trends.
 */
router.get('/trends', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getTrendAnalytics(req, res);
});

/**
 * GET /analytics/forecasting
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters: Same as KPI endpoint
 * Description:
 *   Returns forecasting analytics including order volume forecasts, resource demand forecasts, and capacity planning.
 */
router.get('/forecasting', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getForecastingAnalytics(req, res);
});

/**
 * GET /analytics/insights
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters: Same as KPI endpoint
 * Description:
 *   Returns insights analytics including top insights, anomalies, and opportunities.
 */
router.get('/insights', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getInsightsAnalytics(req, res);
});

/**
 * GET /analytics/reports
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns list of available reports with their metadata.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "id": "kpi-summary",
 *         "name": "KPI Summary Report",
 *         "description": "Comprehensive overview of all key performance indicators",
 *         "category": "Performance",
 *         "format": ["csv", "pdf", "excel"],
 *         "lastGenerated": "2025-01-18T08:00:00.000Z",
 *         "nextScheduled": "2025-01-19T08:00:00.000Z"
 *       }
 *     ],
 *     "total": 6
 *   }
 */
router.get('/reports', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getAvailableReports(req, res);
});

/**
 * POST /analytics/reports/:reportType/export
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 *   - Content-Type: application/json
 * Path Parameters:
 *   - reportType: Type of report to export (kpi-summary, order-analytics, etc.)
 * Query Parameters:
 *   - format: Export format (csv, pdf, excel, json)
 *   - includeCharts: Include charts in export (true/false)
 *   - includeRawData: Include raw data in export (true/false)
 *   - customFields: Comma-separated list of custom fields to include
 *   - Plus all filtering parameters from KPI endpoint
 * Description:
 *   Initiates export of a specific report type with the specified filters and options.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "url": "/api/analytics/reports/download/kpi_summary_2025-01-18.csv",
 *       "filename": "kpi_summary_2025-01-18.csv",
 *       "expiresAt": "2025-01-19T10:00:00.000Z"
 *     },
 *     "message": "Report generation initiated. Download link will be available shortly."
 *   }
 */
router.post('/reports/:reportType/export', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.exportReport(req, res);
});

/**
 * GET /analytics/reports/:reportId/status
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Path Parameters:
 *   - reportId: ID of the report generation job
 * Description:
 *   Returns the status of a report generation job.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "reportId": "report_123",
 *       "status": "completed",
 *       "progress": 100,
 *       "downloadUrl": "/api/analytics/reports/download/report_123",
 *       "expiresAt": "2025-01-19T10:00:00.000Z"
 *     }
 *   }
 */
router.get('/reports/:reportId/status', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.getReportStatus(req, res);
});

/**
 * GET /analytics/reports/download/:filename
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Path Parameters:
 *   - filename: Name of the file to download
 * Description:
 *   Returns download information for a generated report file.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "filename": "kpi_summary_2025-01-18.csv",
 *       "url": "/api/analytics/reports/files/kpi_summary_2025-01-18.csv",
 *       "size": "2.3 MB",
 *       "format": "CSV"
 *     }
 *   }
 */
router.get('/reports/download/:filename', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ success: false, error: { message: 'Analytics controller not available' } });
  }
  (req as any).analyticsController.downloadReport(req, res);
});

export default router;
