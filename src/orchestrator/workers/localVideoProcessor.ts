import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../shared/utils/logger';
import { LocalS3UploadService } from '../services/localS3Upload';
import axios from 'axios';
import { randomUUID } from 'crypto';

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

      // Burn subtitles with libx264 (CPU)
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `ass=${assPath}`,
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

      // Burn subtitles
      const ffmpegArgs = [
        '-i', videoPath,
        '-vf', `ass=${assPath}`,
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
   * Process Img2Vid
   * Fixed based on api-transcricao working implementation
   */
  async processImg2Vid(data: any): Promise<{ videos: any[]; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing img2vid', {
        jobId,
        count: data.images.length,
        path: data.path,
        images: data.images.map((img: any) => ({ id: img.id, url: img.image_url, duration: img.duracao }))
      });

      const results = [];

      for (let i = 0; i < data.images.length; i++) {
        const image = data.images[i];
        logger.info(`[LocalVideoProcessor] Processing image ${i + 1}/${data.images.length}`, {
          jobId,
          imageId: image.id,
          imageUrl: image.image_url,
          duration: image.duracao
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

        // Ken Burns parameters
        const fps = 24;
        const totalFrames = Math.round(image.duracao * fps);

        // Upscale 6x for smooth zoom (prevent pixelation)
        const upscaleFactor = 6;
        const upscaleWidth = imageMetadata ? imageMetadata.width * upscaleFactor : 6720;
        const upscaleHeight = imageMetadata ? imageMetadata.height * upscaleFactor : 3840;

        // Zoom parameters (1.0 → 1.324 = 32.4% zoom)
        const zoomStart = 1.0;
        const zoomEnd = 1.324;
        const zoomDiff = zoomEnd - zoomStart;

        // Build video filter in 3 stages (CRITICAL ORDER)
        const videoFilter = [
          // Stage 1: Upscale image for smooth zoom
          `scale=${upscaleWidth}:${upscaleHeight}:flags=lanczos`,

          // Stage 2: Apply controlled zoom (min prevents over-zooming)
          `zoompan=z='min(${zoomStart}+${zoomDiff}*on/${totalFrames}, ${zoomEnd})':d=${totalFrames}:x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=1920x1080:fps=${fps}`,

          // Stage 3: Ensure proper pixel format
          'format=yuv420p'
        ].join(',');

        // FFmpeg args (FIXED ORDER: framerate MUST come before loop)
        const ffmpegArgs = [
          '-framerate', fps.toString(), // CRITICAL: Must be before -loop
          '-loop', '1',
          '-i', imgPath,
          '-vf', videoFilter,
          '-c:v', 'libx264',
          '-preset', 'ultrafast', // Faster than 'medium', good quality
          '-crf', '23',
          '-threads', '2', // Optimize for VPS (2 vCPU cores)
          '-t', String(image.duracao),
          '-max_muxing_queue_size', '1024', // Prevent buffer overflow
          '-movflags', '+faststart',
          '-y',
          outputPath
        ];

        logger.info('[LocalVideoProcessor] Step 3: Running FFmpeg', {
          jobId,
          imageId: image.id,
          upscale: `${upscaleWidth}x${upscaleHeight}`,
          zoom: `${zoomStart} → ${zoomEnd}`,
          frames: totalFrames,
          duration: image.duracao,
          command: `ffmpeg ${ffmpegArgs.join(' ')}`
        });

        try {
          // Execute with optimized environment (tmpfs)
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

        try {
          // Step 4: Upload to S3
          logger.info('[LocalVideoProcessor] Step 4: Uploading to S3', {
            jobId,
            imageId: image.id,
            path: data.path
          });
          const videoBuffer = await fs.readFile(outputPath);
          const filename = `video_${image.id}.mp4`;
          const videoUrl = await this.s3Service.uploadFile(
            data.path,
            filename,
            videoBuffer,
            'video/mp4'
          );

          results.push({
            id: image.id,
            video_url: videoUrl,
            filename
          });

          logger.info('[LocalVideoProcessor] Image processed successfully', {
            jobId,
            imageId: image.id,
            videoUrl,
            filename
          });
        } catch (error: any) {
          logger.error('[LocalVideoProcessor] Failed to upload video', {
            jobId,
            imageId: image.id,
            error: error.message,
            stack: error.stack
          });
          throw new Error(`Failed to upload video for image ${image.id}: ${error.message}`);
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
   * Process AddAudio
   */
  async processAddAudio(data: any): Promise<{ video_url: string; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing addaudio', { jobId });

      const videoPath = path.join(workPath, 'input.mp4');
      const audioPath = path.join(workPath, 'audio.mp3');
      const outputPath = path.join(workPath, data.output_filename);

      await Promise.all([
        this.downloadFile(data.url_video, videoPath),
        this.downloadFile(data.url_audio, audioPath)
      ]);

      // Replace audio track
      const ffmpegArgs = [
        '-i', videoPath,
        '-i', audioPath,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
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
   */
  private async generateASSFromSRT(srtPath: string, assPath: string, _style: any): Promise<void> {
    // TODO: Implement SRT to ASS conversion with styling
    // For now, copy SRT as ASS (FFmpeg will handle basic conversion)
    const srtContent = await fs.readFile(srtPath, 'utf-8');
    await fs.writeFile(assPath, srtContent);
    logger.info('[LocalVideoProcessor] Generated ASS from SRT', { assPath });
  }

  /**
   * Generate ASS karaoke file from words JSON
   */
  private async generateASSKaraoke(_wordsPath: string, assPath: string, _style: any): Promise<void> {
    // TODO: Implement words JSON to ASS karaoke conversion
    // This requires the same logic as the Python worker's caption_generator.py
    logger.warn('[LocalVideoProcessor] ASS karaoke generation not fully implemented yet');

    // Placeholder: create empty ASS
    const assHeader = `[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,72,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
    await fs.writeFile(assPath, assHeader);
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
