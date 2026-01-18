# Ethereum RPC Distributor

A Node.js/Express-based Ethereum RPC proxy that intelligently distributes requests across multiple RPC endpoints with adaptive rate limiting, automatic failover, and persistent statistics.

## Features

- **Adaptive Rate Limiting**: Automatically detects and responds to rate limits using multiple heuristics
- **Intelligent Failover**: Automatically routes requests to healthy endpoints when others are rate limited
- **Connection Holding**: Holds client connections open rather than returning errors, transparently waiting for endpoint availability
- **Single Worker Per Endpoint**: Prevents parallel requests that could trigger rate limits
- **Persistent Statistics**: Tracks endpoint performance and rate limit patterns across restarts using SQLite
- **Zero Downtime**: Graceful shutdown ensures in-flight requests complete before exit

## How It Works

```
Client → Express Server → RequestRouter → EndpointWorker Queue → RPC Endpoint → Response
                              ↓ (if rate limited)
                         Try Next Available Worker
                              ↓ (if all rate limited)
                         Wait & Hold Connection Open
```

### Key Concepts

1. **Single Worker Per Endpoint**: Each RPC endpoint has a dedicated worker with a sequential queue. This prevents multiple parallel requests from triggering rate limits.

2. **Adaptive Rate Detection**: Uses multiple signals to detect rate limiting:
   - HTTP status codes (429, 503, 403)
   - Response body keywords ("rate limit", "too many requests", etc.)
   - Failure rate analysis (high failure percentage in recent requests)
   - Timeout patterns

3. **Smart Cooldown**: When rate limited, endpoints enter a cooldown period with exponential backoff:
   - Base: 60 seconds
   - Exponential increase: 60s → 120s → 240s → 300s (max)
   - Respects `Retry-After` headers when present
   - Learns from historical patterns

4. **Connection Holding**: Unlike traditional proxies that return 503 errors, this distributor holds connections open and waits for endpoint availability, providing a seamless experience for clients.

## Installation

```bash
npm install
```

## Configuration

Edit `config/config.json` to configure endpoints and behavior:

```json
{
  "server": {
    "port": 8545,
    "host": "0.0.0.0"
  },
  "endpoints": [
    "https://eth.drpc.org",
    "https://ethereum.publicnode.com",
    "https://rpc.mevblocker.io"
  ],
  "rateLimit": {
    "detectionThreshold": 0.5,
    "minCooldownMs": 60000,
    "maxCooldownMs": 300000,
    "backoffMultiplier": 2,
    "historyWindowSize": 20
  },
  "worker": {
    "requestTimeout": 30000,
    "maxQueueSize": 1000,
    "healthCheckInterval": 30000
  },
  "database": {
    "path": "./data/statistics.db",
    "enableWAL": true
  }
}
```

### Configuration Options

#### Server
- `port`: Port to listen on (default: 8545, standard Ethereum RPC port)
- `host`: Host to bind to (default: 0.0.0.0)

#### Endpoints
- Array of RPC endpoint URLs to distribute requests across

#### Rate Limit
- `detectionThreshold`: Failure rate threshold to suspect rate limiting (0-1)
- `minCooldownMs`: Minimum cooldown duration (milliseconds)
- `maxCooldownMs`: Maximum cooldown duration (milliseconds)
- `backoffMultiplier`: Exponential backoff multiplier
- `historyWindowSize`: Number of recent requests to analyze for patterns

#### Worker
- `requestTimeout`: HTTP request timeout (milliseconds)
- `maxQueueSize`: Maximum requests per worker queue
- `healthCheckInterval`: Interval for health checks (milliseconds)

#### Database
- `path`: SQLite database file path
- `enableWAL`: Enable Write-Ahead Logging for better concurrency

## Usage

### Start the Server

```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

### Making Requests

The distributor accepts any Ethereum JSON-RPC request on port 8545:

```bash
curl -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "eth_blockNumber",
    "params": [],
    "id": 1
  }'
```

### Health Check

```bash
curl http://localhost:8545/health
```

Response:
```json
{
  "status": "healthy",
  "availableWorkers": 3,
  "totalWorkers": 3,
  "workers": [
    {
      "url": "https://eth.drpc.org",
      "state": "HEALTHY",
      "queueLength": 0,
      "cooldownUntil": null,
      "isAvailable": true,
      "successRate": "0.985",
      "avgResponseTime": 245.3,
      "totalRequests": 1523
    }
  ]
}
```

### Statistics

```bash
curl http://localhost:8545/stats
```

Response:
```json
{
  "summary": {
    "totalRequests": 5432,
    "totalSuccessful": 5398,
    "totalFailed": 34,
    "totalRateLimited": 12,
    "successRate": "0.994"
  },
  "endpoints": [
    {
      "url": "https://eth.drpc.org",
      "isActive": true,
      "totalRequests": 1812,
      "successfulRequests": 1798,
      "failedRequests": 14,
      "rateLimitedRequests": 4,
      "avgResponseTimeMs": 245.3,
      "lastRequestAt": "2026-01-18T10:30:45.123Z",
      "successRate": "0.992"
    }
  ]
}
```

## Architecture

### Project Structure

```
eth-rpc-distributor/
├── src/
│   ├── index.js                    # Entry point with startup/shutdown
│   ├── server.js                   # Express server setup
│   ├── config/
│   │   └── config.js               # Configuration loader
│   ├── core/
│   │   ├── EndpointWorker.js       # Queue-based worker per endpoint
│   │   ├── RateLimitDetector.js    # Adaptive rate limit detection
│   │   ├── RequestRouter.js        # Request routing with failover
│   │   └── WorkerPool.js           # Worker management & health checks
│   ├── database/
│   │   ├── database.js             # SQLite connection & initialization
│   │   ├── schema.js               # Database schema definitions
│   │   └── StatisticsRepository.js # Statistics CRUD operations
│   ├── middleware/
│   │   ├── requestLogger.js        # Request logging
│   │   └── errorHandler.js         # Error handling
│   └── utils/
│       └── constants.js            # Application constants
├── config/
│   └── config.json                 # Configuration file
└── data/
    └── statistics.db               # SQLite database (auto-created)
```

### Core Components

#### EndpointWorker
Handles sequential request processing for a single endpoint with:
- Promise-based queue management
- State machine: HEALTHY → RATE_LIMITED → COOLING_DOWN → HEALTHY
- Automatic cooldown and recovery
- Statistics tracking

#### RateLimitDetector
Detects rate limiting through:
- HTTP status code analysis
- Response body keyword matching
- Recent failure rate patterns
- Timeout detection
- Historical pattern learning

#### RequestRouter
Routes requests with:
- Least-loaded worker selection
- Automatic failover to healthy endpoints
- Connection holding when all endpoints are rate limited
- Configurable retry logic

#### WorkerPool
Manages workers with:
- Periodic health checks for failed endpoints
- Overall pool health monitoring
- Graceful shutdown coordination

## Database Schema

### Tables

- **endpoints**: Stores RPC endpoint URLs and status
- **endpoint_statistics**: Aggregated statistics per endpoint
- **rate_limit_events**: Historical rate limit detections
- **request_log**: Individual request history for pattern analysis

Statistics are persisted automatically and survive restarts, allowing the system to learn optimal cooldown patterns over time.

## Graceful Shutdown

The application handles shutdown signals (SIGTERM, SIGINT) gracefully:

1. Stop accepting new HTTP connections
2. Stop health check intervals
3. Wait up to 30 seconds for in-flight requests to complete
4. Flush final statistics to database
5. Close database connection
6. Exit cleanly

Press `Ctrl+C` to trigger graceful shutdown.

## Monitoring

Watch console output for real-time operation:

```
→ POST / [eth_blockNumber]
[Req 1] Routing eth_blockNumber
[Req 1] Attempting with https://eth.drpc.org (queue: 0)
[Req 1] Success with https://eth.drpc.org
← POST / [eth_blockNumber] 200 245ms
```

Rate limit events:
```
https://eth.drpc.org - Rate limit detected (confidence: 0.75)
https://eth.drpc.org - Entering cooldown for 60.0s until 2026-01-18T10:31:45.000Z
[Req 2] All endpoints rate limited. Waiting 5.0s...
```

## Querying the Database

The SQLite database can be queried directly for detailed analytics:

```bash
sqlite3 data/statistics.db

# View rate limit events
SELECT datetime(detected_at), url, cooldown_duration_ms/1000 as cooldown_sec
FROM rate_limit_events e
JOIN endpoints ep ON e.endpoint_id = ep.id
ORDER BY detected_at DESC
LIMIT 10;

# View success rates
SELECT url,
       total_requests,
       successful_requests,
       ROUND(100.0 * successful_requests / total_requests, 2) as success_pct
FROM endpoint_statistics s
JOIN endpoints e ON s.endpoint_id = e.id;
```

## Troubleshooting

### All endpoints showing as rate limited

- Check that endpoints are reachable: `curl https://eth.drpc.org`
- Verify config.json endpoints are correct
- Check console for specific error messages
- Query database for rate limit history

### High failure rates

- Increase `requestTimeout` in config if seeing timeouts
- Check endpoint health independently
- Review `request_log` table for error patterns

### Queue buildup

- Check `/health` endpoint for queue lengths
- Verify endpoints are responding
- Consider adding more endpoints to `config.json`

## Performance Considerations

- **Single-threaded workers**: Prevents rate limit triggers but limits throughput per endpoint
- **Database writes**: Each request writes to SQLite; negligible overhead for typical loads
- **Memory usage**: Queues are bounded by `maxQueueSize` (default: 1000 per endpoint)
- **Connection pooling**: Axios handles connection pooling automatically

## License

ISC
