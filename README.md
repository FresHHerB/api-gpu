# AutoDark API GPU

> Enterprise-grade serverless video processing API powered by RunPod GPU workers and intelligent queue management.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)](https://www.typescriptlang.org/)
[![Python](https://img.shields.io/badge/Python-3.11-green)](https://www.python.org/)
[![RunPod](https://img.shields.io/badge/RunPod-Serverless-purple)](https://runpod.io/)

## Overview

AutoDark API GPU is a production-ready, scalable video processing platform that combines:

- **Serverless GPU Workers** - Auto-scaling RunPod workers (0-3 instances)
- **Intelligent Queue System** - Redis-backed job queue with worker leak protection
- **Hybrid Processing** - GPU acceleration for compute-intensive tasks, CPU optimization for I/O-bound operations
- **S3/MinIO Integration** - Direct cloud storage with public URL generation
- **Webhook Notifications** - Async job completion callbacks
- **Zero Idle Costs** - Pay only for actual processing time

### Key Capabilities

| Feature | Description | Performance |
|---------|-------------|-------------|
| **Audio Transcription (Faster-Whisper)** | GPU-accelerated transcription with SRT/ASS karaoke output | 10min audio → 30-60s |
| **Audio Transcription (OpenAI Whisper)** | Official OpenAI Whisper model for highest accuracy | 10min audio → 30-60s |
| **Image to Video** | Ken Burns effects with customizable zoom patterns | 1 image → ~7s (CPU-optimized) |
| **Styled Captions** | ASS subtitles with full customization (segments/karaoke) | 10s video → ~6-8s |
| **Background Music** | Add trilha sonora with automatic volume reduction | 10s video → ~5-7s |
| **Audio Sync** | Replace or add audio tracks to videos | 10s video → ~4-6s |
| **Video Concatenation** | Merge multiple videos with transition handling | 2 videos → ~8-10s |
| **Audio Concatenation** | Merge multiple audio files (MP3/AAC/WAV) | 3 files → ~2-4s |
| **YouTube Transcription** | Extract auto-generated captions from YouTube | Real-time |
| **Image Generation** | AI image generation via Runware/OpenRouter | Variable |

---

## Documentation

| Document | Description |
|----------|-------------|
| **[API Reference](docs/API.md)** | Complete endpoint documentation with examples and TypeScript types |
| **[Architecture Guide](docs/ARCHITECTURE.md)** | System design, data flows, and technical decisions |
| **[Deployment Guide](docs/DEPLOYMENT.md)** | Production deployment instructions |
| **[Transcription Details](docs/TRANSCRIPTION.md)** | Whisper model selection and output formats |

---

## Quick Start

### Prerequisites

- Node.js 20+ / TypeScript 5.9+
- Docker (for worker deployment)
- RunPod Account with API key
- S3-compatible storage (MinIO, AWS S3, etc.)
- Redis (optional, recommended for production)

### Installation

```bash
# Clone repository
git clone https://github.com/your-org/api-gpu.git
cd api-gpu

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Configuration

Edit `.env` with your credentials:

```bash
# Server Configuration
PORT=3000
NODE_ENV=production
X_API_KEY=your-secure-api-key-here

# RunPod Endpoints
RUNPOD_API_KEY=rpa_xxxxxxxxxxxxxxxxxxxxx
RUNPOD_ENDPOINT_ID=your_video_endpoint_id        # For video processing
RUNPOD_WHISPER_ENDPOINT_ID=your_whisper_endpoint # For transcription

# S3/MinIO Storage
S3_ENDPOINT_URL=https://s3.your-domain.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=media-bucket
S3_REGION=us-east-1

# Queue System (Redis recommended for production)
QUEUE_STORAGE=REDIS                    # Options: MEMORY | REDIS
REDIS_URL=redis://localhost:6379
MAX_WORKERS=3                          # RunPod endpoint worker limit

# VPS Local Workers (CPU fallback)
VPS_MAX_CONCURRENT_JOBS=2             # Local CPU worker pool size

# Optional: External Services
OPENROUTER_API_KEY=sk_or_xxxxx       # For AI prompt generation
RUNWARE_API_KEY=xxxxx                # For AI image generation
```

### Build & Run

```bash
# Build TypeScript
npm run build:orchestrator

# Start server
npm run start:orchestrator

# Expected output:
# ✅ Queue System started successfully
# ✅ Local Worker Service started (2 concurrent jobs)
# ✅ Browser Pool initialized (YouTube transcription)
# 🚀 Orchestrator started on port 3000
```

---

## 📖 API Examples

### Transcribe Audio (Synchronous)

Transcribe audio files with Faster Whisper and get SRT/ASS subtitles:

```bash
curl -X POST https://api.your-domain.com/runpod/audio/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "audio_url": "https://example.com/podcast.mp3",
    "path": "podcast/episode-01/transcriptions/",
    "model": "large-v3",
    "language": "pt"
  }'
```

<details>
<summary>Response Example</summary>

```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "audio": {
    "duration": 600.5,
    "language": "pt",
    "language_probability": 0.98
  },
  "files": {
    "segments": {
      "srt": "https://s3.your-domain.com/podcast/episode-01/transcriptions/segments.srt",
      "json": "https://s3.your-domain.com/podcast/episode-01/transcriptions/segments.json"
    },
    "words": {
      "ass_karaoke": "https://s3.your-domain.com/podcast/episode-01/transcriptions/karaoke.ass",
      "json": "https://s3.your-domain.com/podcast/episode-01/transcriptions/words.json"
    }
  },
  "processing_time": "45.2s"
}
```
</details>

---

### Image to Video with Ken Burns Effects (Asynchronous)

Convert images to videos with cinematic zoom effects:

```bash
curl -X POST https://api.your-domain.com/runpod/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-app.com/webhooks/video-complete",
    "id_roteiro": 42,
    "path": "projects/summer-vacation/videos/",
    "images": [
      {
        "id": "beach-1",
        "image_url": "https://example.com/photos/beach.jpg",
        "duracao": 5.0
      },
      {
        "id": "sunset-1",
        "image_url": "https://example.com/photos/sunset.jpg",
        "duracao": 6.5
      }
    ],
    "zoom_types": ["zoomin", "zoomout", "zoompanright"]
  }'
```

<details>
<summary>Immediate Response (202 Accepted)</summary>

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "operation": "img2vid",
  "idRoteiro": 42,
  "message": "Job queued successfully",
  "estimatedTime": "~1 minute",
  "queuePosition": 1,
  "statusUrl": "/jobs/550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-10-21T14:30:00.000Z",
  "workersReserved": 1
}
```
</details>

<details>
<summary>Webhook Callback (on completion)</summary>

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 42,
  "status": "COMPLETED",
  "operation": "img2vid",
  "processor": "GPU",
  "result": {
    "code": 200,
    "message": "2 videos processed successfully",
    "videos": [
      {
        "id": "beach-1",
        "filename": "beach-1_video.mp4",
        "url": "https://s3.your-domain.com/projects/summer-vacation/videos/beach-1_video.mp4",
        "size_mb": 2.4,
        "duration": 5.0,
        "zoom_type": "zoomin"
      },
      {
        "id": "sunset-1",
        "filename": "sunset-1_video.mp4",
        "url": "https://s3.your-domain.com/projects/summer-vacation/videos/sunset-1_video.mp4",
        "size_mb": 3.1,
        "duration": 6.5,
        "zoom_type": "zoomout"
      }
    ]
  },
  "execution": {
    "startTime": "2025-10-21T14:30:02.000Z",
    "endTime": "2025-10-21T14:30:16.000Z",
    "durationMs": 14000,
    "durationSeconds": 14.0
  },
  "timestamp": "2025-10-21T14:30:16.123Z"
}
```
</details>

---

### Add Styled Captions (Asynchronous)

Add customizable ASS subtitles to videos:

```bash
curl -X POST https://api.your-domain.com/runpod/video/caption_style \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-app.com/webhooks/caption-done",
    "id_roteiro": 100,
    "url_video": "https://example.com/raw-video.mp4",
    "url_caption": "https://s3.your-domain.com/subtitles/episode-01.srt",
    "path": "final-videos/",
    "output_filename": "episode-01-captioned.mp4",
    "type": "segments",
    "style": {
      "font": {
        "name": "Arial",
        "size": 48,
        "bold": true,
        "italic": false
      },
      "colors": {
        "primary": "#FFFFFF",
        "secondary": "#FFFF00",
        "outline": "#000000",
        "background": "#000000"
      },
      "opacity": {
        "primary": 100,
        "background": 80
      },
      "borders": {
        "outline": 2,
        "shadow": 1,
        "style": 1
      },
      "position": {
        "alignment": "bottom_center",
        "margin_v": 20
      }
    }
  }'
```

**Zoom Type Options:**
- `zoomin` - Focus effect (0.8x → 1.2x scale)
- `zoomout` - Pull-back effect (1.2x → 0.8x scale)
- `zoompanright` - Dynamic right pan with zoom (0.9x → 1.1x + horizontal movement)

See [API Reference](docs/API.md) for complete parameter documentation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          CLIENT                                 │
│          (Web App, Mobile App, Automation Service)              │
└────────────────────────┬────────────────────────────────────────┘
                         │ HTTPS POST/GET
                         │ X-API-Key authentication
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   ORCHESTRATOR (VPS/Cloud)                      │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │  Express.js REST API                                     │ │
│   │  • Request validation (Joi schemas)                      │ │
│   │  • Job queue management (Redis/Memory)                   │ │
│   │  • Worker pool coordination (semaphore-based)            │ │
│   │  • Webhook notification service                          │ │
│   │  • Periodic worker recovery (5min validation)            │ │
│   └──────────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │  Local VPS Workers (CPU Fallback)                        │ │
│   │  • Concurrent job pool (0-2 workers)                     │ │
│   │  • FFmpeg CPU processing                                 │ │
│   │  • YouTube caption extraction (Playwright)               │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │ RunPod Serverless API
                         │ Job submission + polling
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    RUNPOD SERVERLESS                            │
│   • Auto-scaling: 0-3 GPU workers                               │
│   • GPUs: NVIDIA AMPERE 16GB/24GB, RTX A4000                    │
│   • Cold start: ~15s | Idle timeout: 5min                       │
│   • Max execution: 40min per job                                │
└────────────────────────┬────────────────────────────────────────┘
                         │ Docker container execution
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│              PYTHON WORKER (oreiasccp/api-gpu-worker)           │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │  Media Download                                          │ │
│   │  • HTTP/HTTPS URLs                                       │ │
│   │  • Google Drive (direct download, >25MB support)        │ │
│   │  • S3/MinIO (pre-signed URLs)                           │ │
│   └──────────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │  FFmpeg Processing (Hybrid GPU/CPU)                      │ │
│   │  • img2vid: libx264 veryfast (CPU-optimized)            │ │
│   │  • transcription: Faster Whisper large-v3 (GPU)         │ │
│   │  • caption/audio: h264_nvenc (GPU when available)       │ │
│   │  • Dynamic batch size: 1.5x CPU cores                   │ │
│   │  • RAM cache: /dev/shm for temp files                   │ │
│   └──────────────────────────────────────────────────────────┘ │
│   ┌──────────────────────────────────────────────────────────┐ │
│   │  S3 Upload (boto3)                                       │ │
│   │  • Parallel uploads                                      │ │
│   │  • Public URL generation                                 │ │
│   │  • Optional base64 encoding (<10MB)                     │ │
│   └──────────────────────────────────────────────────────────┘ │
└────────────────────────┬────────────────────────────────────────┘
                         │ S3 PutObject
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                  S3/MinIO OBJECT STORAGE                        │
│   • Bucket: configurable (default: canais)                     │
│   • Public URL generation with presigned URLs                  │
│   • Optional lifecycle policies for cleanup                    │
└─────────────────────────────────────────────────────────────────┘
```

**Data Flow Example (img2vid):**
1. Client sends POST /runpod/video/img2vid with images array
2. Orchestrator validates request, calculates workers needed (Math.ceil(count/34))
3. Job queued, orchestrator reserves workers (Redis semaphore)
4. Job submitted to RunPod endpoint
5. RunPod scales worker pod (cold start ~15s)
6. Python worker downloads images, processes with FFmpeg
7. Videos uploaded to S3, public URLs generated
8. RunPod job marked complete, orchestrator polls status
9. Orchestrator sends webhook with results, releases workers

See [Architecture Guide](docs/ARCHITECTURE.md) for detailed technical design.

---

## Technology Stack

### Orchestrator (Node.js/TypeScript)
- **Runtime**: Node.js 20 LTS
- **Language**: TypeScript 5.9
- **Web Framework**: Express.js 4.x
- **Validation**: Joi schemas
- **Queue**: Redis (ioredis) or in-memory
- **HTTP Client**: Axios
- **Testing**: Jest (unit tests)
- **Process Manager**: PM2 (production)

### Worker (Python)
- **Runtime**: Python 3.11
- **Video Processing**: FFmpeg 6.0+ with NVENC support
- **Transcription**: Faster Whisper (large-v3 model)
- **S3 Client**: boto3
- **Subtitle Generation**: Custom ASS generator
- **Concurrency**: psutil for CPU detection
- **YouTube**: Playwright (browser automation)

### Infrastructure
- **Serverless**: RunPod GPU workers
- **Storage**: S3-compatible (MinIO, AWS S3)
- **Queue**: Redis 7.x (recommended) or Memory
- **Container**: Docker multi-stage builds
- **Monitoring**: Structured JSON logging (Pino)

---

## 📊 Performance Benchmarks

| Operation | Input | Processing Time | Notes |
|-----------|-------|-----------------|-------|
| **Transcription** | 1min audio | 5-10s | Faster Whisper large-v3 GPU |
| **Transcription** | 10min audio | 30-60s | Batch processing optimized |
| **Transcription** | 60min audio | 3-5min | Long-form content |
| **img2vid** | 1 image (3s video) | ~7s | CPU-optimized libx264 veryfast |
| **img2vid** | 50 images | ~2min | Multi-worker parallel (2 workers) |
| **caption_style** | 10s video | 6-8s | GPU NVENC encoding |
| **addaudio** | 10s video | 4-6s | Stream copy when possible |
| **concatenate** | 2 videos | 8-10s | Re-encoding with NVENC |

**Cold Start Overhead:** +10-15s when workers are idle (RunPod scales from 0)

**Optimization Strategies:**
- **Dynamic Batching**: img2vid divides >34 images across multiple workers
- **RAM Cache**: Uses /dev/shm for 10-50x faster I/O
- **Codec Selection**: CPU (libx264) for I/O-bound, GPU (NVENC) for compute-bound
- **Worker Pool**: Semaphore-based coordination prevents overload

---

## 🔐 Security

### Authentication
- **API Key**: All endpoints require `X-API-Key` header (except health checks)
- **Webhook HMAC**: Optional signature verification with `WEBHOOK_SECRET`
- **SSRF Protection**: URL validation blocks private/localhost IPs

### Data Protection
- **S3 Pre-signed URLs**: Time-limited access to cloud storage
- **Input Validation**: Joi schemas prevent injection attacks
- **Rate Limiting**: Per-IP throttling (configurable)
- **CORS**: Configured allowed origins

### Infrastructure
- **HTTPS Only**: TLS 1.2+ required for all communications
- **Secrets Management**: Environment variables, never in code
- **Container Isolation**: Serverless workers in sandboxed pods
- **Audit Logging**: All requests logged with correlation IDs

---

## 🚢 Deployment

### RunPod Worker Deployment

1. **Build Docker Image:**
```bash
docker build -f docker/worker-python.Dockerfile \
  -t yourdockerhub/api-gpu-worker:latest .
docker push yourdockerhub/api-gpu-worker:latest
```

2. **Create RunPod Template:**
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveTemplate(input: {
      name: \"api-gpu-worker-v3\"
      imageName: \"yourdockerhub/api-gpu-worker:latest\"
      dockerArgs: \"python -u rp_handler.py\"
      containerDiskInGb: 10
      volumeInGb: 0
      isServerless: true
      env: [
        {key: \"S3_ENDPOINT_URL\" value: \"https://s3.example.com\"}
        {key: \"S3_ACCESS_KEY\" value: \"your_key\"}
        {key: \"S3_SECRET_KEY\" value: \"your_secret\"}
        {key: \"S3_BUCKET_NAME\" value: \"media\"}
      ]
    }) { id name } }"
  }'
```

3. **Create Serverless Endpoint:**
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveEndpoint(input: {
      name: \"api-gpu-production\"
      templateId: \"YOUR_TEMPLATE_ID\"
      workersMin: 0
      workersMax: 3
      gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\"
      scalerType: \"QUEUE_DELAY\"
      scalerValue: 3
    }) { id name } }"
  }'
```

### Orchestrator Deployment (VPS)

**Docker Compose:**
```yaml
services:
  orchestrator:
    build: .
    ports:
      - "3000:3000"
    environment:
      - REDIS_URL=redis://redis:6379
      - QUEUE_STORAGE=REDIS
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  redis_data:
```

**PM2 (Production):**
```bash
npm run build:orchestrator
pm2 start dist/orchestrator/index.js \
  --name api-gpu \
  --instances 2 \
  --exec-mode cluster
pm2 save
```

See [Deployment Guide](docs/DEPLOYMENT.md) for complete instructions.

---

## Development

### Setup
```bash
npm install
cp .env.example .env
# Edit .env with development credentials
```

### Build
```bash
npm run build:orchestrator   # Build TypeScript
npm run build:worker         # Build worker (if needed)
```

### Run
```bash
npm run dev:orchestrator     # Development mode with hot reload
npm run start:orchestrator   # Production mode
```

### Testing
```bash
npm test                     # Run all tests
npm run test:watch           # Watch mode
npm run test:coverage        # Coverage report
```

### Linting
```bash
npm run lint                 # Check code style
npm run lint:fix             # Auto-fix issues
```

---

## 📝 API Endpoints Summary

| Endpoint | Method | Type | Description |
|----------|--------|------|-------------|
| **Video Processing (RunPod GPU)** ||||
| `/runpod/video/img2vid` | POST | Async | Image to video with Ken Burns |
| `/runpod/video/addaudio` | POST | Async | Add/replace audio track |
| `/runpod/video/concatenate` | POST | Async | Merge multiple videos |
| `/runpod/video/caption_style` | POST | Async | Add styled ASS captions |
| `/runpod/video/concat_video_audio` | POST | Async | Cycle videos to match audio |
| `/runpod/video/trilhasonora` | POST | Async | Add background music with volume reduction |
| **Video Processing (VPS CPU)** ||||
| `/vps/video/img2vid` | POST | Async | Image to video (CPU-based) |
| `/vps/video/addaudio` | POST | Async | Add audio (CPU-based) |
| `/vps/video/concatenate` | POST | Async | Concatenate videos (CPU-based) |
| `/vps/video/caption_style` | POST | Async | Add captions (CPU-based) |
| `/vps/video/transcribe_youtube` | POST | Sync | Extract YouTube captions |
| **Audio Processing** ||||
| `/runpod/audio/transcribe` | POST | Sync | Faster-Whisper transcription |
| `/runpod/audio/transcribe-whisper` | POST | Sync | OpenAI Whisper Official |
| `/vps/audio/concatenate` | POST | Sync | Merge audio files |
| **Image Generation** ||||
| `/vps/imagem/gerarPrompts` | POST | Sync | Generate AI prompts |
| `/vps/imagem/gerarImagens` | POST | Sync | Generate AI images |
| **Job Management** ||||
| `/jobs/:jobId` | GET | - | Check job status |
| `/jobs/:jobId/cancel` | POST | - | Cancel job |
| `/queue/stats` | GET | - | Queue statistics |
| **Admin** ||||
| `/admin/recover-workers` | POST | - | Recover leaked workers |
| `/admin/workers/status` | GET | - | Worker diagnostics |
| **Health** ||||
| `/` | GET | - | API information |
| `/health` | GET | - | Orchestrator health |
| `/runpod/audio/transcribe/health` | GET | - | Faster-Whisper health |
| `/runpod/audio/transcribe-whisper/health` | GET | - | OpenAI Whisper health |
| `/vps/audio/health` | GET | - | Audio processor health |

See [API Reference](docs/API.md) for complete documentation.

---

## 🐛 Troubleshooting

### Common Issues

**Worker not starting (RunPod)**
- Verify Docker image is public or credentials configured
- Check RunPod template environment variables
- Review logs in RunPod Console

**S3 Upload Failed**
```bash
# Test S3 connection
aws s3 ls s3://your-bucket --endpoint-url https://s3.example.com

# Verify credentials
echo $S3_ACCESS_KEY
echo $S3_SECRET_KEY
```

**Webhook not received**
- Ensure webhook URL is publicly accessible (no localhost)
- Check firewall allows orchestrator IP
- Review job status: `GET /jobs/:jobId` for webhook errors

**Worker Leaks**
```bash
# Check worker status
curl https://api.example.com/admin/workers/status \
  -H "X-API-Key: your-key"

# Manually recover
curl -X POST https://api.example.com/admin/recover-workers \
  -H "X-API-Key: your-key"
```

**Queue Stuck**
- Check Redis connectivity: `redis-cli ping`
- Review queue stats: `GET /queue/stats`
- Restart orchestrator to trigger worker recovery

See [Deployment Guide - Troubleshooting](docs/DEPLOYMENT.md#troubleshooting) for detailed solutions.

---

## 🤝 Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Code style guidelines
- Testing requirements
- Pull request process
- Development setup

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🔗 Links

- **Documentation**: [docs/](docs/)
- **RunPod**: https://runpod.io/
- **FFmpeg**: https://ffmpeg.org/
- **MinIO**: https://min.io/
- **Issues**: https://github.com/your-org/api-gpu/issues

---

## Support

For support, please:
1. Check [API Reference](docs/API.md) and [Deployment Guide](docs/DEPLOYMENT.md)
2. Review [Troubleshooting](#troubleshooting) section
3. Search [existing issues](https://github.com/your-org/api-gpu/issues)
4. Open a new issue with:
   - Detailed description
   - Request/response examples
   - Relevant logs
   - Environment details

---

© 2025 AutoDark API GPU. MIT License.
