// ============================================
// Worker Entry Point (Vast.ai GPU)
// ============================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from '../shared/utils/logger';

// Carregar variáveis de ambiente
dotenv.config();

// Importar middlewares (serão criados)
// import { ipWhitelistMiddleware } from './middleware/ipWhitelist';
// import { sessionAuthMiddleware } from './middleware/sessionAuth';

// Importar rotas (serão criadas)
// import videoRoutes from './routes/video';

const app = express();
const PORT = parseInt(process.env.PORT || '3334', 10);

// ============================================
// Middlewares
// ============================================

app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Security middlewares (TODO: implementar)
// app.use(ipWhitelistMiddleware);
// app.use(sessionAuthMiddleware);

// Request logging
app.use((req, res, next) => {
  logger.info('Worker incoming request', {
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
    service: 'AutoDark GPU Worker',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    gpu: {
      // TODO: adicionar detecção de GPU
      available: true
    }
  });
});

// ============================================
// Routes (TODO: implementar)
// ============================================

// app.use('/video', videoRoutes);

// Rota temporária
app.get('/', (_req, res) => {
  res.json({
    message: 'API GPU Worker',
    version: '1.0.0',
    endpoints: {
      caption: 'POST /video/caption',
      img2vid: 'POST /video/img2vid',
      adicionaAudio: 'POST /video/adicionaAudio'
    }
  });
});

// ============================================
// Error Handler
// ============================================

app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Worker unhandled error', {
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
  logger.info(`🚀 GPU Worker started`, {
    port: PORT,
    env: process.env.NODE_ENV,
    pid: process.pid
  });

  logger.info(`⚙️ Session token: ${process.env.SESSION_TOKEN ? 'SET' : 'NOT SET'}`);
  logger.info(`🔒 Allowed IPs: ${process.env.ALLOWED_IPS || 'NOT SET'}`);
  logger.info(`📡 Listening on: http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
const gracefulShutdown = (signal: string) => {
  logger.info(`📴 Worker shutdown initiated - Signal: ${signal}`);

  server.close((err) => {
    if (err) {
      logger.error('Error during shutdown', { error: err.message });
      process.exit(1);
    }

    logger.info('✅ Worker closed successfully');
    process.exit(0);
  });

  setTimeout(() => {
    logger.warn('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;
