# 🚀 Deploy v2.5.0 - Multi-Zoom Support

## 📋 O que mudou?

**Versão:** v2.5.0
**Feature:** Suporte a 4 tipos de zoom com distribuição proporcional aleatória

### Novos Zoom Types:
1. **`zoomin`** - Zoom in centralizado (1.0 → 1.324)
2. **`zoomout`** - Zoom out centralizado (1.324 → 1.0)
3. **`zoompanright`** - Zoom in + pan da esquerda para direita
4. **`zoompanleft`** - Zoom in + pan da direita para esquerda

### Novo Parâmetro API:
```json
{
  "images": [...],
  "path": "project/videos/temp/",
  "zoom_types": ["zoomin", "zoomout", "zoompanright", "zoompanleft"]  // ← NOVO
}
```

## 🔧 Como funciona a distribuição?

Se você enviar `zoom_types: ["zoomin", "zoomout"]` com 10 imagens:
- 5 imagens receberão `zoomin`
- 5 imagens receberão `zoomout`
- A ordem é **aleatória** mas a **proporção é mantida**

Se você enviar `zoom_types: ["zoomin", "zoomout", "zoompanright"]` com 10 imagens:
- ~3-4 imagens de cada tipo
- Distribuição automática e proporcional
- Ordem aleatória (sem viés)

## 📦 Deploy - Passo a Passo

### ⚠️ IMPORTANTE: Docker Desktop precisa estar rodando!

### Opção 1: Script Automatizado (PowerShell - Windows)

```powershell
# 1. Certifique-se que Docker Desktop está rodando
# 2. Execute o script de deploy
.\deploy-runpod.ps1
```

### Opção 2: Script Automatizado (Bash - Linux/Mac)

```bash
# 1. Certifique-se que Docker está rodando
# 2. Torne o script executável
chmod +x deploy-runpod.sh

# 3. Execute
./deploy-runpod.sh
```

### Opção 3: Manual (Passo a Passo)

#### 1️⃣ Build da Imagem Docker

```bash
# Build com tag de versão
docker build -f docker/worker-python.Dockerfile \
  -t oreiasccp/api-gpu-worker:v2.5.0 \
  -t oreiasccp/api-gpu-worker:latest \
  .
```

#### 2️⃣ Push para Docker Hub

```bash
# Login no Docker Hub (se necessário)
docker login

# Push das imagens
docker push oreiasccp/api-gpu-worker:v2.5.0
docker push oreiasccp/api-gpu-worker:latest
```

#### 3️⃣ Criar Template RunPod

```bash
# RUNPOD_API_KEY está no arquivo .env
RUNPOD_API_KEY=$(grep RUNPOD_API_KEY .env | cut -d '=' -f2)

curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation { saveTemplate(input: {
      name: \"api-gpu-worker-v2.5\",
      imageName: \"oreiasccp/api-gpu-worker:v2.5.0\",
      dockerArgs: \"python -u rp_handler.py\",
      containerDiskInGb: 10,
      volumeInGb: 0,
      isServerless: true,
      env: [
        {key: \"WORK_DIR\", value: \"/tmp/work\"},
        {key: \"OUTPUT_DIR\", value: \"/tmp/output\"},
        {key: \"BATCH_SIZE\", value: \"3\"}
      ]
    }) { id name imageName } }"
  }'
```

**Anote o `id` retornado** (será o `TEMPLATE_ID`)

#### 4️⃣ Criar Endpoint RunPod

```bash
# Substitua TEMPLATE_ID pelo ID obtido acima
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation { saveEndpoint(input: {
      name: \"api-gpu-worker\",
      templateId: \"TEMPLATE_ID\",
      workersMin: 0,
      workersMax: 3,
      gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\",
      scalerType: \"QUEUE_DELAY\",
      scalerValue: 3,
      networkVolumeId: \"\"
    }) { id name templateId } }"
  }'
```

**Anote o `id` retornado** (será o `ENDPOINT_ID`)

#### 5️⃣ Atualizar .env

Edite o arquivo `.env` e atualize:

```bash
RUNPOD_ENDPOINT_ID=<ENDPOINT_ID>
```

#### 6️⃣ Reiniciar Orchestrator

Se estiver rodando localmente:
```bash
npm run start:orchestrator
```

Se estiver no Docker/Easypanel, apenas reinicie o container.

## ✅ Testes

### Teste 1: Zoom único (padrão)
```bash
curl -X POST http://localhost:3000/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: coringao" \
  -d '{
    "images": [
      {"id": "img-1", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-2", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0}
    ],
    "path": "test/zoom/",
    "zoom_types": ["zoomin"]
  }'
```

### Teste 2: Múltiplos zooms
```bash
curl -X POST http://localhost:3000/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: coringao" \
  -d '{
    "images": [
      {"id": "img-1", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-2", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-3", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-4", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0}
    ],
    "path": "test/zoom/",
    "zoom_types": ["zoomin", "zoomout", "zoompanright", "zoompanleft"]
  }'
```

### Teste 3: Distribuição proporcional
```bash
curl -X POST http://localhost:3000/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: coringao" \
  -d '{
    "images": [
      {"id": "img-1", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-2", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-3", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-4", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-5", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0},
      {"id": "img-6", "image_url": "https://picsum.photos/1920/1080", "duracao": 3.0}
    ],
    "path": "test/zoom/",
    "zoom_types": ["zoomin", "zoomout"]
  }'
```

**Resultado esperado:** 3 vídeos com zoomin, 3 vídeos com zoomout, em ordem aleatória.

## 🐛 Troubleshooting

### Docker build falha
```bash
# Certifique-se que Docker Desktop está rodando
# Windows: Abra o Docker Desktop
# Linux/Mac: sudo systemctl start docker
```

### RunPod API retorna erro
```bash
# Verifique se a API key está correta
# Verifique se o endpoint antigo foi deletado
RUNPOD_API_KEY=$(grep RUNPOD_API_KEY .env | cut -d '=' -f2)

curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{"query":"{ myself { endpoints { id name } } }"}'
```

### Orchestrator não usa novo endpoint
```bash
# Verifique se o .env foi atualizado
cat .env | grep RUNPOD_ENDPOINT_ID

# Reinicie o orchestrator
npm run start:orchestrator
```

## 📊 Validação

Após o deploy, verifique nos logs do worker:

```
📊 Zoom distribution: {'zoomin': 2, 'zoomout': 2, 'zoompanright': 1, 'zoompanleft': 1} for 6 images
🎬 Zoom types: ['zoomin', 'zoomout', 'zoompanright', 'zoompanleft'] → distributed across 6 images
```

## 🔄 Rollback (se necessário)

Se algo der errado, você pode voltar para v2.4.0:

```bash
# Obter API key do .env
RUNPOD_API_KEY=$(grep RUNPOD_API_KEY .env | cut -d '=' -f2)

# 1. Deletar endpoint v2.5
curl -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{"query":"mutation { deleteEndpoint(id: \"<ENDPOINT_ID>\") }"}'

# 2. Recriar com template v2.4
curl -X POST "https://api.runpod.io/graphql" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation { saveEndpoint(input: {
      name: \"api-gpu-worker\",
      templateId: \"ye3okojut6\",
      workersMin: 0,
      workersMax: 3,
      gpuIds: \"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\",
      scalerType: \"QUEUE_DELAY\",
      scalerValue: 3
    }) { id } }"
  }'

# 3. Atualizar .env com novo ENDPOINT_ID
```

## 📚 Referências

- **Commit:** `b98d297` - feat: add multi-zoom support with proportional distribution (v2.5.0)
- **Docker Hub:** https://hub.docker.com/r/oreiasccp/api-gpu-worker
- **RunPod Docs:** https://docs.runpod.io/

## 🎯 Próximos Passos

1. ✅ Deploy v2.5.0
2. ⏳ Testar com imagens reais
3. ⏳ Monitorar performance e custos RunPod
4. ⏳ Ajustar `workersMax` conforme demanda
