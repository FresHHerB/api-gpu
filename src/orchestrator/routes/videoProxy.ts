// ============================================
// Video Proxy Routes - RunPod Integration
// ============================================

import { Router, Request, Response } from 'express';
import { RunPodService } from '../services/runpodService';
import { logger } from '../../shared/utils/logger';
import {
  CaptionRequest,
  Img2VidRequest,
  AddAudioRequest
} from '../../shared/types';

const router = Router();
const runpodService = new RunPodService();

// ============================================
// Middleware: API Key Authentication
// ============================================

const authenticateApiKey = (req: Request, res: Response, next: Function): void => {
  const apiKey = req.get('X-API-Key');
  const expectedKey = process.env.X_API_KEY;

  if (!apiKey || apiKey !== expectedKey) {
    logger.warn('Unauthorized request - invalid API key', {
      ip: req.ip,
      path: req.path
    });

    res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing API key'
    });
    return;
  }

  next();
};

// ============================================
// Routes
// ============================================

/**
 * POST /video/caption
 * Add SRT subtitles to video
 */
router.post('/video/caption', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    const data: CaptionRequest = req.body;

    // Validate request
    if (!data.url_video || !data.url_srt) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'url_video and url_srt are required'
      });
      return;
    }

    logger.info('📹 Caption request received', {
      url_video: data.url_video,
      url_srt: data.url_srt,
      ip: req.ip
    });

    // Process via RunPod
    const result = await runpodService.processVideo('caption', data);

    const durationMs = Date.now() - startTime;

    logger.info('✅ Caption completed', {
      durationMs,
      video_url: result.video_url
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('❌ Caption failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs
    });

    res.status(500).json({
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /video/img2vid
 * Convert images to videos with zoom effect (Ken Burns)
 * Accepts array of images: [{ id, image_url, duracao }]
 */
router.post('/video/img2vid', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    const data: Img2VidRequest = req.body;

    // Validate request - expect images array
    if (!data.images || !Array.isArray(data.images) || data.images.length === 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'images array is required with at least one image'
      });
      return;
    }

    // Validate each image in the array
    for (const img of data.images) {
      if (!img.id || !img.image_url || !img.duracao) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Each image must have id, image_url, and duracao'
        });
        return;
      }
    }

    logger.info('🖼️ Img2Vid batch request received', {
      imageCount: data.images.length,
      images: data.images.map(i => ({ id: i.id, duracao: i.duracao })),
      ip: req.ip
    });

    // Process via RunPod
    const result = await runpodService.processVideo('img2vid', data);

    const durationMs = Date.now() - startTime;

    logger.info('✅ Img2Vid batch completed', {
      durationMs,
      totalImages: result.stats?.total,
      processedImages: result.stats?.processed
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('❌ Img2Vid failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs
    });

    res.status(500).json({
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /video/addaudio
 * Synchronize audio with video
 */
router.post('/video/addaudio', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  const startTime = Date.now();

  try {
    const data: AddAudioRequest = req.body;

    // Validate request
    if (!data.url_video || !data.url_audio) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'url_video and url_audio are required'
      });
      return;
    }

    logger.info('🎵 AddAudio request received', {
      url_video: data.url_video,
      url_audio: data.url_audio,
      ip: req.ip
    });

    // Process via RunPod
    const result = await runpodService.processVideo('addaudio', data);

    const durationMs = Date.now() - startTime;

    logger.info('✅ AddAudio completed', {
      durationMs,
      video_url: result.video_url
    });

    res.json(result);

  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.error('❌ AddAudio failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      durationMs
    });

    res.status(500).json({
      error: 'Processing failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /runpod/health
 * Check RunPod endpoint health
 */
router.get('/runpod/health', authenticateApiKey, async (_req: Request, res: Response) => {
  try {
    const isHealthy = await runpodService.checkHealth();

    res.json({
      status: isHealthy ? 'healthy' : 'unhealthy',
      endpoint: 'RunPod Serverless',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /runpod/config
 * Get RunPod configuration (debug only)
 */
router.get('/runpod/config', authenticateApiKey, (_req: Request, res: Response) => {
  const config = runpodService.getConfig();

  res.json({
    endpointId: config.endpointId,
    idleTimeout: config.idleTimeout,
    maxTimeout: config.maxTimeout
    // API key hidden for security
  });
});

/**
 * GET /job/:jobId
 * Check status of a specific job
 */
router.get('/job/:jobId', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const status = await runpodService.getJobStatus(jobId);

    res.json(status);
  } catch (error) {
    logger.error('Failed to get job status', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(404).json({
      error: 'Job not found',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /job/:jobId/cancel
 * Cancel a running job
 */
router.post('/job/:jobId/cancel', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    await runpodService.cancelJob(jobId);

    res.json({
      message: 'Job cancelled successfully',
      jobId
    });
  } catch (error) {
    logger.error('Failed to cancel job', {
      jobId: req.params.jobId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Failed to cancel job',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /upload/video
 * Receive video upload directly from GPU worker
 * Bypasses base64 encoding for large batches
 */
router.post('/upload/video', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, video_base64 } = req.body;

    if (!id || !video_base64) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'id and video_base64 are required'
      });
      return;
    }

    // Save video to output directory
    const filename = `${id}_${Date.now()}.mp4`;
    const { promises: fs } = await import('fs');
    const path = await import('path');
    const OUTPUT_DIR = path.join(process.cwd(), 'public', 'output');

    await fs.mkdir(OUTPUT_DIR, { recursive: true });

    const filepath = path.join(OUTPUT_DIR, filename);
    const buffer = Buffer.from(video_base64, 'base64');
    await fs.writeFile(filepath, buffer);

    logger.info('📹 Video uploaded from GPU worker', {
      id,
      filename,
      size: buffer.length
    });

    res.json({
      success: true,
      id,
      video_url: `/output/${filename}`
    });

  } catch (error) {
    logger.error('❌ Video upload failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
