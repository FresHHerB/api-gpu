# 🚀 Deploy Guide: RunPod Serverless

Guia completo para deploy do worker no RunPod Serverless e configuração do orchestrator.

---

## 📋 Pré-requisitos

- Conta RunPod (https://runpod.io)
- Docker instalado localmente
- Docker Hub account (https://hub.docker.com)
- Git repository configurado

---

## 🔧 Parte 1: Build e Publicar Worker Image

### 1.1. Login no Docker Hub

```bash
docker login
# Username: seu-usuario
# Password: sua-senha
```

### 1.2. Build da Imagem Worker

```bash
# Build com tag específica
docker build -f docker/worker.Dockerfile -t seu-usuario/api-gpu-worker:latest .

# Ou usar npm script
npm run docker:build:worker
```

**Tempo estimado:** 10-15 minutos (primeira vez)

### 1.3. Push para Docker Hub

```bash
# Push da imagem
docker push seu-usuario/api-gpu-worker:latest

# Ou usar npm script
npm run docker:push:worker
```

**Tempo estimado:** 5-10 minutos (depende da conexão)

---

## 🎬 Parte 2: Criar Endpoint RunPod Serverless

### 2.1. Acessar RunPod Console

1. Acesse: https://runpod.io/console
2. Navegue para **Serverless** → **Endpoints**
3. Clique em **+ New Endpoint**

### 2.2. Configurar Endpoint

```yaml
# Configuração básica
Name: api-gpu-worker
Description: Video processing with FFmpeg + CUDA

# Container Configuration
Container Image: seu-usuario/api-gpu-worker:latest
Container Registry Credentials: (se imagem privada)
Container Disk: 10 GB
```

### 2.3. GPU Configuration

```yaml
# GPU Selection
GPU Types:
  - NVIDIA RTX 3060 Ti (12GB)
  - NVIDIA RTX 3060 (12GB)
  - NVIDIA RTX 3070 (8GB)

  # Ou mais potentes:
  - NVIDIA RTX 4090 (24GB)
  - NVIDIA A40 (48GB)

# Recomendação: RTX 3060 Ti (melhor custo-benefício)
```

### 2.4. Scaling Configuration

**IMPORTANTE:** Configurações de Idle Timeout

```yaml
# Workers
Min Workers: 0          # ✅ Scale to zero quando idle
Max Workers: 10         # Ajuste conforme necessário
GPUs per Worker: 1

# Scaling Strategy
Scaling Type: Request Count
Requests per Worker: 1  # 1 job por worker (vídeo processing)

# Timeout Settings (CRÍTICO)
Idle Timeout: 300       # ✅ 5 minutos (requisito do projeto)
Execution Timeout: 600  # 10 minutos máximo por job

# FlashBoot (opcional mas recomendado)
FlashBoot: Enabled      # ✅ Cold start <1s
```

### 2.5. Advanced Settings

```yaml
# Environment Variables (opcional)
Environment Variables:
  - WORK_DIR=/tmp/work
  - OUTPUT_DIR=/tmp/output

# Execution Policy
Max Concurrent Requests: 10  # Mesmo que Max Workers
```

### 2.6. Criar Endpoint

1. Clique em **Create Endpoint**
2. Aguarde provisionamento (~2-3min)
3. **Copie o Endpoint ID** (ex: `abc123def456`)

---

## 🔑 Parte 3: Obter API Key

### 3.1. Criar/Obter API Key

1. Acesse: https://runpod.io/console/user/settings
2. Navegue para **API Keys**
3. Clique em **+ Create API Key**
4. Nome: `api-gpu-orchestrator`
5. Permissions: **Read & Write**
6. **Copie a API Key** (ex: `RUNPOD_API_KEY_...`)

⚠️ **IMPORTANTE:** Guarde a API key em local seguro (não commitada no git)

---

## ⚙️ Parte 4: Configurar Orchestrator

### 4.1. Configurar Variáveis de Ambiente

Edite `.env` no orchestrator:

```bash
# .env (VPS/Easypanel)

# API Key pública para clientes
X_API_KEY=sua-chave-publica-12345

# RunPod Configuration
RUNPOD_API_KEY=RUNPOD_API_KEY_xxxxxxxxxxxxxxxxxxxxxxxxx
RUNPOD_ENDPOINT_ID=abc123def456
RUNPOD_IDLE_TIMEOUT=300  # 5 minutos
RUNPOD_MAX_TIMEOUT=600   # 10 minutos

# Server
PORT=3000
NODE_ENV=production
```

### 4.2. Deploy Orchestrator

#### Opção A: Easypanel (Recomendado)

1. **Criar App no Easypanel:**
   - Nome: `api-gpu-orchestrator`
   - Source: Git Repository
   - URL: `https://github.com/seu-usuario/api-gpu.git`
   - Branch: `main`

2. **Build Configuration:**
   ```yaml
   Dockerfile: docker/orchestrator.Dockerfile
   Build Context: .
   ```

3. **Environment Variables:**
   - Adicionar todas as variáveis do `.env` acima

4. **Port Mapping:**
   - Container Port: `3000`
   - Public Port: `80` (ou custom)

5. **Deploy:**
   - Clique em "Deploy"
   - Aguarde ~3-5min

#### Opção B: Deploy Manual (VPS)

```bash
# SSH na VPS
ssh user@sua-vps.com

# Clone repository
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

# Instalar dependências
npm install

# Configurar .env
cp .env.example .env
nano .env  # Editar com suas credenciais

# Build
npm run build:orchestrator

# Rodar com PM2
pm2 start dist/orchestrator/index.js --name orchestrator
pm2 save
pm2 startup
```

---

## ✅ Parte 5: Testar Deployment

### 5.1. Health Check (Orchestrator)

```bash
curl https://seu-dominio.com/health

# Expected response:
{
  "status": "healthy",
  "service": "AutoDark Orchestrator - RunPod Serverless",
  "timestamp": "2025-10-02T...",
  "uptime": 123.45
}
```

### 5.2. RunPod Health Check

```bash
curl -H "X-API-Key: sua-chave" \
  https://seu-dominio.com/runpod/health

# Expected response:
{
  "status": "healthy",
  "endpoint": "RunPod Serverless",
  "timestamp": "2025-10-02T..."
}
```

### 5.3. Test Video Processing

#### Caption Test

```bash
curl -X POST https://seu-dominio.com/video/caption \
  -H "X-API-Key: sua-chave" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/test-video.mp4",
    "url_srt": "https://example.com/subtitles.srt"
  }'

# Expected response (após ~60-90s):
{
  "code": 200,
  "message": "Video caption completed successfully",
  "video_url": "file:///tmp/output/job_..._captioned.mp4",
  "execution": {
    "startTime": "2025-10-02T...",
    "endTime": "2025-10-02T...",
    "durationMs": 75234,
    "durationSeconds": 75.23
  },
  "stats": {
    "jobId": "abc123-...",
    "delayTime": 1234,
    "executionTime": 73000,
    ...
  }
}
```

#### Img2Vid Test

```bash
curl -X POST https://seu-dominio.com/video/img2vid \
  -H "X-API-Key: sua-chave" \
  -H "Content-Type: application/json" \
  -d '{
    "url_image": "https://example.com/image.jpg",
    "frame_rate": 24,
    "duration": 5.0
  }'
```

---

## 📊 Parte 6: Monitoramento

### 6.1. RunPod Console

Acesse: https://runpod.io/console/serverless

**Métricas disponíveis:**
- Active workers
- Request queue
- Success/failure rate
- Execution time
- Cost per hour

### 6.2. Logs do Orchestrator

```bash
# PM2 logs
pm2 logs orchestrator

# Ou tail direto
tail -f logs/combined.log
```

### 6.3. Logs do Worker (RunPod)

No RunPod Console:
1. Serverless → Endpoints
2. Click no seu endpoint
3. Aba "Logs"

---

## 💰 Parte 7: Custos e Otimização

### 7.1. Preços RunPod (Estimativa)

| GPU | VRAM | Preço/hora | Setup | 1min vídeo | Total/job |
|-----|------|------------|-------|------------|-----------|
| RTX 3060 Ti | 12GB | $0.18 | <1s | 60s | $0.003 |
| RTX 3080 | 10GB | $0.30 | <1s | 40s | $0.003 |
| RTX 4090 | 24GB | $0.70 | <1s | 25s | $0.005 |

**Com Idle Timeout (5min):**
- Processing: 60s × $0.18/h = $0.003
- Idle: 300s × $0.18/h = $0.015
- **Total: $0.018/vídeo**

### 7.2. Projeções de Custo

**Volume: 1000 vídeos/mês**
```
Fixo (VPS): $5/mês
Variável (RunPod): 1000 × $0.018 = $18/mês
Total: $23/mês
```

**Volume: 10000 vídeos/mês**
```
Fixo (VPS): $5/mês
Variável (RunPod): 10000 × $0.018 = $180/mês
Total: $185/mês
```

### 7.3. Otimizações

**Para reduzir custos:**
1. ✅ Reduzir idle timeout para 60s (se tráfego esparso)
2. ✅ Usar GPU mais barata (RTX 3060 vs 4090)
3. ✅ Batch processing (processar múltiplos vídeos por worker)

**Para reduzir latência:**
1. ✅ Min Workers = 1 (sempre ativo, sem cold start)
2. ✅ GPU mais rápida (RTX 4090)
3. ✅ FlashBoot enabled

---

## 🔧 Troubleshooting

### Problema: Worker não inicia

**Sintomas:** Jobs ficam em `IN_QUEUE` indefinidamente

**Soluções:**
1. Verificar se imagem Docker existe no Docker Hub
2. Verificar logs do RunPod Console
3. Testar imagem localmente:
   ```bash
   docker run --rm seu-usuario/api-gpu-worker:latest
   ```

### Problema: Jobs falham com timeout

**Sintomas:** Jobs retornam `TIMED_OUT`

**Soluções:**
1. Aumentar `RUNPOD_MAX_TIMEOUT` no `.env`
2. Aumentar Execution Timeout no RunPod Console
3. Otimizar processamento FFmpeg

### Problema: Custo muito alto

**Sintomas:** Billing maior que esperado

**Soluções:**
1. Verificar se workers estão sendo destruídos (idle timeout)
2. Reduzir Max Workers se não precisa de concorrência alta
3. Monitorar métricas no RunPod Console

---

## 📚 Recursos Adicionais

- [RunPod Serverless Docs](https://docs.runpod.io/serverless)
- [RunPod API Reference](https://docs.runpod.io/serverless/endpoints/send-requests)
- [Comparação RunPod vs Vast.ai](./COMPARACAO_RUNPOD_VS_VASTAI.md)
- [Implementação Idle Timeout](./IMPLEMENTACAO_IDLE_TIMEOUT.md)

---

## ✅ Checklist de Deploy

- [ ] Imagem worker buildada e publicada no Docker Hub
- [ ] Endpoint RunPod criado com idle timeout = 300s
- [ ] API Key RunPod obtida
- [ ] Endpoint ID copiado
- [ ] `.env` configurado no orchestrator
- [ ] Orchestrator deployado no Easypanel/VPS
- [ ] Health checks funcionando
- [ ] Test de vídeo bem-sucedido
- [ ] Monitoramento configurado
- [ ] Billing/costs monitorados

**Pronto!** 🎉 Seu sistema está em produção com RunPod Serverless!
