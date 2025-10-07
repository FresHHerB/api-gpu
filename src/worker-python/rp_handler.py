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
import time
import boto3
from botocore.exceptions import ClientError
from pathlib import Path
from typing import Dict, List, Any, Optional
from concurrent.futures import ThreadPoolExecutor
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
BATCH_SIZE = int(os.getenv('BATCH_SIZE', '5'))  # Optimized for RTX A4500 (12 vCPU)
HTTP_PORT = int(os.getenv('HTTP_PORT', '8000'))

# S3/MinIO Configuration
S3_ENDPOINT_URL = os.getenv('S3_ENDPOINT_URL', 'https://n8n-minio.gpqg9h.easypanel.host')
S3_ACCESS_KEY = os.getenv('S3_ACCESS_KEY', 'admin')
S3_SECRET_KEY = os.getenv('S3_SECRET_KEY', 'password')
S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'canais')
S3_REGION = os.getenv('S3_REGION', 'us-east-1')

# Ensure directories exist
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Initialize S3 client
s3_client = boto3.client(
    's3',
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=boto3.session.Config(signature_version='s3v4')
)

# HTTP Server for serving videos (caption/addaudio only)
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


def upload_to_s3(local_path: Path, bucket: str, s3_key: str) -> str:
    """
    Upload file to S3/MinIO and return public URL
    Args:
        local_path: Local file path
        bucket: S3 bucket name
        s3_key: S3 object key (path in bucket)
    Returns:
        Public URL of uploaded file
    """
    try:
        logger.info(f"📤 Uploading to S3: {bucket}/{s3_key}")

        # Upload file with public-read ACL
        s3_client.upload_file(
            str(local_path),
            bucket,
            s3_key,
            ExtraArgs={'ACL': 'public-read', 'ContentType': 'video/mp4'}
        )

        # Construct public URL
        public_url = f"{S3_ENDPOINT_URL}/{bucket}/{s3_key}"

        file_size_mb = local_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ S3 upload complete: {s3_key} ({file_size_mb:.2f} MB)")

        return public_url

    except ClientError as e:
        logger.error(f"❌ S3 upload failed: {e}")
        raise
    except Exception as e:
        logger.error(f"❌ Unexpected error during S3 upload: {e}")
        raise


def download_file(url: str, output_path: Path) -> None:
    """Download file from URL (optimized for S3/MinIO)"""
    logger.info(f"Downloading {url} to {output_path}")

    try:
        # Parse S3 URL and use boto3 for S3/MinIO (faster, optimized)
        # Expected formats:
        # - http://minio.automear.com/canais/path/file.mp4
        # - https://minio.automear.com/canais/path/file.mp4
        if 'minio.automear.com' in url or S3_BUCKET_NAME in url:
            # Extract bucket and key from URL
            # Format: http://minio.automear.com/{bucket}/{key}
            from urllib.parse import urlparse, unquote
            parsed = urlparse(url)
            path_parts = parsed.path.lstrip('/').split('/', 1)

            if len(path_parts) == 2:
                bucket = path_parts[0]
                key = unquote(path_parts[1])  # Decode URL encoding

                logger.info(f"📥 S3 download: bucket={bucket}, key={key}")
                s3_client.download_file(bucket, key, str(output_path))

                file_size = output_path.stat().st_size
                logger.info(f"✅ S3 download completed: {output_path} ({file_size} bytes)")

                if file_size == 0:
                    raise ValueError(f"Downloaded file is empty: {url}")
                return

        # Fallback: Standard HTTP download for non-S3 URLs
        logger.info(f"🌐 HTTP download: {url}")
        response = requests.get(url, stream=True, timeout=300, allow_redirects=True)
        response.raise_for_status()

        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)

        file_size = output_path.stat().st_size
        logger.info(f"✅ HTTP download completed: {output_path} ({file_size} bytes)")

        if file_size == 0:
            raise ValueError(f"Downloaded file is empty: {url}")

    except ClientError as e:
        logger.error(f"❌ S3 download failed for {url}: {e}")
        raise
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ HTTP download failed for {url}: {e}")
        raise
    except Exception as e:
        logger.error(f"❌ Download failed for {url}: {e}")
        raise


def add_caption(
    url_video: str,
    url_srt: str,
    path: str,
    output_filename: str,
    worker_id: str = None,
    force_style: str = None
) -> Dict[str, Any]:
    """Add caption to video with optional custom styling and upload to S3

    Args:
        url_video: URL of the video file
        url_srt: URL of the SRT subtitle file
        path: S3 path for upload
        output_filename: Output filename
        worker_id: Worker identifier (optional)
        force_style: ASS force_style string for subtitle styling (optional)
    """
    video_id = str(uuid.uuid4())
    logger.info(f"Starting caption job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_input.mp4"
    srt_path = WORK_DIR / f"{video_id}_caption.srt"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and SRT
        download_file(url_video, video_path)
        download_file(url_srt, srt_path)

        # Normalize SRT path for FFmpeg (escape colons)
        normalized_srt = str(srt_path).replace('\\', '/').replace(':', '\\:')

        # Build subtitles filter with optional force_style
        if force_style:
            logger.info(f"📝 Applying custom subtitle style: {force_style}")
            subtitles_filter = f"subtitles=filename='{normalized_srt}':force_style='{force_style}'"
        else:
            logger.info("📝 Using default subtitle style")
            subtitles_filter = f"subtitles=filename='{normalized_srt}'"

        # FFmpeg command with GPU NVENC encoding - VBR mode
        # Note: subtitles filter is incompatible with hwaccel_output_format cuda
        cmd = [
            'ffmpeg', '-y',
            '-hwaccel', 'cuda',
            '-i', str(video_path),
            '-vf', subtitles_filter,
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-tune', 'hq',
            '-rc:v', 'vbr',
            '-cq:v', '23',
            '-b:v', '0',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-c:a', 'copy',
            '-movflags', '+faststart',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Caption added: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
        # S3 key: {path}{filename} (path already includes /videos/)
        s3_key = f"{path}{output_filename}"
        video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

        # Cleanup local file after S3 upload
        output_path.unlink(missing_ok=True)

        return {
            'video_url': video_url,
            'filename': output_filename,
            's3_key': s3_key
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input files
        video_path.unlink(missing_ok=True)
        srt_path.unlink(missing_ok=True)


def image_to_video(
    image_id: str,
    image_url: str,
    duracao: float,
    frame_rate: int = 24,
    worker_id: str = None,
    path: str = None,
    video_index: int = None
) -> Dict[str, Any]:
    """Convert image to video with zoom effect and upload to S3"""
    logger.info(f"Converting image to video with zoom: {image_id}, duration: {duracao}s, fps: {frame_rate}")

    image_path = WORK_DIR / f"{image_id}_image.jpg"

    # Use video_index for filename if provided (e.g., video_1.mp4)
    if video_index is not None:
        output_filename = f"video_{video_index}.mp4"
    else:
        output_filename = f"{image_id}_video.mp4"

    output_path = OUTPUT_DIR / output_filename

    try:
        # Download image
        download_file(image_url, image_path)

        # Zoom parameters (1.0 -> 1.324 = 32.4% zoom)
        total_frames = int(frame_rate * duracao)
        zoom_start = 1.0
        zoom_end = 1.324
        zoom_diff = zoom_end - zoom_start
        upscale_factor = 6
        upscale_width = 1920 * upscale_factor  # 11520
        upscale_height = 1080 * upscale_factor  # 6480

        # Video filter with zoom effect
        video_filter = (
            f"scale={upscale_width}:{upscale_height}:flags=lanczos,"
            f"zoompan=z='min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})'"
            f":d={total_frames}"
            f":x='trunc(iw/2-(iw/zoom/2))'"
            f":y='trunc(ih/2-(ih/zoom/2))'"
            f":s=1920x1080"
            f":fps={frame_rate},"
            f"format=nv12"
        )

        # FFmpeg command with GPU NVENC encoding and zoom
        cmd = [
            'ffmpeg', '-y',
            '-framerate', str(frame_rate),
            '-loop', '1',
            '-i', str(image_path),
            '-vf', video_filter,
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-tune', 'hq',
            '-rc:v', 'vbr',
            '-cq:v', '23',
            '-b:v', '0',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-t', str(duracao),
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Image to video completed: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3 if path provided
        if path:
            # S3 key: {path}{filename} (path already includes /videos/temp/)
            s3_key = f"{path}{output_filename}"
            video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

            # Cleanup local file after S3 upload
            output_path.unlink(missing_ok=True)

            return {
                'id': str(video_index) if video_index is not None else image_id,
                'video_url': video_url,
                'filename': output_filename,
                's3_key': s3_key
            }
        else:
            # Fallback to HTTP URL (legacy mode)
            if worker_id:
                video_url = f"https://{worker_id}-{HTTP_PORT}.proxy.runpod.net/{output_filename}"
            else:
                video_url = f"http://localhost:{HTTP_PORT}/{output_filename}"

            return {
                'id': str(video_index) if video_index is not None else image_id,
                'video_url': video_url,
                'filename': output_filename
            }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input image
        image_path.unlink(missing_ok=True)


def process_img2vid_batch(
    images: List[Dict],
    frame_rate: int = 24,
    worker_id: str = None,
    path: str = None,
    start_index: int = 0
) -> Dict[str, Any]:
    """Process images to videos in sequential batches with S3 upload

    Args:
        images: List of image dictionaries
        frame_rate: Video frame rate (default: 24)
        worker_id: Worker identifier
        path: S3 path for uploads
        start_index: Global start index for multi-worker scenarios (default: 0)
    """
    total = len(images)
    logger.info(f"📦 Processing {total} images in batches of {BATCH_SIZE}, fps: {frame_rate}, start_index: {start_index}")

    if path:
        logger.info(f"📤 S3 upload enabled: bucket={S3_BUCKET_NAME}, path={path}")

    results = []

    # Process in batches of BATCH_SIZE sequentially
    for i in range(0, total, BATCH_SIZE):
        batch = images[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        total_batches = (total + BATCH_SIZE - 1) // BATCH_SIZE

        logger.info(f"🔄 Processing batch {batch_num}/{total_batches} ({len(batch)} images)")

        # Process current batch in parallel, preserving order
        with ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
            # Submit all tasks and store futures in order
            futures = [
                executor.submit(
                    image_to_video,
                    img['id'],
                    img['image_url'],
                    img['duracao'],
                    frame_rate,
                    worker_id,
                    path,
                    start_index + i + j + 1  # video_index with global offset
                ) for j, img in enumerate(batch)
            ]

            # Wait for results in original order (not completion order)
            for j, future in enumerate(futures):
                img = batch[j]
                try:
                    result = future.result()
                    results.append(result)
                    logger.info(f"✅ Completed {len(results)}/{total}: {img['id']} → {result['filename']}")
                except Exception as e:
                    logger.error(f"Failed to process {img['id']}: {e}")
                    raise

        logger.info(f"✅ Batch {batch_num}/{total_batches} completed")

    logger.info(f"✅ All {total} images processed successfully in {total_batches} batches")

    return {
        "message": "Images converted to videos successfully",
        "total": total,
        "processed": len(results),
        "videos": results
    }


def get_duration(file_path: Path) -> float:
    """Get duration of media file using ffprobe"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            str(file_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        import json
        metadata = json.loads(result.stdout)
        duration = float(metadata['format']['duration'])

        logger.info(f"Duration of {file_path.name}: {duration:.2f}s")
        return duration

    except Exception as e:
        logger.error(f"Failed to get duration for {file_path}: {e}")
        raise RuntimeError(f"Failed to get media duration: {e}")


def add_audio(
    url_video: str,
    url_audio: str,
    path: str,
    output_filename: str,
    worker_id: str = None
) -> Dict[str, Any]:
    """Add audio to video and upload to S3"""
    video_id = str(uuid.uuid4())
    logger.info(f"Starting audio job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_video.mp4"
    audio_path = WORK_DIR / f"{video_id}_audio.mp3"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and audio
        download_file(url_video, video_path)
        download_file(url_audio, audio_path)

        # Get durations
        video_duration = get_duration(video_path)
        audio_duration = get_duration(audio_path)

        logger.info(f"Duration sync: video={video_duration:.2f}s, audio={audio_duration:.2f}s")

        # Calculate speed adjustment factor
        speed_factor = video_duration / audio_duration
        pts_multiplier = 1 / speed_factor

        logger.info(f"Speed adjustment: {speed_factor:.3f}x (pts={pts_multiplier:.6f})")

        # FFmpeg command with NVENC encoding
        # Note: CPU decode → CPU filter (setpts) → GPU encode (NVENC)
        # We don't use -hwaccel cuda because setpts filter is CPU-only
        # and causes "Impossible to convert between formats" error
        cmd = [
            'ffmpeg', '-y',
            '-i', str(video_path),
            '-i', str(audio_path),
            '-filter_complex', f'[0:v]setpts={pts_multiplier:.6f}*PTS[vout]',
            '-map', '[vout]',
            '-map', '1:a',
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-tune', 'hq',
            '-rc:v', 'vbr',
            '-cq:v', '23',
            '-b:v', '0',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            '-movflags', '+faststart',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Audio added: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
        # S3 key: {path}{filename} (path already includes /videos/)
        s3_key = f"{path}{output_filename}"
        video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

        # Cleanup local file after S3 upload
        output_path.unlink(missing_ok=True)

        return {
            'video_url': video_url,
            'filename': output_filename,
            'speed_factor': round(speed_factor, 3),
            's3_key': s3_key
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

    # Get worker ID - RunPod provides this via RUNPOD_POD_ID env var
    worker_id = os.getenv('RUNPOD_POD_ID')

    logger.info(f"🚀 Job started: {operation}")
    logger.info(f"📥 Input: {job_input}")
    logger.info(f"🆔 Worker ID: {worker_id}")

    try:
        if operation == 'caption':
            url_video = job_input.get('url_video')
            url_srt = job_input.get('url_srt')
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')
            force_style = job_input.get('force_style')  # Optional custom styling

            if not url_video or not url_srt or not path or not output_filename:
                raise ValueError("Missing required fields: url_video, url_srt, path, output_filename")

            if force_style:
                logger.info(f"📤 S3 upload with custom style: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
                logger.info(f"🎨 Style: {force_style}")
            else:
                logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")

            result = add_caption(url_video, url_srt, path, output_filename, worker_id, force_style)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "message": "Caption added and uploaded to S3 successfully",
                "force_style_applied": force_style is not None
            }

        elif operation == 'img2vid':
            images = job_input.get('images', [])
            frame_rate = job_input.get('frame_rate', 24)  # Default 24 fps
            path = job_input.get('path')
            start_index = job_input.get('start_index', 0)  # Global start index for multi-worker

            if not images or not path:
                raise ValueError("Missing required fields: images, path")

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, start_index={start_index}")
            result = process_img2vid_batch(images, frame_rate, worker_id, path, start_index)

            return {
                "success": True,
                **result
            }

        elif operation == 'addaudio':
            url_video = job_input.get('url_video')
            url_audio = job_input.get('url_audio')
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')

            if not url_video or not url_audio or not path or not output_filename:
                raise ValueError("Missing required fields: url_video, url_audio, path, output_filename")

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            result = add_audio(url_video, url_audio, path, output_filename, worker_id)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "speed_factor": result['speed_factor'],
                "s3_key": result['s3_key'],
                "message": "Audio added and uploaded to S3 successfully"
            }

        else:
            raise ValueError(f"Unknown operation: {operation}")

    except Exception as e:
        logger.error(f"❌ Job failed: {e}")
        raise


if __name__ == "__main__":
    import multiprocessing
    import psutil

    logger.info("=" * 50)
    logger.info("🎬 GPU Worker Started (HTTP Mode)")
    logger.info("=" * 50)
    logger.info(f"📂 Work dir: {WORK_DIR}")
    logger.info(f"📂 Output dir: {OUTPUT_DIR}")
    logger.info(f"🔢 Batch size: {BATCH_SIZE}")
    logger.info(f"🌐 HTTP server: port {HTTP_PORT}")

    # System resources
    cpu_count = multiprocessing.cpu_count()
    ram_total = psutil.virtual_memory().total / (1024**3)  # GB
    logger.info(f"🖥️ vCPU cores: {cpu_count}")
    logger.info(f"💾 RAM total: {ram_total:.1f} GB")

    pod_id = os.getenv('RUNPOD_POD_ID')
    if pod_id:
        logger.info(f"🆔 Pod ID: {pod_id}")
        logger.info(f"🔗 Proxy URL: https://{pod_id}-{HTTP_PORT}.proxy.runpod.net/")
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
