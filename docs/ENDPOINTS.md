# Referência Rápida de Endpoints

Guia conciso de todos os endpoints da API GPU v3.0.0

---

## 📋 Tabela Completa

| Endpoint | Método | Auth | Tipo | GPU | Descrição |
|----------|--------|------|------|-----|-----------|
| **GPU - VIDEO PROCESSING** |
| `/gpu/video/img2vid` | POST | ✅ | Async | ✅ | Converte imagens em vídeos com Ken Burns |
| `/gpu/video/addaudio` | POST | ✅ | Async | ✅ | Adiciona/substitui áudio em vídeo |
| `/gpu/video/concatenate` | POST | ✅ | Async | ✅ | Concatena múltiplos vídeos |
| `/gpu/video/caption_style` | POST | ✅ | Async | ✅ | Legendas estilizadas (segments ou highlight) |
| **GPU - TRANSCRIPTION** |
| `/gpu/audio/transcribe` | POST | ✅ | Sync | ✅ | Transcrição de áudio com Whisper |
| `/gpu/audio/transcribe/health` | GET | ❌ | Sync | ❌ | Health check do serviço de transcrição |
| **JOB MANAGEMENT** |
| `/jobs/:jobId` | GET | ✅ | Sync | ❌ | Consultar status de job |
| `/jobs/:jobId/cancel` | POST | ✅ | Sync | ❌ | Cancelar job em execução |
| `/queue/stats` | GET | ✅ | Sync | ❌ | Estatísticas da fila |
| **HEALTH & INFO** |
| `/health` | GET | ❌ | Sync | ❌ | Health check geral + queue stats |
| `/` | GET | ❌ | Sync | ❌ | Informações da API e endpoints |
| **STATIC FILES** |
| `/output/:filename` | GET | ❌ | Static | ❌ | Serve arquivos processados |

---

## 🔑 Autenticação

Header obrigatório para endpoints marcados com ✅:
```http
X-API-Key: your-api-key-here
```

---

## 🎬 Endpoints Assíncronos (Webhook Required)

Todos os endpoints `/gpu/video/*` requerem `webhook_url` e retornam imediatamente:

```json
{
  "webhook_url": "https://n8n.example.com/webhook/callback",
  "id_roteiro": 123  // opcional
}
```

**Response (202 Accepted):**
```json
{
  "jobId": "550e8400-...",
  "status": "QUEUED",
  "queuePosition": 1,
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

**Callback (quando completa):**
```json
{
  "jobId": "550e8400-...",
  "status": "COMPLETED",
  "result": {
    "video_url": "https://s3.../video.mp4",
    "pathRaiz": "Channel/Video/"
  }
}
```

---

## 📌 Exemplos Rápidos

### Transcrição (Síncrono)
```bash
curl -X POST "https://api.example.com/gpu/audio/transcribe" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "audio_url": "https://cdn.example.com/audio.mp3",
    "path": "Project/Episode01/",
    "model": "large-v3"
  }'
```

---

### Legendas Segments (Assíncrono)
```bash
curl -X POST "https://api.example.com/gpu/video/caption_style" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "webhook_url": "https://webhook.site/unique-id",
    "url_video": "https://cdn.example.com/video.mp4",
    "url_caption": "https://s3.example.com/subtitles.srt",
    "path": "Channel/Video/videos/final/",
    "output_filename": "video.mp4",
    "type": "segments"
  }'
```

---

### Legendas Karaoke (Assíncrono)
```bash
curl -X POST "https://api.example.com/gpu/video/caption_style" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "webhook_url": "https://webhook.site/unique-id",
    "url_video": "https://cdn.example.com/video.mp4",
    "url_caption": "https://s3.example.com/words.json",
    "path": "Channel/Video/videos/karaoke/",
    "output_filename": "video_karaoke.mp4",
    "type": "highlight",
    "style": {
      "highlight_texto_cor": "#FFFF00",
      "highlight_cor": "#00FF00"
    }
  }'
```

---

### Imagem para Vídeo (Assíncrono)
```bash
curl -X POST "https://api.example.com/gpu/video/img2vid" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "webhook_url": "https://webhook.site/unique-id",
    "images": [
      {"id": "img1", "image_url": "https://cdn.example.com/photo.jpg", "duracao": 5.0}
    ],
    "path": "Channel/Video/videos/temp/"
  }'
```

---

### Concatenar Vídeos (Assíncrono)
```bash
curl -X POST "https://api.example.com/gpu/video/concatenate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-key" \
  -d '{
    "webhook_url": "https://webhook.site/unique-id",
    "video_urls": [
      {"video_url": "https://cdn.example.com/part1.mp4"},
      {"video_url": "https://cdn.example.com/part2.mp4"}
    ],
    "path": "Channel/Video/videos/final/",
    "output_filename": "complete.mp4"
  }'
```

---

### Consultar Job
```bash
curl "https://api.example.com/jobs/550e8400-..." \
  -H "X-API-Key: your-key"
```

---

### Cancelar Job
```bash
curl -X POST "https://api.example.com/jobs/550e8400-.../cancel" \
  -H "X-API-Key: your-key"
```

---

### Queue Stats
```bash
curl "https://api.example.com/queue/stats" \
  -H "X-API-Key: your-key"
```

---

## 📊 Status de Jobs

| Status | Descrição |
|--------|-----------|
| `QUEUED` | Na fila aguardando worker disponível |
| `SUBMITTED` | Submetido ao RunPod, aguardando início |
| `PROCESSING` | Em processamento no worker GPU |
| `COMPLETED` | Concluído com sucesso (webhook enviado) |
| `FAILED` | Falhou com erro (webhook com erro enviado) |
| `CANCELLED` | Cancelado pelo usuário |

---

## ⚡ Performance Estimada

| Operação | Entrada | Tempo Médio |
|----------|---------|-------------|
| Transcribe (large-v3) | 1 min áudio | 5-10s |
| Transcribe (large-v3) | 10 min áudio | 30-60s |
| Caption Segments | 10s vídeo | 6-8s |
| Caption Highlight | 10s vídeo | 8-12s |
| Img2Vid | 1 imagem | 3-5s |
| AddAudio | 10s vídeo | 4-6s |
| Concatenate | 2 vídeos (10s cada) | 10-15s |

*Cold start: +10-15s quando worker está inativo*

---

## 🚫 Error Codes

| Code | Descrição |
|------|-----------|
| 200 | Success (síncrono) |
| 202 | Accepted (assíncrono - job enfileirado) |
| 400 | Bad Request (validação falhou) |
| 401 | Unauthorized (API key inválida) |
| 404 | Not Found (job não existe) |
| 500 | Internal Server Error |
| 503 | Service Unavailable (RunPod offline) |

---

## 📚 Documentação Completa

- **[API Reference](./API_REFERENCE.md)** - Documentação detalhada com todos os parâmetros
- **[README.md](../README.md)** - Visão geral do projeto e arquitetura
- **[Deployment Guide](./DEPLOYMENT.md)** - Guia completo de deploy
- **[Concatenate Endpoint](./CONCATENATE_ENDPOINT.md)** - Detalhes do endpoint de concatenação

---

## 🔗 Links Úteis

- **Base URL:** `https://api-gpu.automear.com` (exemplo)
- **Webhook Testing:** https://webhook.site
- **Postman Collection:** (TODO)
- **GitHub:** https://github.com/your-repo/api-gpu

---

**Versão:** 3.0.0
**Última atualização:** 2025-10-13
