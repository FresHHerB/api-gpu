# ==================================
# Worker Dockerfile (Vast.ai GPU)
# ==================================
# Baseado em NVIDIA PyTorch com CUDA
# Publicado no Docker Hub

FROM nvcr.io/nvidia/pytorch:24.10-py3

# Metadata
LABEL maintainer="your-email@example.com"
LABEL description="GPU Worker for video processing with FFmpeg + CUDA"

# Instalar Node.js 20 e FFmpeg
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    git \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verificar instalações
RUN node --version && npm --version && ffmpeg -version

# Diretório de trabalho
WORKDIR /app

# Copiar package.json primeiro (cache de camadas)
COPY package*.json ./

# Instalar dependências de produção
RUN npm ci --only=production

# Copiar código worker + shared
COPY src/worker ./src/worker
COPY src/shared ./src/shared
COPY tsconfig.worker.json ./tsconfig.json

# Build do worker
RUN npm install -g typescript
RUN tsc -p tsconfig.json

# Criar diretórios necessários
RUN mkdir -p /app/temp /app/output /app/logs

# Expor porta padrão
EXPOSE 3334

# Variáveis de ambiente padrão
ENV PORT=3334
ENV NODE_ENV=production
ENV TEMP_DIR=/app/temp
ENV OUTPUT_DIR=/app/output
ENV LOGS_DIR=/app/logs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3334/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Comando de inicialização
CMD ["node", "dist/worker/index.js"]
