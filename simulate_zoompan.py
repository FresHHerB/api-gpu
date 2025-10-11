"""
Script de simulação de coordenadas zoompan
Simula frame a frame para identificar problemas de movimento
"""

import sys

# Fix Windows console encoding for emojis
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# Configurações
DURACAO = 6.0
FRAME_RATE = 24
TOTAL_FRAMES = int(FRAME_RATE * DURACAO)  # 144

# Dimensões após upscale
IW = 19200  # input width após 10x upscale
IH = 10800  # input height após 10x upscale
OW = 1920   # output width
OH = 1080   # output height

# Zoom range
ZOOM_START = 1.0
ZOOM_END = 1.25
ZOOM_DIFF = ZOOM_END - ZOOM_START


def simulate_zoompanright(frames_to_show):
    """Simula zoompanright frame a frame"""
    print("\n" + "="*80)
    print("🎬 SIMULAÇÃO: zoompanright")
    print("="*80)
    print(f"Fórmula X: (iw-ow/zoom)*on/{TOTAL_FRAMES}")
    print(f"Fórmula Y: ih/2-(ih/zoom/2)")
    print(f"Fórmula Z: min({ZOOM_START}+{ZOOM_DIFF}*on/{TOTAL_FRAMES},{ZOOM_END})")
    print()

    for on in frames_to_show:
        # Calcular zoom
        progress = on / TOTAL_FRAMES
        zoom = min(ZOOM_START + ZOOM_DIFF * progress, ZOOM_END)

        # Calcular window size
        window_w = OW / zoom
        window_h = OH / zoom

        # Calcular x (fórmula atual)
        x_max = IW - window_w
        x = x_max * progress

        # Calcular y
        y = (IH - window_h) / 2

        # Janela (retângulo que será mostrado)
        x_end = x + window_w
        y_end = y + window_h

        # Verificar se está dentro da imagem
        out_of_bounds = ""
        if x < 0:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x < 0)"
        if x_end > IW:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x_end > {IW})"

        # Calcular posição visual aproximada
        pos_percent = (x / IW) * 100

        print(f"Frame {on:3d}/{TOTAL_FRAMES}:")
        print(f"  Zoom: {zoom:.4f}  |  Window: {window_w:.0f}x{window_h:.0f}")
        print(f"  x_max: {x_max:.0f}  |  progress: {progress:.4f}")
        print(f"  X: {x:.0f}  →  {x_end:.0f}  (posição: {pos_percent:.1f}%){out_of_bounds}")
        print(f"  Y: {y:.0f}  →  {y_end:.0f}  (centralizado)")
        print()


def simulate_zoompanleft_current(frames_to_show):
    """Simula zoompanleft com fórmula ATUAL (potencialmente errada)"""
    print("\n" + "="*80)
    print("🎬 SIMULAÇÃO: zoompanleft (FÓRMULA ATUAL)")
    print("="*80)
    print(f"Fórmula X: (iw-ow)*(144-on)/144")
    print(f"Fórmula Y: ih/2-(ih/zoom/2)")
    print(f"Fórmula Z: min({ZOOM_START}+{ZOOM_DIFF}*on/{TOTAL_FRAMES},{ZOOM_END})")
    print()

    x_max_fixo = IW - OW  # 17280

    for on in frames_to_show:
        # Calcular zoom
        progress = on / TOTAL_FRAMES
        zoom = min(ZOOM_START + ZOOM_DIFF * progress, ZOOM_END)

        # Calcular window size
        window_w = OW / zoom
        window_h = OH / zoom

        # Calcular x (fórmula atual - FIXO)
        inverse_progress = (TOTAL_FRAMES - on) / TOTAL_FRAMES
        x = x_max_fixo * inverse_progress

        # Calcular y
        y = (IH - window_h) / 2

        # Janela (retângulo que será mostrado)
        x_end = x + window_w
        y_end = y + window_h

        # Verificar se está dentro da imagem
        out_of_bounds = ""
        if x < 0:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x < 0)"
        if x_end > IW:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x_end={x_end:.0f} > {IW})"

        # Calcular movimento relativo ao frame anterior
        if on > 0:
            # Calcular posição do frame anterior
            prev_progress = (on - 1) / TOTAL_FRAMES
            prev_zoom = min(ZOOM_START + ZOOM_DIFF * prev_progress, ZOOM_END)
            prev_window_w = OW / prev_zoom
            prev_inverse_progress = (TOTAL_FRAMES - (on - 1)) / TOTAL_FRAMES
            prev_x = x_max_fixo * prev_inverse_progress
            prev_x_end = prev_x + prev_window_w

            # Delta em relação ao frame anterior
            delta_x = x - prev_x
            delta_x_end = x_end - prev_x_end
            direction = "→ DIREITA" if delta_x > 0 else "← ESQUERDA" if delta_x < 0 else "- PARADO"
        else:
            delta_x = 0
            delta_x_end = 0
            direction = "- INÍCIO"

        # Calcular posição visual aproximada
        pos_percent = (x / IW) * 100

        print(f"Frame {on:3d}/{TOTAL_FRAMES}:")
        print(f"  Zoom: {zoom:.4f}  |  Window: {window_w:.0f}x{window_h:.0f}")
        print(f"  x_max_fixo: {x_max_fixo:.0f}  |  inv_progress: {inverse_progress:.4f}")
        print(f"  X: {x:.0f}  →  {x_end:.0f}  (posição: {pos_percent:.1f}%){out_of_bounds}")
        print(f"  Y: {y:.0f}  →  {y_end:.0f}  (centralizado)")
        print(f"  Δx: {delta_x:+.0f}  |  Δx_end: {delta_x_end:+.0f}  |  {direction}")
        print()


def simulate_zoompanleft_alternative(frames_to_show):
    """Simula zoompanleft com fórmula NOVA (borda direita colada)"""
    print("\n" + "="*80)
    print("🎬 SIMULAÇÃO: zoompanleft (FÓRMULA v2 - iw-ow/zoom)")
    print("="*80)
    print(f"Fórmula X: iw-ow/zoom-(iw-ow)*on/{TOTAL_FRAMES}")
    print(f"          = Mantém x_end colado na borda direita enquanto possível")
    print(f"Fórmula Y: ih/2-(ih/zoom/2)")
    print(f"Fórmula Z: min({ZOOM_START}+{ZOOM_DIFF}*on/{TOTAL_FRAMES},{ZOOM_END})")
    print()

    x_max_inicial = IW - OW  # 17280

    for on in frames_to_show:
        # Calcular zoom
        progress = on / TOTAL_FRAMES
        zoom = min(ZOOM_START + ZOOM_DIFF * progress, ZOOM_END)

        # Calcular window size
        window_w = OW / zoom
        window_h = OH / zoom

        # Calcular x (fórmula NOVA)
        # x = iw - ow/zoom - (iw-ow)*on/total_frames
        # Parte 1: iw - ow/zoom = posição para x_end=iw (borda direita)
        # Parte 2: (iw-ow)*on/total_frames = movimento linear para esquerda
        x = IW - window_w - (x_max_inicial * progress)

        # Calcular y
        y = (IH - window_h) / 2

        # Janela (retângulo que será mostrado)
        x_end = x + window_w
        y_end = y + window_h

        # Verificar se está dentro da imagem
        out_of_bounds = ""
        if x < 0:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x={x:.0f} < 0)"
        if x_end > IW:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x_end={x_end:.0f} > {IW})"

        # Marcar se x_end está na borda direita
        borda_direita = ""
        if abs(x_end - IW) < 1:  # tolerance de 1px
            borda_direita = " 🎯 BORDA DIREITA"

        # Calcular movimento relativo ao frame anterior
        if on > 0:
            prev_progress = (on - 1) / TOTAL_FRAMES
            prev_zoom = min(ZOOM_START + ZOOM_DIFF * prev_progress, ZOOM_END)
            prev_window_w = OW / prev_zoom
            prev_x = IW - prev_window_w - (x_max_inicial * prev_progress)
            prev_x_end = prev_x + prev_window_w

            delta_x = x - prev_x
            delta_x_end = x_end - prev_x_end
            direction = "→ DIREITA" if delta_x > 0 else "← ESQUERDA" if delta_x < 0 else "- PARADO"

            # Analisar movimento da borda direita
            if delta_x_end > 0:
                direction_end = "x_end vai para DIREITA ⚠️"
            elif delta_x_end < 0:
                direction_end = "x_end vai para ESQUERDA ✓"
            else:
                direction_end = "x_end PARADO"
        else:
            delta_x = 0
            delta_x_end = 0
            direction = "- INÍCIO"
            direction_end = ""

        # Calcular posição visual aproximada
        pos_percent = (x / IW) * 100

        print(f"Frame {on:3d}/{TOTAL_FRAMES}:")
        print(f"  Zoom: {zoom:.4f}  |  Window: {window_w:.0f}x{window_h:.0f}")
        print(f"  progress: {progress:.4f}")
        print(f"  X: {x:.0f}  →  {x_end:.0f}  (posição: {pos_percent:.1f}%){out_of_bounds}{borda_direita}")
        print(f"  Y: {y:.0f}  →  {y_end:.0f}  (centralizado)")
        print(f"  Δx: {delta_x:+.0f}  |  Δx_end: {delta_x_end:+.0f}  |  {direction}")
        if direction_end:
            print(f"  {direction_end}")
        print()


def simulate_zoompanleft_fixed(frames_to_show):
    """Simula zoompanleft com fórmula CORRIGIDA v2.9.2 (x_max FIXO)"""
    print("\n" + "="*80)
    print("🎬 SIMULAÇÃO: zoompanleft (FÓRMULA v2.9.2 - x_max FIXO)")
    print("="*80)
    print(f"Fórmula X: (iw-ow)*({TOTAL_FRAMES}-on)/{TOTAL_FRAMES}")
    print(f"          = x_max FIXO (17280) baseado em zoom_start=1.0")
    print(f"Fórmula Y: ih/2-(ih/zoom/2)")
    print(f"Fórmula Z: min({ZOOM_START}+{ZOOM_DIFF}*on/{TOTAL_FRAMES},{ZOOM_END})")
    print()
    print(f"💡 DIFERENÇA CRÍTICA:")
    print(f"   - ANTES: (iw-ow/zoom) = dinâmico (17280→17664)")
    print(f"   - AGORA: (iw-ow) = FIXO (17280 sempre)")
    print()

    x_max_fixo = IW - OW  # 17280 - FIXO, não muda com zoom!

    for on in frames_to_show:
        # Calcular zoom
        progress = on / TOTAL_FRAMES
        zoom = min(ZOOM_START + ZOOM_DIFF * progress, ZOOM_END)

        # Calcular window size
        window_w = OW / zoom
        window_h = OH / zoom

        # Calcular x (fórmula CORRIGIDA - x_max FIXO)
        inverse_progress = (TOTAL_FRAMES - on) / TOTAL_FRAMES
        x = x_max_fixo * inverse_progress

        # Calcular y
        y = (IH - window_h) / 2

        # Janela (retângulo que será mostrado)
        x_end = x + window_w
        y_end = y + window_h

        # Verificar se está dentro da imagem
        out_of_bounds = ""
        if x < 0:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x={x:.0f} < 0)"
        if x_end > IW:
            out_of_bounds = f" ⚠️ FORA DA IMAGEM (x_end={x_end:.0f} > {IW})"

        # Calcular movimento relativo ao frame anterior
        if on > 0:
            prev_progress = (on - 1) / TOTAL_FRAMES
            prev_zoom = min(ZOOM_START + ZOOM_DIFF * prev_progress, ZOOM_END)
            prev_window_w = OW / prev_zoom
            prev_inverse_progress = (TOTAL_FRAMES - (on - 1)) / TOTAL_FRAMES
            prev_x = x_max_fixo * prev_inverse_progress
            prev_x_end = prev_x + prev_window_w

            delta_x = x - prev_x
            delta_x_end = x_end - prev_x_end
            direction = "→ DIREITA" if delta_x > 0 else "← ESQUERDA" if delta_x < 0 else "- PARADO"
        else:
            delta_x = 0
            delta_x_end = 0
            direction = "- INÍCIO"

        # Calcular posição visual aproximada
        pos_percent = (x / IW) * 100

        print(f"Frame {on:3d}/{TOTAL_FRAMES}:")
        print(f"  Zoom: {zoom:.4f}  |  Window: {window_w:.0f}x{window_h:.0f}")
        print(f"  x_max FIXO: {x_max_fixo:.0f}  |  inv_progress: {inverse_progress:.4f}")
        print(f"  X: {x:.0f}  →  {x_end:.0f}  (posição: {pos_percent:.1f}%){out_of_bounds}")
        print(f"  Y: {y:.0f}  →  {y_end:.0f}  (centralizado)")
        print(f"  Δx: {delta_x:+.0f}  |  Δx_end: {delta_x_end:+.0f}  |  {direction}")
        print()


def main():
    # Frames importantes para analisar
    # Frame 0: início
    # Frame 36: 25% do movimento
    # Frame 72: 50% do movimento
    # Frame 108: 75% do movimento
    # Frame 144: final
    frames_importantes = [0, 36, 72, 108, 144]

    print("\n" + "🔍 ANÁLISE DE COORDENADAS ZOOMPAN v2.9.2")
    print(f"Total frames: {TOTAL_FRAMES}")
    print(f"Dimensões canvas: {IW}x{IH}")
    print(f"Dimensões output: {OW}x{OH}")
    print(f"Zoom: {ZOOM_START} → {ZOOM_END}")

    # Simular zoompanright (referência - funciona corretamente)
    simulate_zoompanright(frames_importantes)

    # Simular zoompanleft com fórmula ATUAL (dinâmica - quebrada)
    simulate_zoompanleft_current(frames_importantes)

    # Simular zoompanleft com fórmula v2 (iw-ow/zoom - ainda problemática)
    simulate_zoompanleft_alternative(frames_importantes)

    # Simular zoompanleft com fórmula v2.9.2 CORRIGIDA (x_max FIXO)
    simulate_zoompanleft_fixed(frames_importantes)

    print("\n" + "="*80)
    print("📊 RESUMO DA ANÁLISE")
    print("="*80)
    print()
    print("✅ zoompanright (FUNCIONA):")
    print("   - Fórmula: (iw-ow/zoom)*on/144")
    print("   - x_max DINÂMICO: 17280 → 17664")
    print("   - Movimento: 0 → 17664 (esquerda → direita)")
    print("   - Funciona porque parte de x=0 FIXO")
    print()
    print("❌ zoompanleft v1 (QUEBRADO):")
    print("   - Fórmula: (iw-ow/zoom)*(144-on)/144")
    print("   - x_max DINÂMICO: muda com zoom")
    print("   - Problema: x_max aumenta enquanto tenta mover para esquerda!")
    print()
    print("❌ zoompanleft v2 (AINDA QUEBRADO):")
    print("   - Fórmula: iw-ow/zoom-(iw-ow)*on/144")
    print("   - Tentativa de colar x_end na borda direita")
    print("   - Problema: ainda usa ow/zoom dinâmico")
    print()
    print("✅ zoompanleft v2.9.2 (CORRIGIDO):")
    print("   - Fórmula: (iw-ow)*(144-on)/144")
    print("   - x_max FIXO: 17280 (baseado em zoom_start=1.0)")
    print("   - Movimento: 17280 → 0 (direita → esquerda)")
    print("   - Todos Δx NEGATIVOS: movimento linear para esquerda ✓")
    print()
    print("🔑 DESCOBERTA CRÍTICA:")
    print("   - zoompanright: x_max dinâmico OK (parte de 0 FIXO)")
    print("   - zoompanleft:  x_max deve ser FIXO (parte de x_max, não pode variar!)")
    print("   - Usar (iw-ow) em vez de (iw-ow/zoom) resolve o problema!")
    print()


if __name__ == "__main__":
    main()
