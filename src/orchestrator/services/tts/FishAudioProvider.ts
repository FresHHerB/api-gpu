// ============================================
// Fish Audio TTS Provider (OPTIMIZED + RATE LIMITED)
// Documentation: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
// Rate Limits: https://docs.fish.audio/developer-platform/models-pricing/pricing-and-rate-limits
// ============================================

import { AxiosError, AxiosInstance } from 'axios';
import { TTSProvider, TTSGenerationParams, TTSGenerationResult } from './TTSProvider';
import { createOptimizedHTTPClient } from './OptimizedHTTPClient';
import { fishAudioRateLimiter } from './RateLimiter';
import { logger } from '../../../shared/utils/logger';

export class FishAudioProvider extends TTSProvider {
  private readonly model = 'speech-1.5';
  private readonly httpClient: AxiosInstance;

  constructor(apiKey: string, maxRetries: number = 3) {
    super(apiKey, maxRetries);
    this.validateConfig();

    // Create optimized HTTP client with connection pooling
    this.httpClient = createOptimizedHTTPClient('https://api.fish.audio');
  }

  validateConfig(): void {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('Fish Audio API key is required');
    }
  }

  getProviderName(): string {
    return 'Fish Audio';
  }

  async generateAudio(params: TTSGenerationParams): Promise<TTSGenerationResult> {
    const { text, voiceId, speed = 1.0 } = params;

    // Use global rate limiter to prevent exceeding concurrent request limits
    return fishAudioRateLimiter.execute(async () => {
      return this.generateWithRetry(text, voiceId, speed);
    });
  }

  private async generateWithRetry(text: string, voiceId: string, speed: number): Promise<TTSGenerationResult> {
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        if (attempt > 1) {
          const delay = this.getRetryDelay(attempt);
          logger.warn(`[${this.getProviderName()}] Retry ${attempt}/${this.maxRetries} after ${delay}ms`, {
            textPreview: text.substring(0, 50)
          });
          await this.sleep(delay);
        }

        logger.info(`[${this.getProviderName()}] Generating audio (attempt ${attempt}/${this.maxRetries})`, {
          textLength: text.length,
          voiceId,
          speed,
          rateLimiter: fishAudioRateLimiter.getStatus()
        });

        const response = await this.httpClient.post(
          '/v1/tts',
          {
            text,
            reference_id: voiceId,
            format: 'mp3',
            normalize: true,
            latency: 'balanced', // OPTIMIZED: balanced mode for better latency
            chunk_length: 200, // OPTIMIZED: chunk size for streaming
            ...(speed !== 1.0 && {
              prosody: {
                speed
              }
            })
          },
          {
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Content-Type': 'application/json',
              'model': this.model
            },
            responseType: 'arraybuffer',
            timeout: 60000,
            validateStatus: (status) => status < 500
          }
        );

        // Handle HTTP errors
        if (response.status >= 400) {
          const errorMessage = this.parseErrorResponse(response.data);
          throw new Error(`HTTP ${response.status}: ${errorMessage}`);
        }

        const audioBuffer = Buffer.from(response.data);

        logger.info(`[${this.getProviderName()}] Audio generated successfully`, {
          sizeKB: (audioBuffer.length / 1024).toFixed(2),
          textLength: text.length
        });

        return {
          audioBuffer,
          format: 'mp3'
        };

      } catch (error) {
        const isLastAttempt = attempt === this.maxRetries;
        const errorInfo = this.parseError(error);

        logger.error(`[${this.getProviderName()}] Generation failed (attempt ${attempt}/${this.maxRetries})`, {
          error: errorInfo.message,
          code: errorInfo.code,
          status: errorInfo.status,
          textPreview: text.substring(0, 50),
          rateLimiter: fishAudioRateLimiter.getStatus()
        });

        // Special handling for rate limit errors (429)
        if (errorInfo.status === 429) {
          // Use exponential backoff with longer delays for rate limits
          const rateLimitDelay = this.getRateLimitRetryDelay(attempt);
          logger.warn(`[${this.getProviderName()}] Rate limit hit, waiting ${rateLimitDelay}ms before retry`, {
            attempt,
            maxRetries: this.maxRetries,
            rateLimiter: fishAudioRateLimiter.getStatus()
          });

          if (!isLastAttempt) {
            await this.sleep(rateLimitDelay);
            continue;
          }
        }

        // Don't retry on client errors (4xx) except rate limits
        if (errorInfo.status && errorInfo.status >= 400 && errorInfo.status < 500 && errorInfo.status !== 429) {
          throw new Error(`${this.getProviderName()} error: ${errorInfo.message}`);
        }

        if (isLastAttempt) {
          throw new Error(`${this.getProviderName()} failed after ${this.maxRetries} attempts: ${errorInfo.message}`);
        }
      }
    }

    throw new Error(`${this.getProviderName()} failed: max retries exceeded`);
  }

  /**
   * Get retry delay for rate limit errors (429)
   * Uses exponential backoff with jitter: base * 2^attempt + random(0-1000ms)
   */
  private getRateLimitRetryDelay(attempt: number): number {
    const baseDelay = 5000; // 5 seconds base
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // 0-1000ms random jitter
    const maxDelay = 60000; // Cap at 60 seconds

    return Math.min(exponentialDelay + jitter, maxDelay);
  }

  private parseErrorResponse(data: any): string {
    try {
      // Try to parse as JSON if it's a buffer
      if (Buffer.isBuffer(data)) {
        const jsonStr = data.toString('utf-8');
        const errorObj = JSON.parse(jsonStr);
        return errorObj.error || errorObj.message || 'Unknown error';
      }
      return String(data);
    } catch {
      return 'Unknown error';
    }
  }

  private parseError(error: unknown): { message: string; code?: string; status?: number } {
    const axiosError = error as AxiosError;
    if (axiosError.isAxiosError || axiosError.response) {
      return {
        message: axiosError.message,
        code: axiosError.code,
        status: axiosError.response?.status
      };
    }

    if (error instanceof Error) {
      return { message: error.message };
    }

    return { message: String(error) };
  }
}
