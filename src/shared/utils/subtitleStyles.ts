// ============================================
// Subtitle Style Utilities
// Convert HTML colors to ASS format and build force_style string
// ============================================

import { SubtitleStyle } from '../types';

/**
 * Convert HTML hex color (#RRGGBB) to ASS hex format (&HAABBGGRR)
 * @param htmlColor - HTML hex color (e.g., "#FFFFFF")
 * @param alpha - Alpha value 0-255 (0=opaque, 255=transparent)
 * @returns ASS hex color (e.g., "&H00FFFFFF")
 */
export function htmlColorToASS(htmlColor: string, alpha: number = 0): string {
  // Remove # prefix
  const hex = htmlColor.replace('#', '');

  // Extract RGB components
  const r = hex.substring(0, 2);
  const g = hex.substring(2, 4);
  const b = hex.substring(4, 6);

  // Convert alpha to hex (2 digits)
  const alphaHex = alpha.toString(16).padStart(2, '0').toUpperCase();

  // ASS format: &HAABBGGRR (alpha inverted: 00=opaque, FF=transparent)
  return `&H${alphaHex}${b}${g}${r}`.toUpperCase();
}

/**
 * Build force_style string from SubtitleStyle object
 * @param style - SubtitleStyle object
 * @returns force_style string for FFmpeg
 */
export function buildForceStyleString(style?: SubtitleStyle): string {
  // Default Netflix-like style
  const defaults = {
    font: {
      name: 'Arial',
      size: 24,
      bold: true,
      italic: false,
      underline: false
    },
    colors: {
      primary: '#FFFFFF',
      primaryAlpha: 0,
      outline: '#000000',
      outlineAlpha: 0,
      background: '#000000',
      backgroundAlpha: 128
    },
    border: {
      style: 1,
      width: 2,
      shadow: 1
    },
    position: {
      alignment: 2,
      marginVertical: 25,
      marginLeft: 10,
      marginRight: 10
    }
  };

  // Merge with provided style
  const merged = {
    font: { ...defaults.font, ...style?.font },
    colors: { ...defaults.colors, ...style?.colors },
    border: { ...defaults.border, ...style?.border },
    position: { ...defaults.position, ...style?.position }
  };

  // Build ASS style parameters
  const params: string[] = [];

  // Font
  if (merged.font.name) {
    params.push(`FontName=${merged.font.name}`);
  }
  if (merged.font.size !== undefined) {
    params.push(`Fontsize=${merged.font.size}`);
  }
  if (merged.font.bold) {
    params.push(`Bold=1`);
  }
  if (merged.font.italic) {
    params.push(`Italic=1`);
  }
  if (merged.font.underline) {
    params.push(`Underline=1`);
  }

  // Colors (convert HTML to ASS format)
  if (merged.colors.primary) {
    const primaryColor = htmlColorToASS(merged.colors.primary, merged.colors.primaryAlpha ?? 0);
    params.push(`PrimaryColour=${primaryColor}`);
  }
  if (merged.colors.outline) {
    const outlineColor = htmlColorToASS(merged.colors.outline, merged.colors.outlineAlpha ?? 0);
    params.push(`OutlineColour=${outlineColor}`);
  }
  if (merged.colors.background) {
    const backColor = htmlColorToASS(merged.colors.background, merged.colors.backgroundAlpha ?? 128);
    params.push(`BackColour=${backColor}`);
  }

  // Border
  if (merged.border.style !== undefined) {
    params.push(`BorderStyle=${merged.border.style}`);
  }
  if (merged.border.width !== undefined) {
    params.push(`Outline=${merged.border.width}`);
  }
  if (merged.border.shadow !== undefined) {
    params.push(`Shadow=${merged.border.shadow}`);
  }

  // Position
  if (merged.position.alignment !== undefined) {
    params.push(`Alignment=${merged.position.alignment}`);
  }
  if (merged.position.marginVertical !== undefined) {
    params.push(`MarginV=${merged.position.marginVertical}`);
  }
  if (merged.position.marginLeft !== undefined) {
    params.push(`MarginL=${merged.position.marginLeft}`);
  }
  if (merged.position.marginRight !== undefined) {
    params.push(`MarginR=${merged.position.marginRight}`);
  }

  return params.join(',');
}

/**
 * Validate HTML hex color format
 * @param color - Color string to validate
 * @returns true if valid HTML hex color
 */
export function isValidHtmlColor(color: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(color);
}

/**
 * Get default subtitle style (Netflix-like)
 * @returns Default SubtitleStyle object
 */
export function getDefaultSubtitleStyle(): SubtitleStyle {
  return {
    font: {
      name: 'Arial',
      size: 24,
      bold: true,
      italic: false,
      underline: false
    },
    colors: {
      primary: '#FFFFFF',
      primaryAlpha: 0,
      outline: '#000000',
      outlineAlpha: 0,
      background: '#000000',
      backgroundAlpha: 128
    },
    border: {
      style: 1,
      width: 2,
      shadow: 1
    },
    position: {
      alignment: 2,
      marginVertical: 25,
      marginLeft: 10,
      marginRight: 10
    }
  };
}
