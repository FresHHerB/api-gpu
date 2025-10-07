// ============================================
// Shared Types - Usado por Orchestrator e Worker
// ============================================

// ============================================
// Request/Response Types
// ============================================

export interface CaptionRequest {
  url_video: string;
  url_srt: string;
  path: string; // S3 path including /videos/ (e.g., "Sleepless Historian/Video Title/videos/")
  output_filename: string; // Output filename (e.g., "video_legendado.mp4")
  // bucket is read from S3_BUCKET_NAME env var
}

export interface Img2VidImage {
  id: string;
  image_url: string;
  duracao: number; // duração em segundos
}

export interface Img2VidRequest {
  images: Img2VidImage[];
  path: string; // S3 path including /videos/temp/ (e.g., "Sleepless Historian/Video Title/videos/temp/")
  // frame_rate is fixed at 24fps
  // output filenames are auto-generated: video_1.mp4, video_2.mp4, etc.
  // bucket is read from S3_BUCKET_NAME env var
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
  path: string; // S3 path including /videos/ (e.g., "Sleepless Historian/Video Title/videos/")
  output_filename: string; // Output filename (e.g., "video_e_audio.mp4")
  // bucket is read from S3_BUCKET_NAME env var
}

// ============================================
// Caption Style Types
// ============================================

export interface SubtitleStyleFont {
  name?: string; // Font name (e.g., "Arial", "Roboto")
  size?: number; // Font size in points (default: 24)
  bold?: boolean; // Bold text (default: false)
  italic?: boolean; // Italic text (default: false)
  underline?: boolean; // Underline text (default: false)
}

export interface SubtitleStyleColors {
  primary?: string; // Primary text color in HTML hex format (e.g., "#FFFFFF")
  primaryAlpha?: number; // Primary color alpha/opacity 0-255 (0=opaque, 255=transparent, default: 0)
  outline?: string; // Outline/border color in HTML hex format (e.g., "#000000")
  outlineAlpha?: number; // Outline color alpha 0-255 (default: 0)
  background?: string; // Background/shadow color in HTML hex format (e.g., "#000000")
  backgroundAlpha?: number; // Background color alpha 0-255 (default: 128)
}

export interface SubtitleStyleBorder {
  style?: number; // Border style: 0=none, 1=outline+shadow, 3=opaque box, 4=background box (default: 1)
  width?: number; // Border/outline width in pixels 0-4 (default: 2)
  shadow?: number; // Shadow depth in pixels 0-4 (default: 1)
}

export interface SubtitleStylePosition {
  alignment?: number; // Numpad layout: 1-3 (bottom), 4-6 (middle), 7-9 (top), 2=bottom center (default: 2)
  marginVertical?: number; // Vertical margin in pixels (default: 25)
  marginLeft?: number; // Left margin in pixels (default: 10)
  marginRight?: number; // Right margin in pixels (default: 10)
}

export interface SubtitleStyle {
  font?: SubtitleStyleFont;
  colors?: SubtitleStyleColors;
  border?: SubtitleStyleBorder;
  position?: SubtitleStylePosition;
}

export interface CaptionStyledRequest {
  url_video: string;
  url_srt: string;
  path: string; // S3 path including /videos/ (e.g., "Sleepless Historian/Video Title/videos/")
  output_filename: string; // Output filename (e.g., "video_legendado.mp4")
  style?: SubtitleStyle; // Optional subtitle styling (uses defaults if not provided)
  // bucket is read from S3_BUCKET_NAME env var
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
