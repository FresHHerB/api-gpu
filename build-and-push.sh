#!/bin/bash
# Build and push Docker image for api-gpu-worker

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
IMAGE_NAME="oreiasccp/api-gpu-worker"
DOCKERFILE="docker/worker-python.Dockerfile"

# Get version from command line or use latest
VERSION="${1:-latest}"

echo -e "${GREEN}🐳 Building Docker image for api-gpu-worker${NC}"
echo -e "${YELLOW}Version: ${VERSION}${NC}"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
  echo -e "${RED}❌ Error: Docker is not running${NC}"
  echo "Please start Docker Desktop and try again"
  exit 1
fi

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
  echo -e "${RED}❌ Error: Dockerfile not found at $DOCKERFILE${NC}"
  exit 1
fi

# Build image
echo -e "${GREEN}📦 Building image...${NC}"
if [ "$VERSION" = "latest" ]; then
  docker build -f "$DOCKERFILE" -t "${IMAGE_NAME}:latest" .
else
  docker build -f "$DOCKERFILE" -t "${IMAGE_NAME}:latest" -t "${IMAGE_NAME}:${VERSION}" .
fi

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Build failed${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Build completed successfully${NC}"
echo ""

# Ask for confirmation before pushing
read -p "Push to Docker Hub? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}⏭️  Skipping push${NC}"
  exit 0
fi

# Push image
echo -e "${GREEN}📤 Pushing image to Docker Hub...${NC}"
docker push "${IMAGE_NAME}:latest"

if [ "$VERSION" != "latest" ]; then
  docker push "${IMAGE_NAME}:${VERSION}"
fi

if [ $? -ne 0 ]; then
  echo -e "${RED}❌ Push failed${NC}"
  exit 1
fi

echo -e "${GREEN}✅ Push completed successfully${NC}"
echo ""
echo -e "${GREEN}🎉 Done!${NC}"
echo ""
echo "Image: ${IMAGE_NAME}:latest"
if [ "$VERSION" != "latest" ]; then
  echo "       ${IMAGE_NAME}:${VERSION}"
fi
echo ""
echo "Next steps:"
echo "1. Update RunPod template with new image"
echo "2. Deploy to RunPod endpoint"
echo "3. Test the deployment"
echo ""
echo "See RUNPOD_DEPLOYMENT.md for deployment instructions"
