import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';
import cors from 'cors';
import compression from 'compression';
import authRoutes from './Routes/authRoutes.ts'; 
import ordersRoutes from './Routes/ordersRoutes.ts'; 
import { pgPool, redis, initializeFirebaseAdmin, connectMongoDB } from './Database/main.ts';
import adminRouter from './Routes/admin.routes.ts';
import rolesRouter from './Routes/roles.routes.ts';
import userManagementRouter from './Routes/user-management.routes.ts';
import applicationAdminRouter from './Routes/application-admin.routes.ts';
import { logger } from './services/logging.service.ts';
import { httpRequestDurationMicroseconds, startNotificationCron } from './services/monitoring.service.ts';
import onboardingRouter from './Routes/onboarding.routes.ts';
import escalationRouter from './Routes/escalation.routes.ts';
import emailRouter from './Routes/email.routes.ts';
import fnoRouter from './Routes/fno.routes.ts';
import workflowRouter from './Routes/workflow.routes.ts';
import abTestingRouter from './Routes/ab-testing.routes.ts';
import workflowTemplatesRouter from './Routes/workflow-templates.routes.ts';
import { helmetConfig } from './Middleware/helmet.middleware.ts';
import { generalRateLimit, authRateLimit } from './Middleware/rate-limit.middleware.ts';
import { errorHandler, notFoundHandler } from './Middleware/error.middleware.ts';
import { register } from 'prom-client';
import { mongoClient, mongodb } from './Database/main.ts';
import customerRouter from './Routes/customer-hybrid.routes.ts';
import dashboardRouter from './Routes/dashboard.routes.ts'; 

dotenv.config();

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  latency?: number;
  details?: string;
  lastCheck: Date;
}

interface ServerState {
  isReady: boolean;
  startTime: Date;
  services: Record<string, ServiceHealth>;
  metrics: {
    totalRequests: number;
    activeConnections: number;
  };
}

class RobustServer {
  private app: express.Application;
  private server: any;
  private readonly port: number;
  private state: ServerState;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private readonly maxStartupTime = 30000; // 30 seconds

  constructor() {
    this.app = express();
    this.port = parseInt(process.env.PORT || '3003');
    this.state = {
      isReady: false,
      startTime: new Date(),
      services: {},
      metrics: { totalRequests: 0, activeConnections: 0 }
    };
  }

  private log(level: 'info' | 'success' | 'error' | 'warn', service: string, message: string, latency?: number) {
    const timestamp = new Date().toISOString();
    const colors = {
      info: chalk.blue,
      success: chalk.green,
      error: chalk.red,
      warn: chalk.yellow
    };
    
    const prefix = {
      info: '[INFO]',
      success: '[✓]',
      error: '[✗]', 
      warn: '[⚠]'
    }[level];

    const latencyStr = latency !== undefined ? chalk.gray(`(${latency}ms)`) : '';
    console.log(`${chalk.gray(timestamp)} ${colors[level].bold(prefix)} ${chalk.white.bold(service)}: ${message} ${latencyStr}`);
  }

  private async checkService(name: string, checkFn: () => Promise<void>): Promise<ServiceHealth> {
    const start = Date.now();
    try {
      await checkFn();
      const latency = Date.now() - start;
      const health: ServiceHealth = {
        name,
        status: latency > 1000 ? 'degraded' : 'healthy',
        latency,
        lastCheck: new Date()
      };
      
      if (latency > 1000) {
        health.details = 'High latency detected';
      }
      
      return health;
    } catch (error) {
      return {
        name,
        status: 'unhealthy',
        latency: Date.now() - start,
        details: error instanceof Error ? error.message : 'Unknown error',
        lastCheck: new Date()
      };
    }
  }

  private async initializeServices(): Promise<void> {
    this.log('info', 'System', 'Initializing services...');
    const initPromises = [];

    // Firebase
    initPromises.push(
      this.checkService('Firebase', async () => {
        await initializeFirebaseAdmin();
      }).then(health => {
        this.state.services.firebase = health;
        this.log(health.status === 'healthy' ? 'success' : 'error', 'Firebase', 
          health.status === 'healthy' ? 'Ready' : health.details || 'Failed', health.latency);
      })
    );

    // MongoDB
    initPromises.push(
      this.checkService('MongoDB', async () => {
        await connectMongoDB();
      }).then(health => {
        this.state.services.mongodb = health;
        // Refresh app references after a successful connect
        try {
          this.app.set('mongoClient', mongoClient);
          this.app.set('mongodb', mongodb);
        } catch {}
        this.log(health.status === 'healthy' ? 'success' : 'error', 'MongoDB', 
          health.status === 'healthy' ? 'Connected' : health.details || 'Failed', health.latency);
      })
    );

    // Redis
    initPromises.push(
      this.checkService('Redis', async () => {
        const r: any = redis as any;
        if (r.status !== 'ready') {
          await r.connect();
        }
        await r.ping();
      }).then(health => {
        this.state.services.redis = health;
        this.log(health.status === 'healthy' ? 'success' : 'error', 'Redis', 
          health.status === 'healthy' ? 'Ready' : health.details || 'Failed', health.latency);
      })
    );

    // PostgreSQL
    initPromises.push(
      this.checkService('PostgreSQL', async () => {
        const client = await pgPool.connect();
        await client.query('SELECT 1');
        client.release();
      }).then(health => {
        this.state.services.postgresql = health;
        this.log(health.status === 'healthy' ? 'success' : 'error', 'PostgreSQL', 
          health.status === 'healthy' ? 'Connected' : health.details || 'Failed', health.latency);
      })
    );

    await Promise.allSettled(initPromises);
    
    const healthyServices = Object.values(this.state.services).filter(s => s.status === 'healthy').length;
    const totalServices = Object.keys(this.state.services).length;
    
    if (healthyServices === totalServices) {
      this.log('success', 'System', `All ${totalServices} services initialized successfully`);
    } else {
      this.log('warn', 'System', `${healthyServices}/${totalServices} services healthy`);
    }
  }

  private setupMiddleware(): void {
    // Security and performance
    this.app.use(helmetConfig);
    const allowedOrigins = (process.env.CORS_ORIGIN?.split(',').filter(Boolean) || []).concat([
      'http://localhost:5173',
      'http://127.0.0.1:5173'
    ]);
    this.app.use(cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) return callback(null, true);
        if (origin.endsWith('.onrender.com')) return callback(null, true);
        return callback(null, false);
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      credentials: false,
      maxAge: 86400,
      optionsSuccessStatus: 204
    }));
    this.app.options('*', cors());
    this.app.use(compression());
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true }));
    this.app.use(generalRateLimit);

    // Request tracking
    this.app.use((req, res, next) => {
      this.state.metrics.totalRequests++;
      this.state.metrics.activeConnections++;
      
      const start = Date.now();
      res.on('finish', () => {
        this.state.metrics.activeConnections--;
        const duration = Date.now() - start;
        
        // Prometheus metrics
        httpRequestDurationMicroseconds
          .labels(req.method, req.path, String(res.statusCode))
          .observe(duration);

        // Winston logging
        logger.info({
          time: new Date().toISOString(),
          method: req.method,
          url: req.url,
          status: res.statusCode,
          duration,
          ip: req.ip,
        });
      });
      next();
    });

    // Database connections
    this.app.set('pgPool', pgPool);
    this.app.set('redis', redis);
    this.app.set('mongoClient', mongoClient);
  }

  private async setupRoutes(): Promise<void> {
    // API Routes
    this.app.use('/auth', authRateLimit, authRoutes);
    this.app.use('/orders', ordersRoutes);
    this.app.use('/admin', adminRouter);
    this.app.use('/admin/roles', rolesRouter);
    this.app.use('/user-management', userManagementRouter);
    this.app.use('/application-admin', applicationAdminRouter);
    this.app.use('/onboarding', onboardingRouter);
    this.app.use('/escalation', escalationRouter);
    this.app.use('/dashboard', dashboardRouter);
    // FNO routes
    try {
      const fnoRouter = (await import('./Routes/fno.routes.ts')).default;
      this.app.use('/fno', fnoRouter);
    } catch (e) {
      this.log('warn', 'Routes', 'FNO routes not available');
    }
    this.app.use('/email', emailRouter);
    this.app.use('/fnos', fnoRouter);
    this.app.use('/workflow', workflowRouter);
    this.app.use('/ab-testing', abTestingRouter);
    this.app.use('/workflow-templates', workflowTemplatesRouter);
    this.app.use('/customers', customerRouter);
    // Notifications
    try {
      const notifRouter = (await import('./Routes/notifications.routes.ts')).default;
      this.app.use('/notifications', notifRouter);
    } catch {}

    // Dashboard
    try {
      const dashboardRouter = (await import('./Routes/dashboard.routes.ts')).default;
      this.app.use('/dashboard', dashboardRouter);
    } catch (e) {
      this.log('warn', 'Routes', 'Dashboard routes not available');
    }

    // Health endpoints
    this.app.get('/health', async (req, res) => {
      const overallHealth = Object.values(this.state.services).every(s => s.status === 'healthy');
      res.status(overallHealth ? 200 : 503).json({
        status: overallHealth ? 'healthy' : 'degraded',
        ready: this.state.isReady,
        uptime: Math.floor((Date.now() - this.state.startTime.getTime()) / 1000),
        services: this.state.services,
        metrics: this.state.metrics,
        timestamp: new Date().toISOString()
      });
    });

    this.app.get('/ready', (req, res) => {
      res.status(this.state.isReady ? 200 : 503).json({
        ready: this.state.isReady,
        message: this.state.isReady ? 'Server is ready' : 'Server is starting up'
      });
    });

    // Info endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'OMS Backend API',
        version: '1.0.0',
        status: this.state.isReady ? 'ready' : 'starting',
        uptime: Math.floor((Date.now() - this.state.startTime.getTime()) / 1000),
        endpoint: `http://localhost:${this.port}`,
        timestamp: new Date().toISOString()
      });
    });

    // Metrics endpoint
    this.app.get('/metrics', async (req, res) => {
      res.set('Content-Type', 'text/plain');
      res.end(await register.metrics());
    });

    // Error handling
    this.app.use(notFoundHandler);
    this.app.use(errorHandler);
  }

  private startHealthMonitoring(): void {
    this.healthCheckInterval = setInterval(async () => {
      const checks = await Promise.allSettled([
        this.checkService('PostgreSQL', async () => {
          const client = await pgPool.connect();
          await client.query('SELECT 1');
          client.release();
        }),
        this.checkService('Redis', async () => {
          const r: any = redis as any;
          await r.ping();
        }),
        this.checkService('MongoDB', async () => {
          if (mongodb) {
            await mongodb.admin().ping();
          } else {
            throw new Error('MongoDB not connected');
          }
        })
      ]);

      checks.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const names = ['postgresql', 'redis', 'mongodb'] as const;
          const serviceName = names[index] ?? 'unknown';
          this.state.services[serviceName] = result.value;
        }
      });

      const healthyCount = Object.values(this.state.services).filter(s => s.status === 'healthy').length;
      const totalCount = Object.keys(this.state.services).length;
      
      if (healthyCount < totalCount) {
        this.log('warn', 'HealthCheck', `${healthyCount}/${totalCount} services healthy`);
      }
    }, 15000); // Check every 15 seconds
  }

  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      this.log('warn', 'System', `${signal} received, shutting down gracefully...`);
      
      if (this.healthCheckInterval) clearInterval(this.healthCheckInterval);
      
      if (this.server) {
        this.server.close(() => {
          this.log('info', 'System', 'HTTP server closed');
        });
      }

      try {
        await Promise.allSettled([
          pgPool.end(),
          redis.quit(),
          mongoClient?.close()
        ]);
        this.log('success', 'System', 'All connections closed successfully');
      } catch (error) {
        this.log('error', 'System', `Error during shutdown: ${error}`);
      }
      
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  public async start(): Promise<void> {
    console.log(chalk.cyan.bold('\n🚀 OMS Backend Server Starting...\n'));
    
    const startupTimeout = setTimeout(() => {
      this.log('error', 'System', 'Startup timeout exceeded');
      process.exit(1);
    }, this.maxStartupTime);

    try {
      this.setupMiddleware();
      this.setupRoutes();
      this.setupGracefulShutdown();
      
      await this.initializeServices();
      
      this.server = this.app.listen(this.port, async () => {
        clearTimeout(startupTimeout);
        this.state.isReady = true;
        
        console.log(chalk.green.bold('\n✅ SERVER READY\n'));
        this.log('success', 'HTTP Server', `Listening on port ${this.port}`);
        this.log('info', 'Endpoints', `http://localhost:${this.port}`);
        this.log('info', 'Health Check', `http://localhost:${this.port}/health`);
        this.log('info', 'Metrics', `http://localhost:${this.port}/metrics`);
        
        const bootTime = Date.now() - this.state.startTime.getTime();
        this.log('success', 'System', `Ready in ${bootTime}ms`);
        
        this.startHealthMonitoring();

        // Initialize WebSocket server
        try {
          const { SocketService } = await import('./services/socket.service.ts');
          SocketService.init(this.server);
        } catch {}

        // Start background notification processor
        try { startNotificationCron(this.app); } catch {}
      });

    } catch (error) {
      clearTimeout(startupTimeout);
      this.log('error', 'System', `Failed to start: ${error}`);
      process.exit(1);
    }
  }
}

// Start the server
const server = new RobustServer();
server.start().catch(error => {
  console.error(chalk.red.bold('Failed to start server:'), error);
  process.exit(1);
});

export default server;
