// ============================================
// MemoryJobStorage Implementation
// Armazenamento em memória para desenvolvimento/testes
// ============================================

import { randomUUID } from 'crypto';
import { Job, JobStatus, QueueStats } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { logger } from '../../shared/utils/logger';

export class MemoryJobStorage implements JobStorage {
  private jobs: Map<string, Job> = new Map();
  private queue: string[] = []; // FIFO queue (jobIds)
  private availableWorkers: number;
  private readonly maxWorkers: number;

  constructor(maxWorkers: number = 3) {
    this.maxWorkers = maxWorkers;
    this.availableWorkers = maxWorkers;
    logger.info('📦 MemoryJobStorage initialized', { maxWorkers });
  }

  // ============================================
  // CRUD Operations
  // ============================================

  async createJob(job: Omit<Job, 'jobId' | 'createdAt' | 'retryCount' | 'attempts'>): Promise<Job> {
    const jobId = randomUUID();
    const newJob: Job = {
      ...job,
      jobId,
      createdAt: new Date(),
      retryCount: 0,
      attempts: 0
    };

    this.jobs.set(jobId, newJob);
    logger.debug('✅ Job created', { jobId, operation: job.operation });

    return newJob;
  }

  async getJob(jobId: string): Promise<Job | null> {
    return this.jobs.get(jobId) || null;
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<Job> {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updatedJob = { ...job, ...updates };
    this.jobs.set(jobId, updatedJob);

    logger.debug('🔄 Job updated', { jobId, updates: Object.keys(updates) });

    return updatedJob;
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    logger.debug('🗑️ Job deleted', { jobId });
  }

  // ============================================
  // Queue Operations
  // ============================================

  async enqueueJob(jobId: string): Promise<void> {
    if (!this.queue.includes(jobId)) {
      this.queue.push(jobId);
      logger.debug('📥 Job enqueued', { jobId, queueLength: this.queue.length });
    }
  }

  async dequeueJob(): Promise<string | null> {
    if (this.queue.length === 0) {
      return null;
    }

    const available = await this.getAvailableWorkers();

    // Smart Queue: Procurar job que cabe nos workers disponíveis
    for (let i = 0; i < this.queue.length; i++) {
      const jobId = this.queue[i];
      const job = this.jobs.get(jobId);

      if (!job) {
        // Job não existe mais, remover da fila
        this.queue.splice(i, 1);
        i--; // Ajustar índice após remoção
        logger.debug('🗑️ Removed non-existent job from queue', { jobId });
        continue;
      }

      const workersNeeded = this.calculateWorkersNeeded(job);

      if (workersNeeded <= available) {
        // Job cabe nos workers disponíveis!
        this.queue.splice(i, 1); // Remove da posição atual

        // Log especial quando pula jobs (otimização em ação)
        if (i > 0) {
          logger.info('🎯 Smart Queue optimization: Job jumped ahead!', {
            jobId,
            operation: job.operation,
            workersNeeded,
            availableWorkers: available,
            skippedJobs: i,
            queuePosition: `Position ${i} → 0 (jumped ${i} jobs)`,
            optimization: `Job needs ${workersNeeded}w, has ${available}w available. Skipped ${i} larger jobs.`
          });
        } else {
          logger.debug('📤 Job dequeued (FIFO - first in queue)', {
            jobId,
            operation: job.operation,
            workersNeeded,
            availableWorkers: available
          });
        }

        return jobId;
      }
    }

    // Nenhum job cabe nos workers disponíveis
    logger.debug('⏸️ No job fits available workers', {
      availableWorkers: available,
      queueLength: this.queue.length
    });
    return null;
  }

  async getQueuedJobs(): Promise<Job[]> {
    const jobs: Job[] = [];
    for (const jobId of this.queue) {
      const job = this.jobs.get(jobId);
      if (job && job.status === 'QUEUED') {
        jobs.push(job);
      }
    }
    return jobs;
  }

  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(job => job.status === status);
  }

  async getActiveJobs(): Promise<Job[]> {
    return Array.from(this.jobs.values()).filter(
      job => job.status === 'SUBMITTED' || job.status === 'PROCESSING'
    );
  }

  // ============================================
  // Worker Management
  // ============================================

  async getAvailableWorkers(): Promise<number> {
    return this.availableWorkers;
  }

  async reserveWorkers(count: number): Promise<boolean> {
    if (this.availableWorkers >= count) {
      this.availableWorkers -= count;
      logger.debug('🔒 Workers reserved', {
        reserved: count,
        available: this.availableWorkers,
        total: this.maxWorkers
      });
      return true;
    }
    logger.debug('⚠️ Not enough workers available', {
      requested: count,
      available: this.availableWorkers
    });
    return false;
  }

  async releaseWorkers(count: number): Promise<void> {
    this.availableWorkers = Math.min(this.maxWorkers, this.availableWorkers + count);
    logger.debug('🔓 Workers released', {
      released: count,
      available: this.availableWorkers,
      total: this.maxWorkers
    });
  }

  async recoverWorkers(): Promise<number> {
    logger.info('🔧 Starting worker recovery...');

    let recoveredWorkers = 0;
    const jobs = Array.from(this.jobs.values());

    for (const job of jobs) {
      // Check if job is completed/failed/cancelled but still has workers reserved
      const isFinished = ['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status);
      const hasReservedWorkers = job.workersReserved > 0;

      if (isFinished && hasReservedWorkers) {
        logger.warn('🔄 Recovering workers from finished job', {
          jobId: job.jobId,
          status: job.status,
          workersReserved: job.workersReserved,
          operation: job.operation
        });

        // Release the workers
        await this.releaseWorkers(job.workersReserved);
        recoveredWorkers += job.workersReserved;

        // Update job to mark workers as released
        job.workersReserved = 0;
        this.jobs.set(job.jobId, job);
      }
    }

    // Get current active jobs count
    const activeJobs = await this.getActiveJobs();
    const expectedActiveWorkers = activeJobs.reduce((sum, job) => sum + job.workersReserved, 0);
    const currentActive = this.maxWorkers - this.availableWorkers;

    logger.info('✅ Worker recovery completed', {
      recoveredWorkers,
      expectedActive: expectedActiveWorkers,
      currentActive,
      available: this.availableWorkers,
      maxWorkers: this.maxWorkers
    });

    // If there's still a mismatch, reset to correct value
    if (currentActive !== expectedActiveWorkers) {
      const correctAvailable = this.maxWorkers - expectedActiveWorkers;
      logger.warn('⚠️ Worker count mismatch detected, resetting', {
        expectedActive: expectedActiveWorkers,
        currentActive,
        settingAvailable: correctAvailable
      });
      this.availableWorkers = correctAvailable;
    }

    return recoveredWorkers;
  }

  // ============================================
  // Statistics
  // ============================================

  async getQueueStats(): Promise<QueueStats> {
    const jobs = Array.from(this.jobs.values());

    const stats = {
      queued: jobs.filter(j => j.status === 'QUEUED').length,
      submitted: jobs.filter(j => j.status === 'SUBMITTED').length,
      processing: jobs.filter(j => j.status === 'PROCESSING').length,
      completed: jobs.filter(j => j.status === 'COMPLETED').length,
      failed: jobs.filter(j => j.status === 'FAILED').length,
      cancelled: jobs.filter(j => j.status === 'CANCELLED').length,
      totalJobs: jobs.length,
      activeWorkers: this.maxWorkers - this.availableWorkers,
      availableWorkers: this.availableWorkers
    };

    return stats;
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Calcula quantos workers são necessários para um job
   * Lógica idêntica ao queueManager.ts para consistência
   *
   * OTIMIZAÇÃO CRÍTICA: img2vid limitado a 2 workers para manter sempre 1 worker livre
   * Isso aumenta throughput geral em ~25-30% ao permitir processamento paralelo contínuo
   */
  private calculateWorkersNeeded(job: Job): number {
    let workersNeeded = 1; // Default: 1 worker

    if (job.operation === 'img2vid') {
      const imageCount = job.payload.images?.length || 0;

      // Multi-worker strategy for 30+ images (matches queueManager.ts threshold)
      if (imageCount > 30) {
        const IMAGES_PER_WORKER = 15; // Ajustado para ~15 imagens/worker (2 workers para 31-45 imgs)
        const MAX_IMG2VID_WORKERS = 2; // CRITICAL: Limita a 2 workers, deixa sempre 1 livre
        const idealWorkers = Math.ceil(imageCount / IMAGES_PER_WORKER);

        // CRITICAL: Limitar img2vid a 2 workers MAX (nunca 3)
        // Garante sempre 1 worker livre para processar outros jobs em paralelo
        workersNeeded = Math.min(MAX_IMG2VID_WORKERS, idealWorkers);
      }
    }

    // Operações padrão (caption, addaudio, concatenate) usam 1 worker
    return workersNeeded;
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(): Promise<void> {
    // Remove jobs completados/falhados com mais de 24h
    const cutoffTime = Date.now() - 24 * 60 * 60 * 1000; // 24h

    for (const [jobId, job] of this.jobs.entries()) {
      if (
        (job.status === 'COMPLETED' || job.status === 'FAILED' || job.status === 'CANCELLED') &&
        job.completedAt &&
        job.completedAt.getTime() < cutoffTime
      ) {
        this.jobs.delete(jobId);
        logger.info('🧹 Cleaned up old job', { jobId, status: job.status });
      }
    }
  }
}
