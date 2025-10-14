/**
 * Test VPS Img2Vid Endpoint
 * Sends request and analyzes both POST response and webhook
 */

const axios = require('axios');

// Configuration
const VPS_URL = process.env.VPS_URL || 'http://185.173.110.7:3000';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:8888/webhook';
const API_KEY = process.env.X_API_KEY || 'api-gpu-2025-secure-key-change-me';

// Small test payload with 3 images
const TEST_PAYLOAD = {
  webhook_url: WEBHOOK_URL,
  id_roteiro: 999,
  path: "canais/Test Channel/test-video/videos/",
  images: [
    {
      id: "1",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg",
      duracao: 3.0
    },
    {
      id: "2",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_2.jpg",
      duracao: 3.0
    },
    {
      id: "3",
      image_url: "https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_3.jpg",
      duracao: 3.0
    }
  ]
};

async function checkWebhookServer() {
  try {
    const response = await axios.get(`${WEBHOOK_URL.replace('/webhook', '/health')}`, {
      timeout: 3000
    });
    console.log('✅ Webhook server is running:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Webhook server is NOT running!');
    console.error('   Please start it first: node test-webhook-server.js');
    return false;
  }
}

async function testVPSImg2Vid() {
  console.log('========================================');
  console.log('🧪 Testing VPS Img2Vid Endpoint');
  console.log('========================================\n');

  // Check webhook server
  console.log('1. Checking webhook server...');
  const webhookReady = await checkWebhookServer();
  if (!webhookReady) {
    process.exit(1);
  }
  console.log('');

  // Display test configuration
  console.log('2. Test Configuration:');
  console.log(`   VPS URL: ${VPS_URL}`);
  console.log(`   Webhook URL: ${WEBHOOK_URL}`);
  console.log(`   Images: ${TEST_PAYLOAD.images.length}`);
  console.log(`   Total duration: ${TEST_PAYLOAD.images.reduce((sum, img) => sum + img.duracao, 0)}s`);
  console.log('');

  // Send POST request
  console.log('3. Sending POST request to /vps/video/img2vid...');
  const startTime = Date.now();

  try {
    const response = await axios.post(
      `${VPS_URL}/vps/video/img2vid`,
      TEST_PAYLOAD,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY
        },
        timeout: 10000
      }
    );

    const postDuration = Date.now() - startTime;

    console.log('');
    console.log('========================================');
    console.log('📨 POST RESPONSE RECEIVED');
    console.log('========================================');
    console.log('Status Code:', response.status);
    console.log('Response Time:', `${postDuration}ms`);
    console.log('');
    console.log('Response Data:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('========================================\n');

    if (response.status === 202) {
      console.log('✅ Job accepted! Status: 202 Accepted');
      console.log(`📝 Job ID: ${response.data.jobId}`);
      console.log(`🔄 Status: ${response.data.status}`);
      console.log(`📍 Queue Position: ${response.data.queuePosition || 'N/A'}`);
      console.log(`⏱️  Estimated Wait: ${response.data.estimatedWaitTime || 'N/A'}`);
      console.log('');
      console.log('⏳ Waiting for webhook notification...');
      console.log('   (This may take a few minutes depending on processing time)');
      console.log('   Check the webhook server console for updates.');
      console.log('');
      console.log('💡 TIP: You can check job status at:');
      console.log(`   GET ${VPS_URL}/jobs/${response.data.jobId}`);
    } else {
      console.log(`⚠️  Unexpected status code: ${response.status}`);
    }

  } catch (error) {
    const postDuration = Date.now() - startTime;

    console.log('');
    console.log('========================================');
    console.log('❌ POST REQUEST FAILED');
    console.log('========================================');
    console.log('Response Time:', `${postDuration}ms`);
    console.log('');

    if (error.response) {
      console.log('Status Code:', error.response.status);
      console.log('Error Response:');
      console.log(JSON.stringify(error.response.data, null, 2));

      // Analyze common errors
      if (error.response.status === 401) {
        console.log('');
        console.log('🔑 Authentication Error:');
        console.log('   - Check X-API-Key header');
        console.log('   - Current key:', API_KEY);
      } else if (error.response.status === 400) {
        console.log('');
        console.log('📋 Validation Error:');
        console.log('   - Check payload structure');
        console.log('   - Verify all required fields');
      } else if (error.response.status === 404) {
        console.log('');
        console.log('🔍 Endpoint Not Found:');
        console.log('   - Endpoint may not exist on server');
        console.log('   - Server may need to be updated');
        console.log('   - Check server logs');
      } else if (error.response.status === 500) {
        console.log('');
        console.log('💥 Server Error:');
        console.log('   - Internal server error');
        console.log('   - Check server logs for details');
      }
    } else if (error.request) {
      console.log('❌ No response received from server');
      console.log('Error:', error.message);
      console.log('');
      console.log('🔌 Connection Error:');
      console.log('   - Server may be down');
      console.log('   - Check VPS URL:', VPS_URL);
      console.log('   - Verify network connectivity');
    } else {
      console.log('Error:', error.message);
    }

    console.log('========================================\n');
    process.exit(1);
  }
}

// Run test
testVPSImg2Vid().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
