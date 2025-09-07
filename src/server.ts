import express from 'express';
import dotenv from 'dotenv';
import chalk from 'chalk';
import cors from 'cors';
import compression from 'compression';
import authRoutes from './Routes/authRoutes.ts'; 
import ordersRoutes from './Routes/ordersRoutes.ts'; 
import { pgPool, redis, initializeFirebaseAdmin, connectMongoDB } from './Database/main.ts';
import adminRouter from './Routes/admin.routes.ts';
import { logger } from './services/logging.service.ts';
import { httpRequestDurationMicroseconds } from './services/monitoring.service.ts';
import onboardingRouter from './Routes/onboarding.routes.ts';
import escalationRouter from './Routes/escalation.routes.ts';
import { helmetConfig } from './Middleware/helmet.middleware.ts';
import { generalRateLimit, authRateLimit } from './Middleware/rate-limit.middleware.ts';
import { errorHandler, notFoundHandler } from './Middleware/error.middleware.ts';


dotenv.config();

const app = express();
const PORT = process.env.PORT;

// ---------- Utility Logger ----------
function logStatus(service: string, status: boolean, message: string = '') {
  const label = status ? chalk.green.bold('[OK]') : chalk.red.bold('[FAIL]');
  console.log(`${new Date().toISOString()} ${label} ${service}: ${message}`);
}

// ---------- Initialize Services ----------
async function initializeServices() {
  // Firebase
  try {
    await initializeFirebaseAdmin();
    logStatus('Firebase', true, 'Initialized successfully');
  } catch (err) {
    logStatus('Firebase', false, `Initialization failed: ${err}`);
  }

  // MongoDB
  try {
    await connectMongoDB();
    logStatus('MongoDB', true, 'Connected successfully');
  } catch (err: unknown) {
    logStatus('MongoDB', false, `Connection failed: ${err}`);
  }

  // Redis - Fixed connection logic
  try {
    // Set up event listeners first
    redis.on('error', (err: unknown) => {
      logStatus('Redis', false, `Client error: ${err}`);
    });
    
    redis.on('connect', () => {
      logStatus('Redis', true, 'Client connected');
    });

    redis.on('ready', () => {
      logStatus('Redis', true, 'Client ready');
    });

    redis.on('close', () => {
      logStatus('Redis', false, 'Connection closed');
    });

    // Connect if not already connected
    if (redis.status !== 'connecting' && redis.status !== 'connected' && redis.status !== 'ready') {
      await redis.connect();
      logStatus('Redis', true, 'Connected successfully');
    } else {
      logStatus('Redis', true, `Already in state: ${redis.status}`);
    }
  } catch (err: unknown) {
    logStatus('Redis', false, `Connection error: ${err}`);
  }

  // PostgreSQL
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    logStatus('PostgreSQL', true, 'Connection established');
  } catch (err) {
    logStatus('PostgreSQL', false, `Connection failed: ${err}`);
  }
}

// Initialize services
initializeServices();

// ---------- Middleware ----------
app.use(helmetConfig);
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(generalRateLimit);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(
      chalk.cyan(
        `${new Date().toISOString()} ${req.method} ${req.url} ${res.statusCode} ${duration}ms`
      )
    );
  });
  next();
});

// Attach shared db/redis/mongo to app
app.set('pgPool', pgPool);
app.set('redis', redis);

// Import mongoClient after the main import
import { mongoClient, mongodb } from './Database/main.ts';
app.set('mongoClient', mongoClient);

// Prometheus metrics middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    httpRequestDurationMicroseconds
      .labels(req.method, req.path, String(res.statusCode))
      .observe(duration);
  });
  next();
});

// Winston logging middleware
app.use((req, res, next) => {
  logger.info({
    time: new Date().toISOString(),
    method: req.method,
    url: req.url,
    ip: req.ip,
  });
  next();
});

// ---------- Improved Database Health Checks ----------
async function checkDatabaseStatus() {
  const status = {
    postgres: false,
    redis: false,
    mongo: false,
    firebase: true, // Assuming Firebase is fine if init didn't fail
  };

  // PostgreSQL check
  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    status.postgres = true;
  } catch (err) {
    // Silent fail for health check
  }

  // Redis check
  try {
    if (redis.status === 'ready') {
      await redis.ping();
      status.redis = true;
    }
  } catch (err) {
    // Silent fail for health check
  }

  // MongoDB check
  try {
    if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
      status.mongo = true;
    } else if (mongodb) {
      await mongodb.admin().ping();
      status.mongo = true;
    }
  } catch (err) {
    // Silent fail for health check
  }

  return status;
}

// Run health check every 30s
setInterval(async () => {
  const dbStatus = await checkDatabaseStatus();
  console.log(chalk.yellow('\n=== Database Health Report ==='));
  Object.entries(dbStatus).forEach(([db, ok]) =>
    logStatus(db.charAt(0).toUpperCase() + db.slice(1), ok, ok ? 'Healthy' : 'Unhealthy')
  );
  console.log(chalk.yellow('==============================\n'));
}, 30000);

// ---------- Routes ----------
app.use('/auth', authRateLimit, authRoutes);
app.use('/orders', ordersRoutes);
app.use('/admin', adminRouter);
app.use('/onboarding', onboardingRouter);
app.use('/escalation', escalationRouter);

// Health check endpoint
app.get('/health', async (req, res) => {
  const dbStatus = await checkDatabaseStatus();
  res.json({ 
    success: true, 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: dbStatus
  });
});

// Basic info endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'OMS Backend API',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

// Monitoring endpoint for Prometheus
import { register } from 'prom-client';
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.end(await register.metrics());
});

// Error handling middleware (must be last)
app.use(notFoundHandler);
app.use(errorHandler);

// ---------- Graceful Shutdown ----------
process.on('SIGTERM', async () => {
  console.log(chalk.yellow('🛑 SIGTERM received, shutting down gracefully'));
  try {
    await pgPool.end();
    await redis.quit();
    if (mongoClient) await mongoClient.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log(chalk.yellow('🛑 SIGINT received, shutting down gracefully'));
  try {
    await pgPool.end();
    await redis.quit();
    if (mongoClient) await mongoClient.close();
  } catch (err) {
    console.error('Error during shutdown:', err);
  }
  process.exit(0);
});

// ---------- Start Server ----------
app.listen(PORT, () => {
  console.log(chalk.magenta(`🚀 Server is running at http://localhost:${PORT}`));
});

export default app;