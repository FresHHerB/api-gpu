// ============================================
// Shared Types - Usado por Orchestrator e Worker
// ============================================

// ============================================
// Request/Response Types
// ============================================

export interface CaptionRequest {
  url_video: string;
  url_srt: string;
}

export interface Img2VidImage {
  id: string;
  image_url: string;
  duracao: number; // duração em segundos
}

export interface Img2VidRequest {
  images: Img2VidImage[];
  bucket?: string; // S3 bucket name (e.g., "canais")
  path?: string; // S3 path (e.g., "Sleepless Historian/Video Title")
  // frame_rate is fixed at 24fps
}

export interface Img2VidResponse {
  code: number;
  message: string;
  videos: Array<{
    id: string;
    video_url: string;
  }>;
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: Record<string, any>;
}

export interface AddAudioRequest {
  url_video: string;
  url_audio: string;
}

export interface VideoResponse {
  code: number;
  message: string;
  video_url?: string; // Single video (caption, addaudio)
  videos?: Array<{ // Multiple videos (img2vid)
    id: string;
    video_url: string;
    filename: string;
  }>;
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: Record<string, any>;
}

// ============================================
// RunPod Serverless Types
// ============================================

export interface RunPodJobInput {
  operation: 'caption' | 'img2vid' | 'addaudio';
  [key: string]: any; // Request data (url_video, url_srt, etc)
}

export interface RunPodJobRequest {
  input: RunPodJobInput;
  webhook?: string;
}

export interface RunPodJob {
  id: string;
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
}

export interface RunPodJobResponse {
  id: string;
  status: RunPodJob['status'];
  delayTime?: number;
  executionTime?: number;
  output?: any;
  error?: string;
}

export interface RunPodEndpointConfig {
  endpointId: string;
  apiKey: string;
  idleTimeout?: number; // seconds (default: 300 = 5min)
  maxTimeout?: number; // seconds (default: 600 = 10min)
}


// ============================================
// Error Types
// ============================================

export interface ApiError {
  error: string;
  message: string;
  requestId?: string;
  timestamp?: string;
}

// ============================================
// Health Check Types
// ============================================

export interface HealthCheckResponse {
  status: 'healthy' | 'unhealthy' | 'degraded';
  service: string;
  timestamp: string;
  version?: string;
  uptime?: number;
}

export interface WorkerHealthCheck extends HealthCheckResponse {
  ffmpeg?: {
    available: boolean;
    version?: string;
  };
  gpu?: {
    nvencAvailable: boolean;
    cudaAvailable: boolean;
    gpuModel?: string;
    recommendedEncoder: string;
  };
}

// ============================================
// Express Extensions
// ============================================

export interface AuthenticatedRequest extends Express.Request {
  user?: {
    apiKey: string;
  };
}
