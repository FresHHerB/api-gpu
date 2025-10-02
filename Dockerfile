# ============================================
# Orchestrator Dockerfile (VPS/Easypanel)
# ============================================

FROM node:20-alpine

WORKDIR /app

# Copiar package.json
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.orchestrator.json ./

# Copiar código
COPY src/orchestrator ./src/orchestrator
COPY src/shared ./src/shared

# Instalar dependências
RUN npm install

# Build do orchestrator
RUN npm run build:orchestrator

# Remover dev dependencies
RUN npm prune --production

# Criar diretórios
RUN mkdir -p logs

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=3000

# Expor porta
EXPOSE 3000

# Comando de inicialização
CMD ["node", "dist/orchestrator/index.js"]
