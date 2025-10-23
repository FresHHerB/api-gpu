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

export type ZoomType = 'zoomin' | 'zoomout' | 'zoompanright';

export interface Img2VidRequest {
  images: Img2VidImage[];
  path: string; // S3 path including /videos/temp/ (e.g., "Sleepless Historian/Video Title/videos/temp/")
  zoom_types?: ZoomType[]; // Optional: zoom types to distribute proportionally (default: ['zoomin'])
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

export interface ConcatenateVideoUrl {
  video_url: string;
}

export interface ConcatenateRequest {
  video_urls: ConcatenateVideoUrl[];
  path: string; // S3 path including /videos/temp/ (e.g., "Sleepless Historian/Video Title/videos/temp/")
  output_filename: string; // Output filename (e.g., "video_concatenado.mp4")
  // bucket is read from S3_BUCKET_NAME env var
}

export interface ConcatVideoAudioRequest {
  video_urls: string[]; // Array of video URLs (Google Drive, S3, HTTP - will be repeated cyclically)
  audio_url: string; // URL of MP3 audio file
  path: string; // S3 path including /videos/ (e.g., "Channel Name/Video Title/videos/")
  output_filename: string; // Output filename (e.g., "video_final.mp4")
  normalize?: boolean; // Normalize videos to same spec (enables -c copy, default: true)
  // bucket is read from S3_BUCKET_NAME env var
  // Supported video URL formats:
  // - Google Drive: https://drive.google.com/file/d/FILE_ID/view?usp=drive_link
  // - Google Drive: https://drive.google.com/file/d/FILE_ID
  // - Google Drive: https://drive.google.com/file/d/FILE_ID/edit
  // - S3/MinIO: https://minio.example.com/bucket/path/video.mp4
  // - HTTP/HTTPS: https://example.com/video.mp4
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
  operation: JobOperation;
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
// Transcription Types
// ============================================

export interface TranscriptionRequest {
  audio_url: string;
  path: string; // S3 path for uploads (e.g., "transcriptions/job-uuid/")
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v1' | 'large-v2' | 'large-v3' | 'turbo';
  language?: string; // ISO language code (e.g., "pt", "en")
  enable_vad?: boolean; // Voice Activity Detection
  vad_filter?: boolean; // Filter silences
  temperature?: number; // 0.0-1.0
  beam_size?: number; // 1-10
}

export interface TranscriptionSegment {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
}

export interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

export interface TranscriptionOutput {
  segments: TranscriptionSegment[];
  word_timestamps?: TranscriptionWord[];
  detected_language: string;
  transcription: string;
  translation?: string | null;
  device: 'cuda' | 'cpu';
  model: string;
}

export interface TranscriptionFiles {
  segments: {
    srt: string; // S3 URL
    vtt: string; // S3 URL
    json: string; // S3 URL
  };
  words?: {
    ass_karaoke: string; // S3 URL
    vtt_karaoke: string; // S3 URL
    lrc: string; // S3 URL
    json: string; // S3 URL
  };
}

export interface TranscriptionResponse {
  code: number;
  message: string;
  job_id: string;
  language: string;
  transcription: string;
  files: TranscriptionFiles;
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: Record<string, any>;
}

// ============================================
// Express Extensions
// ============================================

export interface AuthenticatedRequest extends Express.Request {
  user?: {
    apiKey: string;
  };
}

// ============================================
// Queue and Job Management Types
// ============================================

export type JobStatus = 'QUEUED' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export type JobOperation =
  | 'img2vid'
  | 'caption'
  | 'addaudio'
  | 'caption_segments'
  | 'caption_highlight'
  | 'concatenate'
  | 'concat_video_audio'
  | 'trilhasonora'
  // VPS (local CPU-based) operations
  | 'img2vid_vps'
  | 'caption_segments_vps'
  | 'caption_highlight_vps'
  | 'addaudio_vps'
  | 'concatenate_vps';

export interface Job {
  jobId: string;                    // UUID gerado pelo orquestrador
  runpodJobIds: string[];           // IDs dos jobs no RunPod (pode ser vazio se QUEUED)
  status: JobStatus;
  operation: JobOperation;
  payload: any;                     // Dados originais da requisição
  webhookUrl: string;               // URL para notificação
  idRoteiro?: number;               // ID do roteiro (cliente)
  pathRaiz?: string;                // Path raiz (para img2vid) - ex: "Channel/Video Title/"
  result?: any;                     // Resultado do processamento
  error?: string;                   // Mensagem de erro (se falhou)
  workersReserved: number;          // Quantos workers este job reservou
  createdAt: Date;
  submittedAt?: Date;
  completedAt?: Date;
  retryCount: number;               // Tentativas de webhook
  attempts: number;                 // Tentativas de processamento
}

export interface QueueStats {
  queued: number;
  submitted: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  totalJobs: number;
  activeWorkers: number;
  availableWorkers: number;
}

export interface WebhookPayload {
  jobId: string;
  idRoteiro?: number;
  pathRaiz?: string;                // Path raiz (para img2vid) - ex: "Channel/Video Title/"
  status: 'COMPLETED' | 'FAILED';
  operation: JobOperation;
  timestamp: string;
  result?: any;                     // Resultado se COMPLETED
  error?: {                         // Erro se FAILED
    code: string;
    message: string;
    details?: string;
  };
  execution?: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
}

// ============================================
// Updated Request Types with Webhook Support
// ============================================

export interface CaptionRequestAsync extends CaptionRequest {
  webhook_url: string;
  id_roteiro?: number;
}

export interface Img2VidRequestAsync extends Img2VidRequest {
  webhook_url: string;
  id_roteiro?: number;
}

export interface AddAudioRequestAsync extends AddAudioRequest {
  webhook_url: string;
  id_roteiro?: number;
}

export interface CaptionStyledRequestAsync extends CaptionStyledRequest {
  webhook_url: string;
  id_roteiro?: number;
}

export interface ConcatenateRequestAsync extends ConcatenateRequest {
  webhook_url: string;
  id_roteiro?: number;
}

export interface ConcatVideoAudioRequestAsync extends ConcatVideoAudioRequest {
  webhook_url: string;
  id_roteiro?: number;
}

// ============================================
// Job Response Types
// ============================================

export interface JobSubmitResponse {
  jobId: string;
  status: JobStatus;
  idRoteiro?: number;
  message: string;
  estimatedTime?: string;
  queuePosition?: number;
  statusUrl: string;
  createdAt: string;
}

export interface JobStatusResponse {
  jobId: string;
  status: JobStatus;
  operation: JobOperation;
  idRoteiro?: number;
  progress?: {
    completed: number;
    total: number;
    percentage: number;
  };
  result?: any;
  error?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  estimatedCompletion?: string;
}

// ============================================
// YouTube Transcript Types
// ============================================

export interface YouTubeTranscriptRequest {
  url: string; // YouTube video URL (youtube.com/watch?v=... or youtu.be/...)
}

export interface YouTubeTranscriptResponse {
  ok: boolean;
  source: string; // Original video URL
  segments_count?: number; // Number of transcript segments
  transcript_text?: string; // Full transcript as continuous text
  raw_segments?: string[]; // Individual transcript segments
  error?: string; // Error message if ok=false
  cached?: boolean; // Whether result came from cache
  execution_time_ms?: number; // Execution time in milliseconds
}

// ============================================
// Image Generation Types
// ============================================

export interface SceneData {
  index: number;
  texto: string;
}

export interface PromptData {
  index: number;
  prompt: string;
}

export interface GeneratedImageData {
  index: number;
  imageURL: string;
  prompt: string;
}

// OpenRouter Types
export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
}

export interface OpenRouterResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Request/Response Types for Image Generation Endpoints
export interface GerarPromptsRequest {
  cenas: SceneData[];
  estilo: string;
  detalhe_estilo: string;
  roteiro: string;
  agente: string;
}

export interface GerarPromptsResponse {
  code: number;
  message: string;
  prompts: PromptData[];
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: {
    totalScenes: number;
    promptsGenerated: number;
    successRate: string;
  };
}

export interface GerarImagensRequest {
  prompts: PromptData[];
  image_model: string;
  altura: number;
  largura: number;
}

export interface GerarImagensResponse {
  code: number;
  message: string;
  images: GeneratedImageData[];
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: {
    totalPrompts: number;
    imagesGenerated: number;
    successRate: string;
  };
}
