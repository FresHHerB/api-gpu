// ============================================
// Cleanup Utility - Remove old output files
// ============================================

import { promises as fs } from 'fs';
import path from 'path';
import { logger } from '../../shared/utils/logger';

const OUTPUT_DIR = path.join(process.cwd(), 'public', 'output');
const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Delete files older than MAX_AGE_MS
 */
export async function cleanupOldFiles(): Promise<void> {
  try {
    const files = await fs.readdir(OUTPUT_DIR);
    const now = Date.now();
    let deletedCount = 0;

    for (const file of files) {
      const filepath = path.join(OUTPUT_DIR, file);
      const stats = await fs.stat(filepath);

      const ageMs = now - stats.mtimeMs;

      if (ageMs > MAX_AGE_MS) {
        await fs.unlink(filepath);
        deletedCount++;
        logger.info('Old file deleted', {
          file,
          ageMinutes: Math.floor(ageMs / 60000)
        });
      }
    }

    if (deletedCount > 0) {
      logger.info(`🧹 Cleanup completed - ${deletedCount} files deleted`);
    }
  } catch (error) {
    logger.error('Cleanup failed', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Start cleanup interval (runs every 15 minutes)
 */
export function startCleanupScheduler(): void {
  // Run immediately
  cleanupOldFiles();

  // Run every 15 minutes
  setInterval(() => {
    cleanupOldFiles();
  }, 15 * 60 * 1000);

  logger.info('🧹 Cleanup scheduler started (every 15min, TTL 1h)');
}
