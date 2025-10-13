-- Analytics Time-Series Database Schema
-- This migration creates time-series tables for historical analytics data

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Time-series metrics table for raw metric data points
CREATE TABLE IF NOT EXISTS analytics_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    metric_value DECIMAL(15,6) NOT NULL,
    metric_unit VARCHAR(20),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Aggregated metrics table for pre-computed time periods
CREATE TABLE IF NOT EXISTS analytics_aggregates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_name VARCHAR(100) NOT NULL,
    period VARCHAR(20) NOT NULL, -- 'hour', 'day', 'week', 'month', 'quarter', 'year'
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    avg_value DECIMAL(15,6),
    min_value DECIMAL(15,6),
    max_value DECIMAL(15,6),
    sum_value DECIMAL(15,6),
    count_value INTEGER DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Daily snapshots for key business metrics
CREATE TABLE IF NOT EXISTS daily_metrics_snapshot (
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
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(snapshot_date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_analytics_metrics_name_time ON analytics_metrics(metric_name, timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_metrics_timestamp ON analytics_metrics(timestamp);
CREATE INDEX IF NOT EXISTS idx_analytics_aggregates_name_period ON analytics_aggregates(metric_name, period);
CREATE INDEX IF NOT EXISTS idx_analytics_aggregates_time_range ON analytics_aggregates(start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_daily_snapshot_date ON daily_metrics_snapshot(snapshot_date);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for analytics_aggregates updated_at
CREATE TRIGGER update_analytics_aggregates_updated_at 
    BEFORE UPDATE ON analytics_aggregates 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert initial metric definitions
INSERT INTO analytics_metrics (metric_name, metric_value, metric_unit, metadata) VALUES
('system_uptime', 99.95, 'percentage', '{"description": "System uptime percentage"}'),
('db_response_time', 200, 'milliseconds', '{"description": "Database response time"}'),
('memory_usage', 52.5, 'percentage', '{"description": "Memory usage percentage"}'),
('cpu_usage', 68.9, 'percentage', '{"description": "CPU usage percentage"}'),
('active_orders', 17, 'count', '{"description": "Number of active orders"}'),
('open_escalations', 14, 'count', '{"description": "Number of open escalations"}'),
('user_adoption_rate', 80.0, 'percentage', '{"description": "User adoption rate"}'),
('order_accuracy_rate', 0.0, 'percentage', '{"description": "Order accuracy rate"}'),
('escalation_resolution_rate', 22.22, 'percentage', '{"description": "Escalation resolution rate"}'),
('fno_tracking_accuracy', 100.0, 'percentage', '{"description": "FNO reference tracking accuracy"}')
ON CONFLICT DO NOTHING;

-- Create a view for easy querying of recent metrics
CREATE OR REPLACE VIEW recent_metrics AS
SELECT 
    metric_name,
    metric_value,
    metric_unit,
    timestamp,
    metadata
FROM analytics_metrics 
WHERE timestamp >= NOW() - INTERVAL '24 hours'
ORDER BY timestamp DESC;

-- Create a view for daily snapshots with trends
CREATE OR REPLACE VIEW daily_metrics_with_trends AS
SELECT 
    *,
    LAG(total_orders) OVER (ORDER BY snapshot_date) as prev_total_orders,
    LAG(completed_orders) OVER (ORDER BY snapshot_date) as prev_completed_orders,
    LAG(avg_processing_time_hours) OVER (ORDER BY snapshot_date) as prev_avg_processing_time,
    CASE 
        WHEN LAG(total_orders) OVER (ORDER BY snapshot_date) > 0 
        THEN ((total_orders - LAG(total_orders) OVER (ORDER BY snapshot_date))::DECIMAL / LAG(total_orders) OVER (ORDER BY snapshot_date)) * 100
        ELSE 0 
    END as order_growth_percentage
FROM daily_metrics_snapshot
ORDER BY snapshot_date DESC;
