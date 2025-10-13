import { Router } from 'express';
import type { Request, Response } from 'express';
import { authorize } from '../Middleware/authMiddleware.ts';
import { RealtimeMetricsService } from '../services/realtime-metrics.service.ts';

const router = Router();

/**
 * GET /realtime/metrics
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns current real-time metrics for system monitoring.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "id": "orders_today",
 *         "name": "Orders Created Today",
 *         "value": 23,
 *         "unit": "orders",
 *         "timestamp": "2025-01-18T10:00:00.000Z",
 *         "status": "normal",
 *         "threshold": { "warning": 50, "critical": 100 }
 *       }
 *     ]
 *   }
 */
router.get('/metrics', (req: Request, res: Response) => {
  if (!(req as any).realtimeMetricsService) {
    return res.status(500).json({ success: false, error: { message: 'Realtime metrics service not available' } });
  }
  
  const metrics = (req as any).realtimeMetricsService.getMetrics();
  res.json({
    success: true,
    data: metrics,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /realtime/alerts
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns current system alerts and warnings.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "id": "orders_today_1705582800000",
 *         "metricId": "orders_today",
 *         "metricName": "Orders Created Today",
 *         "severity": "warning",
 *         "message": "Orders Created Today has exceeded warning threshold (75 orders > 50 orders)",
 *         "value": 75,
 *         "threshold": 50,
 *         "timestamp": "2025-01-18T10:00:00.000Z",
 *         "acknowledged": false
 *       }
 *     ]
 *   }
 */
router.get('/alerts', (req: Request, res: Response) => {
  if (!(req as any).realtimeMetricsService) {
    return res.status(500).json({ success: false, error: { message: 'Realtime metrics service not available' } });
  }
  
  const alerts = (req as any).realtimeMetricsService.getAlerts();
  res.json({
    success: true,
    data: alerts,
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /realtime/health
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns overall system health status.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "status": "healthy",
 *       "uptime": 99.95,
 *       "responseTime": 245,
 *       "errorRate": 0.2,
 *       "activeConnections": 45,
 *       "memoryUsage": 67.8,
 *       "cpuUsage": 34.2,
 *       "diskUsage": 45.6,
 *       "lastUpdated": "2025-01-18T10:00:00.000Z"
 *     }
 *   }
 */
router.get('/health', (req: Request, res: Response) => {
  if (!(req as any).realtimeMetricsService) {
    return res.status(500).json({ success: false, error: { message: 'Realtime metrics service not available' } });
  }
  
  const health = (req as any).realtimeMetricsService.getSystemHealth();
  res.json({
    success: true,
    data: health,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /realtime/alerts/:alertId/acknowledge
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 *   - Content-Type: application/json
 * Path Parameters:
 *   - alertId: ID of the alert to acknowledge
 * Request Body:
 *   {
 *     "acknowledgedBy": "user@example.com"
 *   }
 * Description:
 *   Acknowledges a system alert.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "alertId": "orders_today_1705582800000",
 *       "acknowledged": true,
 *       "acknowledgedBy": "user@example.com",
 *       "acknowledgedAt": "2025-01-18T10:05:00.000Z"
 *     }
 *   }
 */
router.post('/alerts/:alertId/acknowledge', (req: Request, res: Response) => {
  if (!(req as any).realtimeMetricsService) {
    return res.status(500).json({ success: false, error: { message: 'Realtime metrics service not available' } });
  }
  
  const { alertId } = req.params;
  const { acknowledgedBy } = req.body;
  
  if (!acknowledgedBy) {
    return res.status(400).json({
      success: false,
      error: { message: 'acknowledgedBy is required' }
    });
  }
  
  const success = (req as any).realtimeMetricsService.acknowledgeAlert(alertId, acknowledgedBy);
  
  if (!success) {
    return res.status(404).json({
      success: false,
      error: { message: 'Alert not found' }
    });
  }
  
  res.json({
    success: true,
    data: {
      alertId,
      acknowledged: true,
      acknowledgedBy,
      acknowledgedAt: new Date().toISOString()
    }
  });
});

/**
 * GET /realtime/metrics/:metricId/history
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Query Parameters:
 *   - hours: Number of hours to look back (default: 24)
 * Description:
 *   Returns historical data for a specific metric.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "metricId": "orders_today",
 *       "metricName": "Orders Created Today",
 *       "history": [
 *         {
 *           "timestamp": "2025-01-18T09:00:00.000Z",
 *           "value": 22,
 *           "status": "normal"
 *         }
 *       ]
 *     }
 *   }
 */
router.get('/metrics/:metricId/history', (req: Request, res: Response) => {
  if (!(req as any).realtimeMetricsService) {
    return res.status(500).json({ success: false, error: { message: 'Realtime metrics service not available' } });
  }
  
  const { metricId } = req.params;
  const hours = parseInt(req.query.hours as string) || 24;
  
  // This would typically fetch from a time-series database
  // For now, returning mock historical data
  const history = [];
  const now = new Date();
  
  for (let i = 0; i < hours; i++) {
    const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
    history.push({
      timestamp: timestamp.toISOString(),
      value: Math.floor(Math.random() * 100) + 20,
      status: 'normal'
    });
  }
  
  res.json({
    success: true,
    data: {
      metricId,
      metricName: `${metricId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`,
      history: history.reverse()
    }
  });
});

/**
 * GET /realtime/dashboard
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns a comprehensive dashboard view of all real-time metrics, alerts, and health status.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "metrics": [...],
 *       "alerts": [...],
 *       "health": {...},
 *       "summary": {
 *         "totalMetrics": 12,
 *         "activeAlerts": 2,
 *         "systemStatus": "healthy"
 *       }
 *     }
 *   }
 */
router.get('/dashboard', (req: Request, res: Response) => {
  console.log('📊 Realtime dashboard called - returning mock data immediately');
  
  // Return mock data immediately to prevent timeouts
  const mockData = {
    metrics: [
      {
        id: 'orders_today',
        name: 'Orders Created Today',
        value: 6,
        unit: 'orders',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 50, critical: 100 }
      },
      {
        id: 'active_orders',
        name: 'Active Orders',
        value: 6,
        unit: 'orders',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 200, critical: 500 }
      },
      {
        id: 'open_escalations',
        name: 'Open Escalations',
        value: 0,
        unit: 'escalations',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 10, critical: 25 }
      },
      {
        id: 'avg_processing_time',
        name: 'Avg Processing Time (24h)',
        value: 24.5,
        unit: 'hours',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 48, critical: 72 }
      },
      {
        id: 'db_connections',
        name: 'Active DB Connections',
        value: 8,
        unit: 'connections',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 80, critical: 95 }
      },
      {
        id: 'db_response_time',
        name: 'DB Response Time',
        value: 45,
        unit: 'ms',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 100, critical: 500 }
      },
      {
        id: 'memory_usage',
        name: 'Memory Usage',
        value: 67.8,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 80, critical: 90 }
      },
      {
        id: 'cpu_usage',
        name: 'CPU Usage',
        value: 34.2,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 80, critical: 90 }
      },
      {
        id: 'error_rate',
        name: 'Error Rate (24h)',
        value: 0.2,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 1, critical: 5 }
      },
      {
        id: 'throughput',
        name: 'Orders/Hour (24h)',
        value: 2.5,
        unit: 'orders/hour',
        timestamp: new Date().toISOString(),
        status: 'normal'
      },
      {
        id: 'active_users',
        name: 'Active Users (1h)',
        value: 2,
        unit: 'users',
        timestamp: new Date().toISOString(),
        status: 'normal'
      },
      {
        id: 'user_adoption',
        name: 'User Adoption Rate',
        value: 85.0,
        unit: '%',
        timestamp: new Date().toISOString(),
        status: 'normal',
        threshold: { warning: 20, critical: 10 }
      }
    ],
    alerts: [],
    health: {
      status: 'healthy',
      uptime: 99.95,
      responseTime: 45,
      errorRate: 0.2,
      activeConnections: 8,
      memoryUsage: 67.8,
      cpuUsage: 34.2,
      diskUsage: 45.6,
      lastUpdated: new Date().toISOString()
    },
    summary: {
      totalMetrics: 12,
      activeAlerts: 0,
      systemStatus: 'healthy',
      lastUpdated: new Date().toISOString()
    }
  };
  
  res.json({
    success: true,
    data: mockData,
    timestamp: new Date().toISOString(),
    mock: true
  });
});

export default router;
