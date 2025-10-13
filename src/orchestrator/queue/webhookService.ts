// ============================================
// WebhookService
// Envia notificações para webhooks com retry
// ============================================

import axios, { AxiosError } from 'axios';
import crypto from 'crypto';
import { WebhookPayload } from '../../shared/types';
import { JobStorage } from './jobStorage';
import { logger } from '../../shared/utils/logger';

export class WebhookService {
  private storage: JobStorage;
  private maxRetries: number;
  private retryDelays: number[]; // Delays em ms
  private webhookSecret?: string; // Secret para HMAC signature

  constructor(
    storage: JobStorage,
    maxRetries: number = 3,
    retryDelays: number[] = [1000, 5000, 15000],
    webhookSecret?: string
  ) {
    this.storage = storage;
    this.maxRetries = maxRetries;
    this.retryDelays = retryDelays;
    this.webhookSecret = webhookSecret;

    logger.info('📞 WebhookService initialized', {
      maxRetries,
      retryDelays,
      hasSecret: !!webhookSecret
    });
  }

  /**
   * Envia notificação para webhook com retry
   */
  async sendWebhook(
    jobId: string,
    webhookUrl: string,
    payload: Omit<WebhookPayload, 'timestamp'>
  ): Promise<boolean> {
    const fullPayload: WebhookPayload = {
      ...payload,
      timestamp: new Date().toISOString()
    };

    logger.info('📤 Sending webhook', {
      jobId,
      webhookUrl,
      status: payload.status
    });

    return await this.sendWithRetry(jobId, webhookUrl, fullPayload, 0);
  }

  /**
   * Envia webhook com retry exponential backoff
   */
  private async sendWithRetry(
    jobId: string,
    webhookUrl: string,
    payload: WebhookPayload,
    attempt: number
  ): Promise<boolean> {
    try {
      // Gerar signature HMAC se secret estiver configurado
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Webhook-JobId': payload.jobId,
        'X-Webhook-Status': payload.status,
        'X-Webhook-Timestamp': payload.timestamp
      };

      if (this.webhookSecret) {
        const signature = this.generateSignature(payload);
        headers['X-Webhook-Signature'] = signature;
      }

      // Enviar webhook
      const response = await axios.post(webhookUrl, payload, {
        headers,
        timeout: 30000, // 30s
        validateStatus: (status) => status >= 200 && status < 300
      });

      logger.info('✅ Webhook delivered successfully', {
        jobId,
        webhookUrl,
        status: response.status,
        attempt: attempt + 1
      });

      return true;

    } catch (error) {
      const errorMessage = this.getErrorMessage(error);

      logger.warn('⚠️ Webhook delivery failed', {
        jobId,
        webhookUrl,
        attempt: attempt + 1,
        maxRetries: this.maxRetries,
        error: errorMessage
      });

      // Verificar se deve fazer retry
      if (attempt < this.maxRetries) {
        const delay = this.retryDelays[attempt] || this.retryDelays[this.retryDelays.length - 1];
        logger.info(`🔄 Retrying webhook in ${delay}ms`, { jobId, attempt: attempt + 1 });

        await this.sleep(delay);
        return await this.sendWithRetry(jobId, webhookUrl, payload, attempt + 1);
      }

      // Esgotou tentativas - enviar para DLQ
      logger.error('❌ Webhook delivery failed after all retries', {
        jobId,
        webhookUrl,
        attempts: this.maxRetries + 1,
        error: errorMessage
      });

      await this.sendToDLQ(jobId, webhookUrl, payload, errorMessage);

      // Atualizar job com erro de webhook
      const job = await this.storage.getJob(jobId);
      if (job) {
        await this.storage.updateJob(jobId, {
          retryCount: this.maxRetries + 1,
          error: job.error
            ? `${job.error} | Webhook failed: ${errorMessage}`
            : `Webhook failed: ${errorMessage}`
        });
      }

      return false;
    }
  }

  /**
   * Envia webhook falhado para Dead Letter Queue
   */
  private async sendToDLQ(
    jobId: string,
    webhookUrl: string,
    payload: WebhookPayload,
    error: string
  ): Promise<void> {
    const dlqEntry = {
      jobId,
      webhookUrl,
      payload,
      error,
      failedAt: new Date().toISOString()
    };

    logger.error('💀 Sending to DLQ', dlqEntry);

    // Aqui você poderia implementar persistência do DLQ
    // Por exemplo, salvar em arquivo ou Redis
    // Para este MVP, apenas logamos

    // TODO: Implementar persistência do DLQ
    // await this.storage.saveToDLQ(dlqEntry);
  }

  /**
   * Gera signature HMAC SHA256 para o payload
   */
  private generateSignature(payload: WebhookPayload): string {
    if (!this.webhookSecret) {
      return '';
    }

    const payloadString = JSON.stringify(payload);
    const hmac = crypto.createHmac('sha256', this.webhookSecret);
    hmac.update(payloadString);

    return `sha256=${hmac.digest('hex')}`;
  }

  /**
   * Extrai mensagem de erro de forma segura
   */
  private getErrorMessage(error: unknown): string {
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        return `HTTP ${axiosError.response.status}: ${axiosError.response.statusText}`;
      }
      if (axiosError.code === 'ECONNABORTED') {
        return 'Timeout after 30s';
      }
      return axiosError.message;
    }

    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown error';
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Valida URL do webhook (previne SSRF)
   */
  static validateWebhookUrl(url: string): boolean {
    try {
      const parsed = new URL(url);

      // Permitir apenas HTTP/HTTPS
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }

      // Bloquear IPs locais/privados
      const hostname = parsed.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.')
      ) {
        logger.warn('⚠️ Blocked local/private IP in webhook URL', { url });
        return false;
      }

      return true;
    } catch (error) {
      logger.warn('⚠️ Invalid webhook URL', { url });
      return false;
    }
  }
}
