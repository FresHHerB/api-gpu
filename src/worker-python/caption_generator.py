"""
Caption Generator for ASS Subtitles
Generates .ass files for both segments (SRT-based) and highlight (word-level)
"""

import json
import logging
from typing import Dict, List, Any
from pathlib import Path

logger = logging.getLogger(__name__)

# ============================================
# Utility Functions
# ============================================

def rgb_to_ass_color(r: int, g: int, b: int) -> str:
    """
    Convert RGB (0-255) to ASS color format (BGR)

    Args:
        r: Red (0-255)
        g: Green (0-255)
        b: Blue (0-255)

    Returns:
        String in format &H00BBGGRR&
    """
    return f"&H00{b:02X}{g:02X}{r:02X}&"


def opacity_to_ass_alpha(opacity: int) -> str:
    """
    Convert opacity (0-255) to ASS alpha

    Args:
        opacity: 0 (transparent) to 255 (opaque)

    Returns:
        String hexadecimal (inverted: FF=transparent, 00=opaque)
    """
    alpha = 255 - opacity  # Invert: ASS uses 00=opaque, FF=transparent
    return f"{alpha:02X}"


def create_ass_bg_color(r: int, g: int, b: int, opacity: int) -> str:
    """
    Create ASS background color with opacity

    Args:
        r: Red (0-255)
        g: Green (0-255)
        b: Blue (0-255)
        opacity: 0 (transparent) to 255 (opaque)

    Returns:
        String in format &HAARRGGBB&
    """
    alpha = opacity_to_ass_alpha(opacity)
    return f"&H{alpha}{b:02X}{g:02X}{r:02X}&"


def format_ass_time(seconds: float) -> str:
    """Format time in seconds to ASS format (H:MM:SS.cc)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int((seconds % 1) * 100)
    return f"{hours}:{minutes:02d}:{secs:02d}.{centis:02d}"


def parse_srt_time(time_str: str) -> float:
    """Parse SRT time format (HH:MM:SS,mmm) to seconds"""
    time_part = time_str.strip()
    # Format: HH:MM:SS,mmm
    h, m, s_ms = time_part.split(':')
    s, ms = s_ms.split(',')

    total_seconds = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000.0
    return total_seconds


# ============================================
# SRT Parser
# ============================================

def parse_srt(srt_content: str) -> List[Dict[str, Any]]:
    """
    Parse SRT file content into segments

    Returns:
        List of dicts with 'start', 'end', 'text'
    """
    segments = []
    blocks = srt_content.strip().split('\n\n')

    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) < 3:
            continue

        # Line 0: index (skip)
        # Line 1: timestamps
        # Line 2+: text

        timestamp_line = lines[1]
        text = '\n'.join(lines[2:])

        # Parse timestamps: 00:00:10,500 --> 00:00:13,000
        if ' --> ' in timestamp_line:
            start_str, end_str = timestamp_line.split(' --> ')
            start = parse_srt_time(start_str)
            end = parse_srt_time(end_str)

            segments.append({
                'start': start,
                'end': end,
                'text': text
            })

    logger.info(f"Parsed {len(segments)} segments from SRT")
    return segments


# ============================================
# Segments Generator (SRT-based)
# ============================================

def generate_ass_from_srt(
    srt_path: Path,
    output_path: Path,
    style: Dict[str, Any]
) -> None:
    """
    Generate ASS file from SRT with custom styling

    Args:
        srt_path: Path to SRT file
        output_path: Path to output ASS file
        style: Style configuration dict
    """
    logger.info(f"Generating ASS from SRT: {srt_path}")

    # Read SRT
    with open(srt_path, 'r', encoding='utf-8') as f:
        srt_content = f.read()

    segments = parse_srt(srt_content)

    # Extract style parameters
    font_name = style.get('font', {}).get('name', 'Arial')
    font_size = style.get('font', {}).get('size', 36)
    font_bold = style.get('font', {}).get('bold', True)

    primary_color = style.get('colors', {}).get('primary', '#FFFFFF')
    outline_color = style.get('colors', {}).get('outline', '#000000')

    border_style = style.get('border', {}).get('style', 1)
    border_width = style.get('border', {}).get('width', 3)

    alignment = style.get('position', {}).get('alignment', 2)
    margin_v = style.get('position', {}).get('marginVertical', 20)

    # Convert hex colors to ASS format
    primary_r = int(primary_color[1:3], 16)
    primary_g = int(primary_color[3:5], 16)
    primary_b = int(primary_color[5:7], 16)
    primary_ass = rgb_to_ass_color(primary_r, primary_g, primary_b)

    outline_r = int(outline_color[1:3], 16)
    outline_g = int(outline_color[3:5], 16)
    outline_b = int(outline_color[5:7], 16)
    outline_ass = rgb_to_ass_color(outline_r, outline_g, outline_b)

    # Build ASS content
    ass_lines = [
        "[Script Info]",
        "Title: Generated Subtitles",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]

    # Define style
    style_line = [
        "Default",
        font_name,
        str(font_size),
        primary_ass,  # PrimaryColour
        primary_ass,  # SecondaryColour
        outline_ass,  # OutlineColour
        "&H00000000&",  # BackColour (black, transparent)
        "-1" if font_bold else "0",  # Bold
        "0",  # Italic
        "0", "0",  # Underline, StrikeOut
        "100", "100",  # ScaleX, ScaleY
        "0",  # Spacing
        "0",  # Angle
        str(border_style),  # BorderStyle
        str(border_width),  # Outline width
        "0",  # Shadow
        str(alignment),  # Alignment
        "10",  # MarginL
        "10",  # MarginR
        str(margin_v),  # MarginV
        "1"  # Encoding
    ]

    ass_lines.append("Style: " + ",".join(style_line))
    ass_lines.append("")

    # Events
    ass_lines.extend([
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ])

    # Add dialogues
    for seg in segments:
        start_time = format_ass_time(seg['start'])
        end_time = format_ass_time(seg['end'])
        text = seg['text'].replace('\n', '\\N')  # ASS line break

        dialogue_line = f"Dialogue: 0,{start_time},{end_time},Default,,0,0,0,,{text}"
        ass_lines.append(dialogue_line)

    # Write ASS file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(ass_lines))

    logger.info(f"ASS file generated: {output_path} ({len(segments)} segments)")


# ============================================
# Highlight Generator (Word-level)
# ============================================

def load_words_json(json_path: Path) -> List[Dict]:
    """Load words from JSON file"""
    with open(json_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data.get('words', [])


def group_words_into_dialogues(
    words: List[Dict],
    words_per_line: int = 4,
    max_lines: int = 2
) -> List[Dict]:
    """
    Group words into multi-line dialogues

    Args:
        words: List of word dicts with 'word', 'start', 'end'
        words_per_line: Maximum words per line (default: 4)
        max_lines: Maximum lines per dialogue (default: 2)

    Returns:
        List of dicts with 'start', 'end', 'lines'
    """
    WORDS_PER_LINE = words_per_line
    MAX_LINES = max_lines
    MAX_DURATION_PER_LINE = 5.0

    dialogues = []
    current_dialogue_lines = []
    current_line = []
    dialogue_start = None
    line_start = 0

    for i, word in enumerate(words):
        # Clean word
        word['word'] = word['word'].strip()

        if not current_line:
            line_start = word['start']

        # Set dialogue_start only once per dialogue
        if dialogue_start is None:
            dialogue_start = word['start']

        # Add word to current line
        current_line.append(word)

        # Check line break
        line_duration = word['end'] - line_start
        should_break_line = (
            len(current_line) >= WORDS_PER_LINE or
            line_duration >= MAX_DURATION_PER_LINE
        )

        if should_break_line:
            current_dialogue_lines.append(current_line.copy())
            current_line = []

            # Check dialogue break
            if len(current_dialogue_lines) >= MAX_LINES:
                dialogues.append({
                    'start': dialogue_start,
                    'end': words[i]['end'],
                    'lines': current_dialogue_lines.copy()
                })
                current_dialogue_lines = []
                dialogue_start = None

    # Add remaining
    if current_line:
        current_dialogue_lines.append(current_line)

    if current_dialogue_lines:
        dialogues.append({
            'start': dialogue_start,
            'end': words[-1]['end'],
            'lines': current_dialogue_lines
        })

    logger.info(f"Grouped {len(words)} words into {len(dialogues)} dialogues")
    return dialogues


def generate_ass_highlight(
    words_json_path: Path,
    output_path: Path,
    style: Dict[str, Any]
) -> None:
    """
    Generate ASS file with word-level highlight

    Args:
        words_json_path: Path to words JSON file
        output_path: Path to output ASS file
        style: Style configuration dict
    """
    logger.info(f"Generating highlight ASS from JSON: {words_json_path}")

    # Load words
    words = load_words_json(words_json_path)

    if not words:
        raise ValueError("No words found in JSON file")

    # Extract grouping configuration
    words_per_line = style.get('words_per_line', 4)
    max_lines = style.get('max_lines', 2)

    logger.info(f"Grouping config: words_per_line={words_per_line}, max_lines={max_lines}")

    # Group into dialogues
    dialogues = group_words_into_dialogues(words, words_per_line, max_lines)

    # Extract style parameters
    font_name = style.get('fonte', 'Arial Black')
    font_size = style.get('tamanho_fonte', 72)

    bg_opacity = style.get('fundo_opacidade', 128)
    bg_r = style.get('fundo_cor_r', 0)
    bg_g = style.get('fundo_cor_g', 0)
    bg_b = style.get('fundo_cor_b', 0)
    bg_rounded = style.get('fundo_arredondado', True)

    text_r = style.get('texto_cor_r', 255)
    text_g = style.get('texto_cor_g', 255)
    text_b = style.get('texto_cor_b', 255)

    highlight_r = style.get('highlight_cor_r', 214)
    highlight_g = style.get('highlight_cor_g', 0)
    highlight_b = style.get('highlight_cor_b', 0)
    highlight_border = style.get('highlight_borda', 12)

    padding_h = style.get('padding_horizontal', 40)
    padding_v = style.get('padding_vertical', 80)

    alignment = style.get('alignment', 2)

    # Convert colors to ASS format
    text_color = rgb_to_ass_color(text_r, text_g, text_b)
    highlight_color = rgb_to_ass_color(highlight_r, highlight_g, highlight_b)
    bg_color = create_ass_bg_color(bg_r, bg_g, bg_b, bg_opacity)

    # BorderStyle
    border_style = "4" if bg_rounded else "1"

    # Build ASS content
    ass_lines = [
        "[Script Info]",
        "Title: Highlight Subtitles",
        "ScriptType: v4.00+",
        "WrapStyle: 0",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ]

    # Base style (full text)
    base_style = [
        "Base",
        font_name,
        str(font_size),
        text_color,  # PrimaryColour
        text_color,  # SecondaryColour
        "&H00000000&",  # OutlineColour (black)
        bg_color,  # BackColour with opacity
        "-1",  # Bold
        "0",  # Italic
        "0", "0",  # Underline, StrikeOut
        "100", "100",  # ScaleX, ScaleY
        "0",  # Spacing
        "0",  # Angle
        border_style,  # BorderStyle
        "3",  # Outline width
        "0",  # Shadow
        str(alignment),
        str(padding_h),
        str(padding_h),
        str(padding_v),
        "1"  # Encoding
    ]

    # Highlight style (active word)
    highlight_style = [
        "Highlight",
        font_name,
        str(font_size),
        text_color,  # PrimaryColour
        text_color,  # SecondaryColour
        highlight_color,  # OutlineColour (highlight color)
        "&H00000000&",  # BackColour
        "-1",  # Bold
        "0",  # Italic
        "0", "0",  # Underline, StrikeOut
        "100", "100",  # ScaleX, ScaleY
        "0",  # Spacing
        "0",  # Angle
        "1",  # BorderStyle (outline only)
        str(highlight_border),  # Outline width
        "0",  # Shadow
        str(alignment),
        str(padding_h),
        str(padding_h),
        str(padding_v),
        "1"  # Encoding
    ]

    ass_lines.append("Style: " + ",".join(base_style))
    ass_lines.append("Style: " + ",".join(highlight_style))
    ass_lines.append("")

    # Events
    ass_lines.extend([
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
    ])

    # Generate events for each dialogue
    UPPERCASE = True

    for dialogue in dialogues:
        # Flatten all words from dialogue
        all_words = []
        for line_words in dialogue['lines']:
            all_words.extend(line_words)

        start_time = format_ass_time(dialogue['start'])
        end_time = format_ass_time(dialogue['end'])

        # LAYER 0: Base text (always visible)
        dialogue_text_parts = []
        for line_words in dialogue['lines']:
            line_text = " ".join([
                w['word'].upper() if UPPERCASE else w['word']
                for w in line_words
            ])
            dialogue_text_parts.append(line_text)

        full_text = "\\N".join(dialogue_text_parts)

        base_line = f"Dialogue: 0,{start_time},{end_time},Base,,0,0,0,,{{\\an{alignment}}}{full_text}"
        ass_lines.append(base_line)

        # LAYER 2: Highlight (active word)
        for active_idx, active_word in enumerate(all_words):
            word_start = format_ass_time(active_word['start'])
            word_end = format_ass_time(active_word['end'])

            # Build full text with active word highlighted
            highlight_parts = []
            word_idx = 0

            for line_words in dialogue['lines']:
                line_parts = []
                for word in line_words:
                    word_text = word['word'].upper() if UPPERCASE else word['word']

                    if word_idx == active_idx:
                        # Active word: use highlight style
                        line_parts.append(f"{{\\r}}{{\\1c{text_color}\\3c{highlight_color}\\bord{highlight_border}}}{word_text}")
                    else:
                        # Inactive word: invisible
                        line_parts.append(f"{{\\alpha&HFF&}}{word_text}")

                    word_idx += 1

                highlight_parts.append(" ".join(line_parts))

            highlight_text = "\\N".join(highlight_parts)

            highlight_line = f"Dialogue: 2,{word_start},{word_end},Highlight,,0,0,0,,{{\\an{alignment}}}{highlight_text}"
            ass_lines.append(highlight_line)

    # Write ASS file
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(ass_lines))

    logger.info(f"Highlight ASS file generated: {output_path} ({len(dialogues)} dialogues)")
