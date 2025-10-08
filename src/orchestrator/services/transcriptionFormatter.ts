import { TranscriptionSegment, TranscriptionWord } from '../../shared/types';

// ============================================
// Transcription Formatter Service
// Converts transcription data to various subtitle formats
// ============================================

export class TranscriptionFormatter {
  /**
   * Convert segments to SRT format
   * SRT: Standard subtitle format for traditional subtitles
   */
  static toSRT(segments: TranscriptionSegment[]): string {
    const lines: string[] = [];

    segments.forEach((segment, index) => {
      // SRT index (1-based)
      lines.push(`${index + 1}`);

      // Timestamps: 00:00:00,000 --> 00:00:05,000
      const startTime = this.formatSRTTime(segment.start);
      const endTime = this.formatSRTTime(segment.end);
      lines.push(`${startTime} --> ${endTime}`);

      // Text content
      lines.push(segment.text.trim());

      // Blank line separator
      lines.push('');
    });

    return lines.join('\n');
  }

  /**
   * Convert word timestamps to ASS karaoke format
   * ASS: Advanced SubStation Alpha with karaoke timing
   */
  static toASSKaraoke(words: TranscriptionWord[]): string {
    const lines: string[] = [];

    // ASS Header
    lines.push('[Script Info]');
    lines.push('Title: Karaoke Subtitles');
    lines.push('ScriptType: v4.00+');
    lines.push('WrapStyle: 0');
    lines.push('PlayResX: 1920');
    lines.push('PlayResY: 1080');
    lines.push('ScaledBorderAndShadow: yes');
    lines.push('');

    // Style definition
    lines.push('[V4+ Styles]');
    lines.push('Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding');
    lines.push('Style: Karaoke,Arial,48,&H00FFFFFF,&H000088EF,&H00000000,&H00666666,-1,0,0,0,100,100,0,0,1,2,1,2,10,10,25,1');
    lines.push('');

    // Events section
    lines.push('[Events]');
    lines.push('Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text');

    // Group words into dialogue lines (max ~10 words or 5 seconds per line)
    const dialogues = this.groupWordsIntoDialogues(words);

    dialogues.forEach(dialogue => {
      const startTime = this.formatASSTime(dialogue.start);
      const endTime = this.formatASSTime(dialogue.end);
      const karaokeText = this.buildKaraokeText(dialogue.words);

      lines.push(`Dialogue: 0,${startTime},${endTime},Karaoke,,0,0,0,,${karaokeText}`);
    });

    return lines.join('\n');
  }

  /**
   * Group words into dialogue lines for ASS
   */
  private static groupWordsIntoDialogues(words: TranscriptionWord[]): Array<{
    start: number;
    end: number;
    words: TranscriptionWord[];
  }> {
    const dialogues: Array<{ start: number; end: number; words: TranscriptionWord[] }> = [];
    let currentDialogue: TranscriptionWord[] = [];
    let dialogueStart = 0;

    words.forEach((word, index) => {
      if (currentDialogue.length === 0) {
        dialogueStart = word.start;
      }

      currentDialogue.push(word);

      // Create new dialogue if:
      // - Reached 10 words
      // - Duration exceeds 5 seconds
      // - Last word
      const duration = word.end - dialogueStart;
      const shouldBreak =
        currentDialogue.length >= 10 ||
        duration >= 5 ||
        index === words.length - 1;

      if (shouldBreak) {
        dialogues.push({
          start: dialogueStart,
          end: word.end,
          words: [...currentDialogue]
        });
        currentDialogue = [];
      }
    });

    return dialogues;
  }

  /**
   * Build karaoke text with \k tags
   * Format: {\k100}word1{\k50}word2
   */
  private static buildKaraokeText(words: TranscriptionWord[]): string {
    const parts: string[] = [];

    words.forEach((word, index) => {
      // Calculate duration in centiseconds (1/100 second)
      const durationCs = Math.round((word.end - word.start) * 100);

      // Add karaoke timing tag before word
      parts.push(`{\\k${durationCs}}${word.word}`);

      // Add space between words (except last word)
      if (index < words.length - 1) {
        parts.push(' ');
      }
    });

    return parts.join('');
  }

  /**
   * Format time for SRT: 00:00:00,000
   */
  private static formatSRTTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const millis = Math.round((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
  }

  /**
   * Format time for ASS: 0:00:00.00
   */
  private static formatASSTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const centis = Math.round((seconds % 1) * 100);

    return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
  }

  /**
   * Convert to JSON format (already in correct format from RunPod)
   */
  static toJSON(data: any): string {
    return JSON.stringify(data, null, 2);
  }
}
