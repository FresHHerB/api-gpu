#!/bin/bash

# Script para criar Template no RunPod via GraphQL API

API_KEY="${RUNPOD_API_KEY}"
IMAGE_NAME="oreiasccp/api-gpu-worker:latest"

echo "🚀 Criando template no RunPod..."

RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"query\": \"mutation { saveTemplate(input: { name: \\\"api-gpu-worker-template\\\", imageName: \\\"$IMAGE_NAME\\\", dockerArgs: \\\"node dist/worker/handler.js\\\", containerDiskInGb: 10, isServerless: true }) { id name } }\"
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
