import axios, { AxiosError } from 'axios';
import {
  TranscriptionRequest,
  TranscriptionOutput,
  RunPodJobResponse
} from '../../shared/types';

// ============================================
// RunPod Whisper Official Service
// Handles communication with OpenAI Whisper Official worker (whisper-hub)
// ============================================

export class RunPodWhisperOfficialService {
  private readonly apiKey: string;
  private readonly endpointId: string;
  private readonly baseUrl: string;
  private readonly maxAttempts: number;

  constructor() {
    this.apiKey = process.env.RUNPOD_API_KEY!;
    this.endpointId = process.env.RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID!;
    this.baseUrl = `https://api.runpod.ai/v2/${this.endpointId}`;
    this.maxAttempts = parseInt(process.env.POLLING_MAX_ATTEMPTS || '240');

    if (!this.apiKey) {
      throw new Error('RUNPOD_API_KEY not configured');
    }
    if (!this.endpointId) {
      throw new Error('RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID not configured');
    }
  }

  /**
   * Process transcription using RunPod OpenAI Whisper Official worker
   */
  async processTranscription(request: TranscriptionRequest): Promise<TranscriptionOutput> {
    try {
      console.log(`[RunPodWhisperOfficialService] Starting transcription for: ${request.audio_url}`);

      // Submit job to RunPod
      const jobId = await this.submitJob(request);
      console.log(`[RunPodWhisperOfficialService] Job submitted: ${jobId}`);

      // Poll for completion
      const result = await this.pollJobStatus(jobId);
      console.log(`[RunPodWhisperOfficialService] Job completed: ${jobId}`);

      return result;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        console.error('[RunPodWhisperOfficialService] Axios error:', {
          status: axiosError.response?.status,
          data: axiosError.response?.data,
          message: axiosError.message
        });
        throw new Error(`RunPod API error: ${axiosError.message}`);
      }
      throw error;
    }
  }

  /**
   * Submit transcription job to RunPod
   */
  private async submitJob(request: TranscriptionRequest): Promise<string> {
    // Simplified payload for OpenAI Whisper Official worker
    // Only sends parameters supported by whisper-hub handler
    const payload = {
      input: {
        audio: request.audio_url,
        model: request.model || 'base',
        language: request.language || null,
        temperature: request.temperature !== undefined ? request.temperature : 0.0,
        beam_size: request.beam_size !== undefined ? request.beam_size : 5,
        word_timestamps: true // Always request word-level timestamps
      }
    };

    const response = await axios.post(`${this.baseUrl}/run`, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      timeout: 30000
    });

    if (!response.data?.id) {
      throw new Error('Invalid RunPod response: missing job ID');
    }

    return response.data.id;
  }

  /**
   * Poll job status until completion
   */
  private async pollJobStatus(jobId: string): Promise<TranscriptionOutput> {
    let attempts = 0;
    let delay = 2000; // Start with 2 seconds
    const maxDelay = 8000; // Max 8 seconds between polls

    while (attempts < this.maxAttempts) {
      attempts++;

      try {
        const response = await axios.get<RunPodJobResponse>(
          `${this.baseUrl}/status/${jobId}`,
          {
            headers: { 'Authorization': `Bearer ${this.apiKey}` },
            timeout: 30000
          }
        );

        const { status, output, error } = response.data;

        console.log(`[RunPodWhisperOfficialService] Poll ${attempts}/${this.maxAttempts} - Status: ${status}`);

        if (status === 'COMPLETED') {
          if (!output) {
            throw new Error('Job completed but output is missing');
          }
          return output as TranscriptionOutput;
        }

        if (status === 'FAILED') {
          throw new Error(`RunPod job failed: ${error || 'Unknown error'}`);
        }

        if (status === 'CANCELLED') {
          throw new Error('RunPod job was cancelled');
        }

        if (status === 'TIMED_OUT') {
          throw new Error('RunPod job timed out');
        }

        // Exponential backoff: 2s, 4s, 8s, 8s, ...
        await new Promise(resolve => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, maxDelay);

      } catch (error) {
        if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
          console.warn(`[RunPodWhisperOfficialService] Poll timeout on attempt ${attempts}, retrying...`);
          continue;
        }
        throw error;
      }
    }

    throw new Error(`Transcription timed out after ${this.maxAttempts} attempts`);
  }

  /**
   * Health check for RunPod endpoint
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      const response = await axios.get(`${this.baseUrl}/health`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
        timeout: 10000
      });

      return {
        healthy: true,
        message: `RunPod Whisper Official endpoint is healthy: ${JSON.stringify(response.data)}`
      };
    } catch (error) {
      return {
        healthy: false,
        message: `RunPod Whisper Official endpoint health check failed: ${error}`
      };
    }
  }
}
