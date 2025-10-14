#!/bin/bash
# Check VPS Logs - Run this on the VPS server
# Usage: ./check-vps-logs.sh [lines]

LINES=${1:-100}

echo "=========================================="
echo "📋 VPS Orchestrator Logs"
echo "=========================================="
echo "Showing last $LINES lines"
echo ""

# Check if pm2 is running
if ! command -v pm2 &> /dev/null; then
    echo "❌ PM2 not found"
    echo "   Install with: npm install -g pm2"
    exit 1
fi

# Show orchestrator logs
echo "1. Recent logs:"
pm2 logs api-gpu-orchestrator --lines $LINES --nostream

echo ""
echo "=========================================="
echo "2. Error logs only:"
echo "=========================================="
pm2 logs api-gpu-orchestrator --err --lines 50 --nostream

echo ""
echo "=========================================="
echo "3. Process status:"
echo "=========================================="
pm2 list | grep api-gpu

echo ""
echo "=========================================="
echo "4. Process info:"
echo "=========================================="
pm2 info api-gpu-orchestrator

echo ""
echo "💡 To follow logs in real-time:"
echo "   pm2 logs api-gpu-orchestrator"
