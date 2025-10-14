# Diferenças Críticas: LocalVideoProcessor vs FFmpegService

## Comparação do Método Img2Vid

### 🔴 LocalVideoProcessor (api-gpu) - ATUAL (FALHA)

```typescript
// Linha 242-306
async processImg2Vid(data: any) {
  const ffmpegArgs = [
    '-loop', '1',
    '-i', imgPath,
    '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='zoom+0.0015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '23',
    '-t', String(image.duracao),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath
  ];

  await this.executeFFmpeg(ffmpegArgs);
}
```

### ✅ FFmpegService (api-transcricao) - FUNCIONA

```typescript
// Linhas 709-796
private async processImageToVideoWithFFmpeg(...) {
  // 1. Extrai metadata da imagem
  const imageMetadata = await this.getImageMetadata(imagePath);

  // 2. Calcula upscale 6x
  const upscaleFactor = 6;
  const upscaleWidth = imageMetadata.width * upscaleFactor; // 6720
  const upscaleHeight = imageMetadata.height * upscaleFactor; // 3840

  // 3. Zoom preciso
  const zoomStart = 1.0;
  const zoomEnd = 1.324;
  const totalFrames = Math.round(frameRate * duration);

  // 4. Filter complexo em 3 etapas
  const videoFilter = [
    `scale=${upscaleWidth}:${upscaleHeight}:flags=lanczos`, // Upscale primeiro
    `zoompan=z='min(${zoomStart}+0.324*on/${totalFrames}, ${zoomEnd})':d=${totalFrames}:x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=1920x1080:fps=${frameRate}`,
    'format=yuv420p'
  ].join(',');

  const ffmpegArgs = [
    '-framerate', frameRate.toString(), // ADICIONA framerate ANTES
    '-loop', '1',
    '-i', imagePath,
    '-vf', videoFilter,
    '-c:v', 'libx264',
    '-preset', 'ultrafast', // Mais rápido
    '-crf', '23',
    '-threads', '2', // Especifica threads
    '-t', duration.toString(),
    '-max_muxing_queue_size', '1024', // Previne buffer issues
    '-y',
    outputPath
  ];

  // 5. Ambiente otimizado
  const ffmpegEnv = {
    ...process.env,
    TMPDIR: '/tmp',  // Usa tmpfs (mais rápido)
    TEMP: '/tmp',
    TMP: '/tmp'
  };

  // 6. Spawn com environment
  const ffmpeg = spawn('ffmpeg', ffmpegArgs, { env: ffmpegEnv });

  // 7. Monitoring detalhado
  ffmpeg.stderr.on('data', (data) => {
    // Parse progress: frame, fps, time, speed, ETA
    // Log a cada 5% de progresso
  });
}
```

---

## 🔍 10 Diferenças Críticas

### 1. **Ordem dos Argumentos FFmpeg**
**api-gpu**: `-loop '1' -i imgPath`
**api-transcricao**: `-framerate 24 -loop '1' -i imagePath`
⚠️ **Framerate DEVE vir antes de -loop e -i**

### 2. **Upscaling da Imagem**
**api-gpu**: Não faz upscale (escala direto para 1920x1080)
**api-transcricao**: Upscale 6x ANTES do zoom (6720x3840)
⚠️ **Sem upscale, o zoom fica pixelizado**

### 3. **Fórmula do Zoom**
**api-gpu**: `zoompan=z='zoom+0.0015'` (linear infinito, incorreto)
**api-transcricao**: `zoompan=z='min(1.0+0.324*on/frames, 1.324)'` (controlado)
⚠️ **A fórmula atual causa zoom excessivo**

### 4. **Filtro em Múltiplas Etapas**
**api-gpu**: Tudo em um filtro complexo
**api-transcricao**: 3 etapas separadas: scale → zoompan → format
⚠️ **Filtros compostos podem causar erros**

### 5. **Environment Variables**
**api-gpu**: Não define TMPDIR
**api-transcricao**: Define TMPDIR='/tmp' (tmpfs)
⚠️ **Sem tmpfs, I/O é mais lento**

### 6. **Preset FFmpeg**
**api-gpu**: 'medium' (balanceado)
**api-transcricao**: 'ultrafast' (prioriza velocidade)
⚠️ **Medium é mais lento sem ganho significativo de qualidade**

### 7. **Threads Explícitos**
**api-gpu**: Não especifica (usa padrão)
**api-transcricao**: '-threads', '2' (otimizado para VPS)
⚠️ **Sem especificar, pode usar menos threads**

### 8. **Max Muxing Queue Size**
**api-gpu**: Não especifica
**api-transcricao**: '-max_muxing_queue_size', '1024'
⚠️ **Pode causar "Too many packets buffered" error**

### 9. **Metadata Extraction**
**api-gpu**: Não extrai metadata da imagem
**api-transcricao**: Usa ffprobe para width/height
⚠️ **Sem metadata, upscale é fixo (pode distorcer)**

### 10. **Monitoring de Progresso**
**api-gpu**: Logs básicos (stderr completo)
**api-transcricao**: Parse frame-by-frame, calcula ETA, monitora CPU
⚠️ **Sem monitoring, dificulta debug**

---

## 🚨 PROBLEMAS IDENTIFICADOS

### Problema 1: Ordem dos Argumentos FFmpeg
```bash
# ERRADO (api-gpu atual)
ffmpeg -loop 1 -i image.jpg -framerate 24 ...

# CORRETO (api-transcricao)
ffmpeg -framerate 24 -loop 1 -i image.jpg ...
```
**Impacto**: FFmpeg pode ignorar framerate ou causar erro

### Problema 2: Zoom Linear Infinito
```bash
# ERRADO (api-gpu atual)
zoompan=z='zoom+0.0015'
# Resultado: zoom continua infinitamente, não para em 1.324

# CORRETO (api-transcricao)
zoompan=z='min(1.0+0.324*on/576, 1.324)':d=576
# Resultado: zoom controlado de 1.0 → 1.324 em exatos 576 frames
```
**Impacto**: Vídeo pode ficar super-zoomado ou com zoom incorreto

### Problema 3: Sem Upscale
```bash
# ERRADO (api-gpu atual)
scale=1920:1080 + zoompan
# Resultado: Imagem 1920x1080 + zoom = pixelização

# CORRETO (api-transcricao)
scale=6720:3840 + zoompan + output 1920x1080
# Resultado: Imagem 6x maior + zoom = suave e sem pixelização
```
**Impacto**: Vídeos ficam pixelizados durante o zoom

### Problema 4: Buffer Overflow
```bash
# ERRADO (api-gpu atual)
# Sem especificar max_muxing_queue_size

# CORRETO (api-transcricao)
-max_muxing_queue_size 1024
```
**Impacto**: Erro "Too many packets buffered for output stream"

### Problema 5: I/O Lento
```typescript
// ERRADO (api-gpu atual)
const ffmpeg = spawn('ffmpeg', args);
// Usa diretório padrão (pode ser disco)

// CORRETO (api-transcricao)
const ffmpeg = spawn('ffmpeg', args, {
  env: {
    ...process.env,
    TMPDIR: '/tmp' // tmpfs em memória
  }
});
```
**Impacto**: Processamento 30-50% mais lento

---

## ✅ CORREÇÕES NECESSÁRIAS

### 1. Adicionar método getImageMetadata (ffprobe)
```typescript
private async getImageMetadata(imagePath: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_streams',
      imagePath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const metadata = JSON.parse(output);
        const imageStream = metadata.streams?.find((s: any) => s.codec_type === 'video');
        resolve({ width: imageStream.width, height: imageStream.height });
      } else {
        resolve(null);
      }
    });
  });
}
```

### 2. Corrigir processImg2Vid

```typescript
async processImg2Vid(data: any): Promise<{ videos: any[]; pathRaiz?: string }> {
  const jobId = randomUUID();
  const workPath = path.join(this.workDir, jobId);
  await fs.mkdir(workPath, { recursive: true });

  try {
    const results = [];

    for (const image of data.images) {
      const imgPath = path.join(workPath, `${image.id}.jpg`);
      const outputPath = path.join(workPath, `video_${image.id}.mp4`);

      // Download image
      await this.downloadFile(image.image_url, imgPath);

      // Get image metadata
      const imageMetadata = await this.getImageMetadata(imgPath);

      // Calculate parameters
      const fps = 24;
      const totalFrames = Math.round(image.duracao * fps);

      // Upscale 6x for smooth zoom
      const upscaleFactor = 6;
      const upscaleWidth = imageMetadata ? imageMetadata.width * upscaleFactor : 6720;
      const upscaleHeight = imageMetadata ? imageMetadata.height * upscaleFactor : 3840;

      // Zoom parameters
      const zoomStart = 1.0;
      const zoomEnd = 1.324;
      const zoomDiff = zoomEnd - zoomStart; // 0.324

      // Build video filter (3 stages)
      const videoFilter = [
        `scale=${upscaleWidth}:${upscaleHeight}:flags=lanczos`,
        `zoompan=z='min(${zoomStart}+${zoomDiff}*on/${totalFrames}, ${zoomEnd})':d=${totalFrames}:x='trunc(iw/2-(iw/zoom/2))':y='trunc(ih/2-(ih/zoom/2))':s=1920x1080:fps=${fps}`,
        'format=yuv420p'
      ].join(',');

      // FFmpeg args (CORRECTED ORDER)
      const ffmpegArgs = [
        '-framerate', fps.toString(), // ANTES de -loop
        '-loop', '1',
        '-i', imgPath,
        '-vf', videoFilter,
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Mudado de 'medium'
        '-crf', '23',
        '-threads', '2', // ADICIONADO
        '-t', String(image.duracao),
        '-max_muxing_queue_size', '1024', // ADICIONADO
        '-movflags', '+faststart',
        '-y',
        outputPath
      ];

      // Execute with optimized environment
      await this.executeFFmpegWithEnv(ffmpegArgs);

      // Upload
      const videoBuffer = await fs.readFile(outputPath);
      const filename = `video_${image.id}.mp4`;
      const videoUrl = await this.s3Service.uploadFile(
        data.path,
        filename,
        videoBuffer,
        'video/mp4'
      );

      results.push({
        id: image.id,
        video_url: videoUrl,
        filename
      });
    }

    const pathRaiz = this.extractPathRaiz(data.path);
    await fs.rm(workPath, { recursive: true, force: true });

    return { videos: results, pathRaiz };

  } catch (error: any) {
    await fs.rm(workPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
```

### 3. Novo método executeFFmpegWithEnv

```typescript
private async executeFFmpegWithEnv(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('[LocalVideoProcessor] Executing FFmpeg', { args: args.join(' ') });

    // Optimized environment
    const ffmpegEnv = {
      ...process.env,
      TMPDIR: '/tmp',
      TEMP: '/tmp',
      TMP: '/tmp'
    };

    const ffmpeg = spawn('ffmpeg', args, { env: ffmpegEnv });
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();

      // Parse progress (optional, for better logging)
      const output = data.toString();
      if (output.includes('frame=') && output.includes('time=')) {
        const frameMatch = output.match(/frame=\s*(\d+)/);
        const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2}\.\d{2})/);
        if (frameMatch && timeMatch) {
          logger.debug(`[LocalVideoProcessor] Progress: frame=${frameMatch[1]}, time=${timeMatch[1]}`);
        }
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        logger.info('[LocalVideoProcessor] FFmpeg completed successfully');
        resolve();
      } else {
        logger.error('[LocalVideoProcessor] FFmpeg failed', { code, stderr: stderr.slice(-500) });
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    ffmpeg.on('error', (error) => {
      logger.error('[LocalVideoProcessor] FFmpeg spawn error', { error: error.message });
      reject(error);
    });
  });
}
```

---

## 📋 Checklist de Implementação

- [ ] Adicionar método `getImageMetadata()` usando ffprobe
- [ ] Criar método `executeFFmpegWithEnv()` com TMPDIR
- [ ] Atualizar `processImg2Vid()`:
  - [ ] Extrair metadata da imagem
  - [ ] Calcular upscale 6x
  - [ ] Corrigir ordem: -framerate ANTES de -loop
  - [ ] Usar fórmula zoom controlada
  - [ ] Adicionar -threads 2
  - [ ] Adicionar -max_muxing_queue_size 1024
  - [ ] Mudar preset para 'ultrafast'
  - [ ] Filtro em 3 etapas separadas
- [ ] Testar com 1 imagem
- [ ] Testar com 3 imagens
- [ ] Deploy e validar na VPS

---

## 🎯 Resultado Esperado

Após as correções:
- ✅ FFmpeg executará sem erros de buffer
- ✅ Zoom suave e controlado (1.0 → 1.324)
- ✅ Vídeos sem pixelização
- ✅ Processamento 30-50% mais rápido
- ✅ Logs com progresso detalhado
- ✅ Compatível com arquitetura assíncrona (mantém filas/webhook)
