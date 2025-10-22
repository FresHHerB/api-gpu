// ============================================
// RedisJobStorage Implementation
// Armazenamento persistente em Redis para produção
// ============================================

import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { Job, JobStatus, QueueStats } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { logger } from '../../shared/utils/logger';
import { retryWorkerOperation } from '../utils/retryHelper';

export class RedisJobStorage implements JobStorage {
  private redis: Redis;
  private readonly maxWorkers: number;
  private readonly jobTTL: number; // TTL em segundos para jobs completados

  constructor(redisUrl: string, maxWorkers: number = 3, jobTTL: number = 86400) {
    this.redis = new Redis(redisUrl);
    this.maxWorkers = maxWorkers;
    this.jobTTL = jobTTL; // 24h default

    // Inicializar workers disponíveis
    this.redis.setnx('orchestrator:workers:available', maxWorkers.toString());

    logger.info('📦 RedisJobStorage initialized', {
      maxWorkers,
      jobTTL: `${jobTTL}s`
    });
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

    // Armazenar job como hash
    const jobKey = `orchestrator:jobs:${jobId}`;
    await this.redis.hset(jobKey, this.serializeJob(newJob));

    logger.debug('✅ Job created in Redis', { jobId, operation: job.operation });

    return newJob;
  }

  async getJob(jobId: string): Promise<Job | null> {
    const jobKey = `orchestrator:jobs:${jobId}`;
    const jobData = await this.redis.hgetall(jobKey);

    if (Object.keys(jobData).length === 0) {
      return null;
    }

    return this.deserializeJob(jobData);
  }

  async updateJob(jobId: string, updates: Partial<Job>): Promise<Job> {
    const job = await this.getJob(jobId);
    if (!job) {
      throw new Error(`Job ${jobId} not found`);
    }

    const updatedJob = { ...job, ...updates };
    const jobKey = `orchestrator:jobs:${jobId}`;

    await this.redis.hset(jobKey, this.serializeJob(updatedJob));

    // Se job completou, definir TTL
    if (
      updatedJob.status === 'COMPLETED' ||
      updatedJob.status === 'FAILED' ||
      updatedJob.status === 'CANCELLED'
    ) {
      await this.redis.expire(jobKey, this.jobTTL);
    }

    logger.debug('🔄 Job updated in Redis', { jobId, updates: Object.keys(updates) });

    return updatedJob;
  }

  async deleteJob(jobId: string): Promise<void> {
    const jobKey = `orchestrator:jobs:${jobId}`;
    await this.redis.del(jobKey);
    logger.debug('🗑️ Job deleted from Redis', { jobId });
  }

  // ============================================
  // Queue Operations
  // ============================================

  async enqueueJob(jobId: string): Promise<void> {
    await this.redis.lpush('orchestrator:queue:pending', jobId);
    logger.debug('📥 Job enqueued in Redis', { jobId });
  }

  async dequeueJob(): Promise<string | null> {
    const jobId = await this.redis.rpop('orchestrator:queue:pending');
    if (jobId) {
      logger.debug('📤 Job dequeued from Redis', { jobId });
    }
    return jobId;
  }

  async getQueuedJobs(): Promise<Job[]> {
    const jobIds = await this.redis.lrange('orchestrator:queue:pending', 0, -1);
    const jobs: Job[] = [];

    for (const jobId of jobIds) {
      const job = await this.getJob(jobId);
      if (job && job.status === 'QUEUED') {
        jobs.push(job);
      }
    }

    return jobs;
  }

  async getJobsByStatus(status: JobStatus): Promise<Job[]> {
    // Scan all job keys
    const keys = await this.redis.keys('orchestrator:jobs:*');
    const jobs: Job[] = [];

    for (const key of keys) {
      const jobData = await this.redis.hgetall(key);
      if (jobData.status === status) {
        jobs.push(this.deserializeJob(jobData));
      }
    }

    return jobs;
  }

  async getActiveJobs(): Promise<Job[]> {
    const keys = await this.redis.keys('orchestrator:jobs:*');
    const jobs: Job[] = [];

    for (const key of keys) {
      const jobData = await this.redis.hgetall(key);
      if (jobData.status === 'SUBMITTED' || jobData.status === 'PROCESSING') {
        jobs.push(this.deserializeJob(jobData));
      }
    }

    return jobs;
  }

  // ============================================
  // Worker Management
  // ============================================

  async getAvailableWorkers(): Promise<number> {
    const value = await this.redis.get('orchestrator:workers:available');
    return parseInt(value || '0', 10);
  }

  async reserveWorkers(count: number): Promise<boolean> {
    // Usar retry para operações críticas de workers
    return await retryWorkerOperation(
      async () => {
        const available = await this.getAvailableWorkers();

        if (available < count) {
          logger.debug('⚠️ Not enough workers available in Redis', {
            requested: count,
            available
          });
          return false;
        }

        // CRITICAL: Operação atômica DECRBY
        const newValue = await this.redis.decrby('orchestrator:workers:available', count);

        // Validação: rollback se ficou negativo (race condition)
        if (newValue < 0) {
          logger.warn('⚠️ Worker reservation caused negative count, rolling back', {
            count,
            newValue
          });
          await this.redis.incrby('orchestrator:workers:available', count);
          return false;
        }

        logger.debug('🔒 Workers reserved in Redis', {
          reserved: count,
          available: newValue,
          total: this.maxWorkers
        });
        return true;
      },
      'Reserve Workers'
    );
  }

  async releaseWorkers(count: number): Promise<void> {
    // CRITICAL: Usar retry para garantir liberação mesmo com falhas temporárias
    await retryWorkerOperation(
      async () => {
        const newValue = await this.redis.incrby('orchestrator:workers:available', count);
        const capped = Math.min(this.maxWorkers, newValue);

        // Validação: cap no máximo se excedeu
        if (newValue > this.maxWorkers) {
          logger.warn('⚠️ Worker release exceeded max, capping', {
            newValue,
            maxWorkers: this.maxWorkers,
            capped
          });
          await this.redis.set('orchestrator:workers:available', capped.toString());
        }

        logger.debug('🔓 Workers released in Redis', {
          released: count,
          available: capped,
          total: this.maxWorkers
        });

        return; // retryWorkerOperation espera Promise<T>
      },
      'Release Workers'
    );
  }

  async recoverWorkers(): Promise<number> {
    logger.info('🔧 Starting worker recovery...');

    // Get all jobs
    const keys = await this.redis.keys('orchestrator:jobs:*');
    let recoveredWorkers = 0;

    for (const key of keys) {
      const jobData = await this.redis.hgetall(key);
      if (Object.keys(jobData).length === 0) continue;

      const job = this.deserializeJob(jobData);

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
        await this.redis.hset(key, 'workersReserved', '0');
      }
    }

    // Get current active jobs count
    const activeJobs = await this.getActiveJobs();
    const expectedActiveWorkers = activeJobs.reduce((sum, job) => sum + job.workersReserved, 0);
    const currentAvailable = await this.getAvailableWorkers();
    const currentActive = this.maxWorkers - currentAvailable;

    logger.info('✅ Worker recovery completed', {
      recoveredWorkers,
      expectedActive: expectedActiveWorkers,
      currentActive,
      available: currentAvailable,
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
      await this.redis.set('orchestrator:workers:available', correctAvailable.toString());
    }

    return recoveredWorkers;
  }

  // ============================================
  // Statistics
  // ============================================

  async getQueueStats(): Promise<QueueStats> {
    const keys = await this.redis.keys('orchestrator:jobs:*');
    const jobs: Job[] = [];

    for (const key of keys) {
      const jobData = await this.redis.hgetall(key);
      if (Object.keys(jobData).length > 0) {
        jobs.push(this.deserializeJob(jobData));
      }
    }

    const available = await this.getAvailableWorkers();

    const stats = {
      queued: jobs.filter(j => j.status === 'QUEUED').length,
      submitted: jobs.filter(j => j.status === 'SUBMITTED').length,
      processing: jobs.filter(j => j.status === 'PROCESSING').length,
      completed: jobs.filter(j => j.status === 'COMPLETED').length,
      failed: jobs.filter(j => j.status === 'FAILED').length,
      cancelled: jobs.filter(j => j.status === 'CANCELLED').length,
      totalJobs: jobs.length,
      activeWorkers: this.maxWorkers - available,
      availableWorkers: available
    };

    return stats;
  }

  // ============================================
  // Cleanup
  // ============================================

  async cleanup(): Promise<void> {
    // Redis já usa TTL para limpeza automática
    // Este método pode ser usado para cleanup manual se necessário
    logger.info('🧹 Redis cleanup (TTL handles automatic cleanup)');
  }

  async close(): Promise<void> {
    await this.redis.quit();
    logger.info('👋 Redis connection closed');
  }

  // ============================================
  // Serialization Helpers
  // ============================================

  private serializeJob(job: Job): Record<string, string> {
    return {
      jobId: job.jobId,
      runpodJobIds: JSON.stringify(job.runpodJobIds),
      status: job.status,
      operation: job.operation,
      payload: JSON.stringify(job.payload),
      webhookUrl: job.webhookUrl,
      idRoteiro: job.idRoteiro?.toString() || '',
      pathRaiz: job.pathRaiz || '',
      result: job.result ? JSON.stringify(job.result) : '',
      error: job.error || '',
      workersReserved: job.workersReserved.toString(),
      createdAt: job.createdAt.toISOString(),
      submittedAt: job.submittedAt?.toISOString() || '',
      completedAt: job.completedAt?.toISOString() || '',
      retryCount: job.retryCount.toString(),
      attempts: job.attempts.toString()
    };
  }

  private deserializeJob(data: Record<string, string>): Job {
    return {
      jobId: data.jobId,
      runpodJobIds: JSON.parse(data.runpodJobIds || '[]'),
      status: data.status as JobStatus,
      operation: data.operation as Job['operation'],
      payload: JSON.parse(data.payload),
      webhookUrl: data.webhookUrl,
      idRoteiro: data.idRoteiro ? parseInt(data.idRoteiro, 10) : undefined,
      pathRaiz: data.pathRaiz || undefined,
      result: data.result ? JSON.parse(data.result) : undefined,
      error: data.error || undefined,
      workersReserved: parseInt(data.workersReserved, 10),
      createdAt: new Date(data.createdAt),
      submittedAt: data.submittedAt ? new Date(data.submittedAt) : undefined,
      completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      retryCount: parseInt(data.retryCount, 10),
      attempts: parseInt(data.attempts, 10)
    };
  }
}
