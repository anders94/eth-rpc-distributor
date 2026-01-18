// Test script to simulate ethers.js requests
const axios = require('axios');

async function testRPCRequests() {
  console.log('Testing RPC Distributor with ethers.js-style requests...\n');

  // Test 1: Valid request
  console.log('1. Testing valid request...');
  try {
    const response = await axios.post('http://localhost:8545', {
      jsonrpc: '2.0',
      method: 'eth_blockNumber',
      params: [],
      id: 1
    });
    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(response.data).substring(0, 100));
    console.log('   ✓ Valid request works\n');
  } catch (error) {
    console.log('   ✗ Failed:', error.message, '\n');
  }

  // Test 2: Missing jsonrpc field (should return HTTP 200 with error in body)
  console.log('2. Testing missing jsonrpc field...');
  try {
    const response = await axios.post('http://localhost:8545', {
      method: 'eth_blockNumber',
      params: [],
      id: 2
    }, {
      validateStatus: () => true // Accept any status code
    });
    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(response.data));
    if (response.status === 200 && response.data.error) {
      console.log('   ✓ Returns HTTP 200 with error (correct JSON-RPC behavior)\n');
    } else {
      console.log('   ✗ Wrong status code\n');
    }
  } catch (error) {
    console.log('   ✗ Failed:', error.message, '\n');
  }

  // Test 3: Request with text/plain content type
  console.log('3. Testing with text/plain content-type...');
  try {
    const response = await axios.post('http://localhost:8545',
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 3
      }),
      {
        headers: {
          'Content-Type': 'text/plain'
        }
      }
    );
    console.log('   Status:', response.status);
    console.log('   Response:', JSON.stringify(response.data).substring(0, 100));
    console.log('   ✓ text/plain content-type works\n');
  } catch (error) {
    console.log('   ✗ Failed:', error.message, '\n');
  }

  console.log('Tests complete!');
}

testRPCRequests().catch(console.error);
