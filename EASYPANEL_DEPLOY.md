# 🚀 Deploy no Easypanel/VPS

## ✅ Código já está no GitHub

**Commit**: `9d20b26`
**Branch**: `main`

---

## 📋 Passos para Deploy

### Opção 1: Deploy Automático (se configurado)

Se o Easypanel está conectado ao repositório Git:

1. Acesse o painel do Easypanel
2. Vá até o serviço `api-gpu` (orchestrator)
3. Clique em **Deploy** ou **Rebuild**
4. Aguarde o build e restart automático

---

### Opção 2: Deploy Manual via Docker

Se você tem acesso SSH ao VPS:

```bash
# 1. Conectar ao VPS
ssh user@your-vps-ip

# 2. Navegar até o diretório do projeto
cd /path/to/api-gpu

# 3. Pull das alterações
git pull origin main

# 4. Build da imagem Docker
docker build -f docker/orchestrator.Dockerfile -t api-gpu-orchestrator:latest .

# 5. Parar container antigo
docker stop api-gpu-orchestrator

# 6. Remover container antigo
docker rm api-gpu-orchestrator

# 7. Iniciar novo container
docker run -d \
  --name api-gpu-orchestrator \
  --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  api-gpu-orchestrator:latest

# 8. Verificar logs
docker logs -f api-gpu-orchestrator
```

---

### Opção 3: Restart no Easypanel (Sem Rebuild)

Se o código já está no servidor mas não foi aplicado:

1. Acesse Easypanel
2. Vá em Services > `api-gpu`
3. Clique em **Restart**

⚠️ **ATENÇÃO**: Isso só funciona se o código foi atualizado mas o servidor não foi reiniciado.

---

## 🧪 Verificar Deploy

Após o deploy, teste o endpoint:

```bash
# Health Check
curl https://api-gpu.automear.com/health

# Testar nova rota
curl -X POST "https://api-gpu.automear.com/video/caption_style" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: coringao" \
  -d '{
    "url_video": "https://minio.automear.com/canais/test.mp4",
    "url_srt": "https://minio.automear.com/canais/test.srt",
    "path": "Test/videos/",
    "output_filename": "test.mp4",
    "style": {
      "font": {"name": "Roboto", "size": 24, "bold": true}
    }
  }'
```

**Resposta esperada**: Status 200 (não 404)

---

## 📦 Arquivos Alterados no Deploy

- `src/orchestrator/routes/videoProxy.ts` - Nova rota `/video/caption_style`
- `src/orchestrator/services/runpodService.ts` - Método `processCaptionStyled()`
- `src/shared/types/index.ts` - Tipos `CaptionStyledRequest` e `SubtitleStyle`
- `src/shared/middleware/validation.ts` - Schema Joi `captionStyledRequestSchema`
- `src/shared/utils/subtitleStyles.ts` - Utilitário de conversão de cores

---

## 🔍 Troubleshooting

### Erro 404 persiste

1. Verifique se o build foi feito:
   ```bash
   ls dist/orchestrator/routes/videoProxy.js
   ```

2. Verifique se o servidor está usando o código correto:
   ```bash
   docker exec api-gpu-orchestrator cat dist/orchestrator/routes/videoProxy.js | grep caption_style
   ```

3. Force rebuild completo no Easypanel

### Erro de compilação TypeScript

```bash
npm run build:orchestrator
```

Se houver erros, corrija e commit novamente.

---

## ✅ Checklist

- [ ] Código commitado e pushed para GitHub
- [ ] Deploy feito no Easypanel/VPS
- [ ] Servidor reiniciado
- [ ] Endpoint `/video/caption_style` responde (não retorna 404)
- [ ] Teste completo com arquivo real de vídeo/legenda

---

## 📞 Suporte

Se o erro persistir após o deploy:

1. Verifique logs do container:
   ```bash
   docker logs api-gpu-orchestrator | tail -100
   ```

2. Verifique se a porta está exposta:
   ```bash
   docker ps | grep api-gpu-orchestrator
   ```

3. Teste endpoint localmente dentro do container:
   ```bash
   docker exec api-gpu-orchestrator curl http://localhost:3000/health
   ```
