// ============================================
// Caption Style Routes
// Endpoints for subtitle generation with custom styles
// ============================================

import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { RunPodService } from '../services/runpodService';
import Joi from 'joi';

const router = Router();

// Lazy initialization to avoid crash if endpoint not configured
let runpodService: RunPodService | null = null;

function getRunPodService(): RunPodService {
  if (!runpodService) {
    runpodService = new RunPodService();
  }
  return runpodService;
}

// Position mappings: string → ASS alignment number
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
// Helper Functions
// ============================================

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

// ============================================
// Validation Schemas
// ============================================

// Segments endpoint validation
const segmentsSchema = Joi.object({
  url_video: Joi.string().uri().required(),
  url_srt: Joi.string().uri().required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  style: Joi.object({
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
  }).default()
});

// Highlight endpoint validation
const highlightSchema = Joi.object({
  url_video: Joi.string().uri().required(),
  url_words_json: Joi.string().uri().required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  style: Joi.object({
    // Fonte
    fonte: Joi.string().default('Arial Black'),
    tamanho_fonte: Joi.number().min(20).max(200).default(72),

    // Fundo (Background)
    fundo_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#000000'),
    fundo_opacidade: Joi.number().min(0).max(255).default(128),
    fundo_arredondado: Joi.boolean().default(true),

    // Texto (Text)
    texto_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#FFFFFF'),

    // Highlight
    highlight_cor: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).default('#D60000'),
    highlight_borda: Joi.number().min(1).max(50).default(12),

    // Padding
    padding_horizontal: Joi.number().min(0).max(500).default(40),
    padding_vertical: Joi.number().min(0).max(500).default(80),

    // Position
    position: Joi.string().valid(...Object.keys(POSITION_MAP)).default('bottom_center')
  }).default()
});

// ============================================
// POST /caption_style/segments
// Generate video with SRT subtitles and custom styling
// ============================================
router.post('/caption_style/segments', async (req: Request, res: Response) => {
  const startTime = new Date();
  const jobId = randomUUID();

  try {
    console.log(`[CaptionSegments] Job ${jobId} started`);

    // Validate request
    const { error, value } = segmentsSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        message: error.details.map(d => d.message).join(', '),
        job_id: jobId
      });
    }

    const { url_video, url_srt, path, output_filename, style } = value;

    // Map position string to alignment number
    const alignment = POSITION_MAP[style.position.alignment];

    console.log(`[CaptionSegments] Processing: ${url_video}`);
    console.log(`[CaptionSegments] Style: ${JSON.stringify(style)}`);

    // Submit job to RunPod with caption_segments operation
    const result = await getRunPodService().processVideo('caption_segments' as any, {
      url_video,
      url_srt,
      path,
      output_filename,
      style: {
        ...style,
        position: {
          ...style.position,
          alignment // Send numeric alignment
        }
      }
    });

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`[CaptionSegments] Job ${jobId} completed in ${(durationMs / 1000).toFixed(2)}s`);

    return res.status(200).json({
      code: 200,
      message: 'Video with styled segments subtitles completed successfully',
      video_url: result.video_url,
      job_id: jobId,
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      },
      stats: result.stats
    });

  } catch (error: any) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.error(`[CaptionSegments] Job ${jobId} failed:`, error);

    return res.status(500).json({
      error: 'Caption segments processing failed',
      message: error.message || 'Unknown error occurred',
      job_id: jobId,
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    });
  }
});

// ============================================
// POST /caption_style/highlight
// Generate video with word-level highlight subtitles
// ============================================
router.post('/caption_style/highlight', async (req: Request, res: Response) => {
  const startTime = new Date();
  const jobId = randomUUID();

  try {
    console.log(`[CaptionHighlight] Job ${jobId} started`);

    // Validate request
    const { error, value } = highlightSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        message: error.details.map(d => d.message).join(', '),
        job_id: jobId
      });
    }

    const { url_video, url_words_json, path, output_filename, style } = value;

    // Map position string to alignment number
    const alignment = POSITION_MAP[style.position];

    // Convert hex colors to RGB for worker
    const fundoRgb = hexToRgb(style.fundo_cor);
    const textoRgb = hexToRgb(style.texto_cor);
    const highlightRgb = hexToRgb(style.highlight_cor);

    console.log(`[CaptionHighlight] Processing: ${url_video}`);
    console.log(`[CaptionHighlight] Style (hex): ${JSON.stringify(style)}`);

    // Submit job to RunPod with caption_highlight operation
    const result = await getRunPodService().processVideo('caption_highlight' as any, {
      url_video,
      url_words_json,
      path,
      output_filename,
      style: {
        fonte: style.fonte,
        tamanho_fonte: style.tamanho_fonte,
        fundo_opacidade: style.fundo_opacidade,
        fundo_cor_r: fundoRgb.r,
        fundo_cor_g: fundoRgb.g,
        fundo_cor_b: fundoRgb.b,
        fundo_arredondado: style.fundo_arredondado,
        texto_cor_r: textoRgb.r,
        texto_cor_g: textoRgb.g,
        texto_cor_b: textoRgb.b,
        highlight_cor_r: highlightRgb.r,
        highlight_cor_g: highlightRgb.g,
        highlight_cor_b: highlightRgb.b,
        highlight_borda: style.highlight_borda,
        padding_horizontal: style.padding_horizontal,
        padding_vertical: style.padding_vertical,
        alignment
      }
    });

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`[CaptionHighlight] Job ${jobId} completed in ${(durationMs / 1000).toFixed(2)}s`);

    return res.status(200).json({
      code: 200,
      message: 'Video with highlight subtitles completed successfully',
      video_url: result.video_url,
      job_id: jobId,
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      },
      stats: result.stats
    });

  } catch (error: any) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.error(`[CaptionHighlight] Job ${jobId} failed:`, error);

    return res.status(500).json({
      error: 'Caption highlight processing failed',
      message: error.message || 'Unknown error occurred',
      job_id: jobId,
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    });
  }
});

// ============================================
// GET /caption_style/health
// Health check for caption service
// ============================================
router.get('/caption_style/health', async (_req: Request, res: Response) => {
  try {
    const runpodHealth = await getRunPodService().checkHealth();

    return res.status(runpodHealth ? 200 : 503).json({
      status: runpodHealth ? 'healthy' : 'unhealthy',
      service: 'caption_style',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'unhealthy',
      service: 'caption_style',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
