// ============================================
// VPS Video Processing Routes - Local CPU-based
// Same operations as GPU routes but processed locally on VPS
// Uses SAME validation as GPU routes for consistency
// ============================================

import { Router, Request, Response } from 'express';
import { logger } from '../../shared/utils/logger';
import { JobService } from '../queue/jobService';
import {
  validateRequest,
  img2VidRequestSchema,
  addAudioRequestSchema,
  concatenateRequestSchema
} from '../../shared/middleware/validation';
import {
  Img2VidRequestAsync,
  AddAudioRequestAsync,
  ConcatenateRequestAsync
} from '../../shared/types';

const router = Router();

// JobService will be injected
let jobService: JobService;

export function setJobService(service: JobService) {
  jobService = service;
}

// ============================================
// Helper Functions
// ============================================

/**
 * Extract path_raiz from full path
 */
function extractPathRaiz(path: string): string {
  let cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const videosIndex = cleanPath.lastIndexOf('/videos');
  if (videosIndex > 0) {
    cleanPath = cleanPath.substring(0, videosIndex);
  }
  return cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
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
// POST /vps/video/img2vid
// Local CPU-based image to video conversion (libx264)
// Uses SAME validation as GPU endpoint
// ============================================

router.post(
  '/vps/video/img2vid',
  authenticateApiKey,
  validateRequest(img2VidRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: Img2VidRequestAsync = req.body;
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🖼️ VPS Img2Vid request received', {
        imageCount: data.images.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz,
        ip: req.ip
      });

      // Create job with _vps suffix (processed locally with CPU)
      const job = await jobService.createJob('img2vid_vps', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ VPS Img2Vid job created', {
        jobId: job.jobId,
        status: job.status,
        imageCount: data.images.length,
        pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ VPS Img2Vid job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================
// POST /vps/video/addaudio
// Local CPU-based audio addition
// Uses SAME validation as GPU endpoint
// ============================================

router.post(
  '/vps/video/addaudio',
  authenticateApiKey,
  validateRequest(addAudioRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: AddAudioRequestAsync = req.body;
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🎵 VPS AddAudio request received', {
        urlVideo: data.url_video,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz,
        ip: req.ip
      });

      // Create job with _vps suffix (processed locally with CPU)
      const job = await jobService.createJob('addaudio_vps', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ VPS AddAudio job created', {
        jobId: job.jobId,
        status: job.status,
        pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ VPS AddAudio job creation failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Job creation failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

// ============================================
// POST /vps/video/concatenate
// Local CPU-based video concatenation (libx264 re-encoding)
// Uses SAME validation as GPU endpoint
// ============================================

router.post(
  '/vps/video/concatenate',
  authenticateApiKey,
  validateRequest(concatenateRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { webhook_url, id_roteiro, ...data }: ConcatenateRequestAsync = req.body;
      const pathRaiz = extractPathRaiz(data.path);

      logger.info('🎬 VPS Concatenate request received', {
        videoCount: data.video_urls.length,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path: data.path,
        pathRaiz,
        outputFilename: data.output_filename,
        ip: req.ip
      });

      // Create job with _vps suffix (processed locally with CPU)
      const job = await jobService.createJob('concatenate_vps', data, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ VPS Concatenate job created', {
        jobId: job.jobId,
        status: job.status,
        videoCount: data.video_urls.length,
        pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ VPS Concatenate job creation failed', {
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
