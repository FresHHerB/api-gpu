// ============================================
// Queue Factory
// Inicializa todo o sistema de filas
// ============================================

import { RunPodService } from '../services/runpodService';
import {
  JobStorage,
  MemoryJobStorage,
  RedisJobStorage,
  QueueManager,
  WorkerMonitor,
  WebhookService,
  JobService
} from '../queue';
import { logger } from '../../shared/utils/logger';

export interface QueueSystem {
  storage: JobStorage;
  queueManager: QueueManager;
  workerMonitor: WorkerMonitor;
  webhookService: WebhookService;
  jobService: JobService;
  start: () => void;
  stop: () => void;
}

export function createQueueSystem(runpodService: RunPodService): QueueSystem {
  logger.info('🏗️ Initializing Queue System');

  // 1. Inicializar Storage
  const storageType = process.env.QUEUE_STORAGE || 'memory';
  const maxWorkers = parseInt(process.env.QUEUE_MAX_WORKERS || '3', 10);

  let storage: JobStorage;

  if (storageType === 'redis') {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const jobTTL = parseInt(process.env.QUEUE_JOB_TTL || '86400', 10);
    storage = new RedisJobStorage(redisUrl, maxWorkers, jobTTL);
    logger.info('📦 Using RedisJobStorage', { redisUrl, maxWorkers, jobTTL });
  } else {
    storage = new MemoryJobStorage(maxWorkers);
    logger.info('📦 Using MemoryJobStorage', { maxWorkers });
  }

  // Recover workers from any leaked/orphaned jobs
  // This runs immediately to fix any worker leaks from previous crashes/failures
  storage.recoverWorkers().then(recovered => {
    if (recovered > 0) {
      logger.warn('⚠️ Recovered leaked workers from previous session', { recovered });
    }
  }).catch(error => {
    logger.error('Failed to recover workers', {
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  });

  // 2. Inicializar QueueManager
  const queueManager = new QueueManager(storage, runpodService);

  // 3. Inicializar WebhookService
  const webhookMaxRetries = parseInt(process.env.WEBHOOK_MAX_RETRIES || '3', 10);
  const webhookRetryDelays = process.env.WEBHOOK_RETRY_DELAYS
    ? process.env.WEBHOOK_RETRY_DELAYS.split(',').map(d => parseInt(d, 10))
    : [1000, 5000, 15000];
  const webhookSecret = process.env.WEBHOOK_SECRET;

  const webhookService = new WebhookService(
    storage,
    webhookMaxRetries,
    webhookRetryDelays,
    webhookSecret
  );

  // 4. Inicializar WorkerMonitor
  const pollingInterval = parseInt(process.env.QUEUE_POLLING_INTERVAL || '5000', 10);
  const timeoutCheckInterval = parseInt(process.env.QUEUE_TIMEOUT_CHECK_INTERVAL || '60000', 10);

  const workerMonitor = new WorkerMonitor(
    storage,
    runpodService,
    queueManager,
    webhookService,
    pollingInterval,
    timeoutCheckInterval
  );

  // 5. Inicializar JobService
  const jobService = new JobService(storage, queueManager, runpodService);

  logger.info('✅ Queue System initialized successfully');

  return {
    storage,
    queueManager,
    workerMonitor,
    webhookService,
    jobService,

    start: () => {
      logger.info('🚀 Starting Queue System');
      workerMonitor.start();
    },

    stop: () => {
      logger.info('🛑 Stopping Queue System');
      workerMonitor.stop();
    }
  };
}
