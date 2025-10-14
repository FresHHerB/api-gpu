/**
 * Test Full Payload Locally
 * Tests with all 66 images from the real payload
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Full 66 image payload from user
const FULL_PAYLOAD = {
  "path": "Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/videos/temp/",
  "images": [
    {"id":"1","image_url":"https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg","duracao":11.16},
    {"id":"2","image_url":"https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_2.jpg","duracao":5.78},
    {"id":"3","image_url":"https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_3.jpg","duracao":10.48}
  ]
};

const WORK_DIR = path.join(process.cwd(), 'test-full-payload-work');

/**
 * Download with detailed error logging
 */
async function downloadFile(url, dest, imageId) {
  const encodedUrl = encodeURI(url);

  console.log(`\n[IMG ${imageId}] Downloading...`);
  console.log(`  URL: ${url}`);
  console.log(`  Encoded: ${encodedUrl}`);
  console.log(`  Dest: ${dest}`);

  try {
    const response = await axios({
      url: encodedUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 5
    });

    const writer = require('fs').createWriteStream(dest);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', async () => {
        try {
          const stats = await fs.stat(dest);
          console.log(`[IMG ${imageId}] ✅ Downloaded: ${(stats.size / 1024).toFixed(2)} KB`);
          resolve();
        } catch (err) {
          console.error(`[IMG ${imageId}] ❌ Failed to stat file:`, err.message);
          reject(err);
        }
      });

      writer.on('error', (error) => {
        console.error(`[IMG ${imageId}] ❌ Write error:`, error.message);
        reject(error);
      });

      response.data.on('error', (error) => {
        console.error(`[IMG ${imageId}] ❌ Stream error:`, error.message);
        reject(error);
      });
    });

  } catch (error) {
    console.error(`[IMG ${imageId}] ❌ Download failed:`, {
      message: error.message,
      code: error.code,
      status: error.response?.status
    });
    throw new Error(`Download failed for image ${imageId}: ${error.message}`);
  }
}

/**
 * FFmpeg with detailed logging
 */
async function executeFFmpeg(args, imageId) {
  return new Promise((resolve, reject) => {
    console.log(`[IMG ${imageId}] Executing FFmpeg...`);

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';
    let lastProgress = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      const lines = stderr.split('\n');
      const progressLine = lines.find(l => l.includes('frame=') || l.includes('time='));
      if (progressLine && progressLine !== lastProgress) {
        process.stdout.write(`\r[IMG ${imageId}] ${progressLine.trim().substring(0, 80)}`);
        lastProgress = progressLine;
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(''); // New line
      if (code === 0) {
        console.log(`[IMG ${imageId}] ✅ FFmpeg completed`);
        resolve();
      } else {
        console.error(`[IMG ${imageId}] ❌ FFmpeg failed with code ${code}`);
        console.error(`[IMG ${imageId}] Last 500 chars of stderr:`, stderr.slice(-500));
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (error) => {
      console.error(`[IMG ${imageId}] ❌ FFmpeg spawn error:`, error.message);
      if (error.code === 'ENOENT') {
        console.error(`[IMG ${imageId}] 💡 FFmpeg not found. Install with:`);
        console.error(`   Windows: choco install ffmpeg`);
        console.error(`   Linux: sudo apt install -y ffmpeg`);
      }
      reject(error);
    });
  });
}

/**
 * Process one image
 */
async function processImage(image, workPath) {
  const startTime = Date.now();

  try {
    const imgPath = path.join(workPath, `${image.id}.jpg`);
    const outputPath = path.join(workPath, `video_${image.id}.mp4`);

    // Download
    await downloadFile(image.image_url, imgPath, image.id);

    // Process with FFmpeg
    const fps = 24;
    const frames = Math.round(image.duracao * fps);

    const ffmpegArgs = [
      '-loop', '1',
      '-i', imgPath,
      '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='zoom+0.0015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`,
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '23',
      '-t', String(image.duracao),
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      '-y',
      outputPath
    ];

    await executeFFmpeg(ffmpegArgs, image.id);

    // Check output
    const stats = await fs.stat(outputPath);
    const duration = Date.now() - startTime;

    console.log(`[IMG ${image.id}] ✅ Completed in ${(duration / 1000).toFixed(2)}s - Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB\n`);

    return {
      id: image.id,
      success: true,
      size: stats.size,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[IMG ${image.id}] ❌ FAILED after ${(duration / 1000).toFixed(2)}s:`, error.message);
    return {
      id: image.id,
      success: false,
      error: error.message,
      duration
    };
  }
}

/**
 * Main test
 */
async function runTest() {
  console.log('==========================================');
  console.log('🧪 Full Payload Test');
  console.log('==========================================');
  console.log(`Images: ${FULL_PAYLOAD.images.length}`);
  console.log(`Total duration: ${FULL_PAYLOAD.images.reduce((sum, img) => sum + img.duracao, 0).toFixed(2)}s`);
  console.log(`Work dir: ${WORK_DIR}`);
  console.log('==========================================\n');

  const startTime = Date.now();

  try {
    // Create work directory
    await fs.mkdir(WORK_DIR, { recursive: true });
    console.log('✅ Work directory created\n');

    // Process all images
    const results = [];
    for (const image of FULL_PAYLOAD.images) {
      const result = await processImage(image, WORK_DIR);
      results.push(result);

      // Stop on first error to see what went wrong
      if (!result.success) {
        console.log('\n⚠️  Stopping on first error to diagnose\n');
        break;
      }
    }

    // Summary
    const totalDuration = Date.now() - startTime;
    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log('\n==========================================');
    console.log('📊 TEST SUMMARY');
    console.log('==========================================');
    console.log(`Total time: ${(totalDuration / 1000 / 60).toFixed(2)} minutes`);
    console.log(`Succeeded: ${succeeded}/${FULL_PAYLOAD.images.length}`);
    console.log(`Failed: ${failed}`);

    if (succeeded > 0) {
      const avgTime = results.filter(r => r.success).reduce((sum, r) => sum + r.duration, 0) / succeeded;
      const totalSize = results.filter(r => r.success).reduce((sum, r) => sum + r.size, 0);
      console.log(`Avg per video: ${(avgTime / 1000).toFixed(2)}s`);
      console.log(`Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
    }

    if (failed > 0) {
      console.log('\n❌ FAILED IMAGES:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - Image ${r.id}: ${r.error}`);
      });
    }

    console.log('==========================================\n');

    process.exit(failed > 0 ? 1 : 0);

  } catch (error) {
    console.error('\n==========================================');
    console.error('❌ TEST FAILED');
    console.error('==========================================');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('==========================================\n');
    process.exit(1);
  }
}

// Run
runTest();
