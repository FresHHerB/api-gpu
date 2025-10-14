/**
 * Debug VPS Error - Fetch complete error from job
 */

const axios = require('axios');

const VPS_URL = process.env.VPS_URL || 'http://185.173.110.7:3000';
const API_KEY = process.env.X_API_KEY || 'api-gpu-2025-secure-key-change-me';

// Job ID from the webhook
const JOB_ID = process.argv[2] || 'b43a8a6f-f6f5-4358-854b-af2912cf9f95';

async function getJobStatus() {
  console.log('========================================');
  console.log('🔍 Fetching Job Details');
  console.log('========================================');
  console.log('Job ID:', JOB_ID);
  console.log('VPS URL:', VPS_URL);
  console.log('');

  try {
    const response = await axios.get(
      `${VPS_URL}/jobs/${JOB_ID}`,
      {
        headers: {
          'X-API-Key': API_KEY
        },
        timeout: 10000
      }
    );

    console.log('Status Code:', response.status);
    console.log('');
    console.log('========================================');
    console.log('📦 COMPLETE JOB DATA');
    console.log('========================================');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('========================================');
    console.log('');

    if (response.data.error) {
      console.log('❌ ERROR DETAILS:');
      console.log('Code:', response.data.error.code || response.data.error);
      console.log('Message:', response.data.error.message || response.data.error);
      console.log('');

      // Analyze common errors
      const errorMsg = response.data.error.message || response.data.error;

      if (errorMsg.includes('ENOENT')) {
        console.log('💡 DIAGNOSIS: FFmpeg not found');
        console.log('   SOLUTION: Install FFmpeg on VPS');
        console.log('   ssh root@185.173.110.7');
        console.log('   sudo apt install -y ffmpeg');
      } else if (errorMsg.includes('EACCES')) {
        console.log('💡 DIAGNOSIS: Permission denied');
        console.log('   SOLUTION: Fix permissions');
        console.log('   chmod 777 /tmp/vps-work');
      } else if (errorMsg.includes('ETIMEDOUT')) {
        console.log('💡 DIAGNOSIS: Download timeout');
        console.log('   SOLUTION: Check image URLs and network');
      } else if (errorMsg.includes('404')) {
        console.log('💡 DIAGNOSIS: Image not found');
        console.log('   SOLUTION: Verify image URLs in MinIO');
      } else if (errorMsg.includes('spawn')) {
        console.log('💡 DIAGNOSIS: Cannot spawn process');
        console.log('   SOLUTION: Check FFmpeg installation and PATH');
      }
    }

    if (response.data.status === 'COMPLETED' && response.data.result) {
      console.log('✅ JOB COMPLETED SUCCESSFULLY');
      console.log('Videos:', response.data.result.videos?.length || 0);
    }

  } catch (error) {
    console.log('========================================');
    console.log('❌ FAILED TO FETCH JOB');
    console.log('========================================');

    if (error.response) {
      console.log('Status Code:', error.response.status);
      console.log('Error:', JSON.stringify(error.response.data, null, 2));

      if (error.response.status === 404) {
        console.log('');
        console.log('💡 Job not found. Possible reasons:');
        console.log('   - Job ID is incorrect');
        console.log('   - Job was deleted');
        console.log('   - Redis was cleared');
      }
    } else if (error.request) {
      console.log('No response from server');
      console.log('Error:', error.message);
    } else {
      console.log('Error:', error.message);
    }
  }
}

// Run
console.log('');
getJobStatus().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
