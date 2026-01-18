const { loadConfig } = require('./config/config');
const DatabaseManager = require('./database/database');
const StatisticsRepository = require('./database/StatisticsRepository');
const WorkerPool = require('./core/WorkerPool');
const RequestRouter = require('./core/RequestRouter');
const { startServer } = require('./server');

/**
 * Main application startup
 */
async function startup() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Starting Ethereum RPC Distributor');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // 1. Load configuration
    console.log('\n1. Loading configuration...');
    const config = loadConfig();

    // 2. Initialize database
    console.log('\n2. Initializing database...');
    const dbManager = new DatabaseManager(config.database);
    await dbManager.initialize();
    const db = dbManager.getDb();

    // 3. Create statistics repository
    console.log('\n3. Creating statistics repository...');
    const statsRepo = new StatisticsRepository(db, dbManager);

    // 4. Initialize worker pool
    console.log('\n4. Initializing worker pool...');
    const workerPool = new WorkerPool(config.endpoints, config, statsRepo);

    // 5. Start health checks
    console.log('\n5. Starting health checks...');
    workerPool.startHealthChecks();

    // 6. Initialize request router
    console.log('\n6. Initializing request router...');
    const router = new RequestRouter(workerPool, statsRepo);

    // 7. Start Express server
    console.log('\n7. Starting HTTP server...');
    const server = startServer(router, config);

    // 8. Setup graceful shutdown
    setupGracefulShutdown(server, workerPool, dbManager);

    console.log('✓ Startup complete\n');

    return { server, workerPool, dbManager, router };
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(server, workerPool, dbManager) {
  const shutdown = async (signal) => {
    console.log(`\n${signal} received - starting graceful shutdown...`);

    // 1. Stop accepting new connections
    console.log('1. Closing HTTP server...');
    server.close(() => {
      console.log('   ✓ HTTP server closed');
    });

    // 2. Stop health checks
    console.log('2. Stopping health checks...');
    workerPool.stopHealthChecks();
    console.log('   ✓ Health checks stopped');

    // 3. Wait for in-flight requests (with timeout)
    console.log('3. Waiting for in-flight requests...');
    const shutdownTimeout = 30000; // 30 seconds
    const startTime = Date.now();

    while (workerPool.hasActiveRequests()) {
      if (Date.now() - startTime > shutdownTimeout) {
        console.log('   ⚠ Shutdown timeout reached, forcing exit');
        break;
      }
      await sleep(100);
    }
    console.log('   ✓ All requests completed');

    // 4. Flush statistics
    console.log('4. Flushing statistics...');
    await workerPool.flushStatistics();
    console.log('   ✓ Statistics flushed');

    // 5. Close database connection
    console.log('5. Closing database...');
    dbManager.close();
    console.log('   ✓ Database closed');

    console.log('\n✓ Graceful shutdown complete');
    process.exit(0);
  };

  // Handle termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    shutdown('UNHANDLED_REJECTION');
  });
}

/**
 * Helper: sleep for ms
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Start the application
startup();
