#!/bin/bash
# Script to update RunPod endpoint with new concatenate-enabled image

# Set these environment variables before running:
# export RUNPOD_API_KEY="your-runpod-api-key"
# export RUNPOD_ENDPOINT_ID="your-endpoint-id"

RUNPOD_API_KEY="${RUNPOD_API_KEY:-}"
ENDPOINT_ID="${RUNPOD_ENDPOINT_ID:-36oftlxk71cbjn}"
IMAGE_NAME="oreiasccp/api-gpu-worker:latest"

if [ -z "$RUNPOD_API_KEY" ]; then
  echo "❌ Error: RUNPOD_API_KEY environment variable not set"
  echo "Please set it with: export RUNPOD_API_KEY='your-key-here'"
  exit 1
fi

echo "📦 Updating RunPod endpoint with concatenate support..."

# Query to update endpoint template to use new image
curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d "{
    \"query\": \"mutation {
      updateEndpoint(
        input: {
          endpointId: \\\"$ENDPOINT_ID\\\",
          templateImageName: \\\"$IMAGE_NAME\\\"
        }
      ) {
        id
        name
        templateImageName
      }
    }\"
  }" | python -m json.tool

echo ""
echo "✅ RunPod endpoint updated!"
echo "🎬 The endpoint now supports concatenate operation"
echo ""
echo "Test with:"
echo 'curl -X POST "https://api.runpod.ai/v2/'$ENDPOINT_ID'/run" \'
echo '  -H "Content-Type: application/json" \'
echo '  -H "Authorization: Bearer '$RUNPOD_API_KEY'" \'
echo '  -d '"'"'{
    "input": {
      "operation": "concatenate",
      "video_urls": [
        {"video_url": "https://example.com/video1.mp4"},
        {"video_url": "https://example.com/video2.mp4"}
      ],
      "path": "test/videos/temp/",
      "output_filename": "concatenated.mp4"
    }
  }'"'"
