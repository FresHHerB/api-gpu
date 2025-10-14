# Diagnóstico do Erro 404

## 🔴 Problema Identificado

O VPS está processando corretamente, mas retornando erro:

```json
{
  "status": "FAILED",
  "error": "Request failed with status code 404"
}
```

## ✅ O Que Está Funcionando

- ✅ FFmpeg instalado e funcionando
- ✅ Código deployado e rodando
- ✅ LocalWorkerService processando jobs VPS
- ✅ URL encoding funcionando (espaços → %20)
- ✅ Estrutura do código correta

## ❌ O Problema: 404 Not Found

As imagens NÃO estão acessíveis do VPS. Possíveis causas:

### 1. Imagens foram deletadas
As imagens do **idRoteiro 42** podem ter sido deletadas do MinIO.

**Observação**: Você está testando dois projetos diferentes:
- **idRoteiro 41**: "3 Contos VERDADEIROS..." ✅ URLs existem
- **idRoteiro 42**: "4 Casos VERDADEIROS..." ❌ Retornou 404

### 2. Problema de conectividade VPS → MinIO
O VPS pode não conseguir acessar minio.automear.com

### 3. Problema de DNS
DNS pode não estar resolvendo minio.automear.com no VPS

### 4. Firewall bloqueando
Firewall pode estar bloqueando saída do VPS para MinIO

## 🔍 Diagnóstico Passo a Passo

### Passo 1: Verificar se imagens existem no MinIO

**Acesse o MinIO Web UI:**
```
https://minio.automear.com/
```

**Verifique se existem imagens em:**
```
bucket: canais
path: Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/
```

**Se imagens NÃO existem:**
- Re-upload as imagens
- Ou use outro projeto que tenha imagens (como idRoteiro 41)

### Passo 2: Testar conectividade do VPS

**SSH no VPS:**
```bash
ssh root@185.173.110.7
cd /root/api-gpu
```

**Executar script de teste:**
```bash
chmod +x test-minio-connectivity.sh
./test-minio-connectivity.sh
```

O script vai testar:
- ✅ DNS resolution
- ✅ Network connectivity
- ✅ HTTP access to MinIO
- ✅ Specific image URLs
- ✅ URL encoding

### Passo 3: Testar URLs manualmente

**No VPS, testar uma imagem:**
```bash
# Imagem do idRoteiro 41 (deve funcionar)
curl -I "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"

# Deve retornar: HTTP/2 200

# Imagem do idRoteiro 42 (está falhando)
curl -I "https://minio.automear.com/canais/Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/imagem_1.jpg"

# Se retornar 404, as imagens não existem
```

## 💡 Soluções por Cenário

### Cenário A: Imagens não existem (404)

**Solução 1 - Re-upload das imagens:**
1. Gerar novamente as imagens para o idRoteiro 42
2. Upload para MinIO no path correto
3. Retentar o job

**Solução 2 - Usar projeto diferente:**
1. Testar com idRoteiro 41 (sabemos que tem imagens)
2. Usar o payload que você me enviou
3. Deve funcionar sem erros

### Cenário B: Problema de rede VPS → MinIO

**Diagnóstico:**
```bash
# No VPS
ping minio.automear.com
curl -I https://minio.automear.com/
```

**Se falhar:**
```bash
# Check DNS
cat /etc/resolv.conf
nslookup minio.automear.com

# Check firewall
sudo ufw status
sudo iptables -L OUTPUT
```

**Solução:**
- Adicionar regra de firewall para permitir saída para minio.automear.com
- Configurar DNS corretamente
- Contactar administrador do VPS

### Cenário C: Problema de DNS

**Diagnóstico:**
```bash
host minio.automear.com
nslookup minio.automear.com
dig minio.automear.com
```

**Se DNS não resolver:**
```bash
# Adicionar entry manual no /etc/hosts
echo "IP_DO_MINIO minio.automear.com" | sudo tee -a /etc/hosts
```

## 🧪 Teste Recomendado

**Teste com idRoteiro 41 (sabemos que funciona):**

```bash
# No seu sistema local ou Postman
curl -X POST http://185.173.110.7:3000/vps/video/img2vid \
  -H "Content-Type: application/json" \
  -H "X-API-Key: api-gpu-2025-secure-key-change-me" \
  -d '{
    "webhook_url": "http://n8n.automear.com/webhook/img2vid",
    "id_roteiro": 41,
    "path": "Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/videos/temp/",
    "images": [
      {
        "id": "1",
        "image_url": "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg",
        "duracao": 11.16
      },
      {
        "id": "2",
        "image_url": "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_2.jpg",
        "duracao": 5.78
      },
      {
        "id": "3",
        "image_url": "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_3.jpg",
        "duracao": 10.48
      }
    ]
  }'
```

**Resultado esperado:**
- Se imagens existem: ✅ SUCCESS (webhook COMPLETED)
- Se imagens não existem: ❌ FAILED (erro 404)

## 📊 Comparação Local vs VPS

| Teste | Local (Windows) | VPS (Linux) |
|-------|----------------|-------------|
| URL Encoding | ✅ OK | ✅ OK |
| FFmpeg | ✅ OK | ✅ OK (assumindo) |
| Download idRoteiro 41 | ✅ OK (200) | ❓ Testar |
| Download idRoteiro 42 | ❓ Não testado | ❌ 404 |
| Processing | ✅ OK (2.21s) | ⏳ Aguardando imagens |

## 🎯 Ação Imediata

Execute estes comandos **NO VPS** e me envie o resultado:

```bash
ssh root@185.173.110.7
cd /root/api-gpu

# Pull código mais recente (tem os scripts de teste)
git pull

# Executar teste de conectividade
chmod +x test-minio-connectivity.sh
./test-minio-connectivity.sh

# Testar URL específica que está falhando
curl -I "https://minio.automear.com/canais/Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/imagem_1.jpg"
```

Isso vai me dizer **exatamente** qual é o problema:
- ❌ Imagens não existem (404) → Re-upload necessário
- ❌ Rede bloqueada → Firewall/DNS
- ✅ Tudo OK → Outro problema

## 📝 Resumo

**Problema**: 404 Not Found ao baixar imagens
**Causa mais provável**: Imagens do idRoteiro 42 não existem no MinIO
**Solução**: Verificar MinIO Web UI e re-upload se necessário
**Teste**: Usar idRoteiro 41 que sabemos ter imagens

**Próximo passo**: Execute o script de teste no VPS e compartilhe o resultado!
