import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { WebhookService } from '../../orchestrator/queue/webhookService';

// ============================================
// Custom Validators
// ============================================

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

// ============================================
// Validation Schemas
// ============================================

export const captionRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  url_video: Joi.string().pattern(/^https?:\/\/.+/).required(),
  url_srt: Joi.string().pattern(/^https?:\/\/.+/).required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required()
});

export const img2VidRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  images: Joi.array().items(
    Joi.object({
      id: Joi.string().required(),
      image_url: Joi.string().pattern(/^https?:\/\/.+/).required(),
      duracao: Joi.number().min(0.1).max(300).required()
    })
  ).min(1).required(),
  path: Joi.string().required(),
  zoom_types: Joi.array().items(
    Joi.string().valid('zoomin', 'zoomout', 'zoompanright')
  ).optional()
});

export const addAudioRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  url_video: Joi.string().pattern(/^https?:\/\/.+/).required(),
  url_audio: Joi.string().pattern(/^https?:\/\/.+/).required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required()
});

export const concatenateRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  video_urls: Joi.array().items(
    Joi.object({
      video_url: Joi.string().pattern(/^https?:\/\/.+/).required()
    })
  ).min(2).required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required()
});

export const concatVideoAudioRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  videos_base64: Joi.array().items(
    Joi.string().base64().required()
  ).min(1).max(10).required(),
  audio_url: Joi.string().pattern(/^https?:\/\/.+/).required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  normalize: Joi.boolean().default(true)
});

export const captionStyledRequestSchema = Joi.object({
  webhook_url: Joi.string().uri().custom(webhookUrlValidator).required(),
  id_roteiro: Joi.number().integer().optional(),
  url_video: Joi.string().pattern(/^https?:\/\/.+/).required(),
  url_srt: Joi.string().pattern(/^https?:\/\/.+/).required(),
  path: Joi.string().required(),
  output_filename: Joi.string().required(),
  style: Joi.object({
    font: Joi.object({
      name: Joi.string().max(100).optional(),
      size: Joi.number().min(8).max(100).optional(),
      bold: Joi.boolean().optional(),
      italic: Joi.boolean().optional(),
      underline: Joi.boolean().optional()
    }).optional(),
    colors: Joi.object({
      primary: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      primaryAlpha: Joi.number().min(0).max(255).optional(),
      outline: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      outlineAlpha: Joi.number().min(0).max(255).optional(),
      background: Joi.string().pattern(/^#[0-9A-Fa-f]{6}$/).optional(),
      backgroundAlpha: Joi.number().min(0).max(255).optional()
    }).optional(),
    border: Joi.object({
      style: Joi.number().valid(0, 1, 3, 4).optional(),
      width: Joi.number().min(0).max(4).optional(),
      shadow: Joi.number().min(0).max(4).optional()
    }).optional(),
    position: Joi.object({
      alignment: Joi.number().valid(1, 2, 3, 4, 5, 6, 7, 8, 9).optional(),
      marginVertical: Joi.number().min(0).max(200).optional(),
      marginLeft: Joi.number().min(0).max(200).optional(),
      marginRight: Joi.number().min(0).max(200).optional()
    }).optional()
  }).optional()
});

export const youtubeTranscriptRequestSchema = Joi.object({
  url: Joi.string()
    .pattern(/^https?:\/\/(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/).+/)
    .required()
    .messages({
      'string.pattern.base': 'URL must be a valid YouTube video URL (youtube.com/watch?v=... or youtu.be/...)'
    })
});

// ============================================
// Validation Middleware Factory
// ============================================

/**
 * Encode URLs in request body to handle spaces and special characters
 */
const encodeUrls = (body: any): any => {
  const encoded = { ...body };

  // Encode URL fields if they exist and are not already encoded
  if (encoded.url_video && typeof encoded.url_video === 'string') {
    // Only encode if it contains unencoded characters
    if (encoded.url_video.includes(' ') || encoded.url_video.includes('|')) {
      encoded.url_video = encodeURI(encoded.url_video);
    }
  }

  if (encoded.url_srt && typeof encoded.url_srt === 'string') {
    if (encoded.url_srt.includes(' ') || encoded.url_srt.includes('|')) {
      encoded.url_srt = encodeURI(encoded.url_srt);
    }
  }

  if (encoded.url_audio && typeof encoded.url_audio === 'string') {
    if (encoded.url_audio.includes(' ') || encoded.url_audio.includes('|')) {
      encoded.url_audio = encodeURI(encoded.url_audio);
    }
  }

  if (encoded.url_image && typeof encoded.url_image === 'string') {
    if (encoded.url_image.includes(' ') || encoded.url_image.includes('|')) {
      encoded.url_image = encodeURI(encoded.url_image);
    }
  }

  // Encode image URLs in images array (for img2vid)
  if (encoded.images && Array.isArray(encoded.images)) {
    encoded.images = encoded.images.map((img: any) => {
      if (img.image_url && typeof img.image_url === 'string') {
        if (img.image_url.includes(' ') || img.image_url.includes('|')) {
          return { ...img, image_url: encodeURI(img.image_url) };
        }
      }
      return img;
    });
  }

  // Encode video URLs in video_urls array (for concatenate)
  if (encoded.video_urls && Array.isArray(encoded.video_urls)) {
    encoded.video_urls = encoded.video_urls.map((video: any) => {
      if (video.video_url && typeof video.video_url === 'string') {
        if (video.video_url.includes(' ') || video.video_url.includes('|')) {
          return { ...video, video_url: encodeURI(video.video_url) };
        }
      }
      return video;
    });
  }

  return encoded;
};

export const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Auto-encode URLs before validation
    req.body = encodeUrls(req.body);

    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      logger.warn('Validation failed', {
        path: req.path,
        errors,
        body: req.body
      });

      res.status(400).json({
        error: 'Validation error',
        message: 'Invalid request parameters',
        details: errors
      });
      return;
    }

    // Substituir body com valores validados
    req.body = value;
    next();
  };
};
