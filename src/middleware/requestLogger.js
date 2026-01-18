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

  // Debug: log content-type and body structure for POST requests
  if (method === 'POST' && url === '/') {
    console.log(`→ ${method} ${url} [${rpcMethod}]`);
    console.log(`  Content-Type: ${req.headers['content-type']}`);
    console.log(`  Body type: ${Array.isArray(req.body) ? 'array' : typeof req.body}`);
    if (req.body) {
      console.log(`  Body keys:`, Object.keys(req.body).join(', '));
      console.log(`  Full body:`, JSON.stringify(req.body).substring(0, 200));
    }
  } else {
    console.log(`→ ${method} ${url} [${rpcMethod}]`);
  }

  // Log response when finished
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const status = res.statusCode;
    console.log(`← ${method} ${url} [${rpcMethod}] ${status} ${duration}ms`);
  });

  next();
}

module.exports = requestLogger;
