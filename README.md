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

Transcrição de áudio usando RunPod faster-whisper com geração automática de legendas em múltiplos formatos.

**Características:**
- **GPU-accelerated**: OpenAI Whisper models otimizados para GPU
- **Word-level timestamps**: Timing preciso por palavra para karaoke
- **Voice Activity Detection (VAD)**: Remoção automática de silêncios
- **Multi-idioma**: Suporte a 99 idiomas (detecção automática ou manual)
- **Performance**: 2-4x mais rápido que Whisper API oficial
- **Sem limite de tamanho**: Aceita áudios de qualquer duração
- **Custo**: ~90% mais barato que alternativas cloud

**Formatos de saída:**
1. **segments.srt** - Legendas tradicionais (frases/sentenças completas)
2. **karaoke.ass** - Legendas karaoke com timing palavra-por-palavra
3. **words.json** - Timestamps brutos para customização programática

**Modelos disponíveis:**
- `tiny` - Rápido, menor acurácia (~1GB VRAM)
- `base` - Balanceado (~1GB VRAM)
- `small` - Boa acurácia (~2GB VRAM)
- `medium` - Alta acurácia (~5GB VRAM)
- `large-v3` - Máxima acurácia (~10GB VRAM) **[Recomendado]**
- `turbo` - Otimizado para velocidade (~6GB VRAM)

**Worker Configuration:**
- RunPod Template: `faster-whisper-v1.0.10` (oh8mkykjy7)
- Docker Image: `runpod/ai-api-faster-whisper:1.0.10`
- Endpoint ID: `82jjrwujznxwvn`
- Workers: 0-2 (auto-scaling)
- Idle timeout: 5 min
- Execution timeout: 40 min

**Documentação completa:** Ver [TRANSCRIPTION_API.md](./TRANSCRIPTION_API.md)

---

### Caption Style (Legendas com Estilo Customizado)

Sistema de legendas com estilo totalmente customizável usando formato ASS (Advanced SubStation Alpha). Suporta dois modos de renderização:

**1. Segments Mode** - Legendas tradicionais (baseadas em SRT)
- Entrada: arquivo SRT com frases/sentenças
- Estilos customizáveis: fonte, tamanho, cores, bordas, posicionamento
- Ideal para: vídeos com legendas convencionais

**2. Highlight Mode** - Legendas karaoke (word-by-word)
- Entrada: JSON com timing palavra-por-palavra
- Sistema de 2 layers: texto base + palavra ativa destacada
- Estilos customizáveis: fonte, cores de texto/highlight, fundo, bordas
- Ideal para: vídeos educacionais, karaoke, acompanhamento de leitura

**Características:**
- **GPU Encoding**: FFmpeg + NVENC (h264_nvenc)
- **Formato ASS**: Suporte completo a estilos avançados
- **Customização total**: Cores, fontes, bordas, posicionamento, opacidade
- **Fontes incluídas**: Arial, Arial Black, Roboto, Open Sans, Noto Sans
- **Resolução**: 1920x1080 (Full HD)
- **Upload direto**: Resultados salvos automaticamente em S3/MinIO

**FFmpeg Process:**
```bash
# Segments (SRT → ASS com estilo)
-i video.mp4 -vf "ass=styled_subtitles.ass" -c:v h264_nvenc -preset p4

# Highlight (JSON → ASS 2-layer karaoke)
-i video.mp4 -vf "ass=highlight_subtitles.ass" -c:v h264_nvenc -preset p4
```

**Worker Configuration:**
- RunPod Template: `api-gpu-worker-v5` (40n7kfux2m)
- Docker Image: `oreiasccp/api-gpu-worker:latest` (opacity 0-100% + word grouping)
- Endpoint ID: `o63s0zonkzi67m`
- Workers: 0-3 (auto-scaling)
- GPUs: AMPERE_16, AMPERE_24, RTX A4000
- Idle timeout: 5 min
- Execution timeout: 40 min
- HTTP Port: 8000 (video downloads)

---

### Img2Vid (Image to Video - Batch)

Converte imagens em vídeos com efeito Ken Burns (zoom) usando GPU encoding.

**Input:**
- Array de imagens (URL + duração)
- S3 path

**Output:**
- Múltiplos vídeos (video_1.mp4, video_2.mp4, ...)
- Upload direto para S3

**Características:**
- **Batch processing**: 5 imagens paralelas (configurável)
- **Ken Burns effect**: Zoom 1.0 → 1.324 (32.4%)
- **Upscale**: 6720x3840 (6x) para qualidade superior
- **Output**: 1920x1080 @ 24fps
- **Codec**: h264_nvenc preset p4, CQ 23 VBR
- **Suporte**: Imagens horizontais e verticais (detecção automática)

**FFmpeg Process:**
```
-loop 1 -i image.jpg -vf "scale=6720:3840,zoompan=z='min(1+0.324*on/{frames},1.324)':d={frames}:s=1920x1080:fps=24" -c:v h264_nvenc -preset p4 -cq 23
```

**Multi-Worker:**
- Batches >50 imagens são distribuídos entre múltiplos workers
- Máximo 3 workers paralelos
- Resultados mesclados automaticamente

**Worker Configuration:**
- RunPod Template: `api-gpu-worker-fonts` (y829s32zfl)
- Docker Image: `oreiasccp/api-gpu-worker:latest` (v2.0.0)
- Endpoint ID: `rmmk1cilqjzm9x`
- Workers: 0-3 (auto-scaling)
- GPUs: AMPERE_16, AMPERE_24, RTX A4000, RTX A4500
- Idle timeout: 5 min
- Execution timeout: 40 min

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

# RunPod Configuration
RUNPOD_API_KEY=rpa_your_key_here

# Video Processing Endpoint (img2vid, caption, addaudio)
RUNPOD_ENDPOINT_ID=rmmk1cilqjzm9x

# Transcription Endpoint (faster-whisper)
RUNPOD_WHISPER_ENDPOINT_ID=82jjrwujznxwvn

# Timeout Configuration (30 min execution)
POLLING_MAX_ATTEMPTS=240              # 240 × 8s = 32 min max polling
EXPRESS_TIMEOUT_MS=2100000            # 35 min (server timeout)
RUNPOD_EXECUTION_TIMEOUT=2400         # 40 min (worker timeout)
RUNPOD_IDLE_TIMEOUT=300               # 5 min (keep-alive)

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
| POST | `/caption_style/segments` | Add styled SRT subtitles (custom ASS) |
| POST | `/caption_style/highlight` | Add karaoke word-by-word subtitles |
| POST | `/video/caption` | Add SRT subtitles (legacy) |
| POST | `/video/img2vid` | Convert images to videos |
| POST | `/video/addaudio` | Add/replace audio |
| GET | `/caption_style/health` | Caption style service health |
| GET | `/transcribe/health` | Transcription service health |
| GET | `/runpod/health` | RunPod endpoint status |
| GET | `/runpod/config` | RunPod configuration |
| GET | `/job/:jobId` | Check job status |
| POST | `/job/:jobId/cancel` | Cancel running job |

---

### POST /transcribe

**Description:** Transcreve áudio para texto e gera legendas em múltiplos formatos (SRT, ASS karaoke, JSON).

**Request:**
```json
{
  "audio_url": "https://example.com/audio.mp3",
  "path": "Project Name/Video Title/transcriptions/",
  "model": "large-v3"
}
```

**Parameters:**
- `audio_url` (string, **required**): Public URL do arquivo de áudio
  - Formatos: MP3, WAV, M4A, AAC, FLAC, OGG
  - Sem limite de tamanho ou duração
- `path` (string, **required**): Prefixo S3 para upload dos arquivos
  - Exemplo: `"Projeto/Video/transcriptions/"`
  - Os arquivos serão salvos em: `bucket/path/segments.srt`, `bucket/path/karaoke.ass`, `bucket/path/words.json`
- `model` (string, optional): Modelo Whisper a ser usado
  - Opções: `tiny`, `base`, `small`, `medium`, `large-v3`, `turbo`
  - Default: `large-v3` (máxima acurácia)
- `language` (string, optional): Código do idioma (ISO 639-1)
  - Exemplo: `pt`, `en`, `es`, `fr`, `de`
  - Default: detecção automática
- `enable_vad` (boolean, optional): Ativar Voice Activity Detection
  - Default: `true` (remove silêncios)
- `beam_size` (integer, optional): Tamanho do beam search
  - Range: 1-10
  - Default: `5` (balanceado entre velocidade e acurácia)
- `temperature` (number, optional): Sampling temperature
  - Range: 0-1
  - Default: `0` (determinístico)

**Response (200):**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "language": "pt",
  "transcription": "Era uma vez uma história...",
  "files": {
    "segments": {
      "srt": "https://s3.../canais/Projeto/Video/transcriptions/segments.srt",
      "vtt": "",
      "json": "https://s3.../canais/Projeto/Video/transcriptions/words.json"
    },
    "words": {
      "ass_karaoke": "https://s3.../canais/Projeto/Video/transcriptions/karaoke.ass",
      "vtt_karaoke": "",
      "lrc": "",
      "json": "https://s3.../canais/Projeto/Video/transcriptions/words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-07T10:00:00.000Z",
    "endTime": "2025-10-07T10:02:30.000Z",
    "durationMs": 150000,
    "durationSeconds": 150
  },
  "stats": {
    "segments": 42,
    "words": 156,
    "model": "large-v3",
    "device": "cuda"
  }
}
```

**Generated Files:**

1. **segments.srt** - Legendas tradicionais (SubRip)
```srt
1
00:00:00,000 --> 00:00:03,500
Era uma vez uma história

2
00:00:03,500 --> 00:00:07,200
que aconteceu há muito tempo atrás
```

2. **karaoke.ass** - Legendas karaoke (ASS com timing por palavra)
```ass
[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, ...
Style: Karaoke,Arial,48,&H00FFFFFF,&H000088EF,...

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.50,Karaoke,,0,0,0,,{\k35}Era {\k28}uma {\k30}vez {\k42}uma {\k50}história
```

3. **words.json** - Timestamps palavra-por-palavra (JSON)
```json
{
  "words": [
    { "word": "Era", "start": 0.0, "end": 0.35 },
    { "word": "uma", "start": 0.35, "end": 0.63 },
    { "word": "vez", "start": 0.63, "end": 0.93 },
    { "word": "uma", "start": 0.93, "end": 1.35 },
    { "word": "história", "start": 1.35, "end": 1.85 }
  ],
  "metadata": {
    "language": "pt",
    "model": "large-v3",
    "device": "cuda"
  }
}
```

**Error (400 - Bad Request):**
```json
{
  "error": "Missing required parameter",
  "message": "audio_url is required"
}
```

**Error (500 - Internal Server Error):**
```json
{
  "error": "Transcription failed",
  "message": "Failed to download audio file",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "execution": {
    "startTime": "2025-10-07T10:00:00.000Z",
    "endTime": "2025-10-07T10:00:15.000Z",
    "durationMs": 15000,
    "durationSeconds": 15
  }
}
```

**cURL Example:**
```bash
curl -X POST https://your-api.com/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "audio_url": "https://example.com/audio.mp3",
    "path": "MyProject/Episode01/transcriptions/",
    "model": "large-v3"
  }'
```

**Use Cases:**

1. **Legendas tradicionais**: Use `segments.srt` com `/video/caption`
2. **Legendas karaoke**: Use `karaoke.ass` com `/video/caption` (estilos hardcoded)
3. **Customização programática**: Use `words.json` para gerar legendas personalizadas
4. **Análise de conteúdo**: Use `transcription` field para busca/indexação

**Performance:**
- Audio de 1 min: ~5-10 segundos (model large-v3)
- Audio de 10 min: ~30-60 segundos (model large-v3)
- Audio de 60 min: ~3-5 minutos (model large-v3)

**Notes:**
- Arquivos ASS salvos com estilos padrão (fonte Arial, tamanho 48, cor branca)
- Para estilos customizados, use `words.json` e gere ASS programaticamente
- VAD recomendado para áudios com pausas longas
- Model `large-v3` recomendado para máxima acurácia

---

### POST /caption_style/segments

**Description:** Gera vídeo com legendas SRT estilizadas usando formato ASS customizável. Ideal para legendas tradicionais com controle total sobre aparência.

**Request (Payload Completo com Todos os Parâmetros):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://s3.example.com/subtitles.srt",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_legendado_estilizado.mp4",
  "style": {
    "font": {
      "name": "Arial",
      "size": 36,
      "bold": true
    },
    "colors": {
      "primary": "#FFFFFF",
      "outline": "#000000"
    },
    "border": {
      "style": 1,
      "width": 3
    },
    "position": {
      "alignment": "bottom_center",
      "marginVertical": 20
    }
  }
}
```

**Request (Payload Mínimo - Usa Valores Padrão):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://s3.example.com/subtitles.srt",
  "path": "Project Name/Video Title/videos/",
  "output_filename": "video_legendado.mp4"
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `url_video` | string (URI) | ✅ | - | URL pública do vídeo (MP4) |
| `url_srt` | string (URI) | ✅ | - | URL pública do arquivo SRT |
| `path` | string | ✅ | - | Prefixo S3 para upload (ex: `"Project/videos/"`) |
| `output_filename` | string | ✅ | - | Nome do arquivo de saída (ex: `"video.mp4"`) |
| `style.font.name` | string | ❌ | `"Arial"` | Nome da fonte |
| `style.font.size` | number | ❌ | `36` | Tamanho da fonte (20-200) |
| `style.font.bold` | boolean | ❌ | `true` | Negrito |
| `style.colors.primary` | string | ❌ | `"#FFFFFF"` | Cor do texto (hex) |
| `style.colors.outline` | string | ❌ | `"#000000"` | Cor da borda (hex) |
| `style.border.style` | number | ❌ | `1` | Estilo da borda (1=outline, 3=opaque box, 4=rounded box) |
| `style.border.width` | number | ❌ | `3` | Largura da borda (0-10) |
| `style.position.alignment` | string | ❌ | `"bottom_center"` | Posição da legenda |
| `style.position.marginVertical` | number | ❌ | `20` | Margem vertical (0-500) |

**Position Values:**
- `bottom_left`, `bottom_center`, `bottom_right`
- `middle_left`, `middle_center`, `middle_right`
- `top_left`, `top_center`, `top_right`

**Response (200):**
```json
{
  "code": 200,
  "message": "Video with styled segments subtitles completed successfully",
  "video_url": "https://s3.../canais/Project/videos/video_legendado_estilizado.mp4",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "execution": {
    "startTime": "2025-10-09T22:00:00.000Z",
    "endTime": "2025-10-09T22:01:30.000Z",
    "durationMs": 90000,
    "durationSeconds": 90
  },
  "stats": {
    "jobId": "runpod-job-abc123",
    "delayTime": 12500,
    "executionTime": 8200
  }
}
```

**Error (400):**
```json
{
  "error": "Validation failed",
  "message": "url_video is required",
  "job_id": "550e8400-..."
}
```

**cURL Example (Mínimo):**
```bash
curl -X POST https://your-api.com/caption_style/segments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://s3.../subtitles.srt",
    "path": "MyProject/final/",
    "output_filename": "video_final.mp4"
  }'
```

**cURL Example (Customizado):**
```bash
curl -X POST https://your-api.com/caption_style/segments \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://s3.../subtitles.srt",
    "path": "MyProject/final/",
    "output_filename": "video_styled.mp4",
    "style": {
      "font": {"name": "Roboto", "size": 48, "bold": true},
      "colors": {"primary": "#FFFF00", "outline": "#FF0000"},
      "border": {"style": 4, "width": 5},
      "position": {"alignment": "top_center", "marginVertical": 50}
    }
  }'
```

---

### POST /caption_style/highlight

**Description:** Gera vídeo com legendas karaoke word-by-word usando sistema de 2 layers ASS. Ideal para vídeos educacionais, karaoke, e acompanhamento de leitura.

**Request (Payload Completo com Todos os Parâmetros):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_words_json": "https://s3.example.com/words.json",
  "path": "Project Name/Video Title/karaoke/",
  "output_filename": "video_karaoke.mp4",
  "style": {
    "fonte": "Arial Black",
    "tamanho_fonte": 72,
    "fundo_cor": "#000000",
    "fundo_opacidade": 50,
    "fundo_arredondado": true,
    "texto_cor": "#FFFFFF",
    "highlight_cor": "#D60000",
    "highlight_borda": 12,
    "padding_horizontal": 40,
    "padding_vertical": 80,
    "position": "bottom_center",
    "words_per_line": 4,
    "max_lines": 2
  }
}
```

**Request (Payload Mínimo - Usa Valores Padrão):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_words_json": "https://s3.example.com/words.json",
  "path": "Project/karaoke/",
  "output_filename": "video_karaoke.mp4"
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `url_video` | string (URI) | ✅ | - | URL pública do vídeo (MP4) |
| `url_words_json` | string (URI) | ✅ | - | URL pública do JSON com palavras |
| `path` | string | ✅ | - | Prefixo S3 para upload |
| `output_filename` | string | ✅ | - | Nome do arquivo de saída |
| `style.fonte` | string | ❌ | `"Arial Black"` | Nome da fonte |
| `style.tamanho_fonte` | number | ❌ | `72` | Tamanho da fonte (20-200) |
| `style.fundo_cor` | string (hex) | ❌ | `"#000000"` | Cor do fundo em hexadecimal |
| `style.fundo_opacidade` | number | ❌ | `50` | Opacidade do fundo em % (0-100) - Convertida automaticamente |
| `style.fundo_arredondado` | boolean | ❌ | `true` | Fundo com cantos arredondados |
| `style.texto_cor` | string (hex) | ❌ | `"#FFFFFF"` | Cor do texto em hexadecimal |
| `style.highlight_cor` | string (hex) | ❌ | `"#D60000"` | Cor do highlight em hexadecimal |
| `style.highlight_borda` | number | ❌ | `12` | Largura da borda do highlight (1-50) |
| `style.padding_horizontal` | number | ❌ | `40` | Espaçamento horizontal (0-500) |
| `style.padding_vertical` | number | ❌ | `80` | Espaçamento vertical (0-500) |
| `style.position` | string | ❌ | `"bottom_center"` | Posição da legenda |
| `style.words_per_line` | number | ❌ | `4` | Palavras por linha (1-10) |
| `style.max_lines` | number | ❌ | `2` | Máximo de linhas por diálogo (1-5) |

**Position Values:**
- `bottom_left`, `bottom_center`, `bottom_right`
- `middle_left`, `middle_center`, `middle_right`
- `top_left`, `top_center`, `top_right`

**Formato do JSON de Palavras (url_words_json):**
```json
{
  "words": [
    { "word": "Era", "start": 0.0, "end": 0.35 },
    { "word": "uma", "start": 0.35, "end": 0.63 },
    { "word": "vez", "start": 0.63, "end": 0.93 }
  ]
}
```

**Response (200):**
```json
{
  "code": 200,
  "message": "Video with highlight subtitles completed successfully",
  "video_url": "https://s3.../canais/Project/karaoke/video_karaoke.mp4",
  "job_id": "d5faa27c-1da4-4677-8042-bbb46758893f",
  "execution": {
    "startTime": "2025-10-09T22:24:19.472Z",
    "endTime": "2025-10-09T22:24:43.176Z",
    "durationMs": 23704,
    "durationSeconds": 23.7
  },
  "stats": {
    "jobId": "6e76440d-bd43-4e5b-bce8-223e13449599-u2",
    "delayTime": 12915,
    "executionTime": 6038
  }
}
```

**Error (400):**
```json
{
  "error": "Validation failed",
  "message": "url_words_json is required",
  "job_id": "550e8400-..."
}
```

**cURL Example (Mínimo):**
```bash
curl -X POST https://your-api.com/caption_style/highlight \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_words_json": "https://s3.../words.json",
    "path": "MyProject/karaoke/",
    "output_filename": "video_karaoke.mp4"
  }'
```

**cURL Example (Customizado - Verde Neon com Opacidade 70% e 3 Palavras por Linha):**
```bash
curl -X POST https://your-api.com/caption_style/highlight \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_words_json": "https://s3.../words.json",
    "path": "MyProject/karaoke/",
    "output_filename": "video_karaoke_green.mp4",
    "style": {
      "fonte": "Arial Black",
      "tamanho_fonte": 72,
      "fundo_cor": "#000000",
      "fundo_opacidade": 70,
      "texto_cor": "#FFFFFF",
      "highlight_cor": "#00FF00",
      "highlight_borda": 15,
      "position": "bottom_center",
      "words_per_line": 3,
      "max_lines": 2
    }
  }'
```

**Use Cases:**

1. **Karaoke para música**: Use JSON do `/transcribe` com `words.json`
2. **Vídeos educacionais**: Destaque palavra por palavra para aprendizado de leitura
3. **Legenda acessível**: Facilita acompanhamento para pessoas com dificuldade de leitura
4. **Conteúdo infantil**: Animação de palavras sincronizada com narração

**Performance:**
- Vídeo 10s: ~6-8 segundos de processamento
- Vídeo 60s: ~15-20 segundos de processamento
- Cold start (worker inativo): +10-15 segundos

**Notes:**
- **JSON de palavras**: Pode ser obtido do endpoint `/transcribe` (campo `files.words.json`)
- **Sistema de 2 layers**: Layer 0 (texto completo) + Layer 2 (palavra ativa com highlight)
- **Cores em hexadecimal**: Enviadas como `#RRGGBB`, convertidas automaticamente para RGB pelo backend
- **Opacidade**: Enviada como percentual 0-100%, convertida automaticamente para 0-255 (formato ASS)
- **Word grouping configurável**: Use `words_per_line` e `max_lines` para controlar agrupamento
  - Exemplo: `words_per_line: 3, max_lines: 2` = até 6 palavras por diálogo (3 por linha × 2 linhas)
  - Exemplo: `words_per_line: 4, max_lines: 1` = até 4 palavras por diálogo (1 linha única)
- **Texto sempre em UPPERCASE**: Renderizado automaticamente para melhor legibilidade

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
// ============================================
// Transcription Types
// ============================================

interface TranscriptionRequest {
  audio_url: string;
  path: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v1' | 'large-v2' | 'large-v3' | 'turbo';
  language?: string;
  enable_vad?: boolean;
  beam_size?: number;
  temperature?: number;
}

interface TranscriptionWord {
  word: string;
  start: number;
  end: number;
}

interface TranscriptionSegment {
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

interface TranscriptionResponse {
  code: number;
  message: string;
  job_id: string;
  language: string;
  transcription: string;
  files: {
    segments: {
      srt: string;
      vtt: string;
      json: string;
    };
    words?: {
      ass_karaoke: string;
      vtt_karaoke: string;
      lrc: string;
      json: string;
    };
  };
  execution: {
    startTime: string;
    endTime: string;
    durationMs: number;
    durationSeconds: number;
  };
  stats: {
    segments: number;
    words: number;
    model: string;
    device: 'cuda' | 'cpu';
  };
}

// ============================================
// Video Processing Types
// ============================================

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

### Transcription Worker (RunPod Serverless)

**Template Pré-configurado RunPod:**

O worker de transcrição usa a imagem oficial do RunPod, não requer build próprio.

RunPod Console → Templates → New Template

```yaml
Template Name: faster-whisper-production
Container Image: runpod/ai-api-faster-whisper:1.0.10
Docker Command: python -u handler.py
Container Disk: 10 GB
Serverless: Yes

Environment Variables:
  # Nenhuma variável necessária - worker oficial RunPod
```

**Criar Endpoint:**

RunPod Console → Serverless → New Endpoint

```yaml
Endpoint Name: api-gpu-transcription
Template: faster-whisper-production
GPUs: AMPERE_16, AMPERE_24, RTX A4000, RTX A4500
Workers Min: 0
Workers Max: 2
Idle Timeout: 300
Execution Timeout: 2400
FlashBoot: Enabled
```

Copie o **Endpoint ID** para `.env` como `RUNPOD_WHISPER_ENDPOINT_ID`.

**Important:**
- Worker oficial do RunPod, não requer manutenção
- Upload de arquivos feito pelo orchestrator, não pelo worker
- Workers compartilham quota com video endpoint (máx 5 total)

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
      - RUNPOD_WHISPER_ENDPOINT_ID=${RUNPOD_WHISPER_ENDPOINT_ID}
      - POLLING_MAX_ATTEMPTS=${POLLING_MAX_ATTEMPTS}
      - EXPRESS_TIMEOUT_MS=${EXPRESS_TIMEOUT_MS}
      - RUNPOD_EXECUTION_TIMEOUT=${RUNPOD_EXECUTION_TIMEOUT}
      - RUNPOD_IDLE_TIMEOUT=${RUNPOD_IDLE_TIMEOUT}
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET_NAME=${S3_BUCKET_NAME}
      - S3_REGION=${S3_REGION}
      - BATCH_SIZE=${BATCH_SIZE}
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

## Exemplos de Uso Integrado

### Workflow Completo: Audio → Transcrição → Video com Legendas

**Step 1: Transcrever áudio**
```bash
curl -X POST https://your-api.com/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "audio_url": "https://cdn.example.com/podcast-episode-01.mp3",
    "path": "Podcast/Episode01/",
    "model": "large-v3"
  }'

# Response:
{
  "files": {
    "segments": {
      "srt": "https://s3.../canais/Podcast/Episode01/segments.srt"
    },
    "words": {
      "ass_karaoke": "https://s3.../canais/Podcast/Episode01/karaoke.ass"
    }
  }
}
```

**Step 2: Adicionar legendas ao vídeo**
```bash
# Legendas tradicionais
curl -X POST https://your-api.com/video/caption \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://cdn.example.com/video.mp4",
    "url_srt": "https://s3.../canais/Podcast/Episode01/segments.srt",
    "path": "Podcast/Episode01/final/",
    "output_filename": "video_legendado.mp4"
  }'

# OU legendas karaoke
curl -X POST https://your-api.com/video/caption \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://cdn.example.com/video.mp4",
    "url_srt": "https://s3.../canais/Podcast/Episode01/karaoke.ass",
    "path": "Podcast/Episode01/final/",
    "output_filename": "video_karaoke.mp4"
  }'
```

### Workflow: Imagens → Vídeos → Audio → Final

**Step 1: Converter imagens em vídeos**
```bash
curl -X POST https://your-api.com/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "images": [
      {"id": "1", "image_url": "https://example.com/img1.jpg", "duracao": 5.0},
      {"id": "2", "image_url": "https://example.com/img2.jpg", "duracao": 4.5}
    ],
    "path": "MeuProjeto/temp/"
  }'

# Response:
{
  "videos": [
    {"id": "1", "video_url": "https://s3.../video_1.mp4"},
    {"id": "2", "video_url": "https://s3.../video_2.mp4"}
  ]
}
```

**Step 2: Adicionar áudio a cada vídeo**
```bash
curl -X POST https://your-api.com/video/addaudio \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://s3.../video_1.mp4",
    "url_audio": "https://cdn.example.com/audio1.mp3",
    "path": "MeuProjeto/final/",
    "output_filename": "video_1_final.mp4"
  }'
```

**Step 3: Adicionar legendas (opcional)**
```bash
# Primeiro transcrever o áudio
curl -X POST https://your-api.com/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "audio_url": "https://cdn.example.com/audio1.mp3",
    "path": "MeuProjeto/subs/",
    "model": "large-v3"
  }'

# Depois adicionar legendas
curl -X POST https://your-api.com/video/caption \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://s3.../video_1_final.mp4",
    "url_srt": "https://s3.../MeuProjeto/subs/segments.srt",
    "path": "MeuProjeto/final/",
    "output_filename": "video_1_completo.mp4"
  }'
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
