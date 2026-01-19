const axios = require('axios');
const { WORKER_STATES } = require('../utils/constants');

/**
 * EndpointWorker - Single-threaded queue processor for one RPC endpoint
 * Processes requests sequentially to avoid triggering rate limits
 */
class EndpointWorker {
  constructor(url, endpointId, config, rateLimitDetector, statsRepo) {
    this.url = url;
    this.endpointId = endpointId;
    this.config = config;
    this.rateLimitDetector = rateLimitDetector;
    this.statsRepo = statsRepo;

    this.queue = []; // { request, resolve, reject, enqueuedAt }
    this.isProcessing = false;
    this.state = WORKER_STATES.HEALTHY;
    this.cooldownUntil = null;

    console.log(`Worker initialized for ${url}`);
  }

  /**
   * Queue a request for processing
   * Returns a promise that resolves with the response
   */
  queueRequest(rpcRequest) {
    return new Promise((resolve, reject) => {
      // Check queue size limit
      if (this.queue.length >= this.config.worker.maxQueueSize) {
        reject(new Error('Queue full'));
        return;
      }

      this.queue.push({
        request: rpcRequest,
        resolve,
        reject,
        enqueuedAt: Date.now()
      });

      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
    });
  }

  /**
   * Process queued requests sequentially
   */
  async processQueue() {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      // Check if we're in cooldown
      if (this.state === WORKER_STATES.COOLING_DOWN && Date.now() < this.cooldownUntil) {
        const waitTime = Math.min(1000, this.cooldownUntil - Date.now());
        await this.sleep(waitTime);
        continue;
      }

      // Exit cooldown if time has passed
      if (this.state === WORKER_STATES.COOLING_DOWN && Date.now() >= this.cooldownUntil) {
        this.state = WORKER_STATES.HEALTHY;
        this.cooldownUntil = null;
        this.rateLimitDetector.resetConsecutiveLimits(this.endpointId);
        console.log(`${this.url} - Cooldown ended, back to HEALTHY`);
      }

      const item = this.queue.shift();

      try {
        const startTime = Date.now();
        const response = await this.makeRequest(item.request);
        const responseTime = Date.now() - startTime;

        // Analyze response for rate limiting
        const analysis = this.rateLimitDetector.detectRateLimit(
          this.endpointId,
          response.data,
          response.status,
          responseTime,
          null
        );

        if (analysis.isRateLimited) {
          console.log(`${this.url} - Rate limit detected (confidence: ${analysis.confidence.toFixed(2)})`);
          this.handleRateLimit(analysis);
          // Re-queue the request at the front
          this.queue.unshift(item);
          continue;
        }

        // Check if response contains a JSON-RPC error
        if (response.data && response.data.error) {
          const rpcError = response.data.error;

          // Check if it's a temporary/retryable error
          if (this.isTemporaryError(rpcError)) {
            console.log(`${this.url} - Temporary error (code ${rpcError.code}): ${rpcError.message}`);
            this.recordFailure(item.request.method, responseTime, new Error(rpcError.message));

            // Throw error to trigger failover to another endpoint
            const error = new Error(`Temporary error from ${this.url}: ${rpcError.message}`);
            error.code = 'TEMPORARY_ERROR';
            error.rpcError = rpcError;
            item.reject(error);
            continue;
          }

          // Non-temporary RPC error - return to client
          console.log(`${this.url} - RPC error (code ${rpcError.code}): ${rpcError.message}`);
        }

        // Success (or non-temporary error that should be returned to client)
        this.recordSuccess(item.request.method, responseTime);
        item.resolve(response.data);

      } catch (error) {
        const responseTime = Date.now() - item.enqueuedAt;

        // Analyze error for rate limiting
        const analysis = this.rateLimitDetector.detectRateLimit(
          this.endpointId,
          error.response?.data,
          error.response?.status,
          responseTime,
          error
        );

        if (analysis.isRateLimited) {
          console.log(`${this.url} - Rate limit detected from error (confidence: ${analysis.confidence.toFixed(2)})`);
          this.handleRateLimit(analysis);
          // Re-queue the request
          this.queue.unshift(item);
          continue;
        }

        // Non-rate-limit error - record and reject
        this.recordFailure(item.request.method, responseTime, error);
        item.reject(error);
      }
    }

    this.isProcessing = false;
  }

  /**
   * Make HTTP request to the RPC endpoint
   */
  async makeRequest(rpcRequest) {
    try {
      const response = await axios.post(this.url, rpcRequest, {
        timeout: this.config.worker.requestTimeout,
        headers: {
          'Content-Type': 'application/json'
        },
        validateStatus: () => true // Don't throw on any status code
      });

      return response;
    } catch (error) {
      // Axios errors (network, timeout, etc.)
      throw error;
    }
  }

  /**
   * Handle rate limit detection
   */
  handleRateLimit(analysis) {
    this.state = WORKER_STATES.COOLING_DOWN;
    this.cooldownUntil = Date.now() + analysis.cooldownMs;

    // Record to database
    this.statsRepo.recordRateLimitEvent(
      this.endpointId,
      analysis.cooldownMs,
      null,
      `Confidence: ${analysis.confidence.toFixed(2)}, Signals: ${JSON.stringify(analysis.signals)}`
    );

    const cooldownSec = (analysis.cooldownMs / 1000).toFixed(1);
    console.log(`${this.url} - Entering cooldown for ${cooldownSec}s until ${new Date(this.cooldownUntil).toISOString()}`);
  }

  /**
   * Record successful request
   */
  recordSuccess(method, responseTime) {
    this.statsRepo.recordRequest(
      this.endpointId,
      method,
      true,
      responseTime,
      200,
      null
    );
  }

  /**
   * Record failed request
   */
  recordFailure(method, responseTime, error) {
    const statusCode = error.response?.status || null;
    const errorMessage = error.message || 'Unknown error';

    this.statsRepo.recordRequest(
      this.endpointId,
      method,
      false,
      responseTime,
      statusCode,
      errorMessage
    );
  }

  /**
   * Check if worker is available to accept new requests
   */
  isAvailable() {
    if (this.state === WORKER_STATES.COOLING_DOWN && Date.now() < this.cooldownUntil) {
      return false;
    }
    if (this.state === WORKER_STATES.ERROR) {
      return false;
    }
    return true;
  }

  /**
   * Get current queue length
   */
  getQueueLength() {
    return this.queue.length;
  }

  /**
   * Get worker status for monitoring
   */
  getStatus() {
    return {
      url: this.url,
      state: this.state,
      queueLength: this.queue.length,
      cooldownUntil: this.cooldownUntil ? new Date(this.cooldownUntil).toISOString() : null,
      isAvailable: this.isAvailable()
    };
  }

  /**
   * Get estimated recovery time (ms from now)
   */
  getRecoveryTime() {
    if (this.state === WORKER_STATES.COOLING_DOWN && this.cooldownUntil) {
      return Math.max(0, this.cooldownUntil - Date.now());
    }
    return 0;
  }

  /**
   * Check if an RPC error is temporary and should trigger failover
   */
  isTemporaryError(rpcError) {
    if (!rpcError) return false;

    const code = rpcError.code;
    const message = (rpcError.message || '').toLowerCase();

    // Known temporary error codes
    const temporaryErrorCodes = [
      19,      // Temporary internal error
      -32000,  // Server error (often temporary)
      -32603,  // Internal error (often temporary)
      429,     // Too many requests
      503,     // Service unavailable
    ];

    if (temporaryErrorCodes.includes(code)) {
      return true;
    }

    // Check message for temporary error keywords
    const temporaryKeywords = [
      'temporary',
      'retry',
      'timeout',
      'timed out',
      'unavailable',
      'connection',
      'network',
      'try again',
      'overloaded',
      'capacity'
    ];

    return temporaryKeywords.some(keyword => message.includes(keyword));
  }

  /**
   * Helper: sleep for ms
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if worker has active requests
   */
  hasActiveRequests() {
    return this.isProcessing || this.queue.length > 0;
  }
}

module.exports = EndpointWorker;
