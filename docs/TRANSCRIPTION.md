# Transcription API Documentation

## Endpoint: POST /transcribe

Audio transcription using RunPod's faster-whisper worker with automatic subtitle generation.

### Features

- **GPU-accelerated transcription** using OpenAI Whisper models
- **Automatic file generation**: SRT segments, ASS karaoke, JSON
- **Automatic S3/MinIO upload** with public URLs
- **Word-level timestamps** for karaoke subtitles
- **Voice Activity Detection (VAD)** for improved accuracy

---

## Request

### URL
```
POST http://your-domain:3000/transcribe
```

### Headers
```
Content-Type: application/json
X-API-Key: your-api-key
```

### Payload

```json
{
  "audio_url": "https://example.com/audio.mp3",
  "path": "transcriptions/job-uuid/",
  "model": "large-v3",
  "language": "pt",
  "enable_vad": true,
  "beam_size": 5,
  "temperature": 0
}
```

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `audio_url` | string | ✅ Yes | - | Public URL of audio file to transcribe |
| `path` | string | ✅ Yes | - | S3 path for file uploads (e.g., "transcriptions/job-123/") |
| `model` | string | ❌ No | `large-v3` | Whisper model: `tiny`, `base`, `small`, `medium`, `large-v1`, `large-v2`, `large-v3`, `turbo` |
| `language` | string | ❌ No | auto-detect | ISO language code (e.g., `pt`, `en`, `es`) |
| `enable_vad` | boolean | ❌ No | `true` | Enable Voice Activity Detection |
| `beam_size` | number | ❌ No | `5` | Beam size for decoding (1-10) |
| `temperature` | number | ❌ No | `0` | Sampling temperature (0.0-1.0) |

---

## Response

### Success Response (200 OK)

```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "8d316bdb-0b50-4ccc-8619-5103767f0df6",
  "language": "pt",
  "transcription": "Este é o texto completo da transcrição...",
  "files": {
    "segments": {
      "srt": "https://minio.example.com/canais/transcriptions/job-123/segments.srt",
      "vtt": "",
      "json": "https://minio.example.com/canais/transcriptions/job-123/words.json"
    },
    "words": {
      "ass_karaoke": "https://minio.example.com/canais/transcriptions/job-123/karaoke.ass",
      "vtt_karaoke": "",
      "lrc": "",
      "json": "https://minio.example.com/canais/transcriptions/job-123/words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-07T12:00:00.000Z",
    "endTime": "2025-10-07T12:01:45.000Z",
    "durationMs": 105000,
    "durationSeconds": 105.0
  },
  "stats": {
    "segments": 42,
    "words": 287,
    "model": "large-v3",
    "device": "cuda"
  }
}
```

### Error Response (500 Internal Server Error)

```json
{
  "error": "Transcription failed",
  "message": "RunPod API error: Connection timeout",
  "job_id": "8d316bdb-0b50-4ccc-8619-5103767f0df6",
  "execution": {
    "startTime": "2025-10-07T12:00:00.000Z",
    "endTime": "2025-10-07T12:05:00.000Z",
    "durationMs": 300000,
    "durationSeconds": 300.0
  }
}
```

---

## Generated Files

### 1. Segments SRT (`segments.srt`)
Traditional subtitle format with phrase-level timing.

**Use case:** Video subtitles for traditional players

**Example:**
```srt
1
00:00:00,000 --> 00:00:03,500
Este é o primeiro segmento da transcrição.

2
00:00:03,500 --> 00:00:07,200
E este é o segundo segmento com mais texto.
```

### 2. ASS Karaoke (`karaoke.ass`)
Advanced SubStation Alpha format with word-level karaoke timing.

**Use case:** Karaoke-style subtitles with word highlighting

**Example:**
```ass
[Script Info]
Title: Karaoke Subtitles
ScriptType: v4.00+

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, ...
Style: Karaoke,Arial,48,&H00FFFFFF,&H000088EF,...

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:03.50,Karaoke,,0,0,0,,{\k50}Este {\k40}é {\k60}o {\k45}primeiro
```

### 3. Words JSON (`words.json`)
Word-level timestamps in JSON format.

**Use case:** Programmatic access, custom subtitle editors

**Example:**
```json
{
  "words": [
    { "word": "Este", "start": 0.12, "end": 0.58 },
    { "word": "é", "start": 0.62, "end": 0.78 },
    { "word": "o", "start": 0.82, "end": 0.95 }
  ],
  "metadata": {
    "language": "pt",
    "model": "large-v3",
    "device": "cuda"
  }
}
```

---

## Health Check

### Endpoint: GET /transcribe/health

Check transcription service health status.

**Request:**
```bash
curl http://localhost:3000/transcribe/health
```

**Response (200 OK):**
```json
{
  "status": "healthy",
  "service": "transcription",
  "whisper": {
    "healthy": true,
    "message": "RunPod Whisper endpoint is healthy: {...}"
  },
  "timestamp": "2025-10-07T12:00:00.000Z"
}
```

---

## Configuration

### Environment Variables (.env)

```bash
# RunPod Whisper Endpoint
RUNPOD_API_KEY=rpa_xxxxxxxxxxxxxxxxxxxxx
RUNPOD_WHISPER_ENDPOINT_ID=your-endpoint-id

# S3/MinIO Configuration
S3_ENDPOINT_URL=https://minio.example.com
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET_NAME=canais
S3_REGION=us-east-1

# Polling Configuration
POLLING_MAX_ATTEMPTS=240
```

### Deploy RunPod Faster-Whisper Endpoint

1. Go to [RunPod Hub - Faster Whisper](https://console.runpod.io/hub/runpod-workers/worker-faster_whisper)
2. Click "Deploy" and configure:
   - **Workers Min:** 0 (auto-scale from zero)
   - **Workers Max:** 3-5 (based on expected load)
   - **GPU Type:** AMPERE_16, AMPERE_24, or RTX A4000
   - **Scaler:** Queue Delay (3-5 seconds)
3. Copy the **Endpoint ID** to `RUNPOD_WHISPER_ENDPOINT_ID` in `.env`

---

## Usage Examples

### Basic Transcription

```bash
curl -X POST http://localhost:3000/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "audio_url": "https://example.com/audio.mp3",
    "path": "transcriptions/video-123/"
  }'
```

### With Custom Model and Language

```bash
curl -X POST http://localhost:3000/transcribe \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key-here" \
  -d '{
    "audio_url": "https://example.com/audio.mp3",
    "path": "transcriptions/video-123/",
    "model": "turbo",
    "language": "en",
    "enable_vad": true
  }'
```

---

## Integration with /caption Endpoint

The generated files can be used with the `/video/caption` endpoint for adding subtitles to videos:

### Using SRT Segments (Traditional Subtitles)

```bash
curl -X POST http://localhost:3000/video/caption \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://minio.example.com/canais/transcriptions/job-123/segments.srt",
    "path": "videos/final/",
    "output_filename": "video_with_subtitles.mp4"
  }'
```

### Using ASS Karaoke (Word-Level Highlighting)

```bash
curl -X POST http://localhost:3000/video/caption \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://minio.example.com/canais/transcriptions/job-123/karaoke.ass",
    "path": "videos/final/",
    "output_filename": "video_with_karaoke.mp4"
  }'
```

---

## Model Comparison

| Model | Speed | Quality | RAM | Best For |
|-------|-------|---------|-----|----------|
| `tiny` | ⚡⚡⚡⚡⚡ | ⭐⭐ | 1GB | Quick drafts, testing |
| `base` | ⚡⚡⚡⚡ | ⭐⭐⭐ | 1GB | Fast transcription |
| `small` | ⚡⚡⚡ | ⭐⭐⭐⭐ | 2GB | Balanced speed/quality |
| `medium` | ⚡⚡ | ⭐⭐⭐⭐⭐ | 5GB | High quality |
| `large-v1/v2` | ⚡ | ⭐⭐⭐⭐⭐ | 10GB | Best quality |
| `large-v3` | ⚡ | ⭐⭐⭐⭐⭐ | 10GB | Latest, best accuracy |
| `turbo` | ⚡⚡⚡⚡ | ⭐⭐⭐⭐⭐ | 6GB | Fastest high-quality |

**Recommendation:** Use `large-v3` for production, `turbo` for speed-sensitive applications.

---

## Architecture

```
Client Request
     ↓
VPS Orchestrator (/transcribe)
     ↓
RunPod Faster-Whisper Worker
     ↓ (JSON response)
Local File Generation
  - segments.srt
  - karaoke.ass
  - words.json
     ↓
S3/MinIO Upload
     ↓
Return Public URLs
```

### Why This Architecture?

- **Orchestrator abstraction:** User-friendly API that hides RunPod complexity
- **Local file generation:** Full control over output formats
- **S3 integration:** Persistent storage with public access
- **Scalability:** RunPod auto-scales workers based on queue
- **Cost efficiency:** Pay-per-second GPU usage, zero idle costs

---

## Troubleshooting

### Error: "RUNPOD_WHISPER_ENDPOINT_ID not configured"

**Solution:** Deploy the faster-whisper endpoint and add the ID to `.env`:
```bash
RUNPOD_WHISPER_ENDPOINT_ID=your-endpoint-id
```

### Error: "S3 upload failed"

**Solution:** Check S3/MinIO credentials in `.env`:
```bash
S3_ENDPOINT_URL=https://minio.example.com
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
```

### Error: "Transcription timed out"

**Solution:** Increase polling attempts or use a smaller model:
```bash
POLLING_MAX_ATTEMPTS=240  # 32 minutes max
```

Or use a faster model:
```json
{ "model": "turbo" }
```

---

## Performance Benchmarks

| Audio Duration | Model | GPU | Processing Time | Cost (approx) |
|----------------|-------|-----|-----------------|---------------|
| 5 min | turbo | A4000 | ~30s | $0.02 |
| 15 min | large-v3 | A4000 | ~2 min | $0.08 |
| 30 min | large-v3 | A4000 | ~4 min | $0.16 |
| 60 min | large-v3 | A4000 | ~8 min | $0.32 |

**Note:** Times include transcription + file generation + S3 upload. Actual costs depend on RunPod pricing.
