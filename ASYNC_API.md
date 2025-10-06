# API Assíncrona - Guia Completo

## 🎯 Visão Geral

A API agora suporta dois modos de operação:

| Modo | Quando Usar | Timeout | Resposta |
|------|-------------|---------|----------|
| **Síncrono** | Jobs rápidos (<5 min) | 15 minutos | Retorna resultado completo |
| **Assíncrono** | Jobs longos ou múltiplos jobs | ∞ Ilimitado | Retorna jobId imediatamente |

---

## 📊 Arquitetura Assíncrona

```
┌─────────┐
│ Cliente │
└────┬────┘
     │
     │ 1. POST /video/img2vid/async
     ↓
┌────────────┐
│ Orquestrador│  ← Retorna jobId IMEDIATAMENTE
└────┬───────┘
     │ 2. Submit para RunPod
     ↓
┌────────────┐
│   RunPod   │  ← Processa em background
│   Worker   │
└────────────┘
     ↑
     │ 3. Cliente consulta status
┌────┴────┐
│ Cliente │ → GET /video/job/:jobId
└─────────┘
```

---

## 🚀 Endpoints Assíncronos

### 1. **Submeter Job (Retorna Imediatamente)**

#### POST /video/caption/async
```bash
curl -X POST http://localhost:3000/video/caption/async \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_srt": "https://example.com/subtitles.srt",
    "path": "videos/output",
    "output_filename": "video_with_caption.mp4"
  }'
```

**Resposta (imediata):**
```json
{
  "jobId": "abc-123-def",
  "status": "IN_QUEUE",
  "statusUrl": "/video/job/abc-123-def",
  "resultUrl": "/video/job/abc-123-def/result",
  "message": "Job submitted successfully. Use statusUrl to check progress."
}
```

---

#### POST /video/img2vid/async
```bash
curl -X POST http://localhost:3000/video/img2vid/async \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "id": "img1",
        "image_url": "https://example.com/image1.jpg",
        "duracao": 3.0
      },
      {
        "id": "img2",
        "image_url": "https://example.com/image2.jpg",
        "duracao": 4.0
      }
    ],
    "path": "videos/output"
  }'
```

**Resposta:**
```json
{
  "jobId": "xyz-789-ghi",
  "status": "IN_QUEUE",
  "statusUrl": "/video/job/xyz-789-ghi",
  "resultUrl": "/video/job/xyz-789-ghi/result",
  "message": "Job submitted successfully. Use statusUrl to check progress.",
  "estimatedTime": "2-10 minutes depending on image count"
}
```

---

#### POST /video/addaudio/async
```bash
curl -X POST http://localhost:3000/video/addaudio/async \
  -H "X-API-Key: your-api-key" \
  -H "Content-Type: application/json" \
  -d '{
    "url_video": "https://example.com/video.mp4",
    "url_audio": "https://example.com/audio.mp3",
    "path": "videos/output",
    "output_filename": "video_with_audio.mp4"
  }'
```

---

### 2. **Consultar Status do Job**

#### GET /video/job/:jobId
```bash
curl http://localhost:3000/video/job/abc-123-def \
  -H "X-API-Key: your-api-key"
```

**Respostas possíveis:**

**IN_QUEUE:**
```json
{
  "id": "abc-123-def",
  "status": "IN_QUEUE",
  "delayTime": 1500
}
```

**IN_PROGRESS:**
```json
{
  "id": "abc-123-def",
  "status": "IN_PROGRESS",
  "delayTime": 2000,
  "executionTime": 45000
}
```

**COMPLETED:**
```json
{
  "id": "abc-123-def",
  "status": "COMPLETED",
  "delayTime": 2000,
  "executionTime": 120000,
  "output": {
    "videos": [
      {
        "id": "img1",
        "video_url": "https://s3.example.com/video_1.mp4",
        "filename": "video_1.mp4"
      }
    ],
    "message": "Images converted successfully"
  }
}
```

**FAILED:**
```json
{
  "id": "abc-123-def",
  "status": "FAILED",
  "error": "Failed to download image: 404 Not Found"
}
```

---

### 3. **Obter Resultado (Apenas quando completo)**

#### GET /video/job/:jobId/result
```bash
curl http://localhost:3000/video/job/abc-123-def/result \
  -H "X-API-Key: your-api-key"
```

**Se ainda em progresso (HTTP 202):**
```json
{
  "jobId": "abc-123-def",
  "status": "IN_PROGRESS",
  "message": "Job is in progress",
  "statusUrl": "/video/job/abc-123-def"
}
```

**Se completo (HTTP 200):**
```json
{
  "jobId": "abc-123-def",
  "status": "COMPLETED",
  "result": {
    "videos": [...],
    "message": "..."
  },
  "delayTime": 2000,
  "executionTime": 120000
}
```

---

### 4. **Cancelar Job**

#### POST /job/:jobId/cancel
```bash
curl -X POST http://localhost:3000/job/abc-123-def/cancel \
  -H "X-API-Key: your-api-key"
```

**Resposta:**
```json
{
  "message": "Job cancelled successfully",
  "jobId": "abc-123-def"
}
```

---

## 💻 Exemplos de Implementação

### **JavaScript/Node.js**

```javascript
// 1. Submeter job
async function submitVideo(images) {
  const response = await fetch('http://localhost:3000/video/img2vid/async', {
    method: 'POST',
    headers: {
      'X-API-Key': 'your-api-key',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ images, path: 'videos/output' })
  });

  const data = await response.json();
  return data.jobId;
}

// 2. Polling de status
async function pollJobStatus(jobId) {
  while (true) {
    const response = await fetch(`http://localhost:3000/video/job/${jobId}`, {
      headers: { 'X-API-Key': 'your-api-key' }
    });

    const status = await response.json();
    console.log(`Status: ${status.status}`);

    if (status.status === 'COMPLETED') {
      return status.output;
    }

    if (status.status === 'FAILED') {
      throw new Error(status.error);
    }

    // Aguarda 3 segundos antes de consultar novamente
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
}

// 3. Uso completo
const jobId = await submitVideo([...]);
const result = await pollJobStatus(jobId);
console.log('Videos:', result.videos);
```

---

### **Python**

```python
import requests
import time

API_URL = "http://localhost:3000"
API_KEY = "your-api-key"
HEADERS = {"X-API-Key": API_KEY, "Content-Type": "application/json"}

# 1. Submeter job
def submit_video(images):
    response = requests.post(
        f"{API_URL}/video/img2vid/async",
        headers=HEADERS,
        json={"images": images, "path": "videos/output"}
    )
    data = response.json()
    return data["jobId"]

# 2. Polling de status
def poll_job_status(job_id):
    while True:
        response = requests.get(
            f"{API_URL}/video/job/{job_id}",
            headers=HEADERS
        )
        status = response.json()

        print(f"Status: {status['status']}")

        if status["status"] == "COMPLETED":
            return status["output"]

        if status["status"] == "FAILED":
            raise Exception(status["error"])

        time.sleep(3)  # Aguarda 3 segundos

# 3. Uso
job_id = submit_video([...])
result = poll_job_status(job_id)
print("Videos:", result["videos"])
```

---

## 🔄 Comparação: Síncrono vs Assíncrono

### **Síncrono (Endpoints Originais)**

```bash
# POST /video/img2vid
# Cliente fica BLOQUEADO até completar (~10 minutos)
```

**Vantagens:**
- ✅ Simples (1 request)
- ✅ Recebe resultado imediatamente

**Desvantagens:**
- ❌ Cliente bloqueado por 10+ minutos
- ❌ Timeout de 15 minutos
- ❌ Não pode consultar progresso
- ❌ Se conexão cair, perde tudo

---

### **Assíncrono (Novos Endpoints)**

```bash
# POST /video/img2vid/async → retorna jobId (instantâneo)
# GET /video/job/:jobId → consulta quando quiser
```

**Vantagens:**
- ✅ Resposta instantânea (<1s)
- ✅ Cliente não fica bloqueado
- ✅ Sem limite de tempo (24h+)
- ✅ Pode fechar e voltar depois
- ✅ Múltiplos jobs simultâneos
- ✅ Consulta progresso

**Desvantagens:**
- ⚠️ Requer polling do cliente (2 requests)
- ⚠️ Mais complexo

---

## 📈 Casos de Uso

### **Use Síncrono quando:**
- Jobs rápidos (<5 minutos)
- Processamento simples (1-2 imagens)
- Cliente pode esperar
- Desenvolvimento/testes

### **Use Assíncrono quando:**
- Batches grandes (>10 imagens)
- Jobs longos (>5 minutos)
- Múltiplos jobs simultâneos
- Cliente não pode ficar bloqueado
- Produção com alta carga

---

## 🔧 Configurações

### **Timeouts**

```typescript
// Express Server (Síncrono)
server.timeout = 900000  // 15 minutos

// Polling Dinâmico (Assíncrono)
maxWaitMs: 720000  // 12 minutos (padrão)
// Mas pode ser INFINITO no assíncrono!
```

### **Polling**

```typescript
// Intervalo inicial
delay: 2000ms  // 2 segundos

// Intervalo máximo (exponential backoff)
maxDelay: 8000ms  // 8 segundos

// Progressão: 2s → 3s → 4.5s → 6.75s → 8s (max)
```

---

## 🎯 Best Practices

### 1. **Use Exponential Backoff**
```javascript
let delay = 2000;
const maxDelay = 8000;

while (true) {
  const status = await checkStatus(jobId);
  if (status.status === 'COMPLETED') break;

  await sleep(delay);
  delay = Math.min(delay * 1.5, maxDelay);
}
```

### 2. **Armazene jobId**
```javascript
// Salvar para poder consultar depois
localStorage.setItem('lastJobId', jobId);

// Recuperar em outra sessão
const jobId = localStorage.getItem('lastJobId');
```

### 3. **Trate Erros**
```javascript
try {
  const result = await pollJobStatus(jobId);
} catch (error) {
  if (error.message.includes('FAILED')) {
    // Job falhou no RunPod
  } else if (error.message.includes('timeout')) {
    // Timeout local (continua rodando no RunPod)
  }
}
```

### 4. **Múltiplos Jobs**
```javascript
// Submeter todos de uma vez
const jobIds = await Promise.all([
  submitVideo(batch1),
  submitVideo(batch2),
  submitVideo(batch3)
]);

// Aguardar todos
const results = await Promise.all(
  jobIds.map(id => pollJobStatus(id))
);
```

---

## 🐛 Troubleshooting

### **Job fica em IN_QUEUE por muito tempo**
- Workers throttled (GPU não disponível)
- Aumente `workersMax` no endpoint RunPod
- Use GPUs menos concorridas

### **Status retorna 404**
- JobId inválido
- Job muito antigo (>24h)
- RunPod deletou o job

### **Job falha imediatamente**
- Erro na validação de input
- URLs inválidas/inacessíveis
- Verifique logs do worker

---

## 📚 Referências

- [RunPod Job States](https://docs.runpod.io/serverless/references/job-states)
- [RunPod Send Requests](https://docs.runpod.io/serverless/endpoints/send-requests)
- [Código fonte: videoProxy.ts](src/orchestrator/routes/videoProxy.ts)

---

## 📝 Changelog

**v2.0.0 - Async API**
- ✅ Novos endpoints assíncronos: `/video/*/async`
- ✅ Polling dinâmico baseado em tempo
- ✅ Endpoints de status: `GET /video/job/:jobId`
- ✅ Endpoint de resultado: `GET /video/job/:jobId/result`
- ✅ Mantém endpoints síncronos para compatibilidade
- ✅ Sem limite de timeout para async

---

**Implementado em:** 06/10/2025
**Autor:** Claude Code
**Status:** ✅ Produção
