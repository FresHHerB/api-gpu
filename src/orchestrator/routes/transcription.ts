import { Router, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
  TranscriptionRequest,
  TranscriptionResponse
} from '../../shared/types';
import { RunPodWhisperService } from '../services/runpodWhisperService';
import { TranscriptionFormatter } from '../services/transcriptionFormatter';
import { S3UploadService } from '../services/s3Upload';

const router = Router();

// Lazy initialization to avoid crash if endpoint not configured
let whisperService: RunPodWhisperService | null = null;
let s3Service: S3UploadService | null = null;

function getWhisperService(): RunPodWhisperService {
  if (!whisperService) {
    whisperService = new RunPodWhisperService();
  }
  return whisperService;
}

function getS3Service(): S3UploadService {
  if (!s3Service) {
    s3Service = new S3UploadService();
  }
  return s3Service;
}

// ============================================
// POST /transcribe
// Process audio transcription with RunPod faster-whisper
// ============================================
router.post('/transcribe', async (req: Request, res: Response) => {
  const startTime = new Date();
  const jobId = randomUUID();

  try {
    console.log(`[Transcription] Job ${jobId} started`);

    // Extract and validate request data
    const { audio_url, path, model, language, enable_vad, beam_size, temperature } = req.body;

    if (!audio_url) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'audio_url is required'
      });
    }

    if (!path) {
      return res.status(400).json({
        error: 'Missing required parameter',
        message: 'path is required for S3 upload'
      });
    }

    // Build transcription request
    const transcriptionRequest: TranscriptionRequest = {
      audio_url,
      path,
      model: model || 'large-v3',
      language: language || undefined,
      enable_vad: enable_vad !== undefined ? enable_vad : true,
      beam_size: beam_size || 5,
      temperature: temperature || 0
    };

    console.log(`[Transcription] Processing: ${audio_url}`);

    // Step 1: Get transcription from RunPod worker
    const transcriptionOutput = await getWhisperService().processTranscription(transcriptionRequest);

    console.log(`[Transcription] Job ${jobId} - Transcription completed`);
    console.log(`[Transcription] Language detected: ${transcriptionOutput.detected_language}`);
    console.log(`[Transcription] Segments: ${transcriptionOutput.segments.length}`);
    console.log(`[Transcription] Words: ${transcriptionOutput.word_timestamps?.length || 0}`);

    // Step 2: Generate files locally
    const segmentsSRT = TranscriptionFormatter.toSRT(transcriptionOutput.segments);
    const wordsJSON = TranscriptionFormatter.toJSON({
      words: transcriptionOutput.word_timestamps || [],
      metadata: {
        language: transcriptionOutput.detected_language,
        model: transcriptionOutput.model,
        device: transcriptionOutput.device
      }
    });

    console.log(`[Transcription] Job ${jobId} - Files generated locally`);

    // Step 3: Generate ASS karaoke only if word timestamps are available
    let karaokeASS = '';
    if (transcriptionOutput.word_timestamps && transcriptionOutput.word_timestamps.length > 0) {
      karaokeASS = TranscriptionFormatter.toASSKaraoke(transcriptionOutput.word_timestamps);
      console.log(`[Transcription] Job ${jobId} - ASS karaoke generated`);
    } else {
      console.warn(`[Transcription] Job ${jobId} - No word timestamps available, skipping ASS karaoke`);
    }

    // Step 4: Upload files to S3
    const uploads = [
      {
        path,
        filename: 'segments.srt',
        content: segmentsSRT,
        contentType: 'text/plain'
      },
      {
        path,
        filename: 'words.json',
        content: wordsJSON,
        contentType: 'application/json'
      }
    ];

    // Add karaoke.ass only if generated
    if (karaokeASS) {
      uploads.push({
        path,
        filename: 'karaoke.ass',
        content: karaokeASS,
        contentType: 'text/plain'
      });
    }

    const uploadedUrls = await getS3Service().uploadFiles(uploads);

    console.log(`[Transcription] Job ${jobId} - Files uploaded to S3`);

    // Step 5: Build response
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    const response: TranscriptionResponse = {
      code: 200,
      message: 'Transcription completed successfully',
      job_id: jobId,
      language: transcriptionOutput.detected_language,
      transcription: transcriptionOutput.transcription,
      files: {
        segments: {
          srt: uploadedUrls['segments.srt'],
          vtt: '', // Not implemented
          json: uploadedUrls['words.json']
        },
        words: karaokeASS ? {
          ass_karaoke: uploadedUrls['karaoke.ass'],
          vtt_karaoke: '', // Not implemented
          lrc: '', // Not implemented
          json: uploadedUrls['words.json']
        } : undefined
      },
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      },
      stats: {
        segments: transcriptionOutput.segments.length,
        words: transcriptionOutput.word_timestamps?.length || 0,
        model: transcriptionOutput.model,
        device: transcriptionOutput.device
      }
    };

    console.log(`[Transcription] Job ${jobId} completed in ${response.execution.durationSeconds}s`);

    return res.status(200).json(response);

  } catch (error: any) {
    const endTime = new Date();
    const durationMs = endTime.getTime() - startTime.getTime();

    console.error(`[Transcription] Job ${jobId} failed:`, error);

    return res.status(500).json({
      error: 'Transcription failed',
      message: error.message || 'Unknown error occurred',
      job_id: jobId,
      execution: {
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        durationMs,
        durationSeconds: parseFloat((durationMs / 1000).toFixed(2))
      }
    });
  }
});

// ============================================
// GET /transcribe/health
// Health check for transcription service
// ============================================
router.get('/transcribe/health', async (_req: Request, res: Response) => {
  try {
    const whisperHealth = await getWhisperService().healthCheck();

    return res.status(whisperHealth.healthy ? 200 : 503).json({
      status: whisperHealth.healthy ? 'healthy' : 'unhealthy',
      service: 'transcription',
      whisper: whisperHealth,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    return res.status(503).json({
      status: 'unhealthy',
      service: 'transcription',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;
