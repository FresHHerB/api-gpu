# RunPod Deployment Information

## Current Deployment (v2.11.0)

### Template
- **ID**: `prhkhioqqx`
- **Name**: `api-gpu-worker-v2.11`
- **Image**: `oreiasccp/api-gpu-worker:v2.11.0`
- **Docker Args**: `python -u rp_handler.py`

### Endpoint
- **ID**: `qkx02frwvtymg5`
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

### v2.11.0 (2025-10-13)
- **Added**: Video concatenation endpoint
- **Template ID**: `prhkhioqqx`
- **Endpoint ID**: `qkx02frwvtymg5`
- **Image**: `oreiasccp/api-gpu-worker:v2.11.0`
- **Changes**:
  - Added concatenate_videos() function with GPU support
  - FFmpeg concat demuxer with re-encoding
  - S3 upload and cleanup

### v2.10.1 (Previous)
- **Template ID**: `0gacidtu54` (DELETED)
- **Endpoint ID**: `l8ji2h9yog70qi` (DELETED)
- **Image**: `oreiasccp/api-gpu-worker:v2.10.0`

## Build and Deploy

### 1. Build Docker Image
```bash
docker build -f docker/worker-python.Dockerfile \
  -t oreiasccp/api-gpu-worker:latest \
  -t oreiasccp/api-gpu-worker:v2.11.0 .
```

### 2. Push to Docker Hub
```bash
docker push oreiasccp/api-gpu-worker:latest
docker push oreiasccp/api-gpu-worker:v2.11.0
```

### 3. Create Template
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveTemplate(input: { name: \"api-gpu-worker-v2.11\", imageName: \"oreiasccp/api-gpu-worker:v2.11.0\", dockerArgs: \"python -u rp_handler.py\", containerDiskInGb: 10, volumeInGb: 0, isServerless: true, env: [{key: \"WORK_DIR\", value: \"/tmp/work\"}, {key: \"OUTPUT_DIR\", value: \"/tmp/output\"}, {key: \"BATCH_SIZE\", value: \"3\"}, {key: \"HTTP_PORT\", value: \"8000\"}] }) { id name } }"
  }'
```

### 4. Create Endpoint
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveEndpoint(input: { name: \"api-gpu-worker\", templateId: \"prhkhioqqx\", workersMin: 0, workersMax: 3, gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\", scalerType: \"QUEUE_DELAY\", scalerValue: 3 }) { id name } }"
  }'
```

## Testing

### Health Check
```bash
curl "https://api.runpod.ai/v2/qkx02frwvtymg5/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
```

### Test Concatenate Operation
```bash
curl -X POST "https://api.runpod.ai/v2/qkx02frwvtymg5/run" \
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
RUNPOD_ENDPOINT_ID=qkx02frwvtymg5
RUNPOD_API_KEY=your-api-key-here
```

### RunPod API Key
Get your API key from: https://runpod.io/console/user/settings

## Monitoring

- **RunPod Console**: https://runpod.io/console/serverless
- **Endpoint Dashboard**: https://runpod.io/console/serverless/qkx02frwvtymg5
- **Template Dashboard**: https://runpod.io/console/templates/prhkhioqqx

## Notes

- Old template `0gacidtu54` (v2.10) was replaced
- Old endpoint `l8ji2h9yog70qi` was deleted
- New deployment uses v2.11.0 with concatenate support
- Auto-scaling: 0-3 workers based on queue depth
- GPU preference: AMPERE_16, AMPERE_24, NVIDIA RTX A4000
