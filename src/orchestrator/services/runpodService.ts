// ============================================
// RunPod Serverless Service
// ============================================

import axios, { AxiosInstance } from 'axios';
import { logger } from '../../shared/utils/logger';
import {
  RunPodJobRequest,
  RunPodJobResponse,
  RunPodEndpointConfig,
  VideoResponse
} from '../../shared/types';

export class RunPodService {
  private client: AxiosInstance;
  private endpointId: string;
  private config: RunPodEndpointConfig;

  constructor() {
    this.endpointId = process.env.RUNPOD_ENDPOINT_ID!;
    const apiKey = process.env.RUNPOD_API_KEY!;

    if (!this.endpointId || !apiKey) {
      throw new Error('RUNPOD_ENDPOINT_ID and RUNPOD_API_KEY are required');
    }

    this.config = {
      endpointId: this.endpointId,
      apiKey,
      idleTimeout: parseInt(process.env.RUNPOD_IDLE_TIMEOUT || '300'), // 5min default
      maxTimeout: parseInt(process.env.RUNPOD_MAX_TIMEOUT || '600') // 10min default
    };

    this.client = axios.create({
      baseURL: 'https://api.runpod.ai/v2',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 0 // No timeout - let Express server handle it
    });

    logger.info('🚀 RunPodService initialized', {
      endpointId: this.endpointId,
      idleTimeout: this.config.idleTimeout,
      maxTimeout: this.config.maxTimeout
    });
  }

  /**
   * Process video using RunPod Serverless
   * Handles job submission, polling, and result retrieval
   * For large batches (>50 images), automatically splits into multiple workers
   */
  async processVideo(
    operation: 'caption' | 'img2vid' | 'addaudio',
    data: any
  ): Promise<VideoResponse | any> {
    const startTime = Date.now();

    try {
      // Auto-detect multi-worker strategy for img2vid with large batches
      if (operation === 'img2vid' && data.images && data.images.length > 50) {
        logger.info(`📦 Large batch detected (${data.images.length} images), using multi-worker strategy`);
        return await this.processVideoMultiWorker(operation, data, startTime);
      }

      // Single worker processing (default)
      logger.info(`🎬 Starting ${operation} job`, { data });

      // 1. Submit job to RunPod (async mode)
      const job = await this.submitJob(operation, data);

      logger.info('📤 Job submitted to RunPod', {
        jobId: job.id,
        status: job.status,
        operation
      });

      // 2. Poll for job completion
      const result = await this.pollJobStatus(job.id);

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      logger.info('✅ Job completed successfully', {
        jobId: job.id,
        durationMs,
        durationSec: (durationMs / 1000).toFixed(2)
      });

      // 3. Return results (all operations upload to S3)
      if (operation === 'img2vid' && result.output.videos) {
        logger.info(`✅ Videos uploaded to S3: ${result.output.videos.length} videos`);

        return {
          code: 200,
          message: result.output.message || 'Images converted to videos and uploaded to S3 successfully',
          videos: result.output.videos.map((v: any) => ({
            id: v.id,
            video_url: v.video_url,
            filename: v.filename
          })),
          execution: {
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(endTime).toISOString(),
            durationMs,
            durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
          },
          stats: {
            jobId: job.id,
            delayTime: result.delayTime,
            executionTime: result.executionTime,
            total: result.output.total,
            processed: result.output.processed
          }
        };
      }

      // For single video operations (caption, addaudio) - return S3 URLs
      logger.info(`✅ Video uploaded to S3: ${result.output.video_url}`);

      return {
        code: 200,
        message: `Video ${operation} completed and uploaded to S3 successfully`,
        video_url: result.output.video_url,
        execution: {
          startTime: new Date(startTime).toISOString(),
          endTime: new Date(endTime).toISOString(),
          durationMs,
          durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
        },
        stats: {
          jobId: job.id,
          delayTime: result.delayTime,
          executionTime: result.executionTime
        }
      };

    } catch (error) {
      logger.error(`❌ RunPod job failed`, {
        operation,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Submit job to RunPod endpoint (async mode)
   */
  private async submitJob(
    operation: 'caption' | 'img2vid' | 'addaudio',
    data: any
  ): Promise<RunPodJobResponse> {
    const payload: RunPodJobRequest = {
      input: {
        operation,
        ...data
      }
    };

    try {
      const response = await this.client.post(
        `/${this.endpointId}/run`,
        payload
      );

      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error('RunPod API error', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message
        });

        throw new Error(
          `RunPod API error: ${error.response?.data?.error || error.message}`
        );
      }

      throw error;
    }
  }

  /**
   * Poll job status until completion or failure
   * Implements exponential backoff to reduce API calls
   */
  private async pollJobStatus(
    jobId: string,
    maxAttempts: number = 60 // ~8min max (optimized for RTX A4500)
  ): Promise<RunPodJobResponse> {
    let attempt = 0;
    let delay = 2000; // Start with 2s (more responsive)
    const maxDelay = 8000; // Max 8s between polls
    let lastStatus = '';
    const startTime = Date.now();

    logger.info('⏳ Polling RunPod job status', {
      jobId,
      maxWaitTime: `${(maxAttempts * maxDelay / 1000 / 60).toFixed(1)}min`
    });

    while (attempt < maxAttempts) {
      try {
        const response = await this.client.get<RunPodJobResponse>(
          `/${this.endpointId}/status/${jobId}`
        );

        const job = response.data;
        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

        // Log only when status changes or every 10 attempts
        if (job.status !== lastStatus || attempt % 10 === 0) {
          logger.info('📊 RunPod job status', {
            jobId,
            status: job.status,
            attempt: attempt + 1,
            elapsedSec,
            delayTime: job.delayTime ? `${(job.delayTime / 1000).toFixed(1)}s` : undefined,
            executionTime: job.executionTime ? `${(job.executionTime / 1000).toFixed(1)}s` : undefined
          });
          lastStatus = job.status;
        }

        // Job completed successfully
        if (job.status === 'COMPLETED') {
          if (!job.output) {
            throw new Error('Job completed but no output returned');
          }
          logger.info('✅ RunPod job completed', {
            jobId,
            totalTime: `${elapsedSec}s`,
            delayTime: job.delayTime ? `${(job.delayTime / 1000).toFixed(1)}s` : undefined,
            executionTime: job.executionTime ? `${(job.executionTime / 1000).toFixed(1)}s` : undefined
          });

          return job;
        }

        // Job failed
        if (job.status === 'FAILED') {
          logger.error('❌ RunPod job failed', {
            jobId,
            error: job.error,
            totalTime: `${elapsedSec}s`
          });
          throw new Error(job.error || 'Job failed without error message');
        }

        // Job cancelled or timed out
        if (job.status === 'CANCELLED' || job.status === 'TIMED_OUT') {
          logger.error('❌ RunPod job aborted', {
            jobId,
            status: job.status,
            totalTime: `${elapsedSec}s`
          });
          throw new Error(`Job ${job.status.toLowerCase()}`);
        }

        // Still in queue or processing, continue polling
        attempt++;

        // Exponential backoff: 2s → 3s → 4.5s → 5s (max)
        delay = Math.min(delay * 1.5, maxDelay);

        await this.sleep(delay);

      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          // Job not found, might still be initializing
          logger.warn('Job not found, retrying...', { jobId, attempt });
          attempt++;
          await this.sleep(delay);
          continue;
        }

        throw error;
      }
    }

    throw new Error(`Job polling timeout after ${maxAttempts} attempts`);
  }

  /**
   * Check endpoint health
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await this.client.get(`/${this.endpointId}/health`);
      return response.data.status === 'running';
    } catch (error) {
      logger.error('RunPod health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return false;
    }
  }

  /**
   * Cancel a running job
   */
  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.client.post(`/${this.endpointId}/cancel/${jobId}`);
      logger.info('🛑 Job cancelled', { jobId });
    } catch (error) {
      logger.error('Failed to cancel job', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get job status (single check, no polling)
   */
  async getJobStatus(jobId: string): Promise<RunPodJobResponse> {
    try {
      const response = await this.client.get<RunPodJobResponse>(
        `/${this.endpointId}/status/${jobId}`
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `Failed to get job status: ${error.response?.data?.error || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Utility: Sleep for specified ms
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get endpoint configuration
   */
  getConfig(): RunPodEndpointConfig {
    return { ...this.config };
  }

  /**
   * Process large batches using multiple workers in parallel
   * Splits images into chunks and distributes across available workers
   */
  private async processVideoMultiWorker(
    operation: 'img2vid',
    data: any,
    startTime: number
  ): Promise<VideoResponse> {
    const images = data.images;
    const totalImages = images.length;

    // Calculate optimal distribution
    const MAX_WORKERS = 3; // RunPod endpoint max workers
    const IMAGES_PER_WORKER = Math.ceil(totalImages / MAX_WORKERS);

    logger.info('🔀 Multi-worker distribution', {
      totalImages,
      maxWorkers: MAX_WORKERS,
      imagesPerWorker: IMAGES_PER_WORKER
    });

    // Split images into chunks
    const workerBatches: any[][] = [];
    for (let i = 0; i < totalImages; i += IMAGES_PER_WORKER) {
      workerBatches.push(images.slice(i, i + IMAGES_PER_WORKER));
    }

    logger.info(`📦 Created ${workerBatches.length} worker batches`);

    // Submit all jobs in parallel
    const jobPromises = workerBatches.map((batch, idx) => {
      logger.info(`🚀 Submitting job ${idx + 1}/${workerBatches.length} with ${batch.length} images`);
      return this.submitJob(operation, { ...data, images: batch });
    });

    const jobs = await Promise.all(jobPromises);

    logger.info(`✅ All ${jobs.length} jobs submitted`, {
      jobIds: jobs.map(j => j.id)
    });

    // Poll all jobs in parallel
    const results = await Promise.all(
      jobs.map((job, idx) => {
        logger.info(`⏳ Polling job ${idx + 1}/${jobs.length}: ${job.id}`);
        return this.pollJobStatus(job.id);
      })
    );

    logger.info('✅ All jobs completed, merging results');

    // Collect all videos from all workers (already uploaded to S3)
    const allVideos: any[] = [];
    for (const result of results) {
      if (result.output.videos) {
        allVideos.push(...result.output.videos.map((v: any) => ({
          id: v.id,
          video_url: v.video_url,
          filename: v.filename
        })));
      }
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    logger.info('✅ Multi-worker processing completed', {
      totalImages,
      workersUsed: workerBatches.length,
      totalVideos: allVideos.length,
      durationSec: (durationMs / 1000).toFixed(2)
    });

    return {
      code: 200,
      message: `${totalImages} images processed across ${workerBatches.length} workers and uploaded to S3`,
      videos: allVideos,
      execution: {
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      },
      stats: {
        totalImages,
        workersUsed: workerBatches.length,
        imagesPerWorker: IMAGES_PER_WORKER,
        processed: allVideos.length
      }
    };
  }
}
