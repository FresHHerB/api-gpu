# Deploy no Easypanel (Orchestrator)

Guia passo a passo para deploy do Orchestrator na VPS com Easypanel.

## 📋 Pré-requisitos

- Acesso ao Easypanel da sua VPS
- Conta no Docker Hub (para puxar imagem do worker)
- API Key do Vast.ai

---

## 🚀 Passo 1: Preparar Docker Hub

1. **Fazer login no Docker Hub:**
```bash
docker login -u seuusuario
```

2. **Build e push da imagem worker:**
```bash
# No diretório do projeto
npm run docker:build:worker
npm run docker:push:worker
```

3. **Verificar imagem publicada:**
   - Acesse https://hub.docker.com/r/seuusuario/api-gpu-worker
   - Confirme que a tag `latest` existe

---

## 🚀 Passo 2: Criar App no Easypanel

### 2.1 Criar Novo Projeto

1. Login no Easypanel
2. Clique em **"New Project"**
3. Nome: `api-gpu`

### 2.2 Adicionar Aplicação

1. Dentro do projeto, clique em **"New Service"**
2. Escolha **"App"**
3. Configurações:
   - **Name:** `orchestrator`
   - **Source:** Git Repository

### 2.3 Configurar Git

```
Repository URL: https://github.com/seu-usuario/api-gpu.git
Branch: main
Build Method: Dockerfile
Dockerfile Path: docker/orchestrator.Dockerfile
```

### 2.4 Configurar Porta

```
Internal Port: 3000
External Port: 3000 (ou qualquer porta disponível)
```

---

## 🚀 Passo 3: Configurar Variáveis de Ambiente

No Easypanel, adicione as seguintes variáveis:

```bash
# Server
PORT=3000
NODE_ENV=production

# API Keys
X_API_KEY=sua-chave-publica-12345
GPU_API_KEY=chave-secreta-compartilhada-67890

# Vast.ai
VAST_API_KEY=xxxxxxxxxxxxxxxxx
VAST_WORKER_IMAGE=seuusuario/api-gpu-worker:latest

# Optional
VAST_MIN_VRAM=8
VAST_MAX_PRICE=1.0
LOG_LEVEL=info
```

**Como obter VAST_API_KEY:**
1. Acesse https://vast.ai/console/cli/
2. Copie a chave exibida (formato: `xxxxxxxxxxxxxxxxxxxxxxx`)

---

## 🚀 Passo 4: Deploy

1. Clique em **"Deploy"**
2. Aguarde o build (~3-5 minutos)
3. Verifique os logs para confirmar sucesso

**Logs esperados:**
```
🚀 Orchestrator started
📡 Endpoints: http://0.0.0.0:3000
```

---

## 🚀 Passo 5: Configurar Domínio (Opcional)

### Opção A: Subdomínio Easypanel

1. Em **"Domains"**, adicione:
   ```
   orchestrator.seu-dominio.com
   ```

2. Easypanel irá gerar certificado SSL automático

### Opção B: Domínio Customizado

1. Adicione registro DNS:
   ```
   Type: A
   Name: api
   Value: <IP-da-VPS>
   ```

2. No Easypanel, adicione domínio:
   ```
   api.seu-dominio.com
   ```

---

## ✅ Passo 6: Testar

### 6.1 Health Check

```bash
curl https://orchestrator.seu-dominio.com/health
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "service": "AutoDark Orchestrator",
  "timestamp": "2025-10-01T12:00:00.000Z",
  "uptime": 123.45
}
```

### 6.2 Testar Processamento (quando implementado)

```bash
curl -X POST https://orchestrator.seu-dominio.com/video/caption \
  -H "X-API-Key: sua-chave-publica-12345" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://example.com/subtitles.srt"
  }'
```

---

## 🔧 Troubleshooting

### Build falha

**Erro:** `Cannot find module`
**Solução:** Verifique se `package.json` está commitado

**Erro:** `Dockerfile not found`
**Solução:** Confirme path: `docker/orchestrator.Dockerfile`

### Aplicação não inicia

**Verificar logs:**
```bash
# No Easypanel, vá em "Logs" do serviço
```

**Erro comum:** `VAST_API_KEY is not defined`
**Solução:** Adicione variável de ambiente

### Não consegue criar instância Vast.ai

**Erro:** `401 Unauthorized`
**Solução:** VAST_API_KEY inválida, obtenha nova em https://vast.ai/console/cli/

**Erro:** `No GPU available`
**Solução:** Ajuste `VAST_MIN_VRAM` ou `VAST_MAX_PRICE`

---

## 🔄 Atualizar Aplicação

### Atualização Automática (Git Push)

1. Faça commit das alterações:
```bash
git add .
git commit -m "Update orchestrator"
git push origin main
```

2. No Easypanel:
   - Clique em **"Redeploy"** (ou configure auto-deploy)

### Atualização Manual

1. SSH na VPS
2. Pull do repositório
3. Restart do serviço

---

## 📊 Monitoramento

### Logs em Tempo Real

No Easypanel, clique em **"Logs"** do serviço.

### Métricas

Easypanel mostra automaticamente:
- CPU usage
- Memory usage
- Network I/O

---

## 💰 Custos Estimados

**VPS (Easypanel):**
- CPU: 1 core
- RAM: 512MB-1GB
- Storage: 10GB
- **Custo: $3-5/mês**

**Vast.ai (GPU on-demand):**
- Cobrado apenas durante processamento
- RTX 3060: ~$0.20/hora
- Processamento típico: 1-5 minutos
- **Custo: $0.003-$0.017/vídeo**

---

## 🔐 Segurança

### Recomendações

1. **Usar HTTPS** (Easypanel faz automaticamente)
2. **Rotacionar API Keys** periodicamente
3. **Configurar Rate Limiting** (implementar se necessário)
4. **Monitorar logs** para acessos suspeitos

### Backup

1. **Código:** Git (já versionado)
2. **Logs:** Exportar periodicamente do Easypanel
3. **Variáveis de ambiente:** Documentar em local seguro

---

## ✅ Checklist Final

- [ ] Imagem worker publicada no Docker Hub
- [ ] App criado no Easypanel
- [ ] Variáveis de ambiente configuradas
- [ ] Deploy realizado com sucesso
- [ ] Health check respondendo
- [ ] Domínio configurado (opcional)
- [ ] SSL ativo
- [ ] Logs sendo gerados corretamente
