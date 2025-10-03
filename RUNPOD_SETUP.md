# RunPod Serverless Infrastructure

## 🚀 Current Setup (2025-01-03)

### Endpoint Details
- **Endpoint ID**: `ntuho7h2y5ahzs`
- **Name**: `api-gpu-worker`
- **API URL**: `https://api.runpod.ai/v2/ntuho7h2y5ahzs`

### Template Details
- **Template ID**: `c1f3mgt3rl`
- **Name**: `api-gpu-worker-v1`
- **Docker Image**: `oreiasccp/api-gpu-worker:latest`
- **Docker Args**: `python -u rp_handler.py`
- **Container Disk**: 10GB
- **Serverless**: Yes
- **HTTP Port**: 8000

### Configuration
- **Workers Min**: 0 (auto-scale to zero)
- **Workers Max**: 3
- **GPUs**: AMPERE_16, AMPERE_24, NVIDIA RTX A4000
- **Scaler Type**: QUEUE_DELAY
- **Scaler Value**: 3 seconds

### Environment Variables
```bash
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=3
HTTP_PORT=8000
```

---

## 📋 Supported Operations

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

### Test Job (2025-01-03)
```bash
curl -X POST "https://api.runpod.ai/v2/ntuho7h2y5ahzs/run" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "operation": "img2vid",
      "frame_rate": 30,
      "images": [{
        "id": "test-corrected",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 2.0
      }]
    }
  }'
```

**Result:**
- ✅ Status: COMPLETED
- ⏱️ Delay Time: 6.05s (cold start)
- ⚡ Execution Time: 1.76s
- 📹 Output: `https://6nvhqj8mhus84i-8000.proxy.runpod.net/test-corrected_video.mp4`

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
        endpointId: \"ntuho7h2y5ahzs\",
        templateId: \"c1f3mgt3rl\"
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
curl "https://api.runpod.ai/v2/ntuho7h2y5ahzs/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

### Check Job Status
```bash
curl "https://api.runpod.ai/v2/ntuho7h2y5ahzs/status/{job_id}" \
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
RUNPOD_ENDPOINT_ID=ntuho7h2y5ahzs
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=600
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
