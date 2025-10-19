// ============================================
// Video Processing Routes - Queue-based with Webhooks
// ============================================

import { Router, Request, Response } from 'express';
import { logger } from '../../shared/utils/logger';
import { JobService } from '../queue/jobService';
import {
  Img2VidRequestAsync,
  AddAudioRequestAsync,
  ConcatenateRequestAsync,
  ConcatVideoAudioRequestAsync
} from '../../shared/types';
import {
  validateRequest,
  img2VidRequestSchema,
  addAudioRequestSchema,
  concatenateRequestSchema,
  concatVideoAudioRequestSchema
} from '../../shared/middleware/validation';

const router = Router();

// ============================================
// Helper Functions
// ============================================

/**
 * Extract path_raiz from full path
 * Example: "Mr. Nightmare/Video Title/videos/temp/" -> "Mr. Nightmare/Video Title/"
 */
function extractPathRaiz(path: string): string {
  // Remove trailing slash
  let cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;

  // Find the last occurrence of "/videos" and remove everything from there
  const videosIndex = cleanPath.lastIndexOf('/videos');
  if (videosIndex > 0) {
    cleanPath = cleanPath.substring(0, videosIndex);
  }

  // Ensure it ends with /
  return cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
}

// JobService será injetado no router pelo index.ts
let jobService: JobService;

export function setJobService(service: JobService) {
  jobService = service;
}

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
// Video Processing Endpoints (Async with Webhooks)
// ============================================

/**
 * POST /runpod/video/img2vid
 * Convert images to videos with zoom effects
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/runpod/video/img2vid',
  authenticateApiKey,
  validateRequest(img2VidRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: Img2VidRequestAsync = req.body;

      // Extract path_raiz from path
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🖼️ Img2Vid request received', {
        imageCount: data.images.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz: pathRaiz,
        ip: req.ip
      });

      // Create job and enqueue (with pathRaiz for img2vid)
      const job = await jobService.createJob('img2vid', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ Img2Vid job created', {
        jobId: job.jobId,
        status: job.status,
        imageCount: data.images.length,
        pathRaiz: pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ Img2Vid job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /runpod/video/addaudio
 * Synchronize audio with video
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/runpod/video/addaudio',
  authenticateApiKey,
  validateRequest(addAudioRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: AddAudioRequestAsync = req.body;

      // Extract path_raiz from path
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🎵 AddAudio request received', {
        urlVideo: data.url_video,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz: pathRaiz,
        ip: req.ip
      });

      // Create job and enqueue (with pathRaiz)
      const job = await jobService.createJob('addaudio', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ AddAudio job created', {
        jobId: job.jobId,
        status: job.status,
        pathRaiz: pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ AddAudio job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /runpod/video/concatenate
 * Concatenate multiple videos into one
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/runpod/video/concatenate',
  authenticateApiKey,
  validateRequest(concatenateRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: ConcatenateRequestAsync = req.body;

      // Extract path_raiz from path
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🎬 Concatenate request received', {
        videoCount: data.video_urls.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz: pathRaiz,
        outputFilename: data.output_filename,
        ip: req.ip
      });

      // Create job and enqueue (with pathRaiz)
      const job = await jobService.createJob('concatenate', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ Concatenate job created', {
        jobId: job.jobId,
        status: job.status,
        videoCount: data.video_urls.length,
        pathRaiz: pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ Concatenate job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /runpod/video/concat_video_audio
 * Concatenate base64-encoded videos cyclically to match audio duration
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/runpod/video/concat_video_audio',
  authenticateApiKey,
  validateRequest(concatVideoAudioRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: ConcatVideoAudioRequestAsync = req.body;

      // Extract path_raiz from path
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🔁 ConcatVideoAudio request received', {
        videoCount: data.videos_base64.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz: pathRaiz,
        outputFilename: data.output_filename,
        normalize: data.normalize ?? true,
        ip: req.ip
      });

      // Create job and enqueue (with pathRaiz)
      const job = await jobService.createJob('concat_video_audio', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ ConcatVideoAudio job created', {
        jobId: job.jobId,
        status: job.status,
        videoCount: data.videos_base64.length,
        pathRaiz: pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ ConcatVideoAudio job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

export default router;
