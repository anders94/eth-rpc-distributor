/**
 * Database schema for SQLite
 * Tracks endpoint statistics and rate limit events
 */

const SCHEMA = {
  // Table creation SQL
  tables: {
    endpoints: `
      CREATE TABLE IF NOT EXISTS endpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE NOT NULL,
        is_active BOOLEAN DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `,

    endpoint_statistics: `
      CREATE TABLE IF NOT EXISTS endpoint_statistics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id INTEGER NOT NULL,
        total_requests INTEGER DEFAULT 0,
        successful_requests INTEGER DEFAULT 0,
        failed_requests INTEGER DEFAULT 0,
        rate_limited_requests INTEGER DEFAULT 0,
        total_response_time_ms INTEGER DEFAULT 0,
        avg_response_time_ms REAL DEFAULT 0,
        last_request_at DATETIME,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
      )
    `,

    rate_limit_events: `
      CREATE TABLE IF NOT EXISTS rate_limit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id INTEGER NOT NULL,
        detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        recovery_time DATETIME,
        cooldown_duration_ms INTEGER,
        http_status_code INTEGER,
        error_message TEXT,
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
      )
    `,

    request_log: `
      CREATE TABLE IF NOT EXISTS request_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id INTEGER NOT NULL,
        method TEXT NOT NULL,
        success BOOLEAN NOT NULL,
        response_time_ms INTEGER,
        http_status_code INTEGER,
        error_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (endpoint_id) REFERENCES endpoints(id)
      )
    `
  },

  // Index creation SQL
  indexes: {
    request_log_endpoint: `
      CREATE INDEX IF NOT EXISTS idx_request_log_endpoint
      ON request_log(endpoint_id)
    `,

    request_log_created: `
      CREATE INDEX IF NOT EXISTS idx_request_log_created
      ON request_log(created_at)
    `,

    rate_limit_endpoint: `
      CREATE INDEX IF NOT EXISTS idx_rate_limit_endpoint
      ON rate_limit_events(endpoint_id)
    `,

    rate_limit_detected: `
      CREATE INDEX IF NOT EXISTS idx_rate_limit_detected
      ON rate_limit_events(detected_at)
    `
  }
};

module.exports = SCHEMA;
