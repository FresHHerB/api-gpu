# API Reference - Versão 3.0

Documentação completa de todos os endpoints da API GPU com aceleração por hardware.

## 🔑 Autenticação

Todos os endpoints (exceto `/health` e health checks) requerem o header:

```http
X-API-Key: your-api-key-here
```

Configure a chave no arquivo `.env`:
```bash
X_API_KEY=your-secure-api-key
```

---

## 📋 Índice

- [Endpoints GPU](#endpoints-gpu)
  - [Transcription](#post-gputranscribe)
  - [Caption Style](#post-gpuvideocaption_style)
  - [Image to Video](#post-gpuvideoimg2vid)
  - [Add Audio](#post-gpuvideoaddaudio)
  - [Concatenate](#post-gpuvideoconcatenate)
- [Job Management](#job-management)
- [Health Checks](#health-checks)
- [Webhooks](#webhooks)
- [Error Codes](#error-codes)
- [TypeScript Types](#typescript-types)

---

## Endpoints GPU

Todos os endpoints GPU usam o prefixo `/gpu/` e suportam aceleração por hardware via NVENC.

### POST /gpu/transcribe

Transcreve áudio para texto usando Whisper com GPU e gera legendas em múltiplos formatos.

**Tipo:** Síncrono (aguarda conclusão)

**Request:**
```json
{
  "audio_url": "https://example.com/audio.mp3",
  "path": "Project/Episode01/transcriptions/",
  "model": "large-v3",
  "language": "pt",
  "enable_vad": true,
  "beam_size": 5,
  "temperature": 0
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `audio_url` | string | ✅ | - | URL pública do áudio (MP3, WAV, M4A, FLAC) |
| `path` | string | ✅ | - | Prefixo S3 para upload dos arquivos |
| `model` | string | ❌ | `large-v3` | Modelo Whisper: `tiny`, `base`, `small`, `medium`, `large-v3`, `turbo` |
| `language` | string | ❌ | auto | Código ISO 639-1: `pt`, `en`, `es`, `fr`, etc |
| `enable_vad` | boolean | ❌ | `true` | Voice Activity Detection (reduz alucinações) |
| `beam_size` | integer | ❌ | `5` | Beam search size (1-10, maior = melhor qualidade) |
| `temperature` | number | ❌ | `0` | Sampling temperature (0-1, 0 = determinístico) |

**Response (200):**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "language": "pt",
  "transcription": "Era uma vez uma história incrível...",
  "files": {
    "segments": {
      "srt": "https://s3.amazonaws.com/.../segments.srt",
      "json": "https://s3.amazonaws.com/.../words.json"
    },
    "words": {
      "ass_karaoke": "https://s3.amazonaws.com/.../karaoke.ass",
      "json": "https://s3.amazonaws.com/.../words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-13T12:00:00.000Z",
    "endTime": "2025-10-13T12:02:30.000Z",
    "durationMs": 150000,
    "durationSeconds": 150
  },
  "stats": {
    "segments": 42,
    "words": 256,
    "model": "large-v3",
    "device": "cuda"
  }
}
```

**Arquivos Gerados:**
1. **segments.srt** - Legendas tradicionais SubRip (por segmento)
2. **karaoke.ass** - Legendas ASS karaoke com timing palavra-por-palavra
3. **words.json** - Timestamps brutos em JSON para processamento customizado

**Performance (large-v3):**
- 1 min audio: ~5-10s
- 10 min audio: ~30-60s
- 60 min audio: ~3-5 min

**Exemplo cURL:**
```bash
curl -X POST "https://api.example.com/gpu/transcribe" \
  -H "Content-Type: application/json" \
  -d '{
    "audio_url": "https://cdn.example.com/podcast-episode-01.mp3",
    "path": "MyPodcast/Season01/Episode01/transcriptions/",
    "model": "large-v3",
    "language": "pt"
  }'
```

---

### POST /gpu/video/caption_style

**Endpoint unificado** para legendas estilizadas com aceleração GPU. Suporta dois modos:
- **`segments`** - Legendas tradicionais (SRT → ASS estilizado)
- **`highlight`** - Legendas karaoke palavra-por-palavra (JSON → ASS 2-layer)

**Tipo:** Assíncrono (webhook required)

#### Common Parameters

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `webhook_url` | string (URL) | ✅ | URL para receber callback quando processar |
| `id_roteiro` | number | ❌ | ID do roteiro (tracking opcional) |
| `url_video` | string (URL) | ✅ | URL pública do vídeo MP4 |
| `url_caption` | string (URL) | ✅ | URL do arquivo de legendas (SRT para segments, JSON para highlight) |
| `path` | string | ✅ | Prefixo S3 para upload (ex: `"Channel/Video/videos/final/"`) |
| `output_filename` | string | ✅ | Nome do arquivo de saída (ex: `"video_final.mp4"`) |
| `type` | string | ✅ | Tipo de legenda: `"segments"` ou `"highlight"` |

---

#### Type: `segments` (Legendas Clássicas)

**Request (Mínimo):**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/caption",
  "id_roteiro": 123,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/subtitles.srt",
  "path": "Channel/Video/videos/final/",
  "output_filename": "video_with_subtitles.mp4",
  "type": "segments"
}
```

**Style Parameters (Opcional):**

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `style.font.name` | string | `"Arial"` | Nome da fonte (ex: `"Roboto"`, `"Open Sans"`) |
| `style.font.size` | number | `36` | Tamanho da fonte (20-200) |
| `style.font.bold` | boolean | `true` | Negrito |
| `style.colors.primary` | string | `"#FFFFFF"` | Cor do texto em hexadecimal |
| `style.colors.outline` | string | `"#000000"` | Cor da borda em hexadecimal |
| `style.border.style` | number | `1` | Estilo da borda: `1`=outline, `3`=box, `4`=rounded |
| `style.border.width` | number | `3` | Largura da borda (0-10) |
| `style.position.alignment` | string | `"bottom_center"` | Posição (ver valores abaixo) |
| `style.position.marginVertical` | number | `20` | Margem vertical em pixels (0-500) |

**Position Values:**
```
top_left       top_center       top_right
middle_left    middle_center    middle_right
bottom_left    bottom_center    bottom_right
```

**Request (Com Estilo Customizado):**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/caption",
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/subtitles.srt",
  "path": "Channel/Video/videos/final/",
  "output_filename": "video_styled.mp4",
  "type": "segments",
  "style": {
    "font": {
      "name": "Roboto",
      "size": 48,
      "bold": true
    },
    "colors": {
      "primary": "#FFFF00",
      "outline": "#FF0000"
    },
    "border": {
      "style": 1,
      "width": 4
    },
    "position": {
      "alignment": "bottom_center",
      "marginVertical": 30
    }
  }
}
```

---

#### Type: `highlight` (Legendas Karaoke)

**Request (Mínimo):**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/karaoke",
  "id_roteiro": 124,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/words.json",
  "path": "Channel/Video/videos/karaoke/",
  "output_filename": "video_karaoke.mp4",
  "type": "highlight"
}
```

**Style Parameters (Opcional):**

| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `style.fonte` | string | `"Arial Black"` | Nome da fonte |
| `style.tamanho_fonte` | number | `72` | Tamanho da fonte (20-200) |
| `style.fundo_cor` | string | `"#000000"` | Cor do fundo (hex) |
| `style.fundo_opacidade` | number | `50` | Opacidade do fundo em % (0-100) |
| `style.fundo_arredondado` | boolean | `true` | Cantos arredondados no fundo |
| `style.texto_cor` | string | `"#FFFFFF"` | Cor do texto padrão (hex) |
| `style.highlight_texto_cor` | string | `"#FFFF00"` | 🆕 Cor do texto da palavra destacada (hex) |
| `style.highlight_cor` | string | `"#D60000"` | Cor da borda da palavra destacada (hex) |
| `style.highlight_borda` | number | `12` | Largura da borda do highlight (1-50) |
| `style.padding_horizontal` | number | `40` | Padding horizontal (0-500) |
| `style.padding_vertical` | number | `80` | Padding vertical (0-500) |
| `style.position` | string | `"bottom_center"` | Posição (mesmos valores do segments) |
| `style.words_per_line` | number | `4` | Palavras por linha (1-10) |
| `style.max_lines` | number | `2` | Máximo de linhas por diálogo (1-5) |

**JSON de Palavras (url_caption):**
```json
{
  "words": [
    { "word": "Era", "start": 0.0, "end": 0.35 },
    { "word": "uma", "start": 0.35, "end": 0.63 },
    { "word": "vez", "start": 0.63, "end": 0.93 }
  ]
}
```

**Request (Com Estilo Customizado):**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/karaoke",
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/words.json",
  "path": "Channel/Video/videos/karaoke/",
  "output_filename": "video_karaoke_custom.mp4",
  "type": "highlight",
  "style": {
    "fonte": "Arial Black",
    "tamanho_fonte": 84,
    "fundo_cor": "#000000",
    "fundo_opacidade": 70,
    "fundo_arredondado": true,
    "texto_cor": "#FFFFFF",
    "highlight_texto_cor": "#FFFF00",
    "highlight_cor": "#00FF00",
    "highlight_borda": 15,
    "padding_horizontal": 50,
    "padding_vertical": 100,
    "position": "bottom_center",
    "words_per_line": 3,
    "max_lines": 2
  }
}
```

#### Response (202 Accepted - Ambos os Tipos)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "idRoteiro": 123,
  "message": "Job queued successfully",
  "estimatedTime": "~2 minutes",
  "queuePosition": 1,
  "statusUrl": "/jobs/550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

**Ver seção [Webhooks](#webhooks) para formato de callback completo.**

---

### POST /gpu/video/img2vid

Converte imagens em vídeos com efeito Ken Burns (zoom cinematográfico) e GPU encoding.

**Tipo:** Assíncrono (webhook required)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/img2vid",
  "id_roteiro": 125,
  "images": [
    {
      "id": "img-1",
      "image_url": "https://cdn.example.com/photo1.jpg",
      "duracao": 6.48
    },
    {
      "id": "img-2",
      "image_url": "https://cdn.example.com/photo2.jpg",
      "duracao": 5.0
    }
  ],
  "path": "Channel/Video/videos/temp/",
  "zoom_types": ["zoomin", "zoomout", "zoompanright"]
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `webhook_url` | string (URL) | ✅ | URL para callback |
| `id_roteiro` | number | ❌ | ID do roteiro (tracking) |
| `images` | array | ✅ | Array de objetos de imagem |
| `images[].id` | string | ✅ | Identificador único da imagem |
| `images[].image_url` | string (URL) | ✅ | URL da imagem (JPG/PNG) |
| `images[].duracao` | number | ✅ | Duração em segundos |
| `path` | string | ✅ | Prefixo S3 para upload |
| `zoom_types` | array | ❌ | Tipos de zoom (padrão: `["zoomin"]`) |

**Zoom Types:**
- `"zoomin"` - Começa normal, termina com zoom (centralizado)
- `"zoomout"` - Começa com zoom, termina normal (centralizado)
- `"zoompanright"` - Zoom in + movimento esquerda para direita

Efeitos são distribuídos proporcionalmente e aleatoriamente. Ex: 10 imagens com `["zoomin", "zoomout"]` = 5 zoomin + 5 zoomout (ordem aleatória).

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "idRoteiro": 125,
  "message": "Job queued successfully",
  "queuePosition": 2,
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

**Webhook Callback (COMPLETED):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 125,
  "status": "COMPLETED",
  "operation": "img2vid",
  "result": {
    "success": true,
    "videos": [
      {
        "id": "img-1",
        "video_url": "https://s3.example.com/.../video_1.mp4",
        "filename": "video_1.mp4"
      },
      {
        "id": "img-2",
        "video_url": "https://s3.example.com/.../video_2.mp4",
        "filename": "video_2.mp4"
      }
    ],
    "pathRaiz": "Channel/Video/",
    "message": "2 images converted to videos and uploaded to S3 successfully"
  },
  "execution": {
    "startTime": "2025-10-13T12:00:05.000Z",
    "endTime": "2025-10-13T12:02:00.000Z",
    "durationMs": 115000,
    "durationSeconds": 115
  }
}
```

**Features:**
- Ken Burns effect: Zoom 1.0 → 1.25 (25%)
- Upscale intermediário: 19200x10800 (10x) para movimento suave
- Output: 1920x1080 @ 24fps
- Codec: h264_nvenc preset p4, CQ 23 VBR

---

### POST /gpu/video/addaudio

Adiciona ou substitui faixa de áudio em vídeo com aceleração GPU.

**Tipo:** Assíncrono (webhook required)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/addaudio",
  "id_roteiro": 126,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_audio": "https://cdn.example.com/soundtrack.mp3",
  "path": "Channel/Video/videos/final/",
  "output_filename": "video_with_audio.mp4"
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `webhook_url` | string (URL) | ✅ | URL para callback |
| `id_roteiro` | number | ❌ | ID do roteiro |
| `url_video` | string (URL) | ✅ | URL do vídeo MP4 |
| `url_audio` | string (URL) | ✅ | URL do áudio (MP3, AAC, WAV) |
| `path` | string | ✅ | Prefixo S3 para upload |
| `output_filename` | string | ✅ | Nome do arquivo de saída |

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "message": "Job queued successfully",
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

---

### POST /gpu/video/concatenate

Concatena múltiplos vídeos em um único arquivo com re-encoding GPU.

**Tipo:** Assíncrono (webhook required)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/concatenate",
  "id_roteiro": 127,
  "video_urls": [
    {"video_url": "https://cdn.example.com/part1.mp4"},
    {"video_url": "https://cdn.example.com/part2.mp4"},
    {"video_url": "https://cdn.example.com/part3.mp4"}
  ],
  "path": "Channel/Video/videos/final/",
  "output_filename": "complete_video.mp4"
}
```

**Parameters:**

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `webhook_url` | string (URL) | ✅ | URL para callback |
| `id_roteiro` | number | ❌ | ID do roteiro |
| `video_urls` | array | ✅ | Array de objetos com `video_url` (mínimo 2) |
| `video_urls[].video_url` | string (URL) | ✅ | URL do vídeo MP4 |
| `path` | string | ✅ | Prefixo S3 para upload |
| `output_filename` | string | ✅ | Nome do arquivo de saída |

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "message": "Job queued successfully",
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

**Ver:** [CONCATENATE_ENDPOINT.md](./CONCATENATE_ENDPOINT.md) para detalhes completos.

---

## Job Management

### GET /jobs/:jobId

Consulta o status de um job em execução ou concluído.

**Auth:** Required

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PROCESSING",
  "operation": "caption_segments",
  "idRoteiro": 123,
  "createdAt": "2025-10-13T12:00:00.000Z",
  "startedAt": "2025-10-13T12:00:05.000Z",
  "progress": {
    "completed": 1,
    "total": 1,
    "percentage": 100
  }
}
```

**Status Values:**
- `QUEUED` - Na fila aguardando worker
- `SUBMITTED` - Submetido ao RunPod
- `PROCESSING` - Em processamento
- `COMPLETED` - Concluído com sucesso
- `FAILED` - Falhou com erro
- `CANCELLED` - Cancelado pelo usuário

---

### POST /jobs/:jobId/cancel

Cancela um job em execução.

**Auth:** Required

**Response:**
```json
{
  "message": "Job cancelled successfully",
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

---

### GET /queue/stats

Retorna estatísticas da fila de jobs.

**Auth:** Required

**Response:**
```json
{
  "queued": 2,
  "submitted": 1,
  "processing": 3,
  "completed": 45,
  "failed": 2,
  "cancelled": 0,
  "totalJobs": 53,
  "activeWorkers": 3,
  "availableWorkers": 2
}
```

---

## Health Checks

### GET /health

Health check geral do orchestrator (sem autenticação).

**Response:**
```json
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-10-13T12:00:00.000Z",
  "uptime": 3600,
  "queue": {
    "queued": 2,
    "processing": 3,
    "completed": 45,
    "failed": 2,
    "activeWorkers": 3,
    "availableWorkers": 2
  }
}
```

---

### GET /gpu/transcribe/health

Health check do serviço de transcrição (sem autenticação).

**Response:**
```json
{
  "status": "healthy",
  "service": "transcription",
  "whisper": {
    "healthy": true,
    "endpoint": "wkxpfgz3wkv5j1"
  },
  "timestamp": "2025-10-13T12:00:00.000Z"
}
```

---

## Webhooks

Todos os endpoints assíncronos (`/gpu/video/*`) enviam callbacks via POST quando o processamento é concluído.

### Webhook Payload (Success)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 123,
  "status": "COMPLETED",
  "operation": "caption_segments",
  "result": {
    "success": true,
    "video_url": "https://s3.example.com/.../video_final.mp4",
    "filename": "video_final.mp4",
    "s3_key": "Channel/Video/videos/final/video_final.mp4",
    "pathRaiz": "Channel/Video/",
    "message": "Video with segments subtitles completed successfully"
  },
  "execution": {
    "startTime": "2025-10-13T12:00:05.000Z",
    "endTime": "2025-10-13T12:02:30.000Z",
    "durationMs": 145000,
    "durationSeconds": 145
  }
}
```

### Webhook Payload (Error)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 123,
  "status": "FAILED",
  "operation": "caption_segments",
  "error": {
    "code": "PROCESSING_ERROR",
    "message": "FFmpeg encoding failed: Invalid video format"
  },
  "execution": {
    "startTime": "2025-10-13T12:00:05.000Z",
    "endTime": "2025-10-13T12:00:45.000Z",
    "durationMs": 40000,
    "durationSeconds": 40
  }
}
```

### Webhook Security

O sistema valida webhook URLs com proteção anti-SSRF:
- ❌ Localhost (`localhost`, `127.0.0.1`, `::1`)
- ❌ IPs privados (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- ✅ URLs públicas HTTP/HTTPS

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success (síncrono) |
| 202 | Accepted (assíncrono - job enfileirado) |
| 400 | Bad Request (erro de validação) |
| 401 | Unauthorized (API key inválida ou ausente) |
| 404 | Not Found (job não encontrado) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (RunPod offline) |

**Error Response Format:**
```json
{
  "error": "Validation failed",
  "message": "Detailed error description",
  "details": [
    {
      "field": "url_video",
      "message": "\"url_video\" is required"
    }
  ]
}
```

---

## TypeScript Types

```typescript
// ============================================
// Common Types
// ============================================

interface ExecutionInfo {
  startTime: string;    // ISO 8601
  endTime: string;      // ISO 8601
  durationMs: number;
  durationSeconds: number;
}

interface JobResponse {
  jobId: string;
  status: 'QUEUED' | 'SUBMITTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  idRoteiro?: number;
  message: string;
  estimatedTime?: string;
  queuePosition?: number;
  statusUrl: string;
  createdAt: string;
}

// ============================================
// Transcription
// ============================================

interface TranscriptionRequest {
  audio_url: string;
  path: string;
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v3' | 'turbo';
  language?: string;
  enable_vad?: boolean;
  beam_size?: number;
  temperature?: number;
}

interface TranscriptionResponse {
  code: number;
  message: string;
  job_id: string;
  language: string;
  transcription: string;
  files: {
    segments: { srt: string; json: string };
    words: { ass_karaoke: string; json: string };
  };
  execution: ExecutionInfo;
  stats: {
    segments: number;
    words: number;
    model: string;
    device: 'cuda' | 'cpu';
  };
}

// ============================================
// Caption Style
// ============================================

interface CaptionStyleRequestAsync {
  webhook_url: string;
  id_roteiro?: number;
  url_video: string;
  url_caption: string;
  path: string;
  output_filename: string;
  type: 'segments' | 'highlight';
  style?: SegmentsStyle | HighlightStyle;
}

interface SegmentsStyle {
  font?: {
    name?: string;
    size?: number;
    bold?: boolean;
  };
  colors?: {
    primary?: string;
    outline?: string;
  };
  border?: {
    style?: 1 | 3 | 4;
    width?: number;
  };
  position?: {
    alignment?: 'bottom_left' | 'bottom_center' | 'bottom_right' |
                 'middle_left' | 'middle_center' | 'middle_right' |
                 'top_left' | 'top_center' | 'top_right';
    marginVertical?: number;
  };
}

interface HighlightStyle {
  fonte?: string;
  tamanho_fonte?: number;
  fundo_cor?: string;
  fundo_opacidade?: number;
  fundo_arredondado?: boolean;
  texto_cor?: string;
  highlight_texto_cor?: string;
  highlight_cor?: string;
  highlight_borda?: number;
  padding_horizontal?: number;
  padding_vertical?: number;
  position?: string;
  words_per_line?: number;
  max_lines?: number;
}

// ============================================
// Image to Video
// ============================================

interface Img2VidRequestAsync {
  webhook_url: string;
  id_roteiro?: number;
  images: Array<{
    id: string;
    image_url: string;
    duracao: number;
  }>;
  path: string;
  zoom_types?: Array<'zoomin' | 'zoomout' | 'zoompanright'>;
}

// ============================================
// Add Audio
// ============================================

interface AddAudioRequestAsync {
  webhook_url: string;
  id_roteiro?: number;
  url_video: string;
  url_audio: string;
  path: string;
  output_filename: string;
}

// ============================================
// Concatenate
// ============================================

interface ConcatenateRequestAsync {
  webhook_url: string;
  id_roteiro?: number;
  video_urls: Array<{ video_url: string }>;
  path: string;
  output_filename: string;
}

// ============================================
// Webhook Callback
// ============================================

interface WebhookPayload {
  jobId: string;
  idRoteiro?: number;
  status: 'COMPLETED' | 'FAILED';
  operation: string;
  result?: {
    success: boolean;
    video_url?: string;
    videos?: Array<{ id: string; video_url: string; filename: string }>;
    filename?: string;
    s3_key?: string;
    pathRaiz?: string;
    message: string;
  };
  error?: {
    code: string;
    message: string;
  };
  execution: ExecutionInfo;
}
```

---

## Rate Limits

**Current:** Sem rate limits (controlado pelo número de workers disponíveis)

**Queue:** Máximo 3 workers concorrentes (configurável)

**Timeout:**
- Express: 35 minutos
- RunPod execution: 40 minutos
- Polling: 32 minutos

---

## Changelog

### v3.0.0 (2025-10-13)
- ✅ Reorganização completa: todos endpoints GPU com prefixo `/gpu/`
- ✅ Endpoint unificado `/gpu/video/caption_style` (segments + highlight)
- ✅ Novo parâmetro `highlight_texto_cor` para customizar cor do texto destacado
- ✅ Sistema de filas com webhooks assíncronos
- ✅ Suporte a `pathRaiz` em todos os callbacks
- ❌ Removidos endpoints legacy: `/video/caption`, `/caption_style/segments`, `/caption_style/highlight`

### v2.x
- Caption style com 2 modos (segments/highlight)
- Transcrição com Whisper GPU

### v1.x
- Versão inicial com endpoints básicos

---

## Support

- **Issues:** https://github.com/your-repo/api-gpu/issues
- **Docs:** https://github.com/your-repo/api-gpu/docs
- **Email:** support@example.com

---

**Última atualização:** 2025-10-13
**Versão da API:** 3.0.0
