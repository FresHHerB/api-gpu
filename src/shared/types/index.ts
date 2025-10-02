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

export interface Img2VidRequest {
  url_image: string;
  frame_rate: number;
  duration: number;
}

export interface AddAudioRequest {
  url_video: string;
  url_audio: string;
}

export interface VideoResponse {
  code: number;
  message: string;
  video_url: string;
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: Record<string, any>;
}

// ============================================
// Vast.ai Types
// ============================================

export interface VastOffer {
  id: number;
  gpu_name: string;
  gpu_ram: number;
  dph_total: number; // Price per hour
  verification: string;
  rentable: boolean;
  num_gpus: number;
  cuda_max_good: number;
}

export interface VastInstance {
  id: number;
  publicUrl: string;
  sessionToken: string;
  sshHost: string;
  sshPort: string;
  createdAt: Date;
}

export interface VastInstanceDetails {
  id: number;
  actual_status: string;
  ssh_host: string;
  ssh_port: string;
  public_ipaddr: string;
  ports: Record<string, Array<{ HostPort: string }>>;
}

// ============================================
// GPU Requirements
// ============================================

export interface GPURequirements {
  minVram?: number;
  maxPrice?: number;
  gpuModel?: string;
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
