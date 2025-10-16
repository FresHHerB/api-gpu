/**
 * Caption Generator for ASS Subtitles
 * Generates .ass files for both segments (SRT-based) and highlight (word-level)
 * TypeScript port of Python caption_generator.py for VPS CPU-based processing
 */

import { promises as fs } from 'fs';
import { logger } from '../../shared/utils/logger';

// ============================================
// Types
// ============================================

interface SRTSegment {
  start: number;
  end: number;
  text: string;
}

interface Word {
  word: string;
  start: number;
  end: number;
}

interface Dialogue {
  start: number;
  end: number;
  lines: Word[][];
}

interface SegmentStyle {
  font?: {
    name?: string;
    size?: number;
    bold?: boolean;
  };
  colors?: {
    primary?: string;
    outline?: string;
  };
  border?: {
    style?: number;
    width?: number;
  };
  position?: {
    alignment?: number;
    marginVertical?: number;
  };
  uppercase?: boolean;
}

interface HighlightStyle {
  fonte?: string;
  tamanho_fonte?: number;
  fundo_opacidade?: number;
  fundo_cor_r?: number;
  fundo_cor_g?: number;
  fundo_cor_b?: number;
  fundo_arredondado?: boolean;
  texto_cor_r?: number;
  texto_cor_g?: number;
  texto_cor_b?: number;
  highlight_texto_cor_r?: number;
  highlight_texto_cor_g?: number;
  highlight_texto_cor_b?: number;
  highlight_cor_r?: number;
  highlight_cor_g?: number;
  highlight_cor_b?: number;
  highlight_borda?: number;
  padding_horizontal?: number;
  padding_vertical?: number;
  words_per_line?: number;
  max_lines?: number;
  alignment?: number;
  uppercase?: boolean;
}

// ============================================
// Utility Functions
// ============================================

/**
 * Convert RGB (0-255) to ASS color format (BGR)
 *
 * @param r Red (0-255)
 * @param g Green (0-255)
 * @param b Blue (0-255)
 * @returns String in format &H00BBGGRR&
 */
function rgbToAssColor(r: number, g: number, b: number): string {
  const rHex = r.toString(16).padStart(2, '0').toUpperCase();
  const gHex = g.toString(16).padStart(2, '0').toUpperCase();
  const bHex = b.toString(16).padStart(2, '0').toUpperCase();
  return `&H00${bHex}${gHex}${rHex}&`;
}

/**
 * Convert opacity (0-255) to ASS alpha
 *
 * @param opacity 0 (transparent) to 255 (opaque)
 * @returns String hexadecimal (inverted: FF=transparent, 00=opaque)
 */
function opacityToAssAlpha(opacity: number): string {
  const alpha = 255 - opacity; // Invert: ASS uses 00=opaque, FF=transparent
  return alpha.toString(16).padStart(2, '0').toUpperCase();
}

/**
 * Create ASS background color with opacity
 *
 * @param r Red (0-255)
 * @param g Green (0-255)
 * @param b Blue (0-255)
 * @param opacity 0 (transparent) to 255 (opaque)
 * @returns String in format &HAARRGGBB&
 */
function createAssBgColor(r: number, g: number, b: number, opacity: number): string {
  const alpha = opacityToAssAlpha(opacity);
  const rHex = r.toString(16).padStart(2, '0').toUpperCase();
  const gHex = g.toString(16).padStart(2, '0').toUpperCase();
  const bHex = b.toString(16).padStart(2, '0').toUpperCase();
  return `&H${alpha}${bHex}${gHex}${rHex}&`;
}

/**
 * Format time in seconds to ASS format (H:MM:SS.cc)
 */
function formatAssTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds % 1) * 100);
  return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${centis.toString().padStart(2, '0')}`;
}

/**
 * Parse SRT time format (HH:MM:SS,mmm) to seconds
 */
function parseSrtTime(timeStr: string): number {
  const timePart = timeStr.trim();
  // Format: HH:MM:SS,mmm
  const [h, m, sMs] = timePart.split(':');
  const [s, ms] = sMs.split(',');

  const totalSeconds = parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000.0;
  return totalSeconds;
}

/**
 * Convert hex color (#RRGGBB) to RGB components
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
}

// ============================================
// SRT Parser
// ============================================

/**
 * Parse SRT file content into segments
 *
 * @param srtContent SRT file content
 * @returns List of segments with start, end, text
 */
function parseSrt(srtContent: string): SRTSegment[] {
  const segments: SRTSegment[] = [];
  const blocks = srtContent.trim().split('\n\n');

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) {
      continue;
    }

    // Line 0: index (skip)
    // Line 1: timestamps
    // Line 2+: text

    const timestampLine = lines[1];
    const text = lines.slice(2).join('\n');

    // Parse timestamps: 00:00:10,500 --> 00:00:13,000
    if (timestampLine.includes(' --> ')) {
      const [startStr, endStr] = timestampLine.split(' --> ');
      const start = parseSrtTime(startStr);
      const end = parseSrtTime(endStr);

      segments.push({
        start,
        end,
        text
      });
    }
  }

  logger.info(`[CaptionGenerator] Parsed ${segments.length} segments from SRT`);
  return segments;
}

// ============================================
// Segments Generator (SRT-based)
// ============================================

/**
 * Generate ASS file from SRT with custom styling
 *
 * @param srtPath Path to SRT file
 * @param outputPath Path to output ASS file
 * @param style Style configuration
 */
export async function generateASSFromSRT(
  srtPath: string,
  outputPath: string,
  style: SegmentStyle
): Promise<void> {
  logger.info('[CaptionGenerator] Generating ASS from SRT', { srtPath });

  // Read SRT
  const srtContent = await fs.readFile(srtPath, 'utf-8');
  const segments = parseSrt(srtContent);

  // Extract style parameters
  const fontName = style.font?.name || 'Arial';
  const fontSize = style.font?.size || 36;
  const fontBold = style.font?.bold !== false; // Default true

  const primaryColor = style.colors?.primary || '#FFFFFF';
  const outlineColor = style.colors?.outline || '#000000';

  const borderStyle = style.border?.style || 1;
  const borderWidth = style.border?.width || 3;

  const alignment = style.position?.alignment || 2;
  const marginV = style.position?.marginVertical || 20;

  // Extract uppercase option (default: false)
  const uppercase = style.uppercase ?? false;

  // Convert hex colors to ASS format
  const primaryRgb = hexToRgb(primaryColor);
  const primaryAss = rgbToAssColor(primaryRgb.r, primaryRgb.g, primaryRgb.b);

  const outlineRgb = hexToRgb(outlineColor);
  const outlineAss = rgbToAssColor(outlineRgb.r, outlineRgb.g, outlineRgb.b);

  // Build ASS content
  const assLines = [
    '[Script Info]',
    'Title: Generated Subtitles',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  ];

  // Define style
  const styleLine = [
    'Default',
    fontName,
    fontSize.toString(),
    primaryAss, // PrimaryColour
    primaryAss, // SecondaryColour
    outlineAss, // OutlineColour
    '&H00000000&', // BackColour (black, transparent)
    fontBold ? '-1' : '0', // Bold
    '0', // Italic
    '0', '0', // Underline, StrikeOut
    '100', '100', // ScaleX, ScaleY
    '0', // Spacing
    '0', // Angle
    borderStyle.toString(), // BorderStyle
    borderWidth.toString(), // Outline width
    '0', // Shadow
    alignment.toString(), // Alignment
    '10', // MarginL
    '10', // MarginR
    marginV.toString(), // MarginV
    '1' // Encoding
  ];

  assLines.push('Style: ' + styleLine.join(','));
  assLines.push('');

  // Events
  assLines.push('[Events]');
  assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  // Add dialogues
  for (const seg of segments) {
    const startTime = formatAssTime(seg.start);
    const endTime = formatAssTime(seg.end);
    let text = uppercase ? seg.text.toUpperCase() : seg.text;
    text = text.replace(/\n/g, '\\N'); // ASS line break

    // Force line break after period (except for ellipsis)
    // Protect ellipsis first
    text = text.replace(/\.\.\./g, '<!ELLIPSIS!>');
    text = text.replace(/\. /g, '.\\N');  // Period + space = line break
    text = text.replace(/<!ELLIPSIS!>/g, '...');  // Restore ellipsis

    const dialogueLine = `Dialogue: 0,${startTime},${endTime},Default,,0,0,0,,${text}`;
    assLines.push(dialogueLine);
  }

  // Write ASS file
  await fs.writeFile(outputPath, assLines.join('\n'), 'utf-8');

  logger.info(`[CaptionGenerator] ASS file generated: ${outputPath} (${segments.length} segments)`);
}

// ============================================
// Highlight Generator (Word-level)
// ============================================

/**
 * Load words from JSON file
 */
async function loadWordsJson(jsonPath: string): Promise<Word[]> {
  const content = await fs.readFile(jsonPath, 'utf-8');
  const data = JSON.parse(content);
  return data.words || [];
}

/**
 * Group words into multi-line dialogues
 *
 * @param words List of words with start/end times
 * @param wordsPerLine Maximum words per line (default: 4)
 * @param maxLines Maximum lines per dialogue (default: 2)
 * @returns List of dialogues with grouped words
 */
function groupWordsIntoDialogues(
  words: Word[],
  wordsPerLine: number = 4,
  maxLines: number = 2
): Dialogue[] {
  const WORDS_PER_LINE = wordsPerLine;
  const MAX_LINES = maxLines;
  const MAX_DURATION_PER_LINE = 5.0;

  const dialogues: Dialogue[] = [];
  let currentDialogueLines: Word[][] = [];
  let currentLine: Word[] = [];
  let dialogueStart: number | null = null;
  let lineStart = 0;

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Clean word
    word.word = word.word.trim();

    if (currentLine.length === 0) {
      lineStart = word.start;
    }

    // Set dialogue_start only once per dialogue
    if (dialogueStart === null) {
      dialogueStart = word.start;
    }

    // Add word to current line
    currentLine.push(word);

    // Check line break
    const lineDuration = word.end - lineStart;

    // Force line break if word ends with period (never in middle of line)
    const endsWithPeriod = word.word.trim().endsWith('.');

    const shouldBreakLine = (
      currentLine.length >= WORDS_PER_LINE ||
      lineDuration >= MAX_DURATION_PER_LINE ||
      endsWithPeriod  // Always break after period
    );

    if (shouldBreakLine) {
      currentDialogueLines.push([...currentLine]);
      currentLine = [];

      // Check dialogue break
      if (currentDialogueLines.length >= MAX_LINES) {
        dialogues.push({
          start: dialogueStart,
          end: words[i].end,
          lines: [...currentDialogueLines]
        });
        currentDialogueLines = [];
        dialogueStart = null;
      }
    }
  }

  // Add remaining
  if (currentLine.length > 0) {
    currentDialogueLines.push(currentLine);
  }

  if (currentDialogueLines.length > 0 && dialogueStart !== null) {
    dialogues.push({
      start: dialogueStart,
      end: words[words.length - 1].end,
      lines: currentDialogueLines
    });
  }

  logger.info(`[CaptionGenerator] Grouped ${words.length} words into ${dialogues.length} dialogues`);
  return dialogues;
}

/**
 * Generate ASS file with word-level highlight
 *
 * @param wordsJsonPath Path to words JSON file
 * @param outputPath Path to output ASS file
 * @param style Style configuration
 */
export async function generateASSHighlight(
  wordsJsonPath: string,
  outputPath: string,
  style: HighlightStyle
): Promise<void> {
  logger.info('[CaptionGenerator] Generating highlight ASS from JSON', { wordsJsonPath });

  // Load words
  const words = await loadWordsJson(wordsJsonPath);

  if (words.length === 0) {
    throw new Error('No words found in JSON file');
  }

  // Extract grouping configuration
  const wordsPerLine = style.words_per_line || 4;
  const maxLines = style.max_lines || 2;

  logger.info('[CaptionGenerator] Grouping config', { wordsPerLine, maxLines });

  // Group into dialogues
  const dialogues = groupWordsIntoDialogues(words, wordsPerLine, maxLines);

  // Extract style parameters
  const fontName = style.fonte || 'Arial Black';
  const fontSize = style.tamanho_fonte || 72;

  const bgOpacity = style.fundo_opacidade || 128;
  const bgR = style.fundo_cor_r || 0;
  const bgG = style.fundo_cor_g || 0;
  const bgB = style.fundo_cor_b || 0;
  const bgRounded = style.fundo_arredondado !== false;

  const textR = style.texto_cor_r || 255;
  const textG = style.texto_cor_g || 255;
  const textB = style.texto_cor_b || 255;

  const highlightTextR = style.highlight_texto_cor_r || 255;
  const highlightTextG = style.highlight_texto_cor_g || 255;
  const highlightTextB = style.highlight_texto_cor_b || 0;

  const highlightR = style.highlight_cor_r || 214;
  const highlightG = style.highlight_cor_g || 0;
  const highlightB = style.highlight_cor_b || 0;
  const highlightBorder = style.highlight_borda || 12;

  const paddingH = style.padding_horizontal || 40;
  const paddingV = style.padding_vertical || 80;

  const alignment = style.alignment || 2;

  // Extract uppercase option (default: false)
  const uppercase = style.uppercase ?? false;

  // Convert colors to ASS format
  const textColor = rgbToAssColor(textR, textG, textB);
  const highlightTextColor = rgbToAssColor(highlightTextR, highlightTextG, highlightTextB);
  const highlightColor = rgbToAssColor(highlightR, highlightG, highlightB);
  const bgColor = createAssBgColor(bgR, bgG, bgB, bgOpacity);

  // BorderStyle
  const borderStyle = bgRounded ? '4' : '1';

  // Build ASS content
  const assLines = [
    '[Script Info]',
    'Title: Highlight Subtitles',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'PlayResX: 1920',
    'PlayResY: 1080',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding'
  ];

  // Base style (full text)
  const baseStyle = [
    'Base',
    fontName,
    fontSize.toString(),
    textColor, // PrimaryColour
    textColor, // SecondaryColour
    '&H00000000&', // OutlineColour (black)
    bgColor, // BackColour with opacity
    '-1', // Bold
    '0', // Italic
    '0', '0', // Underline, StrikeOut
    '100', '100', // ScaleX, ScaleY
    '0', // Spacing
    '0', // Angle
    borderStyle, // BorderStyle
    '3', // Outline width
    '0', // Shadow
    alignment.toString(),
    paddingH.toString(),
    paddingH.toString(),
    paddingV.toString(),
    '1' // Encoding
  ];

  // Highlight style (active word)
  const highlightStyle = [
    'Highlight',
    fontName,
    fontSize.toString(),
    textColor, // PrimaryColour
    textColor, // SecondaryColour
    highlightColor, // OutlineColour (highlight color)
    '&H00000000&', // BackColour
    '-1', // Bold
    '0', // Italic
    '0', '0', // Underline, StrikeOut
    '100', '100', // ScaleX, ScaleY
    '0', // Spacing
    '0', // Angle
    '1', // BorderStyle (outline only)
    highlightBorder.toString(), // Outline width
    '0', // Shadow
    alignment.toString(),
    paddingH.toString(),
    paddingH.toString(),
    paddingV.toString(),
    '1' // Encoding
  ];

  assLines.push('Style: ' + baseStyle.join(','));
  assLines.push('Style: ' + highlightStyle.join(','));
  assLines.push('');

  // Events
  assLines.push('[Events]');
  assLines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

  // Generate events for each dialogue
  for (const dialogue of dialogues) {
    // Flatten all words from dialogue
    const allWords: Word[] = [];
    for (const lineWords of dialogue.lines) {
      allWords.push(...lineWords);
    }

    const startTime = formatAssTime(dialogue.start);
    const endTime = formatAssTime(dialogue.end);

    // LAYER 0: Base text (always visible)
    const dialogueTextParts: string[] = [];
    for (const lineWords of dialogue.lines) {
      const lineText = lineWords.map(w => uppercase ? w.word.toUpperCase() : w.word).join(' ');
      dialogueTextParts.push(lineText);
    }

    const fullText = dialogueTextParts.join('\\N');
    const baseLine = `Dialogue: 0,${startTime},${endTime},Base,,0,0,0,,{\\an${alignment}}${fullText}`;
    assLines.push(baseLine);

    // LAYER 2: Highlight (active word)
    for (let activeIdx = 0; activeIdx < allWords.length; activeIdx++) {
      const activeWord = allWords[activeIdx];
      const wordStart = formatAssTime(activeWord.start);
      const wordEnd = formatAssTime(activeWord.end);

      // Build full text with active word highlighted
      const highlightParts: string[] = [];
      let wordIdx = 0;

      for (const lineWords of dialogue.lines) {
        const lineParts: string[] = [];
        for (const word of lineWords) {
          const wordText = uppercase ? word.word.toUpperCase() : word.word;

          if (wordIdx === activeIdx) {
            // Active word: use highlight style with custom text color
            lineParts.push(`{\\r}{\\1c${highlightTextColor}\\3c${highlightColor}\\bord${highlightBorder}}${wordText}`);
          } else {
            // Inactive word: invisible
            lineParts.push(`{\\alpha&HFF&}${wordText}`);
          }

          wordIdx++;
        }

        highlightParts.push(lineParts.join(' '));
      }

      const highlightText = highlightParts.join('\\N');
      const highlightLine = `Dialogue: 2,${wordStart},${wordEnd},Highlight,,0,0,0,,{\\an${alignment}}${highlightText}`;
      assLines.push(highlightLine);
    }
  }

  // Write ASS file
  await fs.writeFile(outputPath, assLines.join('\n'), 'utf-8');

  logger.info(`[CaptionGenerator] Highlight ASS file generated: ${outputPath} (${dialogues.length} dialogues)`);
}
