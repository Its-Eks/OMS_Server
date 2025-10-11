# Analytics System Documentation

## Overview

The OMS Analytics System provides comprehensive business intelligence and performance monitoring capabilities through a time-series database architecture. The system collects, stores, and analyzes historical data to provide insights into order processing, user adoption, system performance, and business metrics.

## Architecture

### Time-Series Database Design

The analytics system uses a three-tier data storage approach:

1. **Raw Metrics** (`analytics_metrics`) - 30-day retention
2. **Aggregated Data** (`analytics_aggregates`) - 90 days hourly, 2 years daily
3. **Daily Snapshots** (`daily_metrics_snapshot`) - 2-year retention

### Core Components

- **MetricsCollectionService** - Data collection and storage
- **MetricsSchedulerService** - Automated data collection scheduling
- **AnalyticsService** - Business intelligence and reporting
- **Time-Series Database** - Historical data storage

## Database Schema

### analytics_metrics
Raw metric data points with timestamps for detailed analysis.

```sql
CREATE TABLE analytics_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,6) NOT NULL,
    metric_unit VARCHAR(20),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

**Key Metrics Collected:**
- `total_orders_24h` - Orders created in last 24 hours
- `completed_orders_24h` - Orders completed in last 24 hours
- `user_adoption_rate` - Percentage of active users
- `escalation_resolution_rate` - Percentage of resolved escalations
- `avg_processing_time_24h` - Average order processing time

### analytics_aggregates
Pre-computed metrics for different time periods to optimize query performance.

```sql
CREATE TABLE analytics_aggregates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    period VARCHAR(20) NOT NULL, -- 'hour', 'day', 'week', 'month'
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    avg_value DECIMAL(15,6),
    min_value DECIMAL(15,6),
    max_value DECIMAL(15,6),
    sum_value DECIMAL(15,6),
    count_value INTEGER DEFAULT 0,
    metadata JSONB
);
```

### daily_metrics_snapshot
Daily business metrics for long-term trend analysis.

```sql
CREATE TABLE daily_metrics_snapshot (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_date DATE NOT NULL,
    total_orders INTEGER DEFAULT 0,
    completed_orders INTEGER DEFAULT 0,
    cancelled_orders INTEGER DEFAULT 0,
    avg_processing_time_hours DECIMAL(8,2),
    escalation_count INTEGER DEFAULT 0,
    resolved_escalations INTEGER DEFAULT 0,
    user_adoption_rate DECIMAL(5,2),
    system_uptime_percentage DECIMAL(5,2),
    customer_satisfaction_score DECIMAL(3,2),
    fno_tracking_accuracy DECIMAL(5,2),
    total_revenue DECIMAL(12,2),
    metadata JSONB
);
```

## API Endpoints

### Analytics Endpoints (No Authentication Required)

#### 1. Overall Analytics
```http
GET /analytics/overall
```
Returns comprehensive KPI metrics including order processing, accuracy, customer satisfaction, and system performance.

**Response:**
```json
{
  "success": true,
  "data": {
    "orderProcessing": {
      "averageProcessingTime": 24.5,
      "processingTimeReduction": 15.2,
      "ordersProcessedToday": 23,
      "ordersProcessedThisMonth": 456
    },
    "orderAccuracy": {
      "accuracyRate": 94.2,
      "totalOrders": 80,
      "accurateOrders": 75
    },
    "userAdoption": {
      "totalUsers": 5,
      "activeUsers": 4,
      "adoptionRate": 80
    }
  }
}
```

#### 2. Performance Analytics
```http
GET /analytics/performance
```
Returns performance metrics including order volume analysis, resource utilization, and quality metrics.

#### 3. Trend Analytics
```http
GET /analytics/trends
```
Returns historical trend data including order trends, customer trends, and operational trends.

**Query Parameters:**
- `startDate` - Start date (YYYY-MM-DD, YYYY-MM, or YYYY)
- `endDate` - End date (YYYY-MM-DD, YYYY-MM, or YYYY)
- `granularity` - Data granularity (hour, day, week, month)

#### 4. Forecasting Analytics
```http
GET /analytics/forecasting
```
Returns forecasting data including order volume forecasts and capacity planning.

#### 5. Insights Analytics
```http
GET /analytics/insights
```
Returns AI-generated insights, anomalies, and opportunities.

#### 6. Reports
```http
GET /analytics/reports
```
Returns available report types and their metadata.

### Real-time Monitoring

#### Real-time Dashboard
```http
GET /realtime/dashboard
```
Returns live system metrics, alerts, and health status.

**Response:**
```json
{
  "success": true,
  "data": {
    "metrics": [
      {
        "id": "error_rate",
        "name": "Error Rate (24h)",
        "value": 0.2,
        "unit": "%",
        "status": "normal"
      }
    ],
    "alerts": [
      {
        "id": "db_response_time_123",
        "severity": "warning",
        "message": "DB Response Time has exceeded warning threshold",
        "value": 227,
        "threshold": 100
      }
    ],
    "health": {
      "status": "critical",
      "uptime": 99.95,
      "responseTime": 200
    }
  }
}
```

## Data Collection

### Automated Collection Schedule

The system automatically collects metrics on the following schedule:

- **Every 5 minutes**: Current system metrics
- **Every hour**: Aggregate hourly data
- **Daily**: Aggregate daily data and cleanup old data
- **Data retention**: 30 days raw, 90 days hourly, 2 years daily

### Manual Collection

You can manually trigger metric collection:

```typescript
// Collect current metrics
await metricsCollection.collectCurrentMetrics();

// Aggregate for specific period
await metricsCollection.aggregateMetrics('day');

// Clean up old data
await metricsCollection.cleanupOldMetrics();
```

## Historical Data Queries

### Get Historical Metrics

```typescript
// Get raw metrics for a specific time range
const metrics = await metricsCollection.getHistoricalMetrics(
  'user_adoption_rate',
  new Date('2024-01-01'),
  new Date('2024-01-31'),
  'day'
);
```

### Trend Analysis

The system provides built-in trend analysis through database views:

```sql
-- Get daily metrics with growth trends
SELECT * FROM daily_metrics_with_trends 
WHERE snapshot_date >= '2024-01-01' 
ORDER BY snapshot_date DESC;

-- Get recent metrics
SELECT * FROM recent_metrics 
WHERE metric_name = 'user_adoption_rate';
```

## Key Performance Indicators (KPIs)

### Order Processing Metrics
- **Average Processing Time**: Time from order creation to completion
- **Processing Time Reduction**: Percentage improvement over time
- **Orders Processed**: Daily and monthly order counts
- **Processing Time by Status**: Breakdown by order status

### Order Accuracy Metrics
- **Accuracy Rate**: Percentage of accurate orders
- **Total Orders**: Total order count
- **Accurate/Inaccurate Orders**: Count breakdown
- **Accuracy by Order Type**: Performance by service type

### Customer Satisfaction Metrics
- **Average Satisfaction Score**: 1-5 scale rating
- **Total Surveys**: Number of customer surveys
- **Satisfaction Distribution**: Score breakdown
- **Satisfaction by Service Type**: Performance by service

### System Performance Metrics
- **Uptime Percentage**: System availability
- **Response Time**: API response times
- **Error Rate**: System error percentage
- **Resource Utilization**: CPU, memory, database usage

### User Adoption Metrics
- **Total Users**: Active user count
- **Adoption Rate**: Percentage of active users
- **Users by Role**: Breakdown by user roles
- **Feature Usage**: Feature adoption rates

## Data Retention Policies

### Raw Metrics (analytics_metrics)
- **Retention**: 30 days
- **Cleanup**: Daily at 2 AM
- **Purpose**: Detailed analysis and debugging

### Hourly Aggregates (analytics_aggregates)
- **Retention**: 90 days
- **Cleanup**: Daily at 2 AM
- **Purpose**: Hourly trend analysis

### Daily Snapshots (daily_metrics_snapshot)
- **Retention**: 2 years
- **Cleanup**: Monthly
- **Purpose**: Long-term business intelligence

## Monitoring and Alerts

### System Health Monitoring
- **Database Response Time**: Warning at 100ms, Critical at 500ms
- **Memory Usage**: Warning at 80%, Critical at 90%
- **CPU Usage**: Warning at 80%, Critical at 90%
- **Active Connections**: Warning at 80, Critical at 95

### Business Metrics Alerts
- **Open Escalations**: Warning at 10, Critical at 25
- **Order Processing Time**: Warning at 48 hours, Critical at 72 hours
- **User Adoption Rate**: Warning below 20%, Critical below 10%

### Alert Management
- **Acknowledgment**: Alerts can be acknowledged to prevent spam
- **Severity Levels**: Info, Warning, Critical
- **Historical Tracking**: All alerts are stored with timestamps

## Integration Guide

### Frontend Integration

```javascript
// Fetch overall analytics
const response = await fetch('/analytics/overall');
const data = await response.json();

// Fetch trends with date range
const trends = await fetch('/analytics/trends?startDate=2024-01&endDate=2024-02');
const trendData = await trends.json();

// Fetch real-time metrics
const realtime = await fetch('/realtime/dashboard');
const metrics = await realtime.json();
```

### Backend Integration

```typescript
import { AnalyticsService } from './services/analytics.service';
import { MetricsCollectionService } from './services/metrics-collection.service';

// Initialize services
const analyticsService = new AnalyticsService(db, redis);
const metricsCollection = new MetricsCollectionService(db, redis);

// Get KPI metrics
const kpiMetrics = await analyticsService.getKPIMetrics({
  dateRange: {
    start: '2024-01-01',
    end: '2024-01-31'
  }
});

// Collect current metrics
await metricsCollection.collectCurrentMetrics();
```

## Performance Optimization

### Caching Strategy
- **KPI Metrics**: 5-minute cache
- **Advanced Analytics**: 10-minute cache
- **Real-time Metrics**: 1-minute cache
- **Historical Data**: No cache (always fresh)

### Database Indexing
- **Time-based queries**: Indexed on timestamp columns
- **Metric queries**: Indexed on metric_name and timestamp
- **Aggregate queries**: Indexed on period and time ranges

### Query Optimization
- **Pre-computed aggregates**: Reduces query time for historical data
- **Materialized views**: For complex trend calculations
- **Connection pooling**: Efficient database connections

## Troubleshooting

### Common Issues

1. **Missing Historical Data**
   - Ensure metrics collection is running
   - Check database migration status
   - Verify scheduler service is active

2. **Slow Query Performance**
   - Check database indexes
   - Review query execution plans
   - Consider data retention cleanup

3. **Alert Spam**
   - Acknowledge resolved alerts
   - Adjust threshold values
   - Review alert conditions

### Debugging Tools

```sql
-- Check recent metrics collection
SELECT * FROM analytics_metrics 
WHERE timestamp >= NOW() - INTERVAL '1 hour' 
ORDER BY timestamp DESC;

-- Verify daily snapshots
SELECT * FROM daily_metrics_snapshot 
ORDER BY snapshot_date DESC LIMIT 7;

-- Check system health
SELECT * FROM recent_metrics 
WHERE metric_name IN ('db_response_time', 'memory_usage', 'cpu_usage');
```

## Future Enhancements

### Planned Features
- **Machine Learning**: Predictive analytics and forecasting
- **Custom Dashboards**: User-configurable analytics views
- **Data Export**: CSV/Excel export capabilities
- **Advanced Filtering**: Multi-dimensional data filtering
- **Real-time Streaming**: WebSocket-based live updates

### Scalability Considerations
- **Horizontal Scaling**: Multiple analytics workers
- **Data Partitioning**: Time-based table partitioning
- **Load Balancing**: Distributed metrics collection
- **Cloud Integration**: AWS/Azure analytics services

## Security Considerations

### Data Privacy
- **No PII Storage**: Analytics data excludes personal information
- **Data Anonymization**: User data is aggregated and anonymized
- **Access Control**: Analytics endpoints are public but rate-limited

### Performance Impact
- **Minimal Overhead**: Metrics collection has minimal system impact
- **Asynchronous Processing**: Non-blocking data collection
- **Resource Management**: Automatic cleanup and optimization

## Support and Maintenance

### Regular Maintenance Tasks
- **Database Cleanup**: Automated daily cleanup
- **Index Optimization**: Monthly index maintenance
- **Performance Monitoring**: Continuous system monitoring
- **Data Validation**: Regular data integrity checks

### Monitoring Commands
```bash
# Check metrics collection status
curl http://localhost:3003/analytics/overall

# Verify real-time monitoring
curl http://localhost:3003/realtime/dashboard

# Test trend analysis
curl "http://localhost:3003/analytics/trends?startDate=2024-01&endDate=2024-02"
```

---

*Last Updated: January 2025*
*Version: 1.0*
