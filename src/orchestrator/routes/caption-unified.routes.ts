// ============================================
// Unified Caption Style Route
// Single endpoint for both segments (classic) and highlight (karaoke) subtitles
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
// Validation Schema
// ============================================

const unifiedCaptionSchema = Joi.object({
  url_video: Joi.string().required(),
  url_caption: Joi.string().required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  type: Joi.string().valid('segments', 'highlight').required(),

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
// POST /caption_style
// Unified endpoint for both segments and highlight subtitles
// ============================================
router.post('/caption_style', async (req: Request, res: Response) => {
  const startTime = new Date();
  const jobId = randomUUID();

  try {
    console.log(`[CaptionStyle] Job ${jobId} started`);

    // Validate request
    const { error, value } = unifiedCaptionSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        error: 'Validation failed',
        message: error.details.map(d => d.message).join(', '),
        job_id: jobId
      });
    }

    const { url_video, url_caption, path, output_filename, type, style } = value;

    console.log(`[CaptionStyle] Type: ${type}`);
    console.log(`[CaptionStyle] Processing: ${url_video}`);
    console.log(`[CaptionStyle] Caption: ${url_caption}`);

    let result;

    // Route to appropriate handler based on type
    if (type === 'segments') {
      // Classic segments (SRT-based)
      const alignment = POSITION_MAP[style.position.alignment];

      console.log(`[CaptionStyle-Segments] Style: ${JSON.stringify(style)}`);

      result = await getRunPodService().processVideo('caption_segments' as any, {
        url_video,
        url_srt: url_caption,  // Rename for worker compatibility
        path,
        output_filename,
        style: {
          ...style,
          position: {
            ...style.position,
            alignment
          }
        }
      });

    } else {
      // Highlight (karaoke/word-by-word)
      const alignment = POSITION_MAP[style.position];

      // Convert hex colors to RGB
      const fundoRgb = hexToRgb(style.fundo_cor);
      const textoRgb = hexToRgb(style.texto_cor);
      const highlightRgb = hexToRgb(style.highlight_cor);

      // Convert opacity from 0-100% to 0-255
      const opacidade255 = Math.round((style.fundo_opacidade / 100) * 255);

      console.log(`[CaptionStyle-Highlight] Style (input): ${JSON.stringify(style)}`);
      console.log(`[CaptionStyle-Highlight] Opacity conversion: ${style.fundo_opacidade}% → ${opacidade255}/255`);

      result = await getRunPodService().processVideo('caption_highlight' as any, {
        url_video,
        url_words_json: url_caption,  // Rename for worker compatibility
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
          highlight_cor_r: highlightRgb.r,
          highlight_cor_g: highlightRgb.g,
          highlight_cor_b: highlightRgb.b,
          highlight_borda: style.highlight_borda,
          padding_horizontal: style.padding_horizontal,
          padding_vertical: style.padding_vertical,
          words_per_line: style.words_per_line,
          max_lines: style.max_lines,
          alignment
        }
      });
    }

    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.log(`[CaptionStyle] Job ${jobId} completed in ${(durationMs / 1000).toFixed(2)}s`);

    return res.status(200).json({
      code: 200,
      message: `Video with ${type} subtitles completed successfully`,
      type,
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

    console.error(`[CaptionStyle] Job ${jobId} failed:`, error);

    return res.status(500).json({
      error: 'Caption processing failed',
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
