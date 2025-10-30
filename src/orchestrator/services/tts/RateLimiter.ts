// ============================================
// Global Rate Limiter for TTS Providers
// Prevents exceeding API rate limits across all concurrent requests
// ============================================

import { logger } from '../../../shared/utils/logger';

interface QueuedRequest {
  id: string;
  execute: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
  timestamp: number;
}

export class RateLimiter {
  private queue: QueuedRequest[] = [];
  private activeRequests = 0;
  private readonly maxConcurrent: number;
  private readonly providerName: string;
  private requestCounter = 0;

  constructor(providerName: string, maxConcurrent: number) {
    this.providerName = providerName;
    this.maxConcurrent = maxConcurrent;

    logger.info(`[RateLimiter] Initialized for ${providerName}`, {
      maxConcurrent
    });
  }

  /**
   * Execute a request with rate limiting
   * Automatically queues if limit reached
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const requestId = `${this.providerName}-${++this.requestCounter}`;

    return new Promise<T>((resolve, reject) => {
      const request: QueuedRequest = {
        id: requestId,
        execute: fn,
        resolve,
        reject,
        timestamp: Date.now()
      };

      this.queue.push(request);

      logger.debug(`[RateLimiter] Request ${requestId} queued`, {
        queueLength: this.queue.length,
        activeRequests: this.activeRequests,
        maxConcurrent: this.maxConcurrent
      });

      this.processQueue();
    });
  }

  /**
   * Process queued requests respecting rate limits
   */
  private async processQueue(): Promise<void> {
    // Check if we can process more requests
    while (this.activeRequests < this.maxConcurrent && this.queue.length > 0) {
      const request = this.queue.shift();
      if (!request) break;

      this.activeRequests++;

      const waitTime = Date.now() - request.timestamp;

      logger.info(`[RateLimiter] Executing request ${request.id}`, {
        activeRequests: this.activeRequests,
        maxConcurrent: this.maxConcurrent,
        queueLength: this.queue.length,
        waitTimeMs: waitTime
      });

      // Execute request (don't await - run in parallel)
      this.executeRequest(request);
    }

    // Log queue status if there are waiting requests
    if (this.queue.length > 0) {
      logger.warn(`[RateLimiter] Rate limit reached for ${this.providerName}`, {
        waiting: this.queue.length,
        active: this.activeRequests,
        maxConcurrent: this.maxConcurrent
      });
    }
  }

  /**
   * Execute individual request with error handling
   */
  private async executeRequest(request: QueuedRequest): Promise<void> {
    try {
      const result = await request.execute();
      request.resolve(result);

      logger.debug(`[RateLimiter] Request ${request.id} completed successfully`, {
        activeRequests: this.activeRequests - 1,
        queueLength: this.queue.length
      });

    } catch (error: any) {
      logger.error(`[RateLimiter] Request ${request.id} failed`, {
        error: error.message,
        activeRequests: this.activeRequests - 1,
        queueLength: this.queue.length
      });

      request.reject(error);

    } finally {
      this.activeRequests--;
      // Process next items in queue
      this.processQueue();
    }
  }

  /**
   * Get current status
   */
  getStatus(): { active: number; queued: number; maxConcurrent: number } {
    return {
      active: this.activeRequests,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }

  /**
   * Clear queue (for cleanup/shutdown)
   */
  clear(): void {
    const clearedCount = this.queue.length;
    this.queue.forEach(req => {
      req.reject(new Error('Rate limiter cleared'));
    });
    this.queue = [];

    logger.info(`[RateLimiter] Queue cleared for ${this.providerName}`, {
      clearedCount
    });
  }
}

// ============================================
// Global Rate Limiter Instances
// ============================================

/**
 * Fish Audio: Max 5 concurrent requests
 * Docs: https://docs.fish.audio/developer-platform/models-pricing/pricing-and-rate-limits
 */
export const fishAudioRateLimiter = new RateLimiter('FishAudio', 5);

/**
 * ElevenLabs: Max 2 concurrent requests (free tier)
 * Higher limits available in paid tiers
 */
export const elevenLabsRateLimiter = new RateLimiter('ElevenLabs', 2);
