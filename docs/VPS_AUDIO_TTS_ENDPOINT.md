# Endpoint: POST /vps/audio/tts

## Descrição
Gera áudios a partir de textos usando plataformas TTS (Text-to-Speech) com processamento em batch e upload automático para S3.

**Características:**
- ✅ Processamento síncrono (retorna resultado imediatamente)
- ✅ Suporta múltiplas plataformas: Fish Audio e ElevenLabs
- ✅ Processamento em batch de 5 requisições simultâneas
- ✅ Retry automático em caso de falha (3 tentativas por item)
- ✅ Upload automático para S3/MinIO
- ✅ Nomenclatura sequencial de arquivos
- ✅ Logs detalhados de processamento
- ✅ Controle de velocidade de fala

---

## URL
```
POST /vps/audio/tts
```

---

## Request Body

### Parâmetros

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `trechos` | Array | ✅ Sim | Lista de trechos de texto para gerar áudio |
| `trechos[].id` | Number | ✅ Sim | Identificador único do trecho (positivo) |
| `trechos[].trecho` | String | ✅ Sim | Texto para conversão em áudio |
| `plataforma` | String | ✅ Sim | Plataforma TTS: `fishaudio` ou `elevenlabs` |
| `api_key` | String | ✅ Sim | Chave de API da plataforma escolhida |
| `voice_id` | String | ✅ Sim | ID da voz a ser utilizada |
| `speed` | Number | ❌ Não | Velocidade da fala (0.25-4.0). Padrão: `1.0` |
| `path` | String | ✅ Sim | Caminho S3 para salvar (ex: "Canal/Video/audios/") |
| `output_filename` | String | ❌ Não | Nome base dos arquivos. Padrão: `audio` |

### Exemplo de Request Body

```json
{
  "trechos": [
    {
      "id": 1,
      "trecho": "Before the sun touched the horizon this morning, before your first thought formed..."
    },
    {
      "id": 2,
      "trecho": "He knows your struggles. And he is inviting you into something larger..."
    }
  ],
  "plataforma": "fishaudio",
  "api_key": "sua-api-key-aqui",
  "voice_id": "voice-id-ou-reference-id",
  "speed": 1.0,
  "path": "Channel Name/Video Title/audios/",
  "output_filename": "audio"
}
```

---

## Response

### Sucesso (200 OK)

```json
{
  "success": true,
  "platform": "fishaudio",
  "total": 2,
  "successful": 2,
  "failed": 0,
  "results": [
    {
      "success": true,
      "id": 1,
      "filename": "audio1.mp3",
      "s3_url": "https://s3.endpoint.com/bucket/Channel%20Name/Video%20Title/audios/audio1.mp3",
      "s3_key": "Channel Name/Video Title/audios/audio1.mp3",
      "audio_size_kb": 245.32,
      "processing_time_ms": 3456
    },
    {
      "success": true,
      "id": 2,
      "filename": "audio2.mp3",
      "s3_url": "https://s3.endpoint.com/bucket/Channel%20Name/Video%20Title/audios/audio2.mp3",
      "s3_key": "Channel Name/Video Title/audios/audio2.mp3",
      "audio_size_kb": 312.18,
      "processing_time_ms": 4123
    }
  ],
  "processing_time_ms": 8654,
  "avg_time_per_item_ms": 4327,
  "message": "TTS batch processing complete: 2/2 successful"
}
```

### Sucesso Parcial (200 OK)
Quando alguns itens falharam mas outros foram bem-sucedidos:

```json
{
  "success": true,
  "platform": "elevenlabs",
  "total": 3,
  "successful": 2,
  "failed": 1,
  "results": [
    {
      "success": true,
      "id": 1,
      "filename": "audio1.mp3",
      "s3_url": "https://s3.endpoint.com/bucket/path/audio1.mp3",
      "s3_key": "path/audio1.mp3",
      "audio_size_kb": 245.32,
      "processing_time_ms": 3456
    },
    {
      "success": false,
      "id": 2,
      "filename": "audio2.mp3",
      "error": "ElevenLabs failed after 3 attempts: HTTP 401: Invalid API key",
      "processing_time_ms": 6234
    },
    {
      "success": true,
      "id": 3,
      "filename": "audio3.mp3",
      "s3_url": "https://s3.endpoint.com/bucket/path/audio3.mp3",
      "s3_key": "path/audio3.mp3",
      "audio_size_kb": 189.45,
      "processing_time_ms": 3891
    }
  ],
  "processing_time_ms": 13581,
  "avg_time_per_item_ms": 4527,
  "message": "TTS batch processing complete: 2/3 successful"
}
```

### Erro de Validação (400 Bad Request)

```json
{
  "success": false,
  "error": "Validation error",
  "message": "plataforma must be either \"fishaudio\" or \"elevenlabs\""
}
```

### Erro de Processamento (500 Internal Server Error)

```json
{
  "success": false,
  "error": "TTS batch processing failed",
  "message": "S3 configuration missing: S3_ENDPOINT_URL",
  "processing_time_ms": 123
}
```

---

## Plataformas Suportadas

### 1. Fish Audio

**Configuração:**
```json
{
  "plataforma": "fishaudio",
  "api_key": "your-fish-audio-api-key",
  "voice_id": "reference-id-from-fish-audio"
}
```

**Características:**
- Modelo: `speech-1.5`
- Formato de saída: MP3
- Suporta controle de velocidade via `prosody.speed`
- Normalização automática habilitada
- Latência: normal mode

**Limites:**
- Rate limit estimado: ~5 requisições simultâneas
- Timeout por requisição: 60s

### 2. ElevenLabs

**Configuração:**
```json
{
  "plataforma": "elevenlabs",
  "api_key": "your-elevenlabs-api-key",
  "voice_id": "voice-id-from-elevenlabs"
}
```

**Características:**
- Modelo: `eleven_multilingual_v2`
- Formato de saída: MP3 (44.1kHz, 128kbps)
- Suporta controle de velocidade via `voice_settings.speed`
- Speaker boost habilitado
- Stability: 0.5, Similarity boost: 0.75

**Limites:**
- Rate limit estimado: ~5 requisições simultâneas
- Timeout por requisição: 60s

---

## Comportamento de Retry

Cada item que falha é automaticamente retentado até 3 vezes com:

- **Tentativa 1**: Imediato
- **Tentativa 2**: Após 2s (2000ms)
- **Tentativa 3**: Após 4s (4000ms) - backoff exponencial

**Não são retentados:**
- Erros de autenticação (401)
- Erros de validação (400)
- Erros de quota excedida (402)
- Outros erros 4xx (exceto 429 - rate limit)

**São retentados:**
- Erros de rede (timeout, DNS)
- Erros de servidor (5xx)
- Rate limit (429)

---

## Processamento em Batch

O endpoint processa os trechos em **batches de 5 simultâneos**:

```
Trechos: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

Batch 1: [1, 2, 3, 4, 5]  → Processa em paralelo
Batch 2: [6, 7, 8, 9, 10] → Aguarda Batch 1 terminar, depois processa em paralelo
```

**Vantagens:**
- ✅ Otimiza uso da API (múltiplas requisições simultâneas)
- ✅ Respeita limites de rate limit
- ✅ Reduz tempo total de processamento
- ✅ Continua processando mesmo se alguns itens falharem

---

## Nomenclatura de Arquivos

Os arquivos são salvos com nomenclatura sequencial baseada no **ID do trecho**:

| `output_filename` | `trecho.id` | Arquivo Gerado |
|-------------------|-------------|----------------|
| `audio` | 1 | `audio1.mp3` |
| `audio` | 2 | `audio2.mp3` |
| `narration` | 5 | `narration5.mp3` |
| `voice` | 10 | `voice10.mp3` |

---

## Upload S3

Os arquivos são automaticamente enviados para S3/MinIO após a geração:

**Configuração (via variáveis de ambiente):**
```env
S3_ENDPOINT_URL=https://your-s3-endpoint.com
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
S3_BUCKET_NAME=canais
S3_REGION=us-east-1
```

**Estrutura do path:**
```
Bucket: canais
Path:   Channel Name/Video Title/audios/
Files:  audio1.mp3, audio2.mp3, audio3.mp3...

URL final: https://s3-endpoint.com/canais/Channel%20Name/Video%20Title/audios/audio1.mp3
```

**Retry no upload:**
- Até 3 tentativas com delay de 2s
- Suporta erros de DNS/rede temporários

---

## Exemplos de Uso

### cURL - Fish Audio

```bash
curl -X POST http://localhost:3000/vps/audio/tts \
  -H "Content-Type: application/json" \
  -d '{
    "trechos": [
      {
        "id": 1,
        "trecho": "Este é o primeiro trecho de áudio."
      },
      {
        "id": 2,
        "trecho": "Este é o segundo trecho de áudio."
      }
    ],
    "plataforma": "fishaudio",
    "api_key": "your-fish-audio-api-key",
    "voice_id": "your-voice-reference-id",
    "speed": 1.0,
    "path": "Meu Canal/Video Teste/audios/",
    "output_filename": "narration"
  }'
```

### cURL - ElevenLabs

```bash
curl -X POST http://localhost:3000/vps/audio/tts \
  -H "Content-Type: application/json" \
  -d '{
    "trechos": [
      {
        "id": 1,
        "trecho": "This is the first audio segment."
      },
      {
        "id": 2,
        "trecho": "This is the second audio segment."
      }
    ],
    "plataforma": "elevenlabs",
    "api_key": "your-elevenlabs-api-key",
    "voice_id": "21m00Tcm4TlvDq8ikWAM",
    "speed": 1.2,
    "path": "My Channel/Test Video/audios/",
    "output_filename": "audio"
  }'
```

### Node.js/Axios

```javascript
const axios = require('axios');

async function generateTTS() {
  const response = await axios.post('http://localhost:3000/vps/audio/tts', {
    trechos: [
      { id: 1, trecho: 'Primeiro trecho de áudio.' },
      { id: 2, trecho: 'Segundo trecho de áudio.' },
      { id: 3, trecho: 'Terceiro trecho de áudio.' }
    ],
    plataforma: 'fishaudio',
    api_key: 'your-api-key',
    voice_id: 'your-voice-id',
    speed: 1.0,
    path: 'Canal/Video/audios/',
    output_filename: 'audio'
  });

  console.log('TTS Generation Results:');
  console.log(`Total: ${response.data.total}`);
  console.log(`Successful: ${response.data.successful}`);
  console.log(`Failed: ${response.data.failed}`);

  response.data.results.forEach(result => {
    if (result.success) {
      console.log(`✅ ${result.filename}: ${result.s3_url}`);
    } else {
      console.log(`❌ ${result.filename}: ${result.error}`);
    }
  });
}

generateTTS();
```

### Python

```python
import requests

def generate_tts():
    url = 'http://localhost:3000/vps/audio/tts'

    payload = {
        'trechos': [
            {'id': 1, 'trecho': 'Primeiro trecho de áudio.'},
            {'id': 2, 'trecho': 'Segundo trecho de áudio.'},
        ],
        'plataforma': 'elevenlabs',
        'api_key': 'your-api-key',
        'voice_id': 'your-voice-id',
        'speed': 1.0,
        'path': 'Canal/Video/audios/',
        'output_filename': 'audio'
    }

    response = requests.post(url, json=payload)
    data = response.json()

    print(f"Total: {data['total']}")
    print(f"Successful: {data['successful']}")
    print(f"Failed: {data['failed']}")

    for result in data['results']:
        if result['success']:
            print(f"✅ {result['filename']}: {result['s3_url']}")
        else:
            print(f"❌ {result['filename']}: {result['error']}")

generate_tts()
```

---

## Logs

O endpoint gera logs detalhados em todos os estágios:

```
[VPS Audio TTS] Starting TTS batch processing
  - platform: fishaudio
  - trechosCount: 10
  - path: Canal/Video/audios/
  - output_filename: audio

[TTS Batch] Starting batch processing
  - total: 10
  - concurrentLimit: 5

[TTS Batch] Processing batch 1/2
  - items: 5
  - range: 1-5

[Fish Audio] Generating audio (attempt 1/3)
  - textLength: 234
  - voiceId: xyz123

[Fish Audio] Audio generated successfully
  - sizeKB: 156.32
  - textLength: 234

[S3UploadService] Uploading to: canais/Canal/Video/audios/audio1.mp3
[S3UploadService] Upload successful

[TTS Batch] Item 1 completed successfully
  - filename: audio1.mp3
  - audioSizeKB: 156.32
  - processingTime: 3.45s

...

[TTS Batch] Batch 1/2 complete
  - successful: 5
  - failed: 0

[VPS Audio TTS] Batch processing complete
  - total: 10
  - successful: 10
  - failed: 0
  - processingTime: 18.23s
  - avgTimePerItem: 1.82s
```

---

## Troubleshooting

### Erro: "plataforma must be either 'fishaudio' or 'elevenlabs'"
**Causa:** Valor inválido no campo `plataforma`
**Solução:** Use exatamente `"fishaudio"` ou `"elevenlabs"` (minúsculas)

### Erro: "Fish Audio failed after 3 attempts: HTTP 401"
**Causa:** API key inválida ou expirada
**Solução:** Verifique se a API key está correta e ativa

### Erro: "S3 configuration missing: S3_ENDPOINT_URL"
**Causa:** Variáveis de ambiente S3 não configuradas
**Solução:** Configure as variáveis S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY

### Alguns itens falharam mas outros foram bem-sucedidos
**Comportamento esperado:** O processamento continua mesmo com falhas individuais
**Ação:** Verifique o campo `error` nos items com `success: false` para identificar a causa

### Timeout em requisições longas
**Causa:** Textos muito longos podem demorar para processar
**Solução:** Divida textos muito grandes em trechos menores

---

## Performance

**Estimativas de tempo:**

| Trechos | Batch | Tempo Estimado |
|---------|-------|----------------|
| 5 | 1 | 10-15s |
| 10 | 2 | 20-30s |
| 25 | 5 | 50-75s |
| 50 | 10 | 100-150s |

**Fatores que afetam o tempo:**
- Tamanho do texto
- Latência da API TTS
- Velocidade de upload S3
- Retry em caso de falhas

---

## Notas Importantes

1. **Processamento Síncrono**: O endpoint aguarda o processamento completo antes de retornar
2. **IDs únicos**: Use IDs únicos e sequenciais para nomenclatura consistente
3. **Ordem não garantida**: Itens do mesmo batch podem terminar em ordem diferente
4. **Retry automático**: Falhas temporárias são retentadas automaticamente
5. **Continua em falhas**: O processamento continua mesmo se alguns itens falharem
6. **Cache de API**: As plataformas podem ter cache - textos idênticos podem retornar mais rápido

---

**Documento criado em:** 2025-10-28
**Versão:** 1.0.0
**Autor:** API-GPU Team
