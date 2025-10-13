// ============================================
// WorkerMonitor
// Polling em background de jobs submetidos ao RunPod
// ============================================

import { Job, JobOperation } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { RunPodService } from '../services/runpodService';
import { QueueManager } from './queueManager';
import { WebhookService } from './webhookService';
import { logger } from '../../shared/utils/logger';

export class WorkerMonitor {
  private storage: JobStorage;
  private runpodService: RunPodService;
  private queueManager: QueueManager;
  private webhookService: WebhookService;

  private pollingInterval: number; // Intervalo de polling em ms
  private timeoutCheckInterval: number; // Intervalo de checagem de timeout em ms
  private isRunning: boolean = false;
  private pollingTimer?: NodeJS.Timeout;
  private timeoutTimer?: NodeJS.Timeout;

  constructor(
    storage: JobStorage,
    runpodService: RunPodService,
    queueManager: QueueManager,
    webhookService: WebhookService,
    pollingInterval: number = 5000, // 5s
    timeoutCheckInterval: number = 60000 // 60s
  ) {
    this.storage = storage;
    this.runpodService = runpodService;
    this.queueManager = queueManager;
    this.webhookService = webhookService;
    this.pollingInterval = pollingInterval;
    this.timeoutCheckInterval = timeoutCheckInterval;

    logger.info('👁️ WorkerMonitor initialized', {
      pollingInterval: `${pollingInterval}ms`,
      timeoutCheckInterval: `${timeoutCheckInterval}ms`
    });
  }

  /**
   * Inicia polling em background
   */
  start(): void {
    if (this.isRunning) {
      logger.warn('⚠️ WorkerMonitor already running');
      return;
    }

    this.isRunning = true;
    logger.info('🚀 WorkerMonitor started');

    // Loop 1: Polling de jobs ativos
    this.scheduleNextPoll();

    // Loop 2: Verificação de timeouts
    this.scheduleTimeoutCheck();
  }

  /**
   * Para polling
   */
  stop(): void {
    this.isRunning = false;

    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }

    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = undefined;
    }

    logger.info('🛑 WorkerMonitor stopped');
  }

  /**
   * Agenda próximo poll
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.pollingTimer = setTimeout(async () => {
      await this.pollActiveJobs();
      this.scheduleNextPoll();
    }, this.pollingInterval);
  }

  /**
   * Agenda próxima checagem de timeout
   */
  private scheduleTimeoutCheck(): void {
    if (!this.isRunning) return;

    this.timeoutTimer = setTimeout(async () => {
      await this.checkTimeouts();
      this.scheduleTimeoutCheck();
    }, this.timeoutCheckInterval);
  }

  /**
   * Verifica status de todos os jobs ativos (SUBMITTED, PROCESSING)
   */
  private async pollActiveJobs(): Promise<void> {
    try {
      const activeJobs = await this.storage.getActiveJobs();

      if (activeJobs.length === 0) {
        return;
      }

      logger.debug(`🔍 Polling ${activeJobs.length} active jobs`);

      // Poll todos os jobs em paralelo
      await Promise.all(activeJobs.map(job => this.pollJob(job)));

    } catch (error) {
      logger.error('❌ Error polling active jobs', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Verifica status de um job específico
   */
  private async pollJob(job: Job): Promise<void> {
    if (!job.runpodJobIds || job.runpodJobIds.length === 0) {
      logger.warn('⚠️ Job has no runpodJobIds', { jobId: job.jobId });
      return;
    }

    try {
      // Poll status de todos os runpodJobIds
      const statuses = await Promise.all(
        job.runpodJobIds.map(id => this.runpodService.getJobStatus(id))
      );

      // Atualizar status se mudou para PROCESSING
      const anyProcessing = statuses.some(s => s.status === 'IN_PROGRESS');
      if (anyProcessing && job.status === 'SUBMITTED') {
        await this.storage.updateJob(job.jobId, { status: 'PROCESSING' });
        logger.info('🔄 Job is now PROCESSING', { jobId: job.jobId });
      }

      // Verificar se todos completaram
      const allCompleted = statuses.every(s => s.status === 'COMPLETED');
      if (allCompleted) {
        await this.handleJobCompleted(job, statuses);
        return;
      }

      // Verificar se algum falhou
      const anyFailed = statuses.some(
        s => s.status === 'FAILED' || s.status === 'CANCELLED' || s.status === 'TIMED_OUT'
      );
      if (anyFailed) {
        await this.handleJobFailed(job, statuses);
        return;
      }

    } catch (error) {
      logger.error(`❌ Error polling job ${job.jobId}`, {
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Se erro 404, marcar como falho
      if (error instanceof Error && error.message.includes('404')) {
        await this.handleJobFailed(job, [], 'Job not found in RunPod');
      }
    }
  }

  /**
   * Processa job completado
   */
  private async handleJobCompleted(job: Job, statuses: any[]): Promise<void> {
    logger.info('✅ Job COMPLETED', { jobId: job.jobId });

    // Agregar resultados
    const result = this.aggregateResults(job.operation, statuses);

    // Calcular execution time
    const startTime = job.submittedAt || job.createdAt;
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const execution = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs,
      durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
    };

    // Atualizar job
    await this.storage.updateJob(job.jobId, {
      status: 'COMPLETED',
      result: { ...result, execution },
      completedAt: endTime
    });

    // Enviar webhook
    await this.webhookService.sendWebhook(job.jobId, job.webhookUrl, {
      jobId: job.jobId,
      idRoteiro: job.idRoteiro,
      pathRaiz: job.pathRaiz,
      status: 'COMPLETED',
      operation: job.operation,
      result,
      execution
    });

    // Liberar workers
    await this.queueManager.releaseWorker(job.workersReserved);
  }

  /**
   * Processa job que falhou
   */
  private async handleJobFailed(job: Job, statuses: any[], customError?: string): Promise<void> {
    const errorMessage =
      customError ||
      statuses.find(s => s.error)?.error ||
      'Job failed in RunPod';

    logger.error('❌ Job FAILED', { jobId: job.jobId, error: errorMessage });

    // Calcular execution time
    const startTime = job.submittedAt || job.createdAt;
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const execution = {
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      durationMs,
      durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
    };

    // Atualizar job
    await this.storage.updateJob(job.jobId, {
      status: 'FAILED',
      error: errorMessage,
      completedAt: endTime
    });

    // Enviar webhook com erro
    await this.webhookService.sendWebhook(job.jobId, job.webhookUrl, {
      jobId: job.jobId,
      idRoteiro: job.idRoteiro,
      status: 'FAILED',
      operation: job.operation,
      error: {
        code: 'PROCESSING_ERROR',
        message: errorMessage
      },
      execution
    });

    // Liberar workers
    await this.queueManager.releaseWorker(job.workersReserved);
  }

  /**
   * Agregar resultados de múltiplos sub-jobs
   */
  private aggregateResults(operation: JobOperation, statuses: any[]): any {
    if (operation === 'img2vid' && statuses.length > 1) {
      // Multi-worker img2vid: agregar todos os vídeos
      const allVideos: any[] = [];
      for (const status of statuses) {
        if (status.output?.videos) {
          allVideos.push(...status.output.videos);
        }
      }

      // Ordenar por filename (video_1.mp4, video_2.mp4, etc)
      allVideos.sort((a, b) => {
        const aNum = parseInt(a.filename.match(/video_(\d+)\.mp4/)?.[1] || '0');
        const bNum = parseInt(b.filename.match(/video_(\d+)\.mp4/)?.[1] || '0');
        return aNum - bNum;
      });

      return {
        code: 200,
        message: `${allVideos.length} videos processed successfully`,
        videos: allVideos
      };
    }

    // Single job: retornar output direto
    return statuses[0]?.output || {};
  }

  /**
   * Verificar timeouts de jobs
   */
  private async checkTimeouts(): Promise<void> {
    try {
      const activeJobs = await this.storage.getActiveJobs();
      const now = Date.now();

      for (const job of activeJobs) {
        const startTime = job.submittedAt || job.createdAt;
        const elapsed = now - startTime.getTime();
        const timeout = this.getTimeoutForOperation(job.operation);

        if (elapsed > timeout) {
          logger.error('⏰ Job TIMEOUT', {
            jobId: job.jobId,
            operation: job.operation,
            elapsedMs: elapsed,
            timeoutMs: timeout
          });

          // Cancelar jobs RunPod
          for (const rpJobId of job.runpodJobIds) {
            try {
              await this.runpodService.cancelJob(rpJobId);
            } catch (error) {
              logger.warn(`Failed to cancel RunPod job ${rpJobId}`, { error });
            }
          }

          // Marcar como FAILED
          await this.handleJobFailed(
            job,
            [],
            `Job timed out after ${(elapsed / 1000 / 60).toFixed(1)} minutes`
          );
        }
      }
    } catch (error) {
      logger.error('❌ Error checking timeouts', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Retorna timeout adequado para cada operação
   */
  private getTimeoutForOperation(operation: JobOperation): number {
    const timeouts: Record<JobOperation, number> = {
      img2vid: 60 * 60 * 1000,     // 60 min
      caption: 10 * 60 * 1000,     // 10 min
      addaudio: 5 * 60 * 1000,     // 5 min
      caption_segments: 10 * 60 * 1000,  // 10 min
      caption_highlight: 10 * 60 * 1000  // 10 min
    };

    return timeouts[operation] || 30 * 60 * 1000; // Default: 30 min
  }
}
