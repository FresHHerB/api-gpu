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
