#!/bin/bash

# ============================================
# Transcription Endpoint Test Script
# ============================================
#
# Before running:
# 1. Deploy RunPod faster-whisper endpoint:
#    https://console.runpod.io/hub/runpod-workers/worker-faster_whisper
# 2. Add RUNPOD_WHISPER_ENDPOINT_ID to .env
# 3. Start the orchestrator: npm run start:orchestrator
#
# Usage:
#   bash test-transcription.sh
# ============================================

# Configuration
BASE_URL="http://localhost:3000"
API_KEY="coringao"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🎙️  Testing Transcription Endpoint${NC}\n"

# ============================================
# Test 1: Health Check
# ============================================

echo -e "${YELLOW}📡 Test 1: Health Check${NC}"
echo "GET ${BASE_URL}/transcribe/health"
echo ""

HEALTH_RESPONSE=$(curl -s -X GET "${BASE_URL}/transcribe/health")
echo "$HEALTH_RESPONSE" | jq '.'

STATUS=$(echo "$HEALTH_RESPONSE" | jq -r '.status')
if [ "$STATUS" == "healthy" ]; then
  echo -e "${GREEN}✅ Health check passed${NC}\n"
else
  echo -e "${RED}❌ Health check failed - Endpoint may not be configured${NC}"
  echo -e "${YELLOW}💡 Make sure RUNPOD_WHISPER_ENDPOINT_ID is set in .env${NC}\n"
  exit 1
fi

# ============================================
# Test 2: Simple Transcription
# ============================================

echo -e "${YELLOW}🎵 Test 2: Transcription with Sample Audio${NC}"
echo "POST ${BASE_URL}/transcribe"
echo ""

# Sample audio URL (replace with your test audio)
# Note: This is a placeholder - use a real audio URL
AUDIO_URL="https://filesamples.com/samples/audio/mp3/sample1.mp3"
JOB_PATH="transcriptions/test-$(date +%s)/"

PAYLOAD=$(cat <<EOF
{
  "audio_url": "${AUDIO_URL}",
  "path": "${JOB_PATH}",
  "model": "base",
  "language": "en",
  "enable_vad": true
}
EOF
)

echo "Request Payload:"
echo "$PAYLOAD" | jq '.'
echo ""

echo -e "${YELLOW}⏳ Processing transcription (this may take 1-3 minutes)...${NC}\n"

RESPONSE=$(curl -s -X POST "${BASE_URL}/transcribe" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ${API_KEY}" \
  -d "$PAYLOAD")

echo "Response:"
echo "$RESPONSE" | jq '.'
echo ""

# Check response
CODE=$(echo "$RESPONSE" | jq -r '.code')
if [ "$CODE" == "200" ]; then
  echo -e "${GREEN}✅ Transcription completed successfully${NC}\n"

  # Extract file URLs
  SRT_URL=$(echo "$RESPONSE" | jq -r '.files.segments.srt')
  ASS_URL=$(echo "$RESPONSE" | jq -r '.files.words.ass_karaoke')
  JSON_URL=$(echo "$RESPONSE" | jq -r '.files.segments.json')

  echo -e "${GREEN}📄 Generated Files:${NC}"
  echo "  SRT:  ${SRT_URL}"
  echo "  ASS:  ${ASS_URL}"
  echo "  JSON: ${JSON_URL}"
  echo ""

  # Execution stats
  DURATION=$(echo "$RESPONSE" | jq -r '.execution.durationSeconds')
  SEGMENTS=$(echo "$RESPONSE" | jq -r '.stats.segments')
  WORDS=$(echo "$RESPONSE" | jq -r '.stats.words')
  LANGUAGE=$(echo "$RESPONSE" | jq -r '.language')

  echo -e "${GREEN}📊 Stats:${NC}"
  echo "  Language: ${LANGUAGE}"
  echo "  Duration: ${DURATION}s"
  echo "  Segments: ${SEGMENTS}"
  echo "  Words:    ${WORDS}"
  echo ""

else
  echo -e "${RED}❌ Transcription failed${NC}"
  ERROR=$(echo "$RESPONSE" | jq -r '.message')
  echo "Error: ${ERROR}"
  exit 1
fi

# ============================================
# Test 3: Verify Files Accessibility
# ============================================

echo -e "${YELLOW}🔍 Test 3: Verifying File Accessibility${NC}"

if [ "$SRT_URL" != "null" ] && [ "$SRT_URL" != "" ]; then
  echo "Testing SRT file accessibility..."
  SRT_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$SRT_URL")

  if [ "$SRT_STATUS" == "200" ]; then
    echo -e "${GREEN}✅ SRT file is accessible (HTTP ${SRT_STATUS})${NC}"
    echo ""
    echo "First 10 lines of SRT:"
    curl -s "$SRT_URL" | head -20
    echo ""
  else
    echo -e "${RED}❌ SRT file is not accessible (HTTP ${SRT_STATUS})${NC}"
  fi
else
  echo -e "${YELLOW}⚠️  No SRT file URL found${NC}"
fi

echo ""
echo -e "${GREEN}🎉 All tests completed!${NC}"
