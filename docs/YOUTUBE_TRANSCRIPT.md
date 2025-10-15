# YouTube Transcript Extraction Endpoint

## Descrição

Endpoint que extrai legendas automáticas (auto-generated captions) de vídeos do YouTube usando Playwright para web scraping. Retorna o resultado imediatamente (não usa webhook).

## Características

- ✅ Extração de legendas **automáticas** geradas pelo YouTube
- ✅ Suporta vídeos em **qualquer idioma** (idioma original do vídeo)
- ✅ **Cache Redis** para melhorar performance (24h TTL)
- ✅ **Browser Pool** para processamento concorrente
- ✅ Retorno **imediato** (não requer webhook)
- ✅ Validação de URL do YouTube
- ⚠️ **Não** extrai legendas manuais/closed captions customizadas

---

## Endpoint

```
POST /vps/video/transcribe_youtube
```

### Headers

```
X-API-Key: <sua-chave-api>
Content-Type: application/json
```

### Request Body

```json
{
  "url": "https://www.youtube.com/watch?v=VIDEO_ID"
}
```

### Formatos de URL Aceitos

```
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://youtube.com/watch?v=dQw4w9WgXcQ
https://youtu.be/dQw4w9WgXcQ
```

---

## Response

### Sucesso (200 OK)

```json
{
  "ok": true,
  "source": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  "segments_count": 60,
  "transcript_text": "Never gonna give you up Never gonna let you down...",
  "raw_segments": [
    "Never gonna give you up",
    "Never gonna let you down",
    "Never gonna run around and desert you"
  ],
  "cached": false,
  "execution_time_ms": 4523
}
```

### Erro - Transcrição Não Disponível (400 Bad Request)

```json
{
  "ok": false,
  "source": "https://www.youtube.com/watch?v=VIDEO_ID",
  "error": "Auto-generated transcript not available for this video",
  "execution_time_ms": 3210
}
```

### Erro - URL Inválida (400 Bad Request)

```json
{
  "ok": false,
  "source": "https://invalid-url.com",
  "error": "Invalid YouTube URL. Must be youtube.com/watch?v=... or youtu.be/..."
}
```

### Erro - Servidor (500 Internal Server Error)

```json
{
  "ok": false,
  "source": "https://www.youtube.com/watch?v=VIDEO_ID",
  "error": "Internal server error",
  "message": "Browser pool not initialized"
}
```

---

## Exemplos de Uso

### cURL

```bash
curl -X POST http://localhost:3000/vps/video/transcribe_youtube \
  -H "X-API-Key: sua-chave-api" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  }'
```

### JavaScript (fetch)

```javascript
const response = await fetch('http://localhost:3000/vps/video/transcribe_youtube', {
  method: 'POST',
  headers: {
    'X-API-Key': 'sua-chave-api',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  })
});

const result = await response.json();

if (result.ok) {
  console.log('Transcript:', result.transcript_text);
  console.log('Segments:', result.segments_count);
} else {
  console.error('Error:', result.error);
}
```

### Python (requests)

```python
import requests

response = requests.post(
    'http://localhost:3000/vps/video/transcribe_youtube',
    headers={
        'X-API-Key': 'sua-chave-api',
        'Content-Type': 'application/json'
    },
    json={
        'url': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    }
)

result = response.json()

if result['ok']:
    print(f"Transcript: {result['transcript_text']}")
    print(f"Segments: {result['segments_count']}")
else:
    print(f"Error: {result['error']}")
```

---

## Configuração

### Variáveis de Ambiente (`.env`)

```bash
# Browser Pool Configuration
BROWSER_POOL_SIZE=3                # Número de browsers no pool
MAX_CONTEXTS_PER_BROWSER=5         # Máximo de contextos por browser

# Redis Cache (opcional - melhora performance)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                    # Opcional
REDIS_DB=0
```

### Instalação do Playwright

Após instalar as dependências com `npm install`, você precisa instalar os browsers do Playwright:

```bash
# Instalar apenas Chromium (usado pelo serviço)
npx playwright install chromium

# Ou instalar todos os browsers
npx playwright install
```

---

## Performance

### Primeira Requisição (sem cache)
- ⏱️ **Tempo médio**: 3-6 segundos
- Inclui: navegação, carregamento da página, expansão da transcrição, extração

### Requisições Subsequentes (com cache)
- ⏱️ **Tempo médio**: 10-50ms
- Cache TTL: 24 horas
- Cache por URL de vídeo

### Capacidade

Com configuração padrão (3 browsers × 5 contexts):
- **Processamento simultâneo**: até 15 requisições
- **Throughput estimado**: ~100-200 requests/hora

---

## Limitações

### ⚠️ Legendas Automáticas Apenas

Este endpoint extrai **APENAS legendas automáticas** geradas pelo YouTube. Ele **NÃO** extrai:
- Legendas manuais (closed captions) adicionadas pelo uploader
- Legendas traduzidas manualmente
- Legendas de terceiros

### Vídeos Suportados

✅ **Funciona com**:
- Vídeos públicos com auto-generated captions
- Vídeos em qualquer idioma (extrai no idioma original)
- URLs `youtube.com/watch?v=...` e `youtu.be/...`

❌ **Não funciona com**:
- Vídeos privados ou não listados
- Vídeos sem legendas automáticas
- Vídeos com restrição geográfica
- Lives em andamento
- Vídeos deletados

---

## Troubleshooting

### Erro: "Browser pool not initialized"

**Solução**: Certifique-se de que o Playwright está instalado:
```bash
npm install
npx playwright install chromium
```

### Erro: "Auto-generated transcript not available"

**Causas possíveis**:
1. Vídeo não possui legendas automáticas
2. Legendas desabilitadas pelo uploader
3. Vídeo muito curto (< 1 minuto)
4. Vídeo em idioma não suportado pelo YouTube

### Performance Lenta

**Soluções**:
1. Habilitar cache Redis (configura `REDIS_HOST`)
2. Aumentar `BROWSER_POOL_SIZE` (consome mais RAM)
3. Verificar recursos da VPS (CPU/RAM)

### Muitas Requisições Falhando

**Causas possíveis**:
1. YouTube detectou scraping (bloqueio temporário)
2. Recursos insuficientes da VPS
3. Problemas de rede/conectividade

**Soluções**:
1. Implementar rate limiting no cliente
2. Adicionar delays entre requisições
3. Usar IPs diferentes (proxy/VPN)

---

## Arquitetura

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ POST /vps/video/transcribe_youtube
       ▼
┌──────────────────────────────┐
│  Express Route               │
│  (vpsVideo.routes.ts)        │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  YouTube Transcriber Service │
│  (transcriber.service.ts)    │
└──────┬───────────────────────┘
       │
       ├─────► Cache Service (Redis) ◄─── Cache Hit? Return
       │
       ▼ Cache Miss
┌──────────────────────────────┐
│  Browser Pool                │
│  (browser-pool.ts)           │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Playwright (Chromium)       │
│  - Navigate to YouTube       │
│  - Click transcript button   │
│  - Extract segments          │
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────────────────┐
│  Return JSON Response        │
│  {ok, transcript_text, ...}  │
└──────────────────────────────┘
```

---

## Estrutura de Arquivos

```
src/orchestrator/services/youtube/
├── browser-pool.ts          # Pool de browsers Playwright
├── cache.service.ts         # Cache Redis para transcrições
└── transcriber.service.ts   # Lógica de extração

src/orchestrator/routes/
└── vpsVideo.routes.ts       # Rotas VPS (inclui /transcribe_youtube)

src/shared/
├── types/index.ts           # Tipos TypeScript
└── middleware/validation.ts # Schemas de validação Joi
```

---

## Segurança

### API Key Obrigatória

Todas as requisições devem incluir `X-API-Key` header válida.

### Validação de URL

- Apenas URLs do YouTube são aceitas
- Validação de formato com regex
- Proteção contra SSRF

### Rate Limiting (Recomendado)

Configure rate limiting no seu reverse proxy (Nginx, Traefik, etc.):

```nginx
limit_req_zone $binary_remote_addr zone=youtube_transcript:10m rate=10r/m;

location /vps/video/transcribe_youtube {
    limit_req zone=youtube_transcript burst=5 nodelay;
    proxy_pass http://localhost:3000;
}
```

---

## Manutenção

### Monitoramento

Verificar logs para erros frequentes:
```bash
# Logs do serviço
tail -f logs/combined.log | grep "YouTube transcript"

# Estatísticas do cache
curl http://localhost:3000/health | jq
```

### Limpeza de Cache

Cache é limpo automaticamente após 24h. Para invalidar manualmente, use Redis CLI:

```bash
redis-cli
> KEYS yt:transcript:*
> DEL yt:transcript:VIDEO_ID
```

### Atualização de Seletores

YouTube pode mudar a estrutura HTML. Se o endpoint parar de funcionar:

1. Verificar arquivo `transcriber.service.ts`
2. Atualizar seletores CSS na função `scrapeTranscript()`
3. Testar em ambiente de desenvolvimento
4. Deploy com cuidado

---

## Changelog

### v1.0.0 (2025-01-15)
- ✨ Implementação inicial
- ✅ Suporte a legendas automáticas
- ✅ Cache Redis com TTL de 24h
- ✅ Browser Pool para concorrência
- ✅ Tratamento de erros robusto
