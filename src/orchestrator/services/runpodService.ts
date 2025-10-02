// ============================================
// RunPod Serverless Service
// ============================================

import axios, { AxiosInstance } from 'axios';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../shared/utils/logger';
import {
  RunPodJobRequest,
  RunPodJobResponse,
  RunPodEndpointConfig,
  VideoResponse
} from '../../shared/types';

// Output directory for decoded videos
const OUTPUT_DIR = path.join(process.cwd(), 'public', 'output');

// Ensure output directory exists
async function ensureOutputDir() {
  try {
    await fs.mkdir(OUTPUT_DIR, { recursive: true });
  } catch (error) {
    logger.error('Failed to create output directory', { error });
  }
}

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
      timeout: this.config.maxTimeout! * 1000 // Convert to ms
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
   */
  async processVideo(
    operation: 'caption' | 'img2vid' | 'addaudio',
    data: any
  ): Promise<VideoResponse | any> {
    const startTime = Date.now();

    try {
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

      // 3. Decode base64 videos and save locally
      await ensureOutputDir();

      // For img2vid batch, all videos are uploaded to VPS directly
      if (operation === 'img2vid' && result.output.videos) {
        const processedVideos = result.output.videos.map((video: any) => {
          logger.info('Video uploaded to VPS by worker', {
            id: video.id,
            video_url: video.video_url
          });

          return {
            id: video.id,
            video_url: video.video_url
          };
        });

        return {
          code: 200,
          message: result.output.message || 'Images converted to videos successfully',
          videos: processedVideos,
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

      // For single video operations (caption, addaudio)
      return {
        code: 200,
        message: `Video ${operation} completed successfully`,
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
          executionTime: result.executionTime,
          ...result.output.stats
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
    maxAttempts: number = 300 // 10min max (2s * 300 = 600s)
  ): Promise<RunPodJobResponse> {
    let attempt = 0;
    let delay = 2000; // Start with 2s
    const maxDelay = 5000; // Max 5s between polls
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
}
