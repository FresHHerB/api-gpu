// ============================================
// Optimized HTTP Client for TTS Requests
// Reuses connections and optimizes performance
// ============================================

import axios, { AxiosInstance } from 'axios';
import http from 'http';
import https from 'https';

/**
 * Create optimized axios instance with connection pooling
 * Reuses TCP connections to reduce latency
 */
export function createOptimizedHTTPClient(baseURL?: string): AxiosInstance {
  // HTTP Agent with keep-alive and connection pooling
  const httpAgent = new http.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000, // Keep connections alive for 30s
    maxSockets: 50, // Max concurrent connections per host
    maxFreeSockets: 10, // Keep 10 idle connections ready
    timeout: 60000, // Socket timeout
  });

  // HTTPS Agent with keep-alive and connection pooling
  const httpsAgent = new https.Agent({
    keepAlive: true,
    keepAliveMsecs: 30000,
    maxSockets: 50,
    maxFreeSockets: 10,
    timeout: 60000,
  });

  return axios.create({
    baseURL,
    httpAgent,
    httpsAgent,
    // Decompress responses automatically (gzip, deflate, br)
    decompress: true,
    // Don't follow redirects (TTS APIs don't redirect)
    maxRedirects: 0,
    // Timeout configurations
    timeout: 60000, // 60s total timeout
    // Performance headers
    headers: {
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection': 'keep-alive'
    }
  });
}
