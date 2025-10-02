#!/bin/bash

# Script para criar Endpoint Serverless no RunPod via GraphQL API

API_KEY="${RUNPOD_API_KEY}"
TEMPLATE_ID="${1:-$RUNPOD_TEMPLATE_ID}"

if [ -z "$TEMPLATE_ID" ]; then
  echo "❌ Erro: Template ID não fornecido"
  echo "Uso: $0 <template-id>"
  echo "Ou: export RUNPOD_TEMPLATE_ID=<template-id> && $0"
  exit 1
fi

echo "🚀 Criando endpoint serverless no RunPod..."
echo "Template ID: $TEMPLATE_ID"

RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"query\": \"mutation { saveEndpoint(input: { name: \\\"api-gpu-worker\\\", templateId: \\\"$TEMPLATE_ID\\\", gpuIds: \\\"NVIDIA RTX 2000 Ada Generation\\\", idleTimeout: 300, scalerType: \\\"QUEUE_DELAY\\\", scalerValue: 4, workersMin: 0, workersMax: 10 }) { id name } }\"
  }")

echo "Resposta: $RESPONSE"

# Extract endpoint ID
ENDPOINT_ID=$(echo $RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$ENDPOINT_ID" ]; then
  echo "✅ Endpoint criado com sucesso!"
  echo "Endpoint ID: $ENDPOINT_ID"
  echo ""
  echo "Configure no .env:"
  echo "RUNPOD_ENDPOINT_ID=$ENDPOINT_ID"
else
  echo "❌ Erro ao criar endpoint"
  echo "Resposta completa: $RESPONSE"
fi
