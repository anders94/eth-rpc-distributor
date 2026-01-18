const fs = require('fs');
const path = require('path');

/**
 * Load configuration from config/config.json
 * Falls back to defaults if file doesn't exist
 */
function loadConfig() {
  const configPath = path.join(__dirname, '../../config/config.json');

  const defaultConfig = {
    server: {
      port: 8545,
      host: '0.0.0.0'
    },
    endpoints: [
      'https://eth.drpc.org',
      'https://ethereum.publicnode.com',
      'https://rpc.mevblocker.io'
    ],
    rateLimit: {
      detectionThreshold: 0.5,
      minCooldownMs: 60000,
      maxCooldownMs: 300000,
      backoffMultiplier: 2,
      historyWindowSize: 20
    },
    worker: {
      requestTimeout: 30000,
      maxQueueSize: 1000,
      healthCheckInterval: 30000
    },
    database: {
      path: './data/statistics.db',
      enableWAL: true
    }
  };

  try {
    if (fs.existsSync(configPath)) {
      const fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      // Deep merge with defaults
      return mergeDeep(defaultConfig, fileConfig);
    }
  } catch (error) {
    console.log(`Warning: Could not load config file: ${error.message}`);
    console.log('Using default configuration');
  }

  return defaultConfig;
}

/**
 * Deep merge two objects
 */
function mergeDeep(target, source) {
  const output = Object.assign({}, target);

  if (isObject(target) && isObject(source)) {
    Object.keys(source).forEach(key => {
      if (isObject(source[key])) {
        if (!(key in target)) {
          Object.assign(output, { [key]: source[key] });
        } else {
          output[key] = mergeDeep(target[key], source[key]);
        }
      } else {
        Object.assign(output, { [key]: source[key] });
      }
    });
  }

  return output;
}

function isObject(item) {
  return item && typeof item === 'object' && !Array.isArray(item);
}

module.exports = {
  loadConfig
};
