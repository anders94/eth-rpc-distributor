// Application constants

const WORKER_STATES = {
  HEALTHY: 'HEALTHY',
  RATE_LIMITED: 'RATE_LIMITED',
  COOLING_DOWN: 'COOLING_DOWN',
  ERROR: 'ERROR'
};

const HTTP_STATUS = {
  TOO_MANY_REQUESTS: 429,
  SERVICE_UNAVAILABLE: 503,
  FORBIDDEN: 403
};

const RATE_LIMIT_KEYWORDS = [
  'rate limit',
  'too many requests',
  'exceeded',
  'quota',
  'throttle',
  'too many'
];

module.exports = {
  WORKER_STATES,
  HTTP_STATUS,
  RATE_LIMIT_KEYWORDS
};
