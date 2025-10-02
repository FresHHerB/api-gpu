# 🎬 API GPU - Video Processing with Vast.ai Auto-Scaling

API completa de processamento de vídeo com orquestração automática de GPUs via Vast.ai. Arquitetura híbrida que combina VPS (orchestrator) + GPU on-demand (worker).

## 📋 Índice

- [Visão Geral](#-visão-geral)
- [Arquitetura](#-arquitetura)
- [Como Funciona](#-como-funciona)
- [Instalação](#-instalação)
- [Deploy](#-deploy)
- [Uso](#-uso)
- [Configuração](#-configuração)
- [Desenvolvimento](#-desenvolvimento)

---

## 🎯 Visão Geral

Este é um **ÚNICO repositório** que contém duas aplicações:

1. **Orchestrator** (VPS/Easypanel): Recebe requisições, gerencia GPUs Vast.ai
2. **Worker** (Vast.ai GPU): Processa vídeos com FFmpeg + CUDA

### Funcionalidades

- ✅ **Caption**: Adiciona legendas SRT a vídeos
- ✅ **Img2Vid**: Converte imagens em vídeos com zoom (Ken Burns)
- ✅ **AdicionaAudio**: Sincroniza áudio com vídeo
- 🚀 **Auto-scaling**: Cria GPU sob demanda, destrói após uso
- 🔒 **Seguro**: IP whitelist + Session tokens + API keys
- 💰 **Econômico**: Paga apenas pelo tempo de processamento

---

## 🏗️ Arquitetura

```
┌─────────────┐
│   Cliente   │
└──────┬──────┘
       │ POST /video/caption
       ▼
┌─────────────────────────────────┐
│  VPS (Easypanel)                │
│  Orchestrator                   │
│  - Recebe requisições           │
│  - Gerencia Vast.ai             │
│  - Faz proxy para GPU           │
└──────┬──────────────────────────┘
       │ 1. Busca GPU
       │ 2. Cria instância
       │ 3. Aguarda (20s)
       ▼
┌─────────────────────────────────┐
│  Vast.ai (GPU RTX 3060)         │
│  Worker (Docker)                │
│  - FFmpeg + CUDA                │
│  - Processa vídeos              │
│  - Retorna resultado            │
└──────┬──────────────────────────┘
       │ 4. Processa (60-300s)
       │ 5. Retorna resultado
       ▼
┌─────────────────────────────────┐
│  VPS (Orchestrator)             │
│  - Destrói GPU                  │
│  - Retorna ao cliente           │
└─────────────────────────────────┘
```

### Estrutura do Repositório

```
api-gpu/
├── src/
│   ├── orchestrator/          # Roda na VPS (Easypanel)
│   │   ├── services/
│   │   │   ├── vastAiService.ts       # Gerencia Vast.ai API
│   │   │   └── instanceManager.ts     # Pool de instâncias
│   │   ├── routes/
│   │   │   └── videoProxy.ts          # Proxy para GPU
│   │   ├── config/
│   │   │   └── env.ts                 # Configurações
│   │   └── index.ts                   # Entry point
│   │
│   ├── worker/                # Roda no Vast.ai (GPU)
│   │   ├── services/
│   │   │   ├── ffmpegService.ts       # Processamento de vídeo
│   │   │   └── gpuDetectionService.ts # Detecção de GPU
│   │   ├── routes/
│   │   │   └── video.ts               # Endpoints de vídeo
│   │   ├── middleware/
│   │   │   ├── auth.ts                # Autenticação
│   │   │   ├── ipWhitelist.ts         # IP filtering
│   │   │   └── sessionAuth.ts         # Session tokens
│   │   └── index.ts                   # Entry point
│   │
│   └── shared/                # Código compartilhado
│       ├── types/
│       │   └── index.ts               # Interfaces TypeScript
│       ├── utils/
│       │   └── logger.ts              # Winston logger
│       └── middleware/
│           └── validation.ts          # Joi schemas
│
├── docker/
│   ├── orchestrator.Dockerfile        # VPS image
│   └── worker.Dockerfile              # GPU image (Docker Hub)
│
├── docs/
│   ├── DEPLOY_EASYPANEL.md           # Guia deploy VPS
│   ├── DEPLOY_VAST.md                # Guia Vast.ai
│   └── API.md                        # Documentação API
│
├── package.json
├── tsconfig.json
├── tsconfig.orchestrator.json
├── tsconfig.worker.json
├── .env.example
├── .gitignore
└── README.md
```

---

## ⚙️ Como Funciona

### 1. Fluxo de uma Requisição

```bash
# Cliente faz requisição
curl -X POST https://sua-vps.com/video/caption \
  -H "X-API-Key: sua-chave" \
  -d '{"url_video": "...", "url_srt": "..."}'

# VPS (Orchestrator)
→ Valida API key
→ Busca GPU disponível no Vast.ai (RTX 3060, $0.20/h)
→ Cria instância com Docker image do Worker
→ Aguarda 20 segundos (pull + inicialização)
→ Obtém IP:porta da instância (ex: 85.10.218.46:43210)

# GPU (Worker)
→ Recebe requisição do Orchestrator
→ Valida IP whitelist + Session token
→ Baixa vídeo e SRT
→ Processa com FFmpeg + NVENC (GPU)
→ Retorna vídeo processado

# VPS (Orchestrator)
→ Recebe resultado
→ Destrói instância GPU
→ Retorna ao cliente

# Total: 20s setup + 60-300s processamento
# Custo: $0.002 - $0.017 por vídeo
```

### 2. Por que 1 Repositório?

**Vantagens:**
- ✅ **Código compartilhado**: Types, utils, middleware
- ✅ **Versionamento sincronizado**: Mudanças em tipos afetam ambos
- ✅ **Build único**: Um `npm install`, um `git clone`
- ✅ **Manutenção simples**: Uma PR, um deploy
- ✅ **Monorepo TypeScript**: Imports diretos `../../shared/types`

**Separação:**
- 📦 **2 builds independentes**: `orchestrator` e `worker`
- 🐳 **2 Dockerfiles**: VPS e GPU
- 🚀 **2 deploys**: Easypanel (orchestrator) + Docker Hub (worker)

---

## 🚀 Instalação

### Pré-requisitos

- Node.js 20+
- Docker + Docker Hub account
- Conta Vast.ai (https://vast.ai)
- Easypanel (VPS)

### 1. Clone e Instale

```bash
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

# Instalar dependências
npm install

# Copiar .env
cp .env.example .env

# Editar .env com suas credenciais
nano .env
```

### 2. Configure Variáveis

```bash
# .env

# Orchestrator (VPS)
PORT=3000
NODE_ENV=production
X_API_KEY=sua-chave-publica-clientes

# Vast.ai
VAST_API_KEY=xxxxxxxxx  # De https://vast.ai/console/cli/
VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest

# Comunicação interna
GPU_API_KEY=chave-secreta-compartilhada
```

### 3. Build Local (Desenvolvimento)

```bash
# Build orchestrator + worker
npm run build

# Rodar orchestrator (simula VPS)
npm run dev:orchestrator

# Rodar worker (simula GPU) - em outro terminal
npm run dev:worker
```

---

## 🐳 Deploy

### Deploy é feito em 2 partes:

1. **Worker (GPU)** → Docker Hub (uma vez)
2. **Orchestrator (VPS)** → Easypanel (sempre ativo)

---

### Parte 1: Build e Publicar Worker (Docker Hub)

```bash
# 1. Login no Docker Hub
docker login

# 2. Build da imagem worker
npm run docker:build:worker

# 3. Push para Docker Hub (público ou privado)
npm run docker:push:worker

# Pronto! Vast.ai agora pode puxar essa imagem
```

**Imagem gerada:**
- Nome: `seuusuario/api-gpu-worker:latest`
- Tamanho: ~5GB (PyTorch + CUDA + FFmpeg + Node)
- Conteúdo: Worker + Shared
- Base: `nvcr.io/nvidia/pytorch:24.10-py3`

---

### Parte 2: Deploy Orchestrator no Easypanel

#### Opção A: Via Dockerfile (Recomendado)

1. **No Easypanel:**
   - Criar novo App
   - Nome: `api-gpu-orchestrator`
   - Source: Git Repository

2. **Configurar:**
   ```yaml
   Git URL: https://github.com/seu-usuario/api-gpu.git
   Branch: main
   Dockerfile: docker/orchestrator.Dockerfile
   Port: 3000
   ```

3. **Variáveis de Ambiente:**
   ```bash
   PORT=3000
   NODE_ENV=production
   X_API_KEY=sua-chave-publica
   VAST_API_KEY=xxxxxxxx
   VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest
   GPU_API_KEY=chave-secreta-compartilhada
   ```

4. **Deploy:**
   - Clique em "Deploy"
   - Aguarde build (~2min)
   - Acesse em `https://api-gpu-orchestrator.seu-dominio.com`

#### Opção B: Via Build Manual

```bash
# No servidor (SSH)
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

npm install
npm run build:orchestrator

# Rodar com PM2
pm2 start dist/orchestrator/index.js --name orchestrator
pm2 save
```

---

## 📡 Uso

### 1. Health Check

```bash
curl https://sua-vps.com/health

# Response:
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-10-01T12:00:00.000Z"
}
```

### 2. Processar Vídeo com Caption

```bash
curl -X POST https://sua-vps.com/video/caption \
  -H "X-API-Key: sua-chave" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://example.com/subtitles.srt"
  }'

# Response (após ~80s):
{
  "code": 200,
  "message": "Video caption added successfully",
  "video_url": "http://85.10.218.46:43210/output/captioned-123.mp4",
  "execution": {
    "durationSeconds": 75.2
  }
}
```

### 3. Converter Imagem em Vídeo

```bash
curl -X POST https://sua-vps.com/video/img2vid \
  -H "X-API-Key: sua-chave" \
  -H "Content-Type: application/json" \
  -d '{
    "url_image": "https://example.com/image.jpg",
    "frame_rate": 24,
    "duration": 5.0
  }'
```

---

## 🔧 Configuração

### Vast.ai - Obter API Key

1. Acesse https://vast.ai/console/cli/
2. Copie o comando `vastai set api-key xxxxxxx`
3. Copie apenas a chave (depois de `api-key`)
4. Cole em `.env` → `VAST_API_KEY=xxxxxxx`

### Docker Hub - Publicar Imagem

```bash
# 1. Criar conta em https://hub.docker.com
# 2. Criar repositório: api-gpu-worker (público)
# 3. Login
docker login -u seuusuario

# 4. Build e push
npm run docker:build:worker
npm run docker:push:worker
```

### Configurações de Segurança

**Orchestrator:**
- `X_API_KEY`: Chave pública para clientes externos
- `GPU_API_KEY`: Chave secreta compartilhada (Orchestrator ↔ Worker)

**Worker:**
- `ALLOWED_IPS`: IP da VPS (injetado automaticamente)
- `SESSION_TOKEN`: Token único por instância (gerado dinamicamente)
- `X_API_KEY`: Mesma chave do Orchestrator

---

## 💻 Desenvolvimento

### Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev:orchestrator    # Roda VPS localmente
npm run dev:worker         # Roda GPU localmente

# Build
npm run build              # Build completo
npm run build:orchestrator # Build apenas orchestrator
npm run build:worker       # Build apenas worker

# Docker
npm run docker:build:worker    # Build imagem worker
npm run docker:push:worker     # Push para Docker Hub
npm run docker:build:orchestrator  # Build imagem orchestrator

# Produção
npm run start:orchestrator  # Roda orchestrator (VPS)
npm run start:worker       # Roda worker (GPU)
```

### Estrutura de Imports

```typescript
// Orchestrator pode importar Shared
import { VideoRequest } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

// Worker pode importar Shared
import { FFmpegService } from './services/ffmpegService';
import { logger } from '../../shared/utils/logger';

// Shared NÃO importa Orchestrator ou Worker
```

### Adicionar Novo Endpoint

1. **Criar tipo em `shared/types/index.ts`:**
```typescript
export interface NewFeatureRequest {
  param1: string;
  param2: number;
}
```

2. **Implementar no Worker `worker/routes/video.ts`:**
```typescript
router.post('/video/newfeature', authenticateToken, async (req, res) => {
  // Lógica de processamento
});
```

3. **Adicionar proxy no Orchestrator `orchestrator/routes/videoProxy.ts`:**
```typescript
router.post('/video/newfeature', authenticateToken, (req, res) =>
  handleVideoProcessing(req, res, 'newfeature')
);
```

---

## 📊 Custos Estimados

### Vast.ai GPU Pricing

| GPU | VRAM | Preço/hora | Setup | Processar 1min vídeo | Total/vídeo |
|-----|------|------------|-------|---------------------|-------------|
| RTX 3060 | 12GB | $0.20 | 20s | 60s | $0.004 |
| RTX 3080 | 10GB | $0.35 | 20s | 40s | $0.006 |
| RTX 4090 | 24GB | $0.80 | 20s | 25s | $0.010 |

**Exemplo (RTX 3060):**
- Setup: 20s = $0.001
- Processar: 60s = $0.003
- **Total: $0.004/vídeo**

### VPS (Easypanel) - Sempre Ativo

- CPU: 1 core
- RAM: 512MB
- Storage: 10GB
- **Custo: $3-5/mês**

**Custo total:** VPS fixo + GPU on-demand

---

## 🔒 Segurança

### Camadas de Proteção

1. **Orchestrator:**
   - API Key validation
   - Rate limiting
   - CORS configured

2. **Worker:**
   - IP Whitelist (apenas VPS)
   - Session Token (único por instância)
   - API Key validation

3. **Vast.ai:**
   - Instâncias efêmeras (vida curta)
   - Sem dados sensíveis armazenados

---

## 🐛 Troubleshooting

### Worker não inicia no Vast.ai

```bash
# Verificar logs da instância
vastai ssh-url <instance_id>
ssh -p PORT root@IP
docker logs <container_id>
```

### Orchestrator não encontra GPU

```bash
# Verificar API key Vast.ai
curl -H "Authorization: Bearer $VAST_API_KEY" \
  https://console.vast.ai/api/v0/bundles/
```

### Timeout ao processar

- Aumentar timeout em `orchestrator/routes/videoProxy.ts`
- Verificar se GPU tem VRAM suficiente

---

## 📚 Documentação Adicional

- [Deploy no Easypanel](./docs/DEPLOY_EASYPANEL.md)
- [Configurar Vast.ai](./docs/DEPLOY_VAST.md)
- [API Reference](./docs/API.md)

---

## 📝 Licença

MIT

---

## 🤝 Contribuindo

1. Fork o projeto
2. Crie uma branch (`git checkout -b feature/NovaFeature`)
3. Commit (`git commit -m 'Add NovaFeature'`)
4. Push (`git push origin feature/NovaFeature`)
5. Abra um Pull Request

---

## 📞 Suporte

Para problemas e dúvidas:
- Verifique os logs em `/logs`
- Consulte a documentação em `/docs`
- Abra uma issue no GitHub
