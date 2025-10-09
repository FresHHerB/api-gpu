# Pesquisa: Sistema de Legendas Karaoke com ASS

Documentação técnica sobre implementação de legendas estilo karaoke usando formato ASS (Advanced SubStation Alpha).

## 📋 Índice

1. [Visão Geral](#visão-geral)
2. [Formato ASS](#formato-ass)
3. [Métodos de Implementação](#métodos-de-implementação)
4. [Sistema de Layers](#sistema-de-layers)
5. [Tags ASS Essenciais](#tags-ass-essenciais)
6. [Implementação Atual](#implementação-atual)
7. [Exemplos Avançados](#exemplos-avançados)
8. [Referências](#referências)

---

## 🎯 Visão Geral

### O que é Karaoke em ASS?

Karaoke em subtítulos ASS é a técnica de destacar palavras ou sílabas sincronizadas com o áudio, criando um efeito visual de "follow-along" comum em vídeos de karaoke.

### Métodos Principais

1. **Método 1: Tags `\k` nativas** (Karaoke básico)
2. **Método 2: Sistema de 2 layers** (Highlight word-by-word) ⭐ *Implementado*
3. **Método 3: Override inline** (Complexo)

---

## 📐 Formato ASS

### Estrutura Básica

```ass
[Script Info]
Title: Exemplo
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, ...
Style: Default,Arial,48,&H00FFFFFF&,&H00FFFFFF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,2,0,2,10,10,10,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,Texto da legenda
```

### Sistema de Cores ASS

```
HTML → ASS
RGB  → BGR

#FF0000 (vermelho) → &H0000FF& (vermelho em ASS)
#00FF00 (verde)    → &H00FF00& (verde em ASS)
#0000FF (azul)     → &HFF0000& (azul em ASS)
```

### Sistema de Alpha (Transparência)

```
API (Opacidade) → ASS (Alpha)
0 (transparente) → FF
128 (50%)        → 7F
255 (opaco)      → 00
```

---

## 🎨 Métodos de Implementação

### Método 1: Tags `\k` Nativas

**Vantagens:**
- ✅ Sintaxe simples
- ✅ Suporte nativo no formato ASS
- ✅ Renderização eficiente

**Desvantagens:**
- ❌ Efeito limitado (apenas mudança de cor)
- ❌ Difícil controlar estilos complexos

**Sintaxe:**
```ass
{\k100}Palavra {\k75}seguinte {\k125}texto
```

**Tags disponíveis:**
- `\k` - Preenchimento instantâneo (snap)
- `\kf` ou `\K` - Preenchimento suave (sweep)
- `\ko` - Apenas outline muda

**Exemplo:**
```ass
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\k100}Você {\k50}acorda {\k80}antes {\k40}do {\k54}sol
```

### Método 2: Sistema de 2 Layers ⭐ *IMPLEMENTADO*

**Vantagens:**
- ✅ Controle total sobre estilos
- ✅ Pode usar outline grosso como "caixa"
- ✅ Facilmente customizável via API

**Desvantagens:**
- ❌ Gera mais eventos ASS (maior arquivo)
- ❌ Renderização um pouco mais pesada

**Conceito:**
```
Layer 2 (Highlight) → Palavra ATIVA (visível com outline colorido)
Layer 0 (Base)      → Texto COMPLETO (sempre visível com fundo)
```

**Implementação:**

1. **Layer 0** - Texto completo permanente
```ass
Dialogue: 0,0:00:00.00,0:00:05.00,Base,,0,0,0,,{\an2}VOCÊ ACORDA ANTES DO SOL
```

2. **Layer 2** - Palavra ativa (0.00-0.46s)
```ass
Dialogue: 2,0:00:00.00,0:00:00.46,Highlight,,0,0,0,,{\an2}{\r}{\1c&H00FFFFFF&\3c&H000000D6&\bord12}VOCÊ {\alpha&HFF&}ACORDA ANTES DO SOL
```

**Tags usadas:**
- `\1c` - Cor do texto (PrimaryColour)
- `\3c` - Cor do outline (OutlineColour)
- `\bord` - Largura do outline
- `\alpha&HFF&` - Tornar palavra invisível

### Método 3: Override Inline (Avançado)

**Vantagens:**
- ✅ Gera menos eventos
- ✅ Pode usar `\t` para animações

**Desvantagens:**
- ❌ Sintaxe muito complexa
- ❌ Difícil de gerar programaticamente

**Exemplo:**
```ass
Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\t(0,460,\1c&HFF0000&)}Você{\t(460,960,\1c&HFF0000&)} acorda
```

---

## 🏗️ Sistema de Layers

### Renderização de Layers

ASS renderiza layers de **baixo para cima** (0 → N).

```
┌─────────────────────────────────────┐
│  Layer 2 (Highlight)                │  ← Topo
│  ├─ Palavra 1: VISÍVEL              │
│  ├─ Palavra 2-N: INVISÍVEL          │
│                                      │
│  Layer 1 (não usado)                │
│                                      │
│  Layer 0 (Base)                     │  ← Base
│  └─ Texto completo                 │
│                                      │
│  Vídeo                              │
└─────────────────────────────────────┘
```

---

## 🏷️ Tags ASS Essenciais

### Tags de Cor

| Tag | Descrição | Exemplo |
|-----|-----------|---------|
| `\1c` | Cor do texto | `\1c&H00FFFFFF&` |
| `\3c` | Cor do outline | `\3c&H00000000&` |

### Tags de Borda

| Tag | Descrição | Exemplo |
|-----|-----------|---------|
| `\bord` | Largura do outline | `\bord12` |

### Tags de Posicionamento

| Tag | Descrição | Exemplo |
|-----|-----------|---------|
| `\an` | Alinhamento (1-9) | `\an2` (base centro) |

### Tag Especial

| Tag | Descrição | Uso |
|-----|-----------|-----|
| `\r` | Reset | Remove todos os overrides |
| `\alpha&HFF&` | Invisível | Oculta palavra |

---

## 🔧 Implementação Atual

### Fluxo de Processamento (Highlight)

```python
# 1. Carregar palavras do JSON
words = load_words_json(json_path)

# 2. Agrupar palavras em diálogos
dialogues = group_words_into_dialogues(words)
# Resultado: 4 palavras/linha, 2 linhas/diálogo

# 3. Gerar ASS com 2 layers
generate_ass_highlight(json_path, ass_path, style)

# 4. Aplicar no vídeo com FFmpeg
ffmpeg -i video.mp4 -vf "ass=subtitles.ass" output.mp4
```

### Parâmetros de Agrupamento

```python
WORDS_PER_LINE = 4           # Máximo de palavras por linha
MAX_LINES = 2                # Máximo de linhas por diálogo
MAX_DURATION_PER_LINE = 5.0  # Duração máxima de linha (s)
```

---

## 📚 Referências

### Especificações

- [ASS Tags - Aegisub Manual](http://docs.aegisub.org/3.2/ASS_Tags/)
- [ASS Specification - TCAX](http://www.tcax.org/docs/ass-specs.htm)
- [FFmpeg ASS Filter](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1)

### Repositório de Referência

- `D:\code\github\arquivos_teste\README.md`
- `D:\code\github\arquivos_teste\LOGICA_HIGHLIGHT.md`
- `D:\code\github\arquivos_teste\PARAMETROS_API.md`

**Última atualização:** 2025-10-09
**Status:** 📖 Documentação completa
