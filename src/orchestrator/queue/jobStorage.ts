// ============================================
// JobStorage Interface
// Abstração para persistência de jobs (Redis ou Memory)
// ============================================

import { Job, JobStatus, QueueStats } from '../../shared/types';

export interface JobStorage {
  // CRUD operations
  createJob(job: Omit<Job, 'jobId' | 'createdAt' | 'retryCount' | 'attempts'>): Promise<Job>;
  getJob(jobId: string): Promise<Job | null>;
  updateJob(jobId: string, updates: Partial<Job>): Promise<Job>;
  deleteJob(jobId: string): Promise<void>;

  // Queue operations
  enqueueJob(jobId: string): Promise<void>;
  dequeueJob(): Promise<string | null>;
  getQueuedJobs(): Promise<Job[]>;
  getJobsByStatus(status: JobStatus): Promise<Job[]>;
  getActiveJobs(): Promise<Job[]>; // SUBMITTED + PROCESSING

  // Worker management
  getAvailableWorkers(): Promise<number>;
  reserveWorkers(count: number): Promise<boolean>;
  releaseWorkers(count: number): Promise<void>;

  // Statistics
  getQueueStats(): Promise<QueueStats>;

  // Cleanup
  cleanup(): Promise<void>;
}
