// ============================================
// Admin Routes
// Endpoints administrativos para manutenção
// ============================================

import { Router, Request, Response } from 'express';
import { JobStorage } from '../queue/jobStorage';
import { logger } from '../../shared/utils/logger';

const router = Router();

// JobStorage será injetado no router
let storage: JobStorage;

export function setJobStorage(jobStorage: JobStorage) {
  storage = jobStorage;
}

// ============================================
// Middleware: API Key Authentication
// ============================================

const authenticateApiKey = (req: Request, res: Response, next: Function): void => {
  const apiKey = req.get('X-API-Key');
  const expectedKey = process.env.X_API_KEY;

  if (!apiKey || apiKey !== expectedKey) {
    logger.warn('Unauthorized admin request - invalid API key', {
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
// POST /admin/recover-workers
// Força recuperação de workers de jobs finalizados
// ============================================

router.post('/admin/recover-workers', authenticateApiKey, async (_req: Request, res: Response) => {
  try {
    logger.info('🔧 Manual worker recovery triggered');

    const recovered = await storage.recoverWorkers();

    res.json({
      success: true,
      message: recovered > 0
        ? `Successfully recovered ${recovered} leaked worker(s)`
        : 'No leaked workers found',
      recoveredWorkers: recovered
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Failed to recover workers', { error: errorMessage });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

// ============================================
// GET /admin/workers/status
// Retorna status detalhado dos workers
// ============================================

router.get('/admin/workers/status', authenticateApiKey, async (_req: Request, res: Response) => {
  try {
    logger.info('📊 Worker status requested');

    const stats = await storage.getQueueStats();
    const activeJobs = await storage.getActiveJobs();

    const workerDetails = activeJobs.map(job => ({
      jobId: job.jobId,
      operation: job.operation,
      status: job.status,
      workersReserved: job.workersReserved,
      createdAt: job.createdAt,
      submittedAt: job.submittedAt
    }));

    res.json({
      summary: {
        totalWorkers: stats.activeWorkers + stats.availableWorkers,
        activeWorkers: stats.activeWorkers,
        availableWorkers: stats.availableWorkers
      },
      activeJobs: {
        count: activeJobs.length,
        totalWorkersReserved: activeJobs.reduce((sum, job) => sum + job.workersReserved, 0),
        details: workerDetails
      },
      queueStats: stats
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    logger.error('Failed to get worker status', { error: errorMessage });

    res.status(500).json({
      error: 'Internal server error',
      message: errorMessage
    });
  }
});

export default router;
