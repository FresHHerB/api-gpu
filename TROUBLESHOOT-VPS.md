# Troubleshooting VPS Errors

## 🔴 Problema Atual

Você está recebendo webhooks com erro truncado:
```json
{
  "status": "FAILED",
  "processor": "VPS",
  "error": {
    "code": "VPS_PROCESSING_
```

A mensagem está cortada. Vamos identificar o erro completo.

## 🔍 Diagnóstico Passo a Passo

### Passo 1: Verificar FFmpeg no VPS

**SSHno VPS:**
```bash
ssh root@185.173.110.7
```

**Testar FFmpeg:**
```bash
which ffmpeg
ffmpeg -version
```

**Se FFmpeg NÃO existir:**
```bash
sudo apt update
sudo apt install -y ffmpeg

# Verificar instalação
ffmpeg -version
```

### Passo 2: Verificar Estado do Servidor

```bash
cd /root/api-gpu

# Ver versão atual
git log -1 --oneline

# Status do PM2
pm2 list | grep api-gpu

# Ver logs recentes
pm2 logs api-gpu-orchestrator --lines 100 --nostream
```

### Passo 3: Verificar Logs Completos

```bash
# Logs gerais
pm2 logs api-gpu-orchestrator --lines 200 --nostream

# Apenas erros
pm2 logs api-gpu-orchestrator --err --lines 100 --nostream

# Buscar por "VPS_PROCESSING_ERROR"
pm2 logs api-gpu-orchestrator --lines 500 --nostream | grep -A 5 -B 5 "VPS_PROCESSING_ERROR"

# Buscar por "LocalVideoProcessor"
pm2 logs api-gpu-orchestrator --lines 500 --nostream | grep -A 10 "LocalVideoProcessor"
```

### Passo 4: Testar Permissões

```bash
# Verificar diretório de trabalho
ls -la /tmp/vps-work 2>/dev/null || echo "Directory doesn't exist (will be created automatically)"

# Verificar permissões /tmp
ls -lad /tmp
touch /tmp/test-write && rm /tmp/test-write && echo "✅ /tmp is writable" || echo "❌ /tmp is NOT writable"

# Criar diretório manual e testar
mkdir -p /tmp/vps-work
chmod 777 /tmp/vps-work
ls -lad /tmp/vps-work
```

### Passo 5: Testar Download de Imagens

```bash
# Testar download de uma imagem
TEST_URL="https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"

# Download direto
curl -L -o /tmp/test-image.jpg "$TEST_URL"

# Verificar arquivo
ls -lh /tmp/test-image.jpg
file /tmp/test-image.jpg

# Limpar
rm /tmp/test-image.jpg
```

### Passo 6: Testar FFmpeg Manual

```bash
# Baixar imagem de teste
curl -L -o /tmp/test.jpg "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"

# Criar vídeo com FFmpeg
ffmpeg -loop 1 -i /tmp/test.jpg \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='zoom+0.0015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=120:s=1920x1080:fps=24" \
  -c:v libx264 \
  -preset ultrafast \
  -crf 23 \
  -t 5 \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -y /tmp/test.mp4

# Verificar output
ls -lh /tmp/test.mp4

# Limpar
rm /tmp/test.jpg /tmp/test.mp4
```

## 🚀 Deploy Atualizado

Se você ainda não fez o pull do código mais recente:

```bash
cd /root/api-gpu

# Pull latest code
git pull

# Rebuild
npm run build:orchestrator

# Restart
pm2 restart api-gpu-orchestrator

# Monitor logs
pm2 logs api-gpu-orchestrator
```

## 🔍 Erros Comuns e Soluções

### Erro: `spawn ffmpeg ENOENT`
**Causa**: FFmpeg não instalado
**Solução**:
```bash
sudo apt update && sudo apt install -y ffmpeg
pm2 restart api-gpu-orchestrator
```

### Erro: `EACCES: permission denied`
**Causa**: Sem permissão no diretório
**Solução**:
```bash
mkdir -p /tmp/vps-work
chmod 777 /tmp/vps-work
pm2 restart api-gpu-orchestrator
```

### Erro: `Request failed with status code 404`
**Causa**: Imagem não existe no MinIO
**Solução**: Verificar URLs das imagens

### Erro: `ETIMEDOUT`
**Causa**: Timeout no download
**Solução**:
```bash
# Testar conectividade com MinIO
curl -I https://minio.automear.com/
ping -c 3 minio.automear.com
```

### Erro: `FFmpeg exited with code 1`
**Causa**: Erro no processamento do vídeo
**Solução**: Ver stderr do FFmpeg nos logs

## 📊 Interpretando Logs

### Log de Sucesso:
```
[LocalVideoProcessor] Downloading file { originalUrl: '...', encodedUrl: '...', dest: '...' }
[LocalVideoProcessor] Download completed { dest: '...' }
[LocalVideoProcessor] Executing FFmpeg { args: '...' }
[LocalVideoProcessor] FFmpeg completed successfully
[LocalWorkerService] Job completed { jobId: '...', durationSeconds: '...' }
```

### Log de Erro - FFmpeg Missing:
```
[LocalVideoProcessor] Executing FFmpeg { args: '...' }
[LocalVideoProcessor] FFmpeg spawn error { error: 'spawn ffmpeg ENOENT' }
[LocalWorkerService] Job failed { jobId: '...', error: 'spawn ffmpeg ENOENT' }
```

### Log de Erro - Download:
```
[LocalVideoProcessor] Downloading file { ... }
[LocalVideoProcessor] Download stream error { error: '...', url: '...' }
[LocalWorkerService] Job failed { jobId: '...', error: '...' }
```

## 🧪 Teste Local Recomendado

Para testar localmente antes de deploy:

```bash
# No seu Windows
node test-full-payload.js
```

Isso vai:
1. Baixar 3 imagens
2. Processar com FFmpeg
3. Mostrar erros detalhados se falhar
4. Validar que o código funciona antes de deploy

## 📝 Checklist de Resolução

- [ ] FFmpeg instalado e funcionando
- [ ] Diretório /tmp/vps-work com permissões corretas
- [ ] Código atualizado (git pull)
- [ ] Rebuild feito (npm run build:orchestrator)
- [ ] Servidor reiniciado (pm2 restart)
- [ ] Logs coletados e analisados
- [ ] Teste manual de FFmpeg bem-sucedido
- [ ] Teste de download de imagem bem-sucedido
- [ ] MinIO acessível do VPS

## 🆘 Se o Problema Persistir

1. **Copie e cole o seguinte**:

```bash
# Coletar informações completas
echo "========== SYSTEM INFO =========="
uname -a
which ffmpeg
ffmpeg -version 2>&1 | head -n 1

echo "========== DISK SPACE =========="
df -h /tmp

echo "========== PERMISSIONS =========="
ls -lad /tmp
ls -lad /tmp/vps-work 2>/dev/null || echo "Directory doesn't exist"

echo "========== PM2 STATUS =========="
pm2 list | grep api-gpu

echo "========== RECENT ERRORS =========="
pm2 logs api-gpu-orchestrator --err --lines 50 --nostream

echo "========== VPS PROCESSING LOGS =========="
pm2 logs api-gpu-orchestrator --lines 200 --nostream | grep -A 10 "VPS_PROCESSING_ERROR\|LocalVideoProcessor\|LocalWorkerService"
```

2. **Envie a saída completa**

## 💡 Próximos Passos

Após resolver o problema:

1. Teste com 3 imagens primeiro
2. Se funcionar, teste com payload completo (66 imagens)
3. Monitore uso de CPU e memória
4. Ajuste `VPS_MAX_CONCURRENT_JOBS` se necessário

## 📞 Referência Rápida

**VPS**: 185.173.110.7:3000
**Webhook**: http://n8n.automear.com/webhook/img2vid
**Work Dir**: /tmp/vps-work
**Max Concurrent**: 2 jobs
**Codec**: libx264
**Preset**: medium

**Commits Relevantes**:
- `b98c286` - VPS URL encoding e webhook improvements
- `7d6b305` - Isolate VPS jobs from RunPod
- `471bcd5` - Add testing tools
