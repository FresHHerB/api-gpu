// ============================================
// Video Processing Routes - Queue-based with Webhooks
// ============================================

import { Router, Request, Response } from 'express';
import { logger } from '../../shared/utils/logger';
import { JobService } from '../queue/jobService';
import {
  Img2VidRequestAsync,
  CaptionRequestAsync,
  AddAudioRequestAsync,
  CaptionStyledRequestAsync,
  ConcatenateRequestAsync
} from '../../shared/types';
import {
  validateRequest,
  captionRequestSchema,
  img2VidRequestSchema,
  addAudioRequestSchema,
  captionStyledRequestSchema,
  concatenateRequestSchema
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
 * POST /video/img2vid
 * Convert images to videos with zoom effects
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/video/img2vid',
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
 * POST /video/caption
 * Add SRT subtitles to video
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/video/caption',
  authenticateApiKey,
  validateRequest(captionRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: CaptionRequestAsync = req.body;

      logger.info('📹 Caption request received', {
        urlVideo: data.url_video,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        ip: req.ip
      });

      // Create job and enqueue
      const job = await jobService.createJob('caption', data, webhook_url, id_roteiro);

      logger.info('✅ Caption job created', {
        jobId: job.jobId,
        status: job.status
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ Caption job creation failed', {
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
 * POST /video/addaudio
 * Synchronize audio with video
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/video/addaudio',
  authenticateApiKey,
  validateRequest(addAudioRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: AddAudioRequestAsync = req.body;

      logger.info('🎵 AddAudio request received', {
        urlVideo: data.url_video,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        ip: req.ip
      });

      // Create job and enqueue
      const job = await jobService.createJob('addaudio', data, webhook_url, id_roteiro);

      logger.info('✅ AddAudio job created', {
        jobId: job.jobId,
        status: job.status
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
 * POST /video/concatenate
 * Concatenate multiple videos into one
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/video/concatenate',
  authenticateApiKey,
  validateRequest(concatenateRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: ConcatenateRequestAsync = req.body;

      logger.info('🎬 Concatenate request received', {
        videoCount: data.video_urls.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        outputFilename: data.output_filename,
        ip: req.ip
      });

      // Create job and enqueue
      const job = await jobService.createJob('concatenate', data, webhook_url, id_roteiro);

      logger.info('✅ Concatenate job created', {
        jobId: job.jobId,
        status: job.status,
        videoCount: data.video_urls.length
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
 * POST /video/caption_style
 * Add styled SRT subtitles to video
 * Returns immediately with jobId - result sent to webhook_url
 */
router.post(
  '/video/caption_style',
  authenticateApiKey,
  validateRequest(captionStyledRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: CaptionStyledRequestAsync = req.body;

      logger.info('🎨 Styled caption request received', {
        urlVideo: data.url_video,
        hasStyle: !!data.style,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        ip: req.ip
      });

      // Create job and enqueue
      const job = await jobService.createJob('caption', data, webhook_url, id_roteiro);

      logger.info('✅ Styled caption job created', {
        jobId: job.jobId,
        status: job.status
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ Styled caption job creation failed', {
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
