// ============================================
// RunPod Serverless Handler
// ============================================

import runpodSdk from 'runpod-sdk';
import { FFmpegService } from './services/ffmpegService';
import { logger } from '../shared/utils/logger';
import {
  RunPodJobInput,
  CaptionRequest,
  Img2VidRequest,
  AddAudioRequest
} from '../shared/types';

// Initialize FFmpeg Service
const ffmpegService = new FFmpegService();

/**
 * RunPod Handler Function
 * This function is called by RunPod for each job
 */
async function handler(job: { input: RunPodJobInput }): Promise<any> {
  const startTime = Date.now();
  const { operation, ...data } = job.input;

  logger.info('🚀 Job received', {
    operation,
    jobId: (job as any).id,
    input: data
  });

  try {
    // Initialize FFmpeg service (create dirs)
    await ffmpegService.initialize();

    let result: any;

    // Route to appropriate handler based on operation
    switch (operation) {
      case 'caption':
        const captionPath = await handleCaption(data as CaptionRequest);
        result = { video_url: captionPath };
        break;

      case 'img2vid':
        result = await handleImg2Vid(data as Img2VidRequest);
        break;

      case 'addaudio':
        const audioPath = await handleAddAudio(data as AddAudioRequest);
        result = { video_url: audioPath };
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    logger.info('✅ Job completed successfully', {
      operation,
      durationMs,
      durationSec: (durationMs / 1000).toFixed(2),
      result
    });

    // Return result in format expected by RunPod
    return {
      success: true,
      message: `${operation} completed successfully`,
      ...result,
      stats: {
        operation,
        processingTimeMs: durationMs,
        processingTimeSec: parseFloat((durationMs / 1000).toFixed(2))
      }
    };

  } catch (error) {
    const endTime = Date.now();
    const durationMs = endTime - startTime;

    logger.error('❌ Job failed', {
      operation,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      durationMs
    });

    // RunPod expects errors to be thrown
    throw new Error(
      `Job failed (${operation}): ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Handle Caption operation
 */
async function handleCaption(data: CaptionRequest): Promise<string> {
  const { url_video, url_srt } = data;

  if (!url_video || !url_srt) {
    throw new Error('url_video and url_srt are required');
  }

  logger.info('📹 Processing caption', { url_video, url_srt });

  const outputPath = await ffmpegService.addCaption(url_video, url_srt);

  return outputPath;
}

/**
 * Handle Img2Vid batch operation
 */
async function handleImg2Vid(data: Img2VidRequest): Promise<any> {
  const { images } = data;

  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new Error('images array is required with at least one image');
  }

  // Validate each image
  for (const img of images) {
    if (!img.id || !img.image_url || !img.duracao) {
      throw new Error('Each image must have id, image_url, and duracao');
    }
  }

  logger.info('🖼️ Processing img2vid batch', {
    imageCount: images.length,
    batchSize: process.env.BATCH_SIZE || 3
  });

  const results = await ffmpegService.imagesToVideos(images);

  // Return batch result format
  return {
    videos: results.map(r => ({
      id: r.id,
      video_url: r.video_path
    })),
    total: images.length,
    processed: results.length
  };
}

/**
 * Handle AddAudio operation
 */
async function handleAddAudio(data: AddAudioRequest): Promise<string> {
  const { url_video, url_audio } = data;

  if (!url_video || !url_audio) {
    throw new Error('url_video and url_audio are required');
  }

  logger.info('🎵 Processing addaudio', { url_video, url_audio });

  const outputPath = await ffmpegService.addAudio(url_video, url_audio);

  return outputPath;
}

// ============================================
// Start RunPod Serverless Worker
// ============================================

if (require.main === module) {
  logger.info('🏁 Starting RunPod Serverless Worker');
  logger.info('⚙️ Configuration', {
    workDir: process.env.WORK_DIR || '/tmp/work',
    outputDir: process.env.OUTPUT_DIR || '/tmp/output',
    nodeVersion: process.version
  });

  // Start the serverless worker
  runpodSdk.serverless.start({
    handler
  });

  logger.info('✅ RunPod Worker ready to receive jobs');
}

export { handler };
