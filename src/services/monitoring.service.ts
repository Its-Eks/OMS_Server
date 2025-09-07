import client from 'prom-client';

export const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_ms',
  help: 'Duration of HTTP requests in ms',
  labelNames: ['method', 'route', 'code'],
  buckets: [50, 100, 200, 300, 400, 500, 1000, 2000]
});

export function observeRequest(method: string, route: string, code: string, duration: number) {
  httpRequestDurationMicroseconds.labels(method, route, code).observe(duration);
}
