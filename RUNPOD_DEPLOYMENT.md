# RunPod Deployment Information

## Current Deployment (v2.11.0 - Fixed)

### Template
- **ID**: `dk7hpyp91k`
- **Name**: `api-gpu-worker-concatenate`
- **Image**: `oreiasccp/api-gpu-worker:latest`
- **Docker Args**: `python -u rp_handler.py`

### Endpoint
- **ID**: `602eqftho5lspy`
- **Name**: `api-gpu-worker`
- **Workers**: 0-3 (auto-scaling)
- **GPUs**: AMPERE_16, AMPERE_24, NVIDIA RTX A4000
- **Scaler**: QUEUE_DELAY (3 seconds)

### Environment Variables
```bash
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=3
HTTP_PORT=8000
```

### Supported Operations
- ✅ `img2vid` - Convert images to videos with zoom effects
- ✅ `caption` - Add SRT subtitles to video
- ✅ `addaudio` - Synchronize audio with video
- ✅ `caption_segments` - Add styled segment captions
- ✅ `caption_highlight` - Add word-level highlight captions
- ✅ `concatenate` - Merge multiple videos (NEW in v2.11.0)

## Deployment History

### v2.11.0 - Fixed (2025-10-13)
- **Added**: Video concatenation endpoint
- **Template ID**: `dk7hpyp91k`
- **Endpoint ID**: `602eqftho5lspy`
- **Image**: `oreiasccp/api-gpu-worker:latest`
- **Changes**:
  - Fixed Docker image push to Docker Hub
  - Rebuilt and pushed image with :latest tag
  - Deleted broken endpoint and template
  - Created new template and endpoint with working image
  - Added concatenate_videos() function with GPU support
  - FFmpeg concat demuxer with re-encoding
  - S3 upload and cleanup

### v2.11.0 - Initial (FAILED)
- **Template ID**: `prhkhioqqx` (DELETED)
- **Endpoint ID**: `qkx02frwvtymg5` (DELETED)
- **Image**: `oreiasccp/api-gpu-worker:v2.11.0` (NOT PUSHED)
- **Issue**: Image tag v2.11.0 was not pushed to Docker Hub

### v2.10.1 (Previous)
- **Template ID**: `0gacidtu54` (DELETED)
- **Endpoint ID**: `l8ji2h9yog70qi` (DELETED)
- **Image**: `oreiasccp/api-gpu-worker:v2.10.0`

## Build and Deploy

### 1. Build Docker Image
```bash
docker build -f docker/worker-python.Dockerfile \
  -t oreiasccp/api-gpu-worker:latest .
```

Or use the automated script:
```bash
./build-and-push.sh           # Linux/Mac
.\build-and-push.ps1          # Windows
```

### 2. Push to Docker Hub
```bash
docker push oreiasccp/api-gpu-worker:latest
```

### 3. Create Template
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveTemplate(input: { name: \"api-gpu-worker-concatenate\", imageName: \"oreiasccp/api-gpu-worker:latest\", dockerArgs: \"python -u rp_handler.py\", containerDiskInGb: 10, volumeInGb: 0, isServerless: true, env: [{key: \"WORK_DIR\", value: \"/tmp/work\"}, {key: \"OUTPUT_DIR\", value: \"/tmp/output\"}, {key: \"BATCH_SIZE\", value: \"3\"}, {key: \"HTTP_PORT\", value: \"8000\"}] }) { id name } }"
  }'
```

### 4. Create Endpoint
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveEndpoint(input: { name: \"api-gpu-worker\", templateId: \"dk7hpyp91k\", workersMin: 0, workersMax: 3, gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\", scalerType: \"QUEUE_DELAY\", scalerValue: 3 }) { id name } }"
  }'
```

## Testing

### Health Check
```bash
curl "https://api.runpod.ai/v2/602eqftho5lspy/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

### Test Concatenate Operation
```bash
curl -X POST "https://api.runpod.ai/v2/602eqftho5lspy/run" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "input": {
      "operation": "concatenate",
      "video_urls": [
        {"video_url": "https://example.com/video1.mp4"},
        {"video_url": "https://example.com/video2.mp4"}
      ],
      "path": "test/videos/",
      "output_filename": "concatenated.mp4"
    }
  }'
```

## Configuration

### Update Orchestrator .env
```bash
RUNPOD_ENDPOINT_ID=602eqftho5lspy
RUNPOD_API_KEY=your-api-key-here
```

### RunPod API Key
Get your API key from: https://runpod.io/console/user/settings

## Monitoring

- **RunPod Console**: https://runpod.io/console/serverless
- **Endpoint Dashboard**: https://runpod.io/console/serverless/602eqftho5lspy
- **Template Dashboard**: https://runpod.io/console/templates/dk7hpyp91k

## Notes

- Image uses `:latest` tag for easier updates
- Old broken template `prhkhioqqx` (v2.11.0 - not pushed) was replaced
- Old broken endpoint `qkx02frwvtymg5` was deleted
- Current deployment uses `:latest` with concatenate support
- Auto-scaling: 0-3 workers based on queue depth
- GPU preference: AMPERE_16, AMPERE_24, NVIDIA RTX A4000
- Worker initializes on-demand (cold start ~30-60s)
