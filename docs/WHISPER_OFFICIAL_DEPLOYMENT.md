# Deployment Guide: OpenAI Whisper Official Endpoint

Este guia explica como deployar o novo endpoint `/runpod/audio/transcribe-whisper` usando o OpenAI Whisper Official via RunPod Hub.

---

## 📋 O Que Foi Implementado

### ✅ Código Completo

1. **whisper-hub (Worker):**
   - ✅ `src/handler.py` - RunPod serverless handler
   - ✅ `src/predict.py` - Whisper predictor com GPU optimization
   - ✅ `.runpod/hub.json` - Configuração RunPod Hub
   - ✅ `.runpod/tests.json` - 8 testes automáticos
   - ✅ `Dockerfile` - CUDA 11.8 + PyTorch 2.1.2 + Whisper
   - ✅ `README.md` - Documentação completa
   - ✅ Git tag v1.0.0 criada e publicada
   - ✅ GitHub release v1.0.0 publicada

2. **api-gpu (Orquestrador):**
   - ✅ `src/orchestrator/services/runpodWhisperOfficialService.ts` - Service para OpenAI Whisper
   - ✅ `src/orchestrator/routes/transcription.ts` - Nova rota `/runpod/audio/transcribe-whisper`
   - ✅ `.env.example` - Variável `RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID` adicionada
   - ✅ `docs/WHISPER_ARCHITECTURE.md` - Documentação da arquitetura
   - ✅ `docs/WHISPER_OFFICIAL_DEPLOYMENT.md` - Este guia

---

## 🚀 Passos para Deploy

### Passo 1: Conectar whisper-hub ao RunPod Hub

1. **Acesse o RunPod Hub:**
   ```
   https://console.runpod.io/hub
   ```

2. **Conecte o repositório:**
   - Clique em **"My Repos"** ou **"Add Repository"**
   - Conecte sua conta GitHub (FresHHerB)
   - Selecione o repositório `whisper-hub`
   - RunPod validará os arquivos:
     - ✅ `.runpod/hub.json`
     - ✅ `.runpod/tests.json`
     - ✅ `Dockerfile`

3. **Publique a release v1.0.0:**
   - Selecione a tag `v1.0.0`
   - Clique em **"Publish Release"**
   - Aguarde o build (~10-15 min)
   - RunPod irá:
     - Buildar a imagem Docker
     - Executar os 8 testes automáticos
     - Publicar no marketplace se tudo passar

4. **Verifique o status:**
   - Acompanhe o build nos logs
   - Aguarde status "Published"

---

### Passo 2: Criar Endpoint no RunPod

#### Opção A: Via Console (Recomendado)

1. **Acesse Serverless:**
   ```
   https://console.runpod.io/serverless
   ```

2. **Criar Endpoint:**
   - Clique em **"Create Endpoint"**
   - **Template:** Selecione `whisper-hub` (FresHHerB/whisper-hub)
   - **Configuration:**
     - Name: `whisper-official`
     - Min Workers: `0` (pay-per-use)
     - Max Workers: `3`
     - GPU Types: `AMPERE_16`, `AMPERE_24`
     - Idle Timeout: `30s`
     - FlashBoot: `Enabled`
   - Clique em **"Deploy"**

3. **Copie o Endpoint ID:**
   - Após deployment, copie o Endpoint ID
   - Exemplo: `abc123xyz456`

#### Opção B: Via API GraphQL

```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_RUNPOD_API_KEY" \
  -d '{
    "query": "mutation {
      saveEndpoint(input: {
        name: \"whisper-official\",
        templateId: \"YOUR_TEMPLATE_ID\",
        workersMin: 0,
        workersMax: 3,
        gpuIds: \"AMPERE_16,AMPERE_24\",
        scalerType: \"QUEUE_DELAY\",
        scalerValue: 3
      }) {
        id name templateId
      }
    }"
  }'
```

---

### Passo 3: Configurar Orquestrador (api-gpu)

1. **Atualizar .env:**

Adicione o Endpoint ID no arquivo `.env`:

```bash
# Whisper Transcription Endpoints
RUNPOD_WHISPER_ENDPOINT_ID=82jjrwujznxwvn          # faster-whisper (atual)
RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID=abc123xyz456   # OpenAI Whisper Official (novo)
```

2. **Rebuild e Deploy:**

```bash
cd D:\code\github\api-gpu

# Build TypeScript
npm run build:orchestrator

# Ou se usar Docker
docker build -t seu-usuario/api-gpu-orchestrator .
docker push seu-usuario/api-gpu-orchestrator:latest

# Restart no Easypanel/servidor
```

---

### Passo 4: Testar o Novo Endpoint

#### Health Check

```bash
curl "http://localhost:3000/runpod/audio/transcribe-whisper/health" \
  -H "X-API-Key: sua-chave-api"
```

**Resposta esperada:**
```json
{
  "status": "healthy",
  "service": "transcription-whisper-official",
  "whisper": {
    "healthy": true,
    "message": "RunPod Whisper Official endpoint is healthy: {...}"
  },
  "timestamp": "2025-10-23T01:00:00.000Z"
}
```

#### Teste de Transcrição

```bash
curl -X POST "http://localhost:3000/runpod/audio/transcribe-whisper" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: sua-chave-api" \
  -d '{
    "audio_url": "http://minio.automear.com/canais/GOD IS GREATER/SEE GOD'\''S PLAN UNFOLDING FOR YOU RIGHT NOW | Inspiration | Motivational/audios/audio_final.mp3",
    "path": "GOD IS GREATER/SEE GOD'\''S PLAN UNFOLDING FOR YOU RIGHT NOW | Inspiration | Motivational/transcriptions/",
    "model": "base"
  }'
```

**Resposta esperada:**
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
    "startTime": "2025-10-23T01:00:00.000Z",
    "endTime": "2025-10-23T01:00:40.000Z",
    "durationMs": 40000,
    "durationSeconds": 40.0
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

## 📊 Comparação: Faster-Whisper vs OpenAI Whisper Official

| Característica | Faster-Whisper | OpenAI Whisper Official |
|----------------|----------------|-------------------------|
| **Endpoint** | `/runpod/audio/transcribe` | `/runpod/audio/transcribe-whisper` |
| **Engine** | CTranslate2 | PyTorch |
| **Velocidade** | Muito rápida | Rápida |
| **Qualidade** | Excelente | Máxima (sem quantização) |
| **VRAM** | Menor | Maior |
| **Hub** | `runpod-workers/worker-faster_whisper` | `FresHHerB/whisper-hub` |
| **Cold Start** | ~6s | ~30s-2min (primeira vez), ~6s (após cache) |
| **Modelos** | tiny, base, small, medium, large-v1, large-v2, large-v3 | tiny, base, small, medium, turbo, large-v1, large-v2, large-v3 |
| **VAD** | Suportado | Não suportado |

---

## 🔧 Troubleshooting

### Erro: "RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID not configured"

**Solução:** Adicione a variável no `.env`:
```bash
RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID=seu-endpoint-id
```

### Erro: "RunPod job failed: Unknown error"

**Causas possíveis:**
1. Worker não iniciou corretamente
2. Modelo não encontrado
3. Erro ao fazer download do áudio

**Debug:**
```bash
# Verificar logs do RunPod
# No console RunPod, acesse:
# Serverless → Endpoints → whisper-official → Logs
```

### Erro: "Transcription timed out after 240 attempts"

**Solução:** Aumentar `POLLING_MAX_ATTEMPTS` no `.env`:
```bash
POLLING_MAX_ATTEMPTS=480  # 64 minutos
```

### Cold Start muito lento (8+ minutos)

**Causa:** Hub não está cacheado no RunPod

**Solução:**
1. Verificar se o hub foi publicado corretamente
2. Aguardar alguns minutos após primeira publicação
3. RunPod faz cache automático após primeiro uso

---

## 📁 Estrutura de Arquivos Criados/Modificados

```
api-gpu/
├── src/
│   └── orchestrator/
│       ├── routes/
│       │   └── transcription.ts ✅ MODIFICADO
│       └── services/
│           └── runpodWhisperOfficialService.ts ✅ NOVO
├── docs/
│   ├── WHISPER_ARCHITECTURE.md ✅ NOVO
│   └── WHISPER_OFFICIAL_DEPLOYMENT.md ✅ NOVO (este arquivo)
└── .env.example ✅ MODIFICADO

whisper-hub/
├── .runpod/
│   ├── hub.json ✅ CRIADO
│   └── tests.json ✅ CRIADO
├── src/
│   ├── handler.py ✅ EXISTENTE
│   └── predict.py ✅ EXISTENTE
├── Dockerfile ✅ EXISTENTE
├── README.md ✅ MODIFICADO
└── RUNPOD_HUB_SETUP.md ✅ CRIADO
```

---

## 🎯 Checklist de Deploy

### Pre-Deploy
- [x] Código do worker whisper-hub completo
- [x] Git tag v1.0.0 criada e publicada
- [x] GitHub release v1.0.0 criada
- [x] Código do orquestrador api-gpu completo
- [x] Documentação atualizada

### Deploy whisper-hub
- [ ] Conectar repositório ao RunPod Hub
- [ ] Publicar release v1.0.0 no Hub
- [ ] Aguardar build e testes (~10-15 min)
- [ ] Verificar status "Published"

### Deploy Endpoint
- [ ] Criar endpoint no RunPod (via console ou API)
- [ ] Copiar Endpoint ID
- [ ] Configurar GPUs (AMPERE_16, AMPERE_24)
- [ ] Configurar scaling (min: 0, max: 3)
- [ ] Habilitar FlashBoot

### Deploy Orquestrador
- [ ] Atualizar `.env` com `RUNPOD_WHISPER_OFFICIAL_ENDPOINT_ID`
- [ ] Build TypeScript (`npm run build:orchestrator`)
- [ ] Deploy para servidor (Easypanel, Docker, etc)
- [ ] Restart do serviço

### Testing
- [ ] Health check: `GET /runpod/audio/transcribe-whisper/health`
- [ ] Test transcription: `POST /runpod/audio/transcribe-whisper`
- [ ] Verificar arquivos no MinIO (segments.srt, words.json, karaoke.ass)
- [ ] Testar cold start (primeira requisição)
- [ ] Testar warm start (requisições subsequentes)

---

## 📞 Suporte

### Documentação
- **Arquitetura:** `D:\code\github\api-gpu\docs\WHISPER_ARCHITECTURE.md`
- **API Docs:** `D:\code\github\api-gpu\docs\API.md`
- **RunPod Hub:** https://docs.runpod.io/serverless/workers/hub
- **Repositório whisper-hub:** https://github.com/FresHHerB/whisper-hub

### Links Úteis
- **RunPod Console:** https://console.runpod.io
- **RunPod Hub (whisper-hub):** https://console.runpod.io/hub/FresHHerB/whisper-hub
- **GitHub Release:** https://github.com/FresHHerB/whisper-hub/releases/tag/v1.0.0

---

## 🎉 Próximos Passos Após Deploy

1. **Monitoramento:**
   - Acompanhar logs no RunPod Console
   - Verificar métricas de execução
   - Monitorar custos

2. **Otimização:**
   - Ajustar scaling conforme demanda
   - Testar diferentes modelos (base, medium, turbo)
   - Avaliar cold start vs warm start

3. **Iteração:**
   - Coletar feedback de qualidade
   - Comparar com faster-whisper
   - Decidir qual endpoint usar como padrão

---

**Status:** ✅ Código completo e pronto para deploy
**Próximo passo:** Conectar whisper-hub ao RunPod Hub e criar endpoint
