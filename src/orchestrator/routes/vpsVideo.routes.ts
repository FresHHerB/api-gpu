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
  concatenateRequestSchema,
  youtubeTranscriptRequestSchema
} from '../../shared/middleware/validation';
import {
  Img2VidRequestAsync,
  AddAudioRequestAsync,
  ConcatenateRequestAsync,
  YouTubeTranscriptRequest,
  YouTubeTranscriptResponse
} from '../../shared/types';
import Joi from 'joi';
import { WebhookService } from '../queue/webhookService';
import { youtubeTranscriberService } from '../services/youtube/transcriber.service';

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

/**
 * Validate webhook URL (anti-SSRF)
 */
const webhookUrlValidator = (value: string, helpers: Joi.CustomHelpers) => {
  if (!WebhookService.validateWebhookUrl(value)) {
    return helpers.error('any.invalid', {
      message: 'Invalid webhook URL - localhost and private IPs are not allowed'
    });
  }
  return value;
};

/**
 * Convert hex color (#RRGGBB) to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
}

// Position mappings for caption alignment
const POSITION_MAP: Record<string, number> = {
  'bottom_left': 1,
  'bottom_center': 2,
  'bottom_right': 3,
  'middle_left': 4,
  'middle_center': 5,
  'middle_right': 6,
  'top_left': 7,
  'top_center': 8,
  'top_right': 9
};

// ============================================
// Validation Schemas (for caption_style)
// ============================================

const unifiedCaptionSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  url_video: Joi.string().required(),
  url_caption: Joi.string().required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  type: Joi.string().valid('segments', 'highlight').required(),
  uppercase: Joi.boolean().default(false),

  // Conditional style validation based on type
  style: Joi.when('type', {
    is: 'segments',
    then: Joi.object({
      font: Joi.object({
        name: Joi.string().default('Arial'),
        size: Joi.number().min(20).max(200).default(36),
        bold: Joi.boolean().default(true)
      }).default(),
      colors: Joi.object({
        primary: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#FFFFFF'),
        outline: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#000000')
      }).default(),
      border: Joi.object({
        style: Joi.number().valid(1, 3, 4).default(1),
        width: Joi.number().min(0).max(10).default(3)
      }).default(),
      position: Joi.object({
        alignment: Joi.string().valid(...Object.keys(POSITION_MAP)).default('bottom_center'),
        marginVertical: Joi.number().min(0).max(500).default(20)
      }).default()
    }).default(),
    otherwise: Joi.object({
      // Highlight (karaoke) style
      fonte: Joi.string().default('Arial Black'),
      tamanho_fonte: Joi.number().min(20).max(200).default(72),
      fundo_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
      fundo_opacidade: Joi.number().min(0).max(100).default(50),
      fundo_arredondado: Joi.boolean().default(true),
      texto_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#FFFFFF'),
      highlight_texto_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#FFFF00'),
      highlight_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#D60000'),
      highlight_borda: Joi.number().min(1).max(50).default(12),
      padding_horizontal: Joi.number().min(0).max(500).default(40),
      padding_vertical: Joi.number().min(0).max(500).default(80),
      position: Joi.string().valid(...Object.keys(POSITION_MAP)).default('bottom_center'),
      words_per_line: Joi.number().min(1).max(10).default(4),
      max_lines: Joi.number().min(1).max(5).default(2)
    }).default()
  })
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

// ============================================
// POST /vps/video/caption_style
// Local CPU-based caption styling (segments/highlight)
// Uses SAME validation as GPU endpoint
// ============================================

router.post(
  '/vps/video/caption_style',
  authenticateApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request
      const { error, value } = unifiedCaptionSchema.validate(req.body, { abortEarly: false });
      if (error) {
        res.status(400).json({
          error: 'Validation failed',
          message: error.details.map(d => d.message).join(', ')
        });
        return;
      }

      const { webhook_url, id_roteiro, url_video, url_caption, path, output_filename, type, uppercase, style } = value;
      const pathRaiz = extractPathRaiz(path);

      logger.info('🎨 VPS CaptionStyle request received', {
        type,
        urlVideo: url_video,
        idRoteiro: id_roteiro,
        webhookUrl: webhook_url,
        path,
        pathRaiz,
        ip: req.ip
      });

      let operation: 'caption_segments_vps' | 'caption_highlight_vps';
      let jobData: any;

      // Prepare job data based on type
      if (type === 'segments') {
        // Classic segments (SRT-based)
        const alignment = POSITION_MAP[style.position.alignment];

        operation = 'caption_segments_vps';
        jobData = {
          url_video,
          url_srt: url_caption,
          path,
          output_filename,
          style: {
            ...style,
            position: {
              ...style.position,
              alignment
            },
            uppercase
          }
        };

      } else {
        // Highlight (karaoke/word-by-word)
        const alignment = POSITION_MAP[style.position];

        // Convert hex colors to RGB
        const fundoRgb = hexToRgb(style.fundo_cor);
        const textoRgb = hexToRgb(style.texto_cor);
        const highlightTextoRgb = hexToRgb(style.highlight_texto_cor);
        const highlightRgb = hexToRgb(style.highlight_cor);

        // Convert opacity from 0-100% to 0-255
        const opacidade255 = Math.round((style.fundo_opacidade / 100) * 255);

        operation = 'caption_highlight_vps';
        jobData = {
          url_video,
          url_words_json: url_caption,
          path,
          output_filename,
          style: {
            fonte: style.fonte,
            tamanho_fonte: style.tamanho_fonte,
            fundo_opacidade: opacidade255,
            fundo_cor_r: fundoRgb.r,
            fundo_cor_g: fundoRgb.g,
            fundo_cor_b: fundoRgb.b,
            fundo_arredondado: style.fundo_arredondado,
            texto_cor_r: textoRgb.r,
            texto_cor_g: textoRgb.g,
            texto_cor_b: textoRgb.b,
            highlight_texto_cor_r: highlightTextoRgb.r,
            highlight_texto_cor_g: highlightTextoRgb.g,
            highlight_texto_cor_b: highlightTextoRgb.b,
            highlight_cor_r: highlightRgb.r,
            highlight_cor_g: highlightRgb.g,
            highlight_cor_b: highlightRgb.b,
            highlight_borda: style.highlight_borda,
            padding_horizontal: style.padding_horizontal,
            padding_vertical: style.padding_vertical,
            words_per_line: style.words_per_line,
            max_lines: style.max_lines,
            alignment,
            uppercase
          }
        };
      }

      // Create job with _vps suffix (processed locally with CPU)
      const job = await jobService.createJob(operation, jobData, webhook_url, id_roteiro, pathRaiz);

      logger.info('✅ VPS CaptionStyle job created', {
        jobId: job.jobId,
        status: job.status,
        type,
        operation,
        pathRaiz
      });

      res.status(202).json(job);

    } catch (error) {
      logger.error('❌ VPS CaptionStyle job creation failed', {
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
// POST /vps/video/transcribe_youtube
// Extract auto-generated YouTube transcript (captions)
// No webhook needed - returns result immediately
// ============================================

router.post(
  '/vps/video/transcribe_youtube',
  authenticateApiKey,
  validateRequest(youtubeTranscriptRequestSchema),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { url }: YouTubeTranscriptRequest = req.body;

      logger.info('🎬 YouTube transcript request received', {
        url,
        ip: req.ip
      });

      // Execute transcript extraction (with caching)
      const result: YouTubeTranscriptResponse = await youtubeTranscriberService.transcribe(url);

      const statusCode = result.ok ? 200 : 400;

      logger.info(`${result.ok ? '✅' : '❌'} YouTube transcript ${result.ok ? 'completed' : 'failed'}`, {
        url,
        ok: result.ok,
        segmentsCount: result.segments_count,
        cached: result.cached,
        executionTimeMs: result.execution_time_ms,
        error: result.error
      });

      res.status(statusCode).json(result);

    } catch (error) {
      logger.error('❌ YouTube transcript error', {
        error: error instanceof Error ? error.message : 'Unknown error',
        ip: req.ip
      });

      res.status(500).json({
        ok: false,
        source: req.body.url || 'unknown',
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error occurred'
      } as YouTubeTranscriptResponse);
    }
  }
);

export default router;
