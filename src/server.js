const express = require('express');
const requestLogger = require('./middleware/requestLogger');
const errorHandler = require('./middleware/errorHandler');

/**
 * Create and configure Express server
 */
function createServer(router, config) {
  const app = express();

  // Parse JSON bodies (with increased limit for large RPC requests)
  app.use(express.json({ limit: '10mb' }));

  // Request logging middleware
  app.use(requestLogger);

  // Health check endpoint
  app.get('/health', (req, res) => {
    try {
      const status = router.getHealthStatus();
      const httpStatus = status.status === 'healthy' ? 200 : 503;
      res.status(httpStatus).json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get health status' });
    }
  });

  // Statistics endpoint
  app.get('/stats', async (req, res) => {
    try {
      const stats = await router.getStatistics();
      res.json(stats);
    } catch (error) {
      console.error('Error getting statistics:', error);
      res.status(500).json({ error: 'Failed to get statistics' });
    }
  });

  // Main RPC proxy endpoint - accepts all Ethereum JSON-RPC methods
  app.post('/', async (req, res) => {
    try {
      // Validate JSON-RPC format
      if (!req.body || !req.body.jsonrpc) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: missing jsonrpc field'
          },
          id: req.body?.id || null
        });
      }

      if (!req.body.method) {
        return res.status(400).json({
          jsonrpc: '2.0',
          error: {
            code: -32600,
            message: 'Invalid Request: missing method field'
          },
          id: req.body.id || null
        });
      }

      // Route request through the router (holds connection until response)
      const result = await router.routeRequest(req.body);

      // Forward the complete response from the RPC endpoint
      res.json(result);

    } catch (error) {
      console.error('Request failed:', error.message);

      res.json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: `Internal error: ${error.message}`
        },
        id: req.body?.id || null
      });
    }
  });

  // Error handling middleware
  app.use(errorHandler);

  return app;
}

/**
 * Start the server
 */
function startServer(router, config) {
  const app = createServer(router, config);

  const server = app.listen(config.server.port, config.server.host, () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║  Ethereum RPC Distributor                                 ║
║  Server listening on ${config.server.host}:${config.server.port.toString().padEnd(28)} ║
║  Endpoints: ${config.endpoints.length.toString().padEnd(48)} ║
╚═══════════════════════════════════════════════════════════╝
    `);
    console.log('Configured endpoints:');
    config.endpoints.forEach((endpoint, i) => {
      console.log(`  ${i + 1}. ${endpoint}`);
    });
    console.log('');
  });

  return server;
}

module.exports = {
  createServer,
  startServer
};
