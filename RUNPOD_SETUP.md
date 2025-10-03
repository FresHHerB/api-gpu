# RunPod Serverless Infrastructure

## 🚀 Current Setup (2025-01-03 - Production Ready)

### Endpoint Details
- **Endpoint ID**: `1j30rstqhtt86u`
- **Name**: `api-gpu-worker`
- **API URL**: `https://api.runpod.ai/v2/1j30rstqhtt86u`

### Template Details
- **Template ID**: `cbs92eapla`
- **Name**: `api-gpu-worker-production`
- **Docker Image**: `oreiasccp/api-gpu-worker:latest` (digest: df3877f10c76...)
- **Docker Args**: `python -u rp_handler.py`
- **Container Disk**: 15GB
- **Serverless**: Yes
- **HTTP Port**: 8000

### Configuration
- **Workers Min**: 0 (auto-scale to zero)
- **Workers Max**: 4
- **GPUs**: Multi-GPU support (high availability)
  - Primary: NVIDIA RTX A4500 (20GB VRAM, 12 vCPU, 62GB RAM)
  - Fallback: NVIDIA RTX A4000, AMPERE_16, AMPERE_24
- **Scaler Type**: QUEUE_DELAY
- **Scaler Value**: 3 seconds

### Environment Variables
```bash
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=5  # Optimized for 12 vCPU
HTTP_PORT=8000
```

---

## 📋 Supported Operations

### Batch Processing
- **Batch Size**: 5 images per batch (optimized for RTX A4500 12 vCPU)
- **Processing Mode**: Sequential batches (not parallel-all)
- Example: 15 images = 3 sequential batches [1-5], [6-10], [11-15]
- Each batch completes fully before next batch starts

### Multi-Worker Strategy (Large Batches)
- **Threshold**: >50 images automatically triggers multi-worker
- **Distribution**: Splits across 3 workers in parallel
- **Example 200 images**: 3 jobs × 67 images each = ~2 min (vs 6 min single worker)
- **Example 300 images**: 3 jobs × 100 images each = ~3 min (vs 9 min single worker)

### Performance Optimizations
- **hwaccel_output_format cuda**: Keeps frames in GPU memory (30-50% faster)
- **Polling timeout**: 60 attempts max (~8 min), 2s initial delay
- **Server timeout**: 10 minutes (aligned with job timeouts)
- **Resource monitoring**: Logs vCPU and RAM usage on startup

### 1. Caption (add_caption)
Adds subtitles to video using FFmpeg with GPU NVENC encoding.

**Input:**
```json
{
  "operation": "caption",
  "url_video": "https://example.com/video.mp4",
  "url_srt": "https://example.com/subtitles.srt"
}
```

**FFmpeg Settings:**
- GPU acceleration: CUDA hwaccel + h264_nvenc
- Quality: VBR mode with CQ 23
- Preset: p4 (balanced)
- Tune: hq (high quality)

### 2. Image to Video (img2vid)
Converts images to video with Ken Burns zoom effect.

**Input:**
```json
{
  "operation": "img2vid",
  "frame_rate": 30,
  "images": [
    {
      "id": "image1",
      "image_url": "https://example.com/image.jpg",
      "duracao": 3.0
    }
  ]
}
```

**Zoom Effect:**
- Upscale: 6x (11520x6480) to prevent jitter
- Zoom range: 1.0 → 1.324 (32.4% zoom in)
- Scaling: Lanczos (high quality)
- Output: 1920x1080 @ variable fps

### 3. Add Audio (addaudio)
Adds audio to video with automatic duration synchronization.

**Input:**
```json
{
  "operation": "addaudio",
  "url_video": "https://example.com/video.mp4",
  "url_audio": "https://example.com/audio.mp3"
}
```

**Duration Sync:**
- Extracts video and audio durations via ffprobe
- Calculates speed adjustment factor
- Uses setpts filter to sync video to audio length
- GPU encoding with h264_nvenc VBR

---

## 🧪 Test Results

### Test Job 1: img2vid (2025-01-03)
```bash
curl -X POST "https://api.runpod.ai/v2/1j30rstqhtt86u/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "operation": "img2vid",
      "frame_rate": 30,
      "images": [
        {"id": "img001", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img002", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img003", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img004", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img005", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img006", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img007", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img008", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img009", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
        {"id": "img010", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0}
      ]
    }
  }'
```

**Result:**
- ✅ Status: COMPLETED
- ⏱️ Delay Time: 49.1s (cold start)
- ⚡ Execution Time: 9.2s (~0.9s per image)
- 📦 Batches: 2 (BATCH_SIZE=5: [1-5], [6-10])
- 📹 Output: 10/10 videos successfully processed
- 🖥️ Worker ID: chotnbf9yfward

### Test Job 2: caption (2025-01-03)
```bash
curl -X POST "https://api.runpod.ai/v2/1j30rstqhtt86u/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "operation": "caption",
      "url_video": "http://minio.automear.com/canais/video.mp4",
      "url_srt": "https://minio.automear.com/canais/subtitles.srt"
    }
  }'
```

**Result:**
- ✅ Status: COMPLETED
- ⏱️ Delay Time: 37.5s (cold start)
- ⚡ Execution Time: 137s (~2min 17s for 33min video)
- 📹 Output: Captioned video with GPU NVENC encoding
- 🖥️ Worker ID: rsow1t3deak2sx
- ⚙️ Note: Uses `-hwaccel cuda` (GPU decode) without `-hwaccel_output_format cuda` (incompatible with subtitles filter)

---

## 🔧 How to Update Worker

### 1. Update Python Code
Edit `src/worker-python/rp_handler.py`

### 2. Rebuild Docker Image
```bash
docker build --no-cache -f docker/worker-python.Dockerfile -t oreiasccp/api-gpu-worker:latest .
```

### 3. Push to Docker Hub
```bash
docker push oreiasccp/api-gpu-worker:latest
```

### 4. Force RunPod to Pull New Image
RunPod will automatically pull the latest image on next cold start. To force update:
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "mutation {
      updateEndpointTemplate(input: {
        endpointId: \"1j30rstqhtt86u\",
        templateId: \"cbs92eapla\"
      }) {
        id name templateId
      }
    }"
  }'
```

---

## 📊 Monitoring

### Check Endpoint Health
```bash
curl "https://api.runpod.ai/v2/1j30rstqhtt86u/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

### Check Job Status
```bash
curl "https://api.runpod.ai/v2/1j30rstqhtt86u/status/{job_id}" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

---

## 🏗️ Architecture

```
┌─────────────────┐
│   Client App    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Orchestrator   │  (VPS - Easypanel)
│  (Express API)  │  - Receives requests
└────────┬────────┘  - Manages jobs
         │           - Downloads videos
         ▼
┌─────────────────┐
│  RunPod Proxy   │  (RunPod API)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  GPU Worker     │  (Serverless)
│  (Python)       │  - Processes video
│                 │  - Serves via HTTP
└────────┬────────┘  - Auto-scales
         │
         ▼
┌─────────────────┐
│  Video Output   │  (Temporary HTTP)
│  (Worker:8000)  │  - Served via proxy
└─────────────────┘  - Downloaded by VPS
```

---

## 🔐 Environment Setup

Add to `.env`:
```bash
RUNPOD_API_KEY=your_runpod_api_key_here
RUNPOD_ENDPOINT_ID=1j30rstqhtt86u
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=480
```

---

## 🐛 Troubleshooting

### Worker not starting
- Check Docker image exists: `docker pull oreiasccp/api-gpu-worker:latest`
- Verify GPU availability in RunPod
- Check template configuration

### Videos returning 404
- Worker shuts down after job completion
- VPS must download immediately after receiving URL
- Current implementation downloads during job polling

### Slow cold starts
- First request triggers worker initialization (~6s)
- Subsequent requests use warm workers (<2s)
- Adjust `scalerValue` to keep workers alive longer

---

## 📝 Notes

- Workers auto-scale to zero when idle
- Max 3 concurrent workers
- HTTP port 8000 for video serving
- Videos accessible via RunPod proxy: `https://{worker_id}-8000.proxy.runpod.net/`
- VPS downloads videos immediately after processing
