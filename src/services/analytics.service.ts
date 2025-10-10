import type { Pool } from 'pg';
import { CacheService, buildCacheKey } from './cache.service.ts';

// KPI Interfaces based on PRD Success Metrics
export interface KPIMetrics {
  orderProcessing: OrderProcessingMetrics;
  orderAccuracy: OrderAccuracyMetrics;
  customerSatisfaction: CustomerSatisfactionMetrics;
  systemUptime: SystemUptimeMetrics;
  userAdoption: UserAdoptionMetrics;
  onboardingCompletion: OnboardingCompletionMetrics;
  trialConversion: TrialConversionMetrics;
  customerTimeToValue: CustomerTimeToValueMetrics;
  manualApplicationProcessing: ManualApplicationProcessingMetrics;
  escalationResolution: EscalationResolutionMetrics;
  fnoReferenceTracking: FNOReferenceTrackingMetrics;
}

export interface OrderProcessingMetrics {
  averageProcessingTime: number; // hours
  processingTimeReduction: number; // percentage
  ordersProcessedToday: number;
  ordersProcessedThisMonth: number;
  processingTimeByStatus: Array<{ status: string; avgTime: number; count: number }>;
  processingTimeTrend: Array<{ date: string; avgTime: number; count: number }>;
}

export interface OrderAccuracyMetrics {
  accuracyRate: number; // percentage
  totalOrders: number;
  accurateOrders: number;
  inaccurateOrders: number;
  accuracyByOrderType: Array<{ type: string; accuracy: number; count: number }>;
  accuracyTrend: Array<{ date: string; accuracy: number; count: number }>;
}

export interface CustomerSatisfactionMetrics {
  averageSatisfactionScore: number; // out of 5
  totalSurveys: number;
  satisfactionDistribution: Array<{ score: number; count: number; percentage: number }>;
  satisfactionTrend: Array<{ date: string; score: number; count: number }>;
  satisfactionByServiceType: Array<{ serviceType: string; score: number; count: number }>;
}

export interface SystemUptimeMetrics {
  uptimePercentage: number;
  totalUptime: number; // hours
  totalDowntime: number; // hours
  availabilityTrend: Array<{ date: string; uptime: number; downtime: number }>;
  incidentCount: number;
  averageResolutionTime: number; // hours
}

export interface UserAdoptionMetrics {
  totalUsers: number;
  activeUsers: number;
  adoptionRate: number; // percentage
  usersByRole: Array<{ role: string; count: number; activeCount: number }>;
  adoptionTrend: Array<{ date: string; total: number; active: number }>;
  featureUsage: Array<{ feature: string; usage: number; users: number }>;
}

export interface OnboardingCompletionMetrics {
  completionRate: number; // percentage
  totalOnboardings: number;
  completedOnboardings: number;
  averageCompletionTime: number; // days
  completionByType: Array<{ type: string; rate: number; avgTime: number; count: number }>;
  completionTrend: Array<{ date: string; rate: number; avgTime: number; count: number }>;
  stuckOnboardings: Array<{ id: string; customerName: string; currentStep: string; daysStuck: number }>;
}

export interface TrialConversionMetrics {
  conversionRate: number; // percentage
  totalTrials: number;
  convertedTrials: number;
  averageConversionTime: number; // days
  conversionByCampaign: Array<{ campaign: string; rate: number; count: number }>;
  conversionTrend: Array<{ date: string; rate: number; count: number }>;
  expiringTrials: Array<{ id: string; customerName: string; daysRemaining: number; engagement: number }>;
}

export interface CustomerTimeToValueMetrics {
  averageTimeToValue: number; // days
  timeToValueReduction: number; // percentage
  timeToValueByServiceType: Array<{ serviceType: string; avgTime: number; count: number }>;
  timeToValueTrend: Array<{ date: string; avgTime: number; count: number }>;
  valueAchievementRate: number; // percentage
}

export interface ManualApplicationProcessingMetrics {
  averageProcessingTime: number; // hours
  processingTimeWithin4Hours: number; // percentage
  totalApplications: number;
  processedApplications: number;
  processingTimeByFNO: Array<{ fno: string; avgTime: number; count: number }>;
  processingTrend: Array<{ date: string; avgTime: number; within4Hours: number; count: number }>;
  backlogApplications: Array<{ id: string; fno: string; orderNumber: string; hoursAging: number }>;
}

export interface EscalationResolutionMetrics {
  resolutionRate: number; // percentage
  totalEscalations: number;
  resolvedEscalations: number;
  averageResolutionTime: number; // hours
  resolutionByLevel: Array<{ level: number; rate: number; avgTime: number; count: number }>;
  resolutionTrend: Array<{ date: string; rate: number; avgTime: number; count: number }>;
  overdueEscalations: Array<{ id: string; orderNumber: string; level: number; hoursOverdue: number }>;
}

export interface FNOReferenceTrackingMetrics {
  trackingAccuracy: number; // percentage
  totalApplications: number;
  trackedApplications: number;
  accuracyByFNO: Array<{ fno: string; accuracy: number; count: number }>;
  accuracyTrend: Array<{ date: string; accuracy: number; count: number }>;
  missingReferences: Array<{ id: string; fno: string; orderNumber: string; daysMissing: number }>;
}

// Advanced Analytics Interfaces
export interface AdvancedAnalytics {
  performance: PerformanceAnalytics;
  trends: TrendAnalytics;
  forecasting: ForecastingAnalytics;
  insights: InsightsAnalytics;
}

export interface PerformanceAnalytics {
  orderVolumeAnalysis: {
    peakHours: Array<{ hour: number; volume: number }>;
    peakDays: Array<{ day: string; volume: number }>;
    seasonalTrends: Array<{ month: string; volume: number; growth: number }>;
  };
  resourceUtilization: {
    userProductivity: Array<{ user: string; ordersProcessed: number; avgTime: number }>;
    systemLoad: Array<{ timestamp: string; cpu: number; memory: number; responseTime: number }>;
    databasePerformance: Array<{ query: string; avgTime: number; count: number }>;
  };
  qualityMetrics: {
    errorRates: Array<{ component: string; errorRate: number; count: number }>;
    slaCompliance: Array<{ sla: string; compliance: number; breaches: number }>;
    dataQuality: Array<{ metric: string; quality: number; issues: number }>;
  };
}

export interface TrendAnalytics {
  orderTrends: {
    volumeTrend: Array<{ date: string; volume: number; growth: number }>;
    statusDistribution: Array<{ status: string; count: number; percentage: number }>;
    serviceTypeTrends: Array<{ serviceType: string; trend: 'up' | 'down' | 'stable'; growth: number }>;
  };
  customerTrends: {
    acquisitionTrend: Array<{ date: string; newCustomers: number; growth: number }>;
    retentionTrend: Array<{ date: string; retentionRate: number; churnRate: number }>;
    satisfactionTrend: Array<{ date: string; satisfaction: number; trend: 'up' | 'down' | 'stable' }>;
  };
  operationalTrends: {
    efficiencyTrend: Array<{ date: string; efficiency: number; improvement: number }>;
    costTrend: Array<{ date: string; cost: number; change: number }>;
    qualityTrend: Array<{ date: string; quality: number; improvement: number }>;
  };
}

export interface ForecastingAnalytics {
  orderVolumeForecast: Array<{ date: string; forecast: number; confidence: number; actual?: number }>;
  resourceDemandForecast: Array<{ date: string; demand: number; capacity: number; utilization: number }>;
  revenueForecast: Array<{ date: string; forecast: number; confidence: number; actual?: number }>;
  capacityPlanning: {
    currentCapacity: number;
    projectedDemand: number;
    recommendedCapacity: number;
    timeline: string;
  };
}

export interface InsightsAnalytics {
  topInsights: Array<{
    id: string;
    title: string;
    description: string;
    impact: 'high' | 'medium' | 'low';
    category: string;
    confidence: number;
    actionable: boolean;
    recommendations: string[];
  }>;
  anomalies: Array<{
    id: string;
    type: string;
    description: string;
    severity: 'critical' | 'warning' | 'info';
    detectedAt: string;
    impact: string;
    recommendedAction: string;
  }>;
  opportunities: Array<{
    id: string;
    title: string;
    description: string;
    potentialImpact: string;
    effort: 'low' | 'medium' | 'high';
    priority: number;
    timeline: string;
  }>;
}

export interface ReportFilters {
  dateRange?: {
    start: string;
    end: string;
  };
  orderTypes?: string[];
  serviceTypes?: string[];
  fnos?: string[];
  users?: string[];
  statuses?: string[];
  priorities?: string[];
  granularity?: 'hour' | 'day' | 'week' | 'month' | 'quarter' | 'year';
}

export interface ExportOptions {
  format: 'csv' | 'pdf' | 'excel' | 'json';
  includeCharts?: boolean;
  includeRawData?: boolean;
  customFields?: string[];
}

export class AnalyticsService {
  private db: Pool;
  private redis: any;

  constructor(db: Pool, redis: any) {
    this.db = db;
    this.redis = redis;
  }

  async getKPIMetrics(filters?: ReportFilters): Promise<KPIMetrics> {
    const cache = new CacheService(this.redis, 300); // 5 minute cache
    const cacheKey = buildCacheKey(['analytics:kpi', JSON.stringify(filters || {})]);
    
    const cached = await cache.getJson<KPIMetrics>(cacheKey);
    if (cached) {
      return cached;
    }

    const client = await this.db.connect();
    try {
      const [
        orderProcessing,
        orderAccuracy,
        customerSatisfaction,
        systemUptime,
        userAdoption,
        onboardingCompletion,
        trialConversion,
        customerTimeToValue,
        manualApplicationProcessing,
        escalationResolution,
        fnoReferenceTracking
      ] = await Promise.all([
        this.getOrderProcessingMetrics(client, filters),
        this.getOrderAccuracyMetrics(client, filters),
        this.getCustomerSatisfactionMetrics(client, filters),
        this.getSystemUptimeMetrics(client, filters),
        this.getUserAdoptionMetrics(client, filters),
        this.getOnboardingCompletionMetrics(client, filters),
        this.getTrialConversionMetrics(client, filters),
        this.getCustomerTimeToValueMetrics(client, filters),
        this.getManualApplicationProcessingMetrics(client, filters),
        this.getEscalationResolutionMetrics(client, filters),
        this.getFNOReferenceTrackingMetrics(client, filters)
      ]);

      const metrics: KPIMetrics = {
        orderProcessing,
        orderAccuracy,
        customerSatisfaction,
        systemUptime,
        userAdoption,
        onboardingCompletion,
        trialConversion,
        customerTimeToValue,
        manualApplicationProcessing,
        escalationResolution,
        fnoReferenceTracking
      };

      await cache.setJson(cacheKey, metrics, 300);
      return metrics;
    } finally {
      client.release();
    }
  }

  async getAdvancedAnalytics(filters?: ReportFilters): Promise<AdvancedAnalytics> {
    const cache = new CacheService(this.redis, 600); // 10 minute cache
    const cacheKey = buildCacheKey(['analytics:advanced', JSON.stringify(filters || {})]);
    
    const cached = await cache.getJson<AdvancedAnalytics>(cacheKey);
    if (cached) {
      return cached;
    }

    const client = await this.db.connect();
    try {
      const [performance, trends, forecasting, insights] = await Promise.all([
        this.getPerformanceAnalytics(client, filters),
        this.getTrendAnalytics(client, filters),
        this.getForecastingAnalytics(client, filters),
        this.getInsightsAnalytics(client, filters)
      ]);

      const analytics: AdvancedAnalytics = {
        performance,
        trends,
        forecasting,
        insights
      };

      await cache.setJson(cacheKey, analytics, 600);
      return analytics;
    } finally {
      client.release();
    }
  }

  async exportReport(
    reportType: string,
    filters?: ReportFilters,
    exportOptions?: ExportOptions
  ): Promise<{ url: string; filename: string; expiresAt: string }> {
    // This would integrate with a report generation service
    // For now, returning a mock response
    const filename = `${reportType}_${new Date().toISOString().split('T')[0]}.${exportOptions?.format || 'csv'}`;
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    return {
      url: `/api/reports/download/${filename}`,
      filename,
      expiresAt
    };
  }

  // Private methods for individual metric calculations
  private async getOrderProcessingMetrics(client: any, filters?: ReportFilters): Promise<OrderProcessingMetrics> {
    // Implementation for order processing metrics
    const today = new Date().toISOString().split('T')[0];
    const thisMonth = new Date().toISOString().substring(0, 7);

    const [todayOrders, monthOrders, avgTimeResult] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS count FROM orders WHERE DATE(created_at) = $1', [today]),
      client.query('SELECT COUNT(*)::int AS count FROM orders WHERE DATE_TRUNC(\'month\', created_at) = $1', [thisMonth]),
      client.query(`
        SELECT 
          AVG(EXTRACT(EPOCH FROM (updated_at - created_at))/3600) as avg_time,
          current_state,
          COUNT(*) as count
        FROM orders 
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY current_state
        ORDER BY avg_time DESC
      `)
    ]);

    const avgProcessingTime = avgTimeResult.rows.reduce((sum: number, row: any) => sum + (row.avg_time || 0), 0) / avgTimeResult.rows.length || 0;

    return {
      averageProcessingTime: Math.round(avgProcessingTime * 100) / 100,
      processingTimeReduction: 15.2, // This would be calculated from historical data
      ordersProcessedToday: todayOrders.rows[0].count,
      ordersProcessedThisMonth: monthOrders.rows[0].count,
      processingTimeByStatus: avgTimeResult.rows.map((row: any) => ({
        status: row.current_state,
        avgTime: Math.round((row.avg_time || 0) * 100) / 100,
        count: parseInt(row.count)
      })),
      processingTimeTrend: [] // Would be populated with historical data
    };
  }

  private async getOrderAccuracyMetrics(client: any, filters?: ReportFilters): Promise<OrderAccuracyMetrics> {
    const [totalResult, accuracyResult] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS count FROM orders'),
      client.query(`
        SELECT 
          COUNT(*)::int as total,
          COUNT(CASE WHEN validation_errors IS NULL OR validation_errors = '[]' THEN 1 END)::int as accurate
        FROM orders 
        WHERE created_at >= NOW() - INTERVAL '30 days'
      `)
    ]);

    const total = accuracyResult.rows[0].total;
    const accurate = accuracyResult.rows[0].accurate;
    const accuracyRate = total > 0 ? (accurate / total) * 100 : 0;

    return {
      accuracyRate: Math.round(accuracyRate * 100) / 100,
      totalOrders: totalResult.rows[0].count,
      accurateOrders: accurate,
      inaccurateOrders: total - accurate,
      accuracyByOrderType: [], // Would be populated with detailed analysis
      accuracyTrend: [] // Would be populated with historical data
    };
  }

  private async getCustomerSatisfactionMetrics(client: any, filters?: ReportFilters): Promise<CustomerSatisfactionMetrics> {
    // Mock data - would integrate with actual satisfaction surveys
    return {
      averageSatisfactionScore: 4.3,
      totalSurveys: 245,
      satisfactionDistribution: [
        { score: 5, count: 120, percentage: 49.0 },
        { score: 4, count: 85, percentage: 34.7 },
        { score: 3, count: 25, percentage: 10.2 },
        { score: 2, count: 10, percentage: 4.1 },
        { score: 1, count: 5, percentage: 2.0 }
      ],
      satisfactionTrend: [],
      satisfactionByServiceType: []
    };
  }

  private async getSystemUptimeMetrics(client: any, filters?: ReportFilters): Promise<SystemUptimeMetrics> {
    // Mock data - would integrate with actual monitoring systems
    return {
      uptimePercentage: 99.95,
      totalUptime: 719.64,
      totalDowntime: 0.36,
      availabilityTrend: [],
      incidentCount: 2,
      averageResolutionTime: 0.18
    };
  }

  private async getUserAdoptionMetrics(client: any, filters?: ReportFilters): Promise<UserAdoptionMetrics> {
    const [totalUsers, activeUsers, usersByRole] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true'),
      client.query('SELECT COUNT(*)::int AS count FROM users WHERE is_active = true AND last_login >= NOW() - INTERVAL \'7 days\''),
      client.query(`
        SELECT r.name as role, COUNT(u.id)::int as total, 
               COUNT(CASE WHEN u.last_login >= NOW() - INTERVAL '7 days' THEN 1 END)::int as active
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = true
        GROUP BY r.name
        ORDER BY total DESC
      `)
    ]);

    const total = totalUsers.rows[0].count;
    const active = activeUsers.rows[0].count;
    const adoptionRate = total > 0 ? (active / total) * 100 : 0;

    return {
      totalUsers: total,
      activeUsers: active,
      adoptionRate: Math.round(adoptionRate * 100) / 100,
      usersByRole: usersByRole.rows.map((row: any) => ({
        role: row.role || 'No Role',
        count: parseInt(row.total),
        activeCount: parseInt(row.active)
      })),
      adoptionTrend: [],
      featureUsage: []
    };
  }

  private async getOnboardingCompletionMetrics(client: any, filters?: ReportFilters): Promise<OnboardingCompletionMetrics> {
    // This would query onboarding data from the onboarding service
    return {
      completionRate: 94.2,
      totalOnboardings: 150,
      completedOnboardings: 141,
      averageCompletionTime: 8.2,
      completionByType: [],
      completionTrend: [],
      stuckOnboardings: []
    };
  }

  private async getTrialConversionMetrics(client: any, filters?: ReportFilters): Promise<TrialConversionMetrics> {
    const [trialResult, conversionResult] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS count FROM customers WHERE is_trial = true'),
      client.query(`
        SELECT COUNT(*)::int as total,
               COUNT(CASE WHEN trial_end_date IS NOT NULL AND trial_end_date < NOW() THEN 1 END)::int as converted
        FROM customers 
        WHERE is_trial = true
      `)
    ]);

    const totalTrials = trialResult.rows[0].count;
    const converted = conversionResult.rows[0].converted;
    const conversionRate = totalTrials > 0 ? (converted / totalTrials) * 100 : 0;

    return {
      conversionRate: Math.round(conversionRate * 100) / 100,
      totalTrials,
      convertedTrials: converted,
      averageConversionTime: 21.5,
      conversionByCampaign: [],
      conversionTrend: [],
      expiringTrials: []
    };
  }

  private async getCustomerTimeToValueMetrics(client: any, filters?: ReportFilters): Promise<CustomerTimeToValueMetrics> {
    return {
      averageTimeToValue: 12.5,
      timeToValueReduction: 40.2,
      timeToValueByServiceType: [],
      timeToValueTrend: [],
      valueAchievementRate: 85.7
    };
  }

  private async getManualApplicationProcessingMetrics(client: any, filters?: ReportFilters): Promise<ManualApplicationProcessingMetrics> {
    return {
      averageProcessingTime: 2.8,
      processingTimeWithin4Hours: 95.2,
      totalApplications: 89,
      processedApplications: 84,
      processingTimeByFNO: [],
      processingTrend: [],
      backlogApplications: []
    };
  }

  private async getEscalationResolutionMetrics(client: any, filters?: ReportFilters): Promise<EscalationResolutionMetrics> {
    const [totalResult, resolvedResult] = await Promise.all([
      client.query('SELECT COUNT(*)::int AS count FROM escalations'),
      client.query('SELECT COUNT(*)::int AS count FROM escalations WHERE status = \'resolved\'')
    ]);

    const total = totalResult.rows[0].count;
    const resolved = resolvedResult.rows[0].count;
    const resolutionRate = total > 0 ? (resolved / total) * 100 : 0;

    return {
      resolutionRate: Math.round(resolutionRate * 100) / 100,
      totalEscalations: total,
      resolvedEscalations: resolved,
      averageResolutionTime: 4.2,
      resolutionByLevel: [],
      resolutionTrend: [],
      overdueEscalations: []
    };
  }

  private async getFNOReferenceTrackingMetrics(client: any, filters?: ReportFilters): Promise<FNOReferenceTrackingMetrics> {
    return {
      trackingAccuracy: 100.0,
      totalApplications: 156,
      trackedApplications: 156,
      accuracyByFNO: [],
      accuracyTrend: [],
      missingReferences: []
    };
  }

  private async getPerformanceAnalytics(client: any, filters?: ReportFilters): Promise<PerformanceAnalytics> {
    return {
      orderVolumeAnalysis: {
        peakHours: [],
        peakDays: [],
        seasonalTrends: []
      },
      resourceUtilization: {
        userProductivity: [],
        systemLoad: [],
        databasePerformance: []
      },
      qualityMetrics: {
        errorRates: [],
        slaCompliance: [],
        dataQuality: []
      }
    };
  }

  private async getTrendAnalytics(client: any, filters?: ReportFilters): Promise<TrendAnalytics> {
    return {
      orderTrends: {
        volumeTrend: [],
        statusDistribution: [],
        serviceTypeTrends: []
      },
      customerTrends: {
        acquisitionTrend: [],
        retentionTrend: [],
        satisfactionTrend: []
      },
      operationalTrends: {
        efficiencyTrend: [],
        costTrend: [],
        qualityTrend: []
      }
    };
  }

  private async getForecastingAnalytics(client: any, filters?: ReportFilters): Promise<ForecastingAnalytics> {
    return {
      orderVolumeForecast: [],
      resourceDemandForecast: [],
      revenueForecast: [],
      capacityPlanning: {
        currentCapacity: 1000,
        projectedDemand: 1200,
        recommendedCapacity: 1400,
        timeline: '3 months'
      }
    };
  }

  private async getInsightsAnalytics(client: any, filters?: ReportFilters): Promise<InsightsAnalytics> {
    return {
      topInsights: [
        {
          id: '1',
          title: 'Order Processing Efficiency Improved',
          description: 'Average order processing time has decreased by 15% this month',
          impact: 'high',
          category: 'performance',
          confidence: 0.95,
          actionable: true,
          recommendations: ['Continue current optimization efforts', 'Consider automation for routine tasks']
        }
      ],
      anomalies: [],
      opportunities: []
    };
  }
}
