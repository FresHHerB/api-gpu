/**
 * Webhook Server for Testing VPS Endpoints
 * Receives webhook notifications and logs all details
 */

const express = require('express');
const app = express();
const PORT = 8888;

// Store received webhooks
const receivedWebhooks = [];

app.use(express.json({ limit: '10mb' }));

// Webhook endpoint
app.post('/webhook', (req, res) => {
  const timestamp = new Date().toISOString();
  const webhook = {
    timestamp,
    headers: req.headers,
    body: req.body
  };

  receivedWebhooks.push(webhook);

  console.log('\n========================================');
  console.log('🔔 WEBHOOK RECEIVED');
  console.log('========================================');
  console.log('Timestamp:', timestamp);
  console.log('Job ID:', req.body.jobId);
  console.log('Status:', req.body.status);
  console.log('Operation:', req.body.operation);
  console.log('Processor:', req.body.processor);

  if (req.body.status === 'COMPLETED') {
    console.log('\n✅ JOB COMPLETED');
    console.log('Result:', JSON.stringify(req.body.result, null, 2));

    if (req.body.execution) {
      console.log('\n⏱️ EXECUTION TIME:');
      console.log('Duration:', req.body.execution.durationSeconds, 'seconds');
      console.log('Worker:', req.body.execution.worker);
      console.log('Codec:', req.body.execution.codec);
    }

    if (req.body.result && req.body.result.videos) {
      console.log('\n📹 VIDEOS GENERATED:');
      req.body.result.videos.forEach(video => {
        console.log(`  - ID ${video.id}: ${video.video_url}`);
      });
    }
  } else if (req.body.status === 'FAILED') {
    console.log('\n❌ JOB FAILED');
    console.log('Error:', JSON.stringify(req.body.error, null, 2));

    if (req.body.execution) {
      console.log('\n⏱️ EXECUTION TIME BEFORE FAILURE:');
      console.log('Duration:', req.body.execution.durationSeconds, 'seconds');
    }
  } else {
    console.log('\n🔄 JOB STATUS:', req.body.status);
  }

  console.log('\n📦 FULL PAYLOAD:');
  console.log(JSON.stringify(req.body, null, 2));
  console.log('========================================\n');

  res.status(200).json({ received: true });
});

// Status endpoint to check received webhooks
app.get('/status', (req, res) => {
  res.json({
    total: receivedWebhooks.length,
    webhooks: receivedWebhooks
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', webhooks_received: receivedWebhooks.length });
});

app.listen(PORT, () => {
  console.log('========================================');
  console.log('🎯 Webhook Server Started');
  console.log('========================================');
  console.log(`Listening on: http://localhost:${PORT}`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Status URL: http://localhost:${PORT}/status`);
  console.log('========================================\n');
  console.log('Waiting for webhooks...\n');
});
