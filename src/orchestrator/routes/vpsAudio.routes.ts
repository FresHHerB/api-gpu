// ============================================
// VPS Audio Processing Routes - Local CPU-based
// Audio concatenation processed locally on VPS
// Direct response (no webhook) for immediate results
// ============================================

import { Router, Request, Response } from 'express';
import { logger } from '../../shared/utils/logger';
import Joi from 'joi';
import { LocalAudioProcessor } from '../workers/localAudioProcessor';

const router = Router();

// Initialize audio processor
const audioProcessor = new LocalAudioProcessor();

// ============================================
// Validation Schema
// ============================================

const concatenateAudioSchema = Joi.object({
  audio_urls: Joi.array()
    .items(
      Joi.object({
        audio_url: Joi.string().pattern(/^https?:\/\/.+/).required().messages({
          'string.pattern.base': 'audio_url must be a valid HTTP/HTTPS URL'
        })
      })
    )
    .min(2)
    .required()
    .messages({
      'array.min': 'At least 2 audio files are required for concatenation'
    }),
  path: Joi.string().required().messages({
    'string.empty': 'path is required (e.g., "Channel Name/Video Title/audios/")'
  }),
  output_filename: Joi.string().optional().default('audio_concatenated.mp3')
});

// Custom URL validator that accepts URLs with spaces (will be encoded during download)
const urlValidator = (value: string, helpers: Joi.CustomHelpers) => {
  // Check if it looks like a URL (http:// or https://)
  if (!value.match(/^https?:\/\/.+/)) {
    return helpers.error('any.invalid', {
      message: 'URL must start with http:// or https://'
    });
  }
  return value;
};

const trilhaSonoraSchema = Joi.object({
  audio_url: Joi.string().custom(urlValidator).required().messages({
    'any.invalid': 'audio_url must be a valid URL (HTTP/HTTPS/Google Drive)',
    'any.required': 'audio_url is required'
  }),
  trilha_sonora: Joi.string().custom(urlValidator).required().messages({
    'any.invalid': 'trilha_sonora must be a valid URL (HTTP/HTTPS/Google Drive)',
    'any.required': 'trilha_sonora is required'
  }),
  path: Joi.string().required().messages({
    'string.empty': 'path is required (e.g., "Channel Name/Video Title/audios/")'
  }),
  output_filename: Joi.string().optional().default('audio_with_trilha.mp3'),
  volume_reduction_db: Joi.number().min(0).max(40).optional().default(30).messages({
    'number.min': 'volume_reduction_db must be at least 0',
    'number.max': 'volume_reduction_db must be at most 40'
  })
});

// ============================================
// POST /vps/audio/concatenate
// Concatenate multiple audio files
// Synchronous - returns result immediately (no webhook)
// ============================================

router.post('/vps/audio/concatenate', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Validate request
    const { error, value } = concatenateAudioSchema.validate(req.body);

    if (error) {
      logger.warn('[VPS Audio] Validation error', {
        error: error.details[0].message,
        body: req.body
      });

      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details[0].message
      });
    }

    const { audio_urls, path, output_filename } = value;

    logger.info('[VPS Audio] Starting audio concatenation', {
      audioCount: audio_urls.length,
      path,
      output_filename
    });

    // Process audio concatenation (synchronous)
    const result = await audioProcessor.concatenateAudios(
      audio_urls,
      path,
      output_filename
    );

    const processingTime = Date.now() - startTime;

    logger.info('[VPS Audio] Concatenation complete', {
      audioUrl: result.audio_url,
      audioCount: result.audio_count,
      totalDuration: result.total_duration,
      processingTime: `${(processingTime / 1000).toFixed(2)}s`
    });

    // Return result immediately
    return res.status(200).json({
      success: true,
      audio_url: result.audio_url,
      filename: result.filename,
      s3_key: result.s3_key,
      audio_count: result.audio_count,
      total_duration: result.total_duration,
      processing_time_ms: processingTime,
      message: `${result.audio_count} audio files concatenated successfully`
    });

  } catch (error: any) {
    const processingTime = Date.now() - startTime;

    logger.error('[VPS Audio] Concatenation failed', {
      error: error.message,
      stack: error.stack,
      processingTime: `${(processingTime / 1000).toFixed(2)}s`
    });

    return res.status(500).json({
      success: false,
      error: 'Audio concatenation failed',
      message: error.message,
      processing_time_ms: processingTime
    });
  }
});

// ============================================
// POST /vps/audio/trilhasonora
// Mix audio with trilha sonora (background music)
// Synchronous - returns result immediately (no webhook)
// ============================================

router.post('/vps/audio/trilhasonora', async (req: Request, res: Response) => {
  const startTime = Date.now();

  try {
    // Validate request
    const { error, value } = trilhaSonoraSchema.validate(req.body);

    if (error) {
      logger.warn('[VPS Audio] Validation error', {
        error: error.details[0].message,
        body: req.body
      });

      return res.status(400).json({
        success: false,
        error: 'Validation error',
        message: error.details[0].message
      });
    }

    const { audio_url, trilha_sonora, path, output_filename, volume_reduction_db } = value;

    logger.info('[VPS Audio] Starting trilha sonora mixing', {
      audio_url,
      trilha_sonora,
      path,
      output_filename,
      volume_reduction_db
    });

    // Process audio mixing (synchronous)
    const result = await audioProcessor.mixAudioWithTrilha(
      audio_url,
      trilha_sonora,
      path,
      output_filename,
      volume_reduction_db
    );

    const processingTime = Date.now() - startTime;

    logger.info('[VPS Audio] Trilha sonora mixing complete', {
      audioUrl: result.audio_url,
      audioDuration: result.audio_duration,
      trilhaDuration: result.trilha_duration,
      loopsApplied: result.loops_applied,
      volumeReduction: result.volume_reduction_db,
      processingTime: `${(processingTime / 1000).toFixed(2)}s`
    });

    // Return result immediately
    return res.status(200).json({
      success: true,
      audio_url: result.audio_url,
      filename: result.filename,
      s3_key: result.s3_key,
      audio_duration: result.audio_duration,
      trilha_duration: result.trilha_duration,
      loops_applied: result.loops_applied,
      volume_reduction_db: result.volume_reduction_db,
      processing_time_ms: processingTime,
      message: `Audio mixed with trilha sonora (${result.loops_applied} loops, -${result.volume_reduction_db}dB)`
    });

  } catch (error: any) {
    const processingTime = Date.now() - startTime;

    logger.error('[VPS Audio] Trilha sonora mixing failed', {
      error: error.message,
      stack: error.stack,
      processingTime: `${(processingTime / 1000).toFixed(2)}s`
    });

    return res.status(500).json({
      success: false,
      error: 'Audio mixing with trilha sonora failed',
      message: error.message,
      processing_time_ms: processingTime
    });
  }
});

// ============================================
// GET /vps/audio/health
// Health check for audio processing service
// ============================================

router.get('/vps/audio/health', async (_req: Request, res: Response) => {
  try {
    // Check if FFmpeg is available
    const { spawn } = require('child_process');

    const ffmpegAvailable = await new Promise<boolean>((resolve) => {
      const ffmpegCheck = spawn('ffmpeg', ['-version']);

      ffmpegCheck.on('close', (code: number) => {
        resolve(code === 0);
      });

      ffmpegCheck.on('error', () => {
        resolve(false);
      });

      // Timeout after 5 seconds
      setTimeout(() => resolve(false), 5000);
    });

    if (ffmpegAvailable) {
      return res.json({
        status: 'healthy',
        service: 'VPS Audio Processor',
        ffmpeg: 'available',
        timestamp: new Date().toISOString()
      });
    } else {
      return res.status(503).json({
        status: 'unhealthy',
        service: 'VPS Audio Processor',
        ffmpeg: 'unavailable',
        timestamp: new Date().toISOString()
      });
    }

  } catch (error: any) {
    return res.status(503).json({
      status: 'unhealthy',
      service: 'VPS Audio Processor',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
