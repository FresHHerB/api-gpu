# API GPU - Serverless Video Processing

Sistema de processamento de vídeo com GPU serverless usando RunPod + FFmpeg NVENC + S3 Storage.

Arquitetura híbrida que combina VPS orchestrator (Node.js/TypeScript) + RunPod Serverless GPU Workers (Python) para processar vídeos com aceleração por hardware, armazenando resultados diretamente em S3/MinIO.

---

## Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Funcionalidades](#funcionalidades)
- [Configuração](#configuração)
- [API Reference](#api-reference)
- [Deploy](#deploy)
- [Troubleshooting](#troubleshooting)

---

## Visão Geral

### Características Principais

- **Serverless GPU**: RunPod auto-scaling (0-N workers)
- **Zero idle cost**: Pague apenas pelo tempo de execução
- **GPU Encoding**: FFmpeg + NVENC (h264_nvenc)
- **S3 Direct Upload**: Resultados salvos diretamente no bucket
- **Batch Processing**: Processamento paralelo de múltiplas imagens
- **Cold Start**: ~10s para iniciar worker

### Stack Tecnológica

**Orchestrator (VPS):**
- Node.js 20+ / TypeScript 5.9
- Express.js (REST API)
- RunPod API Client

**Worker (RunPod Serverless):**
- Python 3.11
- FFmpeg com NVENC
- boto3 (S3 upload)
- RunPod SDK

**Storage:**
- S3/MinIO (object storage)

---

## Arquitetura

### Diagrama de Fluxo

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENTE                                │
│   (Aplicação, API Consumer, Automation)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP POST /video/*
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR (VPS)                         │
│   • Express.js REST API                                     │
│   • Request validation                                      │
│   • RunPod job submission                                   │
│   • Job polling (exponential backoff)                       │
│   • Returns S3 URLs                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ RunPod API (HTTPS)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               RUNPOD SERVERLESS                             │
│   • Auto-scaling: 0-3 workers                               │
│   • GPU: RTX A4500/A5000 (NVENC)                            │
│   • Idle timeout: 5min                                      │
│   • Execution timeout: 8min                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ Job execution
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 PYTHON WORKER                               │
│   • Download media (HTTP requests)                          │
│   • FFmpeg processing (GPU NVENC)                           │
│   • Batch parallel execution                                │
│   • S3 upload (boto3)                                       │
│   • Return public URLs                                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ Upload
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  S3/MinIO STORAGE                           │
│   • Object storage (S3-compatible)                          │
│   • Public URLs                                             │
│   • Optional lifecycle policies                             │
└─────────────────────────────────────────────────────────────┘
```

### Estrutura do Projeto

```
api-gpu/
├── src/
│   ├── orchestrator/              # VPS (Node.js/TypeScript)
│   │   ├── index.ts               # Express server
│   │   ├── routes/
│   │   │   └── videoProxy.ts      # API endpoints
│   │   └── services/
│   │       └── runpodService.ts   # RunPod client
│   │
│   ├── worker-python/             # RunPod Worker (Python)
│   │   ├── rp_handler.py          # Handler + FFmpeg + S3
│   │   └── requirements.txt       # Dependencies
│   │
│   └── shared/                    # Shared (TypeScript)
│       ├── types/index.ts         # Type definitions
│       └── utils/logger.ts        # Logger
│
├── docker/
│   └── worker-python.Dockerfile   # Worker image
│
├── Dockerfile                     # Orchestrator image
├── package.json
├── tsconfig.json
└── .env
```

### Fluxo de Processamento

**1. Request → Orchestrator**
```
Client → POST /video/img2vid → Orchestrator validates → Submit to RunPod
```

**2. RunPod → Worker**
```
RunPod receives job → Assigns to worker (or creates new) → Worker starts
```

**3. Worker Processing**
```
Download images → FFmpeg encode (GPU) → Upload to S3 → Return URLs
```

**4. Response → Client**
```
Orchestrator receives result → Returns S3 URLs → Worker enters idle
```

---

## Funcionalidades

### Transcription (Audio to Text + Subtitles)

Transcrição de áudio usando RunPod faster-whisper com geração automática de legendas.

**Input:**
- Audio URL (MP3/WAV/AAC/M4A)
- S3 path
- Model (tiny, base, small, medium, large-v3, turbo)

**Output:**
- segments.srt (legendas tradicionais)
- karaoke.ass (legendas karaoke com timing por palavra)
- words.json (timestamps palavra-por-palavra)
- Upload automático para S3

**Características:**
- GPU-accelerated transcription (OpenAI Whisper)
- Word-level timestamps para karaoke
- Voice Activity Detection (VAD)
- Suporte multi-idioma
- 2-4x mais rápido que Whisper API oficial

**Documentação:** Ver [TRANSCRIPTION_API.md](./TRANSCRIPTION_API.md)

---

### Caption (Legendas SRT)

Adiciona legendas SRT a vídeos com GPU encoding.

**Input:**
- Video URL (MP4)
- Subtitle URL (SRT)
- S3 path
- Output filename

**Output:**
- Video com legendas embedded
- Upload direto para S3

**FFmpeg Process:**
```
-i video.mp4 -vf subtitles=file.srt -c:v h264_nvenc -preset p4
```

---

### Img2Vid (Image to Video - Batch)

Converte imagens em vídeos com efeito Ken Burns (zoom).

**Input:**
- Array de imagens (URL + duração)
- S3 path

**Output:**
- Múltiplos vídeos (video_1.mp4, video_2.mp4, ...)
- Upload direto para S3

**Características:**
- Batch processing: 5 imagens paralelas (configurável)
- Ken Burns effect: Zoom 1.0 → 1.324 (32.4%)
- Upscale: 6720x3840 (6x) para qualidade
- Output: 1920x1080 @ 24fps
- Codec: h264_nvenc preset p4, CQ 23 VBR

**FFmpeg Process:**
```
-loop 1 -i image.jpg -vf "scale=6720:3840,zoompan=z='min(1+0.324*on/{frames},1.324)':d={frames}:s=1920x1080:fps=24" -c:v h264_nvenc -preset p4 -cq 23
```

**Multi-Worker:**
- Batches >50 imagens são distribuídos entre múltiplos workers
- Máximo 3 workers paralelos
- Resultados mesclados automaticamente

---

### AddAudio (Audio Sync)

Adiciona ou substitui áudio em vídeo.

**Input:**
- Video URL (MP4)
- Audio URL (MP3/AAC/WAV)
- S3 path
- Output filename

**Output:**
- Video com novo áudio
- Duração: menor entre video/audio
- Upload direto para S3

**FFmpeg Process:**
```
-i video.mp4 -i audio.mp3 -c:v h264_nvenc -c:a aac -shortest
```

---

## Configuração

### Pré-requisitos

- Node.js 20+
- Docker
- RunPod account + API key
- S3/MinIO bucket configurado

### Instalação

**1. Clone repositório:**
```bash
git clone https://github.com/your-username/api-gpu.git
cd api-gpu
```

**2. Instale dependências:**
```bash
npm install
```

**3. Configure ambiente:**
```bash
cp .env.example .env
nano .env
```

### Variáveis de Ambiente

#### Orchestrator (VPS)

```bash
# Server
PORT=3000
NODE_ENV=production

# API Authentication
X_API_KEY=your-secure-api-key

# RunPod
RUNPOD_API_KEY=rpa_your_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=480

# S3/MinIO (used by worker)
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1

# Logging
LOG_LEVEL=info
LOGS_DIR=./logs

# CORS
CORS_ALLOW_ORIGINS=*
```

#### Worker (RunPod Template)

```bash
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=5
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
```

### Build Local

```bash
# Orchestrator
npm run build:orchestrator
npm run start:orchestrator

# Output esperado:
# 🚀 RunPodService initialized
# 🌐 Server running on port 3000
```

---

## API Reference

### Authentication

Todas as requisições (exceto `/health`) requerem header:
```
X-API-Key: your-api-key
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check (no auth) |
| POST | `/transcribe` | Audio transcription → SRT/ASS/JSON |
| POST | `/video/caption` | Add SRT subtitles |
| POST | `/video/img2vid` | Convert images to videos |
| POST | `/video/addaudio` | Add/replace audio |
| GET | `/transcribe/health` | Transcription service health |
| GET | `/runpod/health` | RunPod endpoint status |
| GET | `/runpod/config` | RunPod configuration |
| GET | `/job/:jobId` | Check job status |
| POST | `/job/:jobId/cancel` | Cancel running job |

---

### POST /video/caption

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://example.com/subtitles.srt",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_legendado.mp4"
}
```

**Parameters:**
- `url_video` (string, required): Public video URL
- `url_srt` (string, required): Public SRT file URL
- `path` (string, required): S3 key prefix (includes `/videos/`)
- `output_filename` (string, required): Output filename

**Response (200):**
```json
{
  "code": 200,
  "message": "Video caption completed and uploaded to S3 successfully",
  "video_url": "https://s3.../canais/Project Name/Video Title/videos/video_legendado.mp4",
  "execution": {
    "startTime": "2025-10-03T10:00:00.000Z",
    "endTime": "2025-10-03T10:01:30.000Z",
    "durationMs": 90000,
    "durationSeconds": 90
  },
  "stats": {
    "jobId": "runpod-job-abc123",
    "delayTime": 500,
    "executionTime": 89500
  }
}
```

**Error (400):**
```json
{
  "error": "Bad Request",
  "message": "url_video, url_srt, path, and output_filename are required"
}
```

---

### POST /video/img2vid

**Request:**
```json
{
  "images": [
    {
      "id": "img-1",
      "image_url": "https://example.com/photo1.jpg",
      "duracao": 6.48
    },
    {
      "id": "img-2",
      "image_url": "https://example.com/photo2.jpg",
      "duracao": 5.0
    }
  ],
  "path": "Project Name/Video Title/videos/temp/"
}
```

**Parameters:**
- `images` (array, required): Array of images
  - `id` (string, required): Unique identifier
  - `image_url` (string, required): Public image URL (JPG/PNG)
  - `duracao` (number, required): Video duration in seconds
- `path` (string, required): S3 key prefix (includes `/videos/temp/`)

**Notes:**
- Framerate: 24fps (fixed)
- Filenames: auto-generated (video_1.mp4, video_2.mp4, ...)
- Bucket: from `S3_BUCKET_NAME` env var

**Response (200):**
```json
{
  "code": 200,
  "message": "Images converted to videos and uploaded to S3 successfully",
  "videos": [
    {
      "id": "img-1",
      "video_url": "https://s3.../canais/Project/videos/temp/video_1.mp4",
      "filename": "video_1.mp4"
    },
    {
      "id": "img-2",
      "video_url": "https://s3.../canais/Project/videos/temp/video_2.mp4",
      "filename": "video_2.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-03T10:00:00.000Z",
    "endTime": "2025-10-03T10:02:00.000Z",
    "durationMs": 120000,
    "durationSeconds": 120
  },
  "stats": {
    "jobId": "runpod-job-xyz",
    "delayTime": 1200,
    "executionTime": 118800,
    "total": 2,
    "processed": 2
  }
}
```

**Error (400):**
```json
{
  "error": "Bad Request",
  "message": "images array is required with at least one image"
}
```

---

### POST /video/addaudio

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/audio.mp3",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_com_audio.mp4"
}
```

**Parameters:**
- `url_video` (string, required): Public video URL
- `url_audio` (string, required): Public audio URL (MP3/AAC/WAV)
- `path` (string, required): S3 key prefix (includes `/videos/`)
- `output_filename` (string, required): Output filename

**Response (200):**
```json
{
  "code": 200,
  "message": "Video addaudio completed and uploaded to S3 successfully",
  "video_url": "https://s3.../canais/Project/videos/video_com_audio.mp4",
  "execution": {
    "startTime": "2025-10-03T10:00:00.000Z",
    "endTime": "2025-10-03T10:01:00.000Z",
    "durationMs": 60000,
    "durationSeconds": 60
  },
  "stats": {
    "jobId": "runpod-job-def",
    "delayTime": 300,
    "executionTime": 59700
  }
}
```

---

### TypeScript Types

```typescript
// Caption
interface CaptionRequest {
  url_video: string;
  url_srt: string;
  path: string;
  output_filename: string;
}

// Img2Vid
interface Img2VidImage {
  id: string;
  image_url: string;
  duracao: number;
}

interface Img2VidRequest {
  images: Img2VidImage[];
  path: string;
}

// AddAudio
interface AddAudioRequest {
  url_video: string;
  url_audio: string;
  path: string;
  output_filename: string;
}

// Response
interface VideoResponse {
  code: number;
  message: string;
  video_url?: string;
  videos?: Array<{
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
  stats: {
    jobId: string;
    total?: number;
    processed?: number;
  };
}
```

---

## Deploy

### Worker (RunPod Serverless)

**1. Build e Push Docker Image:**

```bash
docker login

docker build -f docker/worker-python.Dockerfile \
  -t your-dockerhub-user/api-gpu-worker:latest .

docker push your-dockerhub-user/api-gpu-worker:latest
```

**2. Criar Template no RunPod:**

RunPod Console → Templates → New Template

```yaml
Template Name: api-gpu-worker-production
Container Image: your-dockerhub-user/api-gpu-worker:latest
Docker Command: python -u rp_handler.py
Container Disk: 10 GB
Serverless: Yes

Environment Variables:
  WORK_DIR: /tmp/work
  OUTPUT_DIR: /tmp/output
  BATCH_SIZE: 5
  S3_ENDPOINT_URL: https://your-minio.example.com
  S3_ACCESS_KEY: your_access_key
  S3_SECRET_KEY: your_secret_key
  S3_BUCKET_NAME: canais
  S3_REGION: us-east-1
```

**3. Criar Endpoint:**

RunPod Console → Serverless → New Endpoint

```yaml
Endpoint Name: api-gpu-worker
Template: api-gpu-worker-production
GPUs: RTX A4500, RTX A5000, AMPERE_16, AMPERE_24
Workers Min: 0
Workers Max: 3
Idle Timeout: 300
Execution Timeout: 480
FlashBoot: Enabled
```

Copie o **Endpoint ID** e **API Key** para `.env`.

---

### Orchestrator (VPS)

**Opção A: Easypanel**

```yaml
App Type: Git
Repository: https://github.com/your-username/api-gpu.git
Branch: main
Build Type: Dockerfile
Dockerfile Path: ./Dockerfile
Port: 3000
```

Configure as variáveis de ambiente conforme seção [Configuração](#configuração).

**Opção B: Docker Compose**

```yaml
version: '3.8'

services:
  orchestrator:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - X_API_KEY=${X_API_KEY}
      - RUNPOD_API_KEY=${RUNPOD_API_KEY}
      - RUNPOD_ENDPOINT_ID=${RUNPOD_ENDPOINT_ID}
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET_NAME=${S3_BUCKET_NAME}
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs
```

Deploy:
```bash
docker-compose up -d
```

**Opção C: PM2**

```bash
npm run build:orchestrator

pm2 start dist/orchestrator/index.js --name api-gpu-orchestrator
pm2 save
pm2 startup
```

---

## Troubleshooting

### Worker não inicia

**Verificar logs:**
```bash
# RunPod Console → Serverless → Logs
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.ai/v2/<endpoint-id>/status/<job-id>
```

**Problemas comuns:**
- Docker image não encontrada → Verificar push no Docker Hub
- S3 credentials inválidas → Verificar env vars no template
- Timeout → Aumentar `RUNPOD_MAX_TIMEOUT`

---

### S3 Upload Failed

**Testar conexão:**
```bash
# AWS CLI
aws s3 ls s3://your-bucket --endpoint-url https://your-minio.com

# Python
python3 << EOF
import boto3
s3 = boto3.client('s3',
    endpoint_url='https://your-minio.com',
    aws_access_key_id='your-key',
    aws_secret_access_key='your-secret'
)
print(s3.list_buckets())
EOF
```

**Problemas comuns:**
- Bucket não existe → Criar via console S3/MinIO
- Credentials inválidas → Verificar `S3_ACCESS_KEY` e `S3_SECRET_KEY`
- Network error → Verificar `S3_ENDPOINT_URL` e firewall

---

### Orchestrator não envia jobs

**Debug:**
```bash
# Logs
pm2 logs api-gpu-orchestrator
# ou
docker logs -f container-name

# Testar RunPod API
curl -X POST https://api.runpod.ai/v2/<endpoint-id>/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"operation": "test"}}'
```

---

### Timeout

**Aumentar timeouts:**
```bash
# .env
RUNPOD_MAX_TIMEOUT=600

# RunPod Console → Endpoint Settings
Execution Timeout: 600
```

---

### Out of Memory (OOM)

**Reduzir BATCH_SIZE:**
```bash
# Template env vars
BATCH_SIZE=3  # ao invés de 5
```

**Recomendações por GPU:**
- RTX A5000 (24GB): BATCH_SIZE=8
- RTX A4500 (20GB): BATCH_SIZE=5
- RTX 3080 (10GB): BATCH_SIZE=3

---

### Performance Tuning

**Multi-worker threshold:**
```typescript
// src/orchestrator/services/runpodService.ts:77
if (operation === 'img2vid' && data.images && data.images.length > 50)
```

Ajuste o threshold (50) conforme necessário.

**Max workers paralelos:**
```typescript
// src/orchestrator/services/runpodService.ts:447
const MAX_WORKERS = 3;
```

Ajuste conforme limite do endpoint RunPod.

---

## Referências

- [RunPod Serverless Documentation](https://docs.runpod.io/serverless/overview)
- [FFmpeg NVENC Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/ffmpeg-with-nvidia-gpu/)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [Boto3 S3 Reference](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/s3.html)
