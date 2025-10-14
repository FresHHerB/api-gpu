# Endpoint de Concatenação de Vídeos

## Visão Geral

O endpoint `/gpu/video/concatenate` permite concatenar múltiplos vídeos em um único arquivo de saída, utilizando aceleração por GPU via NVENC.

## Características

- ✅ Suporte a GPU (NVENC) e CPU (libx264)
- ✅ Sistema de filas e workers
- ✅ Webhook para notificação assíncrona
- ✅ Upload automático para S3/MinIO
- ✅ Timeout configurável (15 minutos)
- ✅ Mínimo de 2 vídeos para concatenação

## Endpoint

```
POST /gpu/video/concatenate
```

### Headers

```
X-API-Key: <sua-api-key>
Content-Type: application/json
```

## Request Body

```json
{
  "webhook_url": "http://n8n.automear.com/webhook/concatenaVideo",
  "id_roteiro": 34,
  "path": "Mr. Nightmare/5 Coisas MAIS MACABRAS de Casas Abandonadas na Floresta/videos/temp",
  "output_filename": "video_concatenado.mp4",
  "video_urls": [
    {
      "video_url": "https://minio.automear.com/canais/Mr. Nightmare/5 Coisas MAIS MACABRAS de Casas Abandonadas na Floresta/videos/temp/video_1.mp4"
    },
    {
      "video_url": "https://minio.automear.com/canais/Mr. Nightmare/5 Coisas MAIS MACABRAS de Casas Abandonadas na Floresta/videos/temp/video_2.mp4"
    }
  ]
}
```

### Parâmetros

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `webhook_url` | string (URL) | ✅ | URL para receber notificação quando o job completar |
| `id_roteiro` | number | ❌ | ID do roteiro (opcional, para rastreamento) |
| `path` | string | ✅ | Caminho S3 para upload (ex: "Channel/Video/videos/temp/") |
| `output_filename` | string | ✅ | Nome do arquivo de saída (ex: "video_concatenado.mp4") |
| `video_urls` | array | ✅ | Array de objetos com `video_url` (mínimo 2 vídeos) |

## Response (202 Accepted)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "idRoteiro": 34,
  "message": "Job queued successfully",
  "estimatedTime": "~3 minutes",
  "queuePosition": 1,
  "statusUrl": "/jobs/550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-10-13T12:00:00.000Z"
}
```

## Webhook Callback (quando completo)

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 34,
  "status": "COMPLETED",
  "operation": "concatenate",
  "result": {
    "success": true,
    "video_url": "https://minio.automear.com/canais/Mr. Nightmare/5 Coisas MAIS MACABRAS de Casas Abandonadas na Floresta/videos/temp/video_concatenado.mp4",
    "filename": "video_concatenado.mp4",
    "s3_key": "Mr. Nightmare/5 Coisas MAIS MACABRAS de Casas Abandonadas na Floresta/videos/temp/video_concatenado.mp4",
    "video_count": 2,
    "message": "2 videos concatenated and uploaded to S3 successfully"
  },
  "execution": {
    "startTime": "2025-10-13T12:00:05.000Z",
    "endTime": "2025-10-13T12:02:30.000Z",
    "durationMs": 145000,
    "durationSeconds": 145
  }
}
```

## Detalhes Técnicos

### Processo de Concatenação

1. **Download**: Todos os vídeos são baixados para `/tmp/work`
2. **Concat List**: Criado arquivo de lista com caminhos absolutos
3. **FFmpeg**: Usa concat demuxer com re-encoding
   - **GPU**: `h264_nvenc` com preset `p4` e `vbr` rate control
   - **CPU**: `libx264` com preset `medium` e CRF 23
4. **Upload S3**: Arquivo resultante é enviado para S3/MinIO
5. **Cleanup**: Arquivos temporários são removidos
6. **Webhook**: Notificação enviada com resultado

### Configurações de Encoding

**GPU (NVENC)**:
```bash
-c:v h264_nvenc
-preset p4
-tune hq
-rc:v vbr
-cq:v 23
-maxrate 10M
-bufsize 20M
-c:a aac
-b:a 192k
-movflags +faststart
```

**CPU (libx264)**:
```bash
-c:v libx264
-preset medium
-crf 23
-maxrate 10M
-bufsize 20M
-c:a aac
-b:a 192k
-movflags +faststart
```

### Timeouts

- **Queue Timeout**: 15 minutos (configurável via `QUEUE_TIMEOUT_CHECK_INTERVAL`)
- **Estimativa de Fila**: ~3 minutos por job (ajustado dinamicamente)

### Validações

- Mínimo de 2 vídeos requeridos
- Todas as URLs devem ser válidas (http:// ou https://)
- Path deve ser uma string não vazia
- Output filename deve ser uma string não vazia
- Webhook URL é validada com anti-SSRF (não permite localhost/IPs privados)

## Exemplos de Uso

### Exemplo 1: Concatenar 2 vídeos

```bash
curl -X POST "http://localhost:3000/gpu/video/concatenate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://example.com/webhook/concatenate",
    "id_roteiro": 42,
    "path": "Channel/Video/videos/temp/",
    "output_filename": "final.mp4",
    "video_urls": [
      {"video_url": "https://cdn.example.com/part1.mp4"},
      {"video_url": "https://cdn.example.com/part2.mp4"}
    ]
  }'
```

### Exemplo 2: Concatenar múltiplos vídeos

```bash
curl -X POST "http://localhost:3000/gpu/video/concatenate" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "webhook_url": "https://example.com/webhook/concatenate",
    "path": "Projects/Demo/videos/",
    "output_filename": "complete_video.mp4",
    "video_urls": [
      {"video_url": "https://cdn.example.com/intro.mp4"},
      {"video_url": "https://cdn.example.com/content.mp4"},
      {"video_url": "https://cdn.example.com/outro.mp4"}
    ]
  }'
```

## Monitoramento

### Verificar Status do Job

```bash
curl -X GET "http://localhost:3000/jobs/{jobId}" \
  -H "X-API-Key: your-api-key"
```

### Cancelar Job

```bash
curl -X POST "http://localhost:3000/jobs/{jobId}/cancel" \
  -H "X-API-Key: your-api-key"
```

### Estatísticas da Fila

```bash
curl -X GET "http://localhost:3000/queue/stats" \
  -H "X-API-Key: your-api-key"
```

## Erros Comuns

### 400 - Validation Error

```json
{
  "error": "Validation error",
  "message": "Invalid request parameters",
  "details": [
    {
      "field": "video_urls",
      "message": "\"video_urls\" must contain at least 2 items"
    }
  ]
}
```

### 401 - Unauthorized

```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing API key"
}
```

### 500 - Job Creation Failed

```json
{
  "error": "Job creation failed",
  "message": "Failed to enqueue job"
}
```

## Webhook com Erro

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "idRoteiro": 34,
  "status": "FAILED",
  "operation": "concatenate",
  "error": {
    "code": "PROCESSING_ERROR",
    "message": "FFmpeg failed: Invalid video format"
  },
  "execution": {
    "startTime": "2025-10-13T12:00:05.000Z",
    "endTime": "2025-10-13T12:00:45.000Z",
    "durationMs": 40000,
    "durationSeconds": 40
  }
}
```

## Notas Importantes

1. **Compatibilidade de Vídeos**: Os vídeos devem ter codec, resolução e fps compatíveis para melhor resultado
2. **Re-encoding**: O processo faz re-encoding completo para garantir compatibilidade
3. **Tamanho**: Não há limite de tamanho, mas considere o timeout de 15 minutos
4. **Ordem**: Os vídeos são concatenados na ordem fornecida no array
5. **S3 Upload**: O arquivo final é sempre enviado para S3, URLs temporárias HTTP não são usadas

## Versão

- **Versão**: 2.11.0
- **Data**: 2025-10-13
- **Commit**: 7f826a7

## Referências

- [FFmpeg Concat Documentation](https://trac.ffmpeg.org/wiki/Concatenate)
- [NVENC Preset Guide](https://docs.nvidia.com/video-technologies/video-codec-sdk/nvenc-preset-migration-guide/)
- [RunPod Serverless Documentation](https://docs.runpod.io/serverless/overview)
