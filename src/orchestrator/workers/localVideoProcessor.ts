import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../shared/utils/logger';
import { LocalS3UploadService } from '../services/localS3Upload';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { generateASSFromSRT as generateSegmentASS, generateASSHighlight } from './captionGenerator';

// ============================================
// Local Video Processor (VPS CPU-based)
// Processes video operations locally using FFmpeg with libx264
// ============================================

export class LocalVideoProcessor {
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
      logger.info('[LocalVideoProcessor] Work directory ready', { workDir: this.workDir });
    } catch (error: any) {
      logger.error('[LocalVideoProcessor] Failed to create work directory', { error: error.message });
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
   * Distribute zoom types proportionally and randomly across images
   * Same logic as GPU worker's distribute_zoom_types()
   */
  private distributeZoomTypes(zoomTypes: string[], imageCount: number): string[] {
    if (!zoomTypes || zoomTypes.length === 0 || imageCount === 0) {
      return Array(imageCount).fill('zoomin'); // Default fallback
    }

    // Calculate proportional distribution
    const typesCount = zoomTypes.length;
    const baseCount = Math.floor(imageCount / typesCount);
    const remainder = imageCount % typesCount;

    // Build distribution list
    const distribution: string[] = [];
    for (let i = 0; i < zoomTypes.length; i++) {
      const zoomType = zoomTypes[i];
      // Each type gets baseCount + 1 extra if remainder available
      const count = baseCount + (i < remainder ? 1 : 0);
      for (let j = 0; j < count; j++) {
        distribution.push(zoomType);
      }
    }

    // Shuffle to randomize order (proportional but random)
    for (let i = distribution.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distribution[i], distribution[j]] = [distribution[j], distribution[i]];
    }

    logger.info('[LocalVideoProcessor] Zoom distribution', {
      zoomTypes,
      imageCount,
      distribution: distribution.reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    });

    return distribution;
  }

  /**
   * Download file from URL to local disk
   */
  private async downloadFile(url: string, dest: string): Promise<void> {
    try {
      // Encode URL using same strategy as Python's requests.utils.requote_uri
      const encodedUrl = this.requoteUri(url);

      logger.info('[LocalVideoProcessor] Downloading file', {
        originalUrl: url,
        encodedUrl,
        dest
      });

      const response = await axios({
        url: encodedUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 300000, // 5 minutes
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 300
      });

      logger.info('[LocalVideoProcessor] Download response received', {
        status: response.status,
        contentLength: response.headers['content-length'],
        contentType: response.headers['content-type'],
        url: encodedUrl
      });

      const writer = require('fs').createWriteStream(dest);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          logger.info('[LocalVideoProcessor] Download completed', { dest });
          resolve();
        });
        writer.on('error', (error: any) => {
          logger.error('[LocalVideoProcessor] Download write error', {
            error: error.message,
            stack: error.stack,
            dest
          });
          reject(new Error(`Failed to write file to ${dest}: ${error.message}`));
        });
        response.data.on('error', (error: any) => {
          logger.error('[LocalVideoProcessor] Download stream error', {
            error: error.message,
            stack: error.stack,
            url: encodedUrl
          });
          reject(new Error(`Failed to download from ${encodedUrl}: ${error.message}`));
        });
      });

    } catch (error: any) {
      // Enhanced error logging for axios errors
      if (error.response) {
        // Server responded with error status
        logger.error('[LocalVideoProcessor] Download failed - Server error', {
          url,
          status: error.response.status,
          statusText: error.response.statusText,
          headers: error.response.headers,
          data: error.response.data
        });
        throw new Error(`HTTP ${error.response.status}: ${error.response.statusText} - ${url}`);
      } else if (error.request) {
        // Request made but no response
        logger.error('[LocalVideoProcessor] Download failed - No response', {
          url,
          error: error.message,
          code: error.code
        });
        throw new Error(`No response from server: ${url} (${error.code || error.message})`);
      } else {
        // Error in request setup
        logger.error('[LocalVideoProcessor] Download failed - Request setup', {
          url,
          error: error.message,
          stack: error.stack
        });
        throw new Error(`Request setup failed: ${error.message}`);
      }
    }
  }

  /**
   * Execute FFmpeg command
   */
  private async executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('[LocalVideoProcessor] Executing FFmpeg', { args: args.join(' ') });

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';
      let stdout = '';

      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info('[LocalVideoProcessor] FFmpeg completed successfully');
          resolve();
        } else {
          // Log full error details
          logger.error('[LocalVideoProcessor] FFmpeg failed', {
            code,
            command: `ffmpeg ${args.join(' ')}`,
            stderrLength: stderr.length,
            stderrLast1000: stderr.slice(-1000),
            stderrFull: stderr // Full stderr for debugging
          });

          // Create detailed error with full stderr
          const error = new Error(`FFmpeg failed with exit code ${code}`);
          (error as any).code = code;
          (error as any).stderr = stderr;
          (error as any).command = `ffmpeg ${args.join(' ')}`;
          reject(error);
        }
      });

      ffmpeg.on('error', (error) => {
        logger.error('[LocalVideoProcessor] FFmpeg spawn error', { error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Execute FFmpeg command with optimized environment
   */
  private async executeFFmpegWithEnv(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('[LocalVideoProcessor] Executing FFmpeg (optimized)', { args: args.join(' ') });

      // Optimized environment - use tmpfs for temp files
      const ffmpegEnv = {
        ...process.env,
        TMPDIR: '/tmp',
        TEMP: '/tmp',
        TMP: '/tmp'
      };

      const ffmpeg = spawn('ffmpeg', args, { env: ffmpegEnv });
      let stderr = '';
      let stdout = '';

      ffmpeg.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();

        // Parse progress for better visibility
        const output = data.toString();
        if (output.includes('frame=') && output.includes('time=')) {
          const frameMatch = output.match(/frame=\s*(\d+)/);
          const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
          const speedMatch = output.match(/speed=\s*([\d.]+)x/);

          if (frameMatch && timeMatch) {
            logger.debug(`[LocalVideoProcessor] Progress: frame=${frameMatch[1]}, time=${timeMatch[1]}, speed=${speedMatch ? speedMatch[1] : 'N/A'}x`);
          }
        }
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info('[LocalVideoProcessor] FFmpeg completed successfully');
          resolve();
        } else {
          // Log full error details
          logger.error('[LocalVideoProcessor] FFmpeg failed', {
            code,
            command: `ffmpeg ${args.join(' ')}`,
            stderrLength: stderr.length,
            stderrLast1000: stderr.slice(-1000),
            stderrFull: stderr // Full stderr for debugging
          });

          // Create detailed error with full stderr
          const error = new Error(`FFmpeg failed with exit code ${code}`);
          (error as any).code = code;
          (error as any).stderr = stderr;
          (error as any).command = `ffmpeg ${args.join(' ')}`;
          reject(error);
        }
      });

      ffmpeg.on('error', (error) => {
        logger.error('[LocalVideoProcessor] FFmpeg spawn error', { error: error.message });
        reject(error);
      });
    });
  }

  /**
   * Get image metadata using ffprobe
   */
  private async getImageMetadata(imagePath: string): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams',
        imagePath
      ]);

      let output = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const metadata = JSON.parse(output);
            const imageStream = metadata.streams?.find((s: any) => s.codec_type === 'video');

            if (imageStream && imageStream.width && imageStream.height) {
              logger.info('[LocalVideoProcessor] Image metadata extracted', {
                width: imageStream.width,
                height: imageStream.height,
                path: imagePath
              });
              resolve({ width: imageStream.width, height: imageStream.height });
            } else {
              logger.warn('[LocalVideoProcessor] Could not extract image dimensions', { imagePath });
              resolve(null);
            }
          } catch (error) {
            logger.warn('[LocalVideoProcessor] Failed to parse image metadata', {
              error: error instanceof Error ? error.message : 'Unknown error',
              imagePath
            });
            resolve(null);
          }
        } else {
          logger.warn('[LocalVideoProcessor] FFprobe failed, using default dimensions', { imagePath, code });
          resolve(null);
        }
      });

      ffprobe.on('error', (error) => {
        logger.warn('[LocalVideoProcessor] FFprobe spawn error', { error: error.message, imagePath });
        resolve(null);
      });
    });
  }

  /**
   * Get media duration using ffprobe
   * Returns duration in seconds (float)
   */
  private async getMediaDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_format',
        filePath
      ]);

      let output = '';

      ffprobe.stdout.on('data', (data) => {
        output += data.toString();
      });

      ffprobe.on('close', (code) => {
        if (code === 0) {
          try {
            const metadata = JSON.parse(output);
            const duration = parseFloat(metadata.format?.duration);

            if (!isNaN(duration) && duration > 0) {
              logger.info('[LocalVideoProcessor] Media duration extracted', {
                duration: duration.toFixed(2) + 's',
                path: filePath
              });
              resolve(duration);
            } else {
              const error = new Error('Invalid duration in media file');
              logger.error('[LocalVideoProcessor] Failed to extract duration', {
                error: error.message,
                filePath
              });
              reject(error);
            }
          } catch (error) {
            logger.error('[LocalVideoProcessor] Failed to parse media metadata', {
              error: error instanceof Error ? error.message : 'Unknown error',
              filePath
            });
            reject(error);
          }
        } else {
          const error = new Error(`FFprobe failed with exit code ${code}`);
          logger.error('[LocalVideoProcessor] FFprobe failed', { error: error.message, filePath, code });
          reject(error);
        }
      });

      ffprobe.on('error', (error) => {
        logger.error('[LocalVideoProcessor] FFprobe spawn error', { error: error.message, filePath });
        reject(error);
      });
    });
  }

  /**
   * Normalize file path for FFmpeg filters
   * Replicates GPU worker's path normalization: replace backslashes and escape colons
   * Critical for cross-platform compatibility (Windows paths with drive letters)
   */
  private normalizePathForFFmpeg(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/:/g, '\\:');
  }

  /**
   * Process Caption Style (Segments)
   */
  async processCaptionSegments(data: any): Promise<{ video_url: string; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing caption segments', { jobId });

      // Download video and SRT
      const videoPath = path.join(workPath, 'input.mp4');
      const srtPath = path.join(workPath, 'subtitles.srt');
      const outputPath = path.join(workPath, data.output_filename);

      await Promise.all([
        this.downloadFile(data.url_video, videoPath),
        this.downloadFile(data.url_srt, srtPath)
      ]);

      // Generate ASS file from SRT with styles
      const assPath = path.join(workPath, 'styled.ass');
      await this.generateASSFromSRT(srtPath, assPath, data.style || {});

      // Normalize ASS path for FFmpeg (cross-platform compatibility)
      const normalizedAssPath = this.normalizePathForFFmpeg(assPath);

      // Burn subtitles with libx264 (CPU)
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `ass=${normalizedAssPath}`,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-maxrate', '10M',
        '-bufsize', '20M',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      await this.executeFFmpeg(ffmpegArgs);

      // Upload to S3
      const videoBuffer = await fs.readFile(outputPath);
      const videoUrl = await this.s3Service.uploadFile(
        data.path,
        data.output_filename,
        videoBuffer,
        'video/mp4'
      );

      // Extract pathRaiz
      const pathRaiz = this.extractPathRaiz(data.path);

      // Cleanup
      await fs.rm(workPath, { recursive: true, force: true });

      return { video_url: videoUrl, pathRaiz };

    } catch (error: any) {
      // Cleanup on error
      await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Process Caption Style (Highlight/Karaoke)
   */
  async processCaptionHighlight(data: any): Promise<{ video_url: string; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing caption highlight', { jobId });

      // Download video and words JSON
      const videoPath = path.join(workPath, 'input.mp4');
      const wordsPath = path.join(workPath, 'words.json');
      const outputPath = path.join(workPath, data.output_filename);

      await Promise.all([
        this.downloadFile(data.url_video, videoPath),
        this.downloadFile(data.url_words_json, wordsPath)
      ]);

      // Generate ASS karaoke file
      const assPath = path.join(workPath, 'karaoke.ass');
      await this.generateASSKaraoke(wordsPath, assPath, data.style || {});

      // Normalize ASS path for FFmpeg (cross-platform compatibility)
      const normalizedAssPath = this.normalizePathForFFmpeg(assPath);

      // Burn subtitles
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `ass=${normalizedAssPath}`,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-maxrate', '10M',
        '-bufsize', '20M',
        '-c:a', 'copy',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      await this.executeFFmpeg(ffmpegArgs);

      // Upload to S3
      const videoBuffer = await fs.readFile(outputPath);
      const videoUrl = await this.s3Service.uploadFile(
        data.path,
        data.output_filename,
        videoBuffer,
        'video/mp4'
      );

      const pathRaiz = this.extractPathRaiz(data.path);

      await fs.rm(workPath, { recursive: true, force: true });

      return { video_url: videoUrl, pathRaiz };

    } catch (error: any) {
      await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Process single image to video
   * Extracted method for parallel processing
   */
  private async processSingleImage(
    image: any,
    zoomType: string,
    workPath: string,
    jobId: string,
    imageIndex: number,
    totalImages: number,
    s3Path: string
  ): Promise<any> {
    logger.info(`[LocalVideoProcessor] Processing image ${imageIndex + 1}/${totalImages}`, {
      jobId,
      imageId: image.id,
      imageUrl: image.image_url,
      duration: image.duracao,
      zoomType
    });

    const imgPath = path.join(workPath, `${image.id}.jpg`);
    const outputPath = path.join(workPath, `video_${image.id}.mp4`);

    try {
      // Step 1: Download image
      logger.info('[LocalVideoProcessor] Step 1: Downloading image', {
        jobId,
        imageId: image.id,
        url: image.image_url
      });
      await this.downloadFile(image.image_url, imgPath);
      logger.info('[LocalVideoProcessor] Image downloaded', {
        jobId,
        imageId: image.id,
        path: imgPath
      });
    } catch (error: any) {
      logger.error('[LocalVideoProcessor] Failed to download image', {
        jobId,
        imageId: image.id,
        url: image.image_url,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`Failed to download image ${image.id}: ${error.message}`);
    }

    // Step 2: Get image metadata for optimal upscaling
    logger.info('[LocalVideoProcessor] Step 2: Getting image metadata', {
      jobId,
      imageId: image.id
    });
    const imageMetadata = await this.getImageMetadata(imgPath);
    logger.info('[LocalVideoProcessor] Image metadata retrieved', {
      jobId,
      imageId: image.id,
      metadata: imageMetadata
    });

    // Ken Burns parameters - use FLOAT for precise animation timing
    const fps = 24;
    // No rounding - keep precise float value to ensure animation completes exactly at video end
    // e.g., 3.33s * 24fps = 79.92 frames (precise, not 80)
    const totalFrames = image.duracao * fps;

    // Upscale 6x for smooth zoom (balanced quality and performance)
    const upscaleFactor = 6;
    const upscaleWidth = imageMetadata ? imageMetadata.width * upscaleFactor : 11520;
    const upscaleHeight = imageMetadata ? imageMetadata.height * upscaleFactor : 6480;

    logger.info('[LocalVideoProcessor] Upscale configuration', {
      jobId,
      imageId: image.id,
      factor: upscaleFactor,
      original: imageMetadata ? `${imageMetadata.width}x${imageMetadata.height}` : '1920x1080 (default)',
      upscaled: `${upscaleWidth}x${upscaleHeight}`
    });

    // Define zoom effect based on type
    let zoomFormula: string;
    let xFormula: string;
    let yFormula: string;

    if (zoomType === 'zoomout') {
      const zoomStart = 1.25;
      const zoomEnd = 1.0;
      const zoomDiff = zoomStart - zoomEnd;
      zoomFormula = `max(${zoomStart}-${zoomDiff}*on/${totalFrames},${zoomEnd})`;
      xFormula = 'iw/2-(iw/zoom/2)';
      yFormula = 'ih/2-(ih/zoom/2)';
    } else if (zoomType === 'zoompanright') {
      const zoomStart = 1.0;
      const zoomEnd = 1.25;
      const zoomDiff = zoomEnd - zoomStart;
      zoomFormula = `min(${zoomStart}+${zoomDiff}*on/${totalFrames},${zoomEnd})`;
      xFormula = `(iw-ow/zoom)*on/${totalFrames}`;
      yFormula = 'ih/2-(ih/zoom/2)';
    } else {
      const zoomStart = 1.0;
      const zoomEnd = 1.25;
      const zoomDiff = zoomEnd - zoomStart;
      zoomFormula = `min(${zoomStart}+${zoomDiff}*on/${totalFrames},${zoomEnd})`;
      xFormula = 'iw/2-(iw/zoom/2)';
      yFormula = 'ih/2-(ih/zoom/2)';
    }

    // Build video filter
    const videoFilter = [
      `scale=${upscaleWidth}:${upscaleHeight}:flags=lanczos`,
      `zoompan=z='${zoomFormula}':d=${totalFrames}:x='${xFormula}':y='${yFormula}':s=1920x1080:fps=${fps}`,
      'scale=1920:1080:flags=bicubic',
      'format=yuv420p'
    ].join(',');

    // FFmpeg args
    const ffmpegArgs = [
      '-framerate', fps.toString(),
      '-loop', '1',
      '-i', imgPath,
      '-vf', videoFilter,
      '-c:v', 'libx264',
      '-preset', 'veryfast', // Faster preset for parallel processing
      '-crf', '23',
      '-threads', '1', // Single thread per process (controlled parallelism)
      '-t', String(image.duracao),
      '-max_muxing_queue_size', '1024',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    logger.info('[LocalVideoProcessor] Step 3: Running FFmpeg', {
      jobId,
      imageId: image.id,
      zoomType,
      upscale: `${upscaleWidth}x${upscaleHeight}`,
      frames: totalFrames,
      duration: image.duracao,
      command: `ffmpeg ${ffmpegArgs.join(' ')}`
    });

    try {
      await this.executeFFmpegWithEnv(ffmpegArgs);
      logger.info('[LocalVideoProcessor] FFmpeg completed', {
        jobId,
        imageId: image.id,
        outputPath
      });
    } catch (error: any) {
      logger.error('[LocalVideoProcessor] FFmpeg failed for image', {
        jobId,
        imageId: image.id,
        command: error.command,
        exitCode: error.code,
        stderrLength: error.stderr?.length,
        stderr: error.stderr,
        error: error.message,
        stack: error.stack
      });
      throw new Error(`FFmpeg failed for image ${image.id}: ${error.message}. Exit code: ${error.code}. Stderr: ${error.stderr?.slice(-500)}`);
    }

    // Step 4: Upload to S3
    logger.info('[LocalVideoProcessor] Step 4: Uploading to S3', {
      jobId,
      imageId: image.id,
      path: s3Path
    });
    const videoBuffer = await fs.readFile(outputPath);
    const filename = `video_${image.id}.mp4`;
    const videoUrl = await this.s3Service.uploadFile(
      s3Path,
      filename,
      videoBuffer,
      'video/mp4'
    );

    logger.info('[LocalVideoProcessor] Image processed successfully', {
      jobId,
      imageId: image.id,
      videoUrl,
      filename
    });

    return {
      id: image.id,
      video_url: videoUrl,
      filename
    };
  }

  /**
   * Process Img2Vid with parallel processing
   * Optimized for 2 vCPU cores with controlled concurrency
   * Supports zoom_types: zoomin, zoomout, zoompanright
   */
  async processImg2Vid(data: any): Promise<{ videos: any[]; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      // Read zoom_types from payload (default: ['zoomin'])
      const zoomTypes = data.zoom_types || ['zoomin'];
      const imageCount = data.images.length;

      // Distribute zoom types proportionally and randomly
      const zoomDistribution = this.distributeZoomTypes(zoomTypes, imageCount);

      logger.info('[LocalVideoProcessor] Processing img2vid with parallel processing', {
        jobId,
        count: imageCount,
        path: data.path,
        zoomTypes,
        concurrency: 2, // Max 2 parallel processes for 2 vCPU
        images: data.images.map((img: any) => ({ id: img.id, url: img.image_url, duration: img.duracao }))
      });

      const results: any[] = [];

      // Process in batches of 2 (parallel) for optimal 2-vCPU usage
      const CONCURRENCY = 2;
      for (let i = 0; i < data.images.length; i += CONCURRENCY) {
        const batch = data.images.slice(i, i + CONCURRENCY);
        const batchNum = Math.floor(i / CONCURRENCY) + 1;
        const totalBatches = Math.ceil(data.images.length / CONCURRENCY);

        logger.info(`[LocalVideoProcessor] Processing batch ${batchNum}/${totalBatches} (${batch.length} images in parallel)`, {
          jobId,
          batchSize: batch.length,
          totalCompleted: results.length,
          totalImages: data.images.length
        });

        // Process batch in parallel using Promise.all
        const batchPromises = batch.map((image: any, batchIndex: number) => {
          const globalIndex = i + batchIndex;
          const zoomType = zoomDistribution[globalIndex];
          return this.processSingleImage(
            image,
            zoomType,
            workPath,
            jobId,
            globalIndex,
            data.images.length,
            data.path
          );
        });

        // Wait for all images in batch to complete
        try {
          const batchResults = await Promise.all(batchPromises);
          results.push(...batchResults);

          logger.info(`[LocalVideoProcessor] Batch ${batchNum}/${totalBatches} completed`, {
            jobId,
            completedInBatch: batchResults.length,
            totalCompleted: results.length,
            remaining: data.images.length - results.length
          });
        } catch (error: any) {
          logger.error('[LocalVideoProcessor] Batch processing failed', {
            jobId,
            batchNum,
            error: error.message
          });
          throw error;
        }
      }

      const pathRaiz = this.extractPathRaiz(data.path);

      await fs.rm(workPath, { recursive: true, force: true });

      logger.info('[LocalVideoProcessor] Img2vid completed', {
        jobId,
        totalVideos: results.length
      });

      return { videos: results, pathRaiz };

    } catch (error: any) {
      logger.error('[LocalVideoProcessor] Img2vid failed', {
        jobId,
        error: error.message
      });
      await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Process AddAudio with automatic video speed adjustment
   * Syncs video duration to match audio duration using setpts filter
   */
  async processAddAudio(data: any): Promise<{ video_url: string; pathRaiz?: string; speed_factor?: number }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing addaudio with sync', { jobId });

      const videoPath = path.join(workPath, 'input.mp4');
      const audioPath = path.join(workPath, 'audio.mp3');
      const outputPath = path.join(workPath, data.output_filename);

      // Download video and audio
      await Promise.all([
        this.downloadFile(data.url_video, videoPath),
        this.downloadFile(data.url_audio, audioPath)
      ]);

      // Get durations using ffprobe
      const videoDuration = await this.getMediaDuration(videoPath);
      const audioDuration = await this.getMediaDuration(audioPath);

      logger.info('[LocalVideoProcessor] Duration sync', {
        jobId,
        video: videoDuration.toFixed(2) + 's',
        audio: audioDuration.toFixed(2) + 's'
      });

      // Calculate speed adjustment factor
      // speed_factor: how fast the video needs to play (video_duration / audio_duration)
      // pts_multiplier: inverse of speed_factor (stretches or compresses PTS timeline)
      const speedFactor = videoDuration / audioDuration;
      const ptsMultiplier = 1 / speedFactor;

      logger.info('[LocalVideoProcessor] Speed adjustment', {
        jobId,
        speedFactor: speedFactor.toFixed(3) + 'x',
        ptsMultiplier: ptsMultiplier.toFixed(6)
      });

      // Build FFmpeg command with setpts filter for video speed adjustment
      // Note: CPU decode → CPU filter (setpts) → CPU encode
      const ffmpegArgs = [
        '-i', videoPath,
        '-i', audioPath,
        '-filter_complex', `[0:v]setpts=${ptsMultiplier.toFixed(6)}*PTS[vout]`,
        '-map', '[vout]',
        '-map', '1:a',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-maxrate', '10M',
        '-bufsize', '20M',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-shortest',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      logger.info('[LocalVideoProcessor] Running FFmpeg with setpts', {
        jobId,
        command: `ffmpeg ${ffmpegArgs.join(' ')}`
      });

      await this.executeFFmpeg(ffmpegArgs);

      // Upload to S3
      const videoBuffer = await fs.readFile(outputPath);
      const videoUrl = await this.s3Service.uploadFile(
        data.path,
        data.output_filename,
        videoBuffer,
        'video/mp4'
      );

      const pathRaiz = this.extractPathRaiz(data.path);

      await fs.rm(workPath, { recursive: true, force: true });

      logger.info('[LocalVideoProcessor] AddAudio completed', {
        jobId,
        speedFactor: speedFactor.toFixed(3)
      });

      return {
        video_url: videoUrl,
        pathRaiz,
        speed_factor: parseFloat(speedFactor.toFixed(3))
      };

    } catch (error: any) {
      await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Process Concatenate
   */
  async processConcatenate(data: any): Promise<{ video_url: string; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing concatenate', { jobId, count: data.video_urls.length });

      // Download all videos
      const videoFiles: string[] = [];
      for (let i = 0; i < data.video_urls.length; i++) {
        const videoPath = path.join(workPath, `input_${i}.mp4`);
        await this.downloadFile(data.video_urls[i].video_url, videoPath);
        videoFiles.push(videoPath);
      }

      // Create concat list
      const listPath = path.join(workPath, 'concat_list.txt');
      const listContent = videoFiles.map(f => `file '${f}'`).join('\n');
      await fs.writeFile(listPath, listContent);

      const outputPath = path.join(workPath, data.output_filename);

      // Concatenate with re-encoding
      const ffmpegArgs = [
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-maxrate', '10M',
        '-bufsize', '20M',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      await this.executeFFmpeg(ffmpegArgs);

      const videoBuffer = await fs.readFile(outputPath);
      const videoUrl = await this.s3Service.uploadFile(
        data.path,
        data.output_filename,
        videoBuffer,
        'video/mp4'
      );

      const pathRaiz = this.extractPathRaiz(data.path);

      await fs.rm(workPath, { recursive: true, force: true });

      return { video_url: videoUrl, pathRaiz };

    } catch (error: any) {
      await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  /**
   * Generate ASS file from SRT with styles
   * Uses captionGenerator module for full ASS generation with custom styling
   */
  private async generateASSFromSRT(srtPath: string, assPath: string, style: any): Promise<void> {
    await generateSegmentASS(srtPath, assPath, style);
  }

  /**
   * Generate ASS karaoke file from words JSON
   * Uses captionGenerator module for full highlight ASS generation with word-by-word timing
   */
  private async generateASSKaraoke(wordsPath: string, assPath: string, style: any): Promise<void> {
    await generateASSHighlight(wordsPath, assPath, style);
  }

  /**
   * Extract pathRaiz from full path
   */
  private extractPathRaiz(path: string): string {
    let cleanPath = path.endsWith('/') ? path.slice(0, -1) : path;
    const videosIndex = cleanPath.lastIndexOf('/videos');
    if (videosIndex > 0) {
      cleanPath = cleanPath.substring(0, videosIndex);
    }
    return cleanPath.endsWith('/') ? cleanPath : cleanPath + '/';
  }
}
