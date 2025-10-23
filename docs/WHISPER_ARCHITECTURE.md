# Whisper Transcription Architecture

## 📚 Visão Geral

Este documento explica a arquitetura de transcrição de áudio usando RunPod Workers e Hubs.

---

## 🏗️ Arquitetura: Orquestrador → Worker → Hub

```
┌─────────────────┐
│     Cliente     │
│   (HTTP POST)   │
└────────┬────────┘
         │
         │ POST /runpod/audio/transcribe
         │ {audio_url, path, model}
         │
         ▼
┌────────────────────────────────────────────────────┐
│           ORQUESTRADOR (api-gpu)                   │
│                                                    │
│  1. Valida input (audio_url, path, model)         │
│  2. Chama RunPod Worker (via API)                 │
│  3. Aguarda resposta (polling)                    │
│  4. Recebe output bruto (segments + words)        │
│  5. Formata arquivos (SRT, JSON, ASS karaoke)     │
│  6. Upload para S3/MinIO                          │
│  7. Retorna URLs + estatísticas                   │
│                                                    │
└────────┬───────────────────────────────────────────┘
         │
         │ POST /v2/{endpoint_id}/run
         │ {input: {audio, model, language, ...}}
         │
         ▼
┌────────────────────────────────────────────────────┐
│          RUNPOD WORKER (Serverless)                │
│                                                    │
│  1. Recebe job via RunPod handler                 │
│  2. Valida input (audio, model, etc)              │
│  3. Faz download do áudio (temp file)             │
│  4. Executa transcrição com Whisper               │
│  5. Extrai segments + word_timestamps             │
│  6. Retorna output bruto:                         │
│     - segments[]                                  │
│     - word_timestamps[] (opcional)                │
│     - detected_language                           │
│     - transcription (texto completo)              │
│     - device, model                               │
│  7. Cleanup (deleta temp file)                    │
│                                                    │
└────────┬───────────────────────────────────────────┘
         │
         │ Usa imagem Docker do Hub
         │
         ▼
┌────────────────────────────────────────────────────┐
│            RUNPOD HUB (Cache Registry)             │
│                                                    │
│  - Armazena imagem Docker pré-built                │
│  - Permite cold start rápido (~6s vs 8+ min)      │
│  - Versionamento (v1.0.0, v1.1.0, etc)            │
│  - Testes automáticos antes de publicar           │
│                                                    │
│  Conteúdo da imagem:                              │
│  - CUDA 11.8 + cuDNN                              │
│  - PyTorch 2.1.2                                  │
│  - OpenAI Whisper (ou faster-whisper)             │
│  - Modelos pré-cacheados (base, medium, turbo)    │
│  - Handler RunPod (src/handler.py)                │
│                                                    │
└────────────────────────────────────────────────────┘
```

---

## 🔄 Fluxo Detalhado

### 1. Cliente → Orquestrador

**Endpoint:** `POST /runpod/audio/transcribe`

**Payload:**
```json
{
  "audio_url": "http://minio.automear.com/canais/.../audio_final.mp3",
  "path": "CANAL/VIDEO/transcriptions/",
  "model": "base"
}
```

**Headers:**
```
X-API-Key: sua-chave-api
Content-Type: application/json
```

---

### 2. Orquestrador → RunPod Worker

**Serviço:** `RunPodWhisperService`

**Ações:**
1. Constrói payload RunPod
2. Submete job: `POST https://api.runpod.ai/v2/{endpoint_id}/run`
3. Recebe `job_id`
4. Polling: `GET https://api.runpod.ai/v2/{endpoint_id}/status/{job_id}`
5. Aguarda status `COMPLETED`

**Payload enviado ao worker:**
```json
{
  "input": {
    "audio": "http://minio.automear.com/.../audio.mp3",
    "model": "base",
    "transcription": "plain_text",
    "translate": false,
    "language": null,
    "temperature": 0,
    "best_of": 5,
    "beam_size": 5,
    "patience": 1,
    "suppress_tokens": "-1",
    "condition_on_previous_text": true,
    "temperature_increment_on_fallback": 0.2,
    "compression_ratio_threshold": 2.4,
    "logprob_threshold": -1.0,
    "no_speech_threshold": 0.6,
    "enable_vad": true,
    "word_timestamps": true
  }
}
```

---

### 3. Worker Processamento

**Handler:** `src/handler.py` → `run_whisper_job()`

**Fluxo:**
1. Extrai `job.input.audio`, `job.input.model`, etc
2. Chama `download_audio(audio_url)` → salva em `/tmp/audio_xyz.mp3`
3. Chama `MODEL.predict(audio_path, model, language, ...)`
4. `predict()` carrega modelo Whisper (cache se já carregado)
5. Executa `whisper_model.transcribe(audio_path, ...)`
6. Extrai `segments` e `word_timestamps`
7. Retorna output
8. Deleta arquivo temporário

**Output retornado ao orquestrador:**
```json
{
  "segments": [
    {
      "id": 0,
      "seek": 0,
      "start": 0.0,
      "end": 2.5,
      "text": "God is unfolding His plan...",
      "tokens": [1234, 5678, ...],
      "temperature": 0.0,
      "avg_logprob": -0.234,
      "compression_ratio": 1.8,
      "no_speech_prob": 0.01
    },
    ...
  ],
  "word_timestamps": [
    {"word": "God", "start": 0.0, "end": 0.3},
    {"word": "is", "start": 0.35, "end": 0.5},
    ...
  ],
  "detected_language": "en",
  "transcription": "God is unfolding His plan for you...",
  "device": "cuda",
  "model": "base"
}
```

---

### 4. Orquestrador Pós-Processamento

**Serviços:**
- `TranscriptionFormatter`: Formata output em diferentes formatos
- `S3UploadService`: Upload para MinIO/S3

**Fluxo:**
1. Recebe output bruto do worker
2. Gera `segments.srt` via `TranscriptionFormatter.toSRT(segments)`
3. Gera `words.json` via `TranscriptionFormatter.toJSON(words)`
4. Gera `karaoke.ass` via `TranscriptionFormatter.toASSKaraoke(words)` (se word_timestamps disponível)
5. Upload para S3:
   - `{path}/segments.srt`
   - `{path}/words.json`
   - `{path}/karaoke.ass`
6. Retorna URLs públicas + estatísticas

**Response ao cliente:**
```json
{
  "code": 200,
  "message": "Transcription completed successfully",
  "job_id": "f3dc61b8-60d5-44ea-b359-ea4d8bd7c280",
  "language": "en",
  "transcription": "God is unfolding His plan for you...",
  "files": {
    "segments": {
      "srt": "https://minio.automear.com/.../segments.srt",
      "vtt": "",
      "json": "https://minio.automear.com/.../words.json"
    },
    "words": {
      "ass_karaoke": "https://minio.automear.com/.../karaoke.ass",
      "vtt_karaoke": "",
      "lrc": "",
      "json": "https://minio.automear.com/.../words.json"
    }
  },
  "execution": {
    "startTime": "2025-10-22T23:02:53.887Z",
    "endTime": "2025-10-22T23:03:33.909Z",
    "durationMs": 40022,
    "durationSeconds": 40.02
  },
  "stats": {
    "segments": 372,
    "words": 2781,
    "model": "base",
    "device": "cuda"
  }
}
```

---

## 📊 Divisão de Responsabilidades

### ORQUESTRADOR (api-gpu)
- ✅ Autenticação (API Key)
- ✅ Validação de input
- ✅ Comunicação com RunPod API
- ✅ Formatação de arquivos (SRT, VTT, ASS, JSON)
- ✅ Upload para S3/MinIO
- ✅ Construção de response final
- ✅ Métricas e logs
- ❌ **NÃO** faz transcrição

### WORKER (whisper-hub ou faster-whisper)
- ✅ Download de áudio
- ✅ Transcrição com Whisper
- ✅ Extração de segments e word_timestamps
- ✅ Detecção de idioma
- ✅ Gestão de GPU/modelo
- ❌ **NÃO** formata arquivos (SRT, ASS, etc)
- ❌ **NÃO** faz upload para S3
- ❌ **NÃO** sabe sobre MinIO

### HUB (RunPod Hub)
- ✅ Armazena imagem Docker pré-built
- ✅ Versionamento de releases
- ✅ Testes automáticos
- ✅ Cache para cold start rápido
- ❌ **NÃO** executa código (apenas armazena)

---

## 🔑 Variáveis de Ambiente

### Orquestrador (.env)
```bash
# RunPod API
RUNPOD_API_KEY=rpa_xxx

# Faster-Whisper (atual)
RUNPOD_WHISPER_ENDPOINT_ID=82jjrwujznxwvn

# OpenAI Whisper Official (novo)
RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID=xxx

# S3/MinIO
S3_ENDPOINT=http://minio.automear.com
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
S3_BUCKET=canais

# API
X_API_KEY=sua-chave-api
PORT=3000
```

---

## 🚀 Dois Endpoints Side-by-Side

### Endpoint 1: Faster-Whisper (Atual)
- **Rota:** `/runpod/audio/transcribe`
- **Worker:** RunPod Hub `runpod-workers/worker-faster_whisper`
- **Endpoint ID:** `82jjrwujznxwvn`
- **Engine:** faster-whisper (CTranslate2)
- **Cold start:** ~6s (hub cacheado)
- **Velocidade:** Muito rápida
- **Qualidade:** Excelente

### Endpoint 2: OpenAI Whisper Official (Novo)
- **Rota:** `/runpod/audio/transcribe-whisper`
- **Worker:** Nosso Hub `FresHHerB/whisper-hub`
- **Endpoint ID:** A ser criado
- **Engine:** OpenAI Whisper (PyTorch)
- **Cold start:** ~30s-2min (após hub publicado: ~6s)
- **Velocidade:** Rápida
- **Qualidade:** Máxima (sem quantização)

**Ambos compartilham:**
- Mesmo orquestrador (api-gpu)
- Mesma lógica de formatação (TranscriptionFormatter)
- Mesmo upload S3 (S3UploadService)
- Mesmo formato de output

**Diferença:**
- Apenas qual worker RunPod chama
- Apenas o `RUNPOD_WHISPER_ENDPOINT_ID` usado

---

## 🎯 Por Que Usar RunPod Hub?

### Problema: Cold Start Lento
Sem hub, cada cold start precisa:
1. Iniciar container vazio
2. Pull da imagem Docker (~8GB)
3. Instalar dependências
4. Download de modelos Whisper (~4-5GB)

**Tempo total:** 8+ minutos

### Solução: RunPod Hub
Com hub, cold start apenas:
1. Pull imagem pré-built (cache no RunPod)
2. Modelos já estão na imagem

**Tempo total:** ~6 segundos (similar a faster-whisper)

### Benefícios do Hub
- ✅ **Cold start 80x mais rápido** (6s vs 8min)
- ✅ **Modelos pré-cacheados** (base, medium, turbo)
- ✅ **Versionamento** (v1.0.0, v1.1.0, etc)
- ✅ **Testes automáticos** antes de publicar
- ✅ **Marketplace público** (outros podem usar)
- ✅ **Badge no README** (credibilidade)

---

## 📁 Estrutura de Arquivos

```
api-gpu/
├── src/
│   ├── orchestrator/
│   │   ├── routes/
│   │   │   └── transcription.ts         # Rotas /runpod/audio/*
│   │   ├── services/
│   │   │   ├── runpodWhisperService.ts  # faster-whisper service
│   │   │   ├── transcriptionFormatter.ts # Formata SRT/ASS/JSON
│   │   │   └── s3Upload.ts              # Upload MinIO/S3
│   │   └── index.ts                     # Registra rotas
│   └── shared/
│       └── types/
│           └── index.ts                  # TypeScript interfaces
└── docs/
    ├── API.md                            # Documentação de API
    └── WHISPER_ARCHITECTURE.md           # Este arquivo

whisper-hub/
├── .runpod/
│   ├── hub.json                          # Configuração RunPod Hub
│   └── tests.json                        # Testes automáticos
├── src/
│   ├── handler.py                        # RunPod serverless handler
│   └── predict.py                        # Whisper predictor
├── builder/
│   ├── fetch_models.py                   # Pre-download models
│   └── requirements.txt
├── Dockerfile                            # CUDA + PyTorch + Whisper
├── requirements.txt                      # Runtime deps
└── README.md                             # Documentação
```

---

## 🔄 Próximos Passos

1. ✅ Arquivos do hub criados (.runpod/hub.json, tests.json)
2. ✅ Git commit + push
3. ✅ Tag v1.0.0 criada
4. ✅ GitHub release publicada
5. ⏳ **Conectar repositório ao RunPod Hub**
6. ⏳ **Publicar release no hub**
7. ⏳ **Criar endpoint no RunPod**
8. ⏳ **Criar `/runpod/audio/transcribe-whisper` no orquestrador**
9. ⏳ **Testar novo endpoint**

---

## 📞 Suporte

- **Documentação RunPod Hub:** https://docs.runpod.io/serverless/workers/hub
- **Repositório whisper-hub:** https://github.com/FresHHerB/whisper-hub
- **API Documentation:** D:\code\github\api-gpu\docs\API.md
