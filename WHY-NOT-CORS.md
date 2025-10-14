# Por Que NÃO é CORS?

## ❓ A Pergunta

> "Algum possível problema de CORS? Porque se conseguimos acessar as imagens por aqui, obrigatoriamente deveríamos conseguir acessar pela VPS, ainda mais sendo o mesmo ambiente e minio.automear.com seja um endereço público."

**Resposta curta**: Não, não é CORS. CORS só existe em navegadores.

## 🌐 O Que é CORS?

**CORS (Cross-Origin Resource Sharing)** é uma política de segurança implementada **APENAS em navegadores web**.

### Como CORS Funciona

```
┌─────────────┐                    ┌─────────────┐
│  Browser    │                    │   MinIO     │
│             │  1. Request        │             │
│ (JavaScript)├───────────────────>│ Server      │
│             │                    │             │
│             │  2. Response       │             │
│             │<───────────────────┤ + Headers   │
│             │  X-Allow-Origin?   │             │
└─────────────┘                    └─────────────┘
      │
      │ 3. Browser checks headers
      ▼
   ✅ Allow or ❌ Block
```

**CORS headers que navegadores verificam:**
```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST
Access-Control-Allow-Headers: Content-Type
```

### Servidor-para-Servidor (SEM CORS)

```
┌─────────────┐                    ┌─────────────┐
│  VPS Node.js│                    │   MinIO     │
│             │  1. HTTP Request   │             │
│   (axios)   ├───────────────────>│ Server      │
│             │                    │             │
│             │  2. Response       │             │
│             │<───────────────────┤ + Data      │
└─────────────┘                    └─────────────┘

❌ Sem navegador = Sem CORS
✅ Headers CORS são ignorados
✅ Requisição sempre executada
```

**Quando o VPS faz requisições:**
- Não há navegador envolvido
- CORS headers são completamente ignorados
- A requisição SEMPRE é executada
- Só falha se: timeout, 404, 403, erro de rede, etc

## 🔍 Então Por Que 404 no VPS Mas 200 Local?

Você está certo em questionar! Se minio.automear.com é público, deveria funcionar igual. Aqui estão as **causas reais**:

### 1. **DNS Split-Brain** (Dual DNS)

O mesmo domínio pode resolver para IPs diferentes:

```
SEU PC (externo):
minio.automear.com
  └─> 203.0.113.50 (IP Público)
      └─> MinIO Produção
          └─> Bucket "canais" completo ✅

VPS (interno, mesma rede do MinIO):
minio.automear.com
  └─> 192.168.1.100 (IP Privado)
      └─> MinIO Interno/Staging
          └─> Bucket "canais" vazio ou desatualizado ❌
```

**Por que isso acontece?**
- Otimização: tráfego interno não sai para internet
- Segurança: MinIO interno sem exposição externa
- Custo: evitar egress bandwidth

**Como identificar:**
```bash
# No seu PC
nslookup minio.automear.com
# Resultado: 203.0.113.50

# No VPS
nslookup minio.automear.com
# Resultado: 192.168.1.100 (DIFERENTE!)
```

### 2. **Projetos Diferentes = Imagens Diferentes**

```
idRoteiro 41: "3 Contos VERDADEIROS..."
└─> Testamos localmente: ✅ 200 OK
└─> Imagens existem

idRoteiro 42: "4 Casos VERDADEIROS..."
└─> Webhook falhou: ❌ 404 Not Found
└─> Imagens NÃO existem ou foram deletadas
```

**Isso é completamente normal!** Cada projeto tem suas próprias imagens.

### 3. **Cache / CDN**

```
SEU PC → Cloudflare CDN → MinIO
           └─> Cache HIT ✅ (retorna 200 do cache)

VPS → Direct to MinIO (bypass CDN)
      └─> Cache MISS ❌ (vai direto, arquivo não existe)
```

### 4. **Permissões de Bucket**

MinIO pode ter políticas diferentes:

```json
// Política externa (pública)
{
  "Effect": "Allow",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Resource": "arn:aws:s3:::canais/*"
}

// Política interna (requer auth)
{
  "Effect": "Deny",
  "Principal": "*",
  "Action": "s3:GetObject",
  "Condition": {
    "IpAddress": {
      "aws:SourceIp": "192.168.0.0/16"
    }
  }
}
```

## 🧪 Como Identificar a Causa Real?

Criei **2 scripts de diagnóstico**:

### Script 1: `compare-dns-resolution.sh`
Testa com curl e compara DNS:

```bash
ssh root@185.173.110.7
cd /root/api-gpu
git pull
chmod +x compare-dns-resolution.sh
./compare-dns-resolution.sh
```

**O que ele faz:**
- ✅ Resolve DNS interno vs externo
- ✅ Testa ambos os idRoteiro (41 e 42)
- ✅ Compara curl vs axios User-Agent
- ✅ Verifica SSL certificate
- ✅ Identifica DNS split-brain

### Script 2: `test-axios-download.js`
Simula exatamente o código de produção:

```bash
node test-axios-download.js
```

**O que ele faz:**
- ✅ Usa axios (mesmo que LocalVideoProcessor)
- ✅ HEAD request primeiro (como produção)
- ✅ GET com stream (como produção)
- ✅ Testa ambos projetos
- ✅ Identifica qual retorna 404

## 📊 Comparação: Erro CORS vs 404

| Aspecto | CORS Error | 404 Not Found |
|---------|------------|---------------|
| **Onde ocorre** | Navegador (browser) | Servidor (MinIO) |
| **Mensagem** | "blocked by CORS policy" | "Request failed with status code 404" |
| **Status HTTP** | 200 (mas bloqueado pelo browser) | 404 |
| **Afeta server-to-server?** | ❌ Não | ✅ Sim |
| **Headers relevantes** | Access-Control-Allow-Origin | Nenhum (recurso não existe) |
| **Solução** | Adicionar CORS headers no servidor | Verificar se arquivo existe |

## 🎯 Diagnóstico do SEU Erro

```json
{
  "status": "FAILED",
  "error": "Request failed with status code 404"
}
```

**Análise:**
- ✅ Status: 404 (não 200 bloqueado)
- ✅ Mensagem: "status code 404" (não "CORS policy")
- ✅ Contexto: Server-to-server (Node.js)
- ❌ **Conclusão**: Não é CORS, arquivo não existe

## 💡 Causas Mais Prováveis (em ordem)

### 1. Imagens do idRoteiro 42 não existem (80%)
```bash
# Verificar no MinIO Web UI
https://minio.automear.com/
# Navegar para:
# bucket: canais
# path: Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/
```

**Solução**: Re-upload das imagens

### 2. DNS Split-Brain (15%)
```bash
# Testar no VPS
dig +short minio.automear.com
# Se retornar IP privado (192.168.x.x), é split-brain
```

**Solução**: Usar URL interna ou IP público direto

### 3. Problema de rede/firewall (5%)
```bash
# Testar conectividade
curl -I https://minio.automear.com/
```

**Solução**: Abrir firewall ou verificar rotas

## ✅ Teste Definitivo

Execute no VPS:

```bash
# Pull código mais recente
cd /root/api-gpu
git pull

# Teste 1: DNS e curl
chmod +x compare-dns-resolution.sh
./compare-dns-resolution.sh

# Teste 2: Axios (simula produção)
node test-axios-download.js
```

**Resultado esperado:**

Se **idRoteiro 41 funciona mas 42 falha** → Imagens do 42 não existem

Se **ambos falham** → Problema de rede/DNS

Se **ambos funcionam** → Problema temporário, tentar job novamente

## 📚 Referências

- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/CORS)
- [CORS não se aplica a requisições server-to-server](https://stackoverflow.com/questions/20035101/why-doesnt-my-server-to-server-request-need-cors)
- [Split-brain DNS](https://en.wikipedia.org/wiki/Split-horizon_DNS)

## 🎬 Resumo Final

**CORS não é o problema porque:**
1. ❌ CORS só existe em navegadores
2. ✅ VPS usa Node.js (servidor), não navegador
3. ✅ Requisições server-to-server ignoram CORS
4. ✅ O erro é 404 (recurso não existe), não bloqueio CORS

**O problema real é:**
- 📁 Imagens do idRoteiro 42 provavelmente não existem
- 🔍 Ou DNS resolve para instância diferente do MinIO
- 🌐 Ou problema de rede/firewall

**Próximo passo:**
Execute os scripts de diagnóstico no VPS e compartilhe o resultado! 🚀
