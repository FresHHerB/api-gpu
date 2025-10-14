# Root Cause Analysis: VPS Endpoint Failures

## Executive Summary

The VPS endpoints (`/vps/video/*`) are failing with "VPS_PROCESSING_ERROR" due to **3 critical missing dependencies** in the Docker configuration:

1. ❌ **FFmpeg is NOT installed** in the Docker image
2. ❌ **S3_LOCAL_URL environment variable is missing**
3. ❌ **Work directories are not created**

## Critical Findings

### 1. FFmpeg Not Installed (HIGHEST PRIORITY)

**Location**: `Dockerfile` lines 13-15

**Current Code**:
```dockerfile
RUN apk add --no-cache \
    curl \
    git
```

**Problem**:
- `LocalVideoProcessor` spawns FFmpeg commands (line 86: `spawn('ffmpeg', args)`)
- FFmpeg is used in ALL VPS operations:
  - `img2vid_vps`: Ken Burns effect, video encoding
  - `addaudio_vps`: Audio mixing
  - `concatenate_vps`: Video concatenation
  - `caption_segments_vps`: SRT subtitle burning
  - `caption_highlight_vps`: Karaoke subtitles

**Error Result**:
```
Error: spawn ffmpeg ENOENT
Code: ENOENT
```

**Evidence**:
- Line 86 in `localVideoProcessor.ts`: `const ffmpeg = spawn('ffmpeg', args);`
- Lines 136, 202, 263, 329, 392: Multiple FFmpeg operations

**Fix**:
```dockerfile
RUN apk add --no-cache \
    curl \
    git \
    ffmpeg
```

---

### 2. S3_LOCAL_URL Environment Variable Missing

**Location**: `.env` file (lines 52-57)

**Current Configuration**:
```env
S3_ENDPOINT_URL=https://minio.automear.com
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
```

**Missing**:
```env
S3_LOCAL_URL=https://minio.automear.com  # <-- MISSING!
```

**Problem**:
`LocalS3UploadService` constructor requires `S3_LOCAL_URL`:

```typescript
// src/orchestrator/services/localS3Upload.ts:14
const localEndpoint = process.env.S3_LOCAL_URL;

if (!localEndpoint || !accessKeyId || !secretAccessKey) {
  throw new Error('Local S3 configuration missing: S3_LOCAL_URL, S3_ACCESS_KEY, or S3_SECRET_KEY');
}
```

**Error Result**:
```
Error: Local S3 configuration missing: S3_LOCAL_URL, S3_ACCESS_KEY, or S3_SECRET_KEY
```

**Impact**:
- LocalVideoProcessor cannot upload processed videos to MinIO
- Jobs fail AFTER processing (wasted CPU time)
- No videos are saved

**Fix Options**:

**Option A: Use Public URL** (RECOMMENDED if VPS is outside Docker network)
```env
S3_LOCAL_URL=https://minio.automear.com
```

**Option B: Use Docker Internal URL** (if VPS orchestrator is in same Docker network as MinIO)
```env
S3_LOCAL_URL=http://minio:9000
```

**Option C: Use Private IP** (if MinIO has private IP accessible from VPS)
```env
S3_LOCAL_URL=http://192.168.1.100:9000
```

---

### 3. Work Directories Not Created

**Location**: `Dockerfile` line 38

**Current Code**:
```dockerfile
RUN mkdir -p /app/logs
```

**Missing**:
```dockerfile
RUN mkdir -p /tmp/vps-work /tmp/vps-output
```

**Problem**:
`LocalVideoProcessor` constructor (line 19-21):
```typescript
this.workDir = '/tmp/vps-work';
this.outputDir = '/tmp/vps-output';
```

**Error Result**:
```
Error: ENOENT: no such file or directory, open '/tmp/vps-work/...'
```

**Fix**:
```dockerfile
# Create directories
RUN mkdir -p /app/logs /tmp/vps-work /tmp/vps-output && \
    chmod 777 /tmp/vps-work /tmp/vps-output
```

---

## Comparison: GPU vs VPS Endpoints

| Aspect | GPU Endpoints | VPS Endpoints |
|--------|--------------|---------------|
| **Processing** | RunPod workers (separate containers) | LocalVideoProcessor (same container) |
| **FFmpeg** | Installed in worker Docker image | ❌ NOT installed in orchestrator image |
| **Work Dirs** | Created in worker container | ❌ NOT created in orchestrator image |
| **S3 Upload** | Worker has env vars | ❌ Missing S3_LOCAL_URL |
| **Queue Handling** | QueueManager → RunPod | LocalWorkerService → LocalVideoProcessor |
| **Isolation** | Fully isolated workers | Runs in orchestrator process |

**Key Difference**:
- GPU endpoints send jobs to **separate worker containers** that have FFmpeg installed
- VPS endpoints process jobs **in the orchestrator container** which lacks FFmpeg

---

## Docker Internal URL Issue (Secondary)

**User's Payload Contains**:
```json
{
  "images": [
    {
      "image_url": "http://minio:9000/canais/..."
    }
  ]
}
```

**Problem**:
- `minio:9000` is a Docker internal hostname
- Only resolvable inside Docker network where MinIO container runs
- VPS orchestrator may be running on host or in different network

**Evidence**:
User confirmed: "Nota-se que nem mesmo a url interna minio:9000 esta funcionando"

**Solutions**:

1. **Use Public URLs in Payloads** (RECOMMENDED):
   ```json
   "image_url": "https://minio.automear.com/canais/..."
   ```

2. **Add Orchestrator to Same Docker Network**:
   ```bash
   docker network connect minio-network api-gpu-orchestrator
   ```

3. **Map Internal Hostname** (if not in Docker):
   ```bash
   echo "192.168.1.100 minio" >> /etc/hosts
   ```

---

## Complete Fix Checklist

### Step 1: Update Dockerfile

**File**: `Dockerfile`

**Changes**:
```dockerfile
# Instalar dependências do sistema
RUN apk add --no-cache \
    curl \
    git \
    ffmpeg  # <-- ADD THIS

# Criar diretórios
RUN mkdir -p /app/logs /tmp/vps-work /tmp/vps-output && \
    chmod 777 /tmp/vps-work /tmp/vps-output  # <-- ADD THIS
```

### Step 2: Update .env

**File**: `.env`

**Add**:
```env
# ============================================
# S3/MinIO Configuration (Worker Upload)
# ============================================

S3_ENDPOINT_URL=https://minio.automear.com
S3_LOCAL_URL=https://minio.automear.com  # <-- ADD THIS
S3_ACCESS_KEY=admin
S3_SECRET_KEY=password
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
```

### Step 3: Rebuild and Deploy

```bash
# 1. Commit changes
git add Dockerfile .env
git commit -m "fix: add FFmpeg and S3_LOCAL_URL for VPS endpoints"
git push

# 2. SSH to VPS
ssh root@185.173.110.7

# 3. Pull latest code
cd /root/api-gpu
git pull

# 4. Rebuild Docker image
docker build -t api-gpu-orchestrator:latest .

# 5. Restart container (or PM2 if not using Docker)
docker restart api-gpu-orchestrator
# OR
pm2 restart api-gpu-orchestrator
```

### Step 4: Update Payloads to Use Public URLs

**Before**:
```json
{
  "image_url": "http://minio:9000/canais/..."
}
```

**After**:
```json
{
  "image_url": "https://minio.automear.com/canais/..."
}
```

---

## Testing After Fix

### Test 1: Verify FFmpeg Installation

```bash
# Inside container
docker exec -it api-gpu-orchestrator ffmpeg -version
# Should show FFmpeg version, not "command not found"
```

### Test 2: Verify Work Directories

```bash
# Inside container
docker exec -it api-gpu-orchestrator ls -la /tmp/
# Should show vps-work and vps-output directories
```

### Test 3: Verify Environment Variables

```bash
# Inside container
docker exec -it api-gpu-orchestrator printenv | grep S3
# Should show:
# S3_ENDPOINT_URL=https://minio.automear.com
# S3_LOCAL_URL=https://minio.automear.com
# S3_ACCESS_KEY=admin
# S3_SECRET_KEY=password
```

### Test 4: End-to-End Test

Use the test script:
```bash
node test-vps-full-flow.js
```

**Expected Result**:
```
✅ POST SUCCESSFUL!
⏳ Waiting for webhook...
🔔 WEBHOOK RECEIVED!
✅ JOB COMPLETED SUCCESSFULLY!
📹 VIDEOS GENERATED:
  • Video 1: https://minio.automear.com/canais/.../video.mp4
  • Video 2: https://minio.automear.com/canais/.../video.mp4
  • Video 3: https://minio.automear.com/canais/.../video.mp4
```

---

## Why Local Test Passed But VPS Failed

**Local Test** (`test-vps-local.js`):
- Runs on development machine (Windows/Mac)
- FFmpeg already installed on system
- Direct file system access (no Docker)
- Used public MinIO URL: `https://minio.automear.com`
- ✅ **All dependencies available**

**VPS Deployment**:
- Runs in Docker container (Alpine Linux)
- ❌ FFmpeg NOT in container
- ❌ S3_LOCAL_URL NOT defined
- ❌ Work directories NOT created
- Receiving Docker internal URLs: `http://minio:9000`
- ❌ **Missing all dependencies**

This is why the local test succeeded but VPS deployment failed.

---

## Summary

The VPS endpoints are **architecturally correct** but **missing runtime dependencies**:

1. ✅ **Code Logic**: Correct (proven by local test)
2. ✅ **Route Handling**: Correct
3. ✅ **Job Queue**: Correct
4. ✅ **Validation**: Correct
5. ❌ **Docker Image**: Missing FFmpeg
6. ❌ **Environment**: Missing S3_LOCAL_URL
7. ❌ **File System**: Missing work directories
8. ❌ **Network**: Receiving internal Docker URLs

**Priority**:
1. Add FFmpeg to Dockerfile (CRITICAL)
2. Add S3_LOCAL_URL to .env (CRITICAL)
3. Create work directories in Dockerfile (HIGH)
4. Update payloads to use public URLs (MEDIUM)

**Estimated Fix Time**: 10 minutes (5 min for changes + 5 min for rebuild)

**Deployment Required**: Yes (Docker rebuild)
