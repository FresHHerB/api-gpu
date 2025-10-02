#!/bin/bash

# ============================================
# Script de Deploy Automático na VPS
# ============================================

set -e  # Para na primeira erro

echo "🚀 Iniciando deploy na VPS..."

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Funções
print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# ============================================
# 1. Atualizar Sistema
# ============================================
print_info "Atualizando sistema..."
apt update && apt upgrade -y
print_success "Sistema atualizado"

# ============================================
# 2. Instalar Node.js 20
# ============================================
if ! command -v node &> /dev/null; then
    print_info "Instalando Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs git
    print_success "Node.js instalado: $(node --version)"
else
    print_success "Node.js já instalado: $(node --version)"
fi

# ============================================
# 3. Clonar ou Atualizar Repositório
# ============================================
APP_DIR="$HOME/apps/api-gpu"

if [ -d "$APP_DIR" ]; then
    print_info "Atualizando repositório..."
    cd $APP_DIR
    git pull origin main
else
    print_info "Clonando repositório..."
    mkdir -p ~/apps
    cd ~/apps
    git clone https://github.com/FresHHerB/api-gpu.git
    cd api-gpu
fi

print_success "Código atualizado"

# ============================================
# 4. Criar .env (se não existir)
# ============================================
if [ ! -f ".env" ]; then
    print_info "Criando arquivo .env..."
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
    print_success "Arquivo .env criado - ATENÇÃO: Configure as chaves de API!"
    print_info "Edite o arquivo .env e adicione suas chaves de API"
else
    print_success "Arquivo .env já existe"
fi

# ============================================
# 5. Instalar Dependências
# ============================================
print_info "Instalando dependências..."
npm install
print_success "Dependências instaladas"

# ============================================
# 6. Buildar Orchestrator
# ============================================
print_info "Buildando orchestrator..."
npm run build:orchestrator
print_success "Build concluído"

# ============================================
# 7. Criar Diretórios
# ============================================
mkdir -p logs
print_success "Diretórios criados"

# ============================================
# 8. Instalar PM2
# ============================================
if ! command -v pm2 &> /dev/null; then
    print_info "Instalando PM2..."
    npm install -g pm2
    print_success "PM2 instalado"
else
    print_success "PM2 já instalado"
fi

# ============================================
# 9. Criar ecosystem.config.js
# ============================================
print_info "Criando configuração PM2..."
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
print_success "Configuração PM2 criada"

# ============================================
# 10. Iniciar/Reiniciar Aplicação
# ============================================
print_info "Iniciando aplicação..."
if pm2 list | grep -q "api-gpu-orchestrator"; then
    pm2 restart api-gpu-orchestrator
    print_success "Aplicação reiniciada"
else
    pm2 start ecosystem.config.js
    print_success "Aplicação iniciada"
fi

pm2 save
print_success "Configuração PM2 salva"

# ============================================
# 11. Configurar Firewall
# ============================================
print_info "Configurando firewall..."
if command -v ufw &> /dev/null; then
    ufw --force enable
    ufw allow 22/tcp
    ufw allow 3000/tcp
    print_success "Firewall configurado"
else
    print_info "UFW não encontrado, pulando configuração de firewall"
fi

# ============================================
# 12. Verificar Status
# ============================================
echo ""
echo "============================================"
print_success "Deploy concluído!"
echo "============================================"
echo ""
pm2 status
echo ""
print_info "API rodando em: http://$(curl -s ifconfig.me):3000"
print_info "Logs: pm2 logs"
print_info "Status: pm2 status"
print_info "Restart: pm2 restart api-gpu-orchestrator"
echo ""
print_success "Tudo pronto! 🎉"
