# 📖 Explicação Completa do Projeto

## 🎯 Resumo Executivo

Este é um **ÚNICO repositório** (`api-gpu`) que resolve o problema de processar vídeos com GPU de forma escalável e econômica.

### O Problema
- Processar vídeos exige GPU (caro manter sempre ligada)
- VPS comum não tem GPU
- Manter GPU ociosa desperdiça dinheiro

### A Solução
- **VPS (Orchestrator)**: Recebe requisições, gerencia GPUs sob demanda
- **Vast.ai (Worker)**: Aluga GPU apenas quando necessário, destrói após uso
- **Custo**: $3/mês (VPS) + $0.004/vídeo (GPU)

---

## 🏗️ Como Funciona na Prática

### Cenário Real

1. **Cliente envia vídeo para legendar:**
   ```bash
   POST https://sua-vps.com/video/caption
   {
     "url_video": "https://storage.com/video.mp4",
     "url_srt": "https://storage.com/legendas.srt"
   }
   ```

2. **VPS (Orchestrator) recebe:**
   - Valida API key
   - Busca GPU disponível no Vast.ai (RTX 3060, $0.20/h)
   - Cria instância com Docker
   - Aguarda 20s (pull da imagem + boot)

3. **GPU (Worker) processa:**
   - Baixa vídeo e SRT
   - Processa com FFmpeg + CUDA (GPU)
   - Retorna vídeo legendado

4. **VPS finaliza:**
   - Recebe resultado
   - Destrói GPU
   - Retorna ao cliente

**Tempo total**: 20s (setup) + 60s (processar) = 80s
**Custo**: $0.004 por vídeo

---

## 📦 É Apenas 1 Repositório?

**SIM!** Um único repositório com 2 aplicações:

```
api-gpu/  (UM ÚNICO REPO)
├── src/orchestrator/  → Roda na VPS (Easypanel)
├── src/worker/        → Roda no Vast.ai (GPU)
└── src/shared/        → Código compartilhado
```

### Por que não 2 repos separados?

**Vantagens de 1 repo:**
- ✅ Código compartilhado (types, utils, middleware)
- ✅ Versionamento sincronizado
- ✅ Manutenção única
- ✅ TypeScript funciona perfeitamente

**Separação física:**
- 🐳 2 Dockerfiles diferentes
- 🚀 2 deploys diferentes
- 📦 2 builds diferentes

---

## 🚀 Como Subir no Easypanel

### Opção 1: Dockerfile (Recomendado)

1. **Push do código para GitHub:**
   ```bash
   git remote add origin https://github.com/seu-usuario/api-gpu.git
   git push -u origin main
   ```

2. **No Easypanel:**
   - New Service → App
   - Source: **Git Repository**
   - URL: `https://github.com/seu-usuario/api-gpu.git`
   - Dockerfile: `docker/orchestrator.Dockerfile`
   - Port: `3000`

3. **Variáveis de ambiente:**
   ```
   PORT=3000
   NODE_ENV=production
   X_API_KEY=sua-chave
   VAST_API_KEY=xxx
   VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest
   GPU_API_KEY=secret-key
   ```

4. **Deploy:**
   - Clique em "Deploy"
   - Pronto! ✅

### Opção 2: Build Manual (SSH)

```bash
# SSH na VPS
ssh user@vps

# Clone
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

# Instalar e build
npm install
npm run build:orchestrator

# Rodar com PM2
pm2 start dist/orchestrator/index.js --name orchestrator
```

---

## 🐳 Como Funciona o Docker

### 2 Imagens Diferentes

**1. Worker (GPU) - Publicada no Docker Hub:**
```dockerfile
FROM nvidia/pytorch:24.10-py3  # Base com CUDA
# + Node.js
# + FFmpeg
# + Código do worker
```

**Construir:**
```bash
npm run docker:build:worker
npm run docker:push:worker
```

**Resultado:** `seuusuario/api-gpu-worker:latest` no Docker Hub

**2. Orchestrator (VPS) - Usada pelo Easypanel:**
```dockerfile
FROM node:20-alpine  # Leve (sem GPU)
# + Código do orchestrator
```

**Construir:** Easypanel faz automaticamente

---

## 🔄 Fluxo de Instalação Completo

### Setup Inicial (uma vez)

```bash
# 1. Clone
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

# 2. Instale
npm install

# 3. Configure
cp .env.example .env
# Edite .env com suas credenciais

# 4. Build worker e publique
docker login
npm run docker:build:worker
npm run docker:push:worker
```

### Deploy VPS (Easypanel)

1. Criar app no Easypanel
2. Apontar para GitHub
3. Dockerfile: `docker/orchestrator.Dockerfile`
4. Variáveis de ambiente
5. Deploy

**Pronto!** VPS fica esperando requisições.

### Primeiro Uso

```bash
# Testar
curl https://sua-vps.com/health

# Processar vídeo (quando implementar endpoints)
curl -X POST https://sua-vps.com/video/caption \
  -H "X-API-Key: sua-chave" \
  -d '{"url_video": "...", "url_srt": "..."}'
```

VPS irá:
1. Criar GPU no Vast.ai (20s)
2. Processar vídeo (60s)
3. Destruir GPU
4. Retornar resultado

---

## 💻 Desenvolvimento Local

### Testar sem GPU real

```bash
# Terminal 1: Orchestrator
npm run dev:orchestrator

# Terminal 2: Worker (simula GPU)
npm run dev:worker
```

Agora você tem:
- Orchestrator em `http://localhost:3000`
- Worker em `http://localhost:3334`

### Testar fluxo completo

```bash
# Health checks
curl http://localhost:3000/health
curl http://localhost:3334/health
```

---

## 📊 Estrutura de Builds

### Build Separado

```bash
# Build apenas orchestrator
npm run build:orchestrator
→ Gera dist/orchestrator/

# Build apenas worker
npm run build:worker
→ Gera dist/worker/

# Build tudo
npm run build
→ Gera dist/orchestrator/ + dist/worker/
```

### TypeScript Configs

- `tsconfig.json` → Base (comum)
- `tsconfig.orchestrator.json` → Extends base, inclui orchestrator + shared
- `tsconfig.worker.json` → Extends base, inclui worker + shared

---

## 🔑 Variáveis de Ambiente

### Orchestrator (.env)
```bash
X_API_KEY=chave-publica-clientes
GPU_API_KEY=chave-secreta-interna
VAST_API_KEY=xxx
VAST_WORKER_IMAGE=docker-hub-image
```

### Worker (injetado pelo Orchestrator)
```bash
SESSION_TOKEN=<gerado-dinamicamente>
ALLOWED_IPS=<ip-da-vps>
X_API_KEY=<mesmo-GPU_API_KEY>
```

---

## 🎯 Próximos Passos

Após estrutura criada:

1. **Implementar VastAiService** (orchestrator/services/vastAiService.ts)
2. **Implementar FFmpegService** (worker/services/ffmpegService.ts)
3. **Criar rotas de vídeo** (worker/routes/video.ts)
4. **Criar proxy** (orchestrator/routes/videoProxy.ts)
5. **Testar localmente**
6. **Deploy worker no Docker Hub**
7. **Deploy orchestrator no Easypanel**
8. **Testar em produção**

---

## ❓ FAQ

### Preciso de 2 repositórios?
**NÃO.** Um único repositório com 2 aplicações.

### Preciso subir 2 coisas no Easypanel?
**NÃO.** Apenas o orchestrator vai no Easypanel.
O worker vai no Docker Hub e Vast.ai puxa automaticamente.

### Como o worker chega no Vast.ai?
1. Você faz push da imagem para Docker Hub
2. Orchestrator diz ao Vast.ai: "use essa imagem"
3. Vast.ai puxa do Docker Hub e roda

### Posso testar sem Vast.ai?
**SIM.** Use `npm run dev:worker` localmente.

### Quanto custa?
- **VPS (fixo)**: $3-5/mês
- **GPU (variável)**: $0.003-0.017/vídeo
- **Docker Hub**: Grátis (imagem pública)

### Preciso de GPU na minha máquina?
**NÃO.** Desenvolvimento funciona sem GPU (FFmpeg usa CPU).

### Como atualizar o código?
```bash
git push origin main
# Easypanel → Redeploy orchestrator
# Docker Hub → npm run docker:push:worker
```

---

## ✅ Checklist Final

- [ ] Repositório clonado
- [ ] `npm install` executado
- [ ] `.env` configurado
- [ ] Worker buildado e publicado no Docker Hub
- [ ] Orchestrator deployado no Easypanel
- [ ] Health checks funcionando
- [ ] Variáveis de ambiente corretas
- [ ] Pronto para implementar endpoints de vídeo

---

**Dúvidas?** Consulte:
- [README principal](./README.md)
- [Quick Start](./docs/QUICKSTART.md)
- [Deploy Easypanel](./docs/DEPLOY_EASYPANEL.md)
