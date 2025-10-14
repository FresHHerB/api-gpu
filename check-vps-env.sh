#!/bin/bash
# VPS Environment Check Script
# Run this on your VPS to diagnose VPS video processing issues

echo "=========================================="
echo "VPS Environment Diagnostic"
echo "=========================================="
echo ""

# Check FFmpeg
echo "1. Checking FFmpeg installation..."
if command -v ffmpeg &> /dev/null; then
    echo "✅ FFmpeg found: $(which ffmpeg)"
    ffmpeg -version | head -n 1
else
    echo "❌ FFmpeg NOT FOUND - this is the problem!"
    echo "   Install with: sudo apt update && sudo apt install -y ffmpeg"
fi
echo ""

# Check Node.js
echo "2. Checking Node.js..."
if command -v node &> /dev/null; then
    echo "✅ Node.js found: $(node -v)"
else
    echo "❌ Node.js NOT FOUND"
fi
echo ""

# Check work directory
echo "3. Checking VPS work directory..."
WORK_DIR="${VPS_WORK_DIR:-/tmp/vps-work}"
echo "   Directory: $WORK_DIR"
if [ -d "$WORK_DIR" ]; then
    echo "✅ Directory exists"
    ls -lah "$WORK_DIR" | head -n 5
else
    echo "⚠️  Directory does not exist (will be created automatically)"
fi
echo ""

# Check permissions
echo "4. Checking /tmp permissions..."
if [ -w "/tmp" ]; then
    echo "✅ /tmp is writable"
    touch /tmp/test-write && rm /tmp/test-write && echo "   Write test: OK"
else
    echo "❌ /tmp is NOT writable"
fi
echo ""

# Check MinIO connectivity (internal)
echo "5. Checking MinIO internal connectivity..."
MINIO_HOST="${S3_LOCAL_URL:-http://195.179.237.43:9000}"
echo "   Testing: $MINIO_HOST"
if curl -s --max-time 5 "$MINIO_HOST/minio/health/live" > /dev/null 2>&1; then
    echo "✅ MinIO internal endpoint is reachable"
else
    echo "⚠️  MinIO health check failed (may be normal if auth required)"
    echo "   Trying bucket list..."
    curl -s --max-time 5 "$MINIO_HOST" > /dev/null 2>&1 && echo "   ✅ MinIO responds" || echo "   ❌ MinIO not reachable"
fi
echo ""

# Test image download
echo "6. Testing image download with URL encoding..."
TEST_URL="https://minio.automear.com/canais/Mr. Nightmare/test/image.jpg"
echo "   Testing URL with spaces: $TEST_URL"
curl -L --max-time 10 -w "   HTTP Status: %{http_code}\n" -o /dev/null -s "$TEST_URL" 2>&1
echo ""

# Check disk space
echo "7. Checking disk space..."
df -h /tmp | tail -n 1
echo ""

# Check orchestrator process
echo "8. Checking orchestrator process..."
if pgrep -f "dist/orchestrator/index.js" > /dev/null; then
    echo "✅ Orchestrator is running"
    ps aux | grep "dist/orchestrator/index.js" | grep -v grep
else
    echo "⚠️  Orchestrator NOT running"
fi
echo ""

echo "=========================================="
echo "Diagnostic Complete"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. If FFmpeg is missing, install it: sudo apt install -y ffmpeg"
echo "2. Pull latest code: cd /root/api-gpu && git pull"
echo "3. Rebuild: npm run build:orchestrator"
echo "4. Restart: pm2 restart api-gpu-orchestrator"
echo "5. Check logs: pm2 logs api-gpu-orchestrator"
