# Analytics API Reference

## Base URL
```
http://localhost:3003
```

## Authentication
All analytics endpoints are **publicly accessible** (no authentication required).

## Endpoints Overview

| Endpoint | Method | Description | Cache TTL |
|----------|--------|-------------|-----------|
| `/analytics/overall` | GET | Comprehensive KPI metrics | 5 minutes |
| `/analytics/performance` | GET | Performance analytics | 10 minutes |
| `/analytics/trends` | GET | Historical trend data | 10 minutes |
| `/analytics/forecasting` | GET | Forecasting analytics | 10 minutes |
| `/analytics/insights` | GET | AI-generated insights | 10 minutes |
| `/analytics/reports` | GET | Available reports | 1 hour |
| `/realtime/dashboard` | GET | Real-time metrics | 1 minute |

---

## Analytics Endpoints

### 1. Overall Analytics

**Endpoint:** `GET /analytics/overall`

**Description:** Returns comprehensive KPI metrics including order processing, accuracy, customer satisfaction, and system performance.

**Query Parameters:**
- `startDate` (optional): Start date filter (YYYY-MM-DD, YYYY-MM, or YYYY)
- `endDate` (optional): End date filter (YYYY-MM-DD, YYYY-MM, or YYYY)

**Example Request:**
```http
GET /analytics/overall?startDate=2024-01&endDate=2024-02
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderProcessing": {
      "averageProcessingTime": 24.5,
      "processingTimeReduction": 15.2,
      "ordersProcessedToday": 23,
      "ordersProcessedThisMonth": 456,
      "processingTimeByStatus": [
        {
          "status": "in_progress",
          "avgTime": 37.6,
          "count": 3
        }
      ],
      "processingTimeTrend": []
    },
    "orderAccuracy": {
      "accuracyRate": 94.2,
      "totalOrders": 80,
      "accurateOrders": 75,
      "inaccurateOrders": 5,
      "accuracyByOrderType": [],
      "accuracyTrend": []
    },
    "customerSatisfaction": {
      "averageSatisfactionScore": 4.3,
      "totalSurveys": 245,
      "satisfactionDistribution": [
        {
          "score": 5,
          "count": 120,
          "percentage": 49
        }
      ],
      "satisfactionTrend": [],
      "satisfactionByServiceType": []
    },
    "systemUptime": {
      "uptimePercentage": 99.95,
      "totalUptime": 719.64,
      "totalDowntime": 0.36,
      "availabilityTrend": [],
      "incidentCount": 2,
      "averageResolutionTime": 0.18
    },
    "userAdoption": {
      "totalUsers": 5,
      "activeUsers": 4,
      "adoptionRate": 80,
      "usersByRole": [
        {
          "role": "System Administrator",
          "count": 3,
          "activeCount": 2
        }
      ],
      "adoptionTrend": [],
      "featureUsage": []
    }
  },
  "filters": {
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-02-29T23:59:59.999Z"
    }
  },
  "generatedAt": "2025-01-11T14:22:38.743Z"
}
```

---

### 2. Performance Analytics

**Endpoint:** `GET /analytics/performance`

**Description:** Returns performance metrics including order volume analysis, resource utilization, and quality metrics.

**Query Parameters:**
- `startDate` (optional): Start date filter
- `endDate` (optional): End date filter

**Response:**
```json
{
  "success": true,
  "data": {
    "orderVolumeAnalysis": {
      "peakHours": [],
      "peakDays": [],
      "seasonalTrends": []
    },
    "resourceUtilization": {
      "userProductivity": [],
      "systemLoad": [],
      "databasePerformance": []
    },
    "qualityMetrics": {
      "errorRates": [],
      "slaCompliance": [],
      "dataQuality": []
    }
  },
  "filters": {},
  "generatedAt": "2025-01-11T14:24:55.230Z"
}
```

---

### 3. Trend Analytics

**Endpoint:** `GET /analytics/trends`

**Description:** Returns historical trend data including order trends, customer trends, and operational trends.

**Query Parameters:**
- `startDate` (optional): Start date filter
- `endDate` (optional): End date filter
- `granularity` (optional): Data granularity (hour, day, week, month)

**Example Request:**
```http
GET /analytics/trends?startDate=2024-01&endDate=2024-02&granularity=day
```

**Response:**
```json
{
  "success": true,
  "data": {
    "orderTrends": {
      "volumeTrend": [
        {
          "date": "2024-01-01",
          "volume": 15,
          "growth": 12.5
        }
      ],
      "statusDistribution": [
        {
          "status": "completed",
          "count": 45,
          "percentage": 56.25
        }
      ],
      "serviceTypeTrends": []
    },
    "customerTrends": {
      "acquisitionTrend": [
        {
          "date": "2024-01-01",
          "newCustomers": 0,
          "growth": 0
        }
      ],
      "retentionTrend": [
        {
          "date": "2024-01-01",
          "retentionRate": 80.0,
          "churnRate": 20.0
        }
      ],
      "satisfactionTrend": [
        {
          "date": "2024-01-01",
          "satisfaction": 4.3,
          "trend": "stable"
        }
      ]
    },
    "operationalTrends": {
      "efficiencyTrend": [
        {
          "date": "2024-01-01",
          "efficiency": 80.0,
          "improvement": 0
        }
      ],
      "costTrend": [
        {
          "date": "2024-01-01",
          "cost": 140.0,
          "change": 0
        }
      ],
      "qualityTrend": [
        {
          "date": "2024-01-01",
          "quality": 30.0,
          "improvement": 0
        }
      ]
    }
  },
  "filters": {
    "dateRange": {
      "start": "2024-01-01T00:00:00.000Z",
      "end": "2024-02-29T23:59:59.999Z"
    },
    "granularity": "day"
  },
  "generatedAt": "2025-01-11T14:25:18.137Z"
}
```

---

### 4. Forecasting Analytics

**Endpoint:** `GET /analytics/forecasting`

**Description:** Returns forecasting data including order volume forecasts and capacity planning.

**Response:**
```json
{
  "success": true,
  "data": {
    "orderVolumeForecast": [],
    "resourceDemandForecast": [],
    "revenueForecast": [],
    "capacityPlanning": {
      "currentCapacity": 1000,
      "projectedDemand": 1200,
      "recommendedCapacity": 1400,
      "timeline": "3 months"
    }
  },
  "filters": {},
  "generatedAt": "2025-01-11T14:25:43.405Z"
}
```

---

### 5. Insights Analytics

**Endpoint:** `GET /analytics/insights`

**Description:** Returns AI-generated insights, anomalies, and opportunities.

**Response:**
```json
{
  "success": true,
  "data": {
    "topInsights": [
      {
        "id": "1",
        "title": "Order Processing Efficiency Improved",
        "description": "Average order processing time has decreased by 15% this month",
        "impact": "high",
        "category": "performance",
        "confidence": 0.95,
        "actionable": true,
        "recommendations": [
          "Continue current optimization efforts",
          "Consider automation for routine tasks"
        ]
      }
    ],
    "anomalies": [],
    "opportunities": []
  },
  "filters": {},
  "generatedAt": "2025-01-11T14:26:05.976Z"
}
```

---

### 6. Reports

**Endpoint:** `GET /analytics/reports`

**Description:** Returns available report types and their metadata.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "kpi-summary",
      "name": "KPI Summary Report",
      "description": "Comprehensive overview of all key performance indicators",
      "category": "Performance",
      "format": ["csv", "pdf", "excel"],
      "lastGenerated": "2025-01-11T12:26:19.833Z",
      "nextScheduled": "2025-01-12T12:26:19.833Z"
    },
    {
      "id": "order-analytics",
      "name": "Order Analytics Report",
      "description": "Detailed analysis of order processing and fulfillment",
      "category": "Operations",
      "format": ["csv", "pdf", "excel"],
      "lastGenerated": "2025-01-11T10:26:19.834Z",
      "nextScheduled": "2025-01-12T10:26:19.834Z"
    }
  ],
  "total": 6
}
```

---

## Real-time Monitoring

### Real-time Dashboard

**Endpoint:** `GET /realtime/dashboard`

**Description:** Returns live system metrics, alerts, and health status.

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
        "timestamp": "2025-01-11T14:26:45.886Z",
        "status": "normal",
        "threshold": {
          "warning": 1,
          "critical": 5
        }
      },
      {
        "id": "throughput",
        "name": "Orders/Hour (24h)",
        "value": 0,
        "unit": "orders/hour",
        "timestamp": "2025-01-11T14:26:45.886Z",
        "status": "normal"
      },
      {
        "id": "db_connections",
        "name": "Active DB Connections",
        "value": 1,
        "unit": "connections",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 80,
          "critical": 95
        }
      },
      {
        "id": "db_response_time",
        "name": "DB Response Time",
        "value": 269,
        "unit": "ms",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 100,
          "critical": 500
        }
      },
      {
        "id": "memory_usage",
        "name": "Memory Usage",
        "value": 51.84,
        "unit": "%",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 80,
          "critical": 90
        }
      },
      {
        "id": "cpu_usage",
        "name": "CPU Usage",
        "value": 68.99,
        "unit": "%",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 80,
          "critical": 90
        }
      },
      {
        "id": "orders_today",
        "name": "Orders Created Today",
        "value": 0,
        "unit": "orders",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 50,
          "critical": 100
        }
      },
      {
        "id": "active_orders",
        "name": "Active Orders",
        "value": 17,
        "unit": "orders",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 200,
          "critical": 500
        }
      },
      {
        "id": "open_escalations",
        "name": "Open Escalations",
        "value": 14,
        "unit": "escalations",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 10,
          "critical": 25
        }
      },
      {
        "id": "avg_processing_time",
        "name": "Avg Processing Time (24h)",
        "value": 0,
        "unit": "hours",
        "timestamp": "2025-01-11T14:26:44.738Z",
        "status": "normal",
        "threshold": {
          "warning": 48,
          "critical": 72
        }
      },
      {
        "id": "active_users",
        "name": "Active Users (1h)",
        "value": 0,
        "unit": "users",
        "timestamp": "2025-01-11T14:26:41.282Z",
        "status": "normal"
      },
      {
        "id": "user_adoption",
        "name": "User Adoption Rate",
        "value": 0,
        "unit": "%",
        "timestamp": "2025-01-11T14:26:41.282Z",
        "status": "critical",
        "threshold": {
          "warning": 20,
          "critical": 10
        }
      }
    ],
    "alerts": [
      {
        "id": "db_response_time_1760192096266",
        "metricId": "db_response_time",
        "metricName": "DB Response Time",
        "severity": "critical",
        "message": "DB Response Time has exceeded critical threshold (1548 ms > 500 ms)",
        "value": 1548,
        "threshold": 500,
        "timestamp": "2025-01-11T14:14:56.266Z",
        "acknowledged": false
      }
    ],
    "health": {
      "status": "warning",
      "uptime": 99.95,
      "responseTime": 269,
      "lastCheck": "2025-01-11T14:26:45.886Z"
    }
  }
}
```

---

## Error Responses

### Standard Error Format
```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "details": "Additional error details"
  }
}
```

### Common Error Codes

| Code | Description | HTTP Status |
|------|-------------|-------------|
| `KPI_METRICS_FETCH_FAILED` | Failed to fetch KPI metrics | 500 |
| `INVALID_DATE_FORMAT` | Invalid date format provided | 400 |
| `DATABASE_CONNECTION_ERROR` | Database connection failed | 500 |
| `CACHE_ERROR` | Cache service error | 500 |
| `METRICS_COLLECTION_ERROR` | Metrics collection failed | 500 |

### Example Error Response
```json
{
  "success": false,
  "error": {
    "message": "invalid input syntax for type timestamp: \"2025-10\"",
    "code": "KPI_METRICS_FETCH_FAILED"
  }
}
```

---

## Rate Limiting

All analytics endpoints are rate-limited to prevent abuse:

- **Rate Limit**: 100 requests per minute per IP
- **Burst Limit**: 20 requests per second
- **Headers**: Rate limit information is included in response headers

```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1641234567
```

---

## Caching

### Cache TTL (Time To Live)

| Endpoint | Cache TTL | Cache Key |
|----------|-----------|-----------|
| `/analytics/overall` | 5 minutes | `analytics:overall:{filters}` |
| `/analytics/performance` | 10 minutes | `analytics:performance:{filters}` |
| `/analytics/trends` | 10 minutes | `analytics:trends:{filters}` |
| `/analytics/forecasting` | 10 minutes | `analytics:forecasting:{filters}` |
| `/analytics/insights` | 10 minutes | `analytics:insights:{filters}` |
| `/analytics/reports` | 1 hour | `analytics:reports` |
| `/realtime/dashboard` | 1 minute | `realtime:dashboard` |

### Cache Invalidation

Cache is automatically invalidated when:
- New metrics are collected
- Data retention cleanup runs
- Manual cache clear is triggered

---

## Data Formats

### Date Formats Supported

| Format | Example | Description |
|--------|---------|-------------|
| `YYYY-MM-DD` | `2024-01-15` | Full date |
| `YYYY-MM` | `2024-01` | Month |
| `YYYY` | `2024` | Year |

### Time Zone

All timestamps are in UTC format with timezone information:
```
2025-01-11T14:26:45.886Z
```

---

## Integration Examples

### JavaScript/TypeScript

```javascript
// Fetch overall analytics
async function getAnalytics() {
  try {
    const response = await fetch('/analytics/overall');
    const data = await response.json();
    
    if (data.success) {
      console.log('Order Processing:', data.data.orderProcessing);
      console.log('User Adoption:', data.data.userAdoption);
    } else {
      console.error('Error:', data.error.message);
    }
  } catch (error) {
    console.error('Network error:', error);
  }
}

// Get trends with date range
async function getTrends(startDate, endDate) {
  const url = `/analytics/trends?startDate=${startDate}&endDate=${endDate}`;
  const response = await fetch(url);
  return await response.json();
}

// Real-time monitoring
async function getRealtimeMetrics() {
  const response = await fetch('/realtime/dashboard');
  const data = await response.json();
  
  if (data.success) {
    data.data.metrics.forEach(metric => {
      console.log(`${metric.name}: ${metric.value} ${metric.unit}`);
    });
  }
}
```

### cURL Examples

```bash
# Get overall analytics
curl -X GET "http://localhost:3003/analytics/overall"

# Get trends for January 2024
curl -X GET "http://localhost:3003/analytics/trends?startDate=2024-01&endDate=2024-01"

# Get real-time dashboard
curl -X GET "http://localhost:3003/realtime/dashboard"

# Get performance analytics
curl -X GET "http://localhost:3003/analytics/performance"
```

### Python Example

```python
import requests
import json

# Base URL
base_url = "http://localhost:3003"

# Get overall analytics
def get_analytics():
    response = requests.get(f"{base_url}/analytics/overall")
    return response.json()

# Get trends with date range
def get_trends(start_date, end_date):
    params = {
        'startDate': start_date,
        'endDate': end_date
    }
    response = requests.get(f"{base_url}/analytics/trends", params=params)
    return response.json()

# Get real-time metrics
def get_realtime():
    response = requests.get(f"{base_url}/realtime/dashboard")
    return response.json()

# Example usage
analytics = get_analytics()
print(f"Orders processed today: {analytics['data']['orderProcessing']['ordersProcessedToday']}")

trends = get_trends('2024-01', '2024-02')
print(f"Volume trend: {trends['data']['orderTrends']['volumeTrend']}")
```

---

*Last Updated: January 2025*
*Version: 1.0*
