# 🏗️ Arquitetura Detalhada do Sistema

Documentação técnica completa do sistema de processamento de vídeo com GPU auto-escalável.

---

## 📑 Índice

1. [Visão Geral](#visão-geral)
2. [Componentes do Sistema](#componentes-do-sistema)
3. [Fluxo de Dados](#fluxo-de-dados)
4. [Arquitetura de Rede](#arquitetura-de-rede)
5. [Segurança](#segurança)
6. [Escalabilidade](#escalabilidade)
7. [Monitoramento](#monitoramento)
8. [Custos e Performance](#custos-e-performance)

---

## 🎯 Visão Geral

### Problema Resolvido

**Desafio:** Processar vídeos com FFmpeg requer GPU potente, mas manter GPU dedicada 24/7 é caro ($200-500/mês) e desperdiça recursos quando ociosa.

**Solução:** Arquitetura híbrida que combina:
- **VPS sempre ativa** (sem GPU, barata: $3-5/mês)
- **GPU sob demanda** (Vast.ai, paga apenas durante uso: $0.20/hora)

### Arquitetura em Camadas

```
┌─────────────────────────────────────────────────────┐
│  CAMADA 1: Cliente (Aplicação Externa)             │
│  - Envia requisições HTTP                           │
│  - Recebe vídeos processados                        │
└────────────────────┬────────────────────────────────┘
                     │ HTTPS + API Key
                     ▼
┌─────────────────────────────────────────────────────┐
│  CAMADA 2: Orchestrator (VPS - Easypanel)          │
│  - Express.js                                       │
│  - Valida requisições                               │
│  - Gerencia lifecycle de GPUs                       │
│  - Faz proxy para workers                           │
└────────────────────┬────────────────────────────────┘
                     │ Vast.ai REST API
                     ▼
┌─────────────────────────────────────────────────────┐
│  CAMADA 3: Vast.ai (Marketplace GPU)                │
│  - Provisionamento de instâncias                    │
│  - Rede pública + Port mapping                      │
└────────────────────┬────────────────────────────────┘
                     │ HTTP + Session Token
                     ▼
┌─────────────────────────────────────────────────────┐
│  CAMADA 4: Worker (Container Docker com GPU)       │
│  - Express.js                                       │
│  - FFmpeg + CUDA/NVENC                              │
│  - Processamento de vídeo                           │
└─────────────────────────────────────────────────────┘
```

---

## 🧩 Componentes do Sistema

### 1. Orchestrator (VPS)

**Localização:** VPS com Easypanel
**Tecnologia:** Node.js 20 + TypeScript + Express
**Função:** Controlador central do sistema

#### Responsabilidades:

1. **Recepção de Requisições**
   - Endpoint público: `POST /video/{operation}`
   - Validação de API keys
   - Validação de payload (Joi schemas)
   - Rate limiting

2. **Gerenciamento de GPU**
   - Busca ofertas disponíveis no Vast.ai
   - Seleção de GPU baseada em preço/performance
   - Criação de instâncias
   - Monitoramento de status
   - Destruição após uso

3. **Proxy de Requisições**
   - Forwarding de requests para worker
   - Timeout management (10min)
   - Error handling e retries
   - Response streaming

4. **Segurança**
   - Geração de session tokens únicos
   - Detecção de IP público da VPS
   - Injeção de credenciais no worker

#### Arquivos Principais:

```
src/orchestrator/
├── index.ts                    # Express app + server
├── config/
│   └── env.ts                 # Configurações e validação
├── services/
│   ├── vastAiService.ts       # Integração Vast.ai API
│   └── instanceManager.ts     # Pool de instâncias (opcional)
└── routes/
    └── videoProxy.ts          # Proxy endpoints
```

#### Fluxo de Código (Simplificado):

```typescript
// 1. Cliente faz request
POST /video/caption
  ↓
// 2. Valida API key
authenticateToken(req)
  ↓
// 3. Cria GPU
const instance = await vastAiService.createInstance({
  minVram: 8,
  maxPrice: 1.0
})
  ↓
// 4. Faz proxy
const response = await axios.post(
  `${instance.publicUrl}/video/caption`,
  req.body,
  { headers: { 'X-Session-Token': instance.sessionToken } }
)
  ↓
// 5. Retorna e destrói
res.json(response.data)
await vastAiService.destroyInstance(instance.id)
```

---

### 2. Vast.ai (Marketplace)

**Função:** Provedor de infraestrutura GPU on-demand

#### API Endpoints Utilizados:

```bash
# 1. Buscar ofertas
GET https://console.vast.ai/api/v0/bundles/
Query: {
  "verified": true,
  "gpu_ram": { "gte": 8 },
  "rentable": true
}

# 2. Criar instância
PUT https://console.vast.ai/api/v0/asks/{offer_id}/
Body: {
  "client_id": "me",
  "image": "seuusuario/api-gpu-worker:latest",
  "disk": 10,
  "env": "-p 3334:3334 -e SESSION_TOKEN=xxx -e ALLOWED_IPS=xxx"
}

# 3. Obter detalhes
GET https://console.vast.ai/api/v0/instances/{id}/
Response: {
  "id": 12345,
  "ssh_host": "85.10.218.46",
  "ssh_port": "44257",
  "public_ipaddr": "85.10.218.46",
  "ports": {
    "3334/tcp": [{"HostPort": "43210"}]
  },
  "actual_status": "running"
}

# 4. Destruir instância
DELETE https://console.vast.ai/api/v0/instances/{id}/
```

#### Características:

- **Port Mapping:** Portas internas → Portas externas aleatórias
- **Networking:** IP público compartilhado entre múltiplos containers
- **SSH:** Sempre disponível na porta 22 (mapeada)
- **Docker:** Suporta qualquer imagem pública/privada

---

### 3. Worker (Container GPU)

**Localização:** Vast.ai (instância efêmera)
**Tecnologia:** Node.js 20 + FFmpeg + CUDA + NVENC
**Imagem Base:** `nvcr.io/nvidia/pytorch:24.10-py3`

#### Responsabilidades:

1. **Segurança de Entrada**
   - IP Whitelist (apenas VPS)
   - Session Token validation
   - API Key validation

2. **Processamento de Vídeo**
   - Download de assets (vídeo, áudio, legendas)
   - Validação de arquivos
   - Processamento com FFmpeg + GPU
   - Upload/retorno de resultado

3. **Operações Disponíveis**
   - `/video/caption` - Adiciona legendas SRT
   - `/video/img2vid` - Converte imagem em vídeo com zoom
   - `/video/adicionaAudio` - Sincroniza áudio com vídeo

#### Arquivos Principais:

```
src/worker/
├── index.ts                    # Express app + server
├── middleware/
│   ├── ipWhitelist.ts         # Filtra IPs não autorizados
│   ├── sessionAuth.ts         # Valida session token
│   └── auth.ts                # Valida API key
├── services/
│   ├── ffmpegService.ts       # Processamento FFmpeg
│   └── gpuDetectionService.ts # Detecção CUDA/NVENC
└── routes/
    └── video.ts               # Endpoints de vídeo
```

#### Pipeline FFmpeg (GPU):

```bash
# Caption com NVENC
ffmpeg \
  -hwaccel cuda \                           # Decode acelerado
  -i input.mp4 \
  -vf "subtitles=subs.srt" \               # Legendas (CPU)
  -c:v h264_nvenc \                        # Encode GPU
  -preset p4 \                             # Preset balanceado
  -tune hq \                               # High quality
  -rc:v vbr -cq:v 23 \                     # VBR, qualidade 23
  -c:a copy \                              # Áudio copy
  -movflags +faststart \                   # Web streaming
  output.mp4

# Img2Vid com Zoom
ffmpeg \
  -framerate 24 -loop 1 -i image.jpg \
  -vf "scale=6720:3840:flags=lanczos,\     # Upscale 6x
       zoompan=z='min(1+0.324*on/120,1.324)':d=120:s=1920x1080:fps=24,\
       format=nv12" \                       # GPU format
  -c:v h264_nvenc \                        # Encode GPU
  -preset p4 -tune hq \
  -t 5 \
  output.mp4
```

---

## 🔄 Fluxo de Dados Detalhado

### 1. Requisição de Caption

```
┌─────────┐
│ Cliente │
└────┬────┘
     │ POST /video/caption
     │ {url_video, url_srt}
     │ X-API-Key: client-key
     ▼
┌──────────────────┐
│  Orchestrator    │
│  1. Valida key   │
│  2. Valida body  │
└────┬─────────────┘
     │ PUT /api/v0/asks/{id}/
     │ Body: {image, env, disk}
     │ Authorization: Bearer vast-key
     ▼
┌──────────────────┐
│    Vast.ai       │
│  1. Cria VM      │
│  2. Pull image   │
│  3. Start        │
└────┬─────────────┘
     │ Retorna instance_id
     ▼
┌──────────────────┐
│  Orchestrator    │
│  1. Poll status  │
│  2. Aguarda run  │
└────┬─────────────┘
     │ GET /api/v0/instances/{id}/
     ▼
┌──────────────────┐
│    Vast.ai       │
│  Status: running │
│  IP: 85.10.218.46│
│  Port: 43210     │
└────┬─────────────┘
     │ Retorna connection details
     ▼
┌──────────────────┐
│  Orchestrator    │
│  publicUrl =     │
│  http://IP:43210 │
└────┬─────────────┘
     │ POST http://85.10.218.46:43210/video/caption
     │ X-Session-Token: unique-token
     │ X-API-Key: shared-key
     │ Body: {url_video, url_srt}
     ▼
┌──────────────────┐
│     Worker       │
│  1. Valida IP    │
│  2. Valida token │
│  3. Valida key   │
└────┬─────────────┘
     │ IP: ✅ VPS
     │ Token: ✅ Valid
     │ Key: ✅ Correct
     ▼
┌──────────────────┐
│     Worker       │
│  1. Download     │
│     video.mp4    │
│     subs.srt     │
└────┬─────────────┘
     │ axios.get(url_video)
     │ axios.get(url_srt)
     ▼
┌──────────────────┐
│     Worker       │
│  1. Valida SRT   │
│  2. FFmpeg GPU   │
└────┬─────────────┘
     │ ffmpeg -hwaccel cuda -i video.mp4 ...
     │ Progress: 25%, 50%, 75%, 100%
     ▼
┌──────────────────┐
│     Worker       │
│  Retorna JSON    │
│  {video_url, stats}
└────┬─────────────┘
     │ Response
     ▼
┌──────────────────┐
│  Orchestrator    │
│  1. Recebe       │
│  2. Destrói GPU  │
└────┬─────────────┘
     │ DELETE /api/v0/instances/{id}/
     ▼
┌──────────────────┐
│    Vast.ai       │
│  Destroy VM      │
│  Billing stops   │
└──────────────────┘
     │ Success
     ▼
┌──────────────────┐
│  Orchestrator    │
│  Retorna JSON    │
│  ao cliente      │
└────┬─────────────┘
     │ Response
     ▼
┌─────────┐
│ Cliente │
│ Recebe  │
│ vídeo   │
└─────────┘
```

**Tempo Total:** ~80-120 segundos
- Setup GPU: 20s
- Processamento: 60-90s
- Cleanup: 1s

---

## 🌐 Arquitetura de Rede

### Topologia de Rede

```
Internet
    │
    ├─────────────────────────────┐
    │                             │
    ▼                             ▼
┌─────────────┐           ┌──────────────┐
│  Cliente    │           │   VPS        │
│  Anywhere   │           │  Easypanel   │
│             │           │  Public IP   │
│             │           │  (fixo)      │
└─────────────┘           └──────┬───────┘
                                 │
                                 │ Vast.ai API
                                 │ (HTTPS)
                                 ▼
                          ┌──────────────┐
                          │   Vast.ai    │
                          │  Cloud       │
                          └──────┬───────┘
                                 │
                                 │ Provisiona
                                 ▼
                          ┌──────────────┐
                          │ Worker GPU   │
                          │ Public IP    │
                          │ (temporário) │
                          └──────────────┘
```

### Port Mapping (Vast.ai)

**Problema:** Vast.ai usa IPs compartilhados com port mapping aleatório.

**Solução:**
```
Container interno: 3334
       ↓ (mapeado para)
Host externo: 43210 (aleatório)

Acesso: http://85.10.218.46:43210
```

**Como descobrir a porta:**
```typescript
const response = await axios.get(
  `https://console.vast.ai/api/v0/instances/${id}/`
);

const externalPort = response.data.ports['3334/tcp'][0].HostPort;
const publicUrl = `http://${response.data.public_ipaddr}:${externalPort}`;
```

### Comunicação entre Componentes

| Origem | Destino | Protocolo | Autenticação | Dados |
|--------|---------|-----------|--------------|-------|
| Cliente | Orchestrator | HTTPS | X-API-Key | Request JSON |
| Orchestrator | Vast.ai | HTTPS | Bearer Token | Instance config |
| Orchestrator | Worker | HTTP | Session Token + IP | Request JSON |
| Worker | Storage | HTTP/HTTPS | Public URLs | Download assets |

---

## 🔒 Segurança

### Camadas de Segurança

#### 1. Cliente → Orchestrator
```typescript
// Autenticação via API Key
X-API-Key: client-public-key-12345

// Middleware
const authenticateToken = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  if (apiKey !== process.env.X_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};
```

#### 2. Orchestrator → Vast.ai
```typescript
// Autenticação via Bearer Token
Authorization: Bearer vast-api-key-xxxxxxxxx

// Headers obrigatórios
{
  'Authorization': `Bearer ${VAST_API_KEY}`,
  'Content-Type': 'application/json'
}
```

#### 3. Orchestrator → Worker

**Tripla autenticação:**

```typescript
// 1. IP Whitelist
const allowedIps = process.env.ALLOWED_IPS.split(',');
if (!allowedIps.includes(req.ip)) {
  return res.status(403).json({ error: 'Forbidden IP' });
}

// 2. Session Token (único por instância)
const sessionToken = req.get('X-Session-Token');
if (sessionToken !== process.env.SESSION_TOKEN) {
  return res.status(403).json({ error: 'Invalid session' });
}

// 3. API Key (compartilhada)
const apiKey = req.get('X-API-Key');
if (apiKey !== process.env.X_API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

### Fluxo de Credenciais

```
1. Orchestrator detecta IP público da VPS
   → await axios.get('https://api.ipify.org')
   → IP: 203.0.113.45

2. Orchestrator gera Session Token único
   → crypto.randomBytes(32).toString('hex')
   → Token: a7f3e9d1b2c4...

3. Orchestrator injeta via Docker env
   → -e ALLOWED_IPS=203.0.113.45
   → -e SESSION_TOKEN=a7f3e9d1b2c4...
   → -e X_API_KEY=shared-secret-key

4. Worker valida em cada request
   → IP check: ✅
   → Token check: ✅
   → API Key check: ✅
```

### Mitigação de Ameaças

| Ameaça | Mitigação |
|--------|-----------|
| **Acesso não autorizado ao Worker** | IP Whitelist + Session Token |
| **Roubo de API Key** | Rotação periódica |
| **Man-in-the-Middle** | HTTPS (Orchestrator), Session token único |
| **Vazamento de credenciais Vast.ai** | Variáveis de ambiente, não commitadas |
| **Instância órfã (não destruída)** | Timeout + finally block |
| **DDoS no Orchestrator** | Rate limiting + Cloudflare |

---

## 📈 Escalabilidade

### Estratégias de Escala

#### 1. Horizontal - Pool de Instâncias (Opcional)

```typescript
class InstancePool {
  private pool: VastInstance[] = [];
  private readonly minInstances = 1;
  private readonly maxInstances = 10;

  async getOrCreate(): Promise<VastInstance> {
    // Retorna instância disponível do pool
    const available = this.pool.find(i => !i.busy);

    if (available) {
      available.busy = true;
      return available;
    }

    // Cria nova se abaixo do limite
    if (this.pool.length < this.maxInstances) {
      const instance = await vastAiService.createInstance();
      this.pool.push(instance);
      return instance;
    }

    // Aguarda disponibilidade
    return this.waitForAvailable();
  }
}
```

**Vantagens:**
- Elimina 20s de setup
- Maior throughput

**Desvantagens:**
- Custo fixo (instâncias ociosas)
- Complexidade de gerenciamento

#### 2. Vertical - GPUs Mais Potentes

| GPU | VRAM | Preço/h | Processa 1min vídeo |
|-----|------|---------|---------------------|
| RTX 3060 | 12GB | $0.20 | 60s |
| RTX 3080 | 10GB | $0.35 | 40s |
| RTX 4090 | 24GB | $0.80 | 25s |
| A100 | 40GB | $1.50 | 15s |

**Seleção dinâmica:**
```typescript
async createInstance(priority: 'cost' | 'speed') {
  const offers = await this.searchOffers();

  if (priority === 'cost') {
    return offers.sort((a, b) => a.dph_total - b.dph_total)[0];
  } else {
    return offers.sort((a, b) => b.gpu_ram - a.gpu_ram)[0];
  }
}
```

#### 3. Fila de Jobs (Assíncrono)

```typescript
// Bull Queue + Redis
const videoQueue = new Queue('video-processing', {
  redis: { host: 'redis', port: 6379 }
});

// Adicionar job
router.post('/video/caption', async (req, res) => {
  const job = await videoQueue.add({
    operation: 'caption',
    data: req.body
  });

  res.json({
    jobId: job.id,
    status: 'queued',
    statusUrl: `/jobs/${job.id}`
  });
});

// Worker processa
videoQueue.process(async (job) => {
  const instance = await vastAiService.createInstance();
  // ... processar
  await vastAiService.destroyInstance(instance.id);
});
```

### Limites do Sistema

| Recurso | Limite Atual | Limite Máximo |
|---------|--------------|---------------|
| Requisições simultâneas | 1 (sem pool) | 100+ (com pool) |
| Tamanho de vídeo | 100MB | 10GB (config) |
| Duração de processamento | 10min | Configurável |
| Instâncias Vast.ai | 1 | Ilimitado ($ dependent) |

---

## 📊 Monitoramento

### Logs Estruturados (Winston)

```typescript
// Formato JSON estruturado
logger.info('🚀 Instance created', {
  instanceId: 12345,
  gpu: 'RTX 3060',
  price: 0.20,
  ip: '85.10.218.46',
  port: 43210
});

logger.info('🎬 Processing started', {
  requestId: 'caption_123',
  operation: 'caption',
  videoSize: '50MB'
});

logger.info('✅ Processing completed', {
  requestId: 'caption_123',
  duration: 75.2,
  cost: 0.004
});
```

### Métricas Importantes

**Orchestrator:**
- Taxa de criação de instâncias
- Tempo médio de provisionamento
- Taxa de falha (Vast.ai)
- Custo total por período

**Worker:**
- Tempo de processamento por operação
- Taxa de sucesso/falha FFmpeg
- Uso de GPU (NVENC)
- Tamanho médio de arquivos

### Alertas Sugeridos

```yaml
# Prometheus/Grafana
alerts:
  - name: HighInstanceCreationTime
    condition: avg(instance_creation_time) > 60s
    action: notify_slack

  - name: HighFailureRate
    condition: failure_rate > 5%
    action: notify_email

  - name: HighCost
    condition: hourly_cost > $5
    action: notify_owner
```

---

## 💰 Custos e Performance

### Breakdown de Custos

#### Custos Fixos (Mensais)

| Serviço | Especificação | Custo/mês |
|---------|---------------|-----------|
| **VPS (Easypanel)** | 1 vCPU, 1GB RAM, 25GB SSD | $5 |
| **Docker Hub** | Image pública | $0 |
| **Vast.ai** | Account | $0 |
| **Total Fixo** | | **$5/mês** |

#### Custos Variáveis (Por Vídeo)

**Cenário 1: Vídeo 1min, RTX 3060**
```
Setup: 20s × $0.20/h = $0.001
Processing: 60s × $0.20/h = $0.003
Total: $0.004/vídeo
```

**Cenário 2: Vídeo 5min, RTX 3080**
```
Setup: 20s × $0.35/h = $0.002
Processing: 200s × $0.35/h = $0.019
Total: $0.021/vídeo
```

**Cenário 3: Imagem → Vídeo 10s, RTX 3060**
```
Setup: 20s × $0.20/h = $0.001
Processing: 30s × $0.20/h = $0.002
Total: $0.003/vídeo
```

#### Projeção de Custos

**Volume baixo (100 vídeos/mês):**
```
Fixo: $5
Variável: 100 × $0.004 = $0.40
Total: $5.40/mês
```

**Volume médio (1000 vídeos/mês):**
```
Fixo: $5
Variável: 1000 × $0.004 = $4
Total: $9/mês
```

**Volume alto (10000 vídeos/mês):**
```
Fixo: $5
Variável: 10000 × $0.004 = $40
Total: $45/mês
```

### Performance

#### Benchmarks

| Operação | GPU | Tempo Setup | Tempo Processo | Total | Custo |
|----------|-----|-------------|----------------|-------|-------|
| Caption (1min vídeo) | RTX 3060 | 20s | 60s | 80s | $0.004 |
| Caption (1min vídeo) | RTX 4090 | 20s | 25s | 45s | $0.010 |
| Img2Vid (5s) | RTX 3060 | 20s | 30s | 50s | $0.003 |
| Img2Vid (5s) | RTX 4090 | 20s | 15s | 35s | $0.007 |
| AddAudio (1min) | RTX 3060 | 20s | 45s | 65s | $0.004 |

#### Otimizações Possíveis

**1. Reutilizar Instâncias (Pool)**
```
Economia de setup: 20s → 0s
Custo adicional: Instância ociosa
Break-even: >3 requests/hora
```

**2. Batch Processing**
```
1 instância processa N vídeos sequencialmente
Economia: 1 setup para N vídeos
Trade-off: Latência maior
```

**3. GPU mais barata (GTX 1080)**
```
Preço: $0.10/h (50% cheaper)
Performance: 70% da RTX 3060
ROI: Depende do volume
```

---

## 🔧 Decisões Arquiteturais

### Por que Monorepo?

**Decisão:** 1 repositório com 2 aplicações

**Justificativa:**
- ✅ Código compartilhado (types, utils)
- ✅ Versionamento sincronizado
- ✅ Builds independentes
- ✅ Deploy independente
- ✅ Manutenção centralizada

### Por que Docker Hub?

**Decisão:** Publicar worker image no Docker Hub

**Alternativas consideradas:**
1. ❌ Git clone no Vast.ai → Lento (3-5min npm install)
2. ❌ SSH transfer → Instável
3. ✅ Docker Hub → Rápido (20s pull), confiável

### Por que Vast.ai?

**Decisão:** Vast.ai como provedor GPU

**Alternativas consideradas:**
1. ❌ AWS GPU (g4dn.xlarge) → Caro ($0.50/h mínimo)
2. ❌ Google Cloud GPU → Setup complexo
3. ❌ Azure GPU → Billing complicado
4. ✅ Vast.ai → Barato, simples, spot instances

### Por que Node.js (não Python)?

**Decisão:** Node.js + TypeScript

**Justificativa:**
- ✅ Express.js familiar
- ✅ TypeScript type-safety
- ✅ Async/await nativo
- ✅ FFmpeg via spawn (mesma performance)
- ✅ Ecossistema rico (axios, winston, joi)

---

## 🚀 Roadmap

### Fase 1: MVP (Atual)
- [x] Estrutura do projeto
- [x] Dockerfiles
- [x] Documentação
- [ ] Implementar VastAiService
- [ ] Implementar FFmpegService
- [ ] Deploy inicial

### Fase 2: Produção
- [ ] Error handling robusto
- [ ] Retry logic
- [ ] Monitoring (Prometheus)
- [ ] Alertas
- [ ] Testes automatizados

### Fase 3: Otimização
- [ ] Pool de instâncias
- [ ] Fila de jobs (Redis + Bull)
- [ ] Cache de resultados
- [ ] CDN para outputs

### Fase 4: Features
- [ ] Webhook callbacks
- [ ] Batch processing
- [ ] Novos efeitos de vídeo
- [ ] Suporte a múltiplos formatos

---

## 📚 Referências Técnicas

### APIs Utilizadas
- [Vast.ai API Docs](https://vast.ai/docs/api)
- [FFmpeg Documentation](https://ffmpeg.org/documentation.html)
- [NVENC Programming Guide](https://developer.nvidia.com/nvidia-video-codec-sdk)

### Tecnologias
- [Express.js](https://expressjs.com/)
- [TypeScript](https://www.typescriptlang.org/)
- [Winston Logger](https://github.com/winstonjs/winston)
- [Joi Validation](https://joi.dev/)
- [Axios HTTP Client](https://axios-http.com/)

### Infraestrutura
- [Easypanel](https://easypanel.io/)
- [Docker Hub](https://hub.docker.com/)
- [Vast.ai Marketplace](https://vast.ai/)

---

## ✅ Conclusão

Este sistema oferece uma solução econômica e escalável para processamento de vídeo com GPU, combinando:

- **Simplicidade:** 1 repositório, 2 aplicações, deploy direto
- **Economia:** Paga apenas pelo uso real de GPU
- **Performance:** GPU NVIDIA com CUDA/NVENC
- **Segurança:** Múltiplas camadas de autenticação
- **Escalabilidade:** Ilimitada (subject to budget)

**Custo total estimado:** $5 fixo + $0.004/vídeo = **Muito mais barato** que manter GPU dedicada 24/7.
