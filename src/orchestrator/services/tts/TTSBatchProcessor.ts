// ============================================
// TTS Batch Processor
// Processes TTS generation in batches with S3 upload
// ============================================

import { TTSProvider } from './TTSProvider';
import { FishAudioProvider } from './FishAudioProvider';
import { ElevenLabsProvider } from './ElevenLabsProvider';
import { S3UploadService } from '../s3Upload';
import { logger } from '../../../shared/utils/logger';

export interface TTSBatchItem {
  id: number;
  trecho: string;
}

export interface TTSBatchConfig {
  plataforma: 'fishaudio' | 'elevenlabs';
  api_key: string;
  voice_id: string;
  speed?: number;
  path: string;
  output_filename: string;
  concurrent_limit?: number;
}

export interface TTSBatchResult {
  success: boolean;
  id: number;
  filename: string;
  s3_url?: string;
  s3_key?: string;
  audio_size_kb?: number;
  error?: string;
  processing_time_ms: number;
}

export interface TTSBatchSummary {
  total: number;
  successful: number;
  failed: number;
  results: TTSBatchResult[];
  total_processing_time_ms: number;
}

export class TTSBatchProcessor {
  private s3Service: S3UploadService;

  constructor() {
    this.s3Service = new S3UploadService();
  }

  /**
   * Process TTS batch with concurrent limit
   */
  async processBatch(
    items: TTSBatchItem[],
    config: TTSBatchConfig
  ): Promise<TTSBatchSummary> {
    const startTime = Date.now();
    const concurrentLimit = config.concurrent_limit || 5;

    logger.info('[TTS Batch] Starting batch processing', {
      total: items.length,
      platform: config.plataforma,
      concurrentLimit,
      path: config.path,
      outputFilename: config.output_filename
    });

    // Create provider
    const provider = this.createProvider(config);

    // Process in batches
    const results: TTSBatchResult[] = [];

    for (let i = 0; i < items.length; i += concurrentLimit) {
      const batch = items.slice(i, i + concurrentLimit);
      const batchNumber = Math.floor(i / concurrentLimit) + 1;
      const totalBatches = Math.ceil(items.length / concurrentLimit);

      logger.info(`[TTS Batch] Processing batch ${batchNumber}/${totalBatches}`, {
        items: batch.length,
        range: `${i + 1}-${Math.min(i + concurrentLimit, items.length)}`
      });

      const batchResults = await Promise.all(
        batch.map(item => this.processItem(item, config, provider))
      );

      results.push(...batchResults);

      logger.info(`[TTS Batch] Batch ${batchNumber}/${totalBatches} complete`, {
        successful: batchResults.filter(r => r.success).length,
        failed: batchResults.filter(r => !r.success).length
      });
    }

    const summary: TTSBatchSummary = {
      total: items.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
      total_processing_time_ms: Date.now() - startTime
    };

    logger.info('[TTS Batch] Batch processing complete', {
      total: summary.total,
      successful: summary.successful,
      failed: summary.failed,
      totalTime: `${(summary.total_processing_time_ms / 1000).toFixed(2)}s`,
      avgTimePerItem: `${(summary.total_processing_time_ms / items.length / 1000).toFixed(2)}s`
    });

    return summary;
  }

  /**
   * Process single item: generate audio + upload to S3
   */
  private async processItem(
    item: TTSBatchItem,
    config: TTSBatchConfig,
    provider: TTSProvider
  ): Promise<TTSBatchResult> {
    const itemStartTime = Date.now();

    try {
      logger.info(`[TTS Batch] Processing item ${item.id}`, {
        textLength: item.trecho.length,
        textPreview: item.trecho.substring(0, 50)
      });

      // Generate audio
      const result = await provider.generateAudio({
        text: item.trecho,
        voiceId: config.voice_id,
        speed: config.speed
      });

      // Generate filename: output_filename1.mp3, output_filename2.mp3, etc.
      const filename = `${config.output_filename}${item.id}.mp3`;

      // Upload to S3
      const s3Url = await this.s3Service.uploadFile(
        config.path,
        filename,
        result.audioBuffer,
        'audio/mpeg'
      );

      // Extract S3 key from URL
      const s3Key = this.extractS3Key(s3Url);

      const processingTime = Date.now() - itemStartTime;

      logger.info(`[TTS Batch] Item ${item.id} completed successfully`, {
        filename,
        s3Key,
        audioSizeKB: (result.audioBuffer.length / 1024).toFixed(2),
        processingTime: `${(processingTime / 1000).toFixed(2)}s`
      });

      return {
        success: true,
        id: item.id,
        filename,
        s3_url: s3Url,
        s3_key: s3Key,
        audio_size_kb: Number((result.audioBuffer.length / 1024).toFixed(2)),
        processing_time_ms: processingTime
      };

    } catch (error: any) {
      const processingTime = Date.now() - itemStartTime;

      logger.error(`[TTS Batch] Item ${item.id} failed`, {
        error: error.message,
        textPreview: item.trecho.substring(0, 50),
        processingTime: `${(processingTime / 1000).toFixed(2)}s`
      });

      return {
        success: false,
        id: item.id,
        filename: `${config.output_filename}${item.id}.mp3`,
        error: error.message,
        processing_time_ms: processingTime
      };
    }
  }

  /**
   * Create TTS provider based on platform
   */
  private createProvider(config: TTSBatchConfig): TTSProvider {
    switch (config.plataforma) {
      case 'fishaudio':
        return new FishAudioProvider(config.api_key);
      case 'elevenlabs':
        return new ElevenLabsProvider(config.api_key);
      default:
        throw new Error(`Unsupported platform: ${config.plataforma}`);
    }
  }

  /**
   * Extract S3 key from full URL
   * Example: https://s3.endpoint.com/bucket/path/file.mp3 -> path/file.mp3
   */
  private extractS3Key(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/').filter(p => p);

      // Remove bucket name (first part)
      if (pathParts.length > 0) {
        pathParts.shift();
      }

      return pathParts.join('/');
    } catch {
      // Fallback: return URL as-is
      return url;
    }
  }
}
