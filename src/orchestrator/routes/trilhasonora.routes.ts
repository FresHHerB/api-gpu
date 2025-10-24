// ============================================
// Trilha Sonora Route - Add background music to video
// ============================================

import { Router, Request, Response } from 'express';
import { logger } from '../../shared/utils/logger';
import { JobService } from '../queue/jobService';
import Joi from 'joi';
import { WebhookService } from '../queue/webhookService';

const router = Router();

// JobService will be injected
let jobService: JobService;

export function setJobService(service: JobService) {
  jobService = service;
}

// ============================================
// Helper Functions
// ============================================

function extractPathRaiz(path: string): string {
  let cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
  const videosIndex = cleanPath.lastIndexOf('/videos');
  if (videosIndex > 0) {
    cleanPath = cleanPath.substring(0, videosIndex);
  }
  return cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
}

const webhookUrlValidator = (value: string, helpers: Joi.CustomHelpers) => {
  if (!WebhookService.validateWebhookUrl(value)) {
    return helpers.error('any.invalid', {
      message: 'Invalid webhook URL - localhost and private IPs are not allowed'
    });
  }
  return value;
};

// ============================================
// Validation Schema
// ============================================

const trilhaSonoraSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  url_video: Joi.string().required(),
  trilha_sonora: Joi.string().required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  volume_reduction_db: Joi.number().min(0).max(40).optional()  // Optional: auto-normalizes to -12dB if not provided
});

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
// POST /runpod/video/trilhasonora
// Add background music (trilha sonora) to video
// ============================================

router.post('/runpod/video/trilhasonora', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    // Validate request
    const { error, value } = trilhaSonoraSchema.validate(req.body, { abortEarly: false });
    if (error) {
      res.status(400).json({
        error: 'Validation failed',
        message: error.details.map(d => d.message).join(', ')
      });
      return;
    }

    const { webhook_url, id_roteiro, url_video, trilha_sonora, path, output_filename, volume_reduction_db } = value;
    const pathRaiz = extractPathRaiz(path);

    logger.info('🎵 TrilhaSonora request received', {
      urlVideo: url_video,
      trilhaSonora: trilha_sonora,
      idRoteiro: id_roteiro,
      webhookUrl: webhook_url,
      path,
      pathRaiz,
      volumeReduction: volume_reduction_db || 'auto-normalize',
      ip: req.ip
    });

    // Create job data
    const jobData = {
      url_video,
      trilha_sonora,
      path,
      output_filename,
      volume_reduction_db
    };

    // Create job (processed by RunPod worker)
    const job = await jobService.createJob('trilhasonora', jobData, webhook_url, id_roteiro, pathRaiz);

    logger.info('✅ TrilhaSonora job created', {
      jobId: job.jobId,
      status: job.status,
      pathRaiz
    });

    res.status(202).json(job);

  } catch (error) {
    logger.error('❌ TrilhaSonora job creation failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    res.status(500).json({
      error: 'Job creation failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
