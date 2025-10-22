// ============================================
// JobService
// API para gerenciamento de jobs
// ============================================

import { Job, JobOperation, JobStatusResponse, JobSubmitResponse, QueueStats } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { QueueManager } from './queueManager';
import { RunPodService } from '../services/runpodService';
import { logger } from '../../shared/utils/logger';

export class JobService {
  private storage: JobStorage;
  private queueManager: QueueManager;
  private runpodService: RunPodService;

  constructor(storage: JobStorage, queueManager: QueueManager, runpodService: RunPodService) {
    this.storage = storage;
    this.queueManager = queueManager;
    this.runpodService = runpodService;
    logger.info('🔧 JobService initialized');
  }

  /**
   * Cria e enfileira novo job
   */
  async createJob(
    operation: JobOperation,
    payload: any,
    webhookUrl: string,
    idRoteiro?: number,
    pathRaiz?: string
  ): Promise<JobSubmitResponse> {
    logger.info('📝 Creating new job', { operation, idRoteiro, pathRaiz });

    // Criar job
    const job = await this.queueManager.enqueueJob({
      status: 'QUEUED',
      operation,
      payload,
      webhookUrl,
      idRoteiro,
      pathRaiz,
      runpodJobIds: [],
      workersReserved: 0
    });

    // Calcular posição na fila
    const queuedJobs = await this.storage.getQueuedJobs();
    const queuePosition = queuedJobs.findIndex(j => j.jobId === job.jobId) + 1;

    // Estimar tempo de espera
    const estimatedTime = this.estimateWaitTime(operation, queuePosition);

    const response: JobSubmitResponse = {
      jobId: job.jobId,
      status: job.status,
      idRoteiro: job.idRoteiro,
      message: 'Job queued successfully',
      estimatedTime,
      queuePosition: queuePosition > 0 ? queuePosition : undefined,
      statusUrl: `/jobs/${job.jobId}`,
      createdAt: job.createdAt.toISOString()
    };

    logger.info('✅ Job created successfully', {
      jobId: job.jobId,
      queuePosition
    });

    return response;
  }

  /**
   * Obtém status de um job
   */
  async getJobStatus(jobId: string): Promise<JobStatusResponse> {
    const job = await this.storage.getJob(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    const response: JobStatusResponse = {
      jobId: job.jobId,
      status: job.status,
      operation: job.operation,
      idRoteiro: job.idRoteiro,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      submittedAt: job.submittedAt?.toISOString(),
      completedAt: job.completedAt?.toISOString()
    };

    // Calcular progresso para jobs ativos
    if (job.status === 'SUBMITTED' || job.status === 'PROCESSING') {
      try {
        const progress = await this.calculateProgress(job);
        response.progress = progress;

        // Estimar tempo de conclusão
        response.estimatedCompletion = this.estimateCompletion(job, progress);
      } catch (error) {
        logger.warn('Failed to calculate progress', {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return response;
  }

  /**
   * Cancela job em execução
   */
  async cancelJob(jobId: string): Promise<void> {
    const job = await this.storage.getJob(jobId);

    if (!job) {
      throw new Error('Job not found');
    }

    if (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') {
      throw new Error(`Cannot cancel job with status ${job.status}`);
    }

    logger.info('🛑 Cancelling job', { jobId, status: job.status });

    // Se já foi submetido ao RunPod, tentar cancelar lá também
    if (job.runpodJobIds && job.runpodJobIds.length > 0 && job.status !== 'QUEUED') {
      for (const rpJobId of job.runpodJobIds) {
        try {
          await this.runpodService.cancelJob(rpJobId);
          logger.info('✅ Cancelled RunPod job', { jobId, rpJobId });
        } catch (error) {
          logger.warn('Failed to cancel RunPod job', {
            jobId,
            rpJobId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }

      // Liberar workers
      if (job.workersReserved > 0) {
        await this.queueManager.releaseWorker(job.workersReserved);
      }
    }

    // Atualizar status
    await this.storage.updateJob(jobId, {
      status: 'CANCELLED',
      completedAt: new Date(),
      workersReserved: 0 // CRITICAL: Zero out workers to prevent leaks
    });

    logger.info('✅ Job cancelled successfully', { jobId });
  }

  /**
   * Retorna estatísticas da fila
   */
  async getQueueStats(): Promise<QueueStats> {
    return await this.queueManager.getStats();
  }

  /**
   * Calcula progresso de um job ativo
   */
  private async calculateProgress(job: Job): Promise<{ completed: number; total: number; percentage: number }> {
    if (!job.runpodJobIds || job.runpodJobIds.length === 0) {
      return { completed: 0, total: 0, percentage: 0 };
    }

    const statuses = await Promise.all(
      job.runpodJobIds.map(id => this.runpodService.getJobStatus(id))
    );

    const completed = statuses.filter(s => s.status === 'COMPLETED').length;
    const total = statuses.length;
    const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

    return { completed, total, percentage };
  }

  /**
   * Estima tempo de espera na fila
   */
  private estimateWaitTime(operation: JobOperation, queuePosition: number): string {
    // Tempo médio por operação (em minutos)
    const avgTimes: Record<string, number> = {
      // GPU operations (RunPod)
      img2vid: 5,
      caption: 2,
      addaudio: 1,
      caption_segments: 2,
      caption_highlight: 2,
      concatenate: 3,
      // VPS operations (CPU-based, slower)
      img2vid_vps: 10,
      caption_segments_vps: 4,
      caption_highlight_vps: 4,
      addaudio_vps: 2,
      concatenate_vps: 6
    };

    const avgTime = avgTimes[operation] || 3;

    // VPS jobs têm fila separada (LocalWorkerService), GPU jobs têm 3 workers (RunPod)
    const workersCount = operation.includes('_vps') ? 2 : 3;
    const estimatedMinutes = avgTime * Math.ceil(queuePosition / workersCount);

    if (estimatedMinutes < 1) {
      return 'less than 1 minute';
    } else if (estimatedMinutes === 1) {
      return '~1 minute';
    } else if (estimatedMinutes < 60) {
      return `~${estimatedMinutes} minutes`;
    } else {
      const hours = Math.floor(estimatedMinutes / 60);
      const mins = estimatedMinutes % 60;
      return `~${hours}h ${mins}min`;
    }
  }

  /**
   * Estima tempo de conclusão para job em progresso
   */
  private estimateCompletion(
    job: Job,
    progress: { completed: number; total: number; percentage: number }
  ): string {
    if (progress.percentage === 0) {
      return 'calculating...';
    }

    const startTime = job.submittedAt || job.createdAt;
    const elapsed = Date.now() - startTime.getTime();
    const estimatedTotal = (elapsed / progress.percentage) * 100;
    const remaining = estimatedTotal - elapsed;

    const remainingMinutes = Math.ceil(remaining / 1000 / 60);

    if (remainingMinutes < 1) {
      return 'less than 1 minute';
    } else if (remainingMinutes === 1) {
      return '~1 minute';
    } else if (remainingMinutes < 60) {
      return `~${remainingMinutes} minutes`;
    } else {
      const hours = Math.floor(remainingMinutes / 60);
      const mins = remainingMinutes % 60;
      return `~${hours}h ${mins}min`;
    }
  }
}
