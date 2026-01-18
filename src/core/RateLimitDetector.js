const { HTTP_STATUS, RATE_LIMIT_KEYWORDS } = require('../utils/constants');

/**
 * RateLimitDetector - Detects rate limiting through multiple heuristics
 */
class RateLimitDetector {
  constructor(config, statsRepo) {
    this.config = config;
    this.statsRepo = statsRepo;
    this.consecutiveLimits = new Map(); // Track consecutive rate limits per endpoint
  }

  /**
   * Analyze response/error to detect rate limiting
   * Returns: { isRateLimited: boolean, cooldownMs: number, confidence: number }
   */
  detectRateLimit(endpointId, responseData, statusCode, responseTime, error = null) {
    const signals = {
      httpStatus: this.checkHttpStatus(statusCode),
      responseBody: this.checkResponseBody(responseData, error),
      failureRate: this.checkFailureRate(endpointId),
      timeout: this.checkTimeout(responseTime, error)
    };

    // Calculate confidence based on signals
    const signalCount = Object.values(signals).filter(s => s).length;
    const confidence = signalCount / Object.keys(signals).length;

    const isRateLimited = signalCount >= 1; // At least one signal

    if (isRateLimited) {
      const cooldownMs = this.calculateCooldown(endpointId, statusCode, responseData);
      return {
        isRateLimited: true,
        cooldownMs,
        confidence,
        signals
      };
    }

    // Reset consecutive limits if not rate limited
    this.consecutiveLimits.set(endpointId, 0);

    return {
      isRateLimited: false,
      cooldownMs: 0,
      confidence: 0,
      signals
    };
  }

  /**
   * Check HTTP status code for rate limiting indicators
   */
  checkHttpStatus(statusCode) {
    if (!statusCode) return false;

    return [
      HTTP_STATUS.TOO_MANY_REQUESTS,
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      HTTP_STATUS.FORBIDDEN
    ].includes(statusCode);
  }

  /**
   * Check response body/error message for rate limit keywords
   */
  checkResponseBody(responseData, error) {
    const textToCheck = [];

    // Check response data
    if (responseData) {
      if (typeof responseData === 'string') {
        textToCheck.push(responseData.toLowerCase());
      } else if (responseData.error && responseData.error.message) {
        textToCheck.push(responseData.error.message.toLowerCase());
      } else if (typeof responseData === 'object') {
        textToCheck.push(JSON.stringify(responseData).toLowerCase());
      }
    }

    // Check error message
    if (error && error.message) {
      textToCheck.push(error.message.toLowerCase());
    }

    // Check for rate limit keywords
    const combinedText = textToCheck.join(' ');
    return RATE_LIMIT_KEYWORDS.some(keyword => combinedText.includes(keyword));
  }

  /**
   * Check recent failure rate to detect rate limiting patterns
   */
  checkFailureRate(endpointId) {
    try {
      const recentRequests = this.statsRepo.getRecentRequests(
        endpointId,
        this.config.rateLimit.historyWindowSize
      );

      if (recentRequests.length < 5) {
        return false; // Not enough data
      }

      const failureCount = recentRequests.filter(r => !r.success).length;
      const failureRate = failureCount / recentRequests.length;

      return failureRate >= this.config.rateLimit.detectionThreshold;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if timeout might indicate rate limiting
   */
  checkTimeout(responseTime, error) {
    if (!error) return false;

    // Check for timeout errors
    const isTimeout = error.code === 'ETIMEDOUT' ||
                     error.code === 'ECONNABORTED' ||
                     (error.message && error.message.toLowerCase().includes('timeout'));

    return isTimeout;
  }

  /**
   * Calculate appropriate cooldown duration
   */
  calculateCooldown(endpointId, statusCode, responseData) {
    // Check for Retry-After header
    let cooldownMs = this.parseRetryAfter(responseData);

    if (!cooldownMs) {
      // Use exponential backoff based on consecutive rate limits
      const consecutive = this.consecutiveLimits.get(endpointId) || 0;
      this.consecutiveLimits.set(endpointId, consecutive + 1);

      // Base cooldown * backoff multiplier ^ consecutive events
      const baseCooldown = this.config.rateLimit.minCooldownMs;
      const multiplier = this.config.rateLimit.backoffMultiplier;
      cooldownMs = Math.min(
        baseCooldown * Math.pow(multiplier, consecutive),
        this.config.rateLimit.maxCooldownMs
      );

      // Use historical average if available
      const historicalAvg = this.statsRepo.getAverageCooldown(endpointId);
      if (historicalAvg && historicalAvg > cooldownMs) {
        cooldownMs = Math.min(historicalAvg, this.config.rateLimit.maxCooldownMs);
      }
    }

    return Math.round(cooldownMs);
  }

  /**
   * Parse Retry-After header (seconds or HTTP date)
   */
  parseRetryAfter(responseData) {
    try {
      if (!responseData || !responseData.headers) return null;

      const retryAfter = responseData.headers['retry-after'] ||
                        responseData.headers['Retry-After'];

      if (!retryAfter) return null;

      // If it's a number (seconds)
      if (/^\d+$/.test(retryAfter)) {
        return parseInt(retryAfter) * 1000; // Convert to ms
      }

      // If it's a date
      const retryDate = new Date(retryAfter);
      if (!isNaN(retryDate.getTime())) {
        return Math.max(0, retryDate.getTime() - Date.now());
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Reset consecutive limit counter (call when endpoint recovers)
   */
  resetConsecutiveLimits(endpointId) {
    this.consecutiveLimits.set(endpointId, 0);
  }
}

module.exports = RateLimitDetector;
