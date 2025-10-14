# VPS Endpoint Fix - Deployment Guide

## Changes Applied

### 1. Dockerfile
- ✅ Added FFmpeg to system dependencies
- ✅ Created work directories (`/tmp/vps-work`, `/tmp/vps-output`)
- ✅ Set proper permissions (777) on work directories

### 2. .env
- ✅ Added `S3_LOCAL_URL=https://minio.automear.com`

## Deploy to VPS

### Quick Deploy (5 minutes)

```bash
# 1. SSH to VPS
ssh root@185.173.110.7

# 2. Navigate to project
cd /root/api-gpu

# 3. Pull latest code
git pull

# 4. If using Docker, rebuild image
docker build -t api-gpu-orchestrator:latest .
docker restart api-gpu-orchestrator

# 5. If using PM2 (Node.js directly)
npm run build:orchestrator
pm2 restart api-gpu-orchestrator
```

### Detailed Steps

#### Option A: Docker Deployment

```bash
# 1. Stop current container
docker stop api-gpu-orchestrator

# 2. Remove old container (optional)
docker rm api-gpu-orchestrator

# 3. Rebuild image with new Dockerfile
docker build -t api-gpu-orchestrator:latest .

# 4. Run new container
docker run -d \
  --name api-gpu-orchestrator \
  --env-file .env \
  -p 3000:3000 \
  --restart unless-stopped \
  api-gpu-orchestrator:latest

# 5. Check logs
docker logs -f api-gpu-orchestrator
```

#### Option B: PM2 Deployment (if not using Docker)

```bash
# 1. Rebuild TypeScript
npm run build:orchestrator

# 2. Restart PM2 process
pm2 restart api-gpu-orchestrator

# 3. Check logs
pm2 logs api-gpu-orchestrator
```

### Verify Deployment

#### 1. Check FFmpeg Installation

```bash
# If using Docker
docker exec -it api-gpu-orchestrator ffmpeg -version

# If using PM2
ffmpeg -version
```

**Expected Output**:
```
ffmpeg version 6.x
configuration: ...
```

#### 2. Check Work Directories

```bash
# If using Docker
docker exec -it api-gpu-orchestrator ls -la /tmp/ | grep vps

# If using PM2
ls -la /tmp/ | grep vps
```

**Expected Output**:
```
drwxrwxrwx    2 root     root          4096 Jan 15 10:00 vps-output
drwxrwxrwx    2 root     root          4096 Jan 15 10:00 vps-work
```

#### 3. Check Environment Variables

```bash
# If using Docker
docker exec -it api-gpu-orchestrator printenv | grep S3

# If using PM2
pm2 env 0 | grep S3
```

**Expected Output**:
```
S3_ENDPOINT_URL=https://minio.automear.com
S3_LOCAL_URL=https://minio.automear.com
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET_NAME=canais
```

#### 4. Check Service Health

```bash
curl http://localhost:3000/health
```

**Expected Output**:
```json
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "uptime": 123.45,
  "queue": {
    "queued": 0,
    "processing": 0,
    "completed": 10,
    "failed": 0
  }
}
```

## Test VPS Endpoint

### From Local Machine

```bash
# Run the complete flow test
node test-vps-full-flow.js
```

**Expected Output**:
```
✅ POST SUCCESSFUL!
{
  "jobId": "...",
  "status": "QUEUED",
  "queuePosition": 1
}

⏳ Waiting for webhook...

🔔 WEBHOOK RECEIVED!
✅ JOB COMPLETED SUCCESSFULLY!

📹 VIDEOS GENERATED:
  • Video 1: https://minio.automear.com/canais/.../video.mp4
  • Video 2: https://minio.automear.com/canais/.../video.mp4
  • Video 3: https://minio.automear.com/canais/.../video.mp4

⏱️  EXECUTION TIME:
  Duration: 15.2s
  Worker: LocalWorkerService
  Codec: libx264
```

### Direct API Test

```bash
curl -X POST http://185.173.110.7:3000/vps/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: api-gpu-2025-secure-key-change-me" \
  -d '{
    "webhook_url": "https://your-webhook.com/callback",
    "id_roteiro": 41,
    "path": "Mr. Nightmare/Test/videos/temp/",
    "images": [
      {
        "id": "1",
        "image_url": "https://minio.automear.com/canais/test/image.jpg",
        "duracao": 3.0
      }
    ]
  }'
```

## Troubleshooting

### If FFmpeg Not Found

```bash
# Docker: Install FFmpeg manually
docker exec -it api-gpu-orchestrator apk add ffmpeg

# PM2: Install on host
apt-get update && apt-get install -y ffmpeg
```

### If S3 Upload Fails

Check environment variables:
```bash
docker exec -it api-gpu-orchestrator printenv | grep S3
```

Add missing variables:
```bash
docker exec -it api-gpu-orchestrator \
  sh -c 'export S3_LOCAL_URL=https://minio.automear.com && npm start'
```

### If Permission Denied on /tmp

```bash
# Docker: Fix permissions
docker exec -it api-gpu-orchestrator chmod 777 /tmp/vps-work /tmp/vps-output

# PM2: Fix permissions
chmod 777 /tmp/vps-work /tmp/vps-output
```

### Check Logs

```bash
# Docker
docker logs -f --tail 100 api-gpu-orchestrator

# PM2
pm2 logs api-gpu-orchestrator --lines 100
```

## Important Notes

### 1. Update Payloads to Use Public URLs

**Before** (won't work from VPS):
```json
"image_url": "http://minio:9000/canais/..."
```

**After** (will work):
```json
"image_url": "https://minio.automear.com/canais/..."
```

### 2. Docker Network (if using internal URLs)

If you want to use `http://minio:9000` URLs, add orchestrator to MinIO network:

```bash
# Find MinIO network
docker network ls | grep minio

# Connect orchestrator
docker network connect minio-network api-gpu-orchestrator
```

### 3. Monitor First Job

Watch logs during first job execution:
```bash
# Docker
docker logs -f api-gpu-orchestrator | grep -E "VPS|LocalWorker|img2vid_vps"

# PM2
pm2 logs api-gpu-orchestrator | grep -E "VPS|LocalWorker|img2vid_vps"
```

## Success Indicators

✅ FFmpeg version shown
✅ Work directories exist with 777 permissions
✅ S3_LOCAL_URL defined in environment
✅ Health endpoint returns 200
✅ Test job completes successfully
✅ Webhook received with status: COMPLETED
✅ Videos uploaded to MinIO

## Next Steps After Deployment

1. ✅ Test with 1 image (quick validation)
2. ✅ Test with 3 images (normal workload)
3. ✅ Test with 10+ images (stress test)
4. ✅ Test concurrent requests (2-3 simultaneous jobs)
5. ✅ Monitor CPU usage and processing time
6. ✅ Update N8N workflows to use VPS endpoints
7. ✅ Set up alerts for failed jobs

## Rollback (if needed)

```bash
# 1. Get previous commit hash
git log --oneline -5

# 2. Revert to previous version
git reset --hard <previous-commit-hash>

# 3. Rebuild/Restart
docker build -t api-gpu-orchestrator:latest . && docker restart api-gpu-orchestrator
# OR
npm run build:orchestrator && pm2 restart api-gpu-orchestrator
```

## Support

If issues persist after deployment:

1. Check `VPS-ENDPOINT-ROOT-CAUSE-ANALYSIS.md` for detailed explanation
2. Run diagnostic scripts in repository
3. Collect logs and share for analysis
