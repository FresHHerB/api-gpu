# VPS Endpoint Testing Guide

Este guia explica como testar os endpoints VPS localmente e analisar as respostas.

## 📋 Scripts Disponíveis

### 1. `test-webhook-server.js`
Servidor de webhook local que recebe e loga todas as notificações.

**Características:**
- Recebe webhooks na porta 8888
- Loga timestamp, status, resultado, erros
- Mostra tempo de execução e metadados
- Endpoint de status: `GET /status`

### 2. `test-vps-img2vid.js`
Cliente de teste que envia requisição para `/vps/video/img2vid` e analisa resposta.

**Características:**
- Testa com 3 imagens (payload pequeno)
- Verifica se webhook server está rodando
- Analisa resposta do POST (202, 400, 401, 404, 500)
- Mostra jobId, status, posição na fila
- Detecta erros comuns e sugere soluções

### 3. `test-vps-local.js`
Teste standalone que simula processamento local sem servidor.

**Características:**
- Processa 3 imagens localmente
- Testa download com encoding de URLs
- Testa FFmpeg com Ken Burns effect
- Não precisa de servidor rodando

### 4. `check-vps-env.sh`
Script de diagnóstico para rodar no VPS Linux.

**Características:**
- Verifica FFmpeg instalado
- Testa permissões de /tmp
- Verifica conectividade MinIO
- Testa download de imagens

## 🚀 Como Usar

### Teste Completo (POST + Webhook)

**Terminal 1 - Iniciar Webhook Server:**
```bash
node test-webhook-server.js
```

Saída esperada:
```
========================================
🎯 Webhook Server Started
========================================
Listening on: http://localhost:8888
Webhook URL: http://localhost:8888/webhook
========================================

Waiting for webhooks...
```

**Terminal 2 - Enviar Requisição de Teste:**
```bash
# Teste local (orchestrator rodando em localhost:3000)
node test-vps-img2vid.js

# Teste no VPS remoto
VPS_URL=http://185.173.110.7:3000 node test-vps-img2vid.js
```

### Teste Local de Processamento

Se você quer testar apenas o processamento local sem webhook:
```bash
node test-vps-local.js
```

### Diagnóstico no VPS

SSH no VPS e execute:
```bash
cd /root/api-gpu
chmod +x check-vps-env.sh
./check-vps-env.sh
```

## 📊 Análise de Respostas

### POST Response (202 Accepted)
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "operation": "img2vid_vps",
  "queuePosition": 1,
  "estimatedWaitTime": "~2 minutes",
  "webhookUrl": "http://localhost:8888/webhook",
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

**Campos importantes:**
- `jobId`: ID único do job (use para consultar status)
- `status`: QUEUED → PROCESSING → COMPLETED/FAILED
- `queuePosition`: Posição na fila
- `estimatedWaitTime`: Tempo estimado

### Webhook - Job Completed (VPS)
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 999,
  "pathRaiz": "canais/Test Channel/",
  "status": "COMPLETED",
  "operation": "img2vid",
  "processor": "VPS",
  "result": {
    "code": 200,
    "message": "3 videos processed successfully",
    "videos": [
      {
        "id": "1",
        "video_url": "https://minio.automear.com/canais/.../video_1.mp4",
        "filename": "video_1.mp4"
      }
    ]
  },
  "execution": {
    "startTime": "2025-01-15T10:30:05.000Z",
    "endTime": "2025-01-15T10:32:10.000Z",
    "durationMs": 125000,
    "durationSeconds": 125,
    "worker": "LocalWorkerService",
    "codec": "libx264"
  }
}
```

**Diferenças VPS vs GPU:**
- `processor: "VPS"` (CPU) vs `processor: "GPU"` (RunPod)
- `worker: "LocalWorkerService"` vs `worker: "RunPod"`
- `codec: "libx264"` (CPU) vs `codec: "h264_nvenc"` (GPU)

### Webhook - Job Failed
```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "FAILED",
  "operation": "img2vid",
  "processor": "VPS",
  "error": {
    "code": "VPS_PROCESSING_ERROR",
    "message": "FFmpeg spawn error: ENOENT"
  },
  "execution": {
    "durationSeconds": 5,
    "worker": "LocalWorkerService"
  }
}
```

**Erros comuns:**
- `ENOENT`: FFmpeg não instalado ou não encontrado
- `EACCES`: Sem permissão para criar arquivos
- `ETIMEDOUT`: Timeout no download de imagens
- `404`: Imagem não encontrada no MinIO

## 🔍 Troubleshooting

### POST retorna 404
- Endpoint não existe no servidor
- Código não foi atualizado no VPS
- **Solução**: `git pull && npm run build:orchestrator && pm2 restart`

### POST retorna 401
- API Key incorreta
- Header `X-API-Key` ausente
- **Solução**: Verificar variável `X_API_KEY` no `.env`

### POST retorna 400
- Payload inválido
- URLs mal formatadas
- Campos obrigatórios faltando
- **Solução**: Verificar estrutura do payload

### Webhook nunca chega
- Webhook URL inacessível do servidor
- Job travado em QUEUED
- LocalWorkerService não está rodando
- **Solução**: Verificar logs `pm2 logs api-gpu-orchestrator`

### Job falha com "ENOENT"
- FFmpeg não instalado
- **Solução**: `sudo apt install -y ffmpeg`

### Job falha com timeout no download
- URLs inválidas ou inacessíveis
- MinIO fora do ar
- Problemas de rede
- **Solução**: Testar URLs manualmente com `curl`

## 📝 Logs Úteis

### Ver logs do orchestrator
```bash
pm2 logs api-gpu-orchestrator --lines 100
```

### Ver apenas erros
```bash
pm2 logs api-gpu-orchestrator --err --lines 50
```

### Ver logs em tempo real
```bash
pm2 logs api-gpu-orchestrator --raw
```

### Consultar status de um job
```bash
curl http://185.173.110.7:3000/jobs/{jobId}
```

## 🎯 Checklist de Teste

- [ ] Webhook server rodando (Terminal 1)
- [ ] Script de teste executado (Terminal 2)
- [ ] POST retornou 202 Accepted
- [ ] jobId foi criado
- [ ] Webhook recebido (COMPLETED ou FAILED)
- [ ] Se COMPLETED: URLs dos vídeos acessíveis
- [ ] Se FAILED: Erro analisado e corrigido

## 🔗 Endpoints VPS Disponíveis

- `POST /vps/video/img2vid` - Converter imagens em vídeos (Ken Burns)
- `POST /vps/video/addaudio` - Adicionar áudio a vídeo
- `POST /vps/video/concatenate` - Concatenar múltiplos vídeos
- `POST /vps/video/caption_style` - Adicionar legendas (segments/highlight)

Todos seguem o mesmo padrão:
1. POST retorna 202 + jobId
2. Processamento assíncrono (LocalWorkerService)
3. Webhook notifica quando completa/falha
