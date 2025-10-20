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
        audio_url: Joi.string().required()
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
