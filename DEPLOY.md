# Deployment Guide - API GPU

## Overview

This system consists of two main components:
1. **Orchestrator (VPS)**: Receives requests, manages RunPod jobs, serves videos
2. **GPU Worker (RunPod Serverless)**: Processes videos on-demand with NVENC

## Architecture

```
Client
  ↓
Orchestrator (api-gpu.automear.com)
  ↓
RunPod Serverless (igu3si167qepok)
  ↓
GPU Worker (processes videos)
  ↓ (if batch > 10)
  └→ Uploads to Orchestrator /upload/video
  ↓ (if batch ≤ 10)
  └→ Returns base64 in response
```

## Payload Size Solution

**Problem**: 100 videos as base64 = ~67MB, exceeds RunPod response limit (413 error)

**Solution**: Hybrid approach
- **Small batches (≤10 images)**: Return base64 (fast, simple)
- **Large batches (>10 images)**: Upload directly to VPS (avoids payload limit)

## Deployment Steps

### 1. Deploy Orchestrator to VPS

The orchestrator Docker image is already built: `oreiasccp/api-gpu-orchestrator:latest`

**Deploy to Easypanel/VPS:**

```yaml
services:
  orchestrator:
    image: oreiasccp/api-gpu-orchestrator:latest
    ports:
      - "3000:3000"
    environment:
      PORT: 3000
      NODE_ENV: production
      X_API_KEY: your-api-key-here
      RUNPOD_API_KEY: your-runpod-api-key
      RUNPOD_ENDPOINT_ID: your-endpoint-id
      RUNPOD_IDLE_TIMEOUT: 300
      RUNPOD_MAX_TIMEOUT: 600
      LOG_LEVEL: info
      CORS_ALLOW_ORIGINS: "*"
      RATE_LIMIT_WINDOW_MS: 900000
      RATE_LIMIT_MAX_REQUESTS: 20
    volumes:
      - ./logs:/app/logs
      - ./public/output:/app/public/output
    restart: unless-stopped
```

**Or via Docker CLI:**

```bash
docker run -d \
  --name api-gpu-orchestrator \
  -p 3000:3000 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e X_API_KEY=your-api-key-here \
  -e RUNPOD_API_KEY=your-runpod-api-key \
  -e RUNPOD_ENDPOINT_ID=your-endpoint-id \
  -e RUNPOD_IDLE_TIMEOUT=300 \
  -e RUNPOD_MAX_TIMEOUT=600 \
  -v ./logs:/app/logs \
  -v ./public/output:/app/public/output \
  --restart unless-stopped \
  oreiasccp/api-gpu-orchestrator:latest
```

**Setup domain:** Point `api-gpu.automear.com` to the VPS

### 2. GPU Worker (Already Deployed)

The GPU worker is already configured on RunPod:

- **Endpoint ID**: `igu3si167qepok`
- **Template ID**: `6mfyfphqas` (api-gpu-worker-v4)
- **Image**: `oreiasccp/api-gpu-worker:latest`
- **GPUs**: AMPERE_16, AMPERE_24, NVIDIA RTX A4000
- **Workers**: 0-3 (auto-scale)
- **Scaler**: QUEUE_DELAY (3s)

**Environment Variables:**
```
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=3
UPLOAD_THRESHOLD=10
VPS_UPLOAD_URL=https://api-gpu.automear.com/upload/video
VPS_API_KEY=api-gpu-2025-secure-key-change-me
```

### 3. Verify Deployment

**Health Check:**
```bash
curl https://api-gpu.automear.com/health
```

**Test Small Batch (5 images, base64 response):**
```bash
curl -X POST https://api-gpu.automear.com/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: api-gpu-2025-secure-key-change-me" \
  -d '{
    "images": [
      {"id": "test-1", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0},
      {"id": "test-2", "image_url": "https://picsum.photos/1920/1080", "duracao": 2.0}
    ]
  }'
```

**Test Large Batch (15 images, VPS upload):**
```bash
python test-15-images.py
```

## API Endpoints

### POST /video/img2vid
Convert images to videos with Ken Burns effect

**Headers:**
- `X-API-Key`: `api-gpu-2025-secure-key-change-me`
- `Content-Type`: `application/json`

**Request:**
```json
{
  "images": [
    {
      "id": "unique-id",
      "image_url": "https://example.com/image.jpg",
      "duracao": 3.0
    }
  ]
}
```

**Response (small batch ≤10):**
```json
{
  "code": 200,
  "message": "Images converted to videos successfully",
  "videos": [
    {
      "id": "unique-id",
      "video_url": "/output/unique-id_1234567890.mp4"
    }
  ],
  "execution": {
    "startTime": "2025-10-02T15:00:00.000Z",
    "endTime": "2025-10-02T15:00:25.000Z",
    "durationMs": 25000,
    "durationSeconds": 25.0
  },
  "stats": {
    "jobId": "abc123",
    "total": 5,
    "processed": 5
  }
}
```

**Response (large batch >10):**
Same format, but videos uploaded directly to VPS during processing

### POST /video/caption
Add SRT captions to video

### POST /video/addaudio
Add audio track to video

### GET /health
Health check

### GET /runpod/health
Check RunPod endpoint status

## Monitoring

**View Logs:**
```bash
docker logs -f api-gpu-orchestrator
```

**RunPod Logs:**
https://www.runpod.io/console/serverless/user/endpoints/igu3si167qepok/logs

**Metrics:**
- Videos auto-delete after 1 hour
- Cleanup runs every 15 minutes
- Check disk usage: `df -h`

## Troubleshooting

### Payload Too Large Error
- ✅ Fixed: Large batches now upload directly to VPS
- Threshold: 10 images (configurable via `UPLOAD_THRESHOLD`)

### VPS Upload Failing
- Check VPS is running: `curl https://api-gpu.automear.com/health`
- Check API key matches in both orchestrator and worker
- Check logs: `docker logs api-gpu-orchestrator`

### Videos Not Accessible
- Check static file serving: `curl https://api-gpu.automear.com/output/test.mp4`
- Check volume mount: `docker exec api-gpu-orchestrator ls /app/public/output`

### RunPod Worker Not Starting
- Check GPU availability in RunPod dashboard
- Check template configuration
- Increase `workersMax` if needed

## Cost Optimization

**Current Configuration:**
- 0 idle workers (no cost when idle)
- Auto-scale 0-3 workers
- ~$0.40-0.80/hour when active
- Videos deleted after 1 hour (saves storage)

**To reduce costs:**
- Decrease `workersMax` to 1-2
- Increase `scalerValue` (queue delay)
- Use cheaper GPU types

## Security Notes

**API Keys:**
- Change default API key in production
- Rotate keys periodically
- Use HTTPS only

**Rate Limiting:**
- 20 requests per 15 minutes (default)
- Adjust via `RATE_LIMIT_*` env vars

**CORS:**
- Default: `*` (allow all origins)
- Restrict in production: `CORS_ALLOW_ORIGINS=https://yourdomain.com`
