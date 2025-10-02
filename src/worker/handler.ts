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

    let outputPath: string;
    let processingStats: any = {};

    // Route to appropriate handler based on operation
    switch (operation) {
      case 'caption':
        outputPath = await handleCaption(data as CaptionRequest);
        break;

      case 'img2vid':
        outputPath = await handleImg2Vid(data as Img2VidRequest);
        break;

      case 'addaudio':
        outputPath = await handleAddAudio(data as AddAudioRequest);
        break;

      default:
        throw new Error(`Unknown operation: ${operation}`);
    }

    // Get output file stats
    const fileStats = await ffmpegService.getFileStats(outputPath);

    const endTime = Date.now();
    const durationMs = endTime - startTime;

    logger.info('✅ Job completed successfully', {
      operation,
      durationMs,
      durationSec: (durationMs / 1000).toFixed(2),
      outputPath,
      fileStats
    });

    // Return result in format expected by RunPod
    return {
      video_url: `file://${outputPath}`,  // RunPod will handle file serving
      stats: {
        operation,
        processingTimeMs: durationMs,
        processingTimeSec: parseFloat((durationMs / 1000).toFixed(2)),
        outputFile: {
          path: outputPath,
          ...fileStats
        },
        ...processingStats
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
 * Handle Img2Vid operation
 */
async function handleImg2Vid(data: Img2VidRequest): Promise<string> {
  const {
    url_image,
    frame_rate = 24,
    duration = 5.0
  } = data;

  if (!url_image) {
    throw new Error('url_image is required');
  }

  // Validate parameters
  if (frame_rate < 1 || frame_rate > 60) {
    throw new Error('frame_rate must be between 1 and 60');
  }

  if (duration < 0.1 || duration > 60) {
    throw new Error('duration must be between 0.1 and 60 seconds');
  }

  logger.info('🖼️ Processing img2vid', {
    url_image,
    frame_rate,
    duration
  });

  const outputPath = await ffmpegService.imageToVideo(
    url_image,
    duration,
    frame_rate
  );

  return outputPath;
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
