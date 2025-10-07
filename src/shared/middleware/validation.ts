import Joi from 'joi';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

// ============================================
// Validation Schemas
// ============================================

export const captionRequestSchema = Joi.object({
  url_video: Joi.string().uri().required(),
  url_srt: Joi.string().uri().required()
});

export const img2VidRequestSchema = Joi.object({
  url_image: Joi.string().uri().required(),
  frame_rate: Joi.number().min(1).max(60).default(24),
  duration: Joi.number().min(0.1).max(300).required()
});

export const addAudioRequestSchema = Joi.object({
  url_video: Joi.string().uri().required(),
  url_audio: Joi.string().uri().required()
});

export const captionStyledRequestSchema = Joi.object({
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
