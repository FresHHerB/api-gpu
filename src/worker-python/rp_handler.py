"""
RunPod Serverless Handler for GPU Video Processing
Handles: caption, img2vid (batch), addaudio, concatenate operations
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
import random

# Import caption generator
from caption_generator import generate_ass_from_srt, generate_ass_highlight

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

# S3/MinIO Configuration (from environment or job input)
S3_ENDPOINT_URL = os.getenv('S3_ENDPOINT_URL', 'https://minio.automear.com')
S3_ACCESS_KEY = os.getenv('S3_ACCESS_KEY', 'admin')
S3_SECRET_KEY = os.getenv('S3_SECRET_KEY', 'password')
S3_BUCKET_NAME = os.getenv('S3_BUCKET_NAME', 'canais')
S3_REGION = os.getenv('S3_REGION', 'us-east-1')

# Ensure directories exist
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# Initialize S3 client (will be reconfigured if job provides s3_config)
s3_client = boto3.client(
    's3',
    endpoint_url=S3_ENDPOINT_URL,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=boto3.session.Config(signature_version='s3v4')
)


def reconfigure_s3(s3_config: Dict[str, str]) -> None:
    """
    Reconfigure S3 client with job-specific credentials
    Allows orchestrator to pass dynamic S3 credentials per job
    """
    global s3_client, S3_ENDPOINT_URL, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET_NAME, S3_REGION

    S3_ENDPOINT_URL = s3_config.get('endpoint_url', S3_ENDPOINT_URL)
    S3_ACCESS_KEY = s3_config.get('access_key', S3_ACCESS_KEY)
    S3_SECRET_KEY = s3_config.get('secret_key', S3_SECRET_KEY)
    S3_BUCKET_NAME = s3_config.get('bucket_name', S3_BUCKET_NAME)
    S3_REGION = s3_config.get('region', S3_REGION)

    s3_client = boto3.client(
        's3',
        endpoint_url=S3_ENDPOINT_URL,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        region_name=S3_REGION,
        config=boto3.session.Config(signature_version='s3v4')
    )

    logger.info(f"🔧 S3 client reconfigured: endpoint={S3_ENDPOINT_URL}, bucket={S3_BUCKET_NAME}")

# GPU Detection
def check_gpu_available() -> bool:
    """Check if NVIDIA GPU is available for CUDA/NVENC encoding"""
    try:
        # Try nvidia-smi
        result = subprocess.run(
            ['nvidia-smi', '--query-gpu=gpu_name', '--format=csv,noheader'],
            capture_output=True,
            text=True,
            timeout=5
        )
        if result.returncode == 0 and result.stdout.strip():
            gpu_name = result.stdout.strip().split('\n')[0]
            logger.info(f"✅ GPU detected: {gpu_name}")
            return True
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception) as e:
        logger.warning(f"⚠️ GPU detection failed: {e}")

    logger.warning("⚠️ No GPU detected - will use CPU encoding")
    return False

# Global GPU availability flag (checked once at startup)
GPU_AVAILABLE = check_gpu_available()


def normalize_url(url: str) -> str:
    """
    Normalize URL to handle UTF-8 characters correctly
    Uses requote_uri to ensure proper percent-encoding
    """
    if not url:
        return url
    from requests.utils import requote_uri
    return requote_uri(url)


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
        from urllib.parse import urlparse, unquote

        # Check if URL matches configured S3 endpoint
        # Only use boto3 S3 if the host matches S3_ENDPOINT_URL
        parsed_url = urlparse(url)
        parsed_s3_endpoint = urlparse(S3_ENDPOINT_URL)

        # Compare hosts (e.g., minio.automear.com vs n8n-minio.gpqg9h.easypanel.host)
        url_host = parsed_url.netloc.lower()
        s3_host = parsed_s3_endpoint.netloc.lower()

        if url_host == s3_host:
            # URL matches configured S3 endpoint - use boto3 for optimized download
            path_parts = parsed_url.path.lstrip('/').split('/', 1)

            if len(path_parts) == 2:
                bucket = path_parts[0]
                key = unquote(path_parts[1])  # Decode URL encoding

                logger.info(f"📥 S3 download (boto3): bucket={bucket}, key={key}")
                s3_client.download_file(bucket, key, str(output_path))

                file_size = output_path.stat().st_size
                logger.info(f"✅ S3 download completed: {output_path} ({file_size} bytes)")

                if file_size == 0:
                    raise ValueError(f"Downloaded file is empty: {url}")
                return

        # Fallback: Standard HTTP download for all other URLs
        # This handles:
        # 1. Non-S3 URLs (regular HTTP/HTTPS)
        # 2. S3 URLs from different endpoints (e.g., minio.automear.com when configured for n8n-minio)

        # Properly encode URL to handle UTF-8 characters (â, ó, etc.)
        # Use requote_uri to ensure correct percent-encoding
        from requests.utils import requote_uri
        encoded_url = requote_uri(url)

        logger.info(f"🌐 HTTP download: {encoded_url}")
        response = requests.get(encoded_url, stream=True, timeout=300, allow_redirects=True)
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

        # FFmpeg command - GPU or CPU encoding based on availability
        # Note: We don't use -hwaccel cuda because it requires CUDA runtime in container
        # NVENC encoding works with just GPU drivers from host (no CUDA runtime needed)
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC - CPU decode + GPU encode)")
            cmd = [
                'ffmpeg', '-y',
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
        else:
            logger.info("💻 Using CPU encoding (libx264)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-vf', subtitles_filter,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
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
    zoom_type: str = "zoomin",
    worker_id: str = None,
    path: str = None,
    video_index: int = None
) -> Dict[str, Any]:
    """Convert image to video with various zoom effects and upload to S3

    Args:
        zoom_type: Type of zoom effect - "zoomin", "zoomout", "zoompanright"
    """
    logger.info(f"Converting image to video: {image_id}, duration: {duracao}s, fps: {frame_rate}, zoom: {zoom_type}")

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

        # Zoom parameters - Professional anti-jitter based on FFmpeg best practices
        # Study reference: High upscale (10x+) + correct pan formulas = jitter-free
        total_frames = int(frame_rate * duracao)
        upscale_factor = 10  # Professional upscale: 10x for maximum precision
        upscale_width = 1920 * upscale_factor  # 19200px
        upscale_height = 1080 * upscale_factor  # 10800px

        # Define zoom effect based on type
        # CRITICAL: NO trunc() - causes jitter due to rounding
        # Use continuous float values for smooth sub-pixel motion
        if zoom_type == "zoomout":
            # ZOOM OUT: Starts zoomed in, ends normal
            zoom_start = 1.25  # Slower, smoother zoom
            zoom_end = 1.0
            zoom_diff = zoom_start - zoom_end
            zoom_formula = f"max({zoom_start}-{zoom_diff}*on/{total_frames},{zoom_end})"
            # Centered - no trunc() for smooth motion
            x_formula = "iw/2-(iw/zoom/2)"
            y_formula = "ih/2-(ih/zoom/2)"

        elif zoom_type == "zoompanright":
            # ZOOM IN + PAN RIGHT
            # Inicia no canto esquerdo (x=0), termina no canto direito (x=x_max)
            zoom_start = 1.0
            zoom_end = 1.25  # Slower zoom for smoother effect
            zoom_diff = zoom_end - zoom_start
            zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"

            # Pan da esquerda para direita
            # x: 0 → (iw - ow/zoom)
            # Movimento linear: progresso × distância_máxima
            # IMPORTANTE: (iw-ow/zoom) é dinâmico, aumenta conforme zoom aumenta
            # Isso funciona porque começamos em 0 (fixo) e vamos para x_max (dinâmico crescente)
            x_formula = f"(iw-ow/zoom)*on/{total_frames}"

            # Centralizado verticalmente (mesma fórmula do zoomin/zoomout que funciona sem jitter)
            y_formula = "ih/2-(ih/zoom/2)"

        else:  # "zoomin" (default)
            # ZOOM IN: Starts normal, ends zoomed in
            zoom_start = 1.0
            zoom_end = 1.25  # Slower zoom for smoother effect
            zoom_diff = zoom_end - zoom_start
            zoom_formula = f"min({zoom_start}+{zoom_diff}*on/{total_frames},{zoom_end})"
            # Centered - no trunc() for smooth motion
            x_formula = "iw/2-(iw/zoom/2)"
            y_formula = "ih/2-(ih/zoom/2)"

        # Video filter with zoom effect - Bicubic downscaling for best quality
        video_filter = (
            f"scale={upscale_width}:{upscale_height}:flags=lanczos,"
            f"zoompan=z='{zoom_formula}'"
            f":d={total_frames}"
            f":x='{x_formula}'"
            f":y='{y_formula}'"
            f":s=1920x1080"
            f":fps={frame_rate},"
            f"scale=1920:1080:flags=bicubic,"  # Final downscale with bicubic for smoothness
            f"format=nv12"
        )

        # FFmpeg command - GPU or CPU encoding based on availability
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC)")
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
        else:
            logger.info("💻 Using CPU encoding (libx264)")
            cmd = [
                'ffmpeg', '-y',
                '-framerate', str(frame_rate),
                '-loop', '1',
                '-i', str(image_path),
                '-vf', video_filter,
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
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


def distribute_zoom_types(zoom_types: List[str], image_count: int) -> List[str]:
    """
    Distribute zoom types proportionally and randomly across images

    Args:
        zoom_types: List of zoom types to distribute (e.g., ["zoomin", "zoomout", "zoompanright"])
        image_count: Total number of images

    Returns:
        List of zoom types, one per image, distributed proportionally and shuffled

    Example:
        distribute_zoom_types(["zoomin", "zoomout"], 10)
        -> ["zoomin", "zoomout", "zoomin", "zoomout", ...] (shuffled)

        distribute_zoom_types(["zoomin", "zoomout", "zoompanright"], 10)
        -> 3-4 zoomin, 3-4 zoomout, 3-4 zoompanright (shuffled)
    """
    if not zoom_types or image_count == 0:
        return ["zoomin"] * image_count  # Default fallback

    # Calculate proportional distribution
    types_count = len(zoom_types)
    base_count = image_count // types_count  # Base count per type
    remainder = image_count % types_count    # Extra images to distribute

    # Build distribution list
    distribution = []
    for i, zoom_type in enumerate(zoom_types):
        # Each type gets base_count + 1 extra if remainder available
        count = base_count + (1 if i < remainder else 0)
        distribution.extend([zoom_type] * count)

    # Shuffle to randomize order (proportional but random)
    random.shuffle(distribution)

    logger.info(f"📊 Zoom distribution: {dict(zip(*[distribution, [distribution.count(t) for t in set(distribution)]]))} for {image_count} images")

    return distribution


def process_img2vid_batch(
    images: List[Dict],
    frame_rate: int = 24,
    zoom_types: List[str] = None,
    worker_id: str = None,
    path: str = None,
    start_index: int = 0
) -> Dict[str, Any]:
    """Process images to videos in sequential batches with S3 upload

    Args:
        images: List of image dictionaries
        frame_rate: Video frame rate (default: 24)
        zoom_types: List of zoom types to distribute (e.g., ["zoomin", "zoomout"])
        worker_id: Worker identifier
        path: S3 path for uploads
        start_index: Global start index for multi-worker scenarios (default: 0)
    """
    total = len(images)
    logger.info(f"📦 Processing {total} images in batches of {BATCH_SIZE}, fps: {frame_rate}, start_index: {start_index}")

    if path:
        logger.info(f"📤 S3 upload enabled: bucket={S3_BUCKET_NAME}, path={path}")

    # Distribute zoom types proportionally and randomly
    if zoom_types and len(zoom_types) > 0:
        zoom_distribution = distribute_zoom_types(zoom_types, total)
        logger.info(f"🎬 Zoom types: {zoom_types} → distributed across {total} images")
    else:
        zoom_distribution = ["zoomin"] * total  # Default
        logger.info(f"🎬 Using default zoom: zoomin for all {total} images")

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
                    zoom_distribution[i + j],  # Assign zoom type from distribution
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

        # FFmpeg command - GPU or CPU encoding based on availability
        # Note: CPU decode → CPU filter (setpts) → GPU/CPU encode
        # We don't use -hwaccel cuda because setpts filter is CPU-only
        # and causes "Impossible to convert between formats" error
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC)")
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
        else:
            logger.info("💻 Using CPU encoding (libx264)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-i', str(audio_path),
                '-filter_complex', f'[0:v]setpts={pts_multiplier:.6f}*PTS[vout]',
                '-map', '[vout]',
                '-map', '1:a',
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
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


def concatenate_videos(
    video_urls: List[Dict[str, str]],
    path: str,
    output_filename: str,
    worker_id: str = None
) -> Dict[str, Any]:
    """Concatenate multiple videos into one and upload to S3

    Args:
        video_urls: List of video dictionaries with 'video_url' key
        path: S3 path for upload
        output_filename: Output filename
        worker_id: Worker identifier (optional)
    """
    job_id = str(uuid.uuid4())
    logger.info(f"Starting concatenate job: {job_id} ({len(video_urls)} videos)")

    input_files = []
    concat_list_path = WORK_DIR / f"{job_id}_concat_list.txt"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download all videos
        for i, video_item in enumerate(video_urls):
            video_url = normalize_url(video_item['video_url'])
            input_path = WORK_DIR / f"{job_id}_input_{i}.mp4"

            logger.info(f"Downloading video {i+1}/{len(video_urls)}: {video_url}")
            download_file(video_url, input_path)
            input_files.append(input_path)

        # Generate concat list file for FFmpeg
        # Format: file 'absolute_path'
        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for input_file in input_files:
                # Use absolute path with forward slashes for FFmpeg
                abs_path = str(input_file.absolute()).replace('\\', '/')
                f.write(f"file '{abs_path}'\n")

        logger.info(f"Generated concat list with {len(input_files)} files")

        # FFmpeg concat command - GPU or CPU encoding
        # Use concat demuxer with -c copy for fast concatenation (no re-encoding)
        # This works when all videos have same codec/resolution/fps
        # If videos differ, we'll need to re-encode
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC) for concatenation")
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', str(concat_list_path),
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
                '-movflags', '+faststart',
                str(output_path)
            ]
        else:
            logger.info("💻 Using CPU encoding (libx264) for concatenation")
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', str(concat_list_path),
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
                '-maxrate', '10M',
                '-bufsize', '20M',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-movflags', '+faststart',
                str(output_path)
            ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Videos concatenated: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
        # S3 key: {path}/{filename} (path may include /videos/temp/)
        # Ensure path ends with / for proper S3 key construction
        if not path.endswith('/'):
            path = path + '/'
        s3_key = f"{path}{output_filename}"
        video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

        # Cleanup local file after S3 upload
        output_path.unlink(missing_ok=True)

        return {
            'video_url': video_url,
            'filename': output_filename,
            's3_key': s3_key,
            'video_count': len(video_urls)
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input files and concat list
        for input_file in input_files:
            input_file.unlink(missing_ok=True)
        concat_list_path.unlink(missing_ok=True)


def add_caption_segments(
    url_video: str,
    url_srt: str,
    path: str,
    output_filename: str,
    style: Dict[str, Any],
    worker_id: str = None
) -> Dict[str, Any]:
    """
    Add segments caption with custom styling to video and upload to S3

    Args:
        url_video: URL of the video file
        url_srt: URL of the SRT subtitle file
        path: S3 path for upload
        output_filename: Output filename
        style: Style configuration dict
        worker_id: Worker identifier (optional)
    """
    video_id = str(uuid.uuid4())
    logger.info(f"Starting caption segments job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_input.mp4"
    srt_path = WORK_DIR / f"{video_id}_caption.srt"
    ass_path = WORK_DIR / f"{video_id}_caption.ass"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and SRT
        download_file(url_video, video_path)
        download_file(url_srt, srt_path)

        # Generate ASS file from SRT with custom styling
        logger.info(f"Generating ASS from SRT with custom style")
        generate_ass_from_srt(srt_path, ass_path, style)

        # Normalize ASS path for FFmpeg (escape colons)
        normalized_ass = str(ass_path).replace('\\', '/').replace(':', '\\:')

        # FFmpeg command with ASS subtitles
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-vf', f"ass='{normalized_ass}'",
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
        else:
            logger.info("💻 Using CPU encoding (libx264)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-vf', f"ass='{normalized_ass}'",
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
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
        logger.info(f"✅ Caption segments added: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
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
        ass_path.unlink(missing_ok=True)


def add_caption_highlight(
    url_video: str,
    url_words_json: str,
    path: str,
    output_filename: str,
    style: Dict[str, Any],
    worker_id: str = None
) -> Dict[str, Any]:
    """
    Add highlight caption (word-level) to video and upload to S3

    Args:
        url_video: URL of the video file
        url_words_json: URL of the words JSON file
        path: S3 path for upload
        output_filename: Output filename
        style: Style configuration dict
        worker_id: Worker identifier (optional)
    """
    video_id = str(uuid.uuid4())
    logger.info(f"Starting caption highlight job: {video_id}")

    video_path = WORK_DIR / f"{video_id}_input.mp4"
    json_path = WORK_DIR / f"{video_id}_words.json"
    ass_path = WORK_DIR / f"{video_id}_highlight.ass"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and words JSON
        download_file(url_video, video_path)
        download_file(url_words_json, json_path)

        # Generate ASS file with highlight from JSON
        logger.info(f"Generating highlight ASS from JSON")
        generate_ass_highlight(json_path, ass_path, style)

        # Normalize ASS path for FFmpeg (escape colons)
        normalized_ass = str(ass_path).replace('\\', '/').replace(':', '\\:')

        # FFmpeg command with ASS subtitles
        if GPU_AVAILABLE:
            logger.info("🎮 Using GPU encoding (NVENC)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-vf', f"ass='{normalized_ass}'",
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
        else:
            logger.info("💻 Using CPU encoding (libx264)")
            cmd = [
                'ffmpeg', '-y',
                '-i', str(video_path),
                '-vf', f"ass='{normalized_ass}'",
                '-c:v', 'libx264',
                '-preset', 'medium',
                '-crf', '23',
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
        logger.info(f"✅ Caption highlight added: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
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
        json_path.unlink(missing_ok=True)
        ass_path.unlink(missing_ok=True)


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

    # Reconfigure S3 client if job provides s3_config
    s3_config = job_input.get('s3_config')
    if s3_config:
        logger.info("🔧 Reconfiguring S3 client with job-specific credentials")
        reconfigure_s3(s3_config)

    try:
        if operation == 'caption':
            url_video = normalize_url(job_input.get('url_video'))
            url_srt = normalize_url(job_input.get('url_srt'))
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
            zoom_types = job_input.get('zoom_types', ['zoomin'])  # Default: zoomin only
            start_index = job_input.get('start_index', 0)  # Global start index for multi-worker

            if not images or not path:
                raise ValueError("Missing required fields: images, path")

            # Normalize all image URLs
            for img in images:
                if 'image_url' in img:
                    img['image_url'] = normalize_url(img['image_url'])

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, zoom_types={zoom_types}, start_index={start_index}")
            result = process_img2vid_batch(images, frame_rate, zoom_types, worker_id, path, start_index)

            return {
                "success": True,
                **result
            }

        elif operation == 'addaudio':
            url_video = normalize_url(job_input.get('url_video'))
            url_audio = normalize_url(job_input.get('url_audio'))
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

        elif operation == 'caption_segments':
            url_video = normalize_url(job_input.get('url_video'))
            url_srt = normalize_url(job_input.get('url_srt'))
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')
            style = job_input.get('style', {})

            if not url_video or not url_srt or not path or not output_filename:
                raise ValueError("Missing required fields: url_video, url_srt, path, output_filename")

            logger.info(f"📤 S3 upload with segments styling: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            logger.info(f"🎨 Style: {style}")

            result = add_caption_segments(url_video, url_srt, path, output_filename, style, worker_id)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "message": "Caption segments added and uploaded to S3 successfully"
            }

        elif operation == 'caption_highlight':
            url_video = normalize_url(job_input.get('url_video'))
            url_words_json = normalize_url(job_input.get('url_words_json'))
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')
            style = job_input.get('style', {})

            if not url_video or not url_words_json or not path or not output_filename:
                raise ValueError("Missing required fields: url_video, url_words_json, path, output_filename")

            logger.info(f"📤 S3 upload with highlight styling: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            logger.info(f"🎨 Style: {style}")

            result = add_caption_highlight(url_video, url_words_json, path, output_filename, style, worker_id)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "message": "Caption highlight added and uploaded to S3 successfully"
            }

        elif operation == 'concatenate':
            video_urls = job_input.get('video_urls', [])
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')

            if not video_urls or not path or not output_filename:
                raise ValueError("Missing required fields: video_urls, path, output_filename")

            if len(video_urls) < 2:
                raise ValueError("At least 2 videos are required for concatenation")

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            logger.info(f"🎬 Concatenating {len(video_urls)} videos")

            result = concatenate_videos(video_urls, path, output_filename, worker_id)
            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "video_count": result['video_count'],
                "message": f"{result['video_count']} videos concatenated and uploaded to S3 successfully"
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

    # GPU status
    if GPU_AVAILABLE:
        logger.info("🎮 GPU: ENABLED (NVENC acceleration)")
    else:
        logger.info("💻 GPU: DISABLED (CPU-only encoding)")

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
