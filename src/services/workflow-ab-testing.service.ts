import type { Pool } from 'pg';
import { ConfigurableWorkflowService } from './configurable-workflow.service.ts';

export interface ABTest {
  id: string;
  name: string;
  description?: string;
  orderType: string;
  controlWorkflowId: string;
  variantWorkflowId: string;
  trafficSplit: number; // 0.0 to 1.0
  startDate: Date;
  endDate?: Date;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  successMetrics: any;
  results?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface ABTestAssignment {
  id: string;
  testId: string;
  orderId: string;
  assignedWorkflowId: string;
  assignmentReason: 'control' | 'variant' | 'random' | 'manual';
  assignedAt: Date;
}

export interface ABTestResults {
  testId: string;
  controlMetrics: {
    totalOrders: number;
    completionRate: number;
    averageCompletionTime: number;
    errorRate: number;
    customerSatisfaction: number;
  };
  variantMetrics: {
    totalOrders: number;
    completionRate: number;
    averageCompletionTime: number;
    errorRate: number;
    customerSatisfaction: number;
  };
  statisticalSignificance: {
    isSignificant: boolean;
    confidenceLevel: number;
    pValue: number;
  };
  recommendation: 'control' | 'variant' | 'inconclusive';
  summary: string;
}

export class WorkflowABTestingService {
  private db: Pool;
  private workflowService: ConfigurableWorkflowService;

  constructor(db: Pool, workflowService: ConfigurableWorkflowService) {
    this.db = db;
    this.workflowService = workflowService;
  }

  // Create A/B test
  async createABTest(test: Partial<ABTest>, createdBy: string): Promise<ABTest> {
    const result = await this.db.query(
      `INSERT INTO workflow_ab_tests (name, description, order_type, control_workflow_id, variant_workflow_id, 
       traffic_split, start_date, end_date, status, success_metrics, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        test.name,
        test.description,
        test.orderType,
        test.controlWorkflowId,
        test.variantWorkflowId,
        test.trafficSplit || 0.5,
        test.startDate,
        test.endDate,
        test.status || 'active',
        JSON.stringify(test.successMetrics || {}),
        createdBy
      ]
    );
    return result.rows[0];
  }

  // Get active A/B test for order type
  async getActiveABTest(orderType: string): Promise<ABTest | null> {
    const result = await this.db.query(
      `SELECT * FROM workflow_ab_tests 
       WHERE order_type = $1 AND status = 'active' 
       AND start_date <= NOW() 
       AND (end_date IS NULL OR end_date > NOW())
       ORDER BY created_at DESC LIMIT 1`,
      [orderType]
    );
    return result.rows[0] || null;
  }

  // Assign order to workflow (A/B test logic)
  async assignOrderToWorkflow(orderId: string, orderType: string): Promise<string> {
    const abTest = await this.getActiveABTest(orderType);
    
    if (!abTest) {
      // No active A/B test, use default workflow
      const defaultWorkflow = await this.workflowService.getWorkflowForOrderType(orderType);
      if (defaultWorkflow) {
        return defaultWorkflow.id;
      }
      throw new Error(`No workflow found for order type: ${orderType}`);
    }

    // Determine assignment based on traffic split
    const randomValue = Math.random();
    const isVariant = randomValue < abTest.trafficSplit;
    const assignedWorkflowId = isVariant ? abTest.variantWorkflowId : abTest.controlWorkflowId;
    const assignmentReason = isVariant ? 'variant' : 'control';

    // Record assignment
    await this.db.query(
      `INSERT INTO workflow_ab_assignments (test_id, order_id, assigned_workflow_id, assignment_reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (test_id, order_id) DO NOTHING`,
      [abTest.id, orderId, assignedWorkflowId, assignmentReason]
    );

    console.log(`[ab-test] Assigned order ${orderId} to ${assignmentReason} workflow in test ${abTest.name}`);
    return assignedWorkflowId;
  }

  // Get A/B test results
  async getABTestResults(testId: string): Promise<ABTestResults> {
    const test = await this.getABTest(testId);
    if (!test) {
      throw new Error(`A/B test not found: ${testId}`);
    }

    // Get control group metrics
    const controlMetrics = await this.calculateWorkflowMetrics(test.controlWorkflowId, testId, 'control');
    
    // Get variant group metrics
    const variantMetrics = await this.calculateWorkflowMetrics(test.variantWorkflowId, testId, 'variant');

    // Calculate statistical significance
    const statisticalSignificance = this.calculateStatisticalSignificance(controlMetrics, variantMetrics);

    // Generate recommendation
    const recommendation = this.generateRecommendation(controlMetrics, variantMetrics, statisticalSignificance);

    // Generate summary
    const summary = this.generateSummary(controlMetrics, variantMetrics, statisticalSignificance, recommendation);

    return {
      testId,
      controlMetrics,
      variantMetrics,
      statisticalSignificance,
      recommendation,
      summary
    };
  }

  // Calculate workflow metrics
  private async calculateWorkflowMetrics(workflowId: string, testId: string, group: string): Promise<any> {
    const result = await this.db.query(
      `SELECT 
         COUNT(DISTINCT o.id) as total_orders,
         AVG(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completion_rate,
         AVG(EXTRACT(EPOCH FROM (o.updated_at - o.created_at))/3600) as avg_completion_time_hours,
         AVG(CASE WHEN o.status = 'cancelled' THEN 1 ELSE 0 END) as error_rate,
         AVG(COALESCE(wm.metric_value, 0)) as customer_satisfaction
       FROM orders o
       JOIN workflow_ab_assignments waa ON o.id = waa.order_id
       LEFT JOIN workflow_metrics wm ON o.id = wm.order_id AND wm.metric_name = 'customer_satisfaction'
       WHERE waa.test_id = $1 
       AND waa.assigned_workflow_id = $2
       AND waa.assignment_reason = $3`,
      [testId, workflowId, group]
    );

    const metrics = result.rows[0];
    return {
      totalOrders: parseInt(metrics.total_orders) || 0,
      completionRate: parseFloat(metrics.completion_rate) || 0,
      averageCompletionTime: parseFloat(metrics.avg_completion_time_hours) || 0,
      errorRate: parseFloat(metrics.error_rate) || 0,
      customerSatisfaction: parseFloat(metrics.customer_satisfaction) || 0
    };
  }

  // Calculate statistical significance
  private calculateStatisticalSignificance(control: any, variant: any): any {
    // Simple statistical significance calculation
    // In production, you'd use proper statistical tests like chi-square or t-test
    
    const controlSampleSize = control.totalOrders;
    const variantSampleSize = variant.totalOrders;
    
    if (controlSampleSize < 30 || variantSampleSize < 30) {
      return {
        isSignificant: false,
        confidenceLevel: 0,
        pValue: 1.0,
        note: 'Sample size too small for statistical significance'
      };
    }

    // Calculate confidence interval for completion rate difference
    const completionRateDiff = variant.completionRate - control.completionRate;
    const standardError = Math.sqrt(
      (control.completionRate * (1 - control.completionRate) / controlSampleSize) +
      (variant.completionRate * (1 - variant.completionRate) / variantSampleSize)
    );
    
    const zScore = Math.abs(completionRateDiff / standardError);
    const confidenceLevel = this.zScoreToConfidence(zScore);
    const pValue = 2 * (1 - this.normalCDF(zScore));

    return {
      isSignificant: pValue < 0.05,
      confidenceLevel,
      pValue,
      completionRateDifference: completionRateDiff,
      standardError
    };
  }

  // Generate recommendation
  private generateRecommendation(control: any, variant: any, significance: any): 'control' | 'variant' | 'inconclusive' {
    if (!significance.isSignificant) {
      return 'inconclusive';
    }

    const completionRateDiff = variant.completionRate - control.completionRate;
    const timeDiff = control.averageCompletionTime - variant.averageCompletionTime;
    const satisfactionDiff = variant.customerSatisfaction - control.customerSatisfaction;

    // Weighted scoring (completion rate is most important)
    const score = (completionRateDiff * 0.5) + (timeDiff * 0.3) + (satisfactionDiff * 0.2);

    if (score > 0.05) {
      return 'variant';
    } else if (score < -0.05) {
      return 'control';
    } else {
      return 'inconclusive';
    }
  }

  // Generate summary
  private generateSummary(control: any, variant: any, significance: any, recommendation: string): string {
    const completionRateDiff = ((variant.completionRate - control.completionRate) * 100).toFixed(1);
    const timeDiff = (control.averageCompletionTime - variant.averageCompletionTime).toFixed(1);
    const satisfactionDiff = (variant.customerSatisfaction - control.customerSatisfaction).toFixed(1);

    let summary = `A/B Test Results Summary:\n`;
    summary += `- Control Group: ${control.totalOrders} orders, ${(control.completionRate * 100).toFixed(1)}% completion rate\n`;
    summary += `- Variant Group: ${variant.totalOrders} orders, ${(variant.completionRate * 100).toFixed(1)}% completion rate\n`;
    summary += `- Completion Rate Difference: ${completionRateDiff > 0 ? '+' : ''}${completionRateDiff}%\n`;
    summary += `- Time Difference: ${timeDiff > 0 ? '+' : ''}${timeDiff} hours\n`;
    summary += `- Satisfaction Difference: ${satisfactionDiff > 0 ? '+' : ''}${satisfactionDiff}\n`;
    summary += `- Statistical Significance: ${significance.isSignificant ? 'Yes' : 'No'} (p-value: ${significance.pValue.toFixed(3)})\n`;
    summary += `- Recommendation: ${recommendation}`;

    return summary;
  }

  // Helper functions for statistical calculations
  private zScoreToConfidence(zScore: number): number {
    // Convert z-score to confidence level
    return this.normalCDF(zScore) * 2 - 1;
  }

  private normalCDF(x: number): number {
    // Approximation of normal CDF
    return 0.5 * (1 + this.erf(x / Math.sqrt(2)));
  }

  private erf(x: number): number {
    // Approximation of error function
    const a1 = 0.254829592;
    const a2 = -0.284496736;
    const a3 = 1.421413741;
    const a4 = -1.453152027;
    const a5 = 1.061405429;
    const p = 0.3275911;

    const sign = x >= 0 ? 1 : -1;
    x = Math.abs(x);

    const t = 1.0 / (1.0 + p * x);
    const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

    return sign * y;
  }

  // Record workflow metric
  async recordMetric(orderId: string, metricName: string, value: number, unit?: string, context?: any): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_metrics (order_id, metric_name, metric_value, metric_unit, context)
       VALUES ($1, $2, $3, $4, $5)`,
      [orderId, metricName, value, unit, JSON.stringify(context || {})]
    );
  }

  // Get A/B test by ID
  async getABTest(testId: string): Promise<ABTest | null> {
    const result = await this.db.query(
      'SELECT * FROM workflow_ab_tests WHERE id = $1',
      [testId]
    );
    return result.rows[0] || null;
  }

  // Get all A/B tests
  async getAllABTests(): Promise<ABTest[]> {
    const result = await this.db.query(
      'SELECT * FROM workflow_ab_tests ORDER BY created_at DESC'
    );
    return result.rows;
  }

  // Update A/B test
  async updateABTest(testId: string, updates: Partial<ABTest>): Promise<ABTest> {
    const result = await this.db.query(
      `UPDATE workflow_ab_tests 
       SET name = COALESCE($1, name),
           description = COALESCE($2, description),
           traffic_split = COALESCE($3, traffic_split),
           end_date = COALESCE($4, end_date),
           status = COALESCE($5, status),
           results = COALESCE($6, results),
           updated_at = NOW()
       WHERE id = $7
       RETURNING *`,
      [
        updates.name,
        updates.description,
        updates.trafficSplit,
        updates.endDate,
        updates.status,
        updates.results ? JSON.stringify(updates.results) : undefined,
        testId
      ]
    );
    return result.rows[0];
  }

  // Pause A/B test
  async pauseABTest(testId: string): Promise<void> {
    await this.db.query(
      'UPDATE workflow_ab_tests SET status = $1, updated_at = NOW() WHERE id = $2',
      ['paused', testId]
    );
  }

  // Complete A/B test
  async completeABTest(testId: string, results: ABTestResults): Promise<void> {
    await this.db.query(
      'UPDATE workflow_ab_tests SET status = $1, results = $2, end_date = NOW(), updated_at = NOW() WHERE id = $3',
      ['completed', JSON.stringify(results), testId]
    );
  }
}
