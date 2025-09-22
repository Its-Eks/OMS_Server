import { Router } from 'express';
import { authenticate, authorize } from '../Middleware/authMiddleware.ts';
import { DashboardController } from '../Controllers/dashboard.controller.ts';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';

// Extend Request interface to include dashboardController
declare global {
  namespace Express {
    interface Request {
      dashboardController?: DashboardController;
    }
  }
}

const router = Router();

// Middleware to create dashboard controller
const createDashboardController = (req: Request, res: Response, next: any) => {
  const db: Pool = req.app.get('pgPool');
  const mongo: MongoClient | null = req.app.get('mongoClient');
  const redis = req.app.get('redis');
  
  req.dashboardController = new DashboardController(db, mongo, redis);
  next();
};

// Apply authentication to all dashboard routes
router.use(authenticate);
router.use(createDashboardController);

/**
 * GET /dashboard
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns complete dashboard data including summary stats, recent orders, and pending escalations.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "summary": {
 *         "totalOrders": 1247,
 *         "activeOrders": 89,
 *         "escalations": 12,
 *         "trialCustomers": 34,
 *         "ordersToday": 23
 *       },
 *       "recentOrders": [
 *         {
 *           "id": "uuid",
 *           "orderNumber": "ORD-2025-001",
 *           "priority": "high",
 *           "customerName": "John Smith",
 *           "serviceType": "Fiber",
 *           "status": "in_progress",
 *           "createdAt": "2025-01-18T09:00:00.000Z"
 *         }
 *       ],
 *       "pendingEscalations": [
 *         {
 *           "id": "uuid",
 *           "orderId": "uuid",
 *           "orderNumber": "ORD-2025-001",
 *           "customerName": "John Smith",
 *           "issue": "Installation delayed beyond SLA",
 *           "aging": "6 hours",
 *           "level": "Level 2",
 *           "createdAt": "2025-01-18T03:00:00.000Z"
 *         }
 *       ]
 *     }
 *   }
 */
router.get('/', authorize(['orders:read']), (req: Request, res: Response) => {
  if (!req.dashboardController) {
    return res.status(500).json({ success: false, error: { message: 'Dashboard controller not available' } });
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  req.dashboardController.getDashboard(req, res);
});

/**
 * GET /dashboard/summary
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns only the summary statistics for the dashboard cards.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": {
 *       "totalOrders": 1247,
 *       "activeOrders": 89,
 *       "escalations": 12,
 *       "trialCustomers": 34,
 *       "ordersToday": 23
 *     }
 *   }
 */
router.get('/summary', authorize(['orders:read']), (req: Request, res: Response) => {
  if (!req.dashboardController) {
    return res.status(500).json({ success: false, error: { message: 'Dashboard controller not available' } });
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  req.dashboardController.getSummaryStats(req, res);
});

/**
 * GET /dashboard/recent-orders
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns only the recent orders for the dashboard.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "id": "uuid",
 *         "orderNumber": "ORD-2025-001",
 *         "priority": "high",
 *         "customerName": "John Smith",
 *         "serviceType": "Fiber",
 *         "status": "in_progress",
 *         "createdAt": "2025-01-18T09:00:00.000Z"
 *       }
 *     ]
 *   }
 */
router.get('/recent-orders', authorize(['orders:read']), (req: Request, res: Response) => {
  if (!req.dashboardController) {
    return res.status(500).json({ success: false, error: { message: 'Dashboard controller not available' } });
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  req.dashboardController.getRecentOrders(req, res);
});

/**
 * GET /dashboard/pending-escalations
 * Headers:
 *   - Authorization: Bearer <TOKEN>
 * Description:
 *   Returns only the pending escalations for the dashboard.
 * Sample Response:
 *   {
 *     "success": true,
 *     "data": [
 *       {
 *         "id": "uuid",
 *         "orderId": "uuid",
 *         "orderNumber": "ORD-2025-001",
 *         "customerName": "John Smith",
 *         "issue": "Installation delayed beyond SLA",
 *         "aging": "6 hours",
 *         "level": "Level 2",
 *         "createdAt": "2025-01-18T03:00:00.000Z"
 *       }
 *     ]
 *   }
 */
router.get('/pending-escalations', authorize(['escalations:view']), (req: Request, res: Response) => {
  if (!req.dashboardController) {
    return res.status(500).json({ success: false, error: { message: 'Dashboard controller not available' } });
  }
  res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=60');
  req.dashboardController.getPendingEscalations(req, res);
});

export default router;
