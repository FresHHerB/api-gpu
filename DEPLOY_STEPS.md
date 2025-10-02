# 🚀 Passos para Deploy no RunPod Serverless

## ✅ O que você já tem:
- RunPod API Key: (configurado no .env)
- Docker Hub User: `oreiasccp`

---

## 📋 Passo a Passo Completo

### **Passo 1: Fazer Login no Docker** (Manual - Senha Correta)

```bash
# Execute no seu terminal:
docker login
# Username: oreiasccp
# Password: <sua-senha-correta>
```

---

### **Passo 2: Build da Imagem Worker**

```bash
cd D:\code\github\api-gpu

# Build da imagem
docker build -f docker/worker.Dockerfile -t oreiasccp/api-gpu-worker:latest .
```

**Tempo estimado:** 10-15 minutos (primeira vez)

---

### **Passo 3: Push para Docker Hub**

```bash
docker push oreiasccp/api-gpu-worker:latest
```

**Tempo estimado:** 5-10 minutos

---

### **Passo 4: Criar Template no RunPod** (Via Console Web)

**Opção A: Via Console (Mais Fácil)**

1. Acesse: https://www.runpod.io/console/serverless/user/templates
2. Click em **"+ New Template"**
3. Preencha:
   ```
   Template Name: api-gpu-worker-template
   Container Image: oreiasccp/api-gpu-worker:latest
   Container Disk: 10 GB
   Docker Command: node dist/worker/handler.js

   Environment Variables: (deixe vazio por enquanto)
   ```
4. Click **"Save Template"**
5. **Copie o Template ID** (ex: `xkhgg72fuo`)

**Opção B: Via GraphQL API**

```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveTemplate(input: { name: \"api-gpu-worker-template\", imageName: \"oreiasccp/api-gpu-worker:latest\", dockerArgs: \"node dist/worker/handler.js\", containerDiskInGb: 10, isServerless: true }) { id name } }"
  }'
```

---

### **Passo 5: Criar Endpoint Serverless**

**Via Console (Recomendado):**

1. Acesse: https://www.runpod.io/console/serverless
2. Click **"+ New Endpoint"**
3. Preencha:
   ```
   Endpoint Name: api-gpu-worker
   Select Template: api-gpu-worker-template (selecione o template criado)

   GPU Configuration:
   - Select GPUs: NVIDIA RTX 2000 Ada Generation

   Workers Configuration:
   - Min Workers: 0
   - Max Workers: 10
   - Idle Timeout: 300 seconds (5 minutos)
   - GPUs Per Worker: 1

   Advanced Configuration:
   - Scaler Type: Request Count
   - Scaler Value: 1
   ```
4. Click **"Deploy"**
5. **Copie o Endpoint ID** (ex: `abc123def456`)

**Via GraphQL API:**

```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation { saveEndpoint(input: { name: \"api-gpu-worker\", templateId: \"SEU_TEMPLATE_ID_AQUI\", gpuIds: \"NVIDIA RTX 2000 Ada Generation\", idleTimeout: 300, scalerType: \"QUEUE_DELAY\", scalerValue: 4, workersMin: 0, workersMax: 10 }) { id name } }"
  }'
```

Substitua `SEU_TEMPLATE_ID_AQUI` pelo ID do template criado no passo 4.

---

### **Passo 6: Configurar .env no Orchestrator**

Edite o arquivo `.env`:

```bash
# RunPod Configuration
RUNPOD_API_KEY=$RUNPOD_API_KEY
RUNPOD_ENDPOINT_ID=abc123def456  # ← Cole o Endpoint ID aqui

# Orchestrator Configuration
PORT=3000
NODE_ENV=production
X_API_KEY=generated-key-12345  # ← Chave para clientes externos

# Optional
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=600
```

---

### **Passo 7: Testar Localmente**

```bash
# Instalar dependências
npm install

# Build orchestrator
npm run build:orchestrator

# Rodar orchestrator
npm run start:orchestrator

# Em outro terminal, testar
curl http://localhost:3000/health

curl http://localhost:3000/runpod/health \
  -H "X-API-Key: generated-key-12345"
```

---

### **Passo 8: Testar Processamento de Vídeo**

```bash
curl -X POST http://localhost:3000/video/caption \
  -H "X-API-Key: generated-key-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://sample-videos.com/video321/mp4/720/big_buck_bunny_720p_1mb.mp4",
    "url_srt": "https://gist.githubusercontent.com/example/subtitles.srt"
  }'
```

---

## 🎯 Resumo dos IDs Importantes

Após completar os passos acima, você terá:

```
Docker Hub:
- Image: oreiasccp/api-gpu-worker:latest

RunPod:
- API Key: $RUNPOD_API_KEY
- Template ID: _________________ (passo 4)
- Endpoint ID: _________________ (passo 5)

Orchestrator:
- X-API-Key: _________________ (passo 6)
```

---

## 🐛 Troubleshooting

### Erro: "Cannot pull image"
- Verifique se fez push da imagem: `docker images | grep api-gpu-worker`
- Verifique se a imagem é pública no Docker Hub

### Erro: "Template not found"
- Certifique-se de que criou o template antes do endpoint
- Verifique o Template ID na query/console

### Erro: "GPU not available"
- Tente com outra GPU (RTX 3060, RTX 4090, etc)
- Verifique disponibilidade no console

---

## ✅ Checklist

- [ ] Docker login realizado
- [ ] Imagem buildada (`docker build`)
- [ ] Imagem publicada (`docker push`)
- [ ] Template criado no RunPod
- [ ] Endpoint serverless criado
- [ ] `.env` configurado com Endpoint ID
- [ ] Orchestrator testado localmente
- [ ] Processamento de vídeo testado

---

**Próximo:** Após completar esses passos, seu sistema estará 100% funcional! 🎉
