# 🎬 API GPU - Serverless Video Processing

**Processamento de vídeo com GPU em escala usando RunPod Serverless + FFmpeg NVENC**

Arquitetura híbrida que combina VPS (orchestrator) + GPU on-demand (RunPod serverless workers) para processar vídeos com aceleração por hardware a custo otimizado.

---

## 📋 Índice

- [🎯 Visão Geral](#-visão-geral)
- [🏗️ Arquitetura](#️-arquitetura)
- [✨ Funcionalidades](#-funcionalidades)
- [🚀 Início Rápido](#-início-rápido)
- [📡 API Reference](#-api-reference)
- [🐳 Deploy](#-deploy)
- [⚙️ Configuração](#️-configuração)
- [💻 Desenvolvimento](#-desenvolvimento)
- [💰 Custos](#-custos)
- [🔒 Segurança](#-segurança)

---

## 🎯 Visão Geral

Este projeto fornece uma API REST para processamento de vídeo com GPU, utilizando **RunPod Serverless** para executar workers FFmpeg com aceleração NVENC apenas quando necessário.

### Por que RunPod Serverless?

- ✅ **Zero custo em idle**: Pague apenas pelo tempo de execução
- ✅ **Auto-scaling**: De 0 a N workers automaticamente
- ✅ **GPU NVIDIA**: RTX 3080/4090 com NVENC para encoding rápido
- ✅ **Flashboot**: Workers iniciam em ~10s (vs 60s+ em VMs tradicionais)
- ✅ **Sem gerenciamento**: Não precisa criar/destruir instâncias manualmente

### Arquitetura em 2 Camadas

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE                              │
│  (Sua aplicação, Postman, cURL, etc.)                  │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP POST
                     ▼
┌─────────────────────────────────────────────────────────┐
│               ORCHESTRATOR (VPS)                        │
│  • Easypanel / PM2                                      │
│  • Node.js + Express                                    │
│  • Valida requisições                                   │
│  • Envia jobs para RunPod                               │
│  • Retorna resultados                                   │
└────────────────────┬────────────────────────────────────┘
                     │ RunPod API
                     ▼
┌─────────────────────────────────────────────────────────┐
│              RUNPOD SERVERLESS                          │
│  • Auto-scaling: 0-3 workers                            │
│  • GPU: RTX 3080/4090                                   │
│  • Timeout: 10 minutos                                  │
│  • Idle timeout: 5 minutos                              │
└────────────────────┬────────────────────────────────────┘
                     │ Job assigned
                     ▼
┌─────────────────────────────────────────────────────────┐
│                WORKER (Docker)                          │
│  • Base: nvidia/cuda:12.1.0                             │
│  • FFmpeg + NVENC (h264_nvenc)                          │
│  • Node.js 20                                           │
│  • Processa vídeos em batch paralelo                    │
│  • Retorna URLs dos vídeos processados                  │
└─────────────────────────────────────────────────────────┘
```

---

## 🏗️ Arquitetura

### Estrutura do Projeto (Monorepo)

```
api-gpu/
├── src/
│   ├── orchestrator/              # Roda na VPS (sempre ativo)
│   │   ├── index.ts               # Entry point Express
│   │   ├── routes/
│   │   │   └── videoProxy.ts      # Endpoints REST
│   │   └── services/
│   │       └── runpodService.ts   # RunPod API client
│   │
│   ├── worker/                    # Roda no RunPod (on-demand)
│   │   ├── index.ts               # Entry point HTTP server
│   │   └── services/
│   │       └── ffmpegService.ts   # FFmpeg + GPU processing
│   │
│   └── shared/                    # Código compartilhado
│       ├── types/
│       │   └── index.ts           # TypeScript interfaces
│       └── utils/
│           └── logger.ts          # Winston logger
│
├── docker/
│   └── worker.Dockerfile          # Worker image (RunPod)
│
├── Dockerfile                     # Orchestrator (VPS/Easypanel)
├── package.json
├── tsconfig.json
├── tsconfig.orchestrator.json
└── .env.example
```

### Fluxo de Processamento

**1. Cliente envia requisição:**
```bash
POST /video/img2vid
{
  "images": [
    { "id": "1", "image_url": "https://...", "duracao": 6.5 }
  ]
}
```

**2. Orchestrator:**
- Valida API key
- Envia job para RunPod endpoint
- RunPod cria worker (se necessário) ou reutiliza existente
- Aguarda conclusão do job

**3. Worker (RunPod Serverless):**
- Recebe array de imagens
- Processa em batches paralelos (3 imagens simultâneas)
- FFmpeg com NVENC GPU encoding (24fps fixo)
- Retorna array de vídeos com mesmos IDs

**4. Orchestrator:**
- Recebe resultado do RunPod
- Retorna ao cliente
- Worker entra em idle (5min timeout)

---

## ✨ Funcionalidades

### 🎬 Caption (Legendas)
Adiciona legendas SRT a vídeos com GPU encoding

**Exemplo:**
```bash
curl -X POST http://your-server/video/caption \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://example.com/subtitles.srt"
  }'
```

**Response:**
```json
{
  "code": 200,
  "message": "Video caption added successfully",
  "video_url": "/tmp/output/job_xxx_captioned.mp4",
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:01:30.000Z",
    "durationMs": 90000,
    "durationSeconds": 90
  },
  "stats": {
    "jobId": "runpod-job-xyz",
    "delayTime": 500,
    "executionTime": 89500
  }
}
```

---

### 🖼️ Img2Vid (Imagem para Vídeo em Batch)

**Converte múltiplas imagens em vídeos com efeito Ken Burns (zoom) em paralelo**

**Características:**
- ✅ **Batch processing**: Processa múltiplas imagens de uma vez
- ✅ **Paralelo**: 3 imagens simultâneas (configurável)
- ✅ **Framerate fixo**: 24fps
- ✅ **Ken Burns effect**: Zoom de 32.4%
- ✅ **GPU encoding**: h264_nvenc para performance

**Exemplo:**
```bash
curl -X POST http://your-server/video/img2vid \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "id": "img-1",
        "image_url": "https://example.com/image1.jpg",
        "duracao": 6.48
      },
      {
        "id": "img-2",
        "image_url": "https://example.com/image2.jpg",
        "duracao": 5.0
      },
      {
        "id": "img-3",
        "image_url": "https://example.com/image3.jpg",
        "duracao": 8.22
      }
    ]
  }'
```

**Response:**
```json
{
  "code": 200,
  "message": "Images converted to videos successfully",
  "videos": [
    {
      "id": "img-1",
      "video_url": "/tmp/output/job_xxx_video.mp4"
    },
    {
      "id": "img-2",
      "video_url": "/tmp/output/job_yyy_video.mp4"
    },
    {
      "id": "img-3",
      "video_url": "/tmp/output/job_zzz_video.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:02:15.000Z",
    "durationMs": 135000,
    "durationSeconds": 135
  },
  "stats": {
    "jobId": "runpod-job-abc",
    "total": 3,
    "processed": 3
  }
}
```

**Detalhes Técnicos:**
- **Upscale**: 6720x3840 (6x) para qualidade do zoom
- **Zoompan**: Fórmula `min(1+0.324*on/totalFrames, 1.324)`
- **Output**: 1920x1080 @ 24fps
- **Codec**: h264_nvenc (GPU)
- **Preset**: p4 (balanced)
- **Quality**: CQ 23 (VBR)

---

### 🎵 AddAudio (Adicionar Áudio)

Adiciona ou substitui áudio em vídeo, cortando para a duração mais curta

**Exemplo:**
```bash
curl -X POST http://your-server/video/addaudio \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_audio": "https://example.com/audio.mp3"
  }'
```

**Response:**
```json
{
  "code": 200,
  "message": "Video addaudio completed successfully",
  "video_url": "/tmp/output/job_xxx_with_audio.mp4",
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:01:00.000Z",
    "durationMs": 60000,
    "durationSeconds": 60
  },
  "stats": {
    "jobId": "runpod-job-def"
  }
}
```

---

## 🚀 Início Rápido

### 1. Clone o Repositório

```bash
git clone https://github.com/FresHHerB/api-gpu.git
cd api-gpu
```

### 2. Instale Dependências

```bash
npm install
```

### 3. Configure Variáveis de Ambiente

```bash
cp .env.example .env
nano .env
```

**Configuração mínima (.env):**
```bash
# RunPod Configuration
RUNPOD_API_KEY=your-runpod-api-key-here
RUNPOD_ENDPOINT_ID=your-endpoint-id-here
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=600

# Orchestrator Configuration
PORT=3000
NODE_ENV=production
X_API_KEY=your-secure-api-key-here

# Logging
LOG_LEVEL=info
LOGS_DIR=./logs

# CORS
CORS_ALLOW_ORIGINS=*
```

### 4. Build e Run Local (Desenvolvimento)

```bash
# Build orchestrator
npm run build:orchestrator

# Run orchestrator
npm run start:orchestrator
```

**Output esperado:**
```
🚀 Orchestrator started {
  "port": 3000,
  "env": "development",
  "pid": 12345
}
📡 Endpoints: http://0.0.0.0:3000
```

### 5. Teste a API

```bash
# Health check
curl http://localhost:3000/health

# Testar img2vid
curl -X POST http://localhost:3000/video/img2vid \
  -H "X-API-Key: your-secure-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "id": "test-1",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 5.0
      }
    ]
  }'
```

---

## 📡 API Reference

### Base URL
```
Production: https://your-domain.com
Development: http://localhost:3000
```

### Autenticação
Todas as requisições (exceto `/health`) requerem header:
```
X-API-Key: your-api-key
```

### Endpoints

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/health` | Health check (sem auth) |
| GET | `/` | Info da API |
| POST | `/video/caption` | Adicionar legendas SRT |
| POST | `/video/img2vid` | Converter imagens em vídeos (batch) |
| POST | `/video/addaudio` | Adicionar/substituir áudio |
| GET | `/runpod/health` | Status do RunPod endpoint |
| GET | `/runpod/config` | Configuração do RunPod |
| GET | `/job/:jobId` | Status de um job específico |
| POST | `/job/:jobId/cancel` | Cancelar job em execução |

---

## 📥 Request/Response Bodies Detalhados

### 1️⃣ POST /video/caption

**Adiciona legendas SRT a um vídeo**

**Request Body:**
```json
{
  "url_video": "https://example.com/myvideo.mp4",
  "url_srt": "https://example.com/subtitles.srt"
}
```

**Campos:**
- `url_video` (string, obrigatório): URL pública do vídeo MP4
- `url_srt` (string, obrigatório): URL pública do arquivo SRT

**Response Body (Sucesso - 200):**
```json
{
  "code": 200,
  "message": "Video caption added successfully",
  "video_url": "/tmp/output/job_1234567890_abc123_captioned.mp4",
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:01:30.000Z",
    "durationMs": 90000,
    "durationSeconds": 90
  },
  "stats": {
    "jobId": "runpod-abc123xyz",
    "delayTime": 500,
    "executionTime": 89500
  }
}
```

**Response Body (Erro - 400):**
```json
{
  "error": "Bad Request",
  "message": "url_video and url_srt are required"
}
```

**Response Body (Erro - 500):**
```json
{
  "error": "Processing failed",
  "message": "FFmpeg exited with code 1"
}
```

**Exemplo cURL:**
```bash
curl -X POST https://your-server.com/video/caption \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://example.com/subtitles.srt"
  }'
```

---

### 2️⃣ POST /video/img2vid

**Converte múltiplas imagens em vídeos com efeito Ken Burns (batch processing)**

**Request Body:**
```json
{
  "images": [
    {
      "id": "image-001",
      "image_url": "https://example.com/photo1.jpg",
      "duracao": 6.48
    },
    {
      "id": "image-002",
      "image_url": "https://example.com/photo2.jpg",
      "duracao": 5.0
    },
    {
      "id": "image-003",
      "image_url": "https://example.com/photo3.jpg",
      "duracao": 8.22
    }
  ]
}
```

**Campos:**
- `images` (array, obrigatório): Lista de imagens para processar
  - `id` (string, obrigatório): Identificador único da imagem (retornado no response)
  - `image_url` (string, obrigatório): URL pública da imagem (JPG/PNG)
  - `duracao` (number, obrigatório): Duração do vídeo em segundos (ex: 5.0, 6.48)

**Notas:**
- Framerate fixo: 24fps (não configurável)
- Processamento paralelo: 3 imagens simultâneas (configurável via `BATCH_SIZE`)
- Formato de saída: MP4 1920x1080 @ 24fps
- Codec: h264_nvenc (GPU accelerated)

**Response Body (Sucesso - 200):**
```json
{
  "code": 200,
  "message": "Images converted to videos successfully",
  "videos": [
    {
      "id": "image-001",
      "video_url": "/tmp/output/job_1234567890_abc_video.mp4"
    },
    {
      "id": "image-002",
      "video_url": "/tmp/output/job_1234567891_def_video.mp4"
    },
    {
      "id": "image-003",
      "video_url": "/tmp/output/job_1234567892_ghi_video.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:02:15.000Z",
    "durationMs": 135000,
    "durationSeconds": 135
  },
  "stats": {
    "jobId": "runpod-batch-xyz123",
    "delayTime": 1200,
    "executionTime": 133800,
    "total": 3,
    "processed": 3
  }
}
```

**Response Body (Erro - 400 - Array vazio):**
```json
{
  "error": "Bad Request",
  "message": "images array is required with at least one image"
}
```

**Response Body (Erro - 400 - Campos faltando):**
```json
{
  "error": "Bad Request",
  "message": "Each image must have id, image_url, and duracao"
}
```

**Response Body (Erro - 500):**
```json
{
  "error": "Processing failed",
  "message": "Failed to download image from URL"
}
```

**Exemplo cURL:**
```bash
curl -X POST https://your-server.com/video/img2vid \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "id": "img-1",
        "image_url": "https://picsum.photos/1920/1080?random=1",
        "duracao": 5.5
      },
      {
        "id": "img-2",
        "image_url": "https://picsum.photos/1920/1080?random=2",
        "duracao": 6.0
      }
    ]
  }'
```

**Exemplo JavaScript/Fetch:**
```javascript
const response = await fetch('https://your-server.com/video/img2vid', {
  method: 'POST',
  headers: {
    'X-API-Key': 'your-api-key-here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    images: [
      {
        id: 'scene-1',
        image_url: 'https://example.com/image1.jpg',
        duracao: 6.48
      },
      {
        id: 'scene-2',
        image_url: 'https://example.com/image2.jpg',
        duracao: 5.0
      }
    ]
  })
});

const result = await response.json();
console.log('Videos:', result.videos);
// Output: [
//   { id: 'scene-1', video_url: '/tmp/output/job_xxx_video.mp4' },
//   { id: 'scene-2', video_url: '/tmp/output/job_yyy_video.mp4' }
// ]
```

---

### 3️⃣ POST /video/addaudio

**Adiciona ou substitui áudio em um vídeo**

**Request Body:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/background-music.mp3"
}
```

**Campos:**
- `url_video` (string, obrigatório): URL pública do vídeo MP4
- `url_audio` (string, obrigatório): URL pública do arquivo de áudio (MP3/AAC/WAV)

**Notas:**
- O vídeo final terá a duração do arquivo mais curto (vídeo ou áudio)
- Áudio é re-encodado para AAC 192kbps
- Vídeo é re-encodado com h264_nvenc (GPU)

**Response Body (Sucesso - 200):**
```json
{
  "code": 200,
  "message": "Video addaudio completed successfully",
  "video_url": "/tmp/output/job_1234567890_xyz_with_audio.mp4",
  "execution": {
    "startTime": "2025-10-02T10:00:00.000Z",
    "endTime": "2025-10-02T10:01:00.000Z",
    "durationMs": 60000,
    "durationSeconds": 60
  },
  "stats": {
    "jobId": "runpod-audio-abc",
    "delayTime": 300,
    "executionTime": 59700
  }
}
```

**Response Body (Erro - 400):**
```json
{
  "error": "Bad Request",
  "message": "url_video and url_audio are required"
}
```

**Exemplo cURL:**
```bash
curl -X POST https://your-server.com/video/addaudio \
  -H "X-API-Key: your-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video-no-audio.mp4",
    "url_audio": "https://example.com/soundtrack.mp3"
  }'
```

---

### 4️⃣ GET /health

**Health check da API (sem autenticação)**

**Request:** Sem body

**Response Body (200):**
```json
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-10-02T10:00:00.000Z",
  "uptime": 86400,
  "runpod": {
    "configured": true
  }
}
```

**Exemplo cURL:**
```bash
curl https://your-server.com/health
```

---

### 5️⃣ GET /runpod/health

**Status do RunPod endpoint (requer autenticação)**

**Request:** Sem body

**Response Body (200):**
```json
{
  "status": "healthy",
  "endpoint": "RunPod Serverless",
  "timestamp": "2025-10-02T10:00:00.000Z"
}
```

**Response Body (503 - Unhealthy):**
```json
{
  "status": "unhealthy",
  "error": "RunPod endpoint not responding"
}
```

---

### 6️⃣ GET /runpod/config

**Configuração do RunPod (requer autenticação)**

**Request:** Sem body

**Response Body (200):**
```json
{
  "endpointId": "5utj4m2ukiumpp",
  "idleTimeout": 300,
  "maxTimeout": 600
}
```

---

### 7️⃣ GET /job/:jobId

**Status de um job específico no RunPod**

**Request:** Sem body

**URL Params:**
- `jobId` (string): ID do job RunPod

**Response Body (200 - In Progress):**
```json
{
  "id": "runpod-job-abc123",
  "status": "IN_PROGRESS",
  "delayTime": 1500
}
```

**Response Body (200 - Completed):**
```json
{
  "id": "runpod-job-abc123",
  "status": "COMPLETED",
  "delayTime": 1200,
  "executionTime": 45000,
  "output": {
    "video_url": "/tmp/output/job_xxx.mp4"
  }
}
```

**Response Body (404):**
```json
{
  "error": "Job not found",
  "message": "Job ID does not exist"
}
```

**Exemplo cURL:**
```bash
curl -H "X-API-Key: your-api-key-here" \
  https://your-server.com/job/runpod-job-abc123
```

---

### 8️⃣ POST /job/:jobId/cancel

**Cancela um job em execução**

**Request:** Sem body

**URL Params:**
- `jobId` (string): ID do job RunPod

**Response Body (200):**
```json
{
  "message": "Job cancelled successfully",
  "jobId": "runpod-job-abc123"
}
```

**Response Body (500):**
```json
{
  "error": "Failed to cancel job",
  "message": "Job is already completed"
}
```

**Exemplo cURL:**
```bash
curl -X POST \
  -H "X-API-Key: your-api-key-here" \
  https://your-server.com/job/runpod-job-abc123/cancel
```

---

### Tipos TypeScript

```typescript
// Caption Request
interface CaptionRequest {
  url_video: string;
  url_srt: string;
}

// Img2Vid Request (Batch)
interface Img2VidImage {
  id: string;
  image_url: string;
  duracao: number; // segundos
}

interface Img2VidRequest {
  images: Img2VidImage[];
  // framerate is fixed at 24fps
}

// AddAudio Request
interface AddAudioRequest {
  url_video: string;
  url_audio: string;
}

// Generic Video Response
interface VideoResponse {
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

// Img2Vid Response (Batch)
interface Img2VidResponse {
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
  stats: {
    jobId: string;
    total: number;
    processed: number;
  };
}
```

---

## 🐳 Deploy

### Pré-requisitos

1. **RunPod Account**: https://runpod.io
2. **Docker Hub Account**: https://hub.docker.com
3. **VPS com Docker** (Easypanel, DigitalOcean, Hetzner, etc.)

---

### Parte 1: Deploy Worker no RunPod

#### 1.1 Build e Push Worker Image

```bash
# 1. Login no Docker Hub
docker login

# 2. Build worker image
docker build -f docker/worker.Dockerfile -t your-dockerhub-user/api-gpu-worker:latest .

# 3. Push para Docker Hub
docker push your-dockerhub-user/api-gpu-worker:latest
```

#### 1.2 Criar Template no RunPod

Acesse RunPod Console → Templates → New Template

**Configuração:**
```yaml
Template Name: api-gpu-worker
Container Image: your-dockerhub-user/api-gpu-worker:latest
Docker Command: (deixe vazio, usa CMD do Dockerfile)

Container Disk: 10 GB
Expose HTTP Ports: 8080
Expose TCP Ports: (vazio)

Environment Variables:
  PORT: 8080
  NODE_ENV: production
  WORK_DIR: /tmp/work
  OUTPUT_DIR: /tmp/output
  BATCH_SIZE: 3
```

#### 1.3 Criar Endpoint no RunPod

RunPod Console → Serverless → New Endpoint

**Configuração:**
```yaml
Endpoint Name: api-gpu-endpoint
Template: api-gpu-worker (criado acima)

GPUs: RTX 3080, RTX 4090 (ou conforme budget)
Workers:
  Min: 0
  Max: 3
Idle Timeout: 300 (5 minutos)
Execution Timeout: 600 (10 minutos)
FlashBoot: Enabled
```

**Após criação, copie:**
- Endpoint ID: `xxxxxxxxx`
- Use isso no `.env` → `RUNPOD_ENDPOINT_ID`

#### 1.4 Obter RunPod API Key

RunPod Console → Settings → API Keys → Create API Key

Copie a chave e adicione em `.env`:
```
RUNPOD_API_KEY=your-runpod-api-key
```

---

### Parte 2: Deploy Orchestrator na VPS

#### Opção A: Easypanel (Recomendado)

**1. Criar Serviço:**
- App Type: Github
- Repository: `https://github.com/FresHHerB/api-gpu`
- Branch: `main`
- Build Type: Dockerfile
- Dockerfile Path: `./Dockerfile` (raiz do projeto)

**2. Configurar Environment Variables:**
```bash
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_ENDPOINT_ID=your-endpoint-id
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=600
PORT=3000
NODE_ENV=production
X_API_KEY=your-secure-client-api-key
LOG_LEVEL=info
LOGS_DIR=./logs
CORS_ALLOW_ORIGINS=*
```

**3. Deploy:**
- Port Mapping: `3000:3000`
- Click "Deploy"
- Aguarde build (~2min)

**4. Verificar:**
```bash
curl https://your-domain.com/health
```

#### Opção B: PM2 Manual

```bash
# 1. SSH na VPS
ssh root@your-vps-ip

# 2. Clone repo
cd /root
git clone https://github.com/FresHHerB/api-gpu.git
cd api-gpu

# 3. Instalar dependências
npm install

# 4. Criar .env
nano .env
# (copie as variáveis acima)

# 5. Build
npm run build:orchestrator

# 6. Instalar PM2
npm install -g pm2

# 7. Criar ecosystem.config.js
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'api-gpu-orchestrator',
    script: 'dist/orchestrator/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
}
EOF

# 8. Iniciar com PM2
mkdir -p logs
pm2 start ecosystem.config.js
pm2 save
pm2 startup

# 9. Configurar firewall
ufw allow 3000/tcp
ufw reload

# 10. Verificar
pm2 logs
curl http://localhost:3000/health
```

---

## ⚙️ Configuração

### Variáveis de Ambiente

#### Orchestrator (VPS)

| Variável | Descrição | Padrão | Obrigatório |
|----------|-----------|--------|-------------|
| `PORT` | Porta HTTP | `3000` | Não |
| `NODE_ENV` | Ambiente | `production` | Não |
| `X_API_KEY` | API key para clientes | - | Sim |
| `RUNPOD_API_KEY` | RunPod API key | - | Sim |
| `RUNPOD_ENDPOINT_ID` | RunPod endpoint ID | - | Sim |
| `RUNPOD_IDLE_TIMEOUT` | Idle timeout (s) | `300` | Não |
| `RUNPOD_MAX_TIMEOUT` | Max timeout (s) | `600` | Não |
| `LOG_LEVEL` | Log level | `info` | Não |
| `LOGS_DIR` | Diretório de logs | `./logs` | Não |
| `CORS_ALLOW_ORIGINS` | CORS origins | `*` | Não |

#### Worker (RunPod)

| Variável | Descrição | Padrão | Obrigatório |
|----------|-----------|--------|-------------|
| `PORT` | Porta HTTP | `8080` | Não |
| `NODE_ENV` | Ambiente | `production` | Não |
| `WORK_DIR` | Dir de trabalho | `/tmp/work` | Não |
| `OUTPUT_DIR` | Dir de output | `/tmp/output` | Não |
| `BATCH_SIZE` | Imagens em paralelo | `3` | Não |
| `LOG_LEVEL` | Log level | `info` | Não |

### Ajustar Batch Size

**No Template RunPod**, adicione env var:
```
BATCH_SIZE=5
```

Isso processará 5 imagens simultaneamente (consome mais VRAM).

**Recomendações:**
- RTX 3080 (10GB): `BATCH_SIZE=3`
- RTX 4090 (24GB): `BATCH_SIZE=6`

---

## 💻 Desenvolvimento

### Scripts NPM

```bash
# Build
npm run build                 # Build completo
npm run build:orchestrator    # Build apenas orchestrator
npm run build:worker          # Build apenas worker

# Dev
npm run dev:orchestrator      # Dev mode orchestrator
npm run dev:worker            # Dev mode worker

# Start (Production)
npm run start:orchestrator    # Rodar orchestrator compilado
npm run start:worker          # Rodar worker compilado

# Lint
npm run lint
```

### Estrutura de Imports

```typescript
// ✅ Correto: Shared pode ser importado por todos
import { logger } from '../../shared/utils/logger';
import { CaptionRequest } from '../../shared/types';

// ❌ Errado: Worker não pode importar Orchestrator
import { RunPodService } from '../../orchestrator/services/runpodService'; // ERROR

// ❌ Errado: Orchestrator não pode importar Worker
import { FFmpegService } from '../../worker/services/ffmpegService'; // ERROR
```

### Adicionar Novo Endpoint

**1. Definir tipo em `src/shared/types/index.ts`:**
```typescript
export interface MyNewRequest {
  param1: string;
  param2: number;
}
```

**2. Implementar no Worker `src/worker/index.ts`:**
```typescript
app.post('/video/mynew', async (req, res) => {
  const { param1, param2 } = req.body as MyNewRequest;
  // Implementação...
  res.json({ success: true });
});
```

**3. Adicionar rota no Orchestrator `src/orchestrator/routes/videoProxy.ts`:**
```typescript
router.post('/video/mynew', authenticateApiKey, async (req, res) => {
  const data: MyNewRequest = req.body;
  const result = await runpodService.processVideo('mynew', data);
  res.json(result);
});
```

**4. Rebuild e Deploy:**
```bash
# Rebuild worker
docker build -f docker/worker.Dockerfile -t user/api-gpu-worker:latest .
docker push user/api-gpu-worker:latest

# Update RunPod template

# Rebuild orchestrator
npm run build:orchestrator
pm2 restart api-gpu-orchestrator
```

---

## 💰 Custos

### RunPod Serverless Pricing

**Modelo de cobrança:** Pay-per-second (only when running)

| GPU | VRAM | Custo/min | Setup | Processar 3 imgs (batch) | Total |
|-----|------|-----------|-------|--------------------------|-------|
| RTX 3080 | 10GB | $0.01 | 10s | 45s | $0.009 |
| RTX 4090 | 24GB | $0.03 | 10s | 25s | $0.018 |

**Exemplo (RTX 3080, 100 jobs/dia):**
- Setup: 10s × 100 = 16min = $0.16
- Processing: 45s × 100 = 75min = $0.75
- **Total: $0.91/dia = $27/mês**

**Vantagens:**
- ✅ Zero custo em idle (sem jobs)
- ✅ Auto-scaling incluso
- ✅ Sem taxa de setup de VM

### VPS (Orchestrator) - Sempre Ativo

**Requisitos mínimos:**
- CPU: 1 core
- RAM: 512MB
- Storage: 10GB
- **Custo: $3-5/mês** (DigitalOcean, Hetzner, etc.)

### Custo Total Estimado

**Baixo volume (10 jobs/dia):**
- VPS: $4/mês
- RunPod: $2.70/mês
- **Total: ~$7/mês**

**Alto volume (1000 jobs/dia):**
- VPS: $4/mês
- RunPod: $270/mês
- **Total: ~$274/mês**

---

## 🔒 Segurança

### Camadas de Proteção

**1. Orchestrator (VPS):**
- ✅ API Key validation (X-API-Key header)
- ✅ CORS configurável
- ✅ Rate limiting (configurável)
- ✅ Request validation (Joi schemas)

**2. Worker (RunPod):**
- ✅ Isolamento de rede (RunPod managed)
- ✅ Ephemeral instances (destruídas após idle)
- ✅ Sem dados persistentes

**3. Comunicação:**
- ✅ HTTPS recomendado (via Easypanel/Nginx)
- ✅ RunPod API usa HTTPS

### Boas Práticas

```bash
# 1. Gerar API key forte
openssl rand -hex 32

# 2. Configurar CORS específico
CORS_ALLOW_ORIGINS=https://yourapp.com,https://admin.yourapp.com

# 3. Rate limiting
# Adicionar em src/orchestrator/index.ts:
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100 // 100 requests por IP
});

app.use('/video/', limiter);

# 4. Firewall na VPS
ufw allow 3000/tcp
ufw allow 22/tcp
ufw enable
```

---

## 🐛 Troubleshooting

### Worker não inicia no RunPod

**Verificar logs:**
```bash
# RunPod Console → Serverless → seu endpoint → Logs
# Ou via API:
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.ai/v2/<endpoint-id>/status/<job-id>
```

**Problemas comuns:**
- Docker image não encontrada → Verificar se push foi feito
- Port incorreto → Deve ser 8080
- CUDA error → Verificar se template tem GPU selecionada

### Orchestrator não envia jobs

**Debug:**
```bash
# Verificar logs
pm2 logs api-gpu-orchestrator

# Testar API RunPod manualmente
curl -X POST https://api.runpod.ai/v2/<endpoint-id>/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"operation": "test"}}'
```

### Timeout de processamento

**Aumentar timeouts:**
```bash
# .env
RUNPOD_MAX_TIMEOUT=900  # 15 minutos

# RunPod Console → Endpoint Settings
Execution Timeout: 900
```

### Erros de memória (OOM)

**Reduzir BATCH_SIZE:**
```bash
# Template RunPod env vars
BATCH_SIZE=2  # Ao invés de 3
```

---

## 📚 Recursos Adicionais

- [RunPod Docs](https://docs.runpod.io/serverless/overview)
- [FFmpeg NVENC Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/ffmpeg-with-nvidia-gpu/)
- [Easypanel Docs](https://easypanel.io/docs)

---

## 📝 Licença

MIT License - veja [LICENSE](LICENSE)

---

## 🤝 Contribuindo

Contribuições são bem-vindas!

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/NovaFeature`)
3. Commit suas mudanças (`git commit -m 'feat: Add NovaFeature'`)
4. Push para a branch (`git push origin feature/NovaFeature`)
5. Abra um Pull Request

---

## 📞 Suporte

- **Issues**: https://github.com/FresHHerB/api-gpu/issues
- **Logs**: Verifique `/logs` no orchestrator e RunPod console para workers

---

**Desenvolvido com ❤️ usando RunPod Serverless + FFmpeg NVENC**
