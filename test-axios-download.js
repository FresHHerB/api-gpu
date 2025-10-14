/**
 * Test Axios Download on VPS
 * Simulates exact same download logic as LocalVideoProcessor
 */

const axios = require('axios');
const fs = require('fs');

// Test URLs
const TEST_URLS = [
  {
    id: 41,
    project: "3 Contos VERDADEIROS...",
    url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"
  },
  {
    id: 42,
    project: "4 Casos VERDADEIROS...",
    url: "https://minio.automear.com/canais/Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/imagem_1.jpg"
  }
];

async function testDownload(testCase) {
  console.log(`\n========================================`);
  console.log(`Testing idRoteiro ${testCase.id}`);
  console.log(`Project: ${testCase.project}`);
  console.log(`========================================`);

  const encodedUrl = encodeURI(testCase.url);

  console.log(`Original URL: ${testCase.url}`);
  console.log(`Encoded URL:  ${encodedUrl}`);
  console.log('');

  try {
    console.log('Step 1: Testing with HEAD request...');
    const headResponse = await axios({
      url: encodedUrl,
      method: 'HEAD',
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: null // Accept any status
    });

    console.log(`  Status: ${headResponse.status}`);
    console.log(`  Headers:`);
    console.log(`    Content-Type: ${headResponse.headers['content-type']}`);
    console.log(`    Content-Length: ${headResponse.headers['content-length']}`);
    console.log(`    Server: ${headResponse.headers['server'] || 'N/A'}`);

    if (headResponse.status === 200) {
      console.log('  ✅ HEAD request successful\n');

      console.log('Step 2: Testing with GET request (stream)...');

      const getResponse = await axios({
        url: encodedUrl,
        method: 'GET',
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 5
      });

      console.log(`  Status: ${getResponse.status}`);

      // Try to read first bytes
      let bytesRead = 0;
      let chunks = [];

      return new Promise((resolve, reject) => {
        getResponse.data.on('data', (chunk) => {
          bytesRead += chunk.length;
          chunks.push(chunk);
          if (bytesRead >= 1024) {
            // Stop after 1KB
            getResponse.data.destroy();
          }
        });

        getResponse.data.on('end', () => {
          console.log(`  ✅ Stream successful - Read ${bytesRead} bytes`);

          // Save to file
          const buffer = Buffer.concat(chunks);
          const filename = `/tmp/test-${testCase.id}.jpg`;
          fs.writeFileSync(filename, buffer);
          console.log(`  Saved to: ${filename}`);

          resolve({ success: true, status: 200 });
        });

        getResponse.data.on('error', (error) => {
          console.error(`  ❌ Stream error: ${error.message}`);
          reject(error);
        });
      });

    } else if (headResponse.status === 404) {
      console.log('  ❌ HEAD request returned 404 - Image not found\n');
      return { success: false, status: 404, reason: 'Not Found' };
    } else if (headResponse.status === 403) {
      console.log('  ❌ HEAD request returned 403 - Access Denied\n');
      return { success: false, status: 403, reason: 'Forbidden' };
    } else {
      console.log(`  ⚠️  Unexpected status: ${headResponse.status}\n`);
      return { success: false, status: headResponse.status, reason: 'Unexpected status' };
    }

  } catch (error) {
    console.log('');
    console.log(`❌ ERROR: ${error.message}`);

    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Status Text: ${error.response.statusText}`);
      console.log(`   Headers:`, error.response.headers);
    } else if (error.request) {
      console.log(`   No response received`);
      console.log(`   Error code: ${error.code}`);
    }

    return {
      success: false,
      error: error.message,
      status: error.response?.status || 'ERROR',
      code: error.code
    };
  }
}

async function runTests() {
  console.log('==========================================');
  console.log('🧪 Axios Download Test (VPS)');
  console.log('==========================================');
  console.log('This simulates EXACTLY what LocalVideoProcessor does');
  console.log('');

  const results = [];

  for (const testCase of TEST_URLS) {
    const result = await testDownload(testCase);
    results.push({ ...testCase, result });
  }

  // Summary
  console.log('\n==========================================');
  console.log('📊 SUMMARY');
  console.log('==========================================\n');

  results.forEach(({ id, project, result }) => {
    const status = result.success ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`idRoteiro ${id}: ${status}`);
    console.log(`  Project: ${project}`);
    if (result.success) {
      console.log(`  Status: ${result.status}`);
    } else {
      console.log(`  Error: ${result.error || result.reason}`);
      console.log(`  Status: ${result.status}`);
    }
    console.log('');
  });

  // Diagnosis
  console.log('==========================================');
  console.log('💡 DIAGNOSIS');
  console.log('==========================================\n');

  const allFailed = results.every(r => !r.result.success);
  const someFailed = results.some(r => !r.result.success);
  const allSuccess = results.every(r => r.result.success);

  if (allSuccess) {
    console.log('✅ All downloads successful!');
    console.log('   The images ARE accessible from VPS.');
    console.log('   Previous 404 errors may have been temporary.');
    console.log('   Try processing a job again.');
  } else if (allFailed) {
    console.log('❌ All downloads failed!');
    console.log('   This indicates a network/connectivity issue.');
    console.log('');
    console.log('   Possible causes:');
    console.log('   - DNS not resolving minio.automear.com');
    console.log('   - Firewall blocking outbound HTTPS');
    console.log('   - MinIO server down');
    console.log('   - Certificate validation failing');
  } else {
    console.log('⚠️  Mixed results!');
    console.log('');

    const failed = results.filter(r => !r.result.success);
    failed.forEach(({ id, project }) => {
      console.log(`   idRoteiro ${id} (${project}): FAILED`);
      console.log(`   → Images for this project don't exist in MinIO`);
    });

    console.log('');
    console.log('   ✅ SOLUTION: Use a project with existing images');
    console.log('      or re-upload the missing images to MinIO');
  }

  console.log('');
  console.log('==========================================\n');
}

// Run
runTests().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
