# Automatic Failover for Temporary Errors

## Problem

When an RPC endpoint returns a temporary error (like error code 19 - "Temporary internal error"), the distributor was passing the error directly back to the client instead of trying another endpoint.

Example error:
```
Error: could not coalesce error (error={ "code": 19, "message": "Temporary internal error. Please retry, trace-id: xxx" })
```

## Solution

Added intelligent error detection and automatic failover:

### 1. Temporary Error Detection

The system now identifies temporary/retryable errors by:

**Error Codes:**
- `19` - Temporary internal error
- `-32000` - Server error (often temporary)
- `-32603` - Internal error (often temporary)
- `429` - Too many requests
- `503` - Service unavailable

**Error Message Keywords:**
- "temporary"
- "retry"
- "timeout"
- "unavailable"
- "connection"
- "network"
- "overloaded"
- "capacity"

### 2. Automatic Failover

When a temporary error is detected:

1. **Log the error** and mark the endpoint as having a temporary issue
2. **Try the next available endpoint** instead of returning the error to the client
3. **Track which endpoints have been tried** to avoid infinite loops
4. **Return error only if ALL endpoints fail** with the same request

### 3. Request Flow

```
Request → Endpoint 1 → Temporary Error (code 19)
       → Endpoint 2 → Try same request
       → Endpoint 3 → Success! → Return to client
```

If all endpoints return temporary errors:
```
Request → Endpoint 1 → Temporary Error
       → Endpoint 2 → Temporary Error
       → Endpoint 3 → Temporary Error
       → Return error to client (all failed)
```

## Implementation Details

### EndpointWorker.js

Added `isTemporaryError()` method to detect retryable errors:

```javascript
isTemporaryError(rpcError) {
  // Check error code
  const temporaryErrorCodes = [19, -32000, -32603, 429, 503];
  if (temporaryErrorCodes.includes(rpcError.code)) return true;

  // Check error message
  const message = (rpcError.message || '').toLowerCase();
  const keywords = ['temporary', 'retry', 'timeout', 'unavailable', ...];
  return keywords.some(keyword => message.includes(keyword));
}
```

When a temporary error is detected, the worker rejects with `error.code = 'TEMPORARY_ERROR'` to signal the router to try another endpoint.

### RequestRouter.js

Enhanced retry logic:

- Tracks which workers have been tried for each request
- Tries all available workers before giving up
- Differentiates between temporary errors (retry with another endpoint) and permanent errors (return to client)
- Logs detailed information about retry attempts

## Benefits

1. **Better reliability** - Temporary errors from one endpoint don't cause request failures
2. **Transparent failover** - Clients don't need retry logic for temporary errors
3. **Improved success rate** - Uses all available endpoints before failing
4. **Better user experience** - Applications get successful responses instead of intermittent errors

## Testing

Run the failover test:

```bash
npm start &
sleep 3
node test-failover.js
```

Expected behavior:
- Requests succeed even if individual endpoints have temporary issues
- Server logs show automatic failover attempts
- Clients receive successful responses or only permanent errors

## Statistics

All failover attempts are tracked in the SQLite database:
- Failed requests are logged per endpoint
- Temporary errors are counted separately from permanent errors
- Success rates reflect the actual endpoint reliability
