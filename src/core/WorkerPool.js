const EndpointWorker = require('./EndpointWorker');
const RateLimitDetector = require('./RateLimitDetector');

/**
 * WorkerPool - Manages all endpoint workers and health checks
 */
class WorkerPool {
  constructor(endpoints, config, statsRepo) {
    this.config = config;
    this.statsRepo = statsRepo;
    this.workers = [];
    this.healthCheckInterval = null;

    // Create rate limit detector (shared across all workers)
    this.rateLimitDetector = new RateLimitDetector(config, statsRepo);

    // Initialize workers for each endpoint
    this.initializeWorkers(endpoints);
  }

  /**
   * Initialize workers for all endpoints
   */
  initializeWorkers(endpoints) {
    console.log(`Initializing ${endpoints.length} endpoint workers...`);

    endpoints.forEach(url => {
      const endpointId = this.statsRepo.ensureEndpoint(url);
      const worker = new EndpointWorker(
        url,
        endpointId,
        this.config,
        this.rateLimitDetector,
        this.statsRepo
      );
      this.workers.push(worker);
    });

    console.log(`All workers initialized`);
  }

  /**
   * Get workers that are currently available (not in cooldown/error)
   */
  getAvailableWorkers() {
    return this.workers.filter(w => w.isAvailable());
  }

  /**
   * Get all workers
   */
  getAllWorkers() {
    return this.workers;
  }

  /**
   * Get the shortest recovery time among cooling down workers
   */
  getShortestRecoveryTime() {
    const coolingDownWorkers = this.workers.filter(w => !w.isAvailable());

    if (coolingDownWorkers.length === 0) {
      return 0;
    }

    const recoveryTimes = coolingDownWorkers
      .map(w => w.getRecoveryTime())
      .filter(t => t > 0);

    if (recoveryTimes.length === 0) {
      return 0;
    }

    return Math.min(...recoveryTimes);
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks() {
    console.log(`Starting health checks (interval: ${this.config.worker.healthCheckInterval}ms)`);

    this.healthCheckInterval = setInterval(async () => {
      for (const worker of this.workers) {
        // Only health check workers in error state or that have been cooling for a while
        if (worker.state === 'ERROR') {
          await this.performHealthCheck(worker);
        }
      }
    }, this.config.worker.healthCheckInterval);
  }

  /**
   * Stop health checks
   */
  stopHealthChecks() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
      console.log('Health checks stopped');
    }
  }

  /**
   * Perform health check on a worker
   */
  async performHealthCheck(worker) {
    try {
      console.log(`Health check for ${worker.url}...`);

      // Simple eth_blockNumber request
      const healthRequest = {
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 'health-check'
      };

      const response = await worker.makeRequest(healthRequest);

      if (response.data && response.data.result) {
        worker.state = 'HEALTHY';
        worker.cooldownUntil = null;
        console.log(`${worker.url} - Health check passed, back to HEALTHY`);
      }
    } catch (error) {
      console.log(`${worker.url} - Health check failed: ${error.message}`);
    }
  }

  /**
   * Get health status of all workers
   */
  getHealthStatus() {
    const workerStatuses = this.workers.map(w => {
      const stats = this.statsRepo.getEndpointStatById(w.endpointId);
      return {
        ...w.getStatus(),
        successRate: stats && stats.total_requests > 0
          ? (stats.successful_requests / stats.total_requests).toFixed(3)
          : null,
        avgResponseTime: stats ? stats.avg_response_time_ms : null,
        totalRequests: stats ? stats.total_requests : 0
      };
    });

    const availableCount = workerStatuses.filter(w => w.isAvailable).length;

    return {
      status: availableCount > 0 ? 'healthy' : 'degraded',
      availableWorkers: availableCount,
      totalWorkers: this.workers.length,
      workers: workerStatuses
    };
  }

  /**
   * Check if any worker has active requests
   */
  hasActiveRequests() {
    return this.workers.some(w => w.hasActiveRequests());
  }

  /**
   * Flush statistics for all workers
   */
  async flushStatistics() {
    console.log('Flushing statistics...');
    // Statistics are written immediately, so nothing to flush
    // This is a placeholder for future batch operations
  }
}

module.exports = WorkerPool;
