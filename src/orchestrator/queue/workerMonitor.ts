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
  private validationInterval: number; // Intervalo de validação de workers em ms
  private isRunning: boolean = false;
  private pollingTimer?: NodeJS.Timeout;
  private timeoutTimer?: NodeJS.Timeout;
  private validationTimer?: NodeJS.Timeout;

  constructor(
    storage: JobStorage,
    runpodService: RunPodService,
    queueManager: QueueManager,
    webhookService: WebhookService,
    pollingInterval: number = 5000, // 5s
    timeoutCheckInterval: number = 60000, // 60s
    validationInterval: number = 300000 // 5min
  ) {
    this.storage = storage;
    this.runpodService = runpodService;
    this.queueManager = queueManager;
    this.webhookService = webhookService;
    this.pollingInterval = pollingInterval;
    this.timeoutCheckInterval = timeoutCheckInterval;
    this.validationInterval = validationInterval;

    logger.info('👁️ WorkerMonitor initialized', {
      pollingInterval: `${pollingInterval}ms`,
      timeoutCheckInterval: `${timeoutCheckInterval}ms`,
      validationInterval: `${validationInterval}ms`
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

    // Loop 3: Validação periódica de worker count
    this.scheduleValidation();
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

    if (this.validationTimer) {
      clearTimeout(this.validationTimer);
      this.validationTimer = undefined;
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
   * Agenda próxima validação de worker count
   */
  private scheduleValidation(): void {
    if (!this.isRunning) return;

    this.validationTimer = setTimeout(async () => {
      await this.validateWorkerCount();
      this.scheduleValidation();
    }, this.validationInterval);
  }

  /**
   * Verifica status de todos os jobs ativos (SUBMITTED, PROCESSING)
   * IMPORTANTE: Apenas jobs GPU/RunPod são monitorados aqui
   * Jobs VPS são gerenciados pelo LocalWorkerService
   */
  private async pollActiveJobs(): Promise<void> {
    try {
      const activeJobs = await this.storage.getActiveJobs();

      if (activeJobs.length === 0) {
        return;
      }

      // Filtrar apenas jobs GPU (RunPod) - pular VPS jobs
      const gpuJobs = activeJobs.filter(job => !this.isVPSJob(job.operation));

      if (gpuJobs.length === 0) {
        return;
      }

      logger.debug(`🔍 Polling ${gpuJobs.length} GPU jobs (${activeJobs.length - gpuJobs.length} VPS jobs skipped)`);

      // Poll apenas GPU jobs em paralelo
      await Promise.all(gpuJobs.map(job => this.pollJob(job)));

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
        const now = new Date();
        await this.storage.updateJob(job.jobId, {
          status: 'PROCESSING',
          processingStartedAt: now  // CRITICAL: Marca início da execução para timeout correto
        });
        logger.info('🔄 Job is now PROCESSING', {
          jobId: job.jobId,
          processingStartedAt: now.toISOString()
        });
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      logger.error(`❌ Error polling job ${job.jobId}`, {
        error: errorMessage
      });

      // Detectar jobs órfãos (não existem mais no RunPod)
      // Isso acontece quando o endpoint é recriado e jobs antigos ficam no Redis
      if (error instanceof Error && (
        error.message.includes('404') ||
        error.message.includes('not found') ||
        error.message.includes('does not exist') ||
        error.message.includes('request does not exist')
      )) {
        logger.warn(`🗑️ Orphaned job detected, marking as FAILED`, {
          jobId: job.jobId,
          reason: 'Job no longer exists in RunPod (likely from old endpoint)'
        });
        await this.handleJobFailed(job, [], `Orphaned job: ${errorMessage}`);
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

    // CRITICAL: Ordem correta para prevenir leaks em caso de crash
    // 1. Liberar workers PRIMEIRO (incrementa semaphore)
    logger.info('🔓 Releasing workers before updating job', {
      jobId: job.jobId,
      workersToRelease: job.workersReserved
    });
    await this.queueManager.releaseWorker(job.workersReserved);

    // 2. Zerar workersReserved DEPOIS (marca job como finalizado)
    // Se crash ocorrer antes deste ponto, recoverWorkers() detectará
    // e auto-corrigirá (validação de count em recoverWorkers())
    await this.storage.updateJob(job.jobId, {
      status: 'COMPLETED',
      result: { ...result, execution },
      completedAt: endTime,
      workersReserved: 0 // CRITICAL: Zero out workers to prevent leaks
    });

    logger.info('✅ Job finalized and workers released', {
      jobId: job.jobId,
      workersReleased: job.workersReserved
    });

    // 3. Enviar webhook (não afeta workers)
    await this.webhookService.sendWebhook(job.jobId, job.webhookUrl, {
      jobId: job.jobId,
      idRoteiro: job.idRoteiro,
      pathRaiz: job.pathRaiz,
      status: 'COMPLETED',
      operation: job.operation,
      processor: 'GPU', // Indicate GPU (RunPod) processing
      result,
      execution
    } as any);
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
      durationSeconds: parseFloat((durationMs / 1000).toFixed(2)),
      worker: 'RunPod',
      codec: 'h264_nvenc'
    };

    // CRITICAL: Ordem correta para prevenir leaks em caso de crash
    // 1. Liberar workers PRIMEIRO (incrementa semaphore)
    logger.info('🔓 Releasing workers before marking job as failed', {
      jobId: job.jobId,
      workersToRelease: job.workersReserved
    });
    await this.queueManager.releaseWorker(job.workersReserved);

    // 2. Zerar workersReserved DEPOIS (marca job como finalizado)
    await this.storage.updateJob(job.jobId, {
      status: 'FAILED',
      error: errorMessage,
      completedAt: endTime,
      workersReserved: 0 // CRITICAL: Zero out workers to prevent leaks
    });

    logger.info('✅ Failed job finalized and workers released', {
      jobId: job.jobId,
      workersReleased: job.workersReserved
    });

    // 3. Enviar webhook com erro (não afeta workers)
    await this.webhookService.sendWebhook(job.jobId, job.webhookUrl, {
      jobId: job.jobId,
      idRoteiro: job.idRoteiro,
      status: 'FAILED',
      operation: job.operation,
      processor: 'GPU',
      error: {
        code: 'PROCESSING_ERROR',
        message: errorMessage
      },
      execution
    } as any);
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
   * Verificar timeouts de jobs GPU/RunPod
   * IMPORTANTE: Apenas jobs GPU são verificados
   * Jobs VPS têm seu próprio timeout no LocalWorkerService
   */
  private async checkTimeouts(): Promise<void> {
    try {
      const activeJobs = await this.storage.getActiveJobs();
      const now = Date.now();

      for (const job of activeJobs) {
        // Pular jobs VPS - gerenciados pelo LocalWorkerService
        if (this.isVPSJob(job.operation)) {
          continue;
        }

        // CRITICAL: Usar processingStartedAt se disponível (timeout só durante execução)
        // Se job ainda não começou a executar, usar submittedAt como fallback
        const startTime = job.processingStartedAt || job.submittedAt || job.createdAt;
        const elapsed = now - startTime.getTime();
        const timeout = this.getTimeoutForOperation(job.operation);

        // Se job ainda não começou a executar (sem processingStartedAt), usar timeout de fila
        const isExecuting = !!job.processingStartedAt;
        const effectiveTimeout = isExecuting ? timeout : timeout + (60 * 60 * 1000); // +60min se em fila

        if (elapsed > effectiveTimeout) {
          logger.error('⏰ GPU Job TIMEOUT', {
            jobId: job.jobId,
            operation: job.operation,
            elapsedMs: elapsed,
            timeoutMs: effectiveTimeout,
            isExecuting,
            startedFrom: isExecuting ? 'processingStartedAt' : 'submittedAt',
            processingStartedAt: job.processingStartedAt?.toISOString(),
            submittedAt: job.submittedAt?.toISOString()
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
   * Retorna timeout adequado para cada operação GPU (tempo de EXECUÇÃO apenas)
   * VPS jobs não são monitorados aqui
   *
   * IMPORTANTE: Estes são timeouts de EXECUÇÃO pura (desde processingStartedAt)
   * Tempo de fila é tratado separadamente (+60min automático)
   */
  private getTimeoutForOperation(operation: JobOperation): number {
    const executionTimeouts: Record<string, number> = {
      // Baseado em análise de logs reais + requisitos de produção:
      img2vid: 45 * 60 * 1000,           // 45 min (80-150 imgs, 2 workers, ~37 min max + margem)
      caption: 10 * 60 * 1000,           // 10 min (operação rápida)
      addaudio: 10 * 60 * 1000,          // 10 min
      caption_segments: 10 * 60 * 1000,  // 10 min
      caption_highlight: 10 * 60 * 1000, // 10 min (média: 2-3 min)
      concatenate: 20 * 60 * 1000,       // 20 min (média: 7-9 min, pode ter muitos vídeos)
      concat_video_audio: 15 * 60 * 1000,// 15 min (média: 7-9 min, otimizado com -c copy)
      trilhasonora: 15 * 60 * 1000       // 15 min
    };

    return executionTimeouts[operation] || 30 * 60 * 1000; // Default: 30 min
  }

  /**
   * Valida e auto-corrige worker count periodicamente
   * CRITICAL: Previne worker leaks permanentes
   */
  private async validateWorkerCount(): Promise<void> {
    try {
      logger.info('🔍 Starting periodic worker count validation');

      // Tentar recuperar workers leaked
      const recovered = await this.storage.recoverWorkers();

      if (recovered > 0) {
        logger.warn('⚠️ Periodic validation recovered leaked workers', {
          recovered,
          timestamp: new Date().toISOString()
        });
      } else {
        logger.debug('✅ Worker count validation passed - no leaks detected');
      }

    } catch (error) {
      logger.error('❌ Error during periodic worker validation', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Verifica se job é VPS (processado localmente)
   */
  private isVPSJob(operation: string): boolean {
    return operation.includes('_vps');
  }
}
