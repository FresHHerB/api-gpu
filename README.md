# API GPU - Serverless Video Processing

Sistema de processamento de vídeo serverless usando RunPod + FFmpeg + S3 Storage.

Arquitetura híbrida que combina VPS orchestrator (Node.js/TypeScript) + RunPod Serverless Workers (Python) para processar vídeos com otimizações específicas por operação, armazenando resultados diretamente em S3/MinIO.

---

## 📚 Documentação

- **[API Reference](docs/API_REFERENCE.md)** - Documentação completa de todos endpoints com exemplos
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Guia completo de deploy em produção
- **[Transcription](docs/TRANSCRIPTION.md)** - Detalhes do endpoint de transcrição de áudio

---

## 🚀 Features

- **Transcrição de Áudio** - Faster Whisper GPU com legendas SRT/ASS karaoke
- **Legendas Estilizadas** - ASS unificado com customização completa (segments + karaoke)
- **Imagem para Vídeo** - Conversão com Ken Burns effect (CPU-optimized)
- **Adicionar Áudio** - Substituição de trilha sonora
- **Concatenar Vídeos** - Junção de múltiplos vídeos
- **S3/MinIO** - Upload automático com URLs públicas
- **Auto-scaling** - Workers serverless no RunPod (0-N workers)
- **Zero Idle Cost** - Pague apenas pelo tempo de execução
- **Webhook Notifications** - Notificações automáticas ao concluir processamento

---

## 📑 Endpoints

### RunPod Endpoints (Async + Webhooks)

| Endpoint | Método | Descrição | Aceleração |
|----------|--------|-----------|------------|
| `/runpod/audio/transcribe` | POST | Transcrição com Whisper → SRT/ASS/JSON | GPU |
| `/runpod/video/caption_style` | POST | Legendas estilizadas unificadas (type: segments\|highlight) | GPU/CPU |
| `/runpod/video/img2vid` | POST | Imagem para vídeo com Ken Burns | **CPU-only** |
| `/runpod/video/addaudio` | POST | Adicionar/substituir áudio | GPU/CPU |
| `/runpod/video/concatenate` | POST | Concatenar múltiplos vídeos | GPU/CPU |

### VPS Endpoints (Local CPU Fallback)

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/vps/video/img2vid` | POST | Imagem para vídeo (VPS CPU) |
| `/vps/video/addaudio` | POST | Adicionar áudio (VPS CPU) |
| `/vps/video/concatenate` | POST | Concatenar vídeos (VPS CPU) |
| `/vps/video/caption_style` | POST | Legendas estilizadas (VPS CPU) |

### Management & Health

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Orchestrator health + queue stats |
| `/runpod/audio/transcribe/health` | GET | Transcription service health |
| `/jobs/:jobId` | GET | Consultar status de job |
| `/jobs/:jobId/cancel` | POST | Cancelar job em execução |
| `/queue/stats` | GET | Estatísticas da fila |

📘 **[Ver documentação completa](docs/API_REFERENCE.md)** | **[Guia de Deploy](docs/DEPLOYMENT.md)**

---

## 🏗️ Arquitetura

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENTE                                │
│   (Aplicação, API Consumer, Automation)                    │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP POST /runpod/* ou /vps/*
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR (VPS)                         │
│   • Express.js REST API                                     │
│   • Request validation (Joi)                                │
│   • Job Queue System (Memory/Redis)                         │
│   • RunPod job submission                                   │
│   • Webhook notifications                                   │
│   • Local VPS worker (CPU fallback)                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ RunPod API (HTTPS)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               RUNPOD SERVERLESS                             │
│   • Auto-scaling: 0-3 workers                               │
│   • GPU: AMPERE_16/24, RTX A4000                            │
│   • Idle timeout: 5min                                      │
│   • Execution timeout: 40min                                │
└──────────────────────┬──────────────────────────────────────┘
                       │ Job execution
                       ▼
┌─────────────────────────────────────────────────────────────┐
│            PYTHON WORKER (CPU-Optimized)                    │
│   • Download media (HTTP/S3)                                │
│   • FFmpeg processing:                                      │
│     - img2vid: libx264 veryfast (CPU-only)                  │
│     - caption/audio: GPU NVENC (if available)               │
│   • Dynamic BATCH_SIZE (1.5x CPU cores)                     │
│   • RAM cache detection (/dev/shm)                          │
│   • S3 upload (boto3)                                       │
│   • Return public URLs or base64                            │
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

---

## ⚡ Quick Start

### 1. Instalação

```bash
git clone https://github.com/your-username/api-gpu.git
cd api-gpu
npm install
```

### 2. Configuração

```bash
cp .env.example .env
nano .env
```

**Variáveis essenciais:**
```bash
# Server
PORT=3000
X_API_KEY=your-secure-api-key

# RunPod
RUNPOD_API_KEY=rpa_your_key_here
RUNPOD_ENDPOINT_ID=your_video_endpoint_id
RUNPOD_WHISPER_ENDPOINT_ID=your_whisper_endpoint_id

# S3/MinIO
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais

# Queue System (optional: MEMORY or REDIS)
QUEUE_STORAGE=MEMORY
# REDIS_URL=redis://localhost:6379

# VPS Local Worker (optional)
VPS_MAX_CONCURRENT_JOBS=2
```

Ver [Deployment Guide](docs/DEPLOYMENT.md) para configuração completa.

### 3. Build & Run

```bash
# Build
npm run build:orchestrator

# Run
npm run start:orchestrator

# Output esperado:
# 🚀 Queue System started successfully
# ✅ Local Worker Service started successfully
# 🌐 Server running on port 3000
```

---

## 💡 Exemplos de Uso

### Transcrição de Áudio (Síncrono)

```bash
curl -X POST https://your-api.com/runpod/audio/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "audio_url": "https://example.com/audio.mp3",
    "path": "Project/Episode01/transcriptions/",
    "model": "large-v3"
  }'
```

**Response:**
```json
{
  "code": 200,
  "files": {
    "segments": {
      "srt": "https://s3.../segments.srt"
    },
    "words": {
      "ass_karaoke": "https://s3.../karaoke.ass",
      "json": "https://s3.../words.json"
    }
  }
}
```

---

### Legendas Estilizadas (Segments Mode - Assíncrono)

```bash
curl -X POST https://your-api.com/runpod/video/caption_style \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-webhook.com/callback",
    "id_roteiro": 123,
    "url_video": "https://example.com/video.mp4",
    "url_caption": "https://s3.../subtitles.srt",
    "path": "Project/final/",
    "output_filename": "video_styled.mp4",
    "type": "segments",
    "style": {
      "font": {"name": "Roboto", "size": 48, "bold": true},
      "colors": {"primary": "#FFFF00", "outline": "#FF0000"},
      "position": {"alignment": "bottom_center"}
    }
  }'
```

**Response imediata (202):**
```json
{
  "jobId": "uuid-here",
  "status": "QUEUED",
  "operation": "caption_segments",
  "createdAt": "2025-01-15T10:30:00Z"
}
```

**Webhook callback (ao concluir):**
```json
{
  "jobId": "uuid-here",
  "status": "COMPLETED",
  "result": {
    "video_url": "https://s3.../video_styled.mp4",
    "filename": "video_styled.mp4",
    "s3_key": "Project/final/video_styled.mp4"
  },
  "id_roteiro": 123
}
```

---

### Imagem para Vídeo (Assíncrono - CPU-Optimized)

```bash
curl -X POST https://your-api.com/runpod/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-webhook.com/callback",
    "id_roteiro": 125,
    "images": [
      {"id": "img-1", "image_url": "https://example.com/photo1.jpg", "duracao": 6.48},
      {"id": "img-2", "image_url": "https://example.com/photo2.jpg", "duracao": 5.0}
    ],
    "path": "Project/videos/temp/",
    "zoom_types": ["zoomin", "zoomout", "zoompanright"]
  }'
```

**Response:**
```json
{
  "jobId": "uuid-here",
  "status": "QUEUED",
  "operation": "img2vid",
  "workersReserved": 2
}
```

---

## 🔧 Stack Tecnológica

**Orchestrator (VPS):**
- Node.js 20+ / TypeScript 5.9
- Express.js (REST API)
- Joi (validation)
- RunPod API Client
- Job Queue System (Memory/Redis)
- Webhook Service

**Worker (RunPod Serverless):**
- Python 3.11
- FFmpeg (CPU-optimized for img2vid, GPU for others)
- boto3 (S3 upload)
- RunPod SDK
- psutil (CPU detection)
- Dynamic resource optimization

**Storage:**
- S3/MinIO (object storage)

---

## 📦 Estrutura do Projeto

```
api-gpu/
├── src/
│   ├── orchestrator/              # VPS (Node.js/TypeScript)
│   │   ├── index.ts               # Express server
│   │   ├── routes/
│   │   │   ├── caption-unified.routes.ts  # Unified caption endpoint
│   │   │   ├── transcription.ts           # Transcription endpoint
│   │   │   ├── videoProxy.ts              # RunPod video endpoints
│   │   │   ├── vpsVideo.routes.ts         # VPS local endpoints
│   │   │   └── jobs.routes.ts             # Job management
│   │   ├── services/
│   │   │   ├── runpodService.ts           # RunPod client
│   │   │   └── localWorkerService.ts      # VPS local worker
│   │   ├── queue/
│   │   │   ├── jobService.ts              # Job queue management
│   │   │   ├── webhookService.ts          # Webhook delivery
│   │   │   ├── memoryJobStorage.ts        # In-memory storage
│   │   │   └── redisJobStorage.ts         # Redis storage
│   │   └── utils/
│   │       └── queueFactory.ts            # Queue system factory
│   │
│   ├── worker-python/             # RunPod Worker (Python)
│   │   ├── rp_handler.py          # Handler + FFmpeg + S3
│   │   ├── caption_generator.py   # ASS subtitle generator
│   │   └── requirements.txt       # Dependencies
│   │
│   └── shared/                    # Shared (TypeScript)
│       ├── types/index.ts         # Type definitions
│       └── utils/logger.ts        # Logger
│
├── docs/                          # Documentation
│   ├── API_REFERENCE.md           # Complete API docs
│   ├── DEPLOYMENT.md              # Deployment guide
│   └── TRANSCRIPTION.md           # Transcription details
│
├── docker/
│   └── worker-python.Dockerfile   # Worker image
│
├── Dockerfile                     # Orchestrator image
├── package.json
├── tsconfig.json
└── .env
```

---

## 🚀 Deploy

### Worker (RunPod Serverless)

**1. Build & Push Docker Image:**
```bash
docker login
docker build -f docker/worker-python.Dockerfile -t your-dockerhub-user/api-gpu-worker:3.0.0-cpu .
docker push your-dockerhub-user/api-gpu-worker:3.0.0-cpu
```

**2. Create Template & Endpoint:**

Via RunPod GraphQL API:
```bash
# Create Template
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveTemplate(input: {
      name: \"api-gpu-worker-v3.0.0-cpu\",
      imageName: \"your-dockerhub-user/api-gpu-worker:3.0.0-cpu\",
      dockerArgs: \"python -u rp_handler.py\",
      containerDiskInGb: 10,
      volumeInGb: 0,
      isServerless: true,
      env: [{key: \"HTTP_PORT\", value: \"8000\"}]
    }) { id name } }"
  }'

# Create Endpoint
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveEndpoint(input: {
      name: \"api-gpu-worker\",
      templateId: \"YOUR_TEMPLATE_ID\",
      workersMin: 0,
      workersMax: 3,
      gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\",
      scalerType: \"QUEUE_DELAY\",
      scalerValue: 3
    }) { id name } }"
  }'
```

Ver [Deployment Guide](docs/DEPLOYMENT.md) para instruções detalhadas.

---

### Orchestrator (VPS)

**Opção A: Easypanel**
- App Type: Git
- Repository: https://github.com/your-username/api-gpu.git
- Dockerfile: ./Dockerfile
- Port: 3000

**Opção B: Docker Compose**
```bash
docker-compose up -d
```

**Opção C: PM2**
```bash
npm run build:orchestrator
pm2 start dist/orchestrator/index.js --name api-gpu-orchestrator
```

Ver [Deployment Guide](docs/DEPLOYMENT.md) para detalhes completos.

---

## 🔍 Health Monitoring

```bash
# Orchestrator + Queue Stats
curl https://your-api.com/health

# Transcription Service
curl https://your-api.com/runpod/audio/transcribe/health

# Job Status
curl https://your-api.com/jobs/{jobId} \
  -H "X-API-Key: your-api-key"

# Queue Statistics
curl https://your-api.com/queue/stats \
  -H "X-API-Key: your-api-key"
```

---

## 🛠️ Troubleshooting

### Worker não inicia
- Verificar Docker image no Docker Hub
- Verificar S3 credentials no template
- Verificar logs no RunPod Console

### S3 Upload Failed
- Testar conexão: `aws s3 ls s3://bucket --endpoint-url https://minio.com`
- Verificar credentials: `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- Verificar endpoint URL e firewall

### Webhook não recebido
- Verificar URL está acessível publicamente
- Verificar firewall não bloqueia IPs do orchestrator
- Verificar logs em `/jobs/:jobId` para erros de webhook

Ver [Deployment Guide - Troubleshooting](docs/DEPLOYMENT.md#troubleshooting) para mais detalhes.

---

## 📊 Performance

**Transcription (model large-v3):**
- 1 min audio: ~5-10s
- 10 min audio: ~30-60s
- 60 min audio: ~3-5 min

**Video Processing (RunPod):**
- Caption (10s video): ~6-8s
- Img2Vid (1 image, 3s): ~7s (CPU-optimized)
- AddAudio (10s video): ~4-6s
- Concatenate (2 videos): ~8-10s

**Cold start:** +10-15 segundos (worker inativo)

**Otimizações:**
- img2vid: libx264 veryfast (2x mais rápido que NVENC para vídeos curtos)
- Dynamic BATCH_SIZE: 1.5x CPU cores
- RAM cache: /dev/shm quando disponível (10-50x faster I/O)

---

## 📝 License

MIT

---

## 🔗 Referências

- [RunPod Serverless Docs](https://docs.runpod.io/serverless/overview)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [API Reference](docs/API_REFERENCE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
