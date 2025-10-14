# ==================================
# Orchestrator Dockerfile (VPS)
# ==================================
# Imagem leve para gerenciar Vast.ai

FROM node:20-alpine

# Metadata
LABEL maintainer="your-email@example.com"
LABEL description="Orchestrator for GPU auto-scaling with Vast.ai"

# Instalar dependências do sistema
RUN apk add --no-cache \
    curl \
    git \
    ffmpeg

WORKDIR /app

# Copiar package files
COPY package.json package-lock.json ./

# Instalar dependências (incluindo dev para build)
RUN npm install

# Copiar código orchestrator + shared
COPY src/orchestrator ./src/orchestrator
COPY src/shared ./src/shared
COPY tsconfig.json ./
COPY tsconfig.orchestrator.json ./

# Build do orchestrator
RUN npm run build:orchestrator

# Limpar dev dependencies após build
RUN npm prune --production

# Criar diretórios
RUN mkdir -p /app/logs /tmp/vps-work /tmp/vps-output && \
    chmod 777 /tmp/vps-work /tmp/vps-output

# Expor porta
EXPOSE 3000

# Variáveis de ambiente padrão
ENV PORT=3000
ENV NODE_ENV=production
ENV LOGS_DIR=/app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Comando de inicialização
CMD ["node", "dist/orchestrator/index.js"]
