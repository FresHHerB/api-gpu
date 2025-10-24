# API Reference

Complete documentation for AutoDark API GPU - Enterprise video processing API powered by RunPod serverless GPU workers.

---

## 🔑 Authentication

All endpoints (except health checks) require the `X-API-Key` header:

```http
X-API-Key: your-api-key-here
```

Configure in `.env`:
```bash
X_API_KEY=your-secure-api-key
```

---

## 📋 Table of Contents

### Video Processing
- [RunPod GPU Endpoints](#runpod-gpu-video-processing)
  - [POST /runpod/video/img2vid](#post-runpodvideoimg2vid) - Image to video with Ken Burns
  - [POST /runpod/video/caption_style](#post-runpodvideocaption_style) - Styled captions (segments/karaoke)
  - [POST /runpod/video/addaudio](#post-runpodvideoaddaudio) - Add/replace audio
  - [POST /runpod/video/concatenate](#post-runpodvideoconcatenate) - Merge videos
  - [POST /runpod/video/concat_video_audio](#post-runpodvideoconcat_video_audio) - Cycle videos to audio
  - [POST /runpod/video/trilhasonora](#post-runpodvideotrilhasonora) - Add background music

- [VPS CPU Endpoints](#vps-cpu-video-processing)
  - [POST /vps/video/*](#vps-video-endpoints) - Same operations, CPU-based
  - [POST /vps/video/transcribe_youtube](#post-vpsvideotranscribe_youtube) - Extract YouTube captions

### Audio Processing
- [POST /runpod/audio/transcribe](#post-runpodaudiotranscribe) - Faster-Whisper transcription (GPU)
- [POST /runpod/audio/transcribe-whisper](#post-runpodaudiotranscribe-whisper) - OpenAI Whisper Official (GPU)
- [POST /vps/audio/concatenate](#post-vpsaudioconcatenate) - Merge audio files (CPU)
- [POST /vps/audio/trilhasonora](#post-vpsaudiotrilhasonora) - Mix audio with background music (CPU)
- [GET /vps/audio/health](#get-vpsaudiohealth) - Audio service health

### Image Generation
- [POST /vps/imagem/gerarPrompts](#post-vpsimagemgerarprompts) - AI prompt generation
- [POST /vps/imagem/gerarImagens](#post-vpsimagemgerarimagens) - AI image generation

### Job Management
- [GET /jobs/:jobId](#get-jobsjobid) - Check job status
- [POST /jobs/:jobId/cancel](#post-jobsjobidcancel) - Cancel job
- [GET /queue/stats](#get-queuestats) - Queue statistics

### Admin & Monitoring
- [POST /admin/recover-workers](#post-adminrecover-workers) - Recover leaked workers
- [GET /admin/workers/status](#get-adminworkersstatus) - Worker diagnostics

### Health Checks
- [GET /](#get--root) - API information
- [GET /health](#get-health) - Orchestrator health
- [GET /runpod/audio/transcribe/health](#get-runpodaudiotranscribehealth) - Faster-Whisper health
- [GET /runpod/audio/transcribe-whisper/health](#get-runpodaudiotranscribe-whisperhealth) - OpenAI Whisper health

### Reference
- [Webhooks](#webhooks)
- [Error Codes](#error-codes)
- [TypeScript Types](#typescript-types)

---

## RunPod GPU Video Processing

All RunPod endpoints use GPU acceleration (NVENC) and are **asynchronous** (require webhook_url).

### POST /runpod/video/img2vid

Convert images to videos with Ken Burns cinematic zoom effects.

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/img2vid",
  "id_roteiro": 125,
  "images": [
    {
      "id": "beach-sunset",
      "image_url": "https://cdn.example.com/photo1.jpg",
      "duracao": 5.0
    },
    {
      "id": "ocean-waves",
      "image_url": "https://cdn.example.com/photo2.jpg",
      "duracao": 6.5
    }
  ],
  "path": "Projects/Summer2024/videos/",
  "zoom_types": ["zoomin", "zoomout", "zoompanright"]
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook_url` | string (URL) | ✅ | - | Callback URL for completion notification |
| `id_roteiro` | number | ❌ | - | Script ID for tracking |
| `images` | array | ✅ | - | Array of image objects (min: 1) |
| `images[].id` | string | ✅ | - | Unique identifier for image |
| `images[].image_url` | string (URL) | ✅ | - | Public image URL (JPG/PNG) |
| `images[].duracao` | number | ✅ | - | Video duration in seconds |
| `path` | string | ✅ | - | S3 upload prefix (e.g., "Project/Episode/videos/") |
| `zoom_types` | array | ❌ | `["zoomin"]` | Zoom effect types (see below) |

**Zoom Types:**
- `"zoomin"` - Focus effect: 0.8x → 1.2x scale (centered)
- `"zoomout"` - Pull-back effect: 1.2x → 0.8x scale (centered)
- `"zoompanright"` - Dynamic pan: 0.9x → 1.1x with horizontal right movement

Effects are distributed proportionally across images. Example: 10 images with `["zoomin", "zoomout"]` = 5 zoomin + 5 zoomout (random order).

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "operation": "img2vid",
  "idRoteiro": 125,
  "message": "Job queued successfully",
  "estimatedTime": "~1 minute",
  "queuePosition": 1,
  "statusUrl": "/jobs/550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-10-21T14:30:00.000Z",
  "workersReserved": 1
}
```

**Webhook Callback:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 125,
  "status": "COMPLETED",
  "operation": "img2vid",
  "processor": "GPU",
  "result": {
    "success": true,
    "message": "2 videos processed successfully",
    "videos": [
      {
        "id": "beach-sunset",
        "filename": "video_1.mp4",
        "video_url": "https://s3.example.com/Projects/Summer2024/videos/video_1.mp4",
        "zoom_type": "zoomin"
      },
      {
        "id": "ocean-waves",
        "filename": "video_2.mp4",
        "video_url": "https://s3.example.com/Projects/Summer2024/videos/video_2.mp4",
        "zoom_type": "zoomout"
      }
    ],
    "pathRaiz": "Projects/Summer2024/"
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

**Technical Details:**
- Upscale: 19200x10800 (10x intermediate for smooth motion)
- Output: 1920x1080 @ 24fps
- Codec: h264_nvenc preset p4, CQ 23 VBR
- Ken Burns zoom range: 1.0 → 1.25 (25% zoom)

---

### POST /runpod/video/caption_style

Unified endpoint for styled captions with GPU acceleration. Supports two modes:
- **`segments`** - Traditional subtitles (SRT → styled ASS)
- **`highlight`** - Word-by-word karaoke (JSON → 2-layer ASS)

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

#### Common Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhook_url` | string (URL) | ✅ | Callback URL |
| `id_roteiro` | number | ❌ | Script ID (optional tracking) |
| `url_video` | string (URL) | ✅ | Public video URL (MP4) |
| `url_caption` | string (URL) | ✅ | Caption file URL (SRT for segments, JSON for highlight) |
| `path` | string | ✅ | S3 upload prefix |
| `output_filename` | string | ✅ | Output filename (e.g., "video_final.mp4") |
| `type` | string | ✅ | Caption type: `"segments"` or `"highlight"` |
| `uppercase` | boolean | ❌ | `false` | Convert all text to uppercase |
| `style` | object | ❌ | Style customization (see type-specific schemas) |

---

#### Type: `segments` (Traditional Subtitles)

**Minimal Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/caption",
  "id_roteiro": 123,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/subtitles.srt",
  "path": "Channel/Video/final/",
  "output_filename": "video_with_subtitles.mp4",
  "type": "segments"
}
```

**Style Parameters (Optional):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `style.font.name` | string | `"Arial"` | Font name (e.g., "Roboto", "Open Sans") |
| `style.font.size` | number | `36` | Font size (20-200) |
| `style.font.bold` | boolean | `true` | Bold text |
| `style.colors.primary` | string | `"#FFFFFF"` | Text color (hex) |
| `style.colors.outline` | string | `"#000000"` | Border color (hex) |
| `style.border.style` | number | `1` | Border style: `1`=outline+shadow, `3`=opaque box, `4`=rounded box |
| `style.border.width` | number | `3` | Border width (0-10) |
| `style.position.alignment` | string | `"bottom_center"` | Position (see alignment values below) |
| `style.position.marginVertical` | number | `20` | Vertical margin in pixels (0-500) |

**Alignment Values:**
```
top_left       top_center       top_right
middle_left    middle_center    middle_right
bottom_left    bottom_center    bottom_right
```

**Custom Style Example:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/caption",
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/subtitles.srt",
  "path": "Channel/Video/final/",
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

#### Type: `highlight` (Karaoke Subtitles)

**Minimal Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/karaoke",
  "id_roteiro": 124,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/words.json",
  "path": "Channel/Video/karaoke/",
  "output_filename": "video_karaoke.mp4",
  "type": "highlight"
}
```

**Style Parameters (Optional):**

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `style.fonte` | string | `"Arial Black"` | Font name |
| `style.tamanho_fonte` | number | `72` | Font size (20-200) |
| `style.fundo_cor` | string | `"#000000"` | Background color (hex) |
| `style.fundo_opacidade` | number | `50` | Background opacity % (0-100) |
| `style.fundo_arredondado` | boolean | `true` | Rounded corners on background |
| `style.texto_cor` | string | `"#FFFFFF"` | Default text color (hex) |
| `style.highlight_texto_cor` | string | `"#FFFF00"` | Highlighted word text color (hex) |
| `style.highlight_cor` | string | `"#D60000"` | Highlighted word border color (hex) |
| `style.highlight_borda` | number | `12` | Highlight border width (1-50) |
| `style.padding_horizontal` | number | `40` | Horizontal padding (0-500) |
| `style.padding_vertical` | number | `80` | Vertical padding (0-500) |
| `style.position` | string | `"bottom_center"` | Position (same values as segments) |
| `style.words_per_line` | number | `4` | Words per line (1-10) |
| `style.max_lines` | number | `2` | Maximum lines per dialogue (1-5) |

**Words JSON Format (url_caption):**
```json
{
  "words": [
    { "word": "Era", "start": 0.0, "end": 0.35 },
    { "word": "uma", "start": 0.35, "end": 0.63 },
    { "word": "vez", "start": 0.63, "end": 0.93 }
  ]
}
```

**Custom Style Example:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/karaoke",
  "url_video": "https://cdn.example.com/video.mp4",
  "url_caption": "https://s3.example.com/words.json",
  "path": "Channel/Video/karaoke/",
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

---

### POST /runpod/video/addaudio

Add or replace audio track in video with GPU encoding.

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/addaudio",
  "id_roteiro": 126,
  "url_video": "https://cdn.example.com/video.mp4",
  "url_audio": "https://cdn.example.com/soundtrack.mp3",
  "path": "Channel/Video/final/",
  "output_filename": "video_with_audio.mp4"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhook_url` | string (URL) | ✅ | Callback URL |
| `id_roteiro` | number | ❌ | Script ID |
| `url_video` | string (URL) | ✅ | Video URL (MP4) |
| `url_audio` | string (URL) | ✅ | Audio URL (MP3, AAC, WAV) |
| `path` | string | ✅ | S3 upload prefix |
| `output_filename` | string | ✅ | Output filename |

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "message": "Job queued successfully",
  "createdAt": "2025-10-21T14:30:00.000Z"
}
```

---

### POST /runpod/video/concatenate

Merge multiple videos into a single file with GPU re-encoding.

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

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
  "path": "Channel/Video/final/",
  "output_filename": "complete_video.mp4"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhook_url` | string (URL) | ✅ | Callback URL |
| `id_roteiro` | number | ❌ | Script ID |
| `video_urls` | array | ✅ | Array of video objects (min: 2) |
| `video_urls[].video_url` | string (URL) | ✅ | Video URL (MP4) |
| `path` | string | ✅ | S3 upload prefix |
| `output_filename` | string | ✅ | Output filename |

---

### POST /runpod/video/concat_video_audio

Cycle videos repeatedly to match audio duration.

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/concat-audio",
  "id_roteiro": 128,
  "video_urls": [
    {"video_url": "https://cdn.example.com/clip1.mp4"},
    {"video_url": "https://cdn.example.com/clip2.mp4"}
  ],
  "url_audio": "https://cdn.example.com/long-soundtrack.mp3",
  "path": "Channel/Video/final/",
  "output_filename": "synced_video.mp4"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `webhook_url` | string (URL) | ✅ | Callback URL |
| `id_roteiro` | number | ❌ | Script ID |
| `video_urls` | array | ✅ | Array of video objects (will loop) |
| `video_urls[].video_url` | string (URL) | ✅ | Video URL |
| `url_audio` | string (URL) | ✅ | Audio URL |
| `path` | string | ✅ | S3 upload prefix |
| `output_filename` | string | ✅ | Output filename |

**Behavior:** Videos loop until audio duration is matched.

**Google Drive Support:** This endpoint supports Google Drive URLs in the `video_urls` array. URLs can be in the format:
- `https://drive.google.com/file/d/FILE_ID/view`
- The system automatically handles download of large files (>25MB) from Google Drive

**Additional Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `normalize` | boolean | ❌ | `true` | Normalize audio levels when mixing |

---

### POST /runpod/video/trilhasonora

Add background music (trilha sonora) to video with **automatic audio normalization** for optimal mixing.

**Authentication:** Required
**Type:** Asynchronous (202 Accepted)

**Request:**
```json
{
  "webhook_url": "https://n8n.example.com/webhook/trilha",
  "id_roteiro": 129,
  "url_video": "https://cdn.example.com/video.mp4",
  "trilha_sonora": "https://cdn.example.com/background-music.mp3",
  "path": "Channel/Video/final/",
  "output_filename": "video_with_music.mp4"
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `webhook_url` | string (URL) | ✅ | - | Callback URL |
| `id_roteiro` | number | ❌ | - | Script ID |
| `url_video` | string (URL) | ✅ | - | Video URL (MP4) |
| `trilha_sonora` | string (URL) | ✅ | - | Background music URL (MP3, AAC, WAV) |
| `path` | string | ✅ | - | S3 upload prefix |
| `output_filename` | string | ✅ | - | Output filename |
| `volume_reduction_db` | number | ❌ | auto | Manual volume reduction (0-40 dB). If omitted, auto-normalizes trilha to -20dB below video |

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "message": "Job queued successfully",
  "createdAt": "2025-10-21T14:30:00.000Z"
}
```

**Webhook Success Response:**
```json
{
  "video_url": "https://s3.amazonaws.com/.../video_with_music.mp4",
  "filename": "video_with_music.mp4",
  "s3_key": "Channel/Video/final/video_with_music.mp4",
  "video_duration": 120.5,
  "trilha_duration": 180.2,
  "loops_applied": 1,
  "volume_reduction_db": 20.4,
  "audio_analysis": {
    "video_mean_db": -19.5,
    "trilha_mean_db": -11.1,
    "trilha_final_db": -39.5,
    "target_offset_db": 20.0,
    "normalization_applied": true
  }
}
```

**Behavior:**
- **Auto-Normalization (Default):** Analyzes both audio tracks using FFmpeg volumedetect and automatically adjusts trilha to be exactly 20dB below video audio
- **Manual Mode:** If `volume_reduction_db` is provided, applies fixed reduction (bypasses auto-normalization)
- **Optimal Mixing:** -20dB offset ensures clear narration with subtle background music (professional standard for spoken content)
- **Looping:** Background music loops automatically if shorter than video duration
- **Professional Quality:** Follows EBU R128 loudness standards for broadcast-quality audio mixing

**Google Drive Support:** Both `url_video` and `trilha_sonora` support Google Drive URLs with automatic download handling for files >25MB.

**Example Results:**
- Video at -19.5 dB, Trilha at -11.1 dB → Auto-reduces trilha by 28.4 dB → Final: Video at -19.5 dB, Trilha at -39.5 dB (20 dB offset)
- Ensures consistent audio balance regardless of source material quality

---

## VPS CPU Video Processing

Same operations as RunPod but processed locally on VPS CPU (slower, no GPU acceleration).

### VPS Video Endpoints

All `/runpod/video/*` endpoints have equivalent `/vps/video/*` versions:
- `POST /vps/video/img2vid`
- `POST /vps/video/caption_style`
- `POST /vps/video/addaudio`
- `POST /vps/video/concatenate`
- `POST /vps/video/concat_video_audio`

Same request/response format, different operation suffix in webhook (`_vps`).

---

### POST /vps/video/transcribe_youtube

Extract YouTube auto-generated captions using Playwright browser automation.

**Authentication:** Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string (URL) | ✅ | YouTube video URL (youtube.com/watch?v=... or youtu.be/...) |

**Response (200 OK):**
```json
{
  "ok": true,
  "source": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "segments": [
    {
      "start": 0.0,
      "duration": 3.5,
      "text": "Never gonna give you up"
    },
    {
      "start": 3.5,
      "duration": 2.8,
      "text": "Never gonna let you down"
    }
  ],
  "segments_count": 42,
  "language": "en",
  "duration": 212.5,
  "cached": false,
  "execution_time_ms": 4523
}
```

**Error Response:**
```json
{
  "ok": false,
  "source": "https://www.youtube.com/watch?v=invalid",
  "error": "Failed to extract captions: Video not found",
  "execution_time_ms": 1250
}
```

**Features:**
- Extracts auto-generated captions from YouTube
- Caches results for improved performance
- Returns segments with precise timing
- Automatic language detection
- Works with standard YouTube URLs and youtu.be short URLs

---

## Audio Processing

### POST /runpod/audio/transcribe

Transcribe audio to text using Faster Whisper (GPU-accelerated) with automatic subtitle generation.

**Authentication:** Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "audio_url": "https://example.com/podcast-episode-01.mp3",
  "path": "Podcast/Season01/Episode01/",
  "model": "large-v3",
  "language": "pt",
  "enable_vad": true,
  "beam_size": 5,
  "temperature": 0
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `audio_url` | string (URL) | ✅ | - | Public audio URL (MP3, WAV, M4A, FLAC) |
| `path` | string | ✅ | - | S3 upload prefix |
| `model` | string | ❌ | `large-v3` | Whisper model (see table below) |
| `language` | string | ❌ | auto | ISO 639-1 code (`pt`, `en`, `es`, etc.) |
| `enable_vad` | boolean | ❌ | `true` | Voice Activity Detection (reduces hallucinations) |
| `beam_size` | number | ❌ | `5` | Beam search size (1-10, higher = better quality) |
| `temperature` | number | ❌ | `0` | Sampling temperature (0-1, 0 = deterministic) |

**Whisper Models:**

| Model | Parameters | Speed | Quality | VRAM | Best For |
|-------|-----------|-------|---------|------|----------|
| `tiny` | 39M | ⚡⚡⚡⚡⚡ ~10x | ⭐⭐ | 1GB | Quick drafts, testing |
| `base` | 74M | ⚡⚡⚡⚡ ~7x | ⭐⭐⭐ | 1GB | Fast transcription |
| `small` | 244M | ⚡⚡⚡ ~4x | ⭐⭐⭐⭐ | 2GB | Balanced speed/quality |
| `medium` | 769M | ⚡⚡ ~2x | ⭐⭐⭐⭐⭐ | 5GB | High quality |
| `large-v3` | 1550M | ⚡ 1x | ⭐⭐⭐⭐⭐ | 10GB | **Best accuracy + translation** |
| `turbo` | 809M | ⚡⚡⚡⚡⚡ ~8x | ⭐⭐⭐⭐⭐ | 6GB | **Speed + quality sweet spot** ⚠️ |

**Speed reference:** All speeds relative to `large` (1x baseline)

**⚠️ Turbo Limitation:** Cannot perform translation tasks (non-English speech → English text). For translation, use `large-v3`.

**Recommendations:**
- **Multilingual + Translation needed:** `large-v3` (supports all languages + translation)
- **Transcription only (any language):** `turbo` (8x faster, minimal quality loss)
- **Real-time/Low-latency:** `base` or `small` (sub-second processing)
- **Development/Testing:** `small` (good balance)

**Response (200 OK):**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "language": "pt",
  "transcription": "Era uma vez uma história incrível sobre...",
  "files": {
    "segments": {
      "srt": "https://s3.example.com/Podcast/Season01/Episode01/segments.srt",
      "json": "https://s3.example.com/Podcast/Season01/Episode01/segments.json"
    },
    "words": {
      "ass_karaoke": "https://s3.example.com/Podcast/Season01/Episode01/karaoke.ass",
      "json": "https://s3.example.com/Podcast/Season01/Episode01/words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-21T12:00:00.000Z",
    "endTime": "2025-10-21T12:02:30.000Z",
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

**Generated Files:**
1. **segments.srt** - Traditional SubRip subtitles (phrase-level timing)
2. **karaoke.ass** - Advanced SubStation Alpha with word-by-word timing
3. **words.json** - Raw timestamp data for custom processing
4. **segments.json** - Segment metadata with confidence scores

**Performance (large-v3):**
- 1 min audio: ~5-10s
- 10 min audio: ~30-60s
- 60 min audio: ~3-5 min

---

### POST /runpod/audio/transcribe-whisper

Transcribe audio to text using OpenAI Whisper Official model (GPU-accelerated) with automatic subtitle generation.

**Authentication:** Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "audio_url": "https://example.com/podcast-episode-01.mp3",
  "path": "Podcast/Season01/Episode01/",
  "model": "base",
  "language": "pt",
  "beam_size": 5,
  "temperature": 0.0
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `audio_url` | string (URL) | ✅ | - | Public audio URL (MP3, WAV, M4A, FLAC) |
| `path` | string | ✅ | - | S3 upload prefix |
| `model` | string | ❌ | `base` | Whisper model (see table below) |
| `language` | string | ❌ | auto | ISO 639-1 code (`pt`, `en`, `es`, etc.) |
| `beam_size` | number | ❌ | `5` | Beam search size (1-10, higher = better quality) |
| `temperature` | number | ❌ | `0.0` | Sampling temperature (0-1, 0 = deterministic) |

**OpenAI Whisper Official Models:**

| Model | Parameters | Speed | Quality | VRAM | Best For |
|-------|-----------|-------|---------|------|----------|
| `tiny` | 39M | ⚡⚡⚡⚡⚡ | ⭐⭐ | 1GB | Quick drafts, testing |
| `base` | 74M | ⚡⚡⚡⚡ | ⭐⭐⭐ | 1GB | **Default - Fast transcription** |
| `small` | 244M | ⚡⚡⚡ | ⭐⭐⭐⭐ | 2GB | Balanced speed/quality |
| `medium` | 769M | ⚡⚡ | ⭐⭐⭐⭐⭐ | 5GB | High quality |
| `large` | 1550M | ⚡ | ⭐⭐⭐⭐⭐ | 10GB | Best accuracy + translation |

**Differences from Faster-Whisper:**
- Official OpenAI implementation (not CTranslate2)
- No VAD (Voice Activity Detection) option
- Model names: `tiny`, `base`, `small`, `medium`, `large` (no `large-v3` or `turbo`)
- Generally slower but more accurate for translation tasks
- Better multilingual support

**Response (200 OK):**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "language": "pt",
  "transcription": "Era uma vez uma história incrível sobre...",
  "files": {
    "segments": {
      "srt": "https://s3.example.com/Podcast/Season01/Episode01/segments.srt",
      "vtt": "",
      "json": "https://s3.example.com/Podcast/Season01/Episode01/segments.json"
    },
    "words": {
      "ass_karaoke": "https://s3.example.com/Podcast/Season01/Episode01/karaoke.ass",
      "vtt_karaoke": "",
      "lrc": "",
      "json": "https://s3.example.com/Podcast/Season01/Episode01/words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-21T12:00:00.000Z",
    "endTime": "2025-10-21T12:02:30.000Z",
    "durationMs": 150000,
    "durationSeconds": 150
  },
  "stats": {
    "segments": 42,
    "words": 256,
    "model": "base",
    "device": "cuda"
  }
}
```

**When to Use:**
- **Faster-Whisper (`/transcribe`)**: Best for speed, large-v3 and turbo models, VAD support
- **OpenAI Whisper (`/transcribe-whisper`)**: Official implementation, better for research/comparison

---

### POST /vps/audio/concatenate

Merge multiple audio files into a single file.

**Authentication:** NOT Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "audio_urls": [
    {"audio_url": "https://cdn.example.com/intro.mp3"},
    {"audio_url": "https://cdn.example.com/main.mp3"},
    {"audio_url": "https://cdn.example.com/outro.mp3"}
  ],
  "path": "Podcast/Season01/Episode01/",
  "output_filename": "full_episode.mp3"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `audio_urls` | array | ✅ | Array of audio objects (min: 2) |
| `audio_urls[].audio_url` | string (URL) | ✅ | Audio URL (MP3, AAC, WAV) |
| `path` | string | ✅ | S3 upload prefix |
| `output_filename` | string | ✅ | Output filename |

**Response (200 OK):**
```json
{
  "success": true,
  "message": "3 audio files concatenated successfully",
  "audio_url": "https://s3.example.com/Podcast/Season01/Episode01/full_episode.mp3",
  "filename": "full_episode.mp3",
  "duration": "45:32",
  "processing_time_ms": 2400
}
```

---

### POST /vps/audio/trilhasonora

Mix audio with background music (trilha sonora) with **automatic volume normalization** based on audio analysis.

**Authentication:** NOT Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "audio_url": "https://cdn.example.com/narration.mp3",
  "trilha_sonora": "https://cdn.example.com/background-music.mp3",
  "path": "Podcast/Season01/Episode01/",
  "output_filename": "episode_with_music.mp3",
  "db_offset": 30
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `audio_url` | string (URL) | ✅ | - | Main audio URL (MP3, AAC, WAV, HTTP/HTTPS/Google Drive) |
| `trilha_sonora` | string (URL) | ✅ | - | Background music URL (MP3, AAC, WAV, HTTP/HTTPS/Google Drive) |
| `path` | string | ✅ | - | S3 upload prefix (e.g., "Channel/Video/audios/") |
| `output_filename` | string | ❌ | `"audio_with_trilha.mp3"` | Output filename |
| `db_offset` | number | ❌ | `30` | Target dB difference between audio and trilha (0-50) |

**Response (200 OK):**
```json
{
  "success": true,
  "audio_url": "https://s3.example.com/Podcast/Season01/Episode01/episode_with_music.mp3",
  "filename": "episode_with_music.mp3",
  "s3_key": "Podcast/Season01/Episode01/episode_with_music.mp3",
  "audio_duration": 1800.5,
  "trilha_duration": 180.2,
  "loops_applied": 10,
  "volume_reduction_db": 35.2,
  "processing_time_ms": 8542,
  "message": "Audio mixed with trilha sonora (10 loops, -35.2dB)"
}
```

**How it Works:**

1. **Audio Analysis:** Uses FFmpeg `volumedetect` to measure mean volume of both tracks
2. **Smart Volume Calculation:** Automatically calculates reduction needed to keep trilha exactly `db_offset` dB below main audio
3. **Looping:** Background music automatically loops to match main audio duration (including partial loops)
4. **Mixing:** FFmpeg mixes both tracks with calculated volume reduction applied

**Formula:**
```
volumeReduction = trilhaVolume - audioVolume + dbOffset
```

**Example:**
```
Main audio:        -15 dB (analyzed)
Trilha sonora:     -10 dB (analyzed)
db_offset:          30 dB (parameter)
───────────────────────────────────
Reduction needed:   35 dB

Result:
Main audio:        -15 dB (unchanged)
Trilha (mixed):    -45 dB (reduced by 35 dB)
Difference:         30 dB ✓ (exactly as requested)
```

**Looping Behavior:**
```
Audio duration:     60s
Trilha duration:    25s
Loops needed:       3 (ceil(60/25))
───────────────────────────────────
Trilha looped:      [25s][25s][10s] = 60s (cut to match)
Final output:       60s (exactly matches audio duration)
```

**Features:**
- ✅ Automatic volume normalization based on audio analysis
- ✅ Smart looping with automatic trimming
- ✅ Google Drive support for both audio inputs
- ✅ Professional audio mixing using FFmpeg
- ✅ Handles URLs with spaces (automatic encoding)
- ✅ Output always matches main audio duration exactly

**Google Drive Support:**
- Supports direct download from Google Drive URLs
- Handles large files (>25MB) with confirmation tokens
- Accepts various Google Drive URL formats

**Use Cases:**
- Add background music to podcasts
- Mix narration with ambient soundtracks
- Create professional audio content with music beds
- Automated audio production workflows

**Technical Details:**
- Codec: MP3 (libmp3lame)
- Bitrate: 192 kbps
- Sample rate: 44.1 kHz (preserved from source)
- Channels: Stereo (preserved from source)
- Filter chain: `aloop → volume → amix duration=first`

---

### GET /vps/audio/health

Health check for audio processing service.

**Authentication:** NOT Required

**Response:**
```json
{
  "status": "healthy",
  "service": "VPS Audio Processor",
  "ffmpeg": "available",
  "timestamp": "2025-10-21T12:00:00.000Z"
}
```

**Unhealthy Response (503):**
```json
{
  "status": "unhealthy",
  "service": "VPS Audio Processor",
  "ffmpeg": "unavailable",
  "timestamp": "2025-10-21T12:00:00.000Z"
}
```

---

## Image Generation

### POST /vps/imagem/gerarPrompts

Generate AI image prompts using OpenRouter LLM (Google Gemini).

**Authentication:** Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "tema": "cyberpunk city at night",
  "quantidade": 5,
  "estilo": "photorealistic"
}
```

**Response:**
```json
{
  "success": true,
  "prompts": [
    "Neon-lit cyberpunk city street at night with rain-soaked pavement...",
    "Futuristic megacity skyline with holographic advertisements...",
    "Dark alley in cyberpunk metropolis with steam vents...",
    "Aerial view of sprawling cyberpunk city at twilight...",
    "Underground market in dystopian neon city..."
  ]
}
```

---

### POST /vps/imagem/gerarImagens

Generate AI images using Runware WebSocket API.

**Authentication:** Required
**Type:** Synchronous (200 OK)

**Request:**
```json
{
  "prompts": [
    "Neon-lit cyberpunk city street at night",
    "Futuristic megacity skyline"
  ],
  "negative_prompt": "blurry, low quality",
  "width": 1024,
  "height": 1024,
  "model": "stable-diffusion-xl"
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `prompts` | array | ✅ | - | Array of prompt strings |
| `negative_prompt` | string | ❌ | `""` | What to avoid in images |
| `width` | number | ❌ | `1024` | Image width (512-2048) |
| `height` | number | ❌ | `1024` | Image height (512-2048) |
| `model` | string | ❌ | `"stable-diffusion-xl"` | AI model name |

**Response:**
```json
{
  "success": true,
  "images": [
    {
      "url": "https://runware-cdn.com/image1.png",
      "prompt": "Neon-lit cyberpunk city street at night"
    },
    {
      "url": "https://runware-cdn.com/image2.png",
      "prompt": "Futuristic megacity skyline"
    }
  ]
}
```

---

## Job Management

### GET /jobs/:jobId

Check status of queued or running job.

**Authentication:** Required

**Response:**
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "PROCESSING",
  "operation": "img2vid",
  "idRoteiro": 125,
  "createdAt": "2025-10-21T12:00:00.000Z",
  "startedAt": "2025-10-21T12:00:05.000Z",
  "progress": {
    "completed": 5,
    "total": 10,
    "percentage": 50
  }
}
```

**Status Values:**
- `QUEUED` - Waiting in queue for worker
- `SUBMITTED` - Submitted to RunPod
- `PROCESSING` - Currently processing
- `COMPLETED` - Finished successfully
- `FAILED` - Failed with error
- `CANCELLED` - Cancelled by user

---

### POST /jobs/:jobId/cancel

Cancel a queued or running job.

**Authentication:** Required

**Response:**
```json
{
  "message": "Job cancelled successfully",
  "jobId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Note:** Only `QUEUED` and `SUBMITTED` jobs can be cancelled.

---

### GET /queue/stats

Get queue and worker statistics.

**Authentication:** Required

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
  "availableWorkers": 0
}
```

---

## Admin & Monitoring

### POST /admin/recover-workers

Manually trigger worker recovery system to release leaked workers from interrupted jobs.

**Authentication:** Required

**Response:**
```json
{
  "message": "Worker recovery initiated",
  "recoveredWorkers": 2,
  "failedJobs": ["job-id-1", "job-id-2"]
}
```

---

### GET /admin/workers/status

Get detailed diagnostic information about workers and active jobs.

**Authentication:** Required

**Response:**
```json
{
  "summary": {
    "activeWorkers": 3,
    "availableWorkers": 0,
    "totalJobs": 53,
    "activeJobs": 3
  },
  "activeJobs": [
    {
      "jobId": "550e8400-e29b-41d4-a716-446655440000",
      "status": "PROCESSING",
      "operation": "img2vid",
      "createdAt": "2025-10-21T12:00:00.000Z",
      "runningFor": "2m 30s"
    }
  ],
  "queueStats": {
    "queued": 2,
    "submitted": 1,
    "processing": 3
  }
}
```

---

## Health Checks

### GET / (Root)

API information endpoint (no authentication required).

**Response:**
```json
{
  "service": "AutoDark API GPU",
  "version": "4.0.0",
  "status": "operational",
  "timestamp": "2025-10-21T12:00:00.000Z",
  "features": [
    "GPU Video Processing (RunPod)",
    "CPU Video Processing (VPS)",
    "Audio Transcription (Faster-Whisper & OpenAI Whisper)",
    "Image Generation (AI)",
    "YouTube Caption Extraction",
    "Queue Management",
    "Webhook Notifications"
  ],
  "endpoints": {
    "documentation": "/docs/API.md",
    "health": "/health",
    "queue_stats": "/queue/stats"
  }
}
```

---

### GET /health

Orchestrator general health check (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-10-21T12:00:00.000Z",
  "uptime": 3600,
  "queue": {
    "queued": 2,
    "processing": 3,
    "completed": 45,
    "failed": 2,
    "activeWorkers": 3,
    "availableWorkers": 0
  }
}
```

---

### GET /runpod/audio/transcribe/health

Faster-Whisper transcription service health check (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "service": "transcription",
  "whisper": {
    "healthy": true,
    "endpoint": "82jjrwujznxwvn"
  },
  "timestamp": "2025-10-21T12:00:00.000Z"
}
```

---

### GET /runpod/audio/transcribe-whisper/health

OpenAI Whisper Official transcription service health check (no authentication required).

**Response:**
```json
{
  "status": "healthy",
  "service": "transcription-whisper-official",
  "whisper": {
    "healthy": true,
    "endpoint": "whisper_endpoint_id"
  },
  "timestamp": "2025-10-21T12:00:00.000Z"
}
```

---

## Webhooks

All asynchronous endpoints (`/runpod/video/*`, `/vps/video/*`) send POST callbacks when processing completes.

### Webhook Payload (Success)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 123,
  "status": "COMPLETED",
  "operation": "caption_segments",
  "processor": "GPU",
  "result": {
    "success": true,
    "video_url": "https://s3.example.com/Channel/Video/final/video.mp4",
    "filename": "video.mp4",
    "s3_key": "Channel/Video/final/video.mp4",
    "pathRaiz": "Channel/Video/",
    "message": "Video with segments subtitles completed successfully"
  },
  "execution": {
    "startTime": "2025-10-21T12:00:05.000Z",
    "endTime": "2025-10-21T12:02:30.000Z",
    "durationMs": 145000,
    "durationSeconds": 145
  },
  "timestamp": "2025-10-21T12:02:30.123Z"
}
```

### Webhook Payload (Error)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 123,
  "status": "FAILED",
  "operation": "caption_segments",
  "processor": "GPU",
  "error": {
    "code": "PROCESSING_ERROR",
    "message": "FFmpeg encoding failed: Invalid video format"
  },
  "execution": {
    "startTime": "2025-10-21T12:00:05.000Z",
    "endTime": "2025-10-21T12:00:45.000Z",
    "durationMs": 40000,
    "durationSeconds": 40
  },
  "timestamp": "2025-10-21T12:00:45.234Z"
}
```

### Webhook Security

The system validates webhook URLs with SSRF protection:
- ❌ Localhost (`localhost`, `127.0.0.1`, `::1`)
- ❌ Private IPs (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
- ✅ Public HTTP/HTTPS URLs only

Optional HMAC signature verification available via `WEBHOOK_SECRET` environment variable.

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | OK (synchronous success) |
| 202 | Accepted (async job queued) |
| 400 | Bad Request (validation error) |
| 401 | Unauthorized (missing or invalid API key) |
| 404 | Not Found (job not found) |
| 429 | Too Many Requests (rate limit exceeded) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (RunPod offline) |
| 504 | Gateway Timeout |

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
  workersReserved?: number;
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

interface CaptionStyleRequest {
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

interface Img2VidRequest {
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

interface AddAudioRequest {
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

interface ConcatenateRequest {
  webhook_url: string;
  id_roteiro?: number;
  video_urls: Array<{ video_url: string }>;
  path: string;
  output_filename: string;
}

// ============================================
// Concatenate Video + Audio
// ============================================

interface ConcatVideoAudioRequest {
  webhook_url: string;
  id_roteiro?: number;
  video_urls: Array<{ video_url: string }>;
  url_audio: string;
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
  processor?: 'GPU' | 'CPU';
  result?: {
    success: boolean;
    video_url?: string;
    videos?: Array<{
      id: string;
      video_url: string;
      filename: string;
      zoom_type?: string;
    }>;
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
  timestamp: string;
}
```

---

## Rate Limits & Timeouts

**Queue Management:**
- Maximum concurrent workers: 3 (configurable via `QUEUE_MAX_WORKERS`)
- Queue controlled by available workers, not rate limits

**Timeouts:**
- Express server timeout: 35 minutes
- RunPod execution timeout: 40 minutes
- Polling max duration: 32 minutes (240 attempts × 8s)

**Worker Recovery:**
- Automatic recovery runs every 5 minutes
- Releases workers from jobs stuck in PROCESSING > timeout

---

## Changelog

### v4.1.1 (Current - 2025-10-24)
- ✅ **NEW:** Added `/vps/audio/trilhasonora` - Mix audio with background music (CPU-based)
- ✅ **IMPROVED:** Simplified trilha sonora mixing to use single `db_offset` parameter
- ✅ **FIXED:** Corrected FFmpeg aloop bug (now uses `loop=N-1` instead of `loop=N`)
- ✅ **ENHANCED:** Automatic volume normalization based on analyzed audio levels
- ✅ **FEATURE:** Smart looping with automatic trimming to match audio duration
- ✅ **FEATURE:** Google Drive support for both audio inputs (handles files >25MB)
- ✅ Complete documentation for `/vps/audio/trilhasonora` endpoint

### v4.1.0 (2025-10-23)
- ✅ **NEW:** Added `/runpod/audio/transcribe-whisper` - OpenAI Whisper Official endpoint
- ✅ **NEW:** Added `/runpod/video/trilhasonora` - Background music with volume reduction
- ✅ **NEW:** Added `GET /` root endpoint with API information
- ✅ **UPDATED:** `/vps/video/transcribe_youtube` now accepts single `url` parameter
- ✅ **FEATURE:** Google Drive support in `concat_video_audio` endpoint (files >25MB)
- ✅ **FEATURE:** Added `uppercase` parameter to `caption_style` endpoint
- ✅ **FEATURE:** Added `normalize` parameter to `concat_video_audio` endpoint
- ✅ Enhanced health checks for both Whisper implementations
- ✅ Complete documentation update with all 30+ endpoints

### v4.0.0
- ✅ Consolidated API documentation
- ✅ Updated endpoint prefixes: `/runpod/*` and `/vps/*`
- ✅ Added VPS local processing endpoints
- ✅ Enhanced webhook payload with `processor` field
- ✅ Added `/vps/audio/concatenate` endpoint
- ✅ Added `/vps/imagem/*` AI generation endpoints

### v3.0.0
- Unified `/runpod/video/caption_style` endpoint (segments + highlight)
- New `highlight_texto_cor` parameter for highlighted word text color
- Queue system with async webhooks
- `pathRaiz` support in all callbacks

### v2.x
- Caption style with dual modes
- GPU Whisper transcription

### v1.x
- Initial release with basic endpoints

---

## Support & Links

- **Documentation:** [docs/](../docs/)
- **Issues:** https://github.com/your-org/api-gpu/issues
- **RunPod:** https://runpod.io/
- **FFmpeg:** https://ffmpeg.org/

---

**Last Updated:** 2025-10-24
**API Version:** 4.1.1
