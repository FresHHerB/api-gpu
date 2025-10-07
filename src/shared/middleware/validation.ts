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
  url_video: Joi.string().uri().required(),
  url_srt: Joi.string().uri().required(),
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

export const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: NextFunction): void => {
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
