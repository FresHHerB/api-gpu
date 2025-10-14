import { logger } from '../../shared/utils/logger';
import { Job, JobOperation } from '../../shared/types';
import { JobStorage } from '../queue/jobStorage';
import { LocalVideoProcessor } from '../workers/localVideoProcessor';
import { WebhookService } from '../queue/webhookService';

// ============================================
// Local Worker Service
// Processes jobs locally on VPS using CPU-based FFmpeg
// ============================================

export class LocalWorkerService {
  private storage: JobStorage;
  private processor: LocalVideoProcessor;
  private webhookService: WebhookService;
  private isRunning: boolean = false;
  private maxConcurrentJobs: number;
  private activeJobs: Set<string> = new Set();
  private pollingInterval: number = 5000; // 5 seconds

  constructor(
    storage: JobStorage,
    maxConcurrentJobs: number = 2 // Limit concurrent jobs on VPS
  ) {
    this.storage = storage;
    this.processor = new LocalVideoProcessor();
    this.webhookService = new WebhookService(storage);
    this.maxConcurrentJobs = maxConcurrentJobs;

    logger.info('[LocalWorkerService] Initialized', {
      maxConcurrentJobs
    });
  }

  /**
   * Start processing local jobs
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('[LocalWorkerService] Already running');
      return;
    }

    this.isRunning = true;
    logger.info('[LocalWorkerService] Started');

    // Start polling for jobs
    this.pollForJobs();
  }

  /**
   * Stop processing
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    logger.info('[LocalWorkerService] Stopped');
  }

  /**
   * Poll for queued VPS jobs
   */
  private async pollForJobs(): Promise<void> {
    while (this.isRunning) {
      try {
        // Check if we can take more jobs
        if (this.activeJobs.size < this.maxConcurrentJobs) {
          const availableSlots = this.maxConcurrentJobs - this.activeJobs.size;

          // Get queued VPS jobs
          const queuedJobs = await this.storage.getQueuedJobs();
          const vpsJobs = queuedJobs
            .filter(job => this.isVPSJob(job.operation))
            .slice(0, availableSlots);

          // Process each job
          for (const job of vpsJobs) {
            if (this.activeJobs.size >= this.maxConcurrentJobs) {
              break;
            }

            // Mark as active
            this.activeJobs.add(job.jobId);

            // Process in background
            this.processJob(job).catch(error => {
              logger.error('[LocalWorkerService] Job processing error', {
                jobId: job.jobId,
                error: error.message
              });
            });
          }
        }
      } catch (error: any) {
        logger.error('[LocalWorkerService] Polling error', { error: error.message });
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, this.pollingInterval));
    }
  }

  /**
   * Check if operation is a VPS job
   */
  private isVPSJob(operation: JobOperation): boolean {
    // VPS jobs are marked with "_vps" suffix
    return operation.includes('_vps');
  }

  /**
   * Process a single job
   */
  private async processJob(job: Job): Promise<void> {
    const startTime = new Date();

    try {
      logger.info('[LocalWorkerService] Processing job', {
        jobId: job.jobId,
        operation: job.operation
      });

      // Update status to PROCESSING
      await this.storage.updateJob(job.jobId, {
        status: 'PROCESSING',
        submittedAt: startTime
      });

      // Process based on operation
      let result: any;

      switch (job.operation) {
        case 'caption_segments_vps':
          result = await this.processor.processCaptionSegments(job.payload);
          break;

        case 'caption_highlight_vps':
          result = await this.processor.processCaptionHighlight(job.payload);
          break;

        case 'img2vid_vps':
          result = await this.processor.processImg2Vid(job.payload);
          break;

        case 'addaudio_vps':
          result = await this.processor.processAddAudio(job.payload);
          break;

        case 'concatenate_vps':
          result = await this.processor.processConcatenate(job.payload);
          break;

        default:
          throw new Error(`Unknown VPS operation: ${job.operation}`);
      }

      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      // Update job as completed
      await this.storage.updateJob(job.jobId, {
        status: 'COMPLETED',
        completedAt: endTime,
        result: {
          success: true,
          ...result,
          message: `${job.operation} completed successfully`
        }
      });

      // Send webhook
      await this.sendWebhook(job, 'COMPLETED', result, startTime, endTime, durationMs);

      logger.info('[LocalWorkerService] Job completed', {
        jobId: job.jobId,
        durationSeconds: (durationMs / 1000).toFixed(2)
      });

    } catch (error: any) {
      const endTime = new Date();
      const durationMs = endTime.getTime() - startTime.getTime();

      logger.error('[LocalWorkerService] Job failed', {
        jobId: job.jobId,
        error: error.message
      });

      // Update job as failed
      await this.storage.updateJob(job.jobId, {
        status: 'FAILED',
        completedAt: endTime,
        error: error.message || 'Unknown error occurred'
      });

      // Send error webhook
      await this.sendWebhook(
        job,
        'FAILED',
        null,
        startTime,
        endTime,
        durationMs,
        {
          code: 'VPS_PROCESSING_ERROR',
          message: error.message
        }
      );

    } finally {
      // Remove from active jobs
      this.activeJobs.delete(job.jobId);
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(
    job: Job,
    status: 'COMPLETED' | 'FAILED',
    result: any,
    startTime: Date,
    endTime: Date,
    durationMs: number,
    error?: any
  ): Promise<void> {
    try {
      const payload = {
        jobId: job.jobId,
        idRoteiro: job.idRoteiro,
        pathRaiz: job.pathRaiz,
        status,
        operation: job.operation.replace('_vps', '') as any, // Remove _vps suffix for response
        result: status === 'COMPLETED' ? result : undefined,
        error: status === 'FAILED' ? error : undefined,
        execution: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          durationMs,
          durationSeconds: Math.round(durationMs / 1000)
        }
      };

      await this.webhookService.sendWebhook(job.jobId, job.webhookUrl, payload);

      logger.info('[LocalWorkerService] Webhook sent', {
        jobId: job.jobId,
        status
      });

    } catch (error: any) {
      logger.error('[LocalWorkerService] Webhook failed', {
        jobId: job.jobId,
        error: error.message
      });
    }
  }

  /**
   * Get current stats
   */
  getStats(): { activeJobs: number; maxConcurrent: number } {
    return {
      activeJobs: this.activeJobs.size,
      maxConcurrent: this.maxConcurrentJobs
    };
  }
}
