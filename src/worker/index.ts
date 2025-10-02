// ============================================
// Worker Entry Point (RunPod Serverless)
// ============================================

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import dotenv from 'dotenv';
import { logger } from '../shared/utils/logger';
import { FFmpegService } from './services/ffmpegService';
import type { CaptionRequest, Img2VidRequest, AddAudioRequest } from '../shared/types';

// Carregar variáveis de ambiente
dotenv.config();

// Importar middlewares (serão criados)
// import { ipWhitelistMiddleware } from './middleware/ipWhitelist';
// import { sessionAuthMiddleware } from './middleware/sessionAuth';

// Importar rotas (serão criadas)
// import videoRoutes from './routes/video';

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

// Initialize FFmpeg service
const ffmpegService = new FFmpegService();

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
app.use((req, _res, next) => {
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
// Routes
// ============================================

// Root endpoint
app.get('/', (_req, res) => {
  res.json({
    message: 'API GPU Worker (RunPod Serverless)',
    version: '2.0.0',
    endpoints: {
      runsync: 'POST /runsync',
      caption: 'POST /video/caption',
      img2vid: 'POST /video/img2vid',
      addaudio: 'POST /video/addaudio'
    }
  });
});

// RunPod Serverless endpoint (called by RunPod)
app.post('/runsync', async (req, res): Promise<void> => {
  try {
    const { input } = req.body;

    if (!input || !input.operation) {
      res.status(400).json({ error: 'Missing input.operation' });
      return;
    }

    const { operation, ...data } = input;

    logger.info('RunPod job received', { operation, data });

    let result: any;

    switch (operation) {
      case 'caption':
        const captionPath = await ffmpegService.addCaption(data.url_video, data.url_srt);
        result = { video_url: captionPath };
        break;

      case 'img2vid':
        const videos = await ffmpegService.imagesToVideos(data.images);
        result = {
          videos: videos.map(v => ({ id: v.id, video_url: v.video_path })),
          total: data.images.length,
          processed: videos.length
        };
        break;

      case 'addaudio':
        const audioPath = await ffmpegService.addAudio(data.url_video, data.url_audio);
        result = { video_url: audioPath };
        break;

      default:
        res.status(400).json({ error: `Unknown operation: ${operation}` });
        return;
    }

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    logger.error('RunPod job failed', { error });
    res.status(500).json({
      error: 'Job failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Caption endpoint
app.post('/video/caption', async (req, res): Promise<void> => {
  try {
    const { url_video, url_srt } = req.body as CaptionRequest;

    if (!url_video || !url_srt) {
      res.status(400).json({ error: 'Missing url_video or url_srt' });
      return;
    }

    logger.info('Processing caption request', { url_video, url_srt });
    const outputPath = await ffmpegService.addCaption(url_video, url_srt);

    res.json({
      success: true,
      video_url: outputPath,
      message: 'Caption added successfully'
    });
  } catch (error) {
    logger.error('Caption failed', { error });
    res.status(500).json({
      error: 'Caption processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Img2vid endpoint (batch processing)
app.post('/video/img2vid', async (req, res): Promise<void> => {
  try {
    const { images } = req.body as Img2VidRequest;

    if (!images || !Array.isArray(images) || images.length === 0) {
      res.status(400).json({ error: 'Missing or invalid images array' });
      return;
    }

    logger.info('Processing img2vid batch request', { imageCount: images.length });
    const results = await ffmpegService.imagesToVideos(images);

    res.json({
      success: true,
      videos: results.map(r => ({
        id: r.id,
        video_url: r.video_path
      })),
      message: 'Images converted to videos successfully',
      total: images.length,
      processed: results.length
    });
  } catch (error) {
    logger.error('Img2vid failed', { error });
    res.status(500).json({
      error: 'Img2vid processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Add audio endpoint
app.post('/video/addaudio', async (req, res): Promise<void> => {
  try {
    const { url_video, url_audio } = req.body as AddAudioRequest;

    if (!url_video || !url_audio) {
      res.status(400).json({ error: 'Missing url_video or url_audio' });
      return;
    }

    logger.info('Processing addaudio request', { url_video, url_audio });
    const outputPath = await ffmpegService.addAudio(url_video, url_audio);

    res.json({
      success: true,
      video_url: outputPath,
      message: 'Audio added successfully'
    });
  } catch (error) {
    logger.error('AddAudio failed', { error });
    res.status(500).json({
      error: 'AddAudio processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
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
