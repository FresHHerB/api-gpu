/**
 * Complete VPS Test Flow
 * 1. Start webhook server
 * 2. Send POST to /vps/video/img2vid
 * 3. Analyze webhook response
 */

const express = require('express');
const axios = require('axios');

// Configuration
const WEBHOOK_PORT = 8888;
const VPS_URL = 'http://185.173.110.7:3000';
const API_KEY = 'api-gpu-2025-secure-key-change-me';

// Test payload with 3 images
const TEST_PAYLOAD = {
  webhook_url: `http://localhost:${WEBHOOK_PORT}/webhook`,
  id_roteiro: 41,
  path: "Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/videos/temp/",
  images: [
    {
      id: "1",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg",
      duracao: 11.16
    },
    {
      id: "2",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_2.jpg",
      duracao: 5.78
    },
    {
      id: "3",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_3.jpg",
      duracao: 10.48
    }
  ]
};

// Store webhook data
let webhookReceived = null;
let postResponse = null;

// Create Express app
const app = express();
app.use(express.json({ limit: '10mb' }));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString();
  webhookReceived = {
    timestamp,
    body: req.body
  };

  console.log('\n========================================');
  console.log('🔔 WEBHOOK RECEIVED!');
  console.log('========================================');
  console.log('Timestamp:', timestamp);
  console.log('Job ID:', req.body.jobId);
  console.log('Status:', req.body.status);
  console.log('Operation:', req.body.operation);
  console.log('Processor:', req.body.processor);
  console.log('');

  if (req.body.status === 'COMPLETED') {
    console.log('✅ JOB COMPLETED SUCCESSFULLY!');
    console.log('');
    console.log('Result:', JSON.stringify(req.body.result, null, 2));
    console.log('');

    if (req.body.result && req.body.result.videos) {
      console.log('📹 VIDEOS GENERATED:');
      req.body.result.videos.forEach(video => {
        console.log(`  • Video ${video.id}: ${video.video_url}`);
      });
      console.log('');
    }

    if (req.body.execution) {
      console.log('⏱️  EXECUTION TIME:');
      console.log(`  Duration: ${req.body.execution.durationSeconds}s`);
      console.log(`  Worker: ${req.body.execution.worker}`);
      console.log(`  Codec: ${req.body.execution.codec}`);
      console.log('');
    }
  } else if (req.body.status === 'FAILED') {
    console.log('❌ JOB FAILED!');
    console.log('');
    console.log('Error:', JSON.stringify(req.body.error, null, 2));
    console.log('');

    // Analyze error
    analyzeError(req.body.error);
  } else if (req.body.status === 'PROCESSING') {
    console.log('🔄 JOB IS PROCESSING...');
    console.log('');
  }

  console.log('========================================\n');

  // Analyze after receiving webhook
  setTimeout(() => {
    analyzeResults();
  }, 1000);

  res.status(200).json({ received: true });
});

// Analyze error details
function analyzeError(error) {
  const errorMsg = typeof error === 'string' ? error : (error.message || JSON.stringify(error));

  console.log('🔍 ERROR ANALYSIS:');
  console.log('─────────────────────────────────────');

  if (errorMsg.includes('404')) {
    console.log('❌ 404 NOT FOUND');
    console.log('');
    console.log('💡 DIAGNOSIS:');
    console.log('   The images are returning 404 when VPS tries to download them.');
    console.log('');
    console.log('🔍 POSSIBLE CAUSES:');
    console.log('   1. Images don\'t exist in MinIO');
    console.log('   2. Wrong path or bucket');
    console.log('   3. Images were deleted');
    console.log('   4. DNS resolves to different MinIO instance (split-brain)');
    console.log('');
    console.log('✅ SOLUTIONS:');
    console.log('   1. Check MinIO Web UI: https://minio.automear.com/');
    console.log('   2. Verify images exist in bucket "canais"');
    console.log('   3. Re-upload images if missing');
    console.log('   4. Try different idRoteiro that has images');
    console.log('');
    console.log('🧪 TEST URLS MANUALLY:');
    TEST_PAYLOAD.images.forEach((img, i) => {
      console.log(`   ${i + 1}. curl -I "${img.image_url}"`);
    });
  } else if (errorMsg.includes('ENOENT')) {
    console.log('❌ FFMPEG NOT FOUND');
    console.log('');
    console.log('💡 DIAGNOSIS:');
    console.log('   FFmpeg is not installed or not in PATH on VPS.');
    console.log('');
    console.log('✅ SOLUTION:');
    console.log('   ssh root@185.173.110.7');
    console.log('   sudo apt update && sudo apt install -y ffmpeg');
    console.log('   pm2 restart api-gpu-orchestrator');
  } else if (errorMsg.includes('EACCES')) {
    console.log('❌ PERMISSION DENIED');
    console.log('');
    console.log('💡 DIAGNOSIS:');
    console.log('   No permission to write to /tmp/vps-work');
    console.log('');
    console.log('✅ SOLUTION:');
    console.log('   ssh root@185.173.110.7');
    console.log('   mkdir -p /tmp/vps-work');
    console.log('   chmod 777 /tmp/vps-work');
    console.log('   pm2 restart api-gpu-orchestrator');
  } else if (errorMsg.includes('ETIMEDOUT')) {
    console.log('❌ TIMEOUT');
    console.log('');
    console.log('💡 DIAGNOSIS:');
    console.log('   Download timeout when fetching images.');
    console.log('');
    console.log('🔍 POSSIBLE CAUSES:');
    console.log('   1. Network connectivity issue');
    console.log('   2. MinIO server slow or down');
    console.log('   3. Firewall blocking');
    console.log('');
    console.log('✅ SOLUTION:');
    console.log('   Test connectivity from VPS:');
    console.log('   curl -I https://minio.automear.com/');
  } else if (errorMsg.includes('certificate')) {
    console.log('❌ SSL CERTIFICATE ERROR');
    console.log('');
    console.log('💡 DIAGNOSIS:');
    console.log('   SSL certificate validation failed.');
    console.log('');
    console.log('✅ SOLUTION:');
    console.log('   Check certificate: openssl s_client -connect minio.automear.com:443');
  } else {
    console.log('❓ UNKNOWN ERROR');
    console.log('');
    console.log('Full error message:');
    console.log(errorMsg);
  }

  console.log('─────────────────────────────────────\n');
}

// Analyze complete results
function analyzeResults() {
  console.log('\n╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    COMPLETE ANALYSIS                          ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  console.log('1. POST RESPONSE:');
  console.log('─────────────────────────────────────');
  if (postResponse) {
    console.log(`   Status: ${postResponse.status}`);
    console.log(`   Job ID: ${postResponse.data.jobId}`);
    console.log(`   Status: ${postResponse.data.status}`);
    console.log(`   Queue Position: ${postResponse.data.queuePosition || 'N/A'}`);
    console.log(`   Estimated Wait: ${postResponse.data.estimatedWaitTime || 'N/A'}`);
  } else {
    console.log('   ❌ No POST response received');
  }
  console.log('');

  console.log('2. WEBHOOK RESPONSE:');
  console.log('─────────────────────────────────────');
  if (webhookReceived) {
    console.log(`   Received: ${webhookReceived.timestamp}`);
    console.log(`   Status: ${webhookReceived.body.status}`);
    console.log(`   Processor: ${webhookReceived.body.processor}`);

    if (webhookReceived.body.status === 'COMPLETED') {
      console.log(`   ✅ SUCCESS`);
      console.log(`   Videos: ${webhookReceived.body.result?.videos?.length || 0}`);
    } else {
      console.log(`   ❌ FAILED`);
      const error = webhookReceived.body.error;
      const errorMsg = typeof error === 'string' ? error : (error?.message || JSON.stringify(error));
      console.log(`   Error: ${errorMsg}`);
    }
  } else {
    console.log('   ⏳ Waiting for webhook...');
  }
  console.log('');

  console.log('3. DIAGNOSIS:');
  console.log('─────────────────────────────────────');
  if (!postResponse) {
    console.log('   ❌ POST request failed');
    console.log('   Check if VPS is accessible: http://185.173.110.7:3000');
  } else if (!webhookReceived) {
    console.log('   ⏳ Webhook not received yet');
    console.log('   - Job may still be processing');
    console.log('   - Or webhook URL not reachable from VPS');
  } else if (webhookReceived.body.status === 'COMPLETED') {
    console.log('   ✅ Everything working perfectly!');
    console.log('   - VPS endpoint accessible');
    console.log('   - Images downloaded successfully');
    console.log('   - FFmpeg processed videos');
    console.log('   - Webhook delivered correctly');
  } else if (webhookReceived.body.status === 'FAILED') {
    console.log('   ❌ Job processing failed');
    console.log('   See error analysis above for details');
  }
  console.log('');

  console.log('4. PAYLOAD SENT:');
  console.log('─────────────────────────────────────');
  console.log(`   idRoteiro: ${TEST_PAYLOAD.id_roteiro}`);
  console.log(`   Path: ${TEST_PAYLOAD.path}`);
  console.log(`   Images: ${TEST_PAYLOAD.images.length}`);
  console.log(`   Total duration: ${TEST_PAYLOAD.images.reduce((sum, img) => sum + img.duracao, 0).toFixed(2)}s`);
  console.log('');

  console.log('5. IMAGE URLS:');
  console.log('─────────────────────────────────────');
  TEST_PAYLOAD.images.forEach((img, i) => {
    console.log(`   ${i + 1}. ${img.image_url}`);
  });
  console.log('');

  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                       END OF ANALYSIS                         ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');

  // Keep server running for a bit more
  console.log('Server will stay alive for 30 more seconds...');
  console.log('Press Ctrl+C to stop\n');
}

// Send POST request
async function sendPostRequest() {
  console.log('\n========================================');
  console.log('📤 SENDING POST REQUEST');
  console.log('========================================');
  console.log('VPS URL:', VPS_URL);
  console.log('Endpoint: /vps/video/img2vid');
  console.log('Webhook URL:', TEST_PAYLOAD.webhook_url);
  console.log('Images:', TEST_PAYLOAD.images.length);
  console.log('');

  try {
    const response = await axios.post(
      `${VPS_URL}/vps/video/img2vid`,
      TEST_PAYLOAD,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        timeout: 15000
      }
    );

    postResponse = response;

    console.log('✅ POST SUCCESSFUL!');
    console.log('');
    console.log('Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');
    console.log('⏳ Waiting for webhook...');
    console.log('   (This may take a few minutes)');
    console.log('========================================\n');

  } catch (error) {
    console.log('❌ POST FAILED!');
    console.log('');

    if (error.response) {
      console.log('Status:', error.response.status);
      console.log('Error:', JSON.stringify(error.response.data, null, 2));

      if (error.response.status === 401) {
        console.log('\n💡 DIAGNOSIS: Invalid API Key');
        console.log('   Check X-API-Key header');
      } else if (error.response.status === 404) {
        console.log('\n💡 DIAGNOSIS: Endpoint not found');
        console.log('   The VPS may not have the latest code');
        console.log('   Run on VPS: cd /root/api-gpu && git pull && npm run build:orchestrator && pm2 restart api-gpu-orchestrator');
      } else if (error.response.status === 400) {
        console.log('\n💡 DIAGNOSIS: Validation error');
        console.log('   Check payload structure');
      }
    } else if (error.request) {
      console.log('No response from server');
      console.log('Error:', error.message);
      console.log('\n💡 DIAGNOSIS: Cannot connect to VPS');
      console.log('   - Check if VPS is running');
      console.log('   - Check if port 3000 is accessible');
      console.log('   - Try: curl http://185.173.110.7:3000/health');
    } else {
      console.log('Error:', error.message);
    }

    console.log('========================================\n');
    process.exit(1);
  }
}

// Start server
const server = app.listen(WEBHOOK_PORT, async () => {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║           VPS COMPLETE FLOW TEST                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝\n');
  console.log('🎯 Webhook server started');
  console.log(`   Listening on: http://localhost:${WEBHOOK_PORT}`);
  console.log(`   Webhook URL: http://localhost:${WEBHOOK_PORT}/webhook`);
  console.log('');
  console.log('📋 Test configuration:');
  console.log(`   VPS: ${VPS_URL}`);
  console.log(`   Images: ${TEST_PAYLOAD.images.length}`);
  console.log(`   idRoteiro: ${TEST_PAYLOAD.id_roteiro}`);
  console.log('');
  console.log('⚡ Starting test...\n');

  // Wait 2 seconds then send POST
  setTimeout(async () => {
    await sendPostRequest();
  }, 2000);

  // Auto-exit after 5 minutes if no webhook received
  setTimeout(() => {
    if (!webhookReceived) {
      console.log('\n⚠️  Timeout: No webhook received after 5 minutes');
      console.log('   The job may still be processing or failed silently');
      console.log('   Check PM2 logs: pm2 logs api-gpu-orchestrator');
      process.exit(1);
    }
    process.exit(0);
  }, 300000);
});

// Handle Ctrl+C
process.on('SIGINT', () => {
  console.log('\n\n🛑 Test interrupted by user');
  server.close();
  process.exit(0);
});
