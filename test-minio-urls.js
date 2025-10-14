/**
 * Test MinIO URLs - Internal vs Public
 * Identifies which URL works from VPS
 */

const axios = require('axios');

const TEST_URLS = [
  {
    type: 'Docker Internal',
    url: 'http://minio:9000/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg',
    note: 'Only works inside Docker network'
  },
  {
    type: 'Public HTTPS',
    url: 'https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg',
    note: 'Should work from anywhere'
  },
  {
    type: 'Public HTTP',
    url: 'http://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg',
    note: 'May redirect to HTTPS'
  }
];

async function testUrl(testCase) {
  console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
  console.log(`│ Testing: ${testCase.type.padEnd(47)} │`);
  console.log(`└─────────────────────────────────────────────────────────────┘`);
  console.log(`URL: ${testCase.url.substring(0, 70)}...`);
  console.log(`Note: ${testCase.note}`);
  console.log('');

  const encodedUrl = encodeURI(testCase.url);

  try {
    const response = await axios({
      url: encodedUrl,
      method: 'HEAD',
      timeout: 5000,
      maxRedirects: 5,
      validateStatus: null
    });

    if (response.status === 200) {
      console.log('✅ SUCCESS!');
      console.log(`   Status: ${response.status}`);
      console.log(`   Content-Type: ${response.headers['content-type']}`);
      console.log(`   Content-Length: ${(parseInt(response.headers['content-length']) / 1024).toFixed(2)} KB`);
      return { success: true, status: response.status };
    } else {
      console.log(`⚠️  Response: ${response.status}`);
      console.log(`   Status Text: ${response.statusText || 'N/A'}`);
      return { success: false, status: response.status };
    }

  } catch (error) {
    console.log('❌ FAILED!');

    if (error.code === 'ENOTFOUND') {
      console.log(`   Error: Hostname not found`);
      console.log(`   Cause: "${error.hostname}" cannot be resolved`);
      console.log('');
      console.log('   💡 SOLUTION:');
      if (testCase.type === 'Docker Internal') {
        console.log('   - Add orchestrator to same Docker network as MinIO');
        console.log('   - OR use public URL instead');
      } else {
        console.log('   - Check DNS resolution');
        console.log('   - Verify domain is correct');
      }
    } else if (error.code === 'ECONNREFUSED') {
      console.log(`   Error: Connection refused`);
      console.log(`   Cause: Server not listening on ${error.port}`);
    } else if (error.code === 'ETIMEDOUT') {
      console.log(`   Error: Connection timeout`);
      console.log(`   Cause: Server not responding`);
    } else if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Error: ${error.message}`);
    } else {
      console.log(`   Error: ${error.message}`);
      console.log(`   Code: ${error.code || 'N/A'}`);
    }

    return { success: false, error: error.message, code: error.code };
  }
}

async function runTests() {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           MinIO URL Accessibility Test                       ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Testing which MinIO URL works from this environment...');

  const results = [];

  for (const testCase of TEST_URLS) {
    const result = await testUrl(testCase);
    results.push({ ...testCase, result });
  }

  // Summary
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                               ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  results.forEach(({ type, result }) => {
    const status = result.success ? '✅ WORKS' : '❌ FAILS';
    console.log(`${type}: ${status}`);
  });

  console.log('');
  console.log('─────────────────────────────────────────────────────────────');
  console.log('💡 RECOMMENDATION:');
  console.log('─────────────────────────────────────────────────────────────');

  const dockerWorks = results.find(r => r.type === 'Docker Internal')?.result.success;
  const publicWorks = results.find(r => r.type === 'Public HTTPS')?.result.success;

  if (publicWorks) {
    console.log('');
    console.log('✅ Use PUBLIC URL in your payloads:');
    console.log('   "image_url": "https://minio.automear.com/canais/..."');
    console.log('');
    console.log('   This will work from anywhere (N8N, VPS, external)');
  } else if (dockerWorks) {
    console.log('');
    console.log('✅ Docker internal URL works!');
    console.log('   You are running INSIDE the Docker network.');
    console.log('   Continue using: "http://minio:9000/..."');
  } else {
    console.log('');
    console.log('❌ Neither URL works!');
    console.log('');
    console.log('   Possible issues:');
    console.log('   1. MinIO server is down');
    console.log('   2. Network/firewall blocking access');
    console.log('   3. DNS not resolving correctly');
    console.log('   4. Images don\'t exist at this path');
    console.log('');
    console.log('   Check MinIO status:');
    console.log('   - Web UI: https://minio.automear.com/');
    console.log('   - Health: curl -I https://minio.automear.com/');
  }

  console.log('');
  console.log('─────────────────────────────────────────────────────────────\n');
}

runTests().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
