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
   * Download file from URL to local disk
   */
  private async downloadFile(url: string, dest: string): Promise<void> {
    // Encode URL to handle spaces and special characters
    const encodedUrl = encodeURI(url);

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
      maxRedirects: 5
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
          dest
        });
        reject(error);
      });
      response.data.on('error', (error: any) => {
        logger.error('[LocalVideoProcessor] Download stream error', {
          error: error.message,
          url: encodedUrl
        });
        reject(error);
      });
    });
  }

  /**
   * Execute FFmpeg command
   */
  private async executeFFmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('[LocalVideoProcessor] Executing FFmpeg', { args: args.join(' ') });

      const ffmpeg = spawn('ffmpeg', args);
      let stderr = '';

      ffmpeg.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          logger.info('[LocalVideoProcessor] FFmpeg completed successfully');
          resolve();
        } else {
          logger.error('[LocalVideoProcessor] FFmpeg failed', { code, stderr });
          reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
        }
      });

      ffmpeg.on('error', (error) => {
        logger.error('[LocalVideoProcessor] FFmpeg spawn error', { error: error.message });
        reject(error);
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
   */
  async processImg2Vid(data: any): Promise<{ videos: any[]; pathRaiz?: string }> {
    const jobId = randomUUID();
    const workPath = path.join(this.workDir, jobId);
    await fs.mkdir(workPath, { recursive: true });

    try {
      logger.info('[LocalVideoProcessor] Processing img2vid', { jobId, count: data.images.length });

      const results = [];

      for (const image of data.images) {
        const imgPath = path.join(workPath, `${image.id}.jpg`);
        const outputPath = path.join(workPath, `video_${image.id}.mp4`);

        // Download image
        await this.downloadFile(image.image_url, imgPath);

        // Create video with Ken Burns effect (CPU)
        const fps = 24;
        const frames = Math.round(image.duracao * fps);

        const ffmpegArgs = [
          '-loop', '1',
          '-i', imgPath,
          '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='zoom+0.0015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`,
          '-c:v', 'libx264',
          '-preset', 'medium',
          '-crf', '23',
          '-t', String(image.duracao),
          '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-y',
          outputPath
        ];

        await this.executeFFmpeg(ffmpegArgs);

        // Upload
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
      }

      const pathRaiz = this.extractPathRaiz(data.path);

      await fs.rm(workPath, { recursive: true, force: true });

      return { videos: results, pathRaiz };

    } catch (error: any) {
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
