# 🚀 Quick Start - API GPU

Guia rápido para começar em **5 minutos**.

---

## 1️⃣ Clone e Instale (2 min)

```bash
# Clone o repositório
git clone https://github.com/seu-usuario/api-gpu.git
cd api-gpu

# Instale dependências
npm install

# Copie .env
cp .env.example .env
```

---

## 2️⃣ Configure Credenciais (2 min)

Edite `.env` com suas credenciais:

```bash
# .env

# 1. Sua chave pública (pode ser qualquer string)
X_API_KEY=minha-chave-123

# 2. Chave secreta interna (gere uma aleatória)
GPU_API_KEY=secret-key-$(openssl rand -hex 16)

# 3. API Key Vast.ai (obtenha em https://vast.ai/console/cli/)
VAST_API_KEY=xxxxxxxxxxxxxxxxx

# 4. Sua imagem Docker Hub (depois do build)
VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest
```

---

## 3️⃣ Teste Local (1 min)

### Terminal 1: Orchestrator
```bash
npm run dev:orchestrator
```

### Terminal 2: Worker (simulação)
```bash
npm run dev:worker
```

### Testar Health Check
```bash
# Orchestrator
curl http://localhost:3000/health

# Worker
curl http://localhost:3334/health
```

---

## 4️⃣ Deploy Worker no Docker Hub

```bash
# Login
docker login

# Build
npm run docker:build:worker

# Push (demora ~5-10min na primeira vez)
npm run docker:push:worker
```

---

## 5️⃣ Deploy Orchestrator no Easypanel

1. **Criar App:**
   - Nome: `api-gpu-orchestrator`
   - Source: Git Repository
   - URL: `https://github.com/seu-usuario/api-gpu.git`
   - Dockerfile: `docker/orchestrator.Dockerfile`

2. **Variáveis de ambiente:**
   ```
   PORT=3000
   NODE_ENV=production
   X_API_KEY=minha-chave-123
   GPU_API_KEY=<mesma-do-.env>
   VAST_API_KEY=<sua-vast-key>
   VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest
   ```

3. **Deploy:**
   - Clique em "Deploy"
   - Aguarde 3-5min

---

## ✅ Pronto!

Sua API está rodando em:
```
https://seu-app.easypanel.host
```

### Próximos passos:

- [ ] Testar endpoint `/health`
- [ ] Implementar endpoints de vídeo (próximos commits)
- [ ] Configurar domínio personalizado
- [ ] Adicionar monitoramento

---

## 💡 Comandos Úteis

```bash
# Desenvolvimento
npm run dev:orchestrator    # Roda VPS local
npm run dev:worker         # Roda GPU local

# Build
npm run build              # Build completo

# Docker
npm run docker:build:worker     # Build imagem
npm run docker:push:worker      # Push Docker Hub

# Logs
tail -f logs/combined.log  # Ver logs em tempo real
```

---

## 🆘 Problemas Comuns

### "Cannot find module"
```bash
npm install
```

### "VAST_API_KEY is not defined"
Edite `.env` e adicione sua chave de https://vast.ai/console/cli/

### "Docker push denied"
```bash
docker login
```

### "Port already in use"
```bash
# Mude a porta em .env
PORT=3001
```

---

## 📚 Documentação Completa

- [README Principal](../README.md)
- [Deploy Easypanel](./DEPLOY_EASYPANEL.md)
- [API Reference](./API.md) (em breve)
