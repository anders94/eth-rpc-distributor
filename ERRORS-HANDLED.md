# Temporary Errors Automatically Handled

The RPC distributor automatically detects and retries the following temporary errors by failing over to other endpoints:

## Error Codes

| Code | Description | Example Message |
|------|-------------|-----------------|
| `14` | GRPC Context cancellation | "GRPC Context cancellation" |
| `19` | Temporary internal error | "Temporary internal error. Please retry, trace-id: xxx" |
| `-32000` | Server error | "Server error" |
| `-32603` | Internal error | "Internal error" |
| `429` | Too many requests | "Too Many Requests" |
| `503` | Service unavailable | "Service Unavailable" |

## Error Message Keywords

The system also detects errors by analyzing error messages for these keywords:

- `temporary`
- `retry`
- `timeout` / `timed out`
- `unavailable`
- `connection`
- `network`
- `try again`
- `overloaded`
- `capacity`
- `grpc`
- `cancel`

## How Failover Works

When a temporary error is detected:

### Example 1: Single endpoint failure
```
Request eth_chainId
  → https://eth.drpc.org
     Returns: { error: { code: 14, message: "GRPC Context cancellation" } }
     Detected as temporary ✓

  → https://ethereum.publicnode.com
     Returns: { result: "0x1" }
     Success! ✓

Client receives: { result: "0x1" }
```

### Example 2: Multiple endpoint failures
```
Request eth_getBlockByNumber
  → https://eth.drpc.org
     Returns: { error: { code: 19, message: "Temporary internal error" } }
     Detected as temporary ✓

  → https://ethereum.publicnode.com
     Returns: { error: { code: 19, message: "Temporary internal error" } }
     Detected as temporary ✓

  → https://rpc.mevblocker.io
     Returns: { result: { ... block data ... } }
     Success! ✓

Client receives: { result: { ... block data ... } }
```

### Example 3: All endpoints fail
```
Request eth_chainId
  → https://eth.drpc.org
     Returns: { error: { code: 14, message: "GRPC Context cancellation" } }

  → https://ethereum.publicnode.com
     Returns: { error: { code: 14, message: "GRPC Context cancellation" } }

  → https://rpc.mevblocker.io
     Returns: { error: { code: 14, message: "GRPC Context cancellation" } }

All endpoints failed ✗
Client receives: Error: All RPC endpoints failed: GRPC Context cancellation
```

## Benefits for Your Application

### Before (without failover)
```javascript
// Your application code
const provider = new JsonRpcProvider('http://localhost:8545');
const chainId = await provider.getNetwork(); // ✗ Throws error code 14
```

Result: **Job fails** ❌

### After (with automatic failover)
```javascript
// Same application code - no changes needed!
const provider = new JsonRpcProvider('http://localhost:8545');
const chainId = await provider.getNetwork(); // ✓ Returns chain ID
```

Result: **Job succeeds** ✅

The distributor automatically:
1. Detects the temporary error
2. Tries another endpoint
3. Returns the successful response
4. Your application never sees the error!

## Monitoring

Check server logs to see failover in action:

```
[Req 1362] Routing eth_chainId
[Req 1362] Attempting with https://eth.drpc.org (queue: 0, attempt 1)
https://eth.drpc.org - Temporary error (code 14): GRPC Context cancellation
[Req 1362] Temporary error from https://eth.drpc.org, trying next endpoint
[Req 1362] Attempting with https://ethereum.publicnode.com (queue: 0, attempt 2)
[Req 1362] Success with https://ethereum.publicnode.com
```

## Statistics

All failover attempts are recorded in the database:

```sql
-- See which endpoints have the most temporary errors
SELECT
  e.url,
  COUNT(*) as temp_errors
FROM request_log r
JOIN endpoints e ON r.endpoint_id = e.id
WHERE r.success = 0
  AND r.error_message LIKE '%temporary%'
    OR r.error_message LIKE '%GRPC%'
    OR r.error_message LIKE '%code 14%'
    OR r.error_message LIKE '%code 19%'
GROUP BY e.url
ORDER BY temp_errors DESC;
```

## Configuration

No configuration needed! Automatic failover is enabled by default.

To add more endpoints for better redundancy, edit `config/config.json`:

```json
{
  "endpoints": [
    "https://eth.drpc.org",
    "https://ethereum.publicnode.com",
    "https://rpc.mevblocker.io",
    "https://your-additional-endpoint.com"  // Add more endpoints here
  ]
}
```

More endpoints = better reliability when temporary errors occur.
