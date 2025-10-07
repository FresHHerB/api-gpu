# Caption Style API - Documentação

## 📌 Visão Geral

O endpoint `/video/caption_style` permite adicionar legendas (subtítulos) a vídeos com **estilização personalizada** controlada via API. Você pode customizar:

- **Fonte**: Nome, tamanho, negrito, itálico, sublinhado
- **Cores**: Texto, contorno/borda, fundo (formato HTML `#RRGGBB`)
- **Opacidade**: Transparência de cada cor (0-255)
- **Borda**: Estilo, largura, sombra
- **Posição**: Alinhamento e margens

---

## 🔗 Endpoint

```
POST /video/caption_style
```

### Headers

```http
X-API-Key: your-api-key-here
Content-Type: application/json
```

---

## 📋 Payload Estrutura

### Request Body

```json
{
  "url_video": "https://s3.example.com/bucket/video.mp4",
  "url_srt": "https://s3.example.com/bucket/subtitle.srt",
  "path": "Channel Name/Video Title/videos/",
  "output_filename": "video_legendado.mp4",
  "style": {
    "font": {
      "name": "Arial",
      "size": 24,
      "bold": true,
      "italic": false,
      "underline": false
    },
    "colors": {
      "primary": "#FFFFFF",
      "primaryAlpha": 0,
      "outline": "#000000",
      "outlineAlpha": 0,
      "background": "#000000",
      "backgroundAlpha": 128
    },
    "border": {
      "style": 1,
      "width": 2,
      "shadow": 1
    },
    "position": {
      "alignment": 2,
      "marginVertical": 25,
      "marginLeft": 10,
      "marginRight": 10
    }
  }
}
```

### Campos Obrigatórios

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `url_video` | string (URL) | URL do vídeo a ser processado |
| `url_srt` | string (URL) | URL do arquivo SRT de legendas |
| `path` | string | Caminho S3 para upload (ex: "Canal/Video/videos/") |
| `output_filename` | string | Nome do arquivo de saída (ex: "video_legendado.mp4") |

### Campos Opcionais - Objeto `style`

Todos os campos dentro de `style` são **opcionais**. Se não fornecido, usa estilo padrão (Netflix-like).

---

## 🎨 Parâmetros de Estilo

### 1. **Font (Fonte)**

| Parâmetro | Tipo | Valores | Padrão | Descrição |
|-----------|------|---------|--------|-----------|
| `name` | string | Qualquer fonte | `"Arial"` | Nome da fonte instalada no sistema |
| `size` | number | 8-100 | `24` | Tamanho da fonte em pontos |
| `bold` | boolean | true/false | `true` | Texto em negrito |
| `italic` | boolean | true/false | `false` | Texto em itálico |
| `underline` | boolean | true/false | `false` | Texto sublinhado |

**Fontes disponíveis**: Arial, Roboto, Open Sans, Montserrat, etc.

---

### 2. **Colors (Cores)**

⚠️ **Formato**: `#RRGGBB` (HTML hex)

| Parâmetro | Tipo | Valores | Padrão | Descrição |
|-----------|------|---------|--------|-----------|
| `primary` | string | `#RRGGBB` | `"#FFFFFF"` | Cor principal do texto |
| `primaryAlpha` | number | 0-255 | `0` | Opacidade do texto (0=opaco, 255=transparente) |
| `outline` | string | `#RRGGBB` | `"#000000"` | Cor da borda/contorno |
| `outlineAlpha` | number | 0-255 | `0` | Opacidade da borda |
| `background` | string | `#RRGGBB` | `"#000000"` | Cor de fundo/sombra |
| `backgroundAlpha` | number | 0-255 | `128` | Opacidade do fundo (128=50% transparente) |

**Exemplos de cores**:
- Branco: `#FFFFFF`
- Preto: `#000000`
- Amarelo: `#FFFF00`
- Vermelho: `#FF0000`
- Verde: `#00FF00`
- Azul: `#0000FF`

---

### 3. **Border (Borda)**

| Parâmetro | Tipo | Valores | Padrão | Descrição |
|-----------|------|---------|--------|-----------|
| `style` | number | 0, 1, 3, 4 | `1` | 0=sem borda, 1=contorno+sombra, 3=caixa opaca, 4=fundo em caixa |
| `width` | number | 0-4 | `2` | Largura da borda em pixels |
| `shadow` | number | 0-4 | `1` | Profundidade da sombra em pixels |

**Recomendações**:
- **Máxima legibilidade**: `style=1`, `width=2-3`, `shadow=1`
- **Fundo em caixa**: `style=4`, `width=0`, `backgroundAlpha=128`

---

### 4. **Position (Posição)**

| Parâmetro | Tipo | Valores | Padrão | Descrição |
|-----------|------|---------|--------|-----------|
| `alignment` | number | 1-9 | `2` | Posição na tela (numpad layout) |
| `marginVertical` | number | 0-200 | `25` | Margem vertical em pixels |
| `marginLeft` | number | 0-200 | `10` | Margem esquerda em pixels |
| `marginRight` | number | 0-200 | `10` | Margem direita em pixels |

**Alignment (Numpad Layout)**:

```
7 = Top Left       8 = Top Center       9 = Top Right
4 = Middle Left    5 = Middle Center    6 = Middle Right
1 = Bottom Left    2 = Bottom Center    3 = Bottom Right
```

**Padrão**: `2` (Bottom Center - parte inferior centralizada)

---

## 📝 Exemplos de Uso

### Exemplo 1: **Estilo Netflix (Padrão)**

```json
{
  "url_video": "https://minio.example.com/canais/video.mp4",
  "url_srt": "https://minio.example.com/canais/subtitle.srt",
  "path": "Canal Teste/Video 1/videos/",
  "output_filename": "video_legendado.mp4",
  "style": {
    "font": {
      "name": "Arial",
      "size": 24,
      "bold": true
    },
    "colors": {
      "primary": "#FFFFFF",
      "outline": "#000000",
      "backgroundAlpha": 128
    },
    "border": {
      "style": 1,
      "width": 2,
      "shadow": 1
    },
    "position": {
      "alignment": 2,
      "marginVertical": 25
    }
  }
}
```

---

### Exemplo 2: **Legenda Amarela Clássica (Estilo YouTube)**

```json
{
  "url_video": "https://minio.example.com/canais/video.mp4",
  "url_srt": "https://minio.example.com/canais/subtitle.srt",
  "path": "Canal Teste/Video 2/videos/",
  "output_filename": "video_yellow.mp4",
  "style": {
    "font": {
      "name": "Arial",
      "size": 26,
      "bold": true
    },
    "colors": {
      "primary": "#FFFF00",
      "outline": "#000000"
    },
    "border": {
      "style": 1,
      "width": 3,
      "shadow": 0
    },
    "position": {
      "alignment": 2,
      "marginVertical": 20
    }
  }
}
```

---

### Exemplo 3: **Fundo Semi-Transparente (Máxima Legibilidade)**

```json
{
  "url_video": "https://minio.example.com/canais/video.mp4",
  "url_srt": "https://minio.example.com/canais/subtitle.srt",
  "path": "Canal Teste/Video 3/videos/",
  "output_filename": "video_background.mp4",
  "style": {
    "font": {
      "name": "Roboto",
      "size": 22,
      "bold": true
    },
    "colors": {
      "primary": "#FFFFFF",
      "background": "#000000",
      "backgroundAlpha": 180
    },
    "border": {
      "style": 4,
      "width": 0,
      "shadow": 0
    },
    "position": {
      "alignment": 2,
      "marginVertical": 30
    }
  }
}
```

---

### Exemplo 4: **Legenda no Topo (Top Center)**

```json
{
  "url_video": "https://minio.example.com/canais/video.mp4",
  "url_srt": "https://minio.example.com/canais/subtitle.srt",
  "path": "Canal Teste/Video 4/videos/",
  "output_filename": "video_top.mp4",
  "style": {
    "font": {
      "name": "Arial",
      "size": 20,
      "bold": false
    },
    "colors": {
      "primary": "#FFFFFF",
      "outline": "#000000"
    },
    "border": {
      "style": 1,
      "width": 2,
      "shadow": 2
    },
    "position": {
      "alignment": 8,
      "marginVertical": 30
    }
  }
}
```

---

### Exemplo 5: **Usar Estilo Padrão (Sem Customização)**

Se você não quiser customizar, simplesmente **omita o campo `style`**:

```json
{
  "url_video": "https://minio.example.com/canais/video.mp4",
  "url_srt": "https://minio.example.com/canais/subtitle.srt",
  "path": "Canal Teste/Video 5/videos/",
  "output_filename": "video_default.mp4"
}
```

Será aplicado o estilo padrão (Netflix-like).

---

## 📤 Response (Resposta)

### Success (200 OK)

```json
{
  "code": 200,
  "message": "Video caption with custom styling completed and uploaded to S3 successfully",
  "video_url": "https://minio.example.com/canais/Canal%20Teste/Video%201/videos/video_legendado.mp4",
  "execution": {
    "startTime": "2025-10-06T10:30:00.000Z",
    "endTime": "2025-10-06T10:32:15.000Z",
    "durationMs": 135000,
    "durationSeconds": 135.0
  },
  "stats": {
    "jobId": "abc123-xyz789",
    "delayTime": 5000,
    "executionTime": 130000,
    "forceStyle": "FontName=Arial,Fontsize=24,Bold=1,PrimaryColour=&H00FFFFFF,..."
  }
}
```

### Campos da Resposta

| Campo | Descrição |
|-------|-----------|
| `video_url` | URL do vídeo processado no S3/MinIO |
| `execution.durationSeconds` | Tempo total de processamento em segundos |
| `stats.forceStyle` | String force_style aplicada (formato ASS) |

---

## 🔍 Validação

### Erros de Validação (400 Bad Request)

```json
{
  "error": "Validation error",
  "message": "Invalid request parameters",
  "details": [
    {
      "field": "style.colors.primary",
      "message": "\"style.colors.primary\" must be a valid hex color (#RRGGBB)"
    }
  ]
}
```

### Regras de Validação

- **Cores**: Devem estar no formato `#RRGGBB` (6 dígitos hexadecimais)
- **Alpha**: 0-255 (0 = opaco, 255 = totalmente transparente)
- **Font size**: 8-100 pontos
- **Border width/shadow**: 0-4 pixels
- **Alignment**: 1-9 (numpad layout)
- **Margins**: 0-200 pixels

---

## 🎯 Boas Práticas

### Para Front-End

1. **Seletor de Cores HTML**: Use `<input type="color">` - retorna formato `#RRGGBB` direto
2. **Slider de Opacidade**: `<input type="range" min="0" max="255">` para alpha
3. **Preview**: Mostre preview em tempo real com as configurações selecionadas

### Exemplo HTML

```html
<!-- Cor primária -->
<label>Cor do Texto:</label>
<input type="color" id="primaryColor" value="#FFFFFF">

<!-- Opacidade -->
<label>Opacidade do Texto:</label>
<input type="range" id="primaryAlpha" min="0" max="255" value="0">

<!-- Tamanho da fonte -->
<label>Tamanho:</label>
<input type="number" id="fontSize" min="8" max="100" value="24">

<!-- Negrito -->
<label><input type="checkbox" id="bold" checked> Negrito</label>

<!-- Posição -->
<label>Posição:</label>
<select id="alignment">
  <option value="1">Bottom Left</option>
  <option value="2" selected>Bottom Center</option>
  <option value="3">Bottom Right</option>
  <option value="8">Top Center</option>
</select>
```

### JavaScript para Montar Payload

```javascript
const payload = {
  url_video: "https://minio.example.com/video.mp4",
  url_srt: "https://minio.example.com/subtitle.srt",
  path: "Canal/Video/videos/",
  output_filename: "output.mp4",
  style: {
    font: {
      name: document.getElementById('fontName').value,
      size: parseInt(document.getElementById('fontSize').value),
      bold: document.getElementById('bold').checked,
      italic: document.getElementById('italic').checked
    },
    colors: {
      primary: document.getElementById('primaryColor').value,
      primaryAlpha: parseInt(document.getElementById('primaryAlpha').value),
      outline: document.getElementById('outlineColor').value,
      background: document.getElementById('backgroundColor').value,
      backgroundAlpha: parseInt(document.getElementById('backgroundAlpha').value)
    },
    border: {
      style: parseInt(document.getElementById('borderStyle').value),
      width: parseInt(document.getElementById('borderWidth').value),
      shadow: parseInt(document.getElementById('shadowDepth').value)
    },
    position: {
      alignment: parseInt(document.getElementById('alignment').value),
      marginVertical: parseInt(document.getElementById('marginVertical').value)
    }
  }
};

// Enviar para API
fetch('https://api.example.com/video/caption_style', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify(payload)
})
.then(response => response.json())
.then(data => {
  console.log('Success:', data);
  console.log('Video URL:', data.video_url);
});
```

---

## 🔧 Troubleshooting

### Problema: Cores não aparecem corretamente

**Solução**: Verifique se o formato está correto (`#RRGGBB`) e se o alpha não está muito alto (255 = invisível).

### Problema: Legenda não aparece

**Solução**: Verifique:
- `primaryAlpha` não pode ser 255 (totalmente transparente)
- `border.width` e `border.shadow` devem ser > 0 para melhor visibilidade

### Problema: Fonte não é aplicada

**Solução**: Use fontes comuns (Arial, Roboto, etc). Fontes personalizadas precisam estar instaladas no servidor RunPod.

---

## 📊 Performance

- **Tempo médio**: 30-90 segundos (depende da duração do vídeo)
- **Aceleração GPU**: ✅ Decode (CUDA) + ❌ Subtitles (CPU) + ✅ Encode (NVENC)
- **Upload S3**: Automático após processamento

---

## 🔗 Endpoints Relacionados

- `POST /video/caption` - Legenda sem customização (estilo padrão)
- `POST /video/caption/async` - Submete job e retorna jobId (não bloqueia)
- `GET /video/job/:jobId` - Verifica status do job

---

## 📞 Suporte

Para dúvidas ou problemas, verifique os logs do servidor ou entre em contato com o time de desenvolvimento.
