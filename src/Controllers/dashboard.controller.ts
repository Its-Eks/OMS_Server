import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import type { MongoClient } from 'mongodb';
import { DashboardService } from '../services/dashboard.service.ts';

export class DashboardController {
  private dashboardService: DashboardService;

  constructor(db: Pool, mongo: MongoClient | null, redis: any) {
    this.dashboardService = new DashboardService(db, mongo, redis);
  }

  async getDashboard(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const dashboardData = await this.dashboardService.getDashboardData(userId);

      res.json({
        success: true,
        data: dashboardData
      });
    } catch (error: any) {
      console.error('Error in getDashboard:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch dashboard data'
        }
      });
    }
  }

  async getSummaryStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const summary = await this.dashboardService.getDashboardData(userId);
      
      res.json({
        success: true,
        data: summary.summary
      });
    } catch (error: any) {
      console.error('Error in getSummaryStats:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch summary statistics'
        }
      });
    }
  }

  async getRecentOrders(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const dashboardData = await this.dashboardService.getDashboardData(userId);
      
      res.json({
        success: true,
        data: dashboardData.recentOrders
      });
    } catch (error: any) {
      console.error('Error in getRecentOrders:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch recent orders'
        }
      });
    }
  }

  async getPendingEscalations(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const dashboardData = await this.dashboardService.getDashboardData(userId);
      
      res.json({
        success: true,
        data: dashboardData.pendingEscalations
      });
    } catch (error: any) {
      console.error('Error in getPendingEscalations:', error);
      res.status(500).json({
        success: false,
        error: {
          message: error.message || 'Failed to fetch pending escalations'
        }
      });
    }
  }
}
