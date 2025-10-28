// ============================================
// TTS Provider Interface
// Common interface for all TTS providers
// ============================================

export interface TTSProviderConfig {
  apiKey: string;
  voiceId: string;
  speed?: number;
  groupId?: string; // For platforms that need it (currently none in our use case)
}

export interface TTSGenerationParams {
  text: string;
  voiceId: string;
  speed?: number;
}

export interface TTSGenerationResult {
  audioBuffer: Buffer;
  duration?: number;
  format: string;
}

export abstract class TTSProvider {
  protected apiKey: string;
  protected maxRetries: number = 3;
  protected retryDelay: number = 2000; // 2 seconds

  constructor(apiKey: string, maxRetries: number = 3) {
    this.apiKey = apiKey;
    this.maxRetries = maxRetries;
  }

  /**
   * Generate audio from text
   * Implements retry logic automatically
   */
  abstract generateAudio(params: TTSGenerationParams): Promise<TTSGenerationResult>;

  /**
   * Get provider name for logging
   */
  abstract getProviderName(): string;

  /**
   * Validate provider-specific configuration
   */
  abstract validateConfig(): void;

  /**
   * Sleep utility for retry delays
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Exponential backoff for retries
   */
  protected getRetryDelay(attempt: number): number {
    return this.retryDelay * Math.pow(2, attempt - 1);
  }
}
