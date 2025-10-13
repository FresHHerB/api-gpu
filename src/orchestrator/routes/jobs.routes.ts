// ============================================
// Job Management Routes
// Endpoints para consulta e gerenciamento de jobs
// ============================================

import { Router, Request, Response } from 'express';
import { JobService } from '../queue/jobService';
import { logger } from '../../shared/utils/logger';

const router = Router();

// JobService será injetado no router
let jobService: JobService;

export function setJobService(service: JobService) {
  jobService = service;
}

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
// GET /jobs/:jobId
// Consultar status de um job
// ============================================

router.get('/jobs/:jobId', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    logger.info('📊 Job status requested', { jobId });

    const status = await jobService.getJobStatus(jobId);

    res.json(status);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'Job not found') {
      logger.warn('Job not found', { jobId: req.params.jobId });
      res.status(404).json({
        error: 'Job not found',
        message: `Job ${req.params.jobId} does not exist`
      });
      return;
    }

    logger.error('Failed to get job status', {
      jobId: req.params.jobId,
      error: errorMessage
    });

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

// ============================================
// POST /jobs/:jobId/cancel
// Cancelar um job
// ============================================

router.post('/jobs/:jobId/cancel', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;

    logger.info('🛑 Job cancellation requested', { jobId });

    await jobService.cancelJob(jobId);

    res.json({
      message: 'Job cancelled successfully',
      jobId
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    if (errorMessage === 'Job not found') {
      logger.warn('Job not found for cancellation', { jobId: req.params.jobId });
      res.status(404).json({
        error: 'Job not found',
        message: `Job ${req.params.jobId} does not exist`
      });
      return;
    }

    if (errorMessage.includes('Cannot cancel job')) {
      logger.warn('Cannot cancel job', { jobId: req.params.jobId, error: errorMessage });
      res.status(400).json({
        error: 'Bad request',
        message: errorMessage
      });
      return;
    }

    logger.error('Failed to cancel job', {
      jobId: req.params.jobId,
      error: errorMessage
    });

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

// ============================================
// GET /queue/stats
// Obter estatísticas da fila
// ============================================

router.get('/queue/stats', authenticateApiKey, async (_req: Request, res: Response) => {
  try {
    logger.info('📈 Queue stats requested');

    const stats = await jobService.getQueueStats();

    res.json(stats);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Failed to get queue stats', { error: errorMessage });

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

export default router;
