// ============================================
// YouTube Transcriber Service - Extracts auto-generated captions
// Uses Playwright to scrape YouTube transcripts
// ============================================

import { BrowserContext } from 'playwright';
import { browserPool } from './browser-pool';
import { cacheService, TranscriptCacheEntry } from './cache.service';
import { logger } from '../../../shared/utils/logger';

export interface YouTubeTranscriptResult {
  ok: boolean;
  source: string;
  segments_count?: number;
  transcript_text?: string;
  raw_segments?: string[];
  error?: string;
  cached?: boolean;
  execution_time_ms?: number;
}

export class YouTubeTranscriberService {

  /**
   * Extract transcript from YouTube video (auto-generated captions only)
   */
  async transcribe(videoUrl: string): Promise<YouTubeTranscriptResult> {
    const startTime = Date.now();

    // 1. Validate URL
    if (!this.isValidYouTubeUrl(videoUrl)) {
      logger.warn('⚠️ Invalid YouTube URL', { videoUrl });
      return {
        ok: false,
        source: videoUrl,
        error: 'Invalid YouTube URL. Must be youtube.com/watch?v=... or youtu.be/...'
      };
    }

    // 2. Check cache
    const cached = await cacheService.get(videoUrl);
    if (cached) {
      logger.info('✅ Transcript retrieved from cache', {
        videoUrl,
        segmentsCount: cached.segments_count
      });
      return {
        ...cached,
        cached: true,
        execution_time_ms: Date.now() - startTime
      };
    }

    // 3. Extract transcript using Playwright
    let context: BrowserContext | null = null;

    try {
      logger.info('🎬 Starting YouTube transcript extraction', { videoUrl });

      context = await browserPool.getContext();
      const result = await this.scrapeTranscript(context, videoUrl);

      // 4. Cache successful results
      if (result.ok && result.transcript_text) {
        await cacheService.set(videoUrl, result, 86400); // 24h cache
      }

      const executionTime = Date.now() - startTime;
      logger.info(`✅ Transcript extraction ${result.ok ? 'completed' : 'failed'}`, {
        videoUrl,
        ok: result.ok,
        segmentsCount: result.segments_count,
        executionTimeMs: executionTime
      });

      return {
        ...result,
        execution_time_ms: executionTime
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      logger.error('❌ Transcript extraction error', {
        videoUrl,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTimeMs: executionTime
      });

      return {
        ok: false,
        source: videoUrl,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        execution_time_ms: executionTime
      };

    } finally {
      if (context) {
        await browserPool.releaseContext(context);
      }
    }
  }

  /**
   * Core scraping logic using Playwright
   */
  private async scrapeTranscript(
    context: BrowserContext,
    videoUrl: string
  ): Promise<Omit<YouTubeTranscriptResult, 'execution_time_ms' | 'cached'>> {
    const page = await context.newPage();

    try {
      // 1. Navigate to video
      logger.debug('Navigating to YouTube video...', { videoUrl });
      await page.goto(videoUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // 2. Wait for player to load
      await page.waitForSelector('ytd-watch-flexy', { timeout: 15000 });

      // 3. Handle consent popup (GDPR/cookies)
      try {
        const consentButton = await page.$(
          'button[aria-label*="Aceitar"], button[aria-label*="Accept"], button[aria-label*="aceitar tudo"], ytd-button-renderer#accept-button button'
        );
        if (consentButton) {
          await consentButton.click();
          await page.waitForTimeout(1000);
          logger.debug('Consent popup handled');
        }
      } catch (e) {
        // No consent popup or already dismissed
      }

      // 4. Scroll to description area
      await page.evaluate(() => {
        const transcriptSection = document.querySelector('ytd-video-description-transcript-section-renderer');
        if (transcriptSection) {
          transcriptSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else {
          window.scrollTo(0, 800);
        }
      });
      await page.waitForTimeout(1500);

      // 5. Try to expand description (optional)
      try {
        const expandButton = await page.$('tp-yt-paper-button#expand, #expand, button[aria-label*="mais"]');
        if (expandButton) {
          await expandButton.click();
          await page.waitForTimeout(500);
        }
      } catch (e) {
        // Not critical
      }

      // 6. Click on transcript button
      const clicked = await page.evaluate(() => {
        // Strategy 1: Direct selector (most reliable)
        let btn = document.querySelector('ytd-video-description-transcript-section-renderer button') as HTMLElement;

        // Strategy 2: Search by text content
        if (!btn) {
          const buttons = Array.from(document.querySelectorAll('button'));
          btn = buttons.find(b => {
            const text = (b.textContent || '').toLowerCase();
            const aria = (b.getAttribute('aria-label') || '').toLowerCase();
            return (
              text.includes('show transcript') ||
              text.includes('mostrar transcrição') ||
              text.includes('mostrar transcripción') ||
              text.includes('transcript') ||
              aria.includes('transcript') ||
              aria.includes('transcrição')
            );
          }) as HTMLElement;
        }

        if (btn && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
        return false;
      });

      if (!clicked) {
        logger.warn('Transcript button not found', { videoUrl });
        return {
          ok: false,
          source: videoUrl,
          error: 'Auto-generated transcript not available for this video'
        };
      }

      logger.debug('Transcript button clicked, waiting for segments...');

      // 7. Wait for transcript segments to load
      await page.waitForSelector(
        '#segments-container ytd-transcript-segment-renderer',
        { timeout: 10000 }
      );

      // 8. Extract transcript segments
      const segments = await page.evaluate(() => {
        const elements = document.querySelectorAll(
          '#segments-container ytd-transcript-segment-renderer yt-formatted-string.segment-text'
        );
        return Array.from(elements)
          .map(el => el.textContent?.trim() || '')
          .filter(text => text.length > 0);
      });

      if (segments.length === 0) {
        logger.warn('No transcript segments found', { videoUrl });
        return {
          ok: false,
          source: videoUrl,
          error: 'Transcript loaded but no segments found'
        };
      }

      // 9. Process result
      const transcriptText = segments.join(' ').replace(/\s+/g, ' ').trim();

      logger.info('✅ Transcript extracted successfully', {
        videoUrl,
        segmentsCount: segments.length,
        textLength: transcriptText.length
      });

      return {
        ok: true,
        source: videoUrl,
        segments_count: segments.length,
        transcript_text: transcriptText,
        raw_segments: segments
      };

    } finally {
      await page.close();
    }
  }

  /**
   * Validate YouTube URL format
   */
  private isValidYouTubeUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return (
        (parsed.hostname === 'www.youtube.com' || parsed.hostname === 'youtube.com') &&
        parsed.pathname === '/watch' &&
        parsed.searchParams.has('v')
      ) || (
        parsed.hostname === 'youtu.be' &&
        parsed.pathname.length > 1
      );
    } catch {
      return false;
    }
  }

  /**
   * Get service statistics
   */
  async getStats(): Promise<{
    browserPool: {
      browsers: number;
      availableContexts: number;
      initialized: boolean;
    };
    cache: {
      enabled: boolean;
      connected: boolean;
      totalKeys?: number;
    };
  }> {
    return {
      browserPool: browserPool.getStats(),
      cache: await cacheService.getStats()
    };
  }
}

// Singleton instance
export const youtubeTranscriberService = new YouTubeTranscriberService();
