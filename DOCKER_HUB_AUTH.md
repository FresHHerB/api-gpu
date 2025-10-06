# Docker Hub Authentication - RunPod

## Problema Resolvido

**Erro original:**
```
toomanyrequests: You have reached your unauthenticated pull rate limit
```

## Solução Implementada

Autenticação do Docker Hub no RunPod para evitar rate limits em pulls não autenticados.

---

## Credenciais Configuradas

**Container Registry Auth ID:** `cmgfkp6470001jp02alnym0f6`

**Detalhes:**
- **Nome:** docker-hub-oreiasccp
- **Username:** oreiasccp
- **Registry:** Docker Hub (docker.io)
- **Acesso:** Read (pull de imagens)

---

## Rate Limits do Docker Hub

| Tipo de Conta | Limite de Pull |
|---------------|----------------|
| Não autenticado | 100 pulls / 6h |
| Docker Free (autenticado) | 200 pulls / 6h |
| Docker Pro/Team/Business | Ilimitado |

Com a autenticação implementada, passamos de **100 para 200 pulls por 6 horas**.

---

## Templates Atualizados

Todos os scripts de criação de templates agora incluem `containerRegistryAuthId`:

### Scripts Modificados:
- `scripts/create-runpod-template.sh`
- `scripts/update-runpod-template.sh`

### Template Atual em Produção:
```
ID: qnqp04htdl
Nome: api-gpu-worker-v3-auth
Imagem: oreiasccp/api-gpu-worker:latest
Registry Auth: cmgfkp6470001jp02alnym0f6
```

### Endpoint em Produção:
```
ID: voutax3ai6xpn0
Nome: api-gpu-worker
Template: qnqp04htdl (api-gpu-worker-v3-auth)
```

---

## Como Criar Novos Templates com Autenticação

### Via Script:
```bash
cd scripts
export RUNPOD_API_KEY="your_runpod_api_key"
./create-runpod-template.sh
```

### Via API Direta:
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation {
      saveTemplate(input: {
        name: \"seu-template\",
        imageName: \"oreiasccp/api-gpu-worker:latest\",
        containerRegistryAuthId: \"cmgfkp6470001jp02alnym0f6\",
        dockerArgs: \"python -u rp_handler.py\",
        containerDiskInGb: 10,
        volumeInGb: 0,
        isServerless: true,
        env: [
          {key: \"WORK_DIR\", value: \"/tmp/work\"},
          {key: \"OUTPUT_DIR\", value: \"/tmp/output\"},
          {key: \"BATCH_SIZE\", value: \"3\"}
        ]
      }) {
        id name containerRegistryAuthId
      }
    }"
  }'
```

---

## Como Atualizar/Renovar Credenciais

Se precisar atualizar o token do Docker Hub:

1. **Gerar novo token no Docker Hub:**
   - Acesse: https://hub.docker.com/settings/security
   - Clique em "New Access Token"
   - Permissão: Read-only
   - Copie o token

2. **Criar nova Registry Auth no RunPod:**
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{
    "query": "mutation {
      saveRegistryAuth(input: {
        name: \"docker-hub-oreiasccp-new\",
        username: \"oreiasccp\",
        password: \"SEU_NOVO_TOKEN\"
      }) {
        id name
      }
    }"
  }'
```

3. **Atualizar REGISTRY_AUTH_ID nos scripts:**
   - Editar `scripts/create-runpod-template.sh`
   - Editar `scripts/update-runpod-template.sh`
   - Substituir o ID antigo pelo novo

---

## Verificação do Status

### Verificar templates existentes:
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{"query":"{ myself { podTemplates { id name imageName containerRegistryAuthId } } }"}'
```

### Verificar endpoint:
```bash
curl -X POST "https://api.runpod.io/graphql" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
  -d '{"query":"{ myself { endpoints { id name templateId } } }"}'
```

### Health check:
```bash
curl "https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/health" \
  -H "Authorization: Bearer ${RUNPOD_API_KEY}"
```

---

## Troubleshooting

### Erro: "failed to pull image: toomanyrequests"

**Causas possíveis:**
1. Template não tem `containerRegistryAuthId` configurado
2. Credenciais do Docker Hub expiraram
3. Rate limit ainda atingido mesmo com autenticação

**Solução:**
1. Verificar se o template tem `containerRegistryAuthId`
2. Gerar novo token no Docker Hub
3. Atualizar credenciais no RunPod
4. Recriar template com novo `containerRegistryAuthId`

### Erro: "authentication required"

**Causa:** Credenciais inválidas ou expiradas

**Solução:**
1. Gerar novo Access Token no Docker Hub
2. Verificar se não há espaços em branco ao colar o token
3. Recriar Registry Auth no RunPod

---

## Notas de Segurança

⚠️ **IMPORTANTE:**
- Não compartilhe o `RUNPOD_API_KEY` publicamente
- Use Access Tokens do Docker Hub com permissões mínimas (Read-only)
- Nunca commite senhas no Git (use .env)
- Rotate os tokens periodicamente

---

## Data de Implementação

**Implementado em:** 06/10/2025
**Status:** ✅ Ativo e funcionando
**Última verificação:** 06/10/2025 17:30
