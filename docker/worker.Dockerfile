# ==================================
# Worker Dockerfile (RunPod Serverless)
# ==================================
# Imagem leve com CUDA + FFmpeg NVENC + Node.js
# Otimizado para RunPod Serverless + FlashBoot

FROM nvidia/cuda:12.1.0-base-ubuntu22.04

# Metadata
LABEL maintainer="your-email@example.com"
LABEL description="RunPod Serverless GPU Worker for video processing with FFmpeg + CUDA"

# Instalar Node.js 20, FFmpeg com NVENC e dependências
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    xz-utils \
    ca-certificates \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xf ffmpeg-release-amd64-static.tar.xz \
    && mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ \
    && mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ \
    && rm -rf ffmpeg-* \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verificar instalações
RUN node --version && npm --version && ffmpeg -version

# Diretório de trabalho
WORKDIR /app

# Copiar package.json e tsconfig primeiro (cache de camadas)
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.worker.json ./

# Copiar código worker + shared
COPY src/worker ./src/worker
COPY src/shared ./src/shared

# Instalar todas as dependências (incluindo dev) para build
RUN npm install

# Build do worker usando tsconfig.worker.json
RUN npx tsc --project tsconfig.worker.json

# Remover dev dependencies após build
RUN npm prune --production

# Criar diretórios necessários para processamento
RUN mkdir -p /tmp/work /tmp/output /app/logs

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV WORK_DIR=/tmp/work
ENV OUTPUT_DIR=/tmp/output
ENV LOGS_DIR=/app/logs

# RunPod Serverless não precisa de EXPOSE ou HEALTHCHECK
# O handler é chamado diretamente pelo RunPod

# Comando de inicialização (handler para RunPod Serverless)
CMD ["node", "dist/worker/handler.js"]
