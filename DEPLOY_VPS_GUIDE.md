# 🚀 Guia de Deploy na VPS - Passo a Passo

**VPS IP:** 185.173.110.7

---

## **PASSO 1: Conectar na VPS**

Abra seu terminal (PowerShell ou CMD) e conecte:

```bash
ssh root@185.173.110.7
```

Se pedir senha, digite a senha do usuário root.

---

## **PASSO 2: Instalar Node.js 20**

```bash
# Atualizar sistema
apt update && apt upgrade -y

# Instalar Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# Verificar instalação
node --version  # Deve mostrar v20.x.x
npm --version   # Deve mostrar 10.x.x
```

---

## **PASSO 3: Clonar Repositório**

```bash
# Criar diretório
mkdir -p ~/apps
cd ~/apps

# Clonar projeto
git clone https://github.com/FresHHerB/api-gpu.git
cd api-gpu
```

---

## **PASSO 4: Criar arquivo .env**

```bash
cat > .env << 'EOF'
# RunPod Configuration
RUNPOD_API_KEY=YOUR_RUNPOD_API_KEY_HERE
RUNPOD_ENDPOINT_ID=YOUR_ENDPOINT_ID_HERE
RUNPOD_IDLE_TIMEOUT=300
RUNPOD_MAX_TIMEOUT=600

# Orchestrator Configuration
PORT=3000
NODE_ENV=production
X_API_KEY=YOUR_SECURE_API_KEY_HERE

# Logging
LOG_LEVEL=info
LOGS_DIR=./logs

# CORS
CORS_ALLOW_ORIGINS=*
EOF
```

**IMPORTANTE**: Edite o arquivo .env e substitua os placeholders pelas suas chaves reais:
```bash
nano .env
# Substitua YOUR_RUNPOD_API_KEY_HERE pela sua chave RunPod
# Substitua YOUR_ENDPOINT_ID_HERE pelo ID do seu endpoint RunPod
# Substitua YOUR_SECURE_API_KEY_HERE por uma chave API segura de sua escolha

# Verificar
cat .env
```

---

## **PASSO 5: Instalar Dependências e Buildar**

```bash
# Instalar dependências
npm install

# Buildar orchestrator
npm run build:orchestrator

# Criar diretório de logs
mkdir -p logs

# Verificar build
ls -la dist/orchestrator/
```

Você deve ver arquivos `.js` na pasta.

---

## **PASSO 6: Instalar PM2**

```bash
# Instalar PM2 globalmente
npm install -g pm2

# Criar arquivo de configuração
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [{
    name: 'api-gpu-orchestrator',
    script: 'dist/orchestrator/index.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production'
    },
    error_file: 'logs/pm2-error.log',
    out_file: 'logs/pm2-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s'
  }]
}
EOF
```

---

## **PASSO 7: Iniciar Aplicação**

```bash
# Iniciar com PM2
pm2 start ecosystem.config.js

# Verificar status
pm2 status

# Ver logs
pm2 logs
```

Você deve ver:
```
🚀 Orchestrator started at http://0.0.0.0:3000
✅ RunPod client initialized
```

Aperte `Ctrl+C` para sair dos logs.

---

## **PASSO 8: Configurar Auto-start**

```bash
# Salvar configuração PM2
pm2 save

# Configurar para iniciar no boot
pm2 startup

# Execute o comando que aparecer (algo como):
# sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u root --hp /root
```

---

## **PASSO 9: Abrir Porta no Firewall**

```bash
# Verificar se firewall está ativo
ufw status

# Se estiver inativo, ativar
ufw enable

# Permitir SSH (importante!)
ufw allow 22/tcp

# Permitir porta 3000
ufw allow 3000/tcp

# Verificar regras
ufw status
```

---

## **PASSO 10: Testar API**

**Do seu PC local**, abra terminal e teste:

```bash
# Health check básico
curl http://185.173.110.7:3000/health

# Deve retornar:
# {"status":"ok","timestamp":"...","uptime":...}

# Health check RunPod
curl http://185.173.110.7:3000/runpod/health \
  -H "X-API-Key: api-gpu-2025-secure-key-production"

# Deve retornar:
# {"status":"ok","runpod":{"connected":true,"endpoint":"5utj4m2ukiumpp"}}
```

---

## **✅ Deploy Completo!**

Sua API está rodando em: **http://185.173.110.7:3000**

### Comandos Úteis:

```bash
# Ver status
pm2 status

# Ver logs em tempo real
pm2 logs

# Reiniciar
pm2 restart api-gpu-orchestrator

# Parar
pm2 stop api-gpu-orchestrator

# Ver métricas
pm2 monit
```

---

## **🔧 Troubleshooting**

### Erro: "Cannot connect"
```bash
# Verificar se app está rodando
pm2 status

# Ver logs de erro
pm2 logs --err

# Reiniciar
pm2 restart api-gpu-orchestrator
```

### Erro: "Port already in use"
```bash
# Verificar o que está usando porta 3000
lsof -i :3000

# Matar processo
kill -9 <PID>

# Reiniciar PM2
pm2 restart api-gpu-orchestrator
```

### Atualizar código
```bash
cd ~/apps/api-gpu
git pull origin main
npm install
npm run build:orchestrator
pm2 restart api-gpu-orchestrator
```

---

## **📊 Monitoramento**

### Ver logs do RunPod:
1. Acesse: https://www.runpod.io/console/serverless
2. Click em **api-gpu-worker**
3. Vá em **Logs** ou **Workers**

### Ver logs da VPS:
```bash
# Logs do PM2
pm2 logs

# Logs diretos
tail -f logs/app.log
tail -f logs/error.log
tail -f logs/pm2-out.log
tail -f logs/pm2-error.log
```

---

## **🎯 Endpoints Disponíveis**

Base URL: `http://185.173.110.7:3000`

### Health Checks:
- `GET /health` - Health básico
- `GET /runpod/health` - Health RunPod (precisa X-API-Key)

### Processamento de Vídeo:
- `POST /video/caption` - Adicionar legendas
- `POST /video/img2vid` - Imagem para vídeo
- `POST /video/addaudio` - Adicionar áudio

Todos os endpoints de vídeo precisam do header:
```
X-API-Key: api-gpu-2025-secure-key-production
```

---

**Pronto para produção!** 🎉
