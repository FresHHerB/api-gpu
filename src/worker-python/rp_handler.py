"""
RunPod Serverless Handler for GPU Video Processing
Handles: caption, img2vid (batch), addaudio operations
Returns video URLs via HTTP server running on worker
"""

import runpod
import os
import sys
import logging
import subprocess
import requests
import uuid
from pathlib import Path
from typing import Dict, List, Any, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import HTTPServer, SimpleHTTPRequestHandler
import threading

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Directories
WORK_DIR = Path(os.getenv('WORK_DIR', '/tmp/work'))
OUTPUT_DIR = Path(os.getenv('OUTPUT_DIR', '/tmp/output'))
BATCH_SIZE = int(os.getenv('BATCH_SIZE', '3'))
HTTP_PORT = int(os.getenv('HTTP_PORT', '8000'))

# Ensure directories exist
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# HTTP Server for serving videos
class VideoHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(OUTPUT_DIR), **kwargs)

    def log_message(self, format, *args):
        logger.info(f"HTTP: {format % args}")

def start_http_server():
    """Start HTTP server to serve videos"""
    server = HTTPServer(('0.0.0.0', HTTP_PORT), VideoHandler)
    logger.info(f"🌐 HTTP server started on port {HTTP_PORT}, serving {OUTPUT_DIR}")
    server.serve_forever()

# Start HTTP server in background thread
http_thread = threading.Thread(target=start_http_server, daemon=True)
http_thread.start()


def download_file(url: str, output_path: Path) -> None:
    """Download file from URL"""
    logger.info(f"Downloading {url} to {output_path}")
    try:
        response = requests.get(url, stream=True, timeout=300, allow_redirects=True)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        file_size = output_path.stat().st_size
        logger.info(f"Download completed: {output_path} ({file_size} bytes)")

        if file_size == 0:
            raise ValueError(f"Downloaded file is empty: {url}")

    except requests.exceptions.RequestException as e:
        logger.error(f"Download failed for {url}: {e}")
        raise


def add_caption(url_video: str, url_srt: str) -> Dict[str, Any]:
    """Add caption to video using FFmpeg with GPU acceleration"""
    video_id = str(uuid.uuid4())
    logger.info(f"Starting caption job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_input.mp4"
    srt_path = WORK_DIR / f"{video_id}_caption.srt"
    output_filename = f"{video_id}_captioned.mp4"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and SRT
        download_file(url_video, video_path)
        download_file(url_srt, srt_path)

        # FFmpeg command with GPU NVENC encoding
        cmd = [
            'ffmpeg', '-y',
            '-hwaccel', 'cuda',
            '-i', str(video_path),
            '-vf', f"subtitles={srt_path}",
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-b:v', '5M',
            '-c:a', 'copy',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Caption added: {output_filename} ({file_size_mb:.2f} MB)")

        # Return HTTP URL to access the video
        video_url = f"http://localhost:{HTTP_PORT}/{output_filename}"

        return {
            'video_url': video_url,
            'filename': output_filename
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input files
        video_path.unlink(missing_ok=True)
        srt_path.unlink(missing_ok=True)


def image_to_video(image_id: str, image_url: str, duracao: float) -> Dict[str, Any]:
    """Convert image to video using FFmpeg with GPU acceleration"""
    logger.info(f"Converting image to video: {image_id}, duration: {duracao}s")

    image_path = WORK_DIR / f"{image_id}_image.jpg"
    output_filename = f"{image_id}_video.mp4"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download image
        download_file(image_url, image_path)

        # FFmpeg command with GPU NVENC encoding
        cmd = [
            'ffmpeg', '-y',
            '-loop', '1',
            '-i', str(image_path),
            '-t', str(duracao),
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-b:v', '5M',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Image to video completed: {output_filename} ({file_size_mb:.2f} MB)")

        # Return HTTP URL to access the video
        video_url = f"http://localhost:{HTTP_PORT}/{output_filename}"

        return {
            'id': image_id,
            'video_url': video_url,
            'filename': output_filename
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input image
        image_path.unlink(missing_ok=True)


def process_img2vid_batch(images: List[Dict]) -> Dict[str, Any]:
    """Process multiple images to videos in parallel batches"""
    total = len(images)
    logger.info(f"📦 Processing {total} images with batch size {BATCH_SIZE}")

    results = []

    with ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
        futures = {
            executor.submit(
                image_to_video,
                img['id'],
                img['image_url'],
                img['duracao']
            ): img for img in images
        }

        for future in as_completed(futures):
            img = futures[future]
            try:
                result = future.result()
                results.append(result)
                logger.info(f"✅ Completed {len(results)}/{total}: {img['id']}")
            except Exception as e:
                logger.error(f"Failed to process {img['id']}: {e}")
                raise

    logger.info(f"✅ All {total} images processed successfully")

    return {
        "message": "Images converted to videos successfully",
        "total": total,
        "processed": len(results),
        "videos": results
    }


def add_audio(url_video: str, url_audio: str) -> Dict[str, Any]:
    """Add audio to video using FFmpeg with GPU acceleration"""
    video_id = str(uuid.uuid4())
    logger.info(f"Starting audio job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_video.mp4"
    audio_path = WORK_DIR / f"{video_id}_audio.mp3"
    output_filename = f"{video_id}_with_audio.mp4"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and audio
        download_file(url_video, video_path)
        download_file(url_audio, audio_path)

        # FFmpeg command with GPU NVENC encoding
        cmd = [
            'ffmpeg', '-y',
            '-hwaccel', 'cuda',
            '-i', str(video_path),
            '-i', str(audio_path),
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-b:v', '5M',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Audio added: {output_filename} ({file_size_mb:.2f} MB)")

        # Return HTTP URL to access the video
        video_url = f"http://localhost:{HTTP_PORT}/{output_filename}"

        return {
            'video_url': video_url,
            'filename': output_filename
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input files
        video_path.unlink(missing_ok=True)
        audio_path.unlink(missing_ok=True)


def handler(job: Dict) -> Dict[str, Any]:
    """
    RunPod handler function
    Receives job input and routes to appropriate operation
    """
    job_input = job.get('input', {})
    operation = job_input.get('operation')

    logger.info(f"🚀 Job started: {operation}")
    logger.info(f"📥 Input: {job_input}")

    try:
        if operation == 'caption':
            url_video = job_input.get('url_video')
            url_srt = job_input.get('url_srt')

            if not url_video or not url_srt:
                raise ValueError("Missing required fields: url_video, url_srt")

            result = add_caption(url_video, url_srt)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "message": "Caption added successfully"
            }

        elif operation == 'img2vid':
            images = job_input.get('images', [])

            if not images:
                raise ValueError("Missing required field: images")

            result = process_img2vid_batch(images)
            return {
                "success": True,
                **result
            }

        elif operation == 'addaudio':
            url_video = job_input.get('url_video')
            url_audio = job_input.get('url_audio')

            if not url_video or not url_audio:
                raise ValueError("Missing required fields: url_video, url_audio")

            result = add_audio(url_video, url_audio)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "message": "Audio added successfully"
            }

        else:
            raise ValueError(f"Unknown operation: {operation}")

    except Exception as e:
        logger.error(f"❌ Job failed: {e}")
        raise


if __name__ == "__main__":
    logger.info("=" * 50)
    logger.info("🎬 GPU Worker Started (HTTP Mode)")
    logger.info("=" * 50)
    logger.info(f"📂 Work dir: {WORK_DIR}")
    logger.info(f"📂 Output dir: {OUTPUT_DIR}")
    logger.info(f"🔢 Batch size: {BATCH_SIZE}")
    logger.info(f"🌐 HTTP server: port {HTTP_PORT}")
    logger.info("=" * 50)

    # Validate FFmpeg
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        logger.info("✅ FFmpeg available")
    except FileNotFoundError:
        logger.error("❌ FFmpeg not found!")
        sys.exit(1)

    # Start RunPod handler
    runpod.serverless.start({"handler": handler})
