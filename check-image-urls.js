/**
 * Check Image URLs Accessibility
 * Tests if all image URLs from payload are accessible
 */

const axios = require('axios');

// Sample URLs from your payload
const TEST_URLS = [
  "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg",
  "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_2.jpg",
  "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_3.jpg"
];

async function checkUrl(url) {
  const encodedUrl = encodeURI(url);

  try {
    const response = await axios({
      url: encodedUrl,
      method: 'HEAD', // Only fetch headers, not the full image
      timeout: 10000,
      maxRedirects: 5,
      validateStatus: null // Accept any status code
    });

    return {
      url,
      encodedUrl,
      status: response.status,
      success: response.status >= 200 && response.status < 300,
      size: response.headers['content-length'],
      contentType: response.headers['content-type']
    };

  } catch (error) {
    return {
      url,
      encodedUrl,
      status: error.response?.status || 'ERROR',
      success: false,
      error: error.message,
      code: error.code
    };
  }
}

async function checkAllUrls() {
  console.log('========================================');
  console.log('🔍 Checking Image URLs');
  console.log('========================================');
  console.log(`Testing ${TEST_URLS.length} URLs...\n`);

  const results = [];

  for (let i = 0; i < TEST_URLS.length; i++) {
    const url = TEST_URLS[i];
    console.log(`[${i + 1}/${TEST_URLS.length}] Checking...`);

    const result = await checkUrl(url);
    results.push(result);

    if (result.success) {
      console.log(`  ✅ SUCCESS - ${result.status}`);
      console.log(`     Size: ${(parseInt(result.size) / 1024).toFixed(2)} KB`);
      console.log(`     Type: ${result.contentType}`);
    } else {
      console.log(`  ❌ FAILED - ${result.status}`);
      if (result.error) {
        console.log(`     Error: ${result.error}`);
      }
      if (result.code) {
        console.log(`     Code: ${result.code}`);
      }
    }
    console.log('');
  }

  // Summary
  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log('========================================');
  console.log('📊 SUMMARY');
  console.log('========================================');
  console.log(`Total: ${TEST_URLS.length}`);
  console.log(`Success: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('❌ FAILED URLs:');
    results.filter(r => !r.success).forEach((r, i) => {
      console.log(`\n${i + 1}. Status: ${r.status}`);
      console.log(`   URL: ${r.url}`);
      if (r.error) {
        console.log(`   Error: ${r.error}`);
      }
    });
    console.log('');

    console.log('💡 POSSIBLE CAUSES:');
    console.log('   - Images were deleted from MinIO');
    console.log('   - Images were moved to different path');
    console.log('   - MinIO bucket permissions changed');
    console.log('   - Network connectivity issue');
    console.log('   - MinIO server is down');
    console.log('');

    console.log('💡 SOLUTIONS:');
    console.log('   1. Verify images exist in MinIO web UI');
    console.log('   2. Check MinIO bucket policies');
    console.log('   3. Re-upload images if deleted');
    console.log('   4. Update image URLs in your workflow');
  } else {
    console.log('✅ All URLs are accessible!');
    console.log('   The problem is likely NOT with image URLs.');
    console.log('   Check other potential issues (FFmpeg, permissions, etc)');
  }

  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run
checkAllUrls().catch(error => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
