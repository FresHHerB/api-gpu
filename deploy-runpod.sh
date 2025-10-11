#!/bin/bash
# ============================================
# RunPod Deployment Script - v2.5.0
# Multi-Zoom Support: zoomin, zoomout, zoompanright, zoompanleft
# ============================================

set -e

echo "🚀 RunPod Deployment - v2.5.0 Multi-Zoom Support"
echo "=================================================="
echo ""

# Configuration
DOCKER_IMAGE="oreiasccp/api-gpu-worker"
VERSION="v2.5.0"
RUNPOD_API_KEY="${RUNPOD_API_KEY:-$(grep RUNPOD_API_KEY .env | cut -d '=' -f2)}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Build Docker Image
echo -e "${BLUE}📦 Step 1: Building Docker image...${NC}"
docker build -f docker/worker-python.Dockerfile -t ${DOCKER_IMAGE}:${VERSION} -t ${DOCKER_IMAGE}:latest .

# Step 2: Push to Docker Hub
echo -e "${BLUE}🚢 Step 2: Pushing to Docker Hub...${NC}"
docker push ${DOCKER_IMAGE}:${VERSION}
docker push ${DOCKER_IMAGE}:latest

# Step 3: Create RunPod Template
echo -e "${BLUE}📝 Step 3: Creating RunPod template...${NC}"
TEMPLATE_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation { saveTemplate(input: {
      name: \"api-gpu-worker-v2.5\",
      imageName: \"'${DOCKER_IMAGE}:${VERSION}'\",
      dockerArgs: \"python -u rp_handler.py\",
      containerDiskInGb: 10,
      volumeInGb: 0,
      isServerless: true,
      env: [
        {key: \"WORK_DIR\", value: \"/tmp/work\"},
        {key: \"OUTPUT_DIR\", value: \"/tmp/output\"},
        {key: \"BATCH_SIZE\", value: \"3\"}
      ]
    }) { id name imageName } }"
  }')

TEMPLATE_ID=$(echo $TEMPLATE_RESPONSE | grep -o '"id":"[^"]*' | grep -o '[^"]*$' | head -1)

if [ -z "$TEMPLATE_ID" ]; then
  echo -e "${RED}❌ Failed to create template. Response: ${TEMPLATE_RESPONSE}${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Template created: ${TEMPLATE_ID}${NC}"

# Step 4: Create RunPod Endpoint
echo -e "${BLUE}🔌 Step 4: Creating RunPod endpoint...${NC}"
ENDPOINT_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation { saveEndpoint(input: {
      name: \"api-gpu-worker\",
      templateId: \"'${TEMPLATE_ID}'\",
      workersMin: 0,
      workersMax: 3,
      gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\",
      scalerType: \"QUEUE_DELAY\",
      scalerValue: 3,
      networkVolumeId: \"\"
    }) { id name templateId } }"
  }')

ENDPOINT_ID=$(echo $ENDPOINT_RESPONSE | grep -o '"id":"[^"]*' | grep -o '[^"]*$' | head -1)

if [ -z "$ENDPOINT_ID" ]; then
  echo -e "${RED}❌ Failed to create endpoint. Response: ${ENDPOINT_RESPONSE}${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Endpoint created: ${ENDPOINT_ID}${NC}"

# Step 5: Update .env file
echo -e "${BLUE}📝 Step 5: Updating .env file...${NC}"
sed -i "s/^RUNPOD_ENDPOINT_ID=.*/RUNPOD_ENDPOINT_ID=${ENDPOINT_ID}/" .env

echo ""
echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo "=================================================="
echo -e "${YELLOW}Template ID: ${TEMPLATE_ID}${NC}"
echo -e "${YELLOW}Endpoint ID: ${ENDPOINT_ID}${NC}"
echo -e "${YELLOW}Image: ${DOCKER_IMAGE}:${VERSION}${NC}"
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo "1. Restart orchestrator to use new endpoint"
echo "2. Test with new zoom_types parameter"
echo ""
echo -e "${BLUE}🎬 Example request:${NC}"
echo '{
  "images": [
    {"id": "img-1", "image_url": "https://example.com/photo1.jpg", "duracao": 6.48},
    {"id": "img-2", "image_url": "https://example.com/photo2.jpg", "duracao": 5.0},
    {"id": "img-3", "image_url": "https://example.com/photo3.jpg", "duracao": 3.42}
  ],
  "path": "Project/videos/temp/",
  "zoom_types": ["zoomin", "zoomout", "zoompanright", "zoompanleft"]
}'
echo ""
