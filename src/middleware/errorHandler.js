/**
 * Error handling middleware
 * Catches any unhandled errors and returns appropriate responses
 */
function errorHandler(err, req, res, next) {
  console.error('Unhandled error:', err);

  // If headers already sent, delegate to default error handler
  if (res.headersSent) {
    return next(err);
  }

  // Return JSON-RPC error format
  res.status(500).json({
    jsonrpc: '2.0',
    error: {
      code: -32603,
      message: 'Internal server error'
    },
    id: req.body?.id || null
  });
}

module.exports = errorHandler;
