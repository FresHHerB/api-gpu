// ============================================
// QueueManager
// Gerencia fila de jobs e controle de workers
// ============================================

import { Job, QueueStats } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { RunPodService } from '../services/runpodService';
import { logger } from '../../shared/utils/logger';

export class QueueManager {
  private storage: JobStorage;
  private runpodService: RunPodService;
  private processing: boolean = false;
  private vpsJobSkipCount: number = 0; // Track consecutive VPS job skips
  private lastVpsSkipTime: number = 0; // Timestamp of last VPS skip

  constructor(storage: JobStorage, runpodService: RunPodService) {
    this.storage = storage;
    this.runpodService = runpodService;
    logger.info('🎯 QueueManager initialized');
  }

  /**
   * Adiciona job à fila e tenta processar imediatamente se houver worker disponível
   */
  async enqueueJob(job: Omit<Job, 'jobId' | 'createdAt' | 'retryCount' | 'attempts'>): Promise<Job> {
    // 1. Criar job com status QUEUED
    const createdJob = await this.storage.createJob(job);

    // 2. Adicionar à fila
    await this.storage.enqueueJob(createdJob.jobId);

    logger.info('✅ Job enqueued', {
      jobId: createdJob.jobId,
      operation: createdJob.operation
    });

    // 3. Tentar processar imediatamente se houver worker disponível
    setImmediate(() => this.processNextJob());

    return createdJob;
  }

  /**
   * Processa próximo job da fila se houver worker disponível
   */
  async processNextJob(): Promise<void> {
    // Evitar processamento concorrente
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      // Verificar se há workers disponíveis
      const availableWorkers = await this.storage.getAvailableWorkers();
      if (availableWorkers === 0) {
        logger.debug('⏸️ No workers available, waiting...');
        return;
      }

      // Pegar próximo job da fila
      const jobId = await this.storage.dequeueJob();
      if (!jobId) {
        logger.debug('📭 Queue is empty');
        return;
      }

      const job = await this.storage.getJob(jobId);
      if (!job) {
        logger.warn('⚠️ Job not found', { jobId });
        return;
      }

      // Skip VPS jobs - they are handled by LocalWorkerService
      if (this.isVPSJob(job.operation)) {
        // Re-enqueue for LocalWorkerService to pick up
        await this.storage.enqueueJob(jobId);

        // Track consecutive VPS skips to avoid log spam
        this.vpsJobSkipCount++;
        const now = Date.now();
        const timeSinceLastSkip = now - this.lastVpsSkipTime;
        this.lastVpsSkipTime = now;

        // Log only once per batch of VPS jobs (if skipped within 1 second, it's the same batch)
        if (this.vpsJobSkipCount === 1 || timeSinceLastSkip > 1000) {
          logger.debug('🔄 VPS job detected, skipping QueueManager (LocalWorkerService will handle)', {
            jobId,
            operation: job.operation,
            consecutiveSkips: this.vpsJobSkipCount
          });
        }

        // Add delay if we're repeatedly hitting VPS jobs to avoid tight loop
        // This gives LocalWorkerService time to pick up the jobs
        if (this.vpsJobSkipCount > 3) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        }

        return;
      }

      // Reset VPS skip counter when we process a GPU job
      this.vpsJobSkipCount = 0;

      // Calcular workers necessários
      const workersNeeded = this.calculateWorkersNeeded(job);

      // Verificar se há workers suficientes
      if (workersNeeded > availableWorkers) {
        // Re-enfileirar e aguardar
        await this.storage.enqueueJob(jobId);
        logger.info('⏳ Not enough workers, re-queuing job', {
          jobId,
          needed: workersNeeded,
          available: availableWorkers
        });
        return;
      }

      // Reservar workers
      const reserved = await this.storage.reserveWorkers(workersNeeded);
      if (!reserved) {
        // Re-enfileirar se reserva falhou
        await this.storage.enqueueJob(jobId);
        logger.warn('❌ Failed to reserve workers, re-queuing', { jobId });
        return;
      }

      // Atualizar job com workers reservados
      await this.storage.updateJob(jobId, {
        workersReserved: workersNeeded
      });

      // Submeter ao RunPod (não aguarda conclusão)
      await this.submitToRunPod(job, workersNeeded);

    } catch (error) {
      logger.error('❌ Error processing next job', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    } finally {
      this.processing = false;

      // Tentar processar próximo job
      setImmediate(() => this.processNextJob());
    }
  }

  /**
   * Submete job ao RunPod (pode ser multi-worker)
   */
  private async submitToRunPod(job: Job, workersNeeded: number): Promise<void> {
    try {
      logger.info('🚀 Submitting job to RunPod', {
        jobId: job.jobId,
        operation: job.operation,
        workersNeeded
      });

      let runpodJobIds: string[] = [];

      // Multi-worker para img2vid com muitas imagens
      if (job.operation === 'img2vid' && workersNeeded > 1) {
        const images = job.payload.images;
        const imagesPerWorker = Math.ceil(images.length / workersNeeded);

        // Dividir imagens em chunks
        for (let i = 0; i < images.length; i += imagesPerWorker) {
          const chunk = images.slice(i, i + imagesPerWorker);
          const chunkPayload = {
            ...job.payload,
            images: chunk,
            start_index: i // Índice global para nomenclatura correta
          };

          const runpodJob = await this.runpodService.submitJob(job.operation, chunkPayload);
          runpodJobIds.push(runpodJob.id);

          logger.info('📦 Sub-job submitted', {
            jobId: job.jobId,
            runpodJobId: runpodJob.id,
            imagesInChunk: chunk.length,
            startIndex: i
          });
        }
      } else {
        // Single worker
        const runpodJob = await this.runpodService.submitJob(job.operation, job.payload);
        runpodJobIds = [runpodJob.id];

        logger.info('📦 Job submitted', {
          jobId: job.jobId,
          runpodJobId: runpodJob.id
        });
      }

      // Atualizar job com runpodJobIds e status SUBMITTED
      await this.storage.updateJob(job.jobId, {
        runpodJobIds,
        status: 'SUBMITTED',
        submittedAt: new Date()
      });

      logger.info('✅ Job submitted successfully', {
        jobId: job.jobId,
        runpodJobIds
      });

    } catch (error) {
      // Falha na submissão - libera workers e marca job como falho
      await this.storage.releaseWorkers(job.workersReserved);
      await this.storage.updateJob(job.jobId, {
        status: 'FAILED',
        error: error instanceof Error ? error.message : 'Failed to submit to RunPod',
        completedAt: new Date()
      });

      logger.error('❌ Failed to submit job to RunPod', {
        jobId: job.jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Calcula quantos workers são necessários para um job
   */
  private calculateWorkersNeeded(job: Job): number {
    if (job.operation === 'img2vid') {
      const imageCount = job.payload.images?.length || 0;

      // Usar múltiplos workers para batches grandes
      if (imageCount > 50) {
        return Math.min(3, Math.ceil(imageCount / 34));
      }
    }

    // Operações padrão (caption, addaudio) usam 1 worker
    return 1;
  }

  /**
   * Libera worker e processa próximo job da fila
   */
  async releaseWorker(count: number = 1): Promise<void> {
    await this.storage.releaseWorkers(count);
    logger.info('🔓 Workers released, processing next job', { count });

    // Tentar processar próximo job
    setImmediate(() => this.processNextJob());
  }

  /**
   * Retorna estatísticas da fila
   */
  async getStats(): Promise<QueueStats> {
    return await this.storage.getQueueStats();
  }

  /**
   * Verifica se job é VPS (processado localmente)
   */
  private isVPSJob(operation: string): boolean {
    return operation.includes('_vps');
  }

  /**
   * Força processamento da fila (útil para debugging)
   */
  async forceProcess(): Promise<void> {
    logger.info('🔨 Force processing queue');
    await this.processNextJob();
  }
}
