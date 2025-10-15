// ============================================
// Cache Service - Redis-based caching for YouTube transcripts
// ============================================

import Redis from 'ioredis';
import { logger } from '../../../shared/utils/logger';

export interface TranscriptCacheEntry {
  ok: boolean;
  source: string;
  segments_count?: number;
  transcript_text?: string;
  raw_segments?: string[];
  error?: string;
  cached_at?: string;
}

export class CacheService {
  private redis: Redis | null = null;
  private enabled: boolean;
  private readonly defaultTTL = 86400; // 24 hours

  constructor() {
    this.enabled = process.env.REDIS_HOST !== undefined;

    if (this.enabled) {
      this.initializeRedis();
    } else {
      logger.warn('⚠️ Redis not configured - cache disabled', {
        hint: 'Set REDIS_HOST environment variable to enable caching'
      });
    }
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(): void {
    try {
      this.redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        retryStrategy: (times) => {
          if (times > 3) {
            logger.error('❌ Redis connection failed after 3 retries');
            return null; // Stop retrying
          }
          return Math.min(times * 100, 3000); // Exponential backoff
        }
      });

      this.redis.on('connect', () => {
        logger.info('✅ Redis connected successfully');
      });

      this.redis.on('error', (error) => {
        logger.error('❌ Redis error', {
          error: error.message
        });
      });

      this.redis.on('close', () => {
        logger.warn('⚠️ Redis connection closed');
      });

    } catch (error) {
      logger.error('❌ Failed to initialize Redis', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      this.redis = null;
      this.enabled = false;
    }
  }

  /**
   * Get cached transcript by video URL
   */
  async get(videoUrl: string): Promise<TranscriptCacheEntry | null> {
    if (!this.enabled || !this.redis) {
      return null;
    }

    try {
      const key = this.generateKey(videoUrl);
      const data = await this.redis.get(key);

      if (!data) {
        logger.debug('Cache miss', { videoUrl });
        return null;
      }

      const cached: TranscriptCacheEntry = JSON.parse(data);
      logger.info('✅ Cache hit', {
        videoUrl,
        segmentsCount: cached.segments_count,
        cachedAt: cached.cached_at
      });

      return cached;

    } catch (error) {
      logger.error('❌ Cache get error', {
        videoUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Set cached transcript
   */
  async set(
    videoUrl: string,
    value: Omit<TranscriptCacheEntry, 'cached_at'>,
    ttl: number = this.defaultTTL
  ): Promise<void> {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const key = this.generateKey(videoUrl);
      const cacheEntry: TranscriptCacheEntry = {
        ...value,
        cached_at: new Date().toISOString()
      };

      await this.redis.setex(key, ttl, JSON.stringify(cacheEntry));

      logger.info('✅ Transcript cached', {
        videoUrl,
        segmentsCount: value.segments_count,
        ttl: `${ttl}s (${Math.round(ttl / 3600)}h)`
      });

    } catch (error) {
      logger.error('❌ Cache set error', {
        videoUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Invalidate cached transcript
   */
  async invalidate(videoUrl: string): Promise<void> {
    if (!this.enabled || !this.redis) {
      return;
    }

    try {
      const key = this.generateKey(videoUrl);
      await this.redis.del(key);

      logger.info('🗑️ Cache invalidated', { videoUrl });

    } catch (error) {
      logger.error('❌ Cache invalidate error', {
        videoUrl,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    enabled: boolean;
    connected: boolean;
    totalKeys?: number;
  }> {
    if (!this.enabled || !this.redis) {
      return { enabled: false, connected: false };
    }

    try {
      const keys = await this.redis.keys('yt:transcript:*');
      return {
        enabled: true,
        connected: this.redis.status === 'ready',
        totalKeys: keys.length
      };
    } catch (error) {
      return {
        enabled: true,
        connected: false
      };
    }
  }

  /**
   * Generate cache key from video URL
   */
  private generateKey(videoUrl: string): string {
    // Extract video ID from URL for consistent caching
    const videoId = this.extractVideoId(videoUrl);
    return `yt:transcript:${videoId || videoUrl}`;
  }

  /**
   * Extract YouTube video ID from URL
   */
  private extractVideoId(url: string): string | null {
    try {
      const parsed = new URL(url);

      // youtube.com/watch?v=VIDEO_ID
      if (parsed.hostname.includes('youtube.com') && parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }

      // youtu.be/VIDEO_ID
      if (parsed.hostname === 'youtu.be') {
        return parsed.pathname.slice(1);
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Cleanup and close Redis connection
   */
  async cleanup(): Promise<void> {
    if (this.redis) {
      logger.info('🧹 Closing Redis connection...');
      await this.redis.quit();
      this.redis = null;
    }
  }
}

// Singleton instance
export const cacheService = new CacheService();
