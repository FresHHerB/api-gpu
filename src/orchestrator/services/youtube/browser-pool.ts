// ============================================
// Browser Pool - Playwright Browser Management
// Manages a pool of browsers for concurrent scraping
// ============================================

import { chromium, Browser, BrowserContext } from 'playwright';
import { logger } from '../../../shared/utils/logger';

export class BrowserPool {
  private browsers: Browser[] = [];
  private availableContexts: BrowserContext[] = [];
  private readonly maxBrowsers: number;
  private readonly maxContextsPerBrowser: number;
  private isInitialized = false;

  constructor(
    maxBrowsers: number = 3,
    maxContextsPerBrowser: number = 5
  ) {
    this.maxBrowsers = maxBrowsers;
    this.maxContextsPerBrowser = maxContextsPerBrowser;
  }

  /**
   * Initialize browser pool
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Browser pool already initialized');
      return;
    }

    logger.info('🌐 Initializing browser pool', {
      maxBrowsers: this.maxBrowsers,
      maxContextsPerBrowser: this.maxContextsPerBrowser
    });

    try {
      for (let i = 0; i < this.maxBrowsers; i++) {
        const browser = await chromium.launch({
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage', // Important for VPS with limited RAM
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check'
          ]
        });

        this.browsers.push(browser);
        logger.debug(`Browser ${i + 1}/${this.maxBrowsers} created`);
      }

      this.isInitialized = true;
      logger.info('✅ Browser pool initialized successfully', {
        browsersCreated: this.browsers.length
      });

    } catch (error) {
      logger.error('❌ Failed to initialize browser pool', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * Get a browser context from the pool (or create new one)
   */
  async getContext(): Promise<BrowserContext> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    // Reuse available context if exists
    if (this.availableContexts.length > 0) {
      const context = this.availableContexts.pop()!;
      logger.debug('♻️ Reusing existing browser context', {
        availableContexts: this.availableContexts.length
      });
      return context;
    }

    // Create new context from a random browser
    const browser = this.browsers[Math.floor(Math.random() * this.browsers.length)];
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo'
    });

    logger.debug('🆕 Created new browser context', {
      totalBrowsers: this.browsers.length,
      availableContexts: this.availableContexts.length
    });

    return context;
  }

  /**
   * Release context back to pool (cleanup and reuse)
   */
  async releaseContext(context: BrowserContext): Promise<void> {
    try {
      // Close all pages in context
      const pages = context.pages();
      for (const page of pages) {
        await page.close();
      }

      // Return to pool if under limit
      const maxPoolSize = this.maxContextsPerBrowser * this.maxBrowsers;
      if (this.availableContexts.length < maxPoolSize) {
        this.availableContexts.push(context);
        logger.debug('♻️ Context returned to pool', {
          poolSize: this.availableContexts.length,
          maxPoolSize
        });
      } else {
        await context.close();
        logger.debug('🗑️ Context closed (pool full)', {
          poolSize: this.availableContexts.length
        });
      }

    } catch (error) {
      logger.error('❌ Error releasing context', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      try {
        await context.close();
      } catch (closeError) {
        // Ignore close errors
      }
    }
  }

  /**
   * Get pool statistics
   */
  getStats(): {
    browsers: number;
    availableContexts: number;
    initialized: boolean;
  } {
    return {
      browsers: this.browsers.length,
      availableContexts: this.availableContexts.length,
      initialized: this.isInitialized
    };
  }

  /**
   * Cleanup all browsers and contexts
   */
  async cleanup(): Promise<void> {
    logger.info('🧹 Cleaning up browser pool...');

    try {
      // Close all available contexts
      for (const context of this.availableContexts) {
        await context.close();
      }
      this.availableContexts = [];

      // Close all browsers
      for (const browser of this.browsers) {
        await browser.close();
      }
      this.browsers = [];

      this.isInitialized = false;

      logger.info('✅ Browser pool cleaned up successfully');

    } catch (error) {
      logger.error('❌ Error during browser pool cleanup', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

// Singleton instance
export const browserPool = new BrowserPool(
  parseInt(process.env.BROWSER_POOL_SIZE || '3'),
  parseInt(process.env.MAX_CONTEXTS_PER_BROWSER || '5')
);
