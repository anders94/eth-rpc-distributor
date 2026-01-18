/**
 * Request logging middleware
 * Logs incoming requests with basic information
 */
function requestLogger(req, res, next) {
  const startTime = Date.now();

  // Log request
  const method = req.method;
  const url = req.url;
  const rpcMethod = req.body?.method || 'unknown';

  console.log(`→ ${method} ${url} [${rpcMethod}]`);

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    console.log(`← ${method} ${url} [${rpcMethod}] ${status} ${duration}ms`);
  });

  next();
}

module.exports = requestLogger;
