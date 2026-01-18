#!/bin/bash

echo "Starting RPC Distributor..."
node src/index.js > /tmp/rpc-server.log 2>&1 &
PID=$!

sleep 3

echo ""
echo "Testing RPC Request..."
curl -s -X POST http://localhost:8545 \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' | jq '.'

echo ""
echo "Testing Health Endpoint..."
curl -s http://localhost:8545/health | jq '.status, .availableWorkers, .totalWorkers'

echo ""
echo "Stopping server..."
kill $PID 2>/dev/null
wait $PID 2>/dev/null

echo "Done!"
