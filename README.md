# 🎬 API GPU - Serverless Video Processing

**Processamento de vídeo em larga escala com GPU RunPod Serverless + FFmpeg NVENC + S3 Storage**

Sistema de processamento de vídeo híbrido que combina **VPS (Orchestrator)** + **RunPod Serverless GPU Workers** para processar vídeos com aceleração por hardware a custo otimizado, armazenando resultados diretamente em S3/MinIO.

[![RunPod](https://img.shields.io/badge/RunPod-Serverless-7C3AED)](https://runpod.io)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?logo=python)](https://python.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![FFmpeg](https://img.shields.io/badge/FFmpeg-NVENC-007808)](https://ffmpeg.org)
[![S3](https://img.shields.io/badge/Storage-S3/MinIO-FF9900)](https://min.io)

---

## 📋 Índice

- [🎯 Visão Geral](#-visão-geral)
- [🏗️ Arquitetura](#️-arquitetura)
- [✨ Funcionalidades](#-funcionalidades)
- [🚀 Início Rápido](#-início-rápido)
- [📡 API Reference](#-api-reference)
- [🐳 Deploy](#-deploy)
- [💰 Custos](#-custos)
- [🔧 Configuração](#-configuração)
- [🐛 Troubleshooting](#-troubleshooting)

---

## 🎯 Visão Geral

Sistema de processamento de vídeo que utiliza **RunPod Serverless** para executar workers FFmpeg com aceleração NVENC apenas quando necessário, armazenando resultados diretamente em **S3/MinIO**.

### Por que RunPod Serverless + S3?

- ✅ **Zero custo em idle**: Pague apenas pelo tempo de execução (segundos)
- ✅ **Auto-scaling**: De 0 a N workers automaticamente baseado em demanda
- ✅ **GPU NVIDIA**: RTX A4500/A5000 com NVENC para encoding 10x mais rápido
- ✅ **Flashboot**: Workers iniciam em ~10s (vs 60s+ em VMs tradicionais)
- ✅ **S3 Direct Upload**: Vídeos salvos diretamente no bucket (sem download via VPS)
- ✅ **Sem gerenciamento**: RunPod cuida de criar/destruir workers automaticamente

### Arquitetura em 3 Camadas

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENTE                                │
│   (Sua aplicação, Postman, n8n, etc.)                      │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP POST /video/*
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  ORCHESTRATOR (VPS)                         │
│   • Easypanel / PM2 / Docker                                │
│   • Node.js + Express + TypeScript                          │
│   • Valida requisições + API Key                            │
│   • Envia jobs para RunPod Serverless                       │
│   • Retorna S3 URLs dos vídeos processados                  │
└──────────────────────┬──────────────────────────────────────┘
                       │ RunPod API (HTTPS)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               RUNPOD SERVERLESS                             │
│   • Auto-scaling: 0-3 workers (configurável)                │
│   • GPUs: RTX A4500 (24GB), RTX A5000 (24GB)                │
│   • Idle timeout: 5 minutos                                 │
│   • Max timeout: 8 minutos                                  │
│   • FlashBoot: ~10s cold start                              │
└──────────────────────┬──────────────────────────────────────┘
                       │ Job assigned to worker
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                 PYTHON WORKER (Docker)                      │
│   • Base: python:3.11-slim + FFmpeg                         │
│   • GPU encoding: h264_nvenc (NVIDIA Hardware)              │
│   • Batch processing: 3-5 vídeos paralelos                  │
│   • S3 Upload: boto3 → MinIO/AWS S3                         │
│   • Returns: Public S3 URLs                                 │
└──────────────────────┬──────────────────────────────────────┘
                       │ Upload MP4
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  S3/MinIO STORAGE                           │
│   • MinIO: Self-hosted S3-compatible                        │
│   • AWS S3: Produção com CloudFront CDN                     │
│   • Public URLs: https://s3.../bucket/path/video.mp4        │
│   • Auto-cleanup: Opcional via lifecycle policies           │
└─────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Arquitetura

### Estrutura do Projeto (Monorepo)

```
api-gpu/
├── src/
│   ├── orchestrator/                # Roda na VPS (sempre ativo)
│   │   ├── index.ts                 # Entry point Express
│   │   ├── routes/
│   │   │   └── videoProxy.ts        # Endpoints REST + validação
│   │   └── services/
│   │       └── runpodService.ts     # RunPod API client + polling
│   │
│   ├── worker-python/               # Roda no RunPod (on-demand)
│   │   ├── rp_handler.py            # RunPod handler + FFmpeg + S3
│   │   └── requirements.txt         # Dependencies (runpod, boto3, requests)
│   │
│   └── shared/                      # Código compartilhado (TypeScript)
│       ├── types/index.ts           # Interfaces Request/Response
│       └── utils/logger.ts          # Winston logger
│
├── docker/
│   └── worker-python.Dockerfile     # Worker image (RunPod Serverless)
│
├── Dockerfile                       # Orchestrator image (VPS/Easypanel)
├── package.json                     # Node.js dependencies
├── tsconfig.json                    # TypeScript config
├── .env                             # Environment variables
└── README.md                        # Este arquivo
```

### Fluxo de Processamento Completo

**1. Cliente envia requisição:**
```bash
POST /video/img2vid
{
  "images": [
    { "id": "img1", "image_url": "https://...", "duracao": 6.5 }
  ],
  "path": "Project Name/Video Title/videos/temp/"
}
```

**2. Orchestrator (VPS):**
- ✅ Valida API key (`X-API-Key` header)
- ✅ Valida payload (images, path, etc.)
- ✅ Envia job para RunPod endpoint via API
- ✅ RunPod cria worker (cold start ~10s) ou reutiliza existente (warm)
- ✅ Aguarda conclusão do job (polling com backoff exponencial)

**3. Worker (RunPod Serverless):**
- ✅ Recebe job via RunPod SDK
- ✅ Baixa imagens via HTTP requests
- ✅ Processa em batches paralelos (BATCH_SIZE=5)
- ✅ FFmpeg com GPU NVENC encoding (h264_nvenc preset p4)
- ✅ Upload direto para S3/MinIO usando boto3
- ✅ Retorna array de vídeos com S3 URLs públicas

**4. Orchestrator responde:**
- ✅ Recebe resultado do RunPod com S3 URLs
- ✅ Retorna ao cliente (sem fazer download)
- ✅ Worker entra em idle (5min timeout antes de destruição)

**Exemplo de Response:**
```json
{
  "code": 200,
  "message": "Images converted to videos and uploaded to S3 successfully",
  "videos": [
    {
      "id": "img1",
      "video_url": "https://minio.example.com/canais/Project/videos/temp/video_1.mp4",
      "filename": "video_1.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-03T10:00:00.000Z",
    "endTime": "2025-10-03T10:01:15.000Z",
    "durationMs": 75000,
    "durationSeconds": 75
  },
  "stats": {
    "jobId": "runpod-job-abc123",
    "total": 1,
    "processed": 1
  }
}
```

---

## ✨ Funcionalidades

### 🎬 Caption (Legendas SRT)
Adiciona legendas SRT a vídeos com GPU encoding

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://example.com/subtitles.srt",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_legendado.mp4"
}
```

**Response:**
```json
{
  "code": 200,
  "message": "Video caption completed and uploaded to S3 successfully",
  "video_url": "https://s3.../canais/Project Name/Video Title/videos/video_legendado.mp4",
  "execution": { "durationMs": 45000 },
  "stats": { "jobId": "..." }
}
```

---

### 🖼️ Img2Vid (Imagem para Vídeo - Batch)

Converte múltiplas imagens em vídeos com efeito **Ken Burns (zoom)** em paralelo

**Características:**
- ✅ **Batch processing**: Processa múltiplas imagens simultaneamente
- ✅ **Parallel execution**: 5 imagens em paralelo (configurável via `BATCH_SIZE`)
- ✅ **Ken Burns effect**: Zoom suave de 32.4% (1.0 → 1.324)
- ✅ **Fixed framerate**: 24fps (não configurável)
- ✅ **GPU encoding**: h264_nvenc preset p4 (balanced)
- ✅ **Quality**: CQ 23 VBR (Variable Bitrate)
- ✅ **S3 upload**: Resultados salvos diretamente no bucket

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

**Response:**
```json
{
  "code": 200,
  "message": "Images converted to videos and uploaded to S3 successfully",
  "videos": [
    {
      "id": "img-1",
      "video_url": "https://s3.../canais/Project Name/Video Title/videos/temp/video_1.mp4",
      "filename": "video_1.mp4"
    },
    {
      "id": "img-2",
      "video_url": "https://s3.../canais/Project Name/Video Title/videos/temp/video_2.mp4",
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
    "total": 2,
    "processed": 2
  }
}
```

**Detalhes Técnicos:**
- **Upscale**: 6720x3840 (6x resolução original) para qualidade no zoom
- **Zoompan**: Fórmula `min(1+0.324*on/totalFrames, 1.324)`
- **Output**: 1920x1080 @ 24fps
- **Codec**: h264_nvenc (GPU NVIDIA)
- **Preset**: p4 (balanced speed/quality)
- **Quality**: CQ 23 (VBR mode)

**Multi-Worker Optimization:**
- Para batches >50 imagens, o sistema automaticamente distribui em múltiplos workers
- Máximo 3 workers paralelos (configurável)
- Cada worker processa ~33% das imagens
- Resultados mesclados no final

---

### 🎵 AddAudio (Adicionar/Substituir Áudio)

Sincroniza áudio com vídeo, cortando para a duração mais curta

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/audio.mp3",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_com_audio.mp4"
}
```

**Response:**
```json
{
  "code": 200,
  "message": "Video addaudio completed and uploaded to S3 successfully",
  "video_url": "https://s3.../canais/Project Name/Video Title/videos/video_com_audio.mp4",
  "execution": { "durationMs": 30000 },
  "stats": { "jobId": "..." }
}
```

---

## 🚀 Início Rápido

### Pré-requisitos

- **Node.js** 20+ (orchestrator)
- **Python** 3.11+ (worker local testing)
- **Docker** (para build de imagens)
- **RunPod Account**: https://runpod.io
- **S3/MinIO**: Bucket configurado

### 1. Clone o Repositório

```bash
git clone https://github.com/your-username/api-gpu.git
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

**Configuração completa (.env):**
```bash
# ============================================
# ORCHESTRATOR (VPS)
# ============================================

# Server
PORT=3000
NODE_ENV=production

# API Keys
X_API_KEY=your-secure-api-key-here

# ============================================
# RunPod Serverless
# ============================================

RUNPOD_API_KEY=rpa_your_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id_here
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=480

# ============================================
# S3/MinIO Configuration (Worker Upload)
# ============================================

S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1

# ============================================
# Logging
# ============================================

LOG_LEVEL=info
LOGS_DIR=./logs

# ============================================
# CORS
# ============================================

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
🚀 RunPodService initialized {
  "endpointId": "xyz...",
  "idleTimeout": 300,
  "maxTimeout": 480
}
🌐 Server running on port 3000
```

### 5. Teste a API

```bash
# Health check
curl http://localhost:3000/health

# Testar img2vid (requer RunPod configurado)
curl -X POST http://localhost:3000/video/img2vid \
  -H "X-API-Key: your-secure-api-key-here" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "id": "test-1",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 3.0
      }
    ],
    "path": "Test Project/Test Video/videos/temp/"
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
| POST | `/video/caption` | Adicionar legendas SRT + S3 upload |
| POST | `/video/img2vid` | Converter imagens em vídeos (batch) + S3 upload |
| POST | `/video/addaudio` | Adicionar/substituir áudio + S3 upload |
| GET | `/runpod/health` | Status do RunPod endpoint |
| GET | `/runpod/config` | Configuração do RunPod |
| GET | `/job/:jobId` | Status de um job específico |
| POST | `/job/:jobId/cancel` | Cancelar job em execução |

### Request/Response Bodies Detalhados

#### POST /video/caption

**Request Body:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://example.com/subtitles.srt",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_legendado.mp4"
}
```

**Campos:**
- `url_video` (string, obrigatório): URL pública do vídeo MP4
- `url_srt` (string, obrigatório): URL pública do arquivo SRT
- `path` (string, obrigatório): Caminho S3 completo (incluindo `/videos/`)
- `output_filename` (string, obrigatório): Nome do arquivo de saída

**Response (200 OK):**
```json
{
  "code": 200,
  "message": "Video caption completed and uploaded to S3 successfully",
  "video_url": "https://minio.../canais/Project Name/Video Title/videos/video_legendado.mp4",
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

---

#### POST /video/img2vid

**Request Body:**
```json
{
  "images": [
    {
      "id": "img-1",
      "image_url": "https://example.com/photo1.jpg",
      "duracao": 6.48
    }
  ],
  "path": "Project Name/Video Title/videos/temp/"
}
```

**Campos:**
- `images` (array, obrigatório): Lista de imagens para processar
  - `id` (string, obrigatório): Identificador único (retornado no response)
  - `image_url` (string, obrigatório): URL pública da imagem (JPG/PNG)
  - `duracao` (number, obrigatório): Duração do vídeo em segundos
- `path` (string, obrigatório): Caminho S3 completo (incluindo `/videos/temp/`)

**Notas:**
- Framerate fixo: 24fps
- Filenames auto-gerados: `video_1.mp4`, `video_2.mp4`, etc.
- Bucket: Definido em `S3_BUCKET_NAME` (env var)

**Response (200 OK):**
```json
{
  "code": 200,
  "message": "Images converted to videos and uploaded to S3 successfully",
  "videos": [
    {
      "id": "img-1",
      "video_url": "https://s3.../canais/Project Name/Video Title/videos/temp/video_1.mp4",
      "filename": "video_1.mp4"
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
    "total": 1,
    "processed": 1
  }
}
```

---

#### POST /video/addaudio

**Request Body:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/audio.mp3",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_com_audio.mp4"
}
```

**Campos:**
- `url_video` (string, obrigatório): URL pública do vídeo MP4
- `url_audio` (string, obrigatório): URL pública do áudio (MP3/AAC/WAV)
- `path` (string, obrigatório): Caminho S3 completo (incluindo `/videos/`)
- `output_filename` (string, obrigatório): Nome do arquivo de saída

**Response (200 OK):**
```json
{
  "code": 200,
  "message": "Video addaudio completed and uploaded to S3 successfully",
  "video_url": "https://s3.../canais/Project Name/Video Title/videos/video_com_audio.mp4",
  "execution": {
    "durationMs": 60000
  },
  "stats": {
    "jobId": "runpod-job-def"
  }
}
```

---

### TypeScript Interfaces

```typescript
// Caption Request
interface CaptionRequest {
  url_video: string;
  url_srt: string;
  path: string; // S3 path including /videos/
  output_filename: string; // e.g., "video_legendado.mp4"
}

// Img2Vid Request
interface Img2VidImage {
  id: string;
  image_url: string;
  duracao: number; // seconds
}

interface Img2VidRequest {
  images: Img2VidImage[];
  path: string; // S3 path including /videos/temp/
}

// AddAudio Request
interface AddAudioRequest {
  url_video: string;
  url_audio: string;
  path: string; // S3 path including /videos/
  output_filename: string; // e.g., "video_com_audio.mp4"
}

// Video Response
interface VideoResponse {
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
  stats: {
    jobId: string;
    total?: number;
    processed?: number;
  };
}
```

---

## 🐳 Deploy

### Parte 1: Deploy Worker no RunPod

#### 1.1 Build e Push Worker Image

```bash
# 1. Login no Docker Hub
docker login

# 2. Build worker image
docker build -f docker/worker-python.Dockerfile \
  -t your-dockerhub-user/api-gpu-worker:latest .

# 3. Push para Docker Hub
docker push your-dockerhub-user/api-gpu-worker:latest
```

#### 1.2 Criar Template no RunPod

Acesse: **RunPod Console → Templates → New Template**

**Configuração:**
```yaml
Template Name: api-gpu-worker-production
Container Image: your-dockerhub-user/api-gpu-worker:latest
Docker Command: python -u rp_handler.py

Container Disk: 10 GB
Volume Disk: 0 GB
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

#### 1.3 Criar Endpoint no RunPod

**RunPod Console → Serverless → New Endpoint**

```yaml
Endpoint Name: api-gpu-worker
Template: api-gpu-worker-production (criado acima)

GPUs: RTX A4500, RTX A5000, AMPERE_16, AMPERE_24
Workers:
  Min: 0
  Max: 3

Idle Timeout: 300 (5 minutos)
Execution Timeout: 480 (8 minutos)
FlashBoot: Enabled
```

**Após criação, copie o Endpoint ID** e adicione em `.env`:
```
RUNPOD_ENDPOINT_ID=your_endpoint_id_here
```

#### 1.4 Obter RunPod API Key

**RunPod Console → Settings → API Keys → Create API Key**

Copie e adicione em `.env`:
```
RUNPOD_API_KEY=rpa_your_key_here
```

---

### Parte 2: Deploy Orchestrator na VPS

#### Opção A: Easypanel (Recomendado)

**1. Criar App no Easypanel:**
- App Type: **Git**
- Repository: `https://github.com/your-username/api-gpu.git`
- Branch: `main`
- Build Type: **Dockerfile**
- Dockerfile Path: `./Dockerfile`

**2. Configurar Environment Variables:**
```bash
PORT=3000
NODE_ENV=production
X_API_KEY=your-secure-api-key
RUNPOD_API_KEY=rpa_your_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=480
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
LOG_LEVEL=info
LOGS_DIR=./logs
CORS_ALLOW_ORIGINS=*
```

**3. Deploy:**
- Port Mapping: `3000:3000`
- Click **Deploy**
- Aguarde build (~2min)

**4. Verificar:**
```bash
curl https://your-domain.com/health
```

---

#### Opção B: Docker Compose

```yaml
# docker-compose.yml
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

**Deploy:**
```bash
docker-compose up -d
docker-compose logs -f
```

---

## 💰 Custos

### RunPod Serverless Pricing (Pay-per-second)

| GPU | VRAM | Custo/min | Cold Start | Processar 3 imgs (batch) | Total/job |
|-----|------|-----------|------------|--------------------------|-----------|
| RTX A4500 | 20GB | $0.015 | 10s | 25s | $0.009 |
| RTX A5000 | 24GB | $0.020 | 10s | 20s | $0.010 |
| AMPERE_16 | 16GB | $0.012 | 10s | 30s | $0.008 |

**Exemplo (RTX A4500, 100 jobs/dia):**
- Cold starts: 10s × 20 = 3.3min = $0.05
- Processing: 25s × 100 = 41.6min = $0.62
- **Total: ~$0.67/dia = $20/mês**

**Vantagens:**
- ✅ Zero custo quando não há jobs
- ✅ Auto-scaling incluso (0-3 workers)
- ✅ Sem taxa de setup

### VPS (Orchestrator) - Sempre Ativo

**Requisitos mínimos:**
- CPU: 1 vCPU
- RAM: 512MB
- Storage: 10GB
- **Custo: $3-5/mês** (Hetzner, DigitalOcean, etc.)

### S3/MinIO Storage

**MinIO Self-hosted:**
- Incluso no VPS ou servidor separado
- **Custo: $0/mês** (se usar VPS existente)

**AWS S3:**
- Storage: $0.023/GB/mês
- Transfer OUT: $0.09/GB
- Requests: $0.0004/1000 PUT
- **Custo: ~$2-10/mês** (dependendo do volume)

### Custo Total Estimado

**Baixo volume (10 jobs/dia):**
- VPS: $4/mês
- RunPod: $2/mês
- S3: $1/mês
- **Total: ~$7/mês**

**Alto volume (1000 jobs/dia):**
- VPS: $4/mês
- RunPod: $200/mês
- S3: $15/mês
- **Total: ~$219/mês**

---

## 🔧 Configuração

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
| `RUNPOD_MAX_TIMEOUT` | Max timeout (s) | `480` | Não |
| `S3_ENDPOINT_URL` | S3/MinIO endpoint | - | Sim (worker) |
| `S3_ACCESS_KEY` | S3 access key | - | Sim (worker) |
| `S3_SECRET_KEY` | S3 secret key | - | Sim (worker) |
| `S3_BUCKET_NAME` | S3 bucket name | `canais` | Sim (worker) |
| `S3_REGION` | S3 region | `us-east-1` | Não |
| `LOG_LEVEL` | Log level | `info` | Não |
| `CORS_ALLOW_ORIGINS` | CORS origins | `*` | Não |

#### Worker (RunPod Template)

| Variável | Descrição | Padrão | Obrigatório |
|----------|-----------|--------|-------------|
| `WORK_DIR` | Working directory | `/tmp/work` | Não |
| `OUTPUT_DIR` | Output directory | `/tmp/output` | Não |
| `BATCH_SIZE` | Parallel images | `5` | Não |
| `S3_ENDPOINT_URL` | S3/MinIO endpoint | - | Sim |
| `S3_ACCESS_KEY` | S3 access key | - | Sim |
| `S3_SECRET_KEY` | S3 secret key | - | Sim |
| `S3_BUCKET_NAME` | S3 bucket name | `canais` | Sim |
| `S3_REGION` | S3 region | `us-east-1` | Não |

### Ajustar Performance

**BATCH_SIZE (worker):**
```bash
# No Template RunPod env vars:
BATCH_SIZE=8  # RTX A5000 (24GB VRAM)
BATCH_SIZE=5  # RTX A4500 (20GB VRAM) - recomendado
BATCH_SIZE=3  # RTX 3080 (10GB VRAM)
```

**MAX_WORKERS (orchestrator):**
```typescript
// src/orchestrator/services/runpodService.ts:447
const MAX_WORKERS = 5; // Aumentar para processar mais imagens em paralelo
```

---

## 🐛 Troubleshooting

### Worker não inicia no RunPod

**Verificar logs:**
```bash
# RunPod Console → Serverless → Seu Endpoint → Logs
# Ou via API:
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.ai/v2/<endpoint-id>/status/<job-id>
```

**Problemas comuns:**
- ❌ Docker image não encontrada → Verificar se push foi feito para Docker Hub
- ❌ S3 credentials inválidos → Verificar env vars no template
- ❌ Timeout → Aumentar `RUNPOD_MAX_TIMEOUT`

### S3 Upload Failed

**Verificar:**
```bash
# Testar S3 connection via AWS CLI:
aws s3 ls s3://your-bucket --endpoint-url https://your-minio.com

# Ou Python:
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
- ❌ Bucket não existe → Criar bucket via console S3/MinIO
- ❌ Credentials inválidas → Verificar `S3_ACCESS_KEY` e `S3_SECRET_KEY`
- ❌ Network error → Verificar `S3_ENDPOINT_URL` e firewall

### Orchestrator não envia jobs

**Debug:**
```bash
# Logs do orchestrator:
pm2 logs api-gpu-orchestrator
# Ou Docker:
docker logs -f container-name

# Testar RunPod API diretamente:
curl -X POST https://api.runpod.ai/v2/<endpoint-id>/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"operation": "test"}}'
```

### Timeout de processamento

**Aumentar timeouts:**
```bash
# .env
RUNPOD_MAX_TIMEOUT=600  # 10 minutos

# RunPod Console → Endpoint Settings
Execution Timeout: 600
```

### Erros de memória (OOM)

**Reduzir BATCH_SIZE:**
```bash
# Template RunPod env vars:
BATCH_SIZE=3  # Ao invés de 5
```

---

## 📚 Recursos Adicionais

- [RunPod Docs](https://docs.runpod.io/serverless/overview)
- [FFmpeg NVENC Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/ffmpeg-with-nvidia-gpu/)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [Boto3 S3 Guide](https://boto3.amazonaws.com/v1/documentation/api/latest/guide/s3.html)

---

## 📝 Licença

MIT License

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

- **Issues**: https://github.com/your-username/api-gpu/issues
- **Logs**: Verifique `/logs` no orchestrator e RunPod console para workers

---

**Desenvolvido com ❤️ usando RunPod Serverless + FFmpeg NVENC + S3/MinIO**
