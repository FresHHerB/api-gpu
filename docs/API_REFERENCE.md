# API Reference

Documentação completa de todos os endpoints da API GPU.

## Índice

- [Autenticação](#autenticação)
- [Endpoints](#endpoints)
  - [Transcrição](#post-transcribe)
  - [Legendas Estilizadas](#post-caption_style)
  - [Legendas Legacy](#post-videocaption)
  - [Imagem para Vídeo](#post-videoimg2vid)
  - [Adicionar Áudio](#post-videoaddaudio)
- [Health Checks](#health-checks)
- [TypeScript Types](#typescript-types)

---

## Autenticação

Todas as requisições (exceto `/health`) requerem header:

```http
X-API-Key: your-api-key
```

---

## Endpoints

### POST /transcribe

Transcreve áudio para texto e gera legendas em múltiplos formatos.

**Request:**
```json
{
  "audio_url": "https://example.com/audio.mp3",
  "path": "Project/Episode01/transcriptions/",
  "model": "large-v3"
}
```

**Parameters:**
| Campo | Tipo | Obrigatório | Padrão | Descrição |
|-------|------|-------------|--------|-----------|
| `audio_url` | string | ✅ | - | URL pública do áudio (MP3, WAV, M4A, etc) |
| `path` | string | ✅ | - | Prefixo S3 para upload |
| `model` | string | ❌ | `large-v3` | Modelo Whisper (`tiny`, `base`, `small`, `medium`, `large-v3`, `turbo`) |
| `language` | string | ❌ | auto | Código ISO 639-1 (`pt`, `en`, `es`, etc) |
| `enable_vad` | boolean | ❌ | `true` | Voice Activity Detection |
| `beam_size` | integer | ❌ | `5` | Beam search (1-10) |
| `temperature` | number | ❌ | `0` | Sampling temperature (0-1) |

**Response (200):**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "550e8400-...",
  "language": "pt",
  "transcription": "Era uma vez uma história...",
  "files": {
    "segments": {
      "srt": "https://s3.../segments.srt",
      "json": "https://s3.../words.json"
    },
    "words": {
      "ass_karaoke": "https://s3.../karaoke.ass",
      "json": "https://s3.../words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-09T...",
    "endTime": "2025-10-09T...",
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
1. `segments.srt` - Legendas tradicionais (SubRip)
2. `karaoke.ass` - Legendas karaoke com timing por palavra
3. `words.json` - Timestamps brutos (JSON)

**Performance:**
- 1 min audio: ~5-10s (large-v3)
- 10 min audio: ~30-60s (large-v3)
- 60 min audio: ~3-5 min (large-v3)

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

---

### POST /caption_style

**Endpoint unificado** para legendas estilizadas. Suporta dois modos via parâmetro `type`:
- `"segments"` - Legendas tradicionais (SRT → ASS estilizado)
- `"highlight"` - Legendas karaoke word-by-word (JSON → ASS 2-layer)

#### Common Parameters

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `url_video` | string | ✅ | URL pública do vídeo (MP4) |
| `url_caption` | string | ✅ | URL do arquivo de legendas (SRT para segments, JSON para highlight) |
| `path` | string | ✅ | Prefixo S3 para upload |
| `output_filename` | string | ✅ | Nome do arquivo de saída |
| `type` | string | ✅ | `"segments"` ou `"highlight"` |

#### Type: segments (Legendas Tradicionais)

**Request (Mínimo):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_caption": "https://s3.../subtitles.srt",
  "path": "Project/videos/",
  "output_filename": "video.mp4",
  "type": "segments"
}
```

**Style Parameters (Opcional):**
| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `style.font.name` | string | `"Arial"` | Nome da fonte |
| `style.font.size` | number | `36` | Tamanho (20-200) |
| `style.font.bold` | boolean | `true` | Negrito |
| `style.colors.primary` | string | `"#FFFFFF"` | Cor do texto (hex) |
| `style.colors.outline` | string | `"#000000"` | Cor da borda (hex) |
| `style.border.style` | number | `1` | 1=outline, 3=box, 4=rounded |
| `style.border.width` | number | `3` | Largura (0-10) |
| `style.position.alignment` | string | `"bottom_center"` | Posição (ver valores) |
| `style.position.marginVertical` | number | `20` | Margem vertical (0-500) |

**Position Values:**
- `bottom_left`, `bottom_center`, `bottom_right`
- `middle_left`, `middle_center`, `middle_right`
- `top_left`, `top_center`, `top_right`

#### Type: highlight (Legendas Karaoke)

**Request (Mínimo):**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_caption": "https://s3.../words.json",
  "path": "Project/karaoke/",
  "output_filename": "video_karaoke.mp4",
  "type": "highlight"
}
```

**Style Parameters (Opcional):**
| Campo | Tipo | Padrão | Descrição |
|-------|------|--------|-----------|
| `style.fonte` | string | `"Arial Black"` | Nome da fonte |
| `style.tamanho_fonte` | number | `72` | Tamanho (20-200) |
| `style.fundo_cor` | string | `"#000000"` | Cor do fundo (hex) |
| `style.fundo_opacidade` | number | `50` | Opacidade % (0-100) |
| `style.fundo_arredondado` | boolean | `true` | Cantos arredondados |
| `style.texto_cor` | string | `"#FFFFFF"` | Cor do texto (hex) |
| `style.highlight_cor` | string | `"#D60000"` | Cor do highlight (hex) |
| `style.highlight_borda` | number | `12` | Largura da borda (1-50) |
| `style.padding_horizontal` | number | `40` | Padding horizontal (0-500) |
| `style.padding_vertical` | number | `80` | Padding vertical (0-500) |
| `style.position` | string | `"bottom_center"` | Posição |
| `style.words_per_line` | number | `4` | Palavras por linha (1-10) |
| `style.max_lines` | number | `2` | Máx linhas/diálogo (1-5) |

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

#### Response (200 - Ambos os Tipos)

```json
{
  "code": 200,
  "message": "Video with segments subtitles completed successfully",
  "type": "segments",
  "video_url": "https://s3.../video.mp4",
  "job_id": "550e8400-...",
  "execution": {
    "startTime": "2025-10-09T...",
    "endTime": "2025-10-09T...",
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

**cURL Examples:**

**Segments (Mínimo):**
```bash
curl -X POST https://your-api.com/caption_style \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_caption": "https://s3.../subtitles.srt",
    "path": "MyProject/final/",
    "output_filename": "video.mp4",
    "type": "segments"
  }'
```

**Highlight (Customizado):**
```bash
curl -X POST https://your-api.com/caption_style \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_caption": "https://s3.../words.json",
    "path": "MyProject/karaoke/",
    "output_filename": "video_karaoke.mp4",
    "type": "highlight",
    "style": {
      "highlight_cor": "#00FF00",
      "fundo_opacidade": 70,
      "words_per_line": 3
    }
  }'
```

---

### POST /video/caption

**Legacy endpoint** para legendas SRT básicas (sem estilização).

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://example.com/subtitles.srt",
  "path": "Project/videos/",
  "output_filename": "video_legendado.mp4"
}
```

**Response (200):**
```json
{
  "code": 200,
  "message": "Video caption completed and uploaded to S3 successfully",
  "video_url": "https://s3.../video_legendado.mp4",
  "execution": {
    "startTime": "2025-10-09T...",
    "endTime": "2025-10-09T...",
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

### POST /video/img2vid

Converte imagens em vídeos com efeito Ken Burns.

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
  "path": "Project/videos/temp/"
}
```

**Parameters:**
- `images` (array, required): Array de imagens
  - `id` (string, required): Identificador único
  - `image_url` (string, required): URL da imagem (JPG/PNG)
  - `duracao` (number, required): Duração em segundos
- `path` (string, required): Prefixo S3

**Response (200):**
```json
{
  "code": 200,
  "message": "Images converted to videos and uploaded to S3 successfully",
  "videos": [
    {
      "id": "img-1",
      "video_url": "https://s3.../video_1.mp4",
      "filename": "video_1.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-09T...",
    "endTime": "2025-10-09T...",
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

**Features:**
- Ken Burns effect: Zoom 1.0 → 1.324 (32.4%)
- Upscale: 6720x3840 (6x) para qualidade superior
- Output: 1920x1080 @ 24fps
- Codec: h264_nvenc preset p4, CQ 23 VBR

---

### POST /video/addaudio

Adiciona ou substitui áudio em vídeo.

**Request:**
```json
{
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/audio.mp3",
  "path": "Project/videos/",
  "output_filename": "video_com_audio.mp4"
}
```

**Response (200):**
```json
{
  "code": 200,
  "message": "Video addaudio completed and uploaded to S3 successfully",
  "video_url": "https://s3.../video_com_audio.mp4",
  "execution": {
    "startTime": "2025-10-09T...",
    "endTime": "2025-10-09T...",
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

## Health Checks

### GET /health
Health check geral do orchestrator (sem autenticação).

### GET /transcribe/health
Health check do serviço de transcrição.

### GET /caption_style/health
Health check do serviço de legendas estilizadas.

### GET /runpod/health
Status do endpoint RunPod.

**Response:**
```json
{
  "status": "healthy",
  "service": "...",
  "timestamp": "2025-10-09T..."
}
```

---

## TypeScript Types

```typescript
// Transcription
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

// Caption Style (Unified)
interface CaptionStyleRequest {
  url_video: string;
  url_caption: string;
  path: string;
  output_filename: string;
  type: 'segments' | 'highlight';
  style?: SegmentsStyle | HighlightStyle;
}

interface SegmentsStyle {
  font?: { name?: string; size?: number; bold?: boolean };
  colors?: { primary?: string; outline?: string };
  border?: { style?: number; width?: number };
  position?: { alignment?: string; marginVertical?: number };
}

interface HighlightStyle {
  fonte?: string;
  tamanho_fonte?: number;
  fundo_cor?: string;
  fundo_opacidade?: number;
  fundo_arredondado?: boolean;
  texto_cor?: string;
  highlight_cor?: string;
  highlight_borda?: number;
  padding_horizontal?: number;
  padding_vertical?: number;
  position?: string;
  words_per_line?: number;
  max_lines?: number;
}

// Video Processing
interface Img2VidRequest {
  images: Array<{ id: string; image_url: string; duracao: number }>;
  path: string;
}

interface AddAudioRequest {
  url_video: string;
  url_audio: string;
  path: string;
  output_filename: string;
}

// Common Response
interface ExecutionInfo {
  startTime: string;
  endTime: string;
  durationMs: number;
  durationSeconds: number;
}

interface VideoResponse {
  code: number;
  message: string;
  video_url?: string;
  videos?: Array<{ id: string; video_url: string; filename: string }>;
  execution: ExecutionInfo;
  stats: Record<string, any>;
}
```

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing/invalid API key) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (RunPod offline) |

**Error Response Format:**
```json
{
  "error": "Error type",
  "message": "Detailed error message",
  "job_id": "550e8400-..."
}
```
