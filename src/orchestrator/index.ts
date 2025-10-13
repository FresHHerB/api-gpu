// ============================================
// Orchestrator Entry Point (VPS/Easypanel)
// ============================================

import express from 'express';
import path from 'path';
import { mkdir } from 'fs/promises';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from '../shared/utils/logger';

// Carregar variáveis de ambiente
dotenv.config();

// Importar rotas
import videoProxyRoutes, { setJobService as setVideoJobService } from './routes/videoProxy';
import transcriptionRoutes from './routes/transcription';
import captionUnifiedRoutes, { setJobService as setCaptionJobService } from './routes/caption-unified.routes';
import jobRoutes, { setJobService } from './routes/jobs.routes';

// Importar cleanup scheduler
import { startCleanupScheduler } from './utils/cleanup';

// Importar queue system
import { createQueueSystem, QueueSystem } from './utils/queueFactory';
import { RunPodService } from './services/runpodService';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'output');

// ============================================
// Initialize Queue System
// ============================================

let queueSystem: QueueSystem;

async function initializeQueueSystem() {
  try {
    // Initialize RunPodService
    const runpodService = new RunPodService();

    // Create queue system
    queueSystem = createQueueSystem(runpodService);

    // Inject JobService into all routes
    setJobService(queueSystem.jobService);
    setVideoJobService(queueSystem.jobService);
    setCaptionJobService(queueSystem.jobService);

    // Start queue system
    queueSystem.start();

    logger.info('✅ Queue System started successfully');
  } catch (error) {
    logger.error('Failed to initialize Queue System', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    throw error;
  }
}

// ============================================
// Ensure output directory exists
// ============================================

async function ensureOutputDirectory() {
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    logger.info('📂 Output directory ready', { path: OUTPUT_DIR });
  } catch (error) {
    logger.error('Failed to create output directory', {
      error: error instanceof Error ? error.message : 'Unknown error',
      path: OUTPUT_DIR
    });
  }
}

// ============================================
// Middlewares
// ============================================

app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ALLOW_ORIGINS?.split(',') || '*'
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging
app.use((req, _res, next) => {
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip
  });
  next();
});

// ============================================
// Health Check
// ============================================

app.get('/health', async (_req, res) => {
  try {
    const queueStats = queueSystem ? await queueSystem.jobService.getQueueStats() : null;

    res.json({
      status: 'healthy',
      service: 'AutoDark Orchestrator',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      queue: queueStats ? {
        queued: queueStats.queued,
        processing: queueStats.submitted + queueStats.processing,
        completed: queueStats.completed,
        failed: queueStats.failed,
        activeWorkers: queueStats.activeWorkers,
        availableWorkers: queueStats.availableWorkers
      } : null
    });
  } catch (error) {
    res.status(503).json({
      status: 'degraded',
      service: 'AutoDark Orchestrator',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      error: 'Queue system unavailable'
    });
  }
});

// ============================================
// Routes
// ============================================

// Static files - serve output videos
app.use('/output', express.static(path.join(process.cwd(), 'public', 'output')));

// Video processing routes
app.use('/', videoProxyRoutes);

// Transcription routes
app.use('/', transcriptionRoutes);

// Caption style routes (unified endpoint)
app.use('/', captionUnifiedRoutes);

// Job management routes
app.use('/', jobRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'API GPU Orchestrator - RunPod Serverless with Queue System',
    version: '3.0.0',
    features: {
      queue: 'Job queue with webhook notifications',
      workers: '3 concurrent workers managed automatically',
      polling: 'Background polling (no request blocking)',
      webhooks: 'Automatic result delivery to webhook_url'
    },
    endpoints: {
      sync: {
        transcribe: 'POST /gpu/transcribe (synchronous GPU transcription)'
      },
      async: {
        img2vid: 'POST /gpu/video/img2vid (webhook_url required, id_roteiro optional)',
        addaudio: 'POST /gpu/video/addaudio (webhook_url required, id_roteiro optional)',
        concatenate: 'POST /gpu/video/concatenate (webhook_url required, id_roteiro optional)',
        captionStyle: 'POST /gpu/video/caption_style (webhook_url required, type: segments|highlight)'
      },
      jobs: {
        status: 'GET /jobs/:jobId (check job status with progress)',
        cancel: 'POST /jobs/:jobId/cancel (cancel running job)',
        queueStats: 'GET /queue/stats (queue statistics)'
      },
      health: {
        service: 'GET /health (includes queue stats)',
        transcribe: 'GET /gpu/transcribe/health (transcription service health)'
      }
    },
    documentation: '/docs'
  });
});

// ============================================
// Error Handler
// ============================================

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path
  });

  res.status(err.status || 500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'An error occurred' : err.message
  });
});

// ============================================
// Start Server
// ============================================

const server = app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`🚀 Orchestrator started`, {
    port: PORT,
    env: process.env.NODE_ENV,
    pid: process.pid
  });

  logger.info(`📡 Endpoints: http://0.0.0.0:${PORT}`);

  // Ensure output directory exists before starting cleanup
  await ensureOutputDirectory();

  // Initialize queue system
  await initializeQueueSystem();

  // Start cleanup scheduler for old videos
  startCleanupScheduler();
});

// Set server timeout from .env (default: 35 minutes for 30min execution + margin)
// Hierarchy: Polling (32min) < Express (35min) < RunPod (40min)
const expressTimeout = parseInt(process.env.EXPRESS_TIMEOUT_MS || '2100000'); // 35 min default
server.timeout = expressTimeout;
server.keepAliveTimeout = expressTimeout + 10000; // +10s margin
server.headersTimeout = expressTimeout + 20000; // +20s margin

logger.info('⏱️ Server timeouts configured', {
  timeout: `${(expressTimeout / 1000 / 60).toFixed(1)} minutes`,
  keepAlive: `${((expressTimeout + 10000) / 1000 / 60).toFixed(1)} minutes`,
  headers: `${((expressTimeout + 20000) / 1000 / 60).toFixed(1)} minutes`
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`📴 Shutdown initiated - Signal: ${signal}`);

  // Stop queue system first
  if (queueSystem) {
    logger.info('⏸️ Stopping queue system...');
    queueSystem.stop();
  }

  server.close((err) => {
    if (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }

    logger.info('✅ Server closed successfully');
    process.exit(0);
  });

  // Force shutdown after 30s
  setTimeout(() => {
    logger.warn('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;
