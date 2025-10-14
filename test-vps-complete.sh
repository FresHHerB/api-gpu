#!/bin/bash
# Complete VPS Test - Runs webhook server and test client
# Usage: ./test-vps-complete.sh [VPS_URL]

VPS_URL=${1:-"http://185.173.110.7:3000"}
WEBHOOK_PORT=8888

echo "=========================================="
echo "🧪 Complete VPS Endpoint Test"
echo "=========================================="
echo "VPS URL: $VPS_URL"
echo "Webhook Port: $WEBHOOK_PORT"
echo ""

# Check if webhook server is already running
if lsof -i :$WEBHOOK_PORT > /dev/null 2>&1; then
  echo "⚠️  Port $WEBHOOK_PORT is already in use"
  echo "   Killing existing process..."
  kill $(lsof -t -i:$WEBHOOK_PORT) 2>/dev/null
  sleep 1
fi

# Start webhook server in background
echo "1. Starting webhook server..."
node test-webhook-server.js > webhook-server.log 2>&1 &
WEBHOOK_PID=$!

# Wait for server to start
sleep 2

# Check if server started successfully
if ! kill -0 $WEBHOOK_PID 2>/dev/null; then
  echo "❌ Failed to start webhook server"
  cat webhook-server.log
  exit 1
fi

echo "✅ Webhook server started (PID: $WEBHOOK_PID)"
echo ""

# Run test
echo "2. Running test..."
VPS_URL=$VPS_URL node test-vps-img2vid.js

# Keep webhook server running for a bit to receive webhook
echo ""
echo "3. Waiting for webhook (30 seconds)..."
echo "   Press Ctrl+C to stop early"
sleep 30

# Check webhook server logs
echo ""
echo "=========================================="
echo "📊 Webhook Server Logs"
echo "=========================================="
tail -n 50 webhook-server.log

# Cleanup
echo ""
echo "Stopping webhook server..."
kill $WEBHOOK_PID 2>/dev/null

echo "✅ Test complete"
