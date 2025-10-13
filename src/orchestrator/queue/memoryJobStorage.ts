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
    logger.info('✅ Job created', { jobId, operation: job.operation });

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

    logger.info('🔄 Job updated', { jobId, updates: Object.keys(updates) });

    return updatedJob;
  }

  async deleteJob(jobId: string): Promise<void> {
    this.jobs.delete(jobId);
    logger.info('🗑️ Job deleted', { jobId });
  }

  // ============================================
  // Queue Operations
  // ============================================

  async enqueueJob(jobId: string): Promise<void> {
    if (!this.queue.includes(jobId)) {
      this.queue.push(jobId);
      logger.info('📥 Job enqueued', { jobId, queueLength: this.queue.length });
    }
  }

  async dequeueJob(): Promise<string | null> {
    const jobId = this.queue.shift() || null;
    if (jobId) {
      logger.info('📤 Job dequeued', { jobId, remainingInQueue: this.queue.length });
    }
    return jobId;
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
      logger.info('🔒 Workers reserved', {
        reserved: count,
        available: this.availableWorkers,
        total: this.maxWorkers
      });
      return true;
    }
    logger.warn('⚠️ Not enough workers available', {
      requested: count,
      available: this.availableWorkers
    });
    return false;
  }

  async releaseWorkers(count: number): Promise<void> {
    this.availableWorkers = Math.min(this.maxWorkers, this.availableWorkers + count);
    logger.info('🔓 Workers released', {
      released: count,
      available: this.availableWorkers,
      total: this.maxWorkers
    });
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
