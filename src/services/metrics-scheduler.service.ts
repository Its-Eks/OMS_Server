import { MetricsCollectionService } from './metrics-collection.service.ts';

export class MetricsSchedulerService {
  private metricsCollection: MetricsCollectionService;
  private intervals: Map<string, NodeJS.Timeout> = new Map();

  constructor(metricsCollection: MetricsCollectionService) {
    this.metricsCollection = metricsCollection;
  }

  /**
   * Start all scheduled metrics collection jobs
   */
  start(): void {
    console.log('[MetricsScheduler] Starting metrics collection jobs...');

    // Collect current metrics every 5 minutes
    this.scheduleJob('current-metrics', 5 * 60 * 1000, () => {
      this.metricsCollection.collectCurrentMetrics().catch(error => {
        console.error('[MetricsScheduler] Error collecting current metrics:', error);
      });
    });

    // Aggregate hourly metrics every hour
    this.scheduleJob('hourly-aggregation', 60 * 60 * 1000, () => {
      this.metricsCollection.aggregateMetrics('hour').catch(error => {
        console.error('[MetricsScheduler] Error aggregating hourly metrics:', error);
      });
    });

    // Aggregate daily metrics every day at midnight
    this.scheduleJob('daily-aggregation', 24 * 60 * 60 * 1000, () => {
      this.metricsCollection.aggregateMetrics('day').catch(error => {
        console.error('[MetricsScheduler] Error aggregating daily metrics:', error);
      });
    });

    // Clean up old metrics every day at 2 AM
    this.scheduleJob('cleanup', 24 * 60 * 60 * 1000, () => {
      this.metricsCollection.cleanupOldMetrics().catch(error => {
        console.error('[MetricsScheduler] Error cleaning up old metrics:', error);
      });
    });

    console.log('[MetricsScheduler] All metrics collection jobs started');
  }

  /**
   * Stop all scheduled jobs
   */
  stop(): void {
    console.log('[MetricsScheduler] Stopping metrics collection jobs...');
    
    for (const [name, interval] of this.intervals) {
      clearInterval(interval);
      console.log(`[MetricsScheduler] Stopped job: ${name}`);
    }
    
    this.intervals.clear();
    console.log('[MetricsScheduler] All metrics collection jobs stopped');
  }

  /**
   * Schedule a recurring job
   */
  private scheduleJob(name: string, intervalMs: number, job: () => void): void {
    // Run immediately on start
    job();
    
    // Then schedule recurring execution
    const interval = setInterval(job, intervalMs);
    this.intervals.set(name, interval);
    
    console.log(`[MetricsScheduler] Scheduled job: ${name} (every ${intervalMs / 1000}s)`);
  }

  /**
   * Get status of all scheduled jobs
   */
  getStatus(): { name: string; active: boolean }[] {
    return Array.from(this.intervals.keys()).map(name => ({
      name,
      active: this.intervals.has(name)
    }));
  }

  /**
   * Manually trigger a specific job
   */
  async triggerJob(jobName: string): Promise<void> {
    switch (jobName) {
      case 'current-metrics':
        await this.metricsCollection.collectCurrentMetrics();
        break;
      case 'hourly-aggregation':
        await this.metricsCollection.aggregateMetrics('hour');
        break;
      case 'daily-aggregation':
        await this.metricsCollection.aggregateMetrics('day');
        break;
      case 'cleanup':
        await this.metricsCollection.cleanupOldMetrics();
        break;
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  }
}
