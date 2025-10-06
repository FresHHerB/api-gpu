#!/bin/bash

# Script para criar Template no RunPod via GraphQL API

API_KEY="${RUNPOD_API_KEY}"
IMAGE_NAME="oreiasccp/api-gpu-worker:latest"
REGISTRY_AUTH_ID="cmgfkp6470001jp02alnym0f6"  # Docker Hub credentials

echo "🚀 Criando template no RunPod..."

RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"query\": \"mutation { saveTemplate(input: { name: \\\"api-gpu-worker-v4-30min\\\", imageName: \\\"$IMAGE_NAME\\\", containerRegistryAuthId: \\\"$REGISTRY_AUTH_ID\\\", dockerArgs: \\\"python -u rp_handler.py\\\", containerDiskInGb: 10, volumeInGb: 0, isServerless: true, executionTimeout: 2400, env: [{key: \\\"WORK_DIR\\\", value: \\\"/tmp/work\\\"}, {key: \\\"OUTPUT_DIR\\\", value: \\\"/tmp/output\\\"}, {key: \\\"BATCH_SIZE\\\", value: \\\"3\\\"}] }) { id name imageName executionTimeout } }\"
  }")

echo "Resposta: $RESPONSE"

# Extract template ID
TEMPLATE_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$TEMPLATE_ID" ]; then
  echo "✅ Template criado com sucesso!"
  echo "Template ID: $TEMPLATE_ID"
  echo ""
  echo "Salve esse ID para criar o endpoint:"
  echo "export RUNPOD_TEMPLATE_ID=$TEMPLATE_ID"
else
  echo "❌ Erro ao criar template"
  echo "Resposta completa: $RESPONSE"
fi
