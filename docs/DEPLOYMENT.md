# Deployment Guide

Guia completo para deploy da API GPU em produção.

## Índice

- [Pré-requisitos](#pré-requisitos)
- [RunPod Serverless](#runpod-serverless)
  - [Worker Configuration](#worker-configuration)
  - [Template Setup](#template-setup)
  - [Endpoint Setup](#endpoint-setup)
- [Orchestrator (VPS)](#orchestrator-vps)
  - [Easypanel](#easypanel)
  - [Docker Compose](#docker-compose)
  - [PM2](#pm2)
- [Docker Hub](#docker-hub)
- [Environment Variables](#environment-variables)
- [Troubleshooting](#troubleshooting)

---

## Pré-requisitos

- **Node.js** 20+
- **Docker** (para build da imagem worker)
- **RunPod Account** + API Key
- **S3/MinIO** bucket configurado
- **VPS** ou **Easypanel** para orchestrator
- **Docker Hub Account** (para hospedar imagem worker)

---

## RunPod Serverless

### Worker Configuration

A API GPU usa workers serverless no RunPod para processar vídeos com aceleração GPU (NVENC).

**Imagem Docker:**
```
oreiasccp/api-gpu-worker:latest
```

**GPUs Suportadas:**
- AMPERE_16 (RTX A4000 - 16GB)
- AMPERE_24 (RTX A5000 - 24GB)
- NVIDIA RTX 2000 Ada Generation

**Recursos:**
- Container Disk: 10-15 GB
- Volume: 0 GB (stateless)
- Workers: 0-3 (auto-scaling)
- Idle Timeout: 5 min
- Execution Timeout: 40 min

### Template Setup

**1. Build e Push Docker Image:**

```bash
# Login no Docker Hub
docker login

# Build da imagem
docker build -f docker/worker-python.Dockerfile \
  -t oreiasccp/api-gpu-worker:latest .

# Push para Docker Hub
docker push oreiasccp/api-gpu-worker:latest
```

**2. Criar Template via RunPod Console:**

RunPod Console → Templates → New Template

```yaml
Template Name: api-gpu-worker-production
Container Image: oreiasccp/api-gpu-worker:latest
Docker Command: python -u rp_handler.py
Container Disk: 15 GB
Volume: 0 GB
Serverless: Yes
Ports: 8000/http

Environment Variables:
  WORK_DIR: /tmp/work
  OUTPUT_DIR: /tmp/output
  BATCH_SIZE: 3
  S3_ENDPOINT_URL: https://your-minio.example.com
  S3_ACCESS_KEY: your_access_key
  S3_SECRET_KEY: your_secret_key
  S3_BUCKET_NAME: canais
  S3_REGION: us-east-1
  HTTP_PORT: 8000
```

**3. Ou via GraphQL API:**

```bash
curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -d '{
    "query": "mutation {
      saveTemplate(input: {
        name: \"api-gpu-worker-production\",
        imageName: \"oreiasccp/api-gpu-worker:latest\",
        dockerArgs: \"python -u rp_handler.py\",
        containerDiskInGb: 15,
        volumeInGb: 0,
        isServerless: true,
        ports: \"8000/http\",
        env: [
          {key: \"WORK_DIR\", value: \"/tmp/work\"},
          {key: \"OUTPUT_DIR\", value: \"/tmp/output\"},
          {key: \"BATCH_SIZE\", value: \"3\"},
          {key: \"S3_ENDPOINT_URL\", value: \"https://your-minio.example.com\"},
          {key: \"S3_ACCESS_KEY\", value: \"your_access_key\"},
          {key: \"S3_SECRET_KEY\", value: \"your_secret_key\"},
          {key: \"S3_BUCKET_NAME\", value: \"canais\"},
          {key: \"S3_REGION\", value: \"us-east-1\"},
          {key: \"HTTP_PORT\", value: \"8000\"}
        ]
      }) {
        id
        name
        imageName
      }
    }"
  }'
```

### Endpoint Setup

**1. Criar Endpoint via Console:**

RunPod Console → Serverless → New Endpoint

```yaml
Endpoint Name: api-gpu-worker
Template: api-gpu-worker-production
GPUs: AMPERE_16, AMPERE_24, NVIDIA RTX 2000 Ada Generation
Workers Min: 0
Workers Max: 3
Idle Timeout: 300 seconds
Execution Timeout: 2400 seconds
Scaler Type: QUEUE_DELAY
Scaler Value: 3
FlashBoot: Enabled
```

**2. Ou via GraphQL API:**

```bash
curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -d '{
    "query": "mutation {
      saveEndpoint(input: {
        name: \"api-gpu-worker\",
        templateId: \"YOUR_TEMPLATE_ID\",
        workersMin: 0,
        workersMax: 3,
        gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX 2000 Ada Generation\",
        scalerType: \"QUEUE_DELAY\",
        scalerValue: 3,
        networkVolumeId: \"\"
      }) {
        id
        name
        templateId
        gpuIds
        workersMin
        workersMax
      }
    }"
  }'
```

**3. Obter Endpoint ID:**

Copie o **Endpoint ID** retornado e adicione ao `.env`:

```bash
RUNPOD_ENDPOINT_ID=your_endpoint_id_here
```

---

## Orchestrator (VPS)

O orchestrator é um servidor Express.js que recebe requisições HTTP, valida payloads, e coordena jobs no RunPod.

### Easypanel

**1. Criar App no Easypanel:**

```yaml
App Type: Git
Repository: https://github.com/your-username/api-gpu.git
Branch: main
Build Type: Dockerfile
Dockerfile Path: ./Dockerfile
Port: 3000
```

**2. Configure Environment Variables:**

Vá em Settings → Environment e adicione todas as variáveis do `.env`:

```bash
PORT=3000
NODE_ENV=production
X_API_KEY=your-secure-api-key
RUNPOD_API_KEY=rpa_your_key_here
RUNPOD_ENDPOINT_ID=your_endpoint_id
RUNPOD_WHISPER_ENDPOINT_ID=your_whisper_endpoint_id
POLLING_MAX_ATTEMPTS=240
EXPRESS_TIMEOUT_MS=2100000
RUNPOD_EXECUTION_TIMEOUT=2400
RUNPOD_IDLE_TIMEOUT=300
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
LOG_LEVEL=info
LOGS_DIR=./logs
CORS_ALLOW_ORIGINS=*
```

**3. Deploy:**

Clique em "Deploy" e aguarde o build.

**4. Obter URL:**

Easypanel fornecerá uma URL pública: `https://your-app.easypanel.host`

### Docker Compose

**1. Create `docker-compose.yml`:**

```yaml
version: '3.8'

services:
  orchestrator:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - NODE_ENV=production
      - X_API_KEY=${X_API_KEY}
      - RUNPOD_API_KEY=${RUNPOD_API_KEY}
      - RUNPOD_ENDPOINT_ID=${RUNPOD_ENDPOINT_ID}
      - RUNPOD_WHISPER_ENDPOINT_ID=${RUNPOD_WHISPER_ENDPOINT_ID}
      - POLLING_MAX_ATTEMPTS=${POLLING_MAX_ATTEMPTS}
      - EXPRESS_TIMEOUT_MS=${EXPRESS_TIMEOUT_MS}
      - RUNPOD_EXECUTION_TIMEOUT=${RUNPOD_EXECUTION_TIMEOUT}
      - RUNPOD_IDLE_TIMEOUT=${RUNPOD_IDLE_TIMEOUT}
      - S3_ENDPOINT_URL=${S3_ENDPOINT_URL}
      - S3_ACCESS_KEY=${S3_ACCESS_KEY}
      - S3_SECRET_KEY=${S3_SECRET_KEY}
      - S3_BUCKET_NAME=${S3_BUCKET_NAME}
      - S3_REGION=${S3_REGION}
      - LOG_LEVEL=${LOG_LEVEL}
      - LOGS_DIR=${LOGS_DIR}
      - CORS_ALLOW_ORIGINS=${CORS_ALLOW_ORIGINS}
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs
      - ./public:/app/public
```

**2. Deploy:**

```bash
docker-compose up -d
```

**3. Logs:**

```bash
docker-compose logs -f orchestrator
```

### PM2

**1. Build:**

```bash
npm run build:orchestrator
```

**2. Start with PM2:**

```bash
pm2 start dist/orchestrator/index.js --name api-gpu-orchestrator
pm2 save
pm2 startup
```

**3. Logs:**

```bash
pm2 logs api-gpu-orchestrator
```

**4. Restart:**

```bash
pm2 restart api-gpu-orchestrator
```

---

## Docker Hub

### Login

```bash
docker login
# Username: your_dockerhub_username
# Password: your_dockerhub_token
```

### Build & Push

```bash
# Worker Python
docker build -f docker/worker-python.Dockerfile \
  -t oreiasccp/api-gpu-worker:latest .

docker push oreiasccp/api-gpu-worker:latest

# Tag with version
docker tag oreiasccp/api-gpu-worker:latest \
  oreiasccp/api-gpu-worker:v2.0.0

docker push oreiasccp/api-gpu-worker:v2.0.0
```

### Pull (RunPod)

RunPod automaticamente faz pull da imagem ao criar workers. Certifique-se que:
- Imagem é **pública** no Docker Hub, OU
- RunPod tem credenciais para registry privado

---

## Environment Variables

### Orchestrator (.env)

```bash
# Server
PORT=3000
NODE_ENV=production

# API Authentication
X_API_KEY=your-secure-api-key-change-me

# RunPod Configuration
RUNPOD_API_KEY=rpa_YOUR_API_KEY_HERE

# Video Processing Endpoint (img2vid, caption, addaudio)
RUNPOD_ENDPOINT_ID=your_endpoint_id_here

# Transcription Endpoint (faster-whisper)
RUNPOD_WHISPER_ENDPOINT_ID=your_whisper_endpoint_id

# Timeout Configuration (30 min execution + margins)
POLLING_MAX_ATTEMPTS=240              # 240 × 8s = 32 min max polling
EXPRESS_TIMEOUT_MS=2100000            # 35 min (server timeout)
RUNPOD_EXECUTION_TIMEOUT=2400         # 40 min (worker timeout)
RUNPOD_IDLE_TIMEOUT=300               # 5 min (keep-alive)

# S3/MinIO (used by worker)
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1

# Logging
LOG_LEVEL=info
LOGS_DIR=./logs

# CORS
CORS_ALLOW_ORIGINS=*
```

### Worker (RunPod Template Env Vars)

```bash
WORK_DIR=/tmp/work
OUTPUT_DIR=/tmp/output
BATCH_SIZE=3
S3_ENDPOINT_URL=https://your-minio.example.com
S3_ACCESS_KEY=your_access_key
S3_SECRET_KEY=your_secret_key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
HTTP_PORT=8000
```

---

## Troubleshooting

### Worker não inicia

**Verificar logs no RunPod Console:**
```
RunPod Console → Serverless → Endpoint → Logs
```

**Ou via API:**
```bash
curl -H "Authorization: Bearer $RUNPOD_API_KEY" \
  https://api.runpod.ai/v2/<endpoint-id>/status/<job-id>
```

**Problemas comuns:**
- Docker image não encontrada → Verificar push no Docker Hub
- S3 credentials inválidas → Verificar env vars no template
- GPU não disponível → Ajustar `gpuIds` no endpoint

### S3 Upload Failed

**Testar conexão S3:**
```bash
# AWS CLI
aws s3 ls s3://your-bucket --endpoint-url https://your-minio.com

# Python
python3 << EOF
import boto3
s3 = boto3.client('s3',
    endpoint_url='https://your-minio.com',
    aws_access_key_id='your-key',
    aws_secret_access_key='your-secret'
)
print(s3.list_buckets())
EOF
```

**Problemas comuns:**
- Bucket não existe → Criar via console S3/MinIO
- Credentials inválidas → Verificar `S3_ACCESS_KEY` e `S3_SECRET_KEY`
- Network error → Verificar `S3_ENDPOINT_URL` e firewall

### Orchestrator não envia jobs

**Verificar logs:**
```bash
# PM2
pm2 logs api-gpu-orchestrator

# Docker
docker logs -f orchestrator

# Easypanel
Easypanel → App → Logs
```

**Testar RunPod API manualmente:**
```bash
curl -X POST https://api.runpod.ai/v2/<endpoint-id>/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"input": {"operation": "test"}}'
```

### Timeout Errors

**Aumentar timeouts:**

**.env:**
```bash
POLLING_MAX_ATTEMPTS=360              # 48 min
EXPRESS_TIMEOUT_MS=3000000            # 50 min
RUNPOD_EXECUTION_TIMEOUT=3600         # 60 min
```

**RunPod Console:**
```
Serverless → Endpoint → Settings → Execution Timeout: 3600
```

### Out of Memory (OOM)

**Reduzir BATCH_SIZE no template:**
```bash
BATCH_SIZE=2  # ao invés de 3
```

**Recomendações por GPU:**
- RTX A5000 (24GB): BATCH_SIZE=5
- RTX A4000 (16GB): BATCH_SIZE=3
- RTX 2000 Ada (16GB): BATCH_SIZE=3

### Performance Tuning

**Ajustar scaler:**

RunPod Console → Endpoint → Settings:
```
Scaler Type: QUEUE_DELAY
Scaler Value: 2  # workers iniciam com 2 jobs na fila
```

**Multi-worker para img2vid:**

Threshold configurável em `src/orchestrator/services/runpodService.ts:77`:
```typescript
if (operation === 'img2vid' && data.images && data.images.length > 50) {
  // Distribui entre múltiplos workers
}
```

---

## Health Monitoring

### Endpoints de Health Check

```bash
# Orchestrator
curl https://your-api.com/health

# RunPod
curl https://your-api.com/runpod/health

# Transcription
curl https://your-api.com/transcribe/health

# Caption Style
curl https://your-api.com/caption_style/health
```

### Uptime Monitoring

Configure ferramentas como:
- **UptimeRobot** (free tier: 50 monitors)
- **Pingdom**
- **Better Uptime**

**URL para monitorar:**
```
https://your-api.com/health
```

**Intervalo sugerido:** 5 minutos

---

## Backup & Recovery

### Backup do .env

```bash
# Criar backup criptografado
tar -czf env-backup-$(date +%Y%m%d).tar.gz .env
gpg -c env-backup-$(date +%Y%m%d).tar.gz
rm env-backup-$(date +%Y%m%d).tar.gz

# Restaurar
gpg -d env-backup-20251009.tar.gz.gpg | tar -xz
```

### Rollback Docker Image

```bash
# Listar versões
docker images oreiasccp/api-gpu-worker

# Usar versão anterior
curl -s -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer $RUNPOD_API_KEY" \
  -d '{
    "query": "mutation {
      updateEndpointTemplate(input: {
        endpointId: \"your_endpoint_id\",
        templateId: \"previous_template_id\"
      }) { id }
    }"
  }'
```

---

## Production Checklist

- [ ] `.env` configurado com valores de produção
- [ ] `X_API_KEY` forte e único
- [ ] S3 credentials válidas e testadas
- [ ] RunPod endpoint criado e testado
- [ ] Docker image pushed para Docker Hub
- [ ] Orchestrator deployed e acessível
- [ ] Health checks configurados
- [ ] Logs monitorados (PM2/Docker/Easypanel)
- [ ] Backup do `.env` criado
- [ ] CORS configurado (`CORS_ALLOW_ORIGINS`)
- [ ] Timeouts ajustados para workload
- [ ] Uptime monitoring ativo

---

## Referências

- [RunPod Serverless Docs](https://docs.runpod.io/serverless/overview)
- [Docker Hub](https://hub.docker.com)
- [Easypanel Docs](https://easypanel.io/docs)
- [FFmpeg NVENC Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/ffmpeg-with-nvidia-gpu/)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
