// ============================================
// Orchestrator Entry Point (VPS/Easypanel)
// ============================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from '../shared/utils/logger';

// Carregar variáveis de ambiente
dotenv.config();

// Importar rotas
import videoProxyRoutes from './routes/videoProxy';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

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

app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'AutoDark Orchestrator',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// ============================================
// Routes
// ============================================

// Video processing routes
app.use('/', videoProxyRoutes);

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'API GPU Orchestrator - RunPod Serverless',
    version: '1.0.0',
    endpoints: {
      caption: 'POST /video/caption',
      img2vid: 'POST /video/img2vid',
      addaudio: 'POST /video/addaudio',
      health: 'GET /health',
      runpodHealth: 'GET /runpod/health'
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

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`🚀 Orchestrator started`, {
    port: PORT,
    env: process.env.NODE_ENV,
    pid: process.pid
  });

  logger.info(`📡 Endpoints: http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`📴 Shutdown initiated - Signal: ${signal}`);

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
