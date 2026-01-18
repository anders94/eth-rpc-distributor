// Test with actual ethers.js library
const { JsonRpcProvider } = require('ethers');

async function testWithEthers() {
  console.log('Testing with real ethers.js...\n');

  try {
    console.log('Creating JsonRpcProvider...');
    const provider = new JsonRpcProvider('http://localhost:8545');

    console.log('Getting network...');
    const network = await provider.getNetwork();
    console.log('Network:', network.chainId.toString());

    console.log('\nGetting block number...');
    const blockNumber = await provider.getBlockNumber();
    console.log('Block number:', blockNumber);

    console.log('\n✓ All ethers.js tests passed!');
  } catch (error) {
    console.error('\n✗ Error:', error.message);
    console.error('Code:', error.code);
    if (error.info) {
      console.error('Info:', JSON.stringify(error.info, null, 2));
    }
  }
}

testWithEthers().catch(console.error);
