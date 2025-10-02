# ⏱️ Implementação: Idle Timeout de 5 Minutos

Guia técnico para implementar o requisito: "Manter instância ativa por 5 minutos após job concluído. Destruir se não receber requests."

---

## 📋 Requisito

> A instância GPU, ao ser montada e estiver funcionando, após finalizar um job deve manter ativa durante 5 minutos. Se não receber nenhum request de vídeo da VPS durante 5 minutos, destruir a instância alugada.

---

## 🎯 Solução 1: RunPod Serverless (RECOMENDADO)

### Configuração Nativa

RunPod Serverless possui **idle timeout built-in**, eliminando necessidade de código custom.

#### Configuração via UI

```yaml
# Endpoint Settings
Scaling Type: Request Count
Workers:
  Min Workers: 0          # Escala para zero quando idle
  Max Workers: 10         # Limite de workers simultâneos

Advanced Settings:
  Idle Timeout: 300       # 5 minutos em segundos
  GPU IDs: "NVIDIA GeForce RTX 3060"
  Container Disk: 10GB
  Volume Disk: 0GB
```

#### Configuração via API

```typescript
// orchestrator/config/runpod.config.ts
export const runpodEndpointConfig = {
  name: "video-processing-gpu",
  template: {
    imageName: "seuusuario/api-gpu-worker:latest",
    dockerArgs: "",
    containerDiskInGb: 10,
    volumeInGb: 0,
    env: [
      { key: "GPU_API_KEY", value: process.env.GPU_API_KEY }
    ]
  },
  gpuIds: "NVIDIA GeForce RTX 3060,NVIDIA GeForce RTX 3060 Ti",
  scalerType: "REQUEST_COUNT",
  scalerValue: 1,
  workersMin: 0,           // ✅ Escala para zero
  workersMax: 10,
  idleTimeout: 300,        // ✅ 5 minutos
  gpuCount: 1
};
```

#### Fluxo Automático

```
1. Request chega
   └─> RunPod cria worker (<1s cold start)
   └─> Worker processa vídeo (60s)
   └─> Worker retorna resultado
   └─> Worker entra em estado IDLE ⏰

2. Idle Timer começa (300s)
   └─> 0-300s: Worker aguardando novo request
   └─> Novo request chega? → Reseta timer, processa
   └─> Timer expira (300s)? → Worker destruído automaticamente ✅

3. Billing
   └─> Processando: $0.18/h (cobrado por segundo)
   └─> Idle: $0.18/h (cobrado por segundo)
   └─> Destruído: $0.00/h ✅
```

#### Código do Orchestrator (Simplificado)

```typescript
// orchestrator/services/runpodService.ts
import axios from 'axios';

export class RunPodService {
  private readonly endpointId: string;
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.runpod.io/v2';

  constructor() {
    this.endpointId = process.env.RUNPOD_ENDPOINT_ID!;
    this.apiKey = process.env.RUNPOD_API_KEY!;
  }

  /**
   * Processa vídeo usando RunPod Serverless
   * RunPod gerencia lifecycle automaticamente (criação, idle, destruição)
   */
  async processVideo(operation: string, data: any) {
    // 1. Submete job (RunPod cria worker se necessário)
    const job = await this.submitJob(operation, data);

    // 2. Aguarda conclusão
    const result = await this.pollJobStatus(job.id);

    // 3. RunPod gerencia idle timeout automaticamente
    // Não precisa destruir manualmente! ✅

    return result;
  }

  private async submitJob(operation: string, data: any) {
    const response = await axios.post(
      `${this.baseUrl}/${this.endpointId}/run`,
      {
        input: {
          operation,
          ...data
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data;
  }

  private async pollJobStatus(jobId: string, maxAttempts = 180) {
    for (let i = 0; i < maxAttempts; i++) {
      const response = await axios.get(
        `${this.baseUrl}/${this.endpointId}/status/${jobId}`,
        {
          headers: { 'Authorization': `Bearer ${this.apiKey}` }
        }
      );

      const { status, output, error } = response.data;

      if (status === 'COMPLETED') {
        return output;
      }

      if (status === 'FAILED') {
        throw new Error(`Job failed: ${error}`);
      }

      // Poll a cada 2s
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Job timeout after 6 minutes');
  }
}
```

**Vantagens:**
- ✅ **Zero código de gerenciamento**: RunPod faz tudo
- ✅ **Confiável**: Testado em produção
- ✅ **Escalável**: Auto-scaling até max workers
- ✅ **Econômico**: Workers destruídos automaticamente

**Desvantagens:**
- ⚠️ **Custo idle**: Paga pelos 5 minutos idle ($0.015/job)
- ⚠️ **Menos controle**: Não pode customizar lógica

---

## 🔧 Solução 2: Vast.ai com Pool Manager (CUSTOM)

### Implementação Manual

Vast.ai não tem idle timeout nativo. Precisa implementar manualmente.

#### Arquitetura

```
┌─────────────────────────────────────┐
│  Orchestrator                       │
│  ┌───────────────────────────────┐  │
│  │  InstancePoolManager          │  │
│  │  - Map<id, InstanceInfo>      │  │
│  │  - lastRequestTime tracking   │  │
│  │  - Interval monitor (30s)     │  │
│  └───────────────────────────────┘  │
│  ┌───────────────────────────────┐  │
│  │  VastAiService                │  │
│  │  - createInstance()           │  │
│  │  - destroyInstance()          │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
```

#### Código Completo

```typescript
// orchestrator/services/instancePoolManager.ts
import { VastAiService } from './vastAiService';
import { logger } from '../../shared/utils/logger';

interface InstanceInfo {
  id: number;
  publicUrl: string;
  sessionToken: string;
  status: 'busy' | 'idle';
  lastRequestTime: Date;
  createdAt: Date;
}

export class InstancePoolManager {
  private pool = new Map<number, InstanceInfo>();
  private vastService: VastAiService;
  private readonly IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos
  private readonly CHECK_INTERVAL_MS = 30 * 1000;    // 30 segundos
  private monitorInterval?: NodeJS.Timeout;

  constructor(vastService: VastAiService) {
    this.vastService = vastService;
    this.startIdleMonitor();
  }

  /**
   * Obtém instância disponível do pool ou cria nova
   */
  async getOrCreateInstance(): Promise<InstanceInfo> {
    // 1. Buscar instância idle no pool
    const idleInstance = this.findIdleInstance();

    if (idleInstance) {
      logger.info('♻️ Reusing idle instance', { instanceId: idleInstance.id });
      idleInstance.status = 'busy';
      idleInstance.lastRequestTime = new Date();
      return idleInstance;
    }

    // 2. Criar nova instância
    logger.info('🚀 Creating new Vast.ai instance');
    const newInstance = await this.vastService.createInstance();

    const instanceInfo: InstanceInfo = {
      id: newInstance.id,
      publicUrl: newInstance.publicUrl,
      sessionToken: newInstance.sessionToken,
      status: 'busy',
      lastRequestTime: new Date(),
      createdAt: new Date()
    };

    this.pool.set(newInstance.id, instanceInfo);

    logger.info('✅ Instance added to pool', {
      instanceId: newInstance.id,
      poolSize: this.pool.size
    });

    return instanceInfo;
  }

  /**
   * Marca instância como idle após job concluído
   */
  markAsIdle(instanceId: number): void {
    const instance = this.pool.get(instanceId);

    if (instance) {
      instance.status = 'idle';
      instance.lastRequestTime = new Date();

      logger.info('⏸️ Instance marked as idle', {
        instanceId,
        idleTimeoutMin: 5
      });
    }
  }

  /**
   * Monitor contínuo para destruir instâncias idle
   */
  private startIdleMonitor(): void {
    logger.info('🔍 Starting idle instance monitor', {
      checkIntervalSec: this.CHECK_INTERVAL_MS / 1000,
      idleTimeoutMin: this.IDLE_TIMEOUT_MS / 60000
    });

    this.monitorInterval = setInterval(async () => {
      await this.checkAndDestroyIdleInstances();
    }, this.CHECK_INTERVAL_MS);
  }

  private async checkAndDestroyIdleInstances(): Promise<void> {
    const now = Date.now();

    for (const [instanceId, info] of this.pool.entries()) {
      // Só verifica instâncias idle
      if (info.status !== 'idle') continue;

      const idleMs = now - info.lastRequestTime.getTime();

      // Destruir se idle por mais de 5 minutos
      if (idleMs >= this.IDLE_TIMEOUT_MS) {
        logger.info('⏱️ Instance exceeded idle timeout, destroying', {
          instanceId,
          idleMinutes: (idleMs / 60000).toFixed(2)
        });

        try {
          await this.vastService.destroyInstance(instanceId);
          this.pool.delete(instanceId);

          logger.info('✅ Instance destroyed successfully', {
            instanceId,
            poolSize: this.pool.size
          });
        } catch (error) {
          logger.error('❌ Failed to destroy instance', {
            instanceId,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      } else {
        const remainingMs = this.IDLE_TIMEOUT_MS - idleMs;
        logger.debug('⏳ Instance still within idle timeout', {
          instanceId,
          remainingSeconds: Math.floor(remainingMs / 1000)
        });
      }
    }
  }

  private findIdleInstance(): InstanceInfo | undefined {
    for (const instance of this.pool.values()) {
      if (instance.status === 'idle') {
        return instance;
      }
    }
    return undefined;
  }

  /**
   * Cleanup ao encerrar aplicação
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down pool manager');

    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
    }

    // Destruir todas as instâncias
    for (const [instanceId] of this.pool) {
      try {
        await this.vastService.destroyInstance(instanceId);
        logger.info('✅ Instance destroyed on shutdown', { instanceId });
      } catch (error) {
        logger.error('❌ Failed to destroy instance on shutdown', {
          instanceId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    this.pool.clear();
  }

  /**
   * Estatísticas do pool
   */
  getPoolStats() {
    const stats = {
      total: this.pool.size,
      busy: 0,
      idle: 0,
      instances: [] as any[]
    };

    for (const [id, info] of this.pool) {
      if (info.status === 'busy') stats.busy++;
      if (info.status === 'idle') stats.idle++;

      stats.instances.push({
        id,
        status: info.status,
        idleMinutes: ((Date.now() - info.lastRequestTime.getTime()) / 60000).toFixed(2),
        ageMinutes: ((Date.now() - info.createdAt.getTime()) / 60000).toFixed(2)
      });
    }

    return stats;
  }
}
```

#### Integração com Orchestrator

```typescript
// orchestrator/routes/videoProxy.ts
import { InstancePoolManager } from '../services/instancePoolManager';
import { VastAiService } from '../services/vastAiService';

const vastService = new VastAiService();
const poolManager = new InstancePoolManager(vastService);

// Health check com stats do pool
router.get('/pool/stats', (req, res) => {
  const stats = poolManager.getPoolStats();
  res.json(stats);
});

// Processar vídeo com pool
router.post('/video/caption', authenticateToken, async (req, res) => {
  let instanceId: number | undefined;

  try {
    // 1. Obter ou criar instância
    const instance = await poolManager.getOrCreateInstance();
    instanceId = instance.id;

    // 2. Processar vídeo
    const result = await axios.post(
      `${instance.publicUrl}/video/caption`,
      req.body,
      {
        headers: {
          'X-Session-Token': instance.sessionToken,
          'X-API-Key': process.env.GPU_API_KEY
        },
        timeout: 600000 // 10min
      }
    );

    // 3. Marcar como idle (NÃO destruir)
    poolManager.markAsIdle(instanceId);

    // 4. Retornar resultado
    res.json(result.data);

  } catch (error) {
    logger.error('❌ Video processing failed', { error });

    // Se falhou, ainda marca como idle para reuso
    if (instanceId) {
      poolManager.markAsIdle(instanceId);
    }

    res.status(500).json({ error: 'Processing failed' });
  }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully');
  await poolManager.shutdown();
  process.exit(0);
});
```

**Vantagens:**
- ✅ **Controle total**: Customiza lógica à vontade
- ✅ **Reutilização**: Evita setup de 20-60s em requests subsequentes
- ✅ **Monitoramento**: Logs detalhados de lifecycle

**Desvantagens:**
- ❌ **Código complexo**: ~200 linhas de gerenciamento
- ❌ **Bugs potenciais**: Orphan instances, race conditions
- ❌ **Estado compartilhado**: Precisa Redis se múltiplos orchestrators
- ❌ **Manutenção**: Testes, debugging, ajustes

---

## 🔄 Solução 3: Hybrid (RunPod + Vast.ai)

Melhor dos dois mundos: RunPod como primary, Vast.ai como fallback.

```typescript
// orchestrator/services/hybridGPUService.ts
export class HybridGPUService {
  private runpodService: RunPodService;
  private vastPoolManager: InstancePoolManager;

  async processVideo(operation: string, data: any) {
    try {
      // 1. Tentar RunPod (rápido, auto-managed)
      logger.info('🎯 Attempting RunPod processing');
      return await this.runpodService.processVideo(operation, data);

    } catch (error) {
      logger.warn('⚠️ RunPod failed, falling back to Vast.ai', { error });

      // 2. Fallback para Vast.ai
      const instance = await this.vastPoolManager.getOrCreateInstance();

      try {
        const result = await this.processOnVast(instance, operation, data);
        this.vastPoolManager.markAsIdle(instance.id);
        return result;
      } catch (vastError) {
        this.vastPoolManager.markAsIdle(instance.id);
        throw vastError;
      }
    }
  }

  private async processOnVast(instance: any, operation: string, data: any) {
    // Implementação Vast.ai
  }
}
```

---

## 📊 Comparação de Implementações

| Critério | RunPod Serverless | Vast.ai Pool Manager | Hybrid |
|----------|-------------------|----------------------|--------|
| **Linhas de código** | 50 | 250+ | 300+ |
| **Complexidade** | Baixa | Alta | Média-Alta |
| **Idle timeout** | Nativo ✅ | Manual ⚠️ | Nativo (primary) ✅ |
| **Startup time** | <1s | 20-60s (primeira), 0s (reuso) | <1s (primary) |
| **Custo com idle** | $0.018/job | $0.020/job | $0.018/job |
| **Risco de bugs** | Muito baixo | Alto | Médio |
| **Escalabilidade** | Auto (0-10 workers) | Manual | Auto |
| **Manutenção** | Zero | Alta | Média |

---

## ✅ Recomendação Final

### Para este projeto: **RunPod Serverless** ✅

**Razões:**
1. Requisito de idle timeout é **nativo** (zero código)
2. Startup <1s vs 20-60s (24% mais rápido)
3. Auto-scaling automático
4. 10% mais barato com idle ($0.018 vs $0.020)
5. Menos código = menos bugs
6. Produção-ready

### Implementar Vast.ai apenas se:

- ❌ Budget extremamente restrito (economiza $0.002/vídeo sem idle)
- ❌ Equipe experiente para manter código complexo
- ❌ Requisitos custom de gerenciamento

---

## 🚀 Próximos Passos

1. Criar endpoint RunPod Serverless
2. Configurar idle timeout = 300s
3. Implementar RunPodService no orchestrator
4. Testar fluxo completo
5. Monitorar custos e performance
6. (Opcional) Adicionar Vast.ai como fallback

**Tempo estimado:** 2-3 dias vs 1-2 semanas (Vast.ai com pool)
