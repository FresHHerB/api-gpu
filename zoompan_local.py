"""
Script local para testar efeitos de zoompan antes de deploy
Aplica os mesmos efeitos do worker em imagens locais

Features:
- Detecta automaticamente GPU NVIDIA e usa NVENC para encoding acelerado
- Fallback para CPU (libx264) se GPU não estiver disponível
- Mesmas fórmulas do worker v2.9.0 (zoom dinâmico corrigido)
"""

import subprocess
import requests
import random
import sys
from pathlib import Path
from urllib.parse import quote
from typing import List, Dict

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ============================================
# CONFIGURAÇÃO
# ============================================

# URLs das imagens para testar
IMAGES = [
    "http://minio.automear.com/canais/Sleepless Historian/Por que era RUIM ser um Construtor de Pirâmides no Egito Antigo e mais | História Chata Para Dormir/imagens/temp/imagem_1.jpg",
    "http://minio.automear.com/canais/Sleepless Historian/Por que era RUIM ser um Construtor de Pirâmides no Egito Antigo e mais | História Chata Para Dormir/imagens/temp/imagem_4.jpg",
    "http://minio.automear.com/canais/Sleepless Historian/Por que era RUIM ser um Construtor de Pirâmides no Egito Antigo e mais | História Chata Para Dormir/imagens/temp/imagem_5.jpg",
]

# Tipos de zoom a aplicar (distribuição proporcional aleatória)
# Opções: "zoomin", "zoomout", "zoompanright", "zoompanleft"
ZOOM_TYPES = ["zoompanright"]

# Duração de cada vídeo em segundos
DURACAO = 6.0

# Frame rate
FRAME_RATE = 24

# Diretórios
WORK_DIR = Path("./test_output/work")
OUTPUT_DIR = Path("./test_output/videos")

# ============================================
# FUNÇÕES
# ============================================

def setup_directories():
    """Cria diretórios de trabalho"""
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"✅ Diretórios criados: {WORK_DIR}, {OUTPUT_DIR}")


def normalize_url(url: str) -> str:
    """Normaliza URL para lidar com caracteres UTF-8"""
    from urllib.parse import urlparse, quote

    parsed = urlparse(url)
    # Encode apenas o path, preservando o resto
    encoded_path = quote(parsed.path.encode('utf-8'), safe='/')

    return f"{parsed.scheme}://{parsed.netloc}{encoded_path}"


def download_image(url: str, output_path: Path) -> None:
    """Baixa imagem da URL"""
    print(f"📥 Baixando: {output_path.name}")

    normalized_url = normalize_url(url)
    response = requests.get(normalized_url, stream=True, timeout=60)
    response.raise_for_status()

    with open(output_path, 'wb') as f:
        for chunk in response.iter_content(chunk_size=8192):
            if chunk:
                f.write(chunk)

    file_size = output_path.stat().st_size / 1024
    print(f"✅ Baixado: {output_path.name} ({file_size:.1f} KB)")


def distribute_zoom_types(zoom_types: List[str], image_count: int) -> List[str]:
    """
    Distribui tipos de zoom proporcionalmente e aleatoriamente
    Mesma lógica do worker
    """
    if not zoom_types or image_count == 0:
        return ["zoomin"] * image_count

    types_count = len(zoom_types)
    base_count = image_count // types_count
    remainder = image_count % types_count

    distribution = []
    for i, zoom_type in enumerate(zoom_types):
        count = base_count + (1 if i < remainder else 0)
        distribution.extend([zoom_type] * count)

    random.shuffle(distribution)

    print(f"📊 Distribuição de zoom: {dict(zip(set(distribution), [distribution.count(t) for t in set(distribution)]))}")

    return distribution


def get_image_dimensions(image_path: Path) -> tuple[int, int]:
    """
    Obtém dimensões reais da imagem via ffprobe
    Returns: (width, height)
    """
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            str(image_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, timeout=10)

        if result.returncode == 0:
            import json
            metadata = json.loads(result.stdout)

            # Encontrar stream de vídeo/imagem
            for stream in metadata.get('streams', []):
                if stream.get('codec_type') == 'video':
                    width = int(stream.get('width', 0))
                    height = int(stream.get('height', 0))

                    if width > 0 and height > 0:
                        print(f"📐 Dimensões detectadas: {width}x{height}")
                        return (width, height)

        # Fallback: assumir 1920x1080
        print(f"⚠️ Não foi possível detectar dimensões, usando padrão 1920x1080")
        return (1920, 1080)

    except Exception as e:
        print(f"⚠️ Erro ao detectar dimensões: {e}, usando padrão 1920x1080")
        return (1920, 1080)


def check_gpu_available() -> bool:
    """Verifica se GPU NVIDIA está disponível"""
    try:
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=gpu_name', '--format=csv,noheader'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            gpu_name = result.stdout.strip().split('\n')[0]
            print(f"✅ GPU detectada: {gpu_name}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        print(f"⚠️ GPU não detectada: {e}")

    print("💻 Usando encoding CPU (libx264)")
    return False


def create_video_with_zoom(
    image_path: Path,
    output_path: Path,
    duracao: float,
    frame_rate: int,
    zoom_type: str,
    use_gpu: bool = True
) -> None:
    """
    Cria vídeo com efeito de zoom usando FFmpeg
    Versão robusta com detecção automática de dimensões
    """
    print(f"🎬 Criando vídeo: {output_path.name} (zoom: {zoom_type}, duração: {duracao}s)")

    # Detectar dimensões reais da imagem
    img_width, img_height = get_image_dimensions(image_path)

    # Calcular aspect ratio
    aspect_ratio = img_width / img_height
    target_aspect = 16 / 9  # 1920x1080

    # Determinar dimensões de output (sempre 1920x1080 para vídeo final)
    output_width = 1920
    output_height = 1080

    # Calcular dimensões de upscale
    # Upscale factor: quanto maior, mais suave o movimento (menos jitter)
    # 10x é o sweet spot entre qualidade e performance
    upscale_factor = 10
    upscale_width = output_width * upscale_factor   # 19200px
    upscale_height = output_height * upscale_factor  # 10800px

    # Parâmetros de zoom - Professional anti-jitter
    total_frames = int(frame_rate * duracao)

    print(f"📊 Configuração:")
    print(f"   Imagem original: {img_width}x{img_height} (aspect: {aspect_ratio:.2f})")
    print(f"   Output: {output_width}x{output_height} (aspect: {target_aspect:.2f})")
    print(f"   Upscale: {upscale_width}x{upscale_height} ({upscale_factor}x)")
    print(f"   Frames: {total_frames} ({frame_rate}fps × {duracao}s)")

    # ============================================
    # ZOOM MATHEMATICS - Anti-Jitter Professional
    # ============================================
    #
    # Após upscale, temos:
    # - Canvas: iw × ih (19200 × 10800)
    # - Output: ow × oh (1920 × 1080)
    # - Zoom: z varia de zoom_start até zoom_end
    #
    # Window (janela de visualização) no canvas:
    # - Width:  ow/z  (varia com zoom, ex: 1920 → 1536)
    # - Height: oh/z  (varia com zoom, ex: 1080 → 864)
    #
    # Posição x máxima (borda direita):
    # - x_max = iw - ow/z  (garante janela sempre dentro do canvas)
    #
    # Posição y centrada:
    # - y_center = (ih - oh/z)/2  (centraliza verticalmente)
    #
    # Frame progress:
    # - Linear: on/total_frames  (0.0 → 1.0)
    # - Inverso: (total_frames-on)/total_frames  (1.0 → 0.0)
    # ============================================

    # Zoom range - suave e profissional
    zoom_start = 1.0   # Sem zoom (imagem completa)
    zoom_end = 1.25    # Zoom moderado (25%)
    zoom_diff = zoom_end - zoom_start

    # Define zoom effect based on type
    if zoom_type == "zoomout":
        # ZOOM OUT: Inicia com zoom, termina normal
        # Inverte: começa em 1.25, termina em 1.0
        zoom_formula = f"max({zoom_end}-{zoom_diff}*on/{total_frames},{zoom_start})"

        # Centralizado (x, y no centro do canvas)
        x_formula = "iw/2-(iw/zoom/2)"
        y_formula = "ih/2-(ih/zoom/2)"

        print(f"   Zoom: {zoom_end} → {zoom_start} (zoomout centralizado)")

    elif zoom_type == "zoompanright":
        # ZOOM IN + PAN RIGHT
        # Inicia no canto esquerdo (x=0), termina no canto direito (x=x_max)
        zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"

        # Pan da esquerda para direita
        # x: 0 → (iw - ow/zoom)
        # Movimento linear: progresso × distância_máxima
        # IMPORTANTE: (iw-ow/zoom) é dinâmico, aumenta conforme zoom aumenta
        # Isso funciona porque começamos em 0 (fixo) e vamos para x_max (dinâmico crescente)
        x_formula = f"(iw-ow/zoom)*on/{total_frames}"

        # Centralizado verticalmente (mesma fórmula do zoomin/zoomout que funciona sem jitter)
        y_formula = "ih/2-(ih/zoom/2)"

        print(f"   Zoom: {zoom_start} → {zoom_end} (pan esquerda→direita)")

    elif zoom_type == "zoompanleft":
        # ZOOM IN + PAN LEFT
        # Inicia no canto direito (x=x_max), termina no canto esquerdo (x=0)
        zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"

        # Pan da direita para esquerda
        # CORREÇÃO DEFINITIVA v2.9.2: x_max FIXO baseado no zoom INICIAL
        #
        # PROBLEMA das tentativas anteriores:
        # - (iw-ow/zoom) é dinâmico: muda conforme zoom muda (17280→17664)
        # - x_max aumentando causa movimento para DIREITA no início!
        #
        # SOLUÇÃO:
        # - Usar (iw-ow) FIXO sem divisão por zoom
        # - x_max constante = 17280 (baseado em zoom_start=1.0)
        # - Movimento linear: 17280 → 0 (direita → esquerda)
        #
        # Fórmula: x = (iw-ow)*(total_frames-on)/total_frames
        #
        # Frame 0:   x = 17280*1.0 = 17280, window=1920, x_end=19200 ✓
        # Frame 72:  x = 17280*0.5 = 8640,  window=1707, x_end=10347 ✓
        # Frame 144: x = 17280*0.0 = 0,     window=1536, x_end=1536  ✓
        #
        # Comparação com zoompanright (que funciona):
        # - panright: x_max DINÂMICO OK porque parte de x=0 FIXO
        # - panleft:  x_max deve ser FIXO porque parte de x_max (não pode variar!)
        x_formula = f"(iw-ow)*({total_frames}-on)/{total_frames}"

        # Centralizado verticalmente (mesma fórmula do zoomin/zoomout que funciona sem jitter)
        y_formula = "ih/2-(ih/zoom/2)"

        print(f"   Zoom: {zoom_start} → {zoom_end} (pan direita→esquerda, x_max FIXO)")

    else:  # "zoomin" (default)
        # ZOOM IN: Inicia normal, termina com zoom
        zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"

        # Centralizado (x, y no centro do canvas)
        x_formula = "iw/2-(iw/zoom/2)"
        y_formula = "ih/2-(ih/zoom/2)"

        print(f"   Zoom: {zoom_start} → {zoom_end} (zoomin centralizado)")

    # Calcular valores de exemplo para debug (frame 0 e frame final)
    # Frame 0 (início)
    if zoom_type == "zoomout":
        zoom_inicial = zoom_end
        zoom_final = zoom_start
    else:
        zoom_inicial = zoom_start
        zoom_final = zoom_end

    window_width_inicial = output_width / zoom_inicial
    window_height_inicial = output_height / zoom_inicial
    window_width_final = output_width / zoom_final
    window_height_final = output_height / zoom_final

    print(f"   Window inicial: {window_width_inicial:.0f}x{window_height_inicial:.0f} (zoom={zoom_inicial})")
    print(f"   Window final: {window_width_final:.0f}x{window_height_final:.0f} (zoom={zoom_final})")

    # Calcular coordenadas de exemplo
    if zoom_type == "zoompanright":
        x_inicial = 0
        x_final = upscale_width - window_width_final
        y_center = (upscale_height - window_height_inicial) / 2
        print(f"   Movimento X: {x_inicial:.0f} → {x_final:.0f} (pan right)")
        print(f"   Posição Y: {y_center:.0f} (centralizado fixo)")
    elif zoom_type == "zoompanleft":
        # FIXO: x_max baseado no zoom INICIAL (1.0) - movimento LINEAR
        x_max_fixo = upscale_width - output_width  # iw - ow = 19200 - 1920 = 17280
        x_inicial = x_max_fixo
        x_final = 0
        x_end_inicial = x_inicial + window_width_inicial  # 17280 + 1920 = 19200
        x_end_final = x_final + window_width_final  # 0 + 1536 = 1536
        y_center = (upscale_height - window_height_inicial) / 2

        print(f"   Movimento X: {x_inicial:.0f} → {x_final:.0f} (pan left LINEAR)")
        print(f"   X_END movimento: {x_end_inicial:.0f} → {x_end_final:.0f}")
        print(f"   Posição Y: {y_center:.0f} (centralizado fixo)")
        print(f"   ✅ x_max FIXO: {x_max_fixo:.0f} (NÃO varia com zoom!)")
    else:
        x_center = (upscale_width - window_width_inicial) / 2
        y_center = (upscale_height - window_height_inicial) / 2
        print(f"   Posição X: {x_center:.0f} (centralizado)")
        print(f"   Posição Y: {y_center:.0f} (centralizado)")

    # Video filter with zoom effect
    # Lanczos para upscale (melhor qualidade)
    # Bicubic para downscale final (suavidade)
    video_filter = (
        f"scale={upscale_width}:{upscale_height}:flags=lanczos,"
        f"zoompan=z='{zoom_formula}'"
        f":d={total_frames}"
        f":x='{x_formula}'"
        f":y='{y_formula}'"
        f":s={output_width}x{output_height}"
        f":fps={frame_rate},"
        f"scale={output_width}:{output_height}:flags=bicubic,"
        f"format=yuv420p"
    )

    print(f"🔧 Filtro FFmpeg:")
    print(f"   1. Upscale: {upscale_width}x{upscale_height} (Lanczos)")
    print(f"   2. Zoompan: z={zoom_formula}")
    print(f"              x={x_formula}")
    print(f"              y={y_formula}")
    print(f"   3. Downscale: {output_width}x{output_height} (Bicubic)")
    print(f"   4. Format: yuv420p")

    # FFmpeg command - GPU or CPU encoding based on availability
    if use_gpu:
        print("🎮 Usando encoding GPU (NVENC)")
        cmd = [
            'ffmpeg', '-y',
            '-framerate', str(frame_rate),
            '-loop', '1',
            '-i', str(image_path),
            '-vf', video_filter,
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-tune', 'hq',
            '-rc:v', 'vbr',
            '-cq:v', '23',
            '-b:v', '0',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-t', str(duracao),
            str(output_path)
        ]
    else:
        print("💻 Usando encoding CPU (libx264)")
        cmd = [
            'ffmpeg', '-y',
            '-framerate', str(frame_rate),
            '-loop', '1',
            '-i', str(image_path),
            '-vf', video_filter,
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-t', str(duracao),
            '-pix_fmt', 'yuv420p',
            str(output_path)
        ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        print(f"❌ FFmpeg error: {result.stderr}")
        raise RuntimeError(f"FFmpeg failed: {result.stderr}")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg produced empty output")

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(f"✅ Vídeo criado: {output_path.name} ({file_size_mb:.2f} MB)")


def main():
    """Função principal"""
    print("\n" + "="*60)
    print("🎬 TESTE LOCAL DE ZOOMPAN v2.9.0")
    print("="*60 + "\n")

    # Setup
    setup_directories()

    # Verificar GPU
    gpu_available = check_gpu_available()
    print()

    # Distribuir tipos de zoom
    zoom_distribution = distribute_zoom_types(ZOOM_TYPES, len(IMAGES))

    print(f"\n📋 Configuração:")
    print(f"   Imagens: {len(IMAGES)}")
    print(f"   Zoom types: {ZOOM_TYPES}")
    print(f"   Distribuição: {zoom_distribution}")
    print(f"   Duração: {DURACAO}s @ {FRAME_RATE}fps")
    print(f"   GPU: {'✅ NVENC' if gpu_available else '❌ CPU only'}")
    print()

    # Processar cada imagem
    for i, (url, zoom_type) in enumerate(zip(IMAGES, zoom_distribution), 1):
        print(f"\n--- Imagem {i}/{len(IMAGES)} ---")

        # Download
        image_path = WORK_DIR / f"imagem_{i}.jpg"
        try:
            download_image(url, image_path)
        except Exception as e:
            print(f"❌ Erro ao baixar imagem {i}: {e}")
            continue

        # Criar vídeo
        output_path = OUTPUT_DIR / f"video_{i}_{zoom_type}.mp4"
        try:
            create_video_with_zoom(
                image_path,
                output_path,
                DURACAO,
                FRAME_RATE,
                zoom_type,
                use_gpu=gpu_available
            )
        except Exception as e:
            print(f"❌ Erro ao criar vídeo {i}: {e}")
            continue

        # Cleanup imagem temporária
        image_path.unlink(missing_ok=True)

    print("\n" + "="*60)
    print("✅ TESTE CONCLUÍDO!")
    print(f"📁 Vídeos salvos em: {OUTPUT_DIR.absolute()}")
    print("="*60 + "\n")

    # Listar vídeos criados
    videos = list(OUTPUT_DIR.glob("*.mp4"))
    if videos:
        print("📹 Vídeos gerados:")
        for video in sorted(videos):
            size_mb = video.stat().st_size / (1024 * 1024)
            print(f"   - {video.name} ({size_mb:.2f} MB)")
    else:
        print("⚠️ Nenhum vídeo foi gerado")


if __name__ == "__main__":
    main()
