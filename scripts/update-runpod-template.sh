#!/bin/bash

# Script para atualizar Template no RunPod via GraphQL API
# Este script deleta o template antigo e cria um novo com as configurações corretas

API_KEY="${RUNPOD_API_KEY}"
OLD_TEMPLATE_ID="h4lh2b1f4v"
IMAGE_NAME="oreiasccp/api-gpu-worker:latest"
NEW_TEMPLATE_NAME="api-gpu-worker-v2"
REGISTRY_AUTH_ID="cmgfkp6470001jp02alnym0f6"  # Docker Hub credentials

echo "🗑️ Deletando template antigo..."

DELETE_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"query\": \"mutation { deleteTemplate(templateId: \\\"$OLD_TEMPLATE_ID\\\") }\"
  }")

echo "Delete response: $DELETE_RESPONSE"

echo ""
echo "🚀 Criando novo template..."

CREATE_RESPONSE=$(curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -d "{
    \"query\": \"mutation { saveTemplate(input: { name: \\\"$NEW_TEMPLATE_NAME\\\", imageName: \\\"$IMAGE_NAME\\\", containerRegistryAuthId: \\\"$REGISTRY_AUTH_ID\\\", dockerArgs: \\\"python -u rp_handler.py\\\", containerDiskInGb: 10, volumeInGb: 0, isServerless: true, env: [{key: \\\"WORK_DIR\\\", value: \\\"/tmp/work\\\"}, {key: \\\"OUTPUT_DIR\\\", value: \\\"/tmp/output\\\"}, {key: \\\"BATCH_SIZE\\\", value: \\\"3\\\"}] }) { id name imageName dockerArgs env { key value } } }\"
  }")

echo "Create response: $CREATE_RESPONSE"

# Extract new template ID
NEW_TEMPLATE_ID=$(echo $CREATE_RESPONSE | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -n "$NEW_TEMPLATE_ID" ]; then
  echo ""
  echo "✅ Novo template criado com sucesso!"
  echo "Template ID: $NEW_TEMPLATE_ID"
  echo ""
  echo "⚙️ Agora atualize o endpoint para usar o novo template:"
  echo ""
  echo "curl -X POST 'https://api.runpod.io/graphql' \\"
  echo "  -H 'Content-Type: application/json' \\"
  echo "  -H 'Authorization: Bearer \$RUNPOD_API_KEY' \\"
  echo "  -d '{\"query\":\"mutation { updateEndpointTemplate(input: { endpointId: \\\"5utj4m2ukiumpp\\\", templateId: \\\"$NEW_TEMPLATE_ID\\\" }) { id name templateId } }\"}'"
  echo ""
else
  echo "❌ Erro ao criar template"
  echo "Resposta completa: $CREATE_RESPONSE"
fi
