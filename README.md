# API GPU - Serverless Video Processing

Sistema de processamento de vídeo com GPU serverless usando RunPod + FFmpeg NVENC + S3 Storage.

Arquitetura híbrida que combina VPS orchestrator (Node.js/TypeScript) + RunPod Serverless GPU Workers (Python) para processar vídeos com aceleração por hardware, armazenando resultados diretamente em S3/MinIO.

---

## 📚 Documentação

- **[API Reference](docs/API_REFERENCE.md)** - Documentação completa de todos endpoints com exemplos
- **[Deployment Guide](docs/DEPLOYMENT.md)** - Guia completo de deploy em produção
- **[Transcription](docs/TRANSCRIPTION.md)** - Detalhes do endpoint de transcrição de áudio

---

## 🚀 Features

- **Transcrição de Áudio** - Faster Whisper GPU com legendas SRT/ASS karaoke
- **Legendas Estilizadas** - ASS unificado com customização completa (segments + karaoke)
- **Imagem para Vídeo** - Conversão com Ken Burns effect
- **Adicionar Áudio** - Substituição de trilha sonora
- **S3/MinIO** - Upload automático com URLs públicas
- **Auto-scaling** - Workers serverless no RunPod (0-N workers)
- **Zero Idle Cost** - Pague apenas pelo tempo de execução

---

## 📑 Endpoints

### GPU-Accelerated Endpoints

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/gpu/audio/transcribe` | POST | Transcrição com Whisper → SRT/ASS/JSON |
| `/gpu/video/caption_style` | POST | Legendas estilizadas unificadas (type: segments\|highlight) |
| `/gpu/video/img2vid` | POST | Imagem para vídeo com Ken Burns |
| `/gpu/video/addaudio` | POST | Adicionar/substituir áudio |
| `/gpu/video/concatenate` | POST | Concatenar múltiplos vídeos |

### Management & Health

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Orchestrator health + queue stats |
| `/gpu/audio/transcribe/health` | GET | Transcription service health |
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
                       │ HTTP POST /video/*
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR (VPS)                         │
│   • Express.js REST API                                     │
│   • Request validation (Joi)                                │
│   • RunPod job submission                                   │
│   • Job polling (exponential backoff)                       │
│   • Returns S3 URLs                                         │
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
│                 PYTHON WORKER                               │
│   • Download media (HTTP/S3)                                │
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
```

Ver [Deployment Guide](docs/DEPLOYMENT.md) para configuração completa.

### 3. Build & Run

```bash
# Build
npm run build:orchestrator

# Run
npm run start:orchestrator

# Output esperado:
# 🚀 RunPodService initialized
# 🌐 Server running on port 3000
```

---

## 💡 Exemplos de Uso

### Transcrição de Áudio

```bash
curl -X POST https://your-api.com/gpu/audio/transcribe \
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

### Legendas Estilizadas (Segments Mode)

```bash
curl -X POST https://your-api.com/gpu/video/caption_style \
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

---

### Legendas Karaoke (Highlight Mode)

```bash
curl -X POST https://your-api.com/gpu/video/caption_style \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-webhook.com/callback",
    "id_roteiro": 124,
    "url_video": "https://example.com/video.mp4",
    "url_caption": "https://s3.../words.json",
    "path": "Project/karaoke/",
    "output_filename": "video_karaoke.mp4",
    "type": "highlight",
    "style": {
      "highlight_texto_cor": "#FFFF00",
      "highlight_cor": "#00FF00",
      "fundo_opacidade": 70,
      "words_per_line": 3
    }
  }'
```

---

### Imagem para Vídeo

```bash
curl -X POST https://your-api.com/gpu/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://your-webhook.com/callback",
    "id_roteiro": 125,
    "images": [
      {"id": "img-1", "image_url": "https://example.com/photo1.jpg", "duracao": 6.48},
      {"id": "img-2", "image_url": "https://example.com/photo2.jpg", "duracao": 5.0}
    ],
    "path": "Project/videos/temp/"
  }'
```

---

## 🔧 Stack Tecnológica

**Orchestrator (VPS):**
- Node.js 20+ / TypeScript 5.9
- Express.js (REST API)
- Joi (validation)
- RunPod API Client

**Worker (RunPod Serverless):**
- Python 3.11
- FFmpeg com NVENC
- boto3 (S3 upload)
- RunPod SDK

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
│   │   │   ├── transcribe.routes.ts       # Transcription endpoint
│   │   │   └── videoProxy.routes.ts       # Video endpoints
│   │   └── services/
│   │       └── runpodService.ts   # RunPod client
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
docker build -f docker/worker-python.Dockerfile -t your-dockerhub-user/api-gpu-worker:latest .
docker push your-dockerhub-user/api-gpu-worker:latest
```

**2. Create Template & Endpoint:**

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
curl https://your-api.com/gpu/audio/transcribe/health

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

### Timeout Errors
- Aumentar `POLLING_MAX_ATTEMPTS` em `.env`
- Aumentar `EXPRESS_TIMEOUT_MS` em `.env`
- Ajustar Execution Timeout no RunPod Console

Ver [Deployment Guide - Troubleshooting](docs/DEPLOYMENT.md#troubleshooting) para mais detalhes.

---

## 📊 Performance

**Transcription (model large-v3):**
- 1 min audio: ~5-10s
- 10 min audio: ~30-60s
- 60 min audio: ~3-5 min

**Video Processing:**
- Caption (10s video): ~6-8s
- Img2Vid (1 image): ~3-5s
- AddAudio (10s video): ~4-6s

**Cold start:** +10-15 segundos (worker inativo)

---

## 📝 License

MIT

---

## 🔗 Referências

- [RunPod Serverless Docs](https://docs.runpod.io/serverless/overview)
- [FFmpeg NVENC Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/ffmpeg-with-nvidia-gpu/)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [API Reference](docs/API_REFERENCE.md)
- [Deployment Guide](docs/DEPLOYMENT.md)
