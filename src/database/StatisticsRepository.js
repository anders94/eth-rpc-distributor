/**
 * StatisticsRepository - CRUD operations for statistics database
 * Adapted for sql.js
 */
class StatisticsRepository {
  constructor(db, dbManager) {
    this.db = db;
    this.dbManager = dbManager;
  }

  /**
   * Ensure endpoint exists in database, create if not
   * Returns endpoint ID
   */
  ensureEndpoint(url) {
    try {
      // Try to get existing endpoint
      const stmt = this.db.prepare('SELECT id FROM endpoints WHERE url = ?');
      stmt.bind([url]);

      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result.id;
      }
      stmt.free();

      // Create new endpoint
      this.db.run('INSERT INTO endpoints (url, is_active) VALUES (?, 1)', [url]);

      // Get the ID of the inserted row
      const idStmt = this.db.prepare('SELECT last_insert_rowid() as id');
      idStmt.step();
      const endpointId = idStmt.getAsObject().id;
      idStmt.free();

      // Create initial statistics record
      this.db.run('INSERT INTO endpoint_statistics (endpoint_id) VALUES (?)', [endpointId]);

      console.log(`Created endpoint: ${url} (ID: ${endpointId})`);

      // Save database
      this.dbManager.save();

      return endpointId;
    } catch (error) {
      console.error(`Error ensuring endpoint ${url}:`, error);
      throw error;
    }
  }

  /**
   * Get endpoint ID by URL
   */
  getEndpointId(url) {
    const stmt = this.db.prepare('SELECT id FROM endpoints WHERE url = ?');
    stmt.bind([url]);

    if (stmt.step()) {
      const result = stmt.getAsObject();
      stmt.free();
      return result.id;
    }
    stmt.free();
    return null;
  }

  /**
   * Record a request (success or failure)
   */
  recordRequest(endpointId, method, success, responseTimeMs, httpStatusCode = null, errorMessage = null) {
    try {
      // Insert into request log
      this.db.run(
        'INSERT INTO request_log (endpoint_id, method, success, response_time_ms, http_status_code, error_message) VALUES (?, ?, ?, ?, ?, ?)',
        [endpointId, method, success ? 1 : 0, responseTimeMs, httpStatusCode, errorMessage]
      );

      // Get current statistics
      const stmt = this.db.prepare('SELECT * FROM endpoint_statistics WHERE endpoint_id = ?');
      stmt.bind([endpointId]);

      if (stmt.step()) {
        const stats = stmt.getAsObject();
        stmt.free();

        const newTotalRequests = (stats.total_requests || 0) + 1;
        const newSuccessful = success ? (stats.successful_requests || 0) + 1 : (stats.successful_requests || 0);
        const newFailed = success ? (stats.failed_requests || 0) : (stats.failed_requests || 0) + 1;
        const newTotalResponseTime = (stats.total_response_time_ms || 0) + (responseTimeMs || 0);
        const newAvgResponseTime = newTotalResponseTime / newTotalRequests;

        // Update aggregate statistics
        this.db.run(
          `UPDATE endpoint_statistics
           SET total_requests = ?,
               successful_requests = ?,
               failed_requests = ?,
               total_response_time_ms = ?,
               avg_response_time_ms = ?,
               last_request_at = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE endpoint_id = ?`,
          [newTotalRequests, newSuccessful, newFailed, newTotalResponseTime, newAvgResponseTime, endpointId]
        );
      } else {
        stmt.free();
      }

      // Periodically save database (every 10 requests)
      if (Math.random() < 0.1) {
        this.dbManager.save();
      }
    } catch (error) {
      console.error('Error recording request:', error);
    }
  }

  /**
   * Record a rate limit event
   */
  recordRateLimitEvent(endpointId, cooldownMs, httpStatusCode = null, errorMessage = null) {
    try {
      const recoveryTime = new Date(Date.now() + cooldownMs).toISOString();

      this.db.run(
        'INSERT INTO rate_limit_events (endpoint_id, recovery_time, cooldown_duration_ms, http_status_code, error_message) VALUES (?, ?, ?, ?, ?)',
        [endpointId, recoveryTime, cooldownMs, httpStatusCode, errorMessage]
      );

      // Update rate limited request count
      this.db.run(
        'UPDATE endpoint_statistics SET rate_limited_requests = rate_limited_requests + 1, updated_at = CURRENT_TIMESTAMP WHERE endpoint_id = ?',
        [endpointId]
      );

      console.log(`Recorded rate limit event for endpoint ${endpointId}: cooldown ${cooldownMs}ms`);

      this.dbManager.save();
    } catch (error) {
      console.error('Error recording rate limit event:', error);
    }
  }

  /**
   * Load rate limit history for an endpoint
   * Returns recent rate limit events (last N days)
   */
  loadRateLimitHistory(endpointId, days = 7) {
    try {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const stmt = this.db.prepare(
        'SELECT * FROM rate_limit_events WHERE endpoint_id = ? AND detected_at >= ? ORDER BY detected_at DESC'
      );
      stmt.bind([endpointId, cutoffDate]);

      const events = [];
      while (stmt.step()) {
        events.push(stmt.getAsObject());
      }
      stmt.free();

      return events;
    } catch (error) {
      console.error('Error loading rate limit history:', error);
      return [];
    }
  }

  /**
   * Get recent request history for pattern analysis
   */
  getRecentRequests(endpointId, limit = 20) {
    try {
      const stmt = this.db.prepare(
        'SELECT * FROM request_log WHERE endpoint_id = ? ORDER BY created_at DESC LIMIT ?'
      );
      stmt.bind([endpointId, limit]);

      const requests = [];
      while (stmt.step()) {
        requests.push(stmt.getAsObject());
      }
      stmt.free();

      return requests.reverse(); // Return oldest to newest
    } catch (error) {
      console.error('Error getting recent requests:', error);
      return [];
    }
  }

  /**
   * Get statistics for all endpoints
   */
  getEndpointStatistics() {
    try {
      const stmt = this.db.prepare(`
        SELECT
          e.id,
          e.url,
          e.is_active,
          s.total_requests,
          s.successful_requests,
          s.failed_requests,
          s.rate_limited_requests,
          s.avg_response_time_ms,
          s.last_request_at
        FROM endpoints e
        LEFT JOIN endpoint_statistics s ON e.id = s.endpoint_id
        ORDER BY e.url
      `);

      const stats = [];
      while (stmt.step()) {
        stats.push(stmt.getAsObject());
      }
      stmt.free();

      return stats;
    } catch (error) {
      console.error('Error getting endpoint statistics:', error);
      return [];
    }
  }

  /**
   * Get statistics for a specific endpoint
   */
  getEndpointStatById(endpointId) {
    try {
      const stmt = this.db.prepare(`
        SELECT
          e.id,
          e.url,
          e.is_active,
          s.total_requests,
          s.successful_requests,
          s.failed_requests,
          s.rate_limited_requests,
          s.avg_response_time_ms,
          s.last_request_at
        FROM endpoints e
        LEFT JOIN endpoint_statistics s ON e.id = s.endpoint_id
        WHERE e.id = ?
      `);
      stmt.bind([endpointId]);

      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result;
      }
      stmt.free();
      return null;
    } catch (error) {
      console.error('Error getting endpoint stat:', error);
      return null;
    }
  }

  /**
   * Calculate average cooldown duration from history
   */
  getAverageCooldown(endpointId, days = 7) {
    try {
      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

      const stmt = this.db.prepare(
        'SELECT AVG(cooldown_duration_ms) as avg_cooldown FROM rate_limit_events WHERE endpoint_id = ? AND detected_at >= ?'
      );
      stmt.bind([endpointId, cutoffDate]);

      if (stmt.step()) {
        const result = stmt.getAsObject();
        stmt.free();
        return result.avg_cooldown ? result.avg_cooldown : null;
      }
      stmt.free();
      return null;
    } catch (error) {
      console.error('Error calculating average cooldown:', error);
      return null;
    }
  }
}

module.exports = StatisticsRepository;
