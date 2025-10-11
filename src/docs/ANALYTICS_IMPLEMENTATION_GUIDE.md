# Analytics Implementation Guide

## Quick Start

### 1. Database Setup

Run the analytics migration to create the time-series tables:

```bash
# Run the migration
npm run migrate

# Or manually execute the SQL
psql -d oms_database -f src/migrations/013_analytics_timeseries.sql
```

### 2. Start Metrics Collection

Add the metrics scheduler to your main server file:

```typescript
// In your main server file (e.g., server.ts or app.ts)
import { MetricsCollectionService } from './services/metrics-collection.service';
import { MetricsSchedulerService } from './services/metrics-scheduler.service';

// Initialize services
const metricsCollection = new MetricsCollectionService(db, redis);
const metricsScheduler = new MetricsSchedulerService(metricsCollection);

// Start automated metrics collection
metricsScheduler.start();

console.log('Analytics system initialized');
```

### 3. Test the Endpoints

```bash
# Test overall analytics
curl http://localhost:3003/analytics/overall

# Test real-time dashboard
curl http://localhost:3003/realtime/dashboard

# Test trends with date range
curl "http://localhost:3003/analytics/trends?startDate=2024-01&endDate=2024-02"
```

---

## Implementation Details

### Database Schema

The analytics system uses three main tables:

#### 1. analytics_metrics
Raw metric data points collected every 5 minutes:
```sql
-- Example data
INSERT INTO analytics_metrics (metric_name, metric_value, metric_unit) VALUES
('total_orders_24h', 15, 'count'),
('user_adoption_rate', 80.5, 'percentage'),
('avg_processing_time_24h', 2.3, 'hours');
```

#### 2. analytics_aggregates
Pre-computed metrics for different time periods:
```sql
-- Example hourly aggregate
INSERT INTO analytics_aggregates (
    metric_name, period, start_time, end_time,
    avg_value, min_value, max_value, count_value
) VALUES (
    'user_adoption_rate', 'hour', 
    '2024-01-11 10:00:00', '2024-01-11 11:00:00',
    80.5, 78.2, 82.1, 12
);
```

#### 3. daily_metrics_snapshot
Daily business metrics for long-term analysis:
```sql
-- Example daily snapshot
INSERT INTO daily_metrics_snapshot (
    snapshot_date, total_orders, completed_orders,
    avg_processing_time_hours, user_adoption_rate
) VALUES (
    '2024-01-11', 45, 38, 2.1, 80.5
);
```

### Service Architecture

```typescript
// Service dependencies
AnalyticsService
├── MetricsCollectionService (data collection)
├── CacheService (performance optimization)
└── Database (PostgreSQL)

MetricsSchedulerService
└── MetricsCollectionService (scheduled tasks)
```

### Data Flow

1. **Collection**: Metrics are collected every 5 minutes
2. **Storage**: Raw data stored in `analytics_metrics`
3. **Aggregation**: Hourly/daily aggregates created
4. **Snapshots**: Daily business metrics stored
5. **Retrieval**: Analytics service queries historical data
6. **Caching**: Results cached for performance

---

## Configuration

### Environment Variables

Add these to your `.env` file:

```env
# Analytics Configuration
ANALYTICS_ENABLED=true
METRICS_COLLECTION_INTERVAL=300000  # 5 minutes in milliseconds
CACHE_TTL_KPI=300                   # 5 minutes
CACHE_TTL_ANALYTICS=600            # 10 minutes
CACHE_TTL_REALTIME=60              # 1 minute

# Data Retention (in days)
RAW_METRICS_RETENTION=30
HOURLY_AGGREGATES_RETENTION=90
DAILY_SNAPSHOTS_RETENTION=730      # 2 years
```

### Service Configuration

```typescript
// Configure metrics collection
const metricsCollection = new MetricsCollectionService(db, redis);

// Configure scheduler with custom intervals
const scheduler = new MetricsSchedulerService(metricsCollection);

// Start with custom configuration
scheduler.start();

// Manual collection (for testing)
await metricsCollection.collectCurrentMetrics();
await metricsCollection.aggregateMetrics('day');
```

---

## Custom Metrics

### Adding Custom Metrics

Extend the `MetricsCollectionService` to collect custom metrics:

```typescript
// In metrics-collection.service.ts
private async gatherSystemMetrics(client: any): Promise<MetricDataPoint[]> {
  const metrics: MetricDataPoint[] = [];
  
  // Existing metrics...
  
  // Add custom metrics
  const customMetric = await this.getCustomMetric(client);
  metrics.push({
    metric_name: 'custom_metric',
    metric_value: customMetric.value,
    metric_unit: 'custom_unit',
    metadata: { source: 'custom_collection' }
  });
  
  return metrics;
}

private async getCustomMetric(client: any): Promise<{ value: number }> {
  const result = await client.query(`
    SELECT COUNT(*) as count 
    FROM your_custom_table 
    WHERE created_at >= NOW() - INTERVAL '24 hours'
  `);
  
  return { value: parseInt(result.rows[0].count) };
}
```

### Custom Analytics Endpoints

Create custom analytics endpoints:

```typescript
// In analytics.routes.ts
router.get('/custom-metrics', (req: Request, res: Response) => {
  if (!(req as any).analyticsController) {
    return res.status(500).json({ 
      success: false, 
      error: { message: 'Analytics controller not available' } 
    });
  }
  (req as any).analyticsController.getCustomMetrics(req, res);
});

// In analytics.controller.ts
public async getCustomMetrics(req: Request, res: Response): Promise<void> {
  try {
    const filters = this.buildFiltersFromQuery(req.query);
    const data = await this.analyticsService.getCustomMetrics(filters);
    
    res.json({
      success: true,
      data,
      filters,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: error.message }
    });
  }
}
```

---

## Performance Optimization

### Database Indexing

Ensure proper indexing for optimal performance:

```sql
-- Time-based queries
CREATE INDEX idx_analytics_metrics_name_time 
ON analytics_metrics(metric_name, timestamp);

-- Aggregation queries
CREATE INDEX idx_analytics_aggregates_name_period 
ON analytics_aggregates(metric_name, period);

-- Daily snapshots
CREATE INDEX idx_daily_snapshot_date 
ON daily_metrics_snapshot(snapshot_date);
```

### Caching Strategy

```typescript
// Cache configuration
const cacheConfig = {
  kpi: { ttl: 300 },      // 5 minutes
  analytics: { ttl: 600 }, // 10 minutes
  realtime: { ttl: 60 }    // 1 minute
};

// Cache key patterns
const cacheKeys = {
  kpi: (filters) => `analytics:kpi:${JSON.stringify(filters)}`,
  trends: (filters) => `analytics:trends:${JSON.stringify(filters)}`,
  realtime: () => 'analytics:realtime:dashboard'
};
```

### Query Optimization

```typescript
// Use pre-computed aggregates for historical data
const getHistoricalData = async (startDate: Date, endDate: Date) => {
  // Use daily snapshots for long-term trends
  if (endDate.getTime() - startDate.getTime() > 7 * 24 * 60 * 60 * 1000) {
    return await client.query(`
      SELECT * FROM daily_metrics_snapshot 
      WHERE snapshot_date BETWEEN $1 AND $2
      ORDER BY snapshot_date ASC
    `, [startDate, endDate]);
  }
  
  // Use raw metrics for short-term analysis
  return await client.query(`
    SELECT * FROM analytics_metrics 
    WHERE timestamp BETWEEN $1 AND $2
    ORDER BY timestamp ASC
  `, [startDate, endDate]);
};
```

---

## Monitoring and Maintenance

### Health Checks

```typescript
// Add health check endpoint
router.get('/analytics/health', async (req: Request, res: Response) => {
  try {
    const health = await analyticsService.getSystemHealth();
    res.json({
      success: true,
      data: {
        status: health.status,
        metrics: health.metrics,
        lastCollection: health.lastCollection,
        uptime: health.uptime
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: { message: 'Health check failed' }
    });
  }
});
```

### Data Validation

```typescript
// Validate data integrity
const validateData = async () => {
  const checks = [
    await checkMetricCompleteness(),
    await checkAggregateAccuracy(),
    await checkSnapshotConsistency()
  ];
  
  return checks.every(check => check.valid);
};

const checkMetricCompleteness = async () => {
  const result = await client.query(`
    SELECT COUNT(*) as count 
    FROM analytics_metrics 
    WHERE timestamp >= NOW() - INTERVAL '1 hour'
  `);
  
  return {
    valid: parseInt(result.rows[0].count) > 0,
    message: 'Metrics collection is working'
  };
};
```

### Cleanup Jobs

```typescript
// Automated cleanup
const cleanupOldData = async () => {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  await client.query(`
    DELETE FROM analytics_metrics 
    WHERE timestamp < $1
  `, [cutoff]);
  
  console.log('Cleaned up old metrics data');
};
```

---

## Troubleshooting

### Common Issues

#### 1. Missing Historical Data

**Problem**: Analytics endpoints return empty trend data.

**Solution**:
```bash
# Check if metrics collection is running
curl http://localhost:3003/analytics/health

# Manually trigger collection
curl -X POST http://localhost:3003/analytics/collect

# Check database for data
psql -d oms_database -c "SELECT COUNT(*) FROM analytics_metrics;"
```

#### 2. Slow Query Performance

**Problem**: Analytics queries are slow.

**Solution**:
```sql
-- Check index usage
EXPLAIN ANALYZE SELECT * FROM analytics_metrics 
WHERE metric_name = 'user_adoption_rate' 
AND timestamp >= NOW() - INTERVAL '7 days';

-- Add missing indexes
CREATE INDEX CONCURRENTLY idx_analytics_metrics_name_time 
ON analytics_metrics(metric_name, timestamp);
```

#### 3. Cache Issues

**Problem**: Stale data in analytics responses.

**Solution**:
```typescript
// Clear cache manually
await cacheService.clear('analytics:*');

// Check cache status
const cacheStatus = await cacheService.getStats();
console.log('Cache hit rate:', cacheStatus.hitRate);
```

#### 4. Database Connection Issues

**Problem**: Analytics service can't connect to database.

**Solution**:
```typescript
// Test database connection
const testConnection = async () => {
  try {
    const client = await db.connect();
    await client.query('SELECT 1');
    client.release();
    console.log('Database connection OK');
  } catch (error) {
    console.error('Database connection failed:', error);
  }
};
```

### Debug Commands

```bash
# Check recent metrics
psql -d oms_database -c "
SELECT metric_name, metric_value, timestamp 
FROM analytics_metrics 
WHERE timestamp >= NOW() - INTERVAL '1 hour' 
ORDER BY timestamp DESC LIMIT 10;"

# Check daily snapshots
psql -d oms_database -c "
SELECT snapshot_date, total_orders, user_adoption_rate 
FROM daily_metrics_snapshot 
ORDER BY snapshot_date DESC LIMIT 7;"

# Check system health
curl http://localhost:3003/realtime/dashboard | jq '.data.health'
```

---

## Testing

### Unit Tests

```typescript
// Test metrics collection
describe('MetricsCollectionService', () => {
  it('should collect current metrics', async () => {
    const metrics = await metricsCollection.collectCurrentMetrics();
    expect(metrics).toBeDefined();
  });
  
  it('should aggregate metrics correctly', async () => {
    await metricsCollection.aggregateMetrics('hour');
    const aggregates = await db.query(`
      SELECT * FROM analytics_aggregates 
      WHERE period = 'hour' 
      ORDER BY start_time DESC LIMIT 1
    `);
    expect(aggregates.rows.length).toBeGreaterThan(0);
  });
});
```

### Integration Tests

```typescript
// Test analytics endpoints
describe('Analytics API', () => {
  it('should return overall analytics', async () => {
    const response = await request(app)
      .get('/analytics/overall')
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data.orderProcessing).toBeDefined();
  });
  
  it('should return trends with date range', async () => {
    const response = await request(app)
      .get('/analytics/trends?startDate=2024-01&endDate=2024-02')
      .expect(200);
    
    expect(response.body.success).toBe(true);
    expect(response.body.data.orderTrends).toBeDefined();
  });
});
```

### Load Testing

```bash
# Test analytics endpoints under load
npm install -g artillery
artillery quick --count 100 --num 10 http://localhost:3003/analytics/overall
```

---

## Deployment

### Production Setup

1. **Database Migration**:
```bash
# Run migrations in production
NODE_ENV=production npm run migrate
```

2. **Service Configuration**:
```typescript
// Production configuration
const productionConfig = {
  metricsCollection: {
    interval: 300000, // 5 minutes
    batchSize: 1000,
    retryAttempts: 3
  },
  caching: {
    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD
    }
  }
};
```

3. **Monitoring Setup**:
```typescript
// Add monitoring
const monitoring = {
  metrics: {
    collectionInterval: 300000,
    retentionPeriod: 30 * 24 * 60 * 60 * 1000 // 30 days
  },
  alerts: {
    enabled: true,
    thresholds: {
      errorRate: 5,
      responseTime: 1000,
      memoryUsage: 90
    }
  }
};
```

### Docker Configuration

```dockerfile
# Add to Dockerfile
COPY src/migrations/ /app/migrations/
RUN npm run migrate

# Add to docker-compose.yml
services:
  analytics:
    build: .
    environment:
      - ANALYTICS_ENABLED=true
      - METRICS_COLLECTION_INTERVAL=300000
    depends_on:
      - postgres
      - redis
```

---

## Best Practices

### 1. Data Collection
- Collect metrics at regular intervals (5 minutes)
- Use batch processing for large datasets
- Implement retry logic for failed collections
- Monitor collection performance

### 2. Storage Management
- Implement data retention policies
- Use appropriate data types for metrics
- Index frequently queried columns
- Partition large tables by date

### 3. Performance
- Cache frequently accessed data
- Use pre-computed aggregates
- Optimize database queries
- Monitor query performance

### 4. Monitoring
- Set up alerts for critical metrics
- Track system health continuously
- Monitor data quality
- Implement automated testing

### 5. Security
- Validate all input parameters
- Implement rate limiting
- Use secure database connections
- Monitor for suspicious activity

---

*Last Updated: January 2025*
*Version: 1.0*
