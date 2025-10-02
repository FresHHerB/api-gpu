// ============================================
// FFmpeg Service - GPU Accelerated Video Processing
// ============================================

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { logger } from '../../shared/utils/logger';

export class FFmpegService {
  private workDir: string;
  private outputDir: string;

  constructor() {
    this.workDir = process.env.WORK_DIR || '/tmp/work';
    this.outputDir = process.env.OUTPUT_DIR || '/tmp/output';
  }

  /**
   * Initialize working directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.workDir, { recursive: true });
    await fs.mkdir(this.outputDir, { recursive: true });

    logger.info('✅ FFmpeg Service initialized', {
      workDir: this.workDir,
      outputDir: this.outputDir
    });
  }

  /**
   * Add SRT subtitles to video using GPU encoding
   */
  async addCaption(url_video: string, url_srt: string): Promise<string> {
    const jobId = this.generateJobId();
    const videoPath = path.join(this.workDir, `${jobId}_input.mp4`);
    const srtPath = path.join(this.workDir, `${jobId}_subs.srt`);
    const outputPath = path.join(this.outputDir, `${jobId}_captioned.mp4`);

    try {
      logger.info('🎬 Starting caption job', { jobId, url_video, url_srt });

      // 1. Download video and SRT
      await this.downloadFile(url_video, videoPath);
      await this.downloadFile(url_srt, srtPath);

      // 2. Validate SRT file
      await this.validateSRT(srtPath);

      // 3. Process with FFmpeg + GPU
      await this.runFFmpeg([
        '-hwaccel', 'cuda',                    // GPU decode
        '-i', videoPath,
        '-vf', `subtitles=${srtPath}`,         // Add subtitles (CPU filter)
        '-c:v', 'h264_nvenc',                  // GPU encode
        '-preset', 'p4',                       // Balanced preset
        '-tune', 'hq',                         // High quality
        '-rc:v', 'vbr',                        // Variable bitrate
        '-cq:v', '23',                         // Quality level
        '-c:a', 'copy',                        // Audio copy (no re-encode)
        '-movflags', '+faststart',             // Web streaming ready
        outputPath
      ]);

      // 4. Cleanup input files
      await this.cleanup([videoPath, srtPath]);

      logger.info('✅ Caption job completed', { jobId, outputPath });

      return outputPath;

    } catch (error) {
      logger.error('❌ Caption job failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Convert image to video with Ken Burns zoom effect
   */
  async imageToVideo(
    url_image: string,
    duration: number = 5.0,
    frame_rate: number = 24
  ): Promise<string> {
    const jobId = this.generateJobId();
    const imagePath = path.join(this.workDir, `${jobId}_input.jpg`);
    const outputPath = path.join(this.outputDir, `${jobId}_video.mp4`);

    try {
      logger.info('🖼️ Starting img2vid job', { jobId, url_image, duration, frame_rate });

      // 1. Download image
      await this.downloadFile(url_image, imagePath);

      // 2. Calculate zoom parameters
      const totalFrames = Math.floor(duration * frame_rate);
      const zoomFactor = 1.324; // 32.4% zoom

      // 3. Process with FFmpeg + GPU
      // Ken Burns effect: Start zoomed in, zoom out over duration
      await this.runFFmpeg([
        '-loop', '1',
        '-framerate', frame_rate.toString(),
        '-i', imagePath,
        '-vf', [
          `scale=6720:3840:flags=lanczos`,     // Upscale 6x for zoom quality
          `zoompan=z='min(1+${zoomFactor-1}*on/${totalFrames},${zoomFactor})':d=${totalFrames}:s=1920x1080:fps=${frame_rate}`,
          'format=nv12'                         // GPU-friendly format
        ].join(','),
        '-c:v', 'h264_nvenc',                   // GPU encode
        '-preset', 'p4',
        '-tune', 'hq',
        '-rc:v', 'vbr',
        '-cq:v', '23',
        '-t', duration.toString(),
        '-movflags', '+faststart',
        outputPath
      ]);

      // 4. Cleanup
      await this.cleanup([imagePath]);

      logger.info('✅ Img2vid job completed', { jobId, outputPath });

      return outputPath;

    } catch (error) {
      logger.error('❌ Img2vid job failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Add/replace audio track in video
   */
  async addAudio(url_video: string, url_audio: string): Promise<string> {
    const jobId = this.generateJobId();
    const videoPath = path.join(this.workDir, `${jobId}_video.mp4`);
    const audioPath = path.join(this.workDir, `${jobId}_audio.mp3`);
    const outputPath = path.join(this.outputDir, `${jobId}_with_audio.mp4`);

    try {
      logger.info('🎵 Starting addaudio job', { jobId, url_video, url_audio });

      // 1. Download files
      await this.downloadFile(url_video, videoPath);
      await this.downloadFile(url_audio, audioPath);

      // 2. Get durations to determine shortest
      const videoDuration = await this.getVideoDuration(videoPath);
      const audioDuration = await this.getAudioDuration(audioPath);
      const shortestDuration = Math.min(videoDuration, audioDuration);

      logger.info('📊 Media durations', {
        videoDuration,
        audioDuration,
        shortestDuration
      });

      // 3. Merge audio and video (cut to shortest duration)
      await this.runFFmpeg([
        '-hwaccel', 'cuda',
        '-i', videoPath,
        '-i', audioPath,
        '-map', '0:v',                          // Video from first input
        '-map', '1:a',                          // Audio from second input
        '-c:v', 'h264_nvenc',                   // GPU re-encode
        '-preset', 'p4',
        '-tune', 'hq',
        '-rc:v', 'vbr',
        '-cq:v', '23',
        '-c:a', 'aac',                          // AAC audio codec
        '-b:a', '192k',                         // Audio bitrate
        '-shortest',                             // Cut to shortest duration
        '-movflags', '+faststart',
        outputPath
      ]);

      // 4. Cleanup
      await this.cleanup([videoPath, audioPath]);

      logger.info('✅ AddAudio job completed', { jobId, outputPath });

      return outputPath;

    } catch (error) {
      logger.error('❌ AddAudio job failed', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Execute FFmpeg command
   */
  private runFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.debug('🔧 Running FFmpeg', { args: args.join(' ') });

      const ffmpeg = spawn('ffmpeg', ['-y', ...args]);

      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
        // Log progress (every 10th line to avoid spam)
        if (stderr.split('\n').length % 10 === 0) {
          logger.debug('FFmpeg progress', { lastLine: data.toString().trim() });
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.debug('✅ FFmpeg completed successfully');
          resolve();
        } else {
          logger.error('❌ FFmpeg failed', { code, stderr: stderr.slice(-500) });
          reject(new Error(`FFmpeg exited with code ${code}`));
        }
      });

      ffmpeg.on('error', (error) => {
        logger.error('❌ FFmpeg process error', { error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Download file from URL
   */
  private async downloadFile(url: string, destination: string): Promise<void> {
    logger.debug('⬇️ Downloading file', { url, destination });

    const response = await axios({
      method: 'GET',
      url,
      responseType: 'stream',
      timeout: 300000 // 5min timeout
    });

    const writer = require('fs').createWriteStream(destination);

    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        logger.debug('✅ Download completed', { destination });
        resolve();
      });
      writer.on('error', reject);
    });
  }

  /**
   * Validate SRT file format
   */
  private async validateSRT(srtPath: string): Promise<void> {
    const content = await fs.readFile(srtPath, 'utf-8');

    // Basic SRT validation: should contain timestamp pattern
    const hasTimestamps = /\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/.test(content);

    if (!hasTimestamps) {
      throw new Error('Invalid SRT file: missing timestamp format');
    }

    logger.debug('✅ SRT file validated', { srtPath });
  }

  /**
   * Get video duration in seconds
   */
  private getVideoDuration(videoPath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        videoPath
      ]);

      let stdout = '';

      ffprobe.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          const duration = parseFloat(stdout.trim());
          resolve(duration);
        } else {
          reject(new Error('Failed to get video duration'));
        }
      });

      ffprobe.on('error', reject);
    });
  }

  /**
   * Get audio duration in seconds
   */
  private getAudioDuration(audioPath: string): Promise<number> {
    return this.getVideoDuration(audioPath); // Same method works for audio
  }

  /**
   * Cleanup temporary files
   */
  private async cleanup(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        await fs.unlink(file);
        logger.debug('🗑️ Cleaned up file', { file });
      } catch (error) {
        logger.warn('Failed to cleanup file', {
          file,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  }

  /**
   * Generate unique job ID
   */
  private generateJobId(): string {
    return `job_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get file stats
   */
  async getFileStats(filePath: string): Promise<any> {
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      sizeKB: (stats.size / 1024).toFixed(2),
      sizeMB: (stats.size / 1024 / 1024).toFixed(2)
    };
  }
}
