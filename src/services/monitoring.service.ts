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

// Minimal cron-like processor for notifications (every 60s)
let notifInterval: NodeJS.Timeout | null = null;
export async function startNotificationCron(app: any) {
  if (notifInterval) return;
  notifInterval = setInterval(async () => {
    try {
      const mongoClient = app.get('mongoClient');
      if (!mongoClient) return;
      const { NotificationService } = await import('./notification.service.ts');
      const svc = new NotificationService(mongoClient);
      await svc.ensureIndexes();
      await svc.ensureDefaultRules();
      await svc.processEventsOnce();
    } catch {}
  }, 60000);
}