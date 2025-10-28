// ============================================
// ElevenLabs TTS Provider
// Documentation: https://elevenlabs.io/docs/api-reference/text-to-speech/convert
// ============================================

import axios, { AxiosError } from 'axios';
import { TTSProvider, TTSGenerationParams, TTSGenerationResult } from './TTSProvider';
import { logger } from '../../../shared/utils/logger';

export class ElevenLabsProvider extends TTSProvider {
  private readonly baseUrl = 'https://api.elevenlabs.io/v1';
  private readonly model = 'eleven_multilingual_v2';

  constructor(apiKey: string, maxRetries: number = 3) {
    super(apiKey, maxRetries);
    this.validateConfig();
  }

  validateConfig(): void {
    if (!this.apiKey || this.apiKey.trim() === '') {
      throw new Error('ElevenLabs API key is required');
    }
  }

  getProviderName(): string {
    return 'ElevenLabs';
  }

  async generateAudio(params: TTSGenerationParams): Promise<TTSGenerationResult> {
    const { text, voiceId, speed = 1.0 } = params;

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
          speed
        });

        const endpoint = `${this.baseUrl}/text-to-speech/${voiceId}`;

        const response = await axios.post(
          endpoint,
          {
            text,
            model_id: this.model,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              speed,
              use_speaker_boost: true
            }
          },
          {
            headers: {
              'xi-api-key': this.apiKey,
              'Content-Type': 'application/json'
            },
            params: {
              output_format: 'mp3_44100_128' // MP3, 44.1kHz, 128kbps
            },
            responseType: 'arraybuffer',
            timeout: 60000, // 60s timeout
            validateStatus: (status) => status < 500 // Don't throw on 4xx errors
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
          textPreview: text.substring(0, 50)
        });

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

  private parseErrorResponse(data: any): string {
    try {
      // Try to parse as JSON if it's a buffer
      if (Buffer.isBuffer(data)) {
        const jsonStr = data.toString('utf-8');
        const errorObj = JSON.parse(jsonStr);

        // ElevenLabs error format
        if (errorObj.detail) {
          if (typeof errorObj.detail === 'string') {
            return errorObj.detail;
          }
          if (Array.isArray(errorObj.detail)) {
            return errorObj.detail.map((d: any) => d.msg || JSON.stringify(d)).join(', ');
          }
        }

        return errorObj.error || errorObj.message || 'Unknown error';
      }
      return String(data);
    } catch {
      return 'Unknown error';
    }
  }

  private parseError(error: unknown): { message: string; code?: string; status?: number } {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
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
