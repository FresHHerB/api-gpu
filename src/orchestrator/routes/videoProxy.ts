// ============================================
// Video Proxy Routes - RunPod Integration
// ============================================

import { Router, Request, Response } from 'express';
import { RunPodService } from '../services/runpodService';
import { logger } from '../../shared/utils/logger';
import {
  CaptionRequest,
  Img2VidRequest,
  AddAudioRequest,
  CaptionStyledRequest
} from '../../shared/types';
import {
  validateRequest,
  captionRequestSchema,
  captionStyledRequestSchema
} from '../../shared/middleware/validation';

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
router.post(
  '/video/caption',
  authenticateApiKey,
  validateRequest(captionRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      const data: CaptionRequest = req.body;

      logger.info('📹 Caption request received', {
        url_video: data.url_video,
        url_srt: data.url_srt,
        path: data.path,
        output_filename: data.output_filename,
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
  }
);

/**
 * POST /video/caption_style
 * Add SRT subtitles to video with custom styling (font, colors, border, position)
 */
router.post(
  '/video/caption_style',
  authenticateApiKey,
  validateRequest(captionStyledRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();

    try {
      const data: CaptionStyledRequest = req.body;

      logger.info('🎨 Styled caption request received', {
        url_video: data.url_video,
        url_srt: data.url_srt,
        path: data.path,
        output_filename: data.output_filename,
        hasStyle: !!data.style,
        styleConfig: data.style,
        ip: req.ip
      });

      // Process via RunPod with custom styling
      const result = await runpodService.processCaptionStyled(data);

      const durationMs = Date.now() - startTime;

      logger.info('✅ Styled caption completed', {
        durationMs,
        video_url: result.video_url,
        forceStyle: result.stats?.forceStyle
      });

      res.json(result);

    } catch (error) {
      const durationMs = Date.now() - startTime;

      logger.error('❌ Styled caption failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs
      });

      res.status(500).json({
        error: 'Processing failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

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

    // Validate S3 path is provided
    if (!data.path) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'path is required for S3 upload'
      });
      return;
    }

    // Validate zoom_types if provided
    if (data.zoom_types) {
      if (!Array.isArray(data.zoom_types) || data.zoom_types.length === 0) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'zoom_types must be a non-empty array'
        });
        return;
      }

      const validZoomTypes = ['zoomin', 'zoomout', 'zoompanright'];
      for (const zoomType of data.zoom_types) {
        if (!validZoomTypes.includes(zoomType)) {
          res.status(400).json({
            error: 'Bad Request',
            message: `Invalid zoom_type: ${zoomType}. Valid types: ${validZoomTypes.join(', ')}`
          });
          return;
        }
      }
    }

    logger.info('🖼️ Img2Vid batch request received', {
      imageCount: data.images.length,
      images: data.images.map(i => ({ id: i.id, duracao: i.duracao })),
      path: data.path,
      zoom_types: data.zoom_types || ['zoomin'],
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
    if (!data.url_video || !data.url_audio || !data.path || !data.output_filename) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'url_video, url_audio, path, and output_filename are required'
      });
      return;
    }

    logger.info('🎵 AddAudio request received', {
      url_video: data.url_video,
      url_audio: data.url_audio,
      path: data.path,
      output_filename: data.output_filename,
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

// ============================================
// Async Endpoints (Submit and return jobId immediately)
// ============================================

/**
 * POST /video/caption/async
 * Submit caption job and return immediately with jobId
 */
router.post(
  '/video/caption/async',
  authenticateApiKey,
  validateRequest(captionRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const data: CaptionRequest = req.body;

      logger.info('📹 Caption async request received', {
        url_video: data.url_video,
        url_srt: data.url_srt,
        path: data.path,
        output_filename: data.output_filename,
        ip: req.ip
      });

      // Submit job (returns immediately)
      const job = await runpodService.submitJob('caption', data);

      logger.info('✅ Caption job submitted', { jobId: job.id, status: job.status });

      res.json({
        jobId: job.id,
        status: job.status,
        statusUrl: `/video/job/${job.id}`,
        resultUrl: `/video/job/${job.id}/result`,
        message: 'Job submitted successfully. Use statusUrl to check progress.'
      });

    } catch (error) {
      logger.error('❌ Caption async submit failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      res.status(500).json({
        error: 'Submit failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
);

/**
 * POST /video/img2vid/async
 * Submit img2vid job and return immediately with jobId
 */
router.post('/video/img2vid/async', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const data: Img2VidRequest = req.body;

    // Validate request
    if (!data.images || !Array.isArray(data.images) || data.images.length === 0) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'images array is required with at least one image'
      });
      return;
    }

    for (const img of data.images) {
      if (!img.id || !img.image_url || !img.duracao) {
        res.status(400).json({
          error: 'Bad Request',
          message: 'Each image must have id, image_url, and duracao'
        });
        return;
      }
    }

    if (!data.path) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'path is required for S3 upload'
      });
      return;
    }

    logger.info('🖼️ Img2Vid async request received', {
      imageCount: data.images.length,
      images: data.images.map(i => ({ id: i.id, duracao: i.duracao })),
      path: data.path,
      zoom_types: data.zoom_types || ['zoomin'],
      ip: req.ip
    });

    // Submit job (returns immediately)
    const job = await runpodService.submitJob('img2vid', data);

    logger.info('✅ Img2Vid job submitted', { jobId: job.id, status: job.status });

    res.json({
      jobId: job.id,
      status: job.status,
      statusUrl: `/video/job/${job.id}`,
      resultUrl: `/video/job/${job.id}/result`,
      message: 'Job submitted successfully. Use statusUrl to check progress.',
      estimatedTime: '2-10 minutes depending on image count'
    });

  } catch (error) {
    logger.error('❌ Img2Vid async submit failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Submit failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /video/addaudio/async
 * Submit addaudio job and return immediately with jobId
 */
router.post('/video/addaudio/async', authenticateApiKey, async (req: Request, res: Response): Promise<void> => {
  try {
    const data: AddAudioRequest = req.body;

    // Validate request
    if (!data.url_video || !data.url_audio || !data.path || !data.output_filename) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'url_video, url_audio, path, and output_filename are required'
      });
      return;
    }

    logger.info('🎵 AddAudio async request received', {
      url_video: data.url_video,
      url_audio: data.url_audio,
      path: data.path,
      output_filename: data.output_filename,
      ip: req.ip
    });

    // Submit job (returns immediately)
    const job = await runpodService.submitJob('addaudio', data);

    logger.info('✅ AddAudio job submitted', { jobId: job.id, status: job.status });

    res.json({
      jobId: job.id,
      status: job.status,
      statusUrl: `/video/job/${job.id}`,
      resultUrl: `/video/job/${job.id}/result`,
      message: 'Job submitted successfully. Use statusUrl to check progress.'
    });

  } catch (error) {
    logger.error('❌ AddAudio async submit failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Submit failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// ============================================
// Job Status and Result Endpoints
// ============================================

/**
 * GET /video/job/:jobId
 * Check status of a specific job
 */
router.get('/video/job/:jobId', authenticateApiKey, async (req: Request, res: Response) => {
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
 * GET /video/job/:jobId/result
 * Get formatted result of completed job
 */
router.get('/video/job/:jobId/result', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const status = await runpodService.getJobStatus(jobId);

    if (status.status !== 'COMPLETED') {
      res.status(202).json({
        jobId,
        status: status.status,
        message: status.status === 'IN_QUEUE' ? 'Job is in queue' :
                 status.status === 'IN_PROGRESS' ? 'Job is in progress' :
                 status.status === 'FAILED' ? 'Job failed' : 'Unknown status',
        statusUrl: `/video/job/${jobId}`
      });
      return;
    }

    // Job completed - return formatted result
    res.json({
      jobId,
      status: 'COMPLETED',
      result: status.output,
      delayTime: status.delayTime,
      executionTime: status.executionTime
    });

  } catch (error) {
    logger.error('Failed to get job result', {
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
 * GET /job/:jobId (legacy endpoint)
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

export default router;
