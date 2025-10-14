/**
 * Test VPS Local Processing
 * Simula o LocalVideoProcessor processando 3 imagens
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Test images from the payload
const TEST_IMAGES = [
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
];

const WORK_DIR = path.join(process.cwd(), 'test-vps-work');

/**
 * Download file with URL encoding (same as LocalVideoProcessor)
 */
async function downloadFile(url, dest) {
  const encodedUrl = encodeURI(url);

  console.log('[TEST] Downloading:', {
    original: url,
    encoded: encodedUrl,
    dest
  });

  try {
    const response = await axios({
      url: encodedUrl,
      method: 'GET',
      responseType: 'stream',
      timeout: 60000, // 1 min for test
      maxRedirects: 5
    });

    const writer = require('fs').createWriteStream(dest);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log('[TEST] ✅ Download completed:', dest);
        resolve();
      });
      writer.on('error', (error) => {
        console.error('[TEST] ❌ Write error:', error.message);
        reject(error);
      });
      response.data.on('error', (error) => {
        console.error('[TEST] ❌ Stream error:', error.message);
        reject(error);
      });
    });
  } catch (error) {
    console.error('[TEST] ❌ Download failed:', {
      url: encodedUrl,
      error: error.message
    });
    throw error;
  }
}

/**
 * Execute FFmpeg (same as LocalVideoProcessor)
 */
async function executeFFmpeg(args) {
  return new Promise((resolve, reject) => {
    console.log('[TEST] Executing FFmpeg:', args.join(' '));

    const ffmpeg = spawn('ffmpeg', args);
    let stderr = '';

    ffmpeg.stderr.on('data', (data) => {
      stderr += data.toString();
      // Print last line to show progress
      const lines = stderr.split('\n');
      const lastLine = lines[lines.length - 2] || '';
      if (lastLine.includes('frame=') || lastLine.includes('time=')) {
        process.stdout.write(`\r[TEST] FFmpeg: ${lastLine.trim()}`);
      }
    });

    ffmpeg.on('close', (code) => {
      console.log(''); // New line after progress
      if (code === 0) {
        console.log('[TEST] ✅ FFmpeg completed successfully');
        resolve();
      } else {
        console.error('[TEST] ❌ FFmpeg failed with code:', code);
        console.error('[TEST] Last 500 chars of stderr:', stderr.slice(-500));
        reject(new Error(`FFmpeg exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (error) => {
      console.error('[TEST] ❌ FFmpeg spawn error:', error.message);
      reject(error);
    });
  });
}

/**
 * Process one image to video (same as LocalVideoProcessor)
 */
async function processImage(image, workPath) {
  console.log(`\n[TEST] ========== Processing Image ${image.id} ==========`);

  const imgPath = path.join(workPath, `${image.id}.jpg`);
  const outputPath = path.join(workPath, `video_${image.id}.mp4`);

  // Download image
  console.log('[TEST] Step 1/2: Downloading image...');
  await downloadFile(image.image_url, imgPath);

  // Check if file exists and has content
  const stats = await fs.stat(imgPath);
  console.log('[TEST] Image downloaded:', {
    size: `${(stats.size / 1024).toFixed(2)} KB`,
    path: imgPath
  });

  // Create video with FFmpeg
  console.log('[TEST] Step 2/2: Creating video with FFmpeg...');
  const fps = 24;
  const frames = Math.round(image.duracao * fps);

  const ffmpegArgs = [
    '-loop', '1',
    '-i', imgPath,
    '-vf', `scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,zoompan=z='zoom+0.0015':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1920x1080:fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast', // FAST for testing
    '-crf', '23',
    '-t', String(image.duracao),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-y',
    outputPath
  ];

  await executeFFmpeg(ffmpegArgs);

  // Check output
  const outputStats = await fs.stat(outputPath);
  console.log('[TEST] ✅ Video created:', {
    size: `${(outputStats.size / 1024 / 1024).toFixed(2)} MB`,
    duration: `${image.duracao}s`,
    path: outputPath
  });

  return {
    id: image.id,
    input: imgPath,
    output: outputPath,
    size: outputStats.size
  };
}

/**
 * Main test function
 */
async function runTest() {
  console.log('[TEST] ========================================');
  console.log('[TEST] VPS Local Video Processor Test');
  console.log('[TEST] Testing with 3 images from payload');
  console.log('[TEST] ========================================\n');

  const startTime = Date.now();

  try {
    // Create work directory
    console.log('[TEST] Creating work directory:', WORK_DIR);
    await fs.mkdir(WORK_DIR, { recursive: true });

    // Process each image
    const results = [];
    for (const image of TEST_IMAGES) {
      const result = await processImage(image, WORK_DIR);
      results.push(result);
    }

    // Summary
    const duration = Date.now() - startTime;
    console.log('\n[TEST] ========================================');
    console.log('[TEST] ✅ ALL TESTS PASSED');
    console.log('[TEST] ========================================');
    console.log('[TEST] Summary:');
    console.log(`[TEST] - Images processed: ${results.length}`);
    console.log(`[TEST] - Total time: ${(duration / 1000).toFixed(2)}s`);
    console.log(`[TEST] - Avg per image: ${(duration / 1000 / results.length).toFixed(2)}s`);

    results.forEach(r => {
      console.log(`[TEST] - Image ${r.id}: ${(r.size / 1024 / 1024).toFixed(2)} MB`);
    });

    console.log('\n[TEST] Output files:');
    results.forEach(r => {
      console.log(`[TEST]   ${r.output}`);
    });

    console.log('\n[TEST] ✅ Test completed successfully!');
    process.exit(0);

  } catch (error) {
    console.error('\n[TEST] ========================================');
    console.error('[TEST] ❌ TEST FAILED');
    console.error('[TEST] ========================================');
    console.error('[TEST] Error:', error.message);
    console.error('[TEST] Stack:', error.stack);

    // Cleanup
    console.log('\n[TEST] Cleaning up...');
    try {
      await fs.rm(WORK_DIR, { recursive: true, force: true });
      console.log('[TEST] Cleanup done');
    } catch (cleanupError) {
      console.error('[TEST] Cleanup failed:', cleanupError.message);
    }

    process.exit(1);
  }
}

// Run test
runTest();
