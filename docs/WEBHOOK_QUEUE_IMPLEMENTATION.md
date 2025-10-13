# Webhook + Queue Implementation Plan

Documentação da implementação de webhooks com sistema de fila gerenciada pelo orchestrador.

---

## 📋 Índice

- [Visão Geral](#visão-geral)
- [Arquitetura](#arquitetura)
- [Mudanças na API](#mudanças-na-api)
- [Fluxo Completo](#fluxo-completo)
- [Componentes](#componentes)
- [Estruturas de Dados](#estruturas-de-dados)
- [Pontos Críticos](#pontos-críticos)
- [Fases de Implementação](#fases-de-implementação)
- [Exemplos de Uso](#exemplos-de-uso)

---

## Visão Geral

### Objetivo

Implementar sistema de **webhooks assíncronos** com **fila gerenciada** pelo orchestrador, permitindo que clientes:
1. Enviem jobs e recebam jobId imediatamente
2. Recebam callback automático via webhook quando job completar
3. Não precisem fazer polling manual

### Benefícios

✅ **Desacoplamento:** Cliente não bloqueia esperando resposta
✅ **Escalabilidade:** Fila gerencia concorrência automaticamente
✅ **Rastreabilidade:** `id_roteiro` identifica jobs por projeto
✅ **Resiliência:** Retry automático de webhooks
✅ **Transparência:** Status API para consulta

### Desafios

⚠️ **Complexidade:** Requer Redis + background worker
⚠️ **Fila compartilhada:** 3 workers RunPod para todos os endpoints
⚠️ **Multi-worker splitting:** 100 imagens = 3 sub-jobs RunPod
⚠️ **Persistência:** Fila precisa sobreviver a restarts
⚠️ **Timeout:** Jobs podem ficar presos indefinidamente

---

## Arquitetura

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────┐
│                       Cliente (n8n)                      │
└───────────────┬─────────────────────────────────────────┘
                │ POST /video/img2vid/async
                │ { id_roteiro, webhook_url, images }
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│                    Orchestrator (Express)                │
│  ┌────────────────────────────────────────────────────┐ │
│  │ 1. API Router: Recebe request                      │ │
│  │ 2. Gera orchestratorJobId                          │ │
│  │ 3. Enfileira job no Redis                          │ │
│  │ 4. Retorna { jobId, status: "QUEUED" }            │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌────────────────────────────────────────────────────┐ │
│  │ JobScheduler (Background Worker)                   │ │
│  │ ┌────────────────────────────────────────────────┐ │ │
│  │ │ Loop 1: Queue Processor                        │ │ │
│  │ │ - RPOP jobs da fila pending                    │ │ │
│  │ │ - Verifica workers disponíveis                 │ │ │
│  │ │ - Submete ao RunPod                            │ │ │
│  │ │ - Armazena runpodJobIds                        │ │ │
│  │ └────────────────────────────────────────────────┘ │ │
│  │                                                      │ │
│  │ ┌────────────────────────────────────────────────┐ │ │
│  │ │ Loop 2: Job Monitor                            │ │ │
│  │ │ - Poll RunPod status de jobs IN_PROGRESS      │ │ │
│  │ │ - Detecta COMPLETED/FAILED                     │ │ │
│  │ │ - Chama WebhookService                         │ │ │
│  │ └────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                                                           │
│  ┌────────────────────────────────────────────────────┐ │
│  │ WebhookService                                     │ │
│  │ - POST webhook_url com resultado                  │ │
│  │ - Retry até 5x (exponential backoff)             │ │
│  │ - Dead Letter Queue (DLQ) para falhas             │ │
│  └────────────────────────────────────────────────────┘ │
└───────────────┬─────────────────────────────────────────┘
                │ Submete jobs ao RunPod
                │
                ▼
┌─────────────────────────────────────────────────────────┐
│                   RunPod Serverless                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │ Worker 1 │  │ Worker 2 │  │ Worker 3 │  (Max: 3)    │
│  └──────────┘  └──────────┘  └──────────┘              │
│                                                           │
│  Processa: img2vid, caption, addaudio                    │
└─────────────────────────────────────────────────────────┘
```

### Stack Tecnológico

| Componente | Tecnologia | Justificativa |
|------------|------------|---------------|
| Fila | Redis (Lists + Hashes) | Persistente, rápido, atomic operations |
| Background Worker | Node.js setInterval | Simples, suficiente para MVP |
| Webhook Delivery | Axios + Retry | HTTP client robusto |
| Lock (Fase 2) | Redis SETNX | Distribuído, previne race conditions |

---

## Mudanças na API

### Request (Antes)

```json
POST /video/img2vid
{
  "path": "Project/videos/temp/",
  "images": [
    { "id": "1", "image_url": "https://...", "duracao": 5.32 }
  ]
}
```

**Resposta:** Bloqueante, retorna após processar (~2-10 min)

---

### Request (Depois)

```json
POST /video/img2vid/async
{
  "id_roteiro": 34,
  "webhook_url": "https://n8n.example.com/webhook/gerarVideo",
  "path": "Project/videos/temp/",
  "images": [
    { "id": "1", "image_url": "https://...", "duracao": 5.32 },
    { "id": "2", "image_url": "https://...", "duracao": 7.28 }
  ],
  "zoom_types": ["zoomin", "zoomout", "zoompanright"]
}
```

**Resposta:** Imediata (~100ms)

```json
{
  "jobId": "orc-550e8400-e29b-41d4-a716-446655440000",
  "status": "QUEUED",
  "id_roteiro": 34,
  "message": "Job enfileirado com sucesso",
  "estimatedTime": "2-10 minutos",
  "statusUrl": "/jobs/orc-550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-01-10T15:30:00Z"
}
```

---

### Webhook Callback (Quando Completar)

**Sucesso:**
```json
POST https://n8n.example.com/webhook/gerarVideo
{
  "jobId": "orc-550e8400-e29b-41d4-a716-446655440000",
  "id_roteiro": 34,
  "status": "COMPLETED",
  "operation": "img2vid",
  "result": {
    "code": 200,
    "message": "Images converted to videos successfully",
    "videos": [
      {
        "id": "1",
        "video_url": "https://s3.../video_1.mp4",
        "filename": "video_1.mp4"
      },
      {
        "id": "2",
        "video_url": "https://s3.../video_2.mp4",
        "filename": "video_2.mp4"
      }
    ]
  },
  "execution": {
    "startTime": "2025-01-10T15:30:05Z",
    "endTime": "2025-01-10T15:35:12Z",
    "durationMs": 307000,
    "durationSeconds": 307
  },
  "timestamp": "2025-01-10T15:35:12Z"
}
```

**Falha:**
```json
POST https://n8n.example.com/webhook/gerarVideo
{
  "jobId": "orc-550e8400-...",
  "id_roteiro": 34,
  "status": "FAILED",
  "operation": "img2vid",
  "error": {
    "code": "PROCESSING_ERROR",
    "message": "FFmpeg failed: Invalid input image format",
    "details": "Image 42 is corrupted"
  },
  "execution": {
    "startTime": "2025-01-10T15:30:05Z",
    "endTime": "2025-01-10T15:32:18Z",
    "durationMs": 133000,
    "durationSeconds": 133
  },
  "timestamp": "2025-01-10T15:32:18Z"
}
```

---

## Fluxo Completo

### Cenário: 4 Requests de 100 Imagens (Concorrentes)

```
T=0s    Cliente 1 → POST /img2vid/async (100 imgs)
        Orchestrator → Retorna jobId: job-1, status: QUEUED

T=0.1s  Cliente 2 → POST /img2vid/async (100 imgs)
        Orchestrator → Retorna jobId: job-2, status: QUEUED

T=0.2s  Cliente 3 → POST /img2vid/async (100 imgs)
        Orchestrator → Retorna jobId: job-3, status: QUEUED

T=0.3s  Cliente 4 → POST /img2vid/async (100 imgs)
        Orchestrator → Retorna jobId: job-4, status: QUEUED

─────────────────────────────────────────────────────────

T=1s    JobScheduler:
        - Processa fila: [job-1, job-2, job-3, job-4]
        - job-1: 100 imgs → divide em 3 sub-jobs RunPod
          * rp-abc-u1: 34 imgs
          * rp-abc-u2: 34 imgs
          * rp-abc-u3: 32 imgs
        - Submete os 3 sub-jobs ao RunPod
        - Status job-1: IN_PROGRESS
        - Workers disponíveis: 3 → 0 (OCUPADOS)

T=2s    JobScheduler:
        - Tenta processar job-2
        - Workers disponíveis: 0
        - job-2 permanece em QUEUED (aguarda)

─────────────────────────────────────────────────────────

T=4min  JobScheduler (Monitor):
        - Poll status sub-jobs de job-1:
          * rp-abc-u1: COMPLETED ✅
          * rp-abc-u2: COMPLETED ✅
          * rp-abc-u3: COMPLETED ✅
        - Agrega resultados (100 vídeos)
        - Status job-1: COMPLETED
        - Workers disponíveis: 0 → 3 (LIBERADOS)
        - POST webhook_url (Cliente 1) com resultado

T=4min  JobScheduler (Queue Processor):
        - Processa fila: [job-2, job-3, job-4]
        - job-2: divide em 3 sub-jobs RunPod
        - Submete ao RunPod
        - Status job-2: IN_PROGRESS
        - Workers disponíveis: 3 → 0

─────────────────────────────────────────────────────────

T=8min  job-2 completa → webhook Cliente 2
        job-3 inicia

T=12min job-3 completa → webhook Cliente 3
        job-4 inicia

T=16min job-4 completa → webhook Cliente 4

─────────────────────────────────────────────────────────

Total: ~16 minutos para 4 jobs (vs ~40 min se fossem sequenciais sem fila)
```

---

## Componentes

### 1. JobQueue Service

**Responsabilidades:**
- Gerenciar fila de jobs no Redis
- Adicionar/remover jobs
- Atualizar status
- Consultar disponibilidade de workers

**Interface:**
```typescript
class JobQueue {
  // Enfileirar job
  async enqueue(job: OrchestratorJob): Promise<void>

  // Pegar próximo job da fila
  async dequeue(): Promise<OrchestratorJob | null>

  // Atualizar status do job
  async updateStatus(jobId: string, status: JobStatus): Promise<void>

  // Buscar job por ID
  async getJob(jobId: string): Promise<OrchestratorJob | null>

  // Listar jobs por status
  async listByStatus(status: JobStatus): Promise<OrchestratorJob[]>

  // Verificar workers disponíveis
  async getAvailableWorkers(): Promise<number>

  // Reservar workers
  async reserveWorkers(count: number): Promise<boolean>

  // Liberar workers
  async releaseWorkers(count: number): Promise<void>
}
```

**Estrutura Redis:**
```
orchestrator:queue:pending    → ["job-1", "job-2", "job-3"]
orchestrator:queue:inprogress → ["job-4"]
orchestrator:jobs:job-1       → Hash com dados do job
orchestrator:workers:available → "3" (contador)
```

---

### 2. JobScheduler Service

**Responsabilidades:**
- Loop 1: Processar fila (dequeue + submit ao RunPod)
- Loop 2: Monitorar jobs em progresso (poll RunPod)
- Gerenciar lifecycle de jobs
- Timeout e cleanup

**Pseudocódigo:**

```typescript
class JobScheduler {
  private queue: JobQueue;
  private runpodService: RunPodService;
  private webhookService: WebhookService;

  async start() {
    // Loop 1: Queue Processor (a cada 5s)
    setInterval(() => this.processQueue(), 5000);

    // Loop 2: Job Monitor (a cada 8s)
    setInterval(() => this.monitorJobs(), 8000);

    // Loop 3: Timeout Checker (a cada 60s)
    setInterval(() => this.checkTimeouts(), 60000);
  }

  private async processQueue() {
    // 1. Verificar workers disponíveis
    const available = await this.queue.getAvailableWorkers();
    if (available === 0) return; // Aguarda workers liberarem

    // 2. Dequeue próximo job
    const job = await this.queue.dequeue();
    if (!job) return; // Fila vazia

    // 3. Calcular workers necessários
    const workersNeeded = this.calculateWorkersNeeded(job);

    // 4. Verificar se há workers suficientes
    if (workersNeeded > available) {
      // Re-enfileirar e aguardar
      await this.queue.enqueue(job);
      return;
    }

    // 5. Reservar workers
    await this.queue.reserveWorkers(workersNeeded);

    // 6. Submeter ao RunPod (pode ser multi-worker)
    const runpodJobIds = await this.submitToRunPod(job);

    // 7. Atualizar job
    job.status = 'IN_PROGRESS';
    job.runpodJobIds = runpodJobIds;
    job.startedAt = new Date();
    await this.queue.updateStatus(job.id, 'IN_PROGRESS');
  }

  private async monitorJobs() {
    // 1. Listar jobs IN_PROGRESS
    const jobs = await this.queue.listByStatus('IN_PROGRESS');

    for (const job of jobs) {
      // 2. Poll status de todos runpodJobIds
      const statuses = await Promise.all(
        job.runpodJobIds.map(id => this.runpodService.getJobStatus(id))
      );

      // 3. Verificar se todos completaram
      const allCompleted = statuses.every(s => s.status === 'COMPLETED');
      const anyFailed = statuses.some(s => s.status === 'FAILED');

      if (allCompleted) {
        // Agregar resultados
        const result = this.aggregateResults(statuses);

        // Atualizar job
        job.status = 'COMPLETED';
        job.completedAt = new Date();
        await this.queue.updateStatus(job.id, 'COMPLETED');

        // Liberar workers
        await this.queue.releaseWorkers(job.runpodJobIds.length);

        // Chamar webhook
        await this.webhookService.deliverWebhook(job.webhookUrl, {
          jobId: job.id,
          status: 'COMPLETED',
          result,
          // ...
        });
      } else if (anyFailed) {
        // Lógica de retry ou falha definitiva
        await this.handleFailure(job, statuses);
      }
    }
  }

  private async checkTimeouts() {
    const jobs = await this.queue.listByStatus('IN_PROGRESS');
    const now = Date.now();

    for (const job of jobs) {
      const elapsed = now - job.startedAt.getTime();
      const timeout = this.getTimeoutForOperation(job.operation);

      if (elapsed > timeout) {
        // Job timed out
        logger.error(`Job ${job.id} timed out after ${elapsed}ms`);

        // Cancelar jobs RunPod
        for (const rpJobId of job.runpodJobIds) {
          await this.runpodService.cancelJob(rpJobId);
        }

        // Marcar como FAILED
        job.status = 'FAILED';
        await this.queue.updateStatus(job.id, 'FAILED');

        // Liberar workers
        await this.queue.releaseWorkers(job.runpodJobIds.length);

        // Chamar webhook com erro
        await this.webhookService.deliverWebhook(job.webhookUrl, {
          jobId: job.id,
          status: 'FAILED',
          error: { code: 'TIMEOUT', message: `Job timed out after ${elapsed}ms` }
        });
      }
    }
  }
}
```

---

### 3. WebhookService

**Responsabilidades:**
- Entregar webhooks com retry
- Exponential backoff
- Dead Letter Queue (DLQ)
- Signature HMAC para segurança

**Retry Policy:**
```
Tentativa 1: Imediato
Tentativa 2: +2s
Tentativa 3: +4s
Tentativa 4: +8s
Tentativa 5: +16s
Total: 30s de tentativas
```

**Pseudocódigo:**
```typescript
class WebhookService {
  async deliverWebhook(
    url: string,
    payload: WebhookPayload,
    attempt: number = 0
  ): Promise<boolean> {
    try {
      const signature = this.generateSignature(payload);

      const response = await axios.post(url, payload, {
        timeout: 10000,
        headers: {
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': payload.timestamp
        }
      });

      if (response.status >= 200 && response.status < 300) {
        logger.info('Webhook delivered', { url, jobId: payload.jobId });
        return true;
      }

      throw new Error(`HTTP ${response.status}`);

    } catch (error) {
      if (attempt < 5) {
        const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
        logger.warn(`Webhook failed, retry in ${delay}ms`, { url, attempt });
        await this.sleep(delay);
        return await this.deliverWebhook(url, payload, attempt + 1);
      }

      // Esgotou tentativas → DLQ
      logger.error('Webhook failed after 5 attempts', { url, payload });
      await this.sendToDLQ(url, payload);
      return false;
    }
  }

  private async sendToDLQ(url: string, payload: WebhookPayload) {
    // Armazenar no Redis para análise manual
    await redis.lpush('orchestrator:webhooks:dlq', JSON.stringify({
      url,
      payload,
      failedAt: new Date().toISOString()
    }));
  }
}
```

---

## Estruturas de Dados

### OrchestratorJob

```typescript
interface OrchestratorJob {
  id: string;                    // UUID gerado pelo orchestrador
  operation: 'img2vid' | 'caption' | 'addaudio';
  status: 'QUEUED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  webhookUrl: string;            // URL para callback
  idRoteiro?: number;            // ID do roteiro/projeto
  data: any;                     // Request original (images, path, etc)
  runpodJobIds: string[];        // IDs dos jobs no RunPod (pode ser vazio se QUEUED)
  workersReserved: number;       // Quantos workers este job reservou
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  attempts: number;              // Tentativas de retry
  error?: string;                // Mensagem de erro se FAILED
}
```

### WebhookPayload

```typescript
interface WebhookPayload {
  jobId: string;
  idRoteiro?: number;
  status: 'COMPLETED' | 'FAILED';
  operation: 'img2vid' | 'caption' | 'addaudio';
  timestamp: string;

  // Se COMPLETED
  result?: {
    code: number;
    message: string;
    videos?: Array<{ id: string; video_url: string; filename: string }>;
    video_url?: string; // Para caption/addaudio
    execution: {
      startTime: string;
      endTime: string;
      durationMs: number;
      durationSeconds: number;
    };
  };

  // Se FAILED
  error?: {
    code: string;
    message: string;
    details?: string;
  };
}
```

---

## Pontos Críticos

### 1. Multi-Worker Splitting

**Problema:**
Job de 100 imagens precisa de 3 workers RunPod (lógica atual: `runpodService.ts:65`).

**Solução:**
```typescript
function calculateWorkersNeeded(job: OrchestratorJob): number {
  if (job.operation === 'img2vid') {
    const imageCount = job.data.images.length;
    if (imageCount > 50) {
      return Math.min(3, Math.ceil(imageCount / 34)); // Max 3 workers
    }
  }
  return 1; // caption/addaudio sempre 1 worker
}
```

### 2. Concorrência entre Endpoints

**Problema:**
`/img2vid`, `/caption_style`, `/addaudio` compartilham os mesmos 3 workers.

**Solução:**
Fila unificada (mesma estrutura Redis para todos endpoints).

### 3. Falha Parcial de Sub-Jobs

**Cenário:**
- Sub-job 1: ✅ COMPLETED
- Sub-job 2: ✅ COMPLETED
- Sub-job 3: ❌ FAILED

**Estratégia:**
1. **Retry automático:** Tentar novamente apenas o sub-job falhado (até 3x)
2. **Falha definitiva:** Se retry esgotar, marcar job inteiro como FAILED
3. **Partial success:** Incluir no webhook quais imagens completaram e quais falharam

```typescript
async handlePartialFailure(job: OrchestratorJob, statuses: RunPodJobResponse[]) {
  const failedJobIds = statuses
    .filter(s => s.status === 'FAILED')
    .map(s => s.id);

  if (job.attempts < 3) {
    // Retry apenas sub-jobs falhados
    logger.warn(`Retrying ${failedJobIds.length} failed sub-jobs`, { jobId: job.id });

    for (const failedJobId of failedJobIds) {
      // Re-submit apenas o chunk falhado
      // ...
    }

    job.attempts++;
    await this.queue.updateStatus(job.id, 'IN_PROGRESS');
  } else {
    // Esgotou retries → FAILED
    logger.error(`Job failed after 3 attempts`, { jobId: job.id });

    job.status = 'FAILED';
    job.error = `${failedJobIds.length} sub-jobs failed after retries`;
    await this.queue.updateStatus(job.id, 'FAILED');

    // Liberar workers
    await this.queue.releaseWorkers(job.workersReserved);

    // Webhook com erro
    await this.webhookService.deliverWebhook(job.webhookUrl, {
      jobId: job.id,
      status: 'FAILED',
      error: {
        code: 'PARTIAL_FAILURE',
        message: job.error,
        details: `Failed jobs: ${failedJobIds.join(', ')}`
      }
    });
  }
}
```

### 4. Persistência (Redis)

**Estrutura Redis:**

```redis
# Filas
orchestrator:queue:pending    → LIST ["job-1", "job-2", "job-3"]
orchestrator:queue:inprogress → LIST ["job-4"]

# Jobs (Hash por job)
orchestrator:jobs:job-1 → HASH {
  id: "job-1",
  operation: "img2vid",
  status: "QUEUED",
  webhookUrl: "https://...",
  idRoteiro: "34",
  data: "{...}",  # JSON stringified
  runpodJobIds: "[]",
  workersReserved: "0",
  createdAt: "2025-01-10T...",
  attempts: "0"
}

# Workers disponíveis
orchestrator:workers:available → STRING "3"

# Dead Letter Queue
orchestrator:webhooks:dlq → LIST ["{url, payload, failedAt}"]

# Cleanup (TTL)
orchestrator:jobs:job-1 → EXPIRE 86400  # 24h
```

**Comandos Redis:**

```typescript
// Enqueue
await redis.lpush('orchestrator:queue:pending', jobId);
await redis.hset(`orchestrator:jobs:${jobId}`, job);

// Dequeue
const jobId = await redis.rpop('orchestrator:queue:pending');

// Reservar workers
const available = await redis.get('orchestrator:workers:available');
await redis.decrby('orchestrator:workers:available', count);

// Liberar workers
await redis.incrby('orchestrator:workers:available', count);
```

### 5. Timeout por Operação

```typescript
function getTimeoutForOperation(operation: string): number {
  const timeouts = {
    img2vid: 60 * 60 * 1000,   // 60 min
    caption: 10 * 60 * 1000,   // 10 min
    addaudio: 5 * 60 * 1000    // 5 min
  };
  return timeouts[operation] || 30 * 60 * 1000; // Default: 30 min
}
```

### 6. Status API

```typescript
// GET /jobs/:jobId
router.get('/jobs/:jobId', authenticateApiKey, async (req, res) => {
  const { jobId } = req.params;
  const job = await jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  // Calcular progresso para jobs IN_PROGRESS
  let progress = null;
  if (job.status === 'IN_PROGRESS') {
    const statuses = await Promise.all(
      job.runpodJobIds.map(id => runpodService.getJobStatus(id))
    );
    const completed = statuses.filter(s => s.status === 'COMPLETED').length;
    const total = statuses.length;
    progress = { completed, total, percentage: (completed / total) * 100 };
  }

  res.json({
    jobId: job.id,
    status: job.status,
    operation: job.operation,
    idRoteiro: job.idRoteiro,
    progress,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    estimatedCompletion: job.status === 'IN_PROGRESS'
      ? this.estimateCompletion(job)
      : null
  });
});

// POST /jobs/:jobId/cancel
router.post('/jobs/:jobId/cancel', authenticateApiKey, async (req, res) => {
  const { jobId } = req.params;
  const job = await jobQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }

  if (job.status === 'COMPLETED' || job.status === 'FAILED') {
    return res.status(400).json({ error: 'Job already finished' });
  }

  // Cancelar jobs RunPod
  if (job.status === 'IN_PROGRESS') {
    for (const rpJobId of job.runpodJobIds) {
      await runpodService.cancelJob(rpJobId);
    }
    await jobQueue.releaseWorkers(job.workersReserved);
  }

  // Atualizar status
  job.status = 'CANCELLED';
  await jobQueue.updateStatus(jobId, 'CANCELLED');

  res.json({ message: 'Job cancelled', jobId });
});
```

---

## Fases de Implementação

### Fase 1: MVP (Semana 1-2)

**Objetivo:** Sistema básico funcional

**Entregas:**
- ✅ Redis setup + JobQueue service
- ✅ JobScheduler (processamento sequencial, 1 job por vez)
- ✅ WebhookService com retry simples (3x, sem DLQ)
- ✅ Endpoint POST /video/img2vid/async
- ✅ Endpoint GET /jobs/:jobId
- ✅ Timeout básico (60 min)

**Limitações:**
- ❌ Processamento sequencial (não paralelo)
- ❌ Sem retry de sub-jobs falhados
- ❌ Sem DLQ
- ❌ Single-instance apenas

**Complexidade:** 🟡 Média

---

### Fase 2: Produção (Semana 3-4)

**Objetivo:** Sistema robusto para produção

**Entregas:**
- ✅ Scheduling inteligente (múltiplos jobs paralelos respeitando 3 workers)
- ✅ Retry de sub-jobs parcialmente falhados
- ✅ Dead Letter Queue (DLQ)
- ✅ Timeout dinâmico baseado em operação
- ✅ Endpoint POST /jobs/:jobId/cancel
- ✅ Metrics/logging (Prometheus?)

**Limitações:**
- ❌ Ainda single-instance (não distribuído)

**Complexidade:** 🟠 Alta

---

### Fase 3: Scale-Out (Futuro)

**Objetivo:** Múltiplas instâncias do orchestrador

**Entregas:**
- ✅ Lock distribuído (Redis SETNX)
- ✅ Leader election
- ✅ Health checks entre instâncias
- ✅ Load balancer aware

**Complexidade:** 🔴 Muito Alta

---

## Exemplos de Uso

### Exemplo 1: n8n → API GPU

**n8n Workflow:**

```
1. Trigger: Webhook recebe dados do roteiro
   ↓
2. HTTP Request: POST /video/img2vid/async
   {
     "id_roteiro": {{ $json.id }},
     "webhook_url": "{{ $webhookUrl }}/callback",
     "path": "{{ $json.canal }}/{{ $json.titulo }}/videos/temp/",
     "images": {{ $json.imagens }}
   }
   ↓
3. Set Variable: jobId = {{ $json.jobId }}
   ↓
4. Webhook: Aguarda callback
   (URL: /webhook/callback)
   ↓
5. IF: status === "COMPLETED"
   ↓
6. Processar vídeos (concatenar, etc)
```

**Callback recebido pelo n8n:**
```json
{
  "jobId": "orc-550e8400-...",
  "id_roteiro": 34,
  "status": "COMPLETED",
  "result": {
    "videos": [
      { "id": "1", "video_url": "https://s3.../video_1.mp4" },
      { "id": "2", "video_url": "https://s3.../video_2.mp4" }
    ]
  }
}
```

---

### Exemplo 2: Polling como Fallback

Se webhook falhar (URL inválida, n8n offline), cliente pode fazer polling:

```bash
# 1. Enviar job
curl -X POST https://api-gpu.automear.com/video/img2vid/async \
  -H "X-API-Key: $API_KEY" \
  -d '{
    "id_roteiro": 34,
    "webhook_url": "https://offline.com/webhook",
    "path": "Project/videos/temp/",
    "images": [...]
  }'

# Resposta:
# { "jobId": "orc-123", "status": "QUEUED" }

# 2. Fazer polling a cada 10s
while true; do
  STATUS=$(curl -s https://api-gpu.automear.com/jobs/orc-123 \
    -H "X-API-Key: $API_KEY" | jq -r .status)

  echo "Status: $STATUS"

  if [ "$STATUS" = "COMPLETED" ]; then
    curl -s https://api-gpu.automear.com/jobs/orc-123 \
      -H "X-API-Key: $API_KEY" | jq .
    break
  fi

  sleep 10
done
```

---

### Exemplo 3: Cancelar Job

```bash
curl -X POST https://api-gpu.automear.com/jobs/orc-123/cancel \
  -H "X-API-Key: $API_KEY"

# Resposta:
# { "message": "Job cancelled", "jobId": "orc-123" }
```

---

## Monitoramento

### Métricas Importantes

```typescript
// Prometheus metrics
const metrics = {
  jobs_queued: new Gauge({
    name: 'orchestrator_jobs_queued',
    help: 'Number of jobs in queue'
  }),

  jobs_inprogress: new Gauge({
    name: 'orchestrator_jobs_inprogress',
    help: 'Number of jobs in progress'
  }),

  workers_available: new Gauge({
    name: 'orchestrator_workers_available',
    help: 'Number of available RunPod workers'
  }),

  job_duration_seconds: new Histogram({
    name: 'orchestrator_job_duration_seconds',
    help: 'Job execution time',
    buckets: [60, 120, 300, 600, 1200, 1800, 3600]
  }),

  webhook_success_total: new Counter({
    name: 'orchestrator_webhook_success_total',
    help: 'Number of successful webhook deliveries'
  }),

  webhook_failure_total: new Counter({
    name: 'orchestrator_webhook_failure_total',
    help: 'Number of failed webhook deliveries'
  })
};
```

### Dashboard Grafana

```
┌─────────────────────────────────────────────┐
│         Orchestrator Dashboard              │
├─────────────────────────────────────────────┤
│ Jobs Queued:       12                       │
│ Jobs In Progress:   3                       │
│ Jobs Completed:    89                       │
│ Jobs Failed:        2                       │
├─────────────────────────────────────────────┤
│ Workers Available:  0 / 3                   │
│ Avg Job Duration:   4.2 min                 │
│ Webhook Success:    98.5%                   │
├─────────────────────────────────────────────┤
│ [Gráfico: Job Queue Size over Time]        │
│ [Gráfico: Job Duration Distribution]       │
│ [Gráfico: Worker Utilization]              │
└─────────────────────────────────────────────┘
```

---

## Troubleshooting

### Job preso em QUEUED

**Causa:** Workers ocupados ou bug no scheduler

**Solução:**
```bash
# Verificar workers disponíveis
redis-cli GET orchestrator:workers:available

# Verificar fila
redis-cli LRANGE orchestrator:queue:pending 0 -1

# Verificar jobs IN_PROGRESS (podem estar travados)
redis-cli LRANGE orchestrator:queue:inprogress 0 -1

# Forçar liberação de workers (CUIDADO!)
redis-cli SET orchestrator:workers:available 3
```

### Job preso em IN_PROGRESS

**Causa:** Worker RunPod crashou ou network issue

**Solução:**
```bash
# Verificar job
curl https://api-gpu.automear.com/jobs/orc-123 -H "X-API-Key: $KEY"

# Verificar status no RunPod
curl https://api.runpod.ai/v2/{endpoint}/status/{runpodJobId} \
  -H "Authorization: Bearer $RUNPOD_API_KEY"

# Se necessário, cancelar manualmente
curl -X POST https://api-gpu.automear.com/jobs/orc-123/cancel \
  -H "X-API-Key: $KEY"
```

### Webhook não entregue

**Causa:** URL inválida, timeout, ou endpoint offline

**Solução:**
```bash
# Verificar DLQ
redis-cli LRANGE orchestrator:webhooks:dlq 0 -1

# Re-enviar manualmente
curl -X POST https://webhook-url.com/callback \
  -H "Content-Type: application/json" \
  -d @dlq_payload.json
```

---

## Checklist de Deploy

### Antes de implementar:

- [ ] Redis instalado e configurável (`REDIS_URL` no .env)
- [ ] Variáveis de ambiente configuradas:
  - `WEBHOOK_SECRET` para HMAC signature
  - `JOB_TIMEOUT_MS` (default: 3600000 = 60 min)
  - `WEBHOOK_RETRY_MAX` (default: 5)
- [ ] Monitoramento configurado (Prometheus + Grafana)
- [ ] Alertas configurados:
  - Workers disponíveis = 0 por > 10 min
  - Jobs na fila > 50
  - Webhook DLQ > 10 items

### Testes:

- [ ] Teste com 1 job de 10 imagens
- [ ] Teste com 1 job de 100 imagens (multi-worker)
- [ ] Teste com 4 jobs simultâneos de 100 imagens
- [ ] Teste de falha parcial (sub-job falhando)
- [ ] Teste de webhook failure + retry
- [ ] Teste de timeout (job longo)
- [ ] Teste de cancel mid-execution
- [ ] Teste de restart do orchestrador (persistência)

---

## Referências

- [Redis Lists](https://redis.io/docs/data-types/lists/)
- [Redis Hashes](https://redis.io/docs/data-types/hashes/)
- [Redis Distributed Locks](https://redis.io/docs/manual/patterns/distributed-locks/)
- [Webhook Best Practices](https://webhooks.fyi/)
- [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff)

---

**Última atualização:** 2025-01-10
**Autor:** API GPU Team
**Status:** 📝 Planejamento (Não implementado)
