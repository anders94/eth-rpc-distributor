/**
 * RequestRouter - Routes requests to available workers with failover logic
 * Holds connections open when all endpoints are rate limited
 */
class RequestRouter {
  constructor(workerPool, statsRepo) {
    this.workerPool = workerPool;
    this.statsRepo = statsRepo;
    this.requestCount = 0;
  }

  /**
   * Route a request to an available worker
   * Holds connection open until request can be fulfilled
   */
  async routeRequest(rpcRequest) {
    this.requestCount++;
    const requestId = this.requestCount;

    console.log(`[Req ${requestId}] Routing ${rpcRequest.method || 'unknown method'}`);

    let attempts = 0;
    const maxRetries = this.workerPool.getAllWorkers().length * 2; // Try each worker up to 2 times
    const triedWorkers = new Set();
    let lastError = null;

    while (true) {
      attempts++;

      // Get available workers that we haven't tried yet (or try all if we've tried all)
      const availableWorkers = this.workerPool.getAvailableWorkers();
      const untriedWorkers = availableWorkers.filter(w => !triedWorkers.has(w.url));
      const workersToTry = untriedWorkers.length > 0 ? untriedWorkers : availableWorkers;

      if (workersToTry.length > 0) {
        // Select least loaded worker
        const worker = this.selectWorker(workersToTry);

        console.log(`[Req ${requestId}] Attempting with ${worker.url} (queue: ${worker.getQueueLength()}, attempt ${attempts})`);

        try {
          const result = await worker.queueRequest(rpcRequest);
          console.log(`[Req ${requestId}] Success with ${worker.url}`);
          return result;
        } catch (error) {
          lastError = error;
          triedWorkers.add(worker.url);

          // Check if this is a temporary error that should trigger retry
          if (error.code === 'TEMPORARY_ERROR') {
            console.log(`[Req ${requestId}] Temporary error from ${worker.url}, trying next endpoint`);
          } else {
            console.log(`[Req ${requestId}] Failed with ${worker.url}: ${error.message}`);
          }

          // If we've tried all available workers, check if we should give up
          if (triedWorkers.size >= availableWorkers.length && attempts >= maxRetries) {
            console.error(`[Req ${requestId}] All ${availableWorkers.length} workers failed after ${attempts} attempts`);
            throw new Error(`All RPC endpoints failed: ${lastError?.message || 'Unknown error'}`);
          }

          // Reset tried workers if we've tried all available ones
          if (triedWorkers.size >= availableWorkers.length) {
            triedWorkers.clear();
          }

          // Otherwise continue to next iteration to try another worker
          continue;
        }
      } else {
        // All endpoints rate limited - wait for recovery
        const recoveryTime = this.workerPool.getShortestRecoveryTime();
        const waitTime = Math.min(recoveryTime || 5000, 5000); // Check every 5s max

        console.log(`[Req ${requestId}] All endpoints rate limited. Waiting ${(waitTime / 1000).toFixed(1)}s...`);

        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Select worker using least-loaded strategy
   */
  selectWorker(workers) {
    if (workers.length === 0) {
      return null;
    }

    // Find worker with shortest queue
    return workers.reduce((min, worker) =>
      worker.getQueueLength() < min.getQueueLength() ? worker : min
    );
  }

  /**
   * Get health status from worker pool
   */
  getHealthStatus() {
    return this.workerPool.getHealthStatus();
  }

  /**
   * Get statistics from database
   */
  async getStatistics() {
    const endpointStats = this.statsRepo.getEndpointStatistics();

    const totalRequests = endpointStats.reduce((sum, s) => sum + (s.total_requests || 0), 0);
    const totalSuccessful = endpointStats.reduce((sum, s) => sum + (s.successful_requests || 0), 0);
    const totalFailed = endpointStats.reduce((sum, s) => sum + (s.failed_requests || 0), 0);
    const totalRateLimited = endpointStats.reduce((sum, s) => sum + (s.rate_limited_requests || 0), 0);

    return {
      summary: {
        totalRequests,
        totalSuccessful,
        totalFailed,
        totalRateLimited,
        successRate: totalRequests > 0 ? (totalSuccessful / totalRequests).toFixed(3) : null
      },
      endpoints: endpointStats.map(stat => ({
        url: stat.url,
        isActive: Boolean(stat.is_active),
        totalRequests: stat.total_requests || 0,
        successfulRequests: stat.successful_requests || 0,
        failedRequests: stat.failed_requests || 0,
        rateLimitedRequests: stat.rate_limited_requests || 0,
        avgResponseTimeMs: stat.avg_response_time_ms || null,
        lastRequestAt: stat.last_request_at || null,
        successRate: stat.total_requests > 0
          ? ((stat.successful_requests || 0) / stat.total_requests).toFixed(3)
          : null
      }))
    };
  }

  /**
   * Helper: sleep for ms
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = RequestRouter;
