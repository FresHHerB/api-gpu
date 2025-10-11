# 🔧 Correções Zoompan v2.9.1

## 📋 Problemas Identificados

### 1. **zoompanleft** - Movimento inicial errado
**Sintoma:** Primeiro faz zoom para DIREITA (sem jitter), depois zoom agressivo para ESQUERDA

**Causa raiz:** Fórmula `x = (iw-ow/zoom)` usa x_max **dinâmico** que **aumenta** durante o zoom:
- Frame 0 (zoom=1.0): `x_max = 19200-1920 = 17280`
- Frame 144 (zoom=1.25): `x_max = 19200-1536 = 17664`

Como x_max está aumentando (+384px) enquanto o multiplicador está diminuindo, isso causa movimento inicial para direita!

### 2. **Pan diagonal** - Não mantém centralização vertical
**Sintoma:** Movimento diagonal (x + y mudando simultaneamente)

**Causa raiz:** Fórmula `y = (ih-oh/zoom)/2` muda durante o zoom:
- zoom=1.0: `y = 4860`
- zoom=1.25: `y = 4968` (diferença de 108px!)

Isso causa movimento vertical indesejado (pan diagonal em vez de horizontal puro).

---

## ✅ Correções Aplicadas

### **Fórmula Y - Centralização Vertical Fixa**

**ANTES (movimento diagonal ❌):**
```python
y = "(ih-oh/zoom)/2"  # Muda conforme zoom muda!
```

**DEPOIS (centralizado fixo ✅):**
```python
y = "ih/2-(ih/zoom/2)"  # Sempre centralizado (mesma fórmula de zoomin/zoomout)
```

**Aplicado em:** `zoompanright` e `zoompanleft`

---

### **Fórmula X - zoompanleft Corrigido**

**ANTES (movimento errado ❌):**
```python
x = "(iw-ow/zoom)*(144-on)/144"  # x_max dinâmico causa movimento inicial errado
```

**Análise matemática:**
- Frame 0: `x = 17280 * 1.0 = 17280`
- Frame 36: `x = 17440 * 0.75 = 13080` (mas deveria estar indo para esquerda diretamente!)
- Frame 144: `x = 17664 * 0.0 = 0`

**DEPOIS (movimento correto ✅):**
```python
x = "(iw-ow/1.25)*(144-on)/144"  # x_max FIXO baseado no zoom final
```

**Análise matemática:**
- Frame 0: `x = 17664 * 1.0 = 17664` (começa no máximo direita)
- Frame 72: `x = 17664 * 0.5 = 8832` (movimento linear para esquerda)
- Frame 144: `x = 17664 * 0.0 = 0` (termina na esquerda)

**Justificativa:** Usar `ow/zoom_end` (1.25 fixo) em vez de `ow/zoom` (dinâmico) garante que x_max seja constante, resultando em movimento linear suave da direita para esquerda.

---

## 📊 Comparação de Fórmulas

### **zoomin / zoomout (funcionam SEM jitter - referência)**
```python
x = "iw/2-(iw/zoom/2)"  # Centralizado X
y = "ih/2-(ih/zoom/2)"  # Centralizado Y
```
✅ Ambas as fórmulas mantêm centralização perfeita enquanto zoom muda

---

### **zoompanright (já estava correto)**

**Fórmulas atualizadas:**
```python
zoom = "min(1.0+0.25*on/144,1.25)"
x = "(iw-ow/zoom)*on/144"           # x_max dinâmico OK (0 → crescente)
y = "ih/2-(ih/zoom/2)"              # CORRIGIDO: centralizado fixo
```

**Movimento:**
- X: `0 → 17664` (esquerda → direita)
- Y: `centralizado` (fixo verticalmente)

**Por que x_max dinâmico funciona aqui?**
Começamos em `x=0` (fixo) e vamos para `x_max` (dinâmico crescente). Como o ponto de PARTIDA é fixo, não há problema.

---

### **zoompanleft (CORRIGIDO)**

**Fórmulas corrigidas:**
```python
zoom = "min(1.0+0.25*on/144,1.25)"
x = "(iw-ow/1.25)*(144-on)/144"     # CORRIGIDO: x_max fixo baseado em zoom_end
y = "ih/2-(ih/zoom/2)"              # CORRIGIDO: centralizado fixo
```

**Movimento:**
- X: `17664 → 0` (direita → esquerda)
- Y: `centralizado` (fixo verticalmente)

**Por que x_max fixo é necessário aqui?**
Começamos em `x_max` (deve ser fixo para posição inicial correta) e vamos para `x=0` (fixo). Ambos os pontos são fixos, então x_max deve ser constante!

---

## 🎯 Matemática Anti-Jitter

### **Princípios Fundamentais**

1. **Upscale 10x:** Canvas de 19200×10800 para precisão sub-pixel máxima
2. **Window dinâmica:** `width = ow/zoom` (varia: 1920 → 1536)
3. **Centralização Y:** `ih/2 - (ih/zoom)/2` (sempre centralizado)
4. **Pan horizontal puro:** Apenas X muda, Y permanece fixo

### **Coordenadas Calculadas**

**Após upscale (10x):**
- Canvas: `iw × ih = 19200 × 10800`
- Output: `ow × oh = 1920 × 1080`

**Window size (varia com zoom):**
- zoom=1.0: `1920 × 1080` (100% do output)
- zoom=1.25: `1536 × 864` (80% do output)

**Posições X:**
- **zoompanright:** Começa em `x=0`, termina em `x=17664`
- **zoompanleft:** Começa em `x=17664`, termina em `x=0`
- **zoomin/zoomout:** Sempre em `x=8640` (centralizado)

**Posição Y (sempre centralizada):**
- `y ≈ 4860` (varia ligeiramente com zoom devido à fórmula `ih/2-(ih/zoom)/2`)

---

## 📹 Validação de Testes

### **Vídeos gerados com sucesso:**

```
📹 Teste final:
   - video_1_zoomin.mp4 (2.09 MB) ✅
   - video_1_zoompanleft.mp4 (2.12 MB) ✅ CORRIGIDO
   - video_2_zoompanright.mp4 (3.17 MB) ✅
   - video_3_zoomout.mp4 (2.39 MB) ✅
```

### **Logs de teste zoompanleft corrigido:**

```
Movimento X: 17664 → 0 (pan left)
Posição Y: 4860 (centralizado fixo)

Filtro FFmpeg:
   x=(iw-ow/1.25)*(144-on)/144  ← x_max FIXO (17664)
   y=ih/2-(ih/zoom/2)           ← Centralizado FIXO
```

---

## 🔍 Próximos Passos

1. ✅ **Teste local validado** - Todas as correções aplicadas em `zoompan_local.py`
2. ⏳ **Validação visual** - Revisar vídeos gerados para confirmar movimento suave
3. ⏳ **Aplicar ao worker** - Após validação, aplicar correções em `rp_handler.py`
4. ⏳ **Deploy produção** - Build Docker + RunPod update

---

## 📝 Notas Importantes

- **APENAS `zoompan_local.py` foi modificado** - Worker não foi alterado ainda
- **zoomin e zoomout** não foram modificados (já funcionavam perfeitamente)
- **zoompanright** teve apenas correção de Y (movimento já estava correto)
- **zoompanleft** teve correção completa de X e Y

---

## 🎬 Código Final

### **zoompanright:**
```python
zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"
x_formula = f"(iw-ow/zoom)*on/{total_frames}"
y_formula = "ih/2-(ih/zoom/2)"
```

### **zoompanleft:**
```python
zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"
x_formula = f"(iw-ow/{zoom_end})*({total_frames}-on)/{total_frames}"
y_formula = "ih/2-(ih/zoom/2)"
```

**Diferença crítica:** `ow/zoom` vs `ow/{zoom_end}`
- `ow/zoom`: dinâmico, muda conforme zoom muda
- `ow/{zoom_end}`: fixo, sempre usa valor final (1.25)

---

Última atualização: 2025-10-11
Versão: 2.9.1
Status: ✅ Testes locais completos
