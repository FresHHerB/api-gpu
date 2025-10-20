import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../shared/utils/logger';
import { LocalS3UploadService } from '../services/localS3Upload';
import axios from 'axios';
import { randomUUID } from 'crypto';

// ============================================
// Local Audio Processor (VPS CPU-based)
// Processes audio operations locally using FFmpeg
// ============================================

export class LocalAudioProcessor {
  private s3Service: LocalS3UploadService;
  private workDir: string;

  constructor() {
    this.s3Service = new LocalS3UploadService();
    this.workDir = process.env.VPS_WORK_DIR || '/tmp/vps-work';
    this.ensureWorkDir();
  }

  private async ensureWorkDir() {
    try {
      await fs.mkdir(this.workDir, { recursive: true });
      logger.info('[LocalAudioProcessor] Work directory ready', { workDir: this.workDir });
    } catch (error: any) {
      logger.error('[LocalAudioProcessor] Failed to create work directory', { error: error.message });
    }
  }

  /**
   * Requote URI similar to Python's requests.utils.requote_uri
   * Handles URLs that may already be partially encoded
   */
  private requoteUri(uri: string): string {
    // Characters that should NOT be encoded in URL paths
    const safeChars = /[A-Za-z0-9\-._~:/?#\[\]@!$&'()*+,;=]/;

    let result = '';
    for (let i = 0; i < uri.length; i++) {
      const char = uri[i];

      // Check if already percent-encoded (e.g., %20)
      if (char === '%' && i + 2 < uri.length) {
        const hex = uri.substr(i + 1, 2);
        if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
          // Already encoded, keep as is
          result += char + hex;
          i += 2;
          continue;
        }
      }

      // Keep safe characters as is
      if (safeChars.test(char)) {
        result += char;
      } else {
        // Encode unsafe characters
        result += encodeURIComponent(char);
      }
    }

    return result;
  }

  /**
   * Download file from URL to local disk
   */
  private async downloadFile(url: string, dest: string): Promise<void> {
    try {
      // For local MinIO URLs, don't encode - axios handles it correctly
      // For external URLs, use requote_uri encoding
      const isLocalMinIO = url.includes('minio:') || url.includes('localhost:9000');
      const finalUrl = isLocalMinIO ? url : this.requoteUri(url);

      logger.info('[LocalAudioProcessor] Downloading audio', {
        originalUrl: url,
        finalUrl,
        isLocalMinIO,
        dest
      });

      const response = await axios({
        url: finalUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 300000, // 5 minutes
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 300
      });

      logger.info('[LocalAudioProcessor] Download response received', {
        status: response.status,
        contentLength: response.headers['content-length'],
        contentType: response.headers['content-type'],
        url: finalUrl
      });

      const writer = require('fs').createWriteStream(dest);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info('[LocalAudioProcessor] Download completed', { dest });
          resolve();
        });
        writer.on('error', (error: any) => {
          logger.error('[LocalAudioProcessor] Download failed', { error: error.message });
          reject(error);
        });
      });
    } catch (error: any) {
      logger.error('[LocalAudioProcessor] Download error', {
        url,
        error: error.message
      });
      throw new Error(`Failed to download audio: ${error.message}`);
    }
  }

  /**
   * Get audio duration using ffprobe
   */
  private async getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        filePath
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(output.trim());
          resolve(duration);
        } else {
          reject(new Error(`ffprobe failed with code ${code}`));
        }
      });
    });
  }

  /**
   * Concatenate audio files using FFmpeg concat demuxer
   * This is the fastest method for concatenating audio without re-encoding
   */
  async concatenateAudios(
    audioUrls: Array<{ audio_url: string }>,
    s3Path: string,
    outputFilename: string = 'audio_concatenated.mp3'
  ): Promise<{
    success: boolean;
    audio_url: string;
    filename: string;
    s3_key: string;
    audio_count: number;
    total_duration: number;
  }> {
    const jobId = randomUUID();
    const jobWorkDir = path.join(this.workDir, jobId);
    const inputFiles: string[] = [];
    const concatListPath = path.join(jobWorkDir, 'concat_list.txt');
    const outputPath = path.join(jobWorkDir, outputFilename);

    try {
      // Create job work directory
      await fs.mkdir(jobWorkDir, { recursive: true });

      logger.info('[LocalAudioProcessor] Starting audio concatenation', {
        jobId,
        audioCount: audioUrls.length,
        s3Path,
        outputFilename
      });

      // Step 1: Download all audio files
      logger.info('[LocalAudioProcessor] Downloading audio files...', {
        count: audioUrls.length
      });

      for (let i = 0; i < audioUrls.length; i++) {
        const audioUrl = audioUrls[i].audio_url;
        const inputPath = path.join(jobWorkDir, `input_${i}.mp3`);

        await this.downloadFile(audioUrl, inputPath);
        inputFiles.push(inputPath);

        logger.info('[LocalAudioProcessor] Downloaded audio', {
          index: i,
          path: inputPath
        });
      }

      // Step 2: Create concat list file for FFmpeg
      // Format: file 'absolute_path'
      const concatListContent = inputFiles
        .map(filePath => `file '${filePath.replace(/'/g, "'\\''")}'`)
        .join('\n');

      await fs.writeFile(concatListPath, concatListContent, 'utf-8');

      logger.info('[LocalAudioProcessor] Created concat list', {
        files: inputFiles.length,
        listPath: concatListPath
      });

      // Step 3: Concatenate using FFmpeg concat demuxer
      // Using concat demuxer with -c copy for fast concatenation (no re-encoding)
      logger.info('[LocalAudioProcessor] Concatenating audios with FFmpeg...');

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn('ffmpeg', [
          '-y', // Overwrite output
          '-f', 'concat',
          '-safe', '0',
          '-i', concatListPath,
          '-c', 'copy', // Copy codec (no re-encoding) - fastest
          outputPath
        ]);

        let stderrOutput = '';

        ffmpeg.stderr.on('data', (data) => {
          stderrOutput += data.toString();
        });

        ffmpeg.on('close', (code) => {
          if (code === 0) {
            logger.info('[LocalAudioProcessor] FFmpeg concatenation complete', {
              outputPath
            });
            resolve();
          } else {
            logger.error('[LocalAudioProcessor] FFmpeg failed', {
              code,
              stderr: stderrOutput.slice(-500) // Last 500 chars
            });
            reject(new Error(`FFmpeg failed with code ${code}`));
          }
        });

        ffmpeg.on('error', (error) => {
          logger.error('[LocalAudioProcessor] FFmpeg spawn error', {
            error: error.message
          });
          reject(error);
        });
      });

      // Step 4: Get output audio duration
      const totalDuration = await this.getAudioDuration(outputPath);

      logger.info('[LocalAudioProcessor] Audio concatenation complete', {
        totalDuration,
        audioCount: audioUrls.length
      });

      // Step 5: Upload to S3/MinIO
      logger.info('[LocalAudioProcessor] Uploading to S3...', {
        bucket: process.env.S3_BUCKET_NAME,
        path: s3Path,
        filename: outputFilename
      });

      // Read audio file as Buffer
      const audioBuffer = await fs.readFile(outputPath);

      // Upload to S3 (returns public URL directly)
      const audioUrl = await this.s3Service.uploadFile(
        s3Path,
        outputFilename,
        audioBuffer,
        'audio/mpeg'
      );

      // Extract S3 key from URL for response
      const s3Key = `${s3Path}${outputFilename}`;

      logger.info('[LocalAudioProcessor] Upload complete', {
        s3Key,
        audioUrl
      });

      // Step 6: Cleanup
      logger.info('[LocalAudioProcessor] Cleaning up temporary files...');
      await fs.rm(jobWorkDir, { recursive: true, force: true });

      return {
        success: true,
        audio_url: audioUrl,
        filename: outputFilename,
        s3_key: s3Key,
        audio_count: audioUrls.length,
        total_duration: totalDuration
      };

    } catch (error: any) {
      logger.error('[LocalAudioProcessor] Audio concatenation failed', {
        jobId,
        error: error.message,
        stack: error.stack
      });

      // Cleanup on error
      try {
        await fs.rm(jobWorkDir, { recursive: true, force: true });
      } catch (cleanupError: any) {
        logger.warn('[LocalAudioProcessor] Cleanup failed', {
          error: cleanupError.message
        });
      }

      throw error;
    }
  }
}
