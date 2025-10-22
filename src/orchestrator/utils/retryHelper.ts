// ============================================
// Retry Helper
// Utilities para retry com exponential backoff
// ============================================

import { logger } from '../../shared/utils/logger';

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  exponentialBase?: number;
  onRetry?: (attempt: number, error: Error) => void;
  shouldRetry?: (error: Error) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 3,
  initialDelayMs: 100,
  maxDelayMs: 5000,
  exponentialBase: 2,
  onRetry: () => {},
  shouldRetry: () => true
};

/**
 * Executa função com retry exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  operation: string,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Verificar se deve fazer retry
      if (!opts.shouldRetry(lastError)) {
        logger.warn(`❌ ${operation} failed - not retryable`, {
          error: lastError.message,
          attempt
        });
        throw lastError;
      }

      // Última tentativa - não fazer retry
      if (attempt === opts.maxAttempts) {
        logger.error(`❌ ${operation} failed after all retries`, {
          error: lastError.message,
          attempts: opts.maxAttempts
        });
        throw lastError;
      }

      // Calcular delay com exponential backoff
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(opts.exponentialBase, attempt - 1),
        opts.maxDelayMs
      );

      logger.warn(`⚠️ ${operation} failed, retrying...`, {
        error: lastError.message,
        attempt,
        nextAttempt: attempt + 1,
        delayMs: delay
      });

      // Callback antes do retry
      opts.onRetry(attempt, lastError);

      // Aguardar antes do próximo retry
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Verifica se erro é temporário (deve fazer retry)
 */
export function isTemporaryError(error: Error): boolean {
  const temporaryPatterns = [
    'ECONNREFUSED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'socket hang up',
    'network timeout',
    'redis connection lost',
    'connection refused'
  ];

  const errorMessage = error.message.toLowerCase();
  return temporaryPatterns.some(pattern =>
    errorMessage.includes(pattern.toLowerCase())
  );
}

/**
 * Wrapper para operações críticas de workers
 */
export async function retryWorkerOperation<T>(
  fn: () => Promise<T>,
  operation: string
): Promise<T> {
  return retryWithBackoff(fn, operation, {
    maxAttempts: 5, // Mais tentativas para operações críticas
    initialDelayMs: 200,
    maxDelayMs: 3000,
    exponentialBase: 2,
    shouldRetry: isTemporaryError
  });
}
