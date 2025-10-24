"""
RunPod Serverless Handler for CPU-Optimized Video Processing
Handles: caption, img2vid (batch), addaudio, concatenate operations
Returns video URLs via HTTP server running on worker

ARCHITECTURE:
  - img2vid: CPU-only (libx264 veryfast) - optimized for short videos
  - Other operations: GPU if available, CPU fallback
  - Dynamic BATCH_SIZE based on available CPU cores
  - RAM cache (/dev/shm) for faster I/O
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
import multiprocessing
import psutil
import math
import base64

# Import caption generator
from caption_generator import generate_ass_from_srt, generate_ass_highlight

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def get_container_cpu_quota() -> Optional[int]:
    """
    Get CPU quota allocated to container using RunPod environment variables

    Priority:
      1. RUNPOD_CPU_COUNT (official RunPod env var)
      2. cgroup v2 (/sys/fs/cgroup/cpu.max)
      3. cgroup v1 (/sys/fs/cgroup/cpu/cpu.cfs_quota_us)

    Returns:
        Number of vCPUs allocated to container, or None if not detected

    Example:
        RUNPOD_CPU_COUNT=9 → returns 9
    """
    try:
        # Priority 1: RunPod official environment variable
        runpod_cpu_count = os.getenv('RUNPOD_CPU_COUNT')
        if runpod_cpu_count:
            cpu_count = int(runpod_cpu_count)
            logger.info(f"✅ RunPod CPU count: {cpu_count} vCPUs (RUNPOD_CPU_COUNT)")
            return cpu_count

        # Priority 2: cgroup v2 (newer Linux)
        cpu_max_path = Path('/sys/fs/cgroup/cpu.max')
        if cpu_max_path.exists():
            content = cpu_max_path.read_text().strip()
            # Format: "quota period" (e.g., "800000 100000")
            parts = content.split()
            if len(parts) == 2 and parts[0] != 'max':
                quota = int(parts[0])
                period = int(parts[1])
                vcpus = int(quota / period)
                logger.info(f"📊 cgroup v2: quota={quota}, period={period}, vCPUs={vcpus}")
                return vcpus

        # Priority 3: cgroup v1 (older Linux, Docker default)
        quota_path = Path('/sys/fs/cgroup/cpu/cpu.cfs_quota_us')
        period_path = Path('/sys/fs/cgroup/cpu/cpu.cfs_period_us')

        if quota_path.exists() and period_path.exists():
            quota = int(quota_path.read_text().strip())
            period = int(period_path.read_text().strip())

            # quota = -1 means no limit
            if quota > 0:
                vcpus = int(quota / period)
                logger.info(f"📊 cgroup v1: quota={quota}, period={period}, vCPUs={vcpus}")
                return vcpus

        logger.warning("⚠️ No container CPU quota found (RUNPOD_CPU_COUNT not set, cgroup not available)")
        return None

    except Exception as e:
        logger.warning(f"⚠️ Failed to detect container CPU quota: {e}")
        return None


def calculate_optimal_batch_size() -> int:
    """
    Calculate optimal BATCH_SIZE based on available CPU resources

    Container-aware detection (priority order):
      1. RUNPOD_CPU_COUNT environment variable (official RunPod)
      2. cgroup CPU quota (container limits)
      3. System CPU count (fallback, may be inaccurate in containers)

    Strategy:
      - Zoompan filter is CPU-bound and single-threaded per task
      - Optimal: 1.5x vCPUs (to account for I/O wait time)
      - Min: 2, Max: 16 (avoid excessive thread contention)

    Returns:
        Optimal batch size for parallel image processing
    """
    try:
        # Try to get container CPU quota first (accurate for containers)
        container_vcpus = get_container_cpu_quota()

        if container_vcpus is not None:
            # Use container vCPUs (accurate)
            cpu_count = container_vcpus
            detection_method = "RunPod/container"
        else:
            # Fallback to system detection (may be host CPUs in containers!)
            cpu_count = multiprocessing.cpu_count()
            detection_method = "system fallback"
            logger.warning(f"⚠️ Using system CPU count (may be inaccurate in containers): {cpu_count}")

        # Formula: 1.5x vCPUs (overlap CPU work with I/O)
        # For 9 vCPUs: 1.5 * 9 = 13.5 → 13
        optimal = int(cpu_count * 1.5)

        # Clamp between 2 and 16
        batch_size = max(2, min(16, optimal))

        logger.info(f"🔢 vCPUs detected: {cpu_count} ({detection_method})")
        logger.info(f"🎯 Calculated optimal BATCH_SIZE: {batch_size}")

        return batch_size

    except Exception as e:
        logger.warning(f"⚠️ Failed to calculate optimal batch size: {e}")
        return 4  # Safe fallback


# Use RAM cache if /dev/shm is available (faster I/O)
def get_optimal_work_dir() -> Path:
    """
    Determine optimal working directory (RAM cache if available)

    /dev/shm = tmpfs (RAM-based filesystem)
      - No disk I/O
      - 10-50x faster than disk
      - Automatically cleaned on reboot

    Returns:
        Path to optimal working directory
    """
    # Check if /dev/shm exists and has sufficient space
    shm_path = Path('/dev/shm')

    if shm_path.exists() and shm_path.is_dir():
        try:
            # Check available space (need at least 2GB for image processing)
            disk = psutil.disk_usage(str(shm_path))
            available_gb = disk.free / (1024**3)

            if available_gb >= 2.0:
                work_dir = shm_path / 'work'
                output_dir = shm_path / 'output'
                logger.info(f"✅ Using RAM cache: {shm_path} ({available_gb:.1f} GB available)")
                return work_dir, output_dir
            else:
                logger.warning(f"⚠️ /dev/shm has insufficient space: {available_gb:.1f} GB")
        except Exception as e:
            logger.warning(f"⚠️ Cannot check /dev/shm: {e}")

    # Fallback to /tmp
    logger.info("📂 Using disk cache: /tmp")
    return Path('/tmp/work'), Path('/tmp/output')


# Directories - Use RAM cache if available
WORK_DIR, OUTPUT_DIR = get_optimal_work_dir()
BATCH_SIZE = calculate_optimal_batch_size()
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


def convert_google_drive_url(url: str) -> str:
    """
    Convert Google Drive sharing URL to direct download URL

    Supported formats:
    - https://drive.google.com/file/d/FILE_ID/view?usp=drive_link
    - https://drive.google.com/file/d/FILE_ID/view
    - https://drive.google.com/file/d/FILE_ID/edit
    - https://drive.google.com/file/d/FILE_ID
    - https://drive.google.com/open?id=FILE_ID

    Returns:
    - https://drive.google.com/uc?export=download&id=FILE_ID

    Example:
        >>> convert_google_drive_url("https://drive.google.com/file/d/ABC123/view?usp=drive_link")
        "https://drive.google.com/uc?export=download&id=ABC123"
    """
    import re

    # Extract file ID from various Google Drive URL formats
    patterns = [
        r'/file/d/([a-zA-Z0-9_-]+)',          # /file/d/ID/view, /file/d/ID/edit, /file/d/ID
        r'[?&]id=([a-zA-Z0-9_-]+)',            # ?id=ID or &id=ID
    ]

    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            file_id = match.group(1)
            direct_url = f"https://drive.google.com/uc?export=download&id={file_id}"
            logger.info(f"🔗 Converted Google Drive URL: {file_id}")
            return direct_url

    # If not a Google Drive URL or no match, return as-is
    logger.warning(f"⚠️ Could not extract Google Drive file ID from: {url}")
    return url


def download_google_drive_file(url: str, output_path: Path) -> None:
    """
    Download file from Google Drive, handling large files (>25MB)

    Google Drive shows a virus scan warning for large files, requiring
    a confirmation token. This function handles that automatically.

    Args:
        url: Google Drive URL (will be converted if needed)
        output_path: Path to save the downloaded file

    Raises:
        ValueError: If download fails or file is empty
        requests.exceptions.RequestException: On network errors
    """
    # Convert to direct download URL if needed
    if 'drive.google.com' in url and '/uc?' not in url:
        url = convert_google_drive_url(url)

    logger.info(f"📥 Downloading from Google Drive: {url}")

    try:
        session = requests.Session()

        # Initial request
        response = session.get(url, stream=True, timeout=300, allow_redirects=True)
        response.raise_for_status()

        # Check for virus scan warning (large files >25MB)
        # Google Drive returns HTML page with confirmation for large files
        content_type = response.headers.get('Content-Type', '')

        if 'text/html' in content_type:
            logger.info("📋 Large file detected - handling virus scan confirmation...")

            # Extract UUID from HTML (new Google Drive method)
            # HTML contains: <input type="hidden" name="uuid" value="xxxxx-xxxxx-xxxxx-xxxxx-xxxxx">
            html_content = response.text

            import re
            uuid_match = re.search(r'name="uuid"\s+value="([a-f0-9\-]+)"', html_content)
            file_id_match = re.search(r'name="id"\s+value="([a-zA-Z0-9_\-]+)"', html_content)

            if uuid_match and file_id_match:
                uuid = uuid_match.group(1)
                file_id = file_id_match.group(1)

                # Build new URL with drive.usercontent.google.com
                confirm_url = f"https://drive.usercontent.google.com/download?id={file_id}&export=download&confirm=t&uuid={uuid}"
                logger.info(f"🔄 Retrying with UUID: {uuid[:8]}...")

                response = session.get(confirm_url, stream=True, timeout=300, allow_redirects=True)
                response.raise_for_status()
            else:
                # Fallback: try old method with download_warning cookie
                logger.warning("⚠️ Could not extract UUID from HTML, trying old cookie method...")
                token = None
                for key, value in response.cookies.items():
                    if key.startswith('download_warning'):
                        token = value
                        break

                if token:
                    confirm_url = url + f"&confirm={token}"
                    logger.info(f"🔄 Retrying with cookie token...")
                    response = session.get(confirm_url, stream=True, timeout=300, allow_redirects=True)
                    response.raise_for_status()
                else:
                    raise ValueError("Could not extract confirmation token from Google Drive. File may be private or restricted.")

        # Download file in chunks
        total_size = 0
        with open(output_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
                    total_size += len(chunk)

        file_size = output_path.stat().st_size
        file_size_mb = file_size / (1024 * 1024)

        logger.info(f"✅ Google Drive download completed: {output_path.name} ({file_size_mb:.2f} MB)")

        if file_size == 0:
            raise ValueError(f"Downloaded file is empty: {url}")

        # Verify it's not an error HTML page (Google Drive sometimes returns HTML instead of file)
        with open(output_path, 'rb') as f:
            header = f.read(500)
            # Check if it's an HTML error page
            content_start = header.decode('utf-8', errors='ignore')
            if '<html' in content_start.lower() or '<!doctype' in content_start.lower():
                raise ValueError(f"Google Drive returned HTML instead of file. File may be private or restricted. First 200 chars: {content_start[:200]}")

            # Check for valid file formats (MP4, MP3, WAV, etc.)
            # MP4: 'ftyp' at offset 4-8
            # MP3: starts with 'ID3' or has 0xFF 0xFB sync pattern
            # WAV: starts with 'RIFF' and contains 'WAVE'
            if len(header) >= 12:
                is_mp4 = b'ftyp' in header[:12]
                is_mp3 = header[:3] == b'ID3' or (header[0] == 0xFF and header[1] & 0xE0 == 0xE0)
                is_wav = header[:4] == b'RIFF' and b'WAVE' in header[:20]

                if not (is_mp4 or is_mp3 or is_wav):
                    logger.warning(f"⚠️ Downloaded file format unknown (not MP4/MP3/WAV): {output_path.name}")
                    # Don't fail - might be other valid format
                else:
                    format_name = 'MP4' if is_mp4 else ('MP3' if is_mp3 else 'WAV')
                    logger.info(f"✓ Validated file format: {format_name}")

    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Google Drive download failed: {e}")
        raise
    except Exception as e:
        logger.error(f"❌ Failed to download from Google Drive: {e}")
        raise


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


def get_image_metadata(image_path: Path) -> Optional[Dict[str, int]]:
    """Get image dimensions using ffprobe"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            str(image_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        import json
        metadata = json.loads(result.stdout)

        # Find video stream (images are treated as video by ffprobe)
        for stream in metadata.get('streams', []):
            if stream.get('codec_type') == 'video':
                width = stream.get('width')
                height = stream.get('height')
                if width and height:
                    logger.info(f"Image metadata: {width}x{height}")
                    return {'width': width, 'height': height}

        logger.warning(f"Could not extract image dimensions from {image_path}")
        return None

    except Exception as e:
        logger.warning(f"Failed to get image metadata: {e}")
        return None


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

        # Get image metadata for optimal upscaling
        image_metadata = get_image_metadata(image_path)

        # Zoom parameters - Optimized upscale (6x) for balanced quality and performance
        # Use FLOAT for precise animation timing - no rounding to ensure animation completes exactly at video end
        total_frames = frame_rate * duracao  # e.g., 24 * 3.33 = 79.92 frames (precise)
        upscale_factor = 6  # Balanced upscale: 6x for good quality and faster processing

        # Use actual image dimensions if available, otherwise default to 1920x1080
        if image_metadata:
            upscale_width = image_metadata['width'] * upscale_factor
            upscale_height = image_metadata['height'] * upscale_factor
            logger.info(f"Using actual image dimensions: {image_metadata['width']}x{image_metadata['height']} → {upscale_width}x{upscale_height}")
        else:
            upscale_width = 1920 * upscale_factor  # 11520px
            upscale_height = 1080 * upscale_factor  # 6480px
            logger.info(f"Using default dimensions: 1920x1080 → {upscale_width}x{upscale_height}")

        # Define zoom effect based on type
        # CRITICAL: NO trunc() - causes jitter due to rounding
        # Use continuous float values for smooth sub-pixel motion
        if zoom_type == "zoomout":
            # ZOOM OUT: Starts zoomed in, ends normal
            zoom_start = 1.35  # Slower, smoother zoom
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
            zoom_end = 1.40  # Slower zoom for smoother effect
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
            zoom_end = 1.40  # Slower zoom for smoother effect
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

        # FFmpeg command - ALWAYS use CPU encoding for img2vid
        # Rationale: For short videos (6-10s), libx264 veryfast is faster than NVENC
        # - libx264 veryfast: ~190 fps, minimal overhead (~0.05s)
        # - NVENC: ~180 fps but with 1.3s initialization overhead
        # - Result: CPU is 2x faster for our use case
        logger.info("💻 Using CPU encoding (libx264 veryfast) - optimized for short videos")
        cmd = [
            'ffmpeg', '-y',
            '-framerate', str(frame_rate),
            '-loop', '1',
            '-i', str(image_path),
            '-vf', video_filter,
            '-c:v', 'libx264',
            '-preset', 'veryfast',  # ~190 fps, minimal overhead
            '-crf', '23',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-threads', '0',  # Auto-select optimal thread count
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
    """Get duration of media file using ffprobe with multiple fallback methods"""
    try:
        cmd = [
            'ffprobe',
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_format',
            '-show_streams',
            str(file_path)
        ]

        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        import json
        metadata = json.loads(result.stdout)

        # Try multiple methods to get duration
        duration = None

        # Method 1: format.duration (most reliable for most files)
        if 'format' in metadata and 'duration' in metadata['format']:
            duration = float(metadata['format']['duration'])
            logger.info(f"Duration from format.duration: {duration:.2f}s")

        # Method 2: streams[0].duration (fallback for some audio files from Google Drive)
        elif 'streams' in metadata and len(metadata['streams']) > 0:
            if 'duration' in metadata['streams'][0]:
                duration = float(metadata['streams'][0]['duration'])
                logger.info(f"Duration from streams[0].duration: {duration:.2f}s")

        # Method 3: Calculate from bitrate and size (last resort)
        if duration is None and 'format' in metadata:
            if 'size' in metadata['format'] and 'bit_rate' in metadata['format']:
                size_bytes = int(metadata['format']['size'])
                bit_rate = int(metadata['format']['bit_rate'])
                duration = (size_bytes * 8) / bit_rate
                logger.info(f"Duration calculated from size/bitrate: {duration:.2f}s")

        if duration is None:
            # Dump metadata for debugging
            logger.error(f"No duration found in metadata. Full metadata: {json.dumps(metadata, indent=2)}")
            raise RuntimeError("No duration information available in media file metadata")

        logger.info(f"✓ Duration of {file_path.name}: {duration:.2f}s")
        return duration

    except subprocess.CalledProcessError as e:
        logger.error(f"FFprobe command failed for {file_path}: {e.stderr}")
        raise RuntimeError(f"FFprobe failed: {e.stderr}")
    except Exception as e:
        logger.error(f"Failed to get duration for {file_path}: {e}")
        raise RuntimeError(f"Failed to get media duration: {e}")


def analyze_audio_volume(file_path: Path) -> float:
    """Analyze audio volume using FFmpeg volumedetect and return mean volume in dB"""
    try:
        cmd = [
            'ffmpeg', '-i', str(file_path),
            '-af', 'volumedetect',
            '-f', 'null', '-'
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, check=False)
        output = result.stdout + result.stderr

        # Extract mean_volume from output
        import re
        match = re.search(r'mean_volume:\s*([-\d.]+)\s*dB', output)
        if match:
            mean_volume = float(match.group(1))
            return mean_volume
        else:
            logger.warning(f"Could not extract mean_volume from volumedetect output")
            return -20.0  # Default fallback
    except Exception as e:
        logger.warning(f"Error analyzing audio volume: {e}")
        return -20.0  # Default fallback


def add_trilha_sonora(
    url_video: str,
    trilha_sonora_url: str,
    path: str,
    output_filename: str,
    volume_reduction_db: float = None,  # Now optional - will be calculated if not provided
    worker_id: str = None
) -> Dict[str, Any]:
    """Add background music (trilha sonora) to video, looping to match video duration

    Automatically normalizes trilha volume to be 12dB below video audio for optimal mixing.
    If volume_reduction_db is provided, uses that value instead of auto-calculation.
    """
    job_id = str(uuid.uuid4())
    logger.info(f"Starting trilha sonora job: {job_id}")

    video_path = WORK_DIR / f"{job_id}_video.mp4"
    trilha_path = WORK_DIR / f"{job_id}_trilha.mp3"
    output_path = OUTPUT_DIR / output_filename

    try:
        # Download video and soundtrack
        logger.info(f"📥 Downloading video from: {url_video}")
        download_file(url_video, video_path)

        # Download trilha sonora (use specialized Google Drive downloader if needed)
        logger.info(f"📥 Downloading trilha sonora from: {trilha_sonora_url}")
        if 'drive.google.com' in trilha_sonora_url:
            logger.info("🎵 Using Google Drive downloader for trilha sonora")
            download_google_drive_file(trilha_sonora_url, trilha_path)
        else:
            download_file(trilha_sonora_url, trilha_path)

        # Get durations
        video_duration = get_duration(video_path)
        trilha_duration = get_duration(trilha_path)

        logger.info(f"📊 Duration: video={video_duration:.2f}s, trilha={trilha_duration:.2f}s")

        # Analyze volumes and calculate optimal reduction
        if volume_reduction_db is None:
            logger.info("🔊 Analyzing audio levels for automatic normalization...")
            video_mean_db = analyze_audio_volume(video_path)
            trilha_mean_db = analyze_audio_volume(trilha_path)

            # Calculate reduction needed to make trilha 20dB below video
            # Formula: reduction = trilha_current - (video_current - 20)
            #          reduction = trilha_current - video_current + 20
            target_offset = 20.0  # Trilha should be 20dB below video
            volume_reduction_db = trilha_mean_db - video_mean_db + target_offset

            # Ensure reduction is within reasonable bounds (0-40 dB)
            volume_reduction_db = max(0, min(40, volume_reduction_db))

            logger.info(f"📊 Audio Analysis:")
            logger.info(f"   Video mean volume: {video_mean_db:.2f} dB")
            logger.info(f"   Trilha mean volume: {trilha_mean_db:.2f} dB")
            logger.info(f"   Calculated reduction: {volume_reduction_db:.2f} dB")
            logger.info(f"   Result: Trilha will be ~20dB below video (subtle background music)")
        else:
            logger.info(f"🔊 Using manual volume reduction: {volume_reduction_db:.2f} dB")

        # Calculate how many loops we need
        loops_needed = int(video_duration / trilha_duration) + 1
        logger.info(f"🔁 Trilha will be looped {loops_needed} times to match video duration")

        # Build FFmpeg filter complex:
        # 1. Loop the soundtrack audio (aloop filter)
        # 2. Reduce soundtrack volume
        # 3. Mix original video audio with looped/reduced soundtrack
        # 4. Cut to video duration
        filter_complex = (
            f"[1:a]aloop=loop={loops_needed}:size=2e+09[loop];"  # Loop soundtrack (size=2e+09 for safety)
            f"[loop]volume=-{volume_reduction_db}dB[reduced];"   # Reduce volume
            f"[0:a][reduced]amix=inputs=2:duration=first[aout]"  # Mix original + reduced soundtrack
        )

        # FFmpeg command - Use CPU encoding for VPS
        logger.info("💻 Using CPU encoding (libx264)")
        cmd = [
            'ffmpeg', '-y',
            '-i', str(video_path),      # Input 0: video with original audio
            '-i', str(trilha_path),      # Input 1: trilha sonora
            '-filter_complex', filter_complex,
            '-map', '0:v',               # Map video from input 0
            '-map', '[aout]',            # Map mixed audio
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '23',
            '-maxrate', '10M',
            '-bufsize', '20M',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',                 # Cut to shortest stream (video duration)
            '-movflags', '+faststart',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd[:20])}...")  # Log first 20 args
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Trilha sonora added: {output_filename} ({file_size_mb:.2f} MB)")

        # Upload to S3
        s3_key = f"{path}{output_filename}"
        video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

        # Cleanup local files
        output_path.unlink(missing_ok=True)

        result = {
            'video_url': video_url,
            'filename': output_filename,
            's3_key': s3_key,
            'video_duration': video_duration,
            'trilha_duration': trilha_duration,
            'loops_applied': loops_needed,
            'volume_reduction_db': round(volume_reduction_db, 2)
        }

        # Add audio analysis info if auto-normalization was used
        if 'video_mean_db' in locals() and 'trilha_mean_db' in locals():
            result['audio_analysis'] = {
                'video_mean_db': round(video_mean_db, 2),
                'trilha_mean_db': round(trilha_mean_db, 2),
                'trilha_final_db': round(trilha_mean_db - volume_reduction_db, 2),
                'target_offset_db': 20.0,
                'normalization_applied': True
            }
        else:
            result['audio_analysis'] = {
                'normalization_applied': False,
                'manual_reduction': True
            }

        return result

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup input files
        video_path.unlink(missing_ok=True)
        trilha_path.unlink(missing_ok=True)


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


def concatenate_videos_cyclic(
    video_urls: List[str],
    audio_url: str,
    path: str,
    output_filename: str,
    normalize: bool = True,
    worker_id: str = None
) -> Dict[str, Any]:
    """
    Concatenate videos from URLs cyclically to match audio duration
    Optimized for CPU performance using concat demuxer with -c copy

    Supports:
    - Google Drive URLs (all formats)
    - S3/MinIO URLs
    - Direct HTTP/HTTPS URLs

    Args:
        video_urls: List of video URLs (Google Drive, S3, HTTP, etc.)
        audio_url: URL of the MP3 audio file
        path: S3 path for upload (e.g., "Channel Name/Video Title/videos/")
        output_filename: Output filename (e.g., "video_final.mp4")
        normalize: Normalize videos to same spec (enables -c copy, default: True)
        worker_id: Worker identifier (optional)

    Returns:
        Dict with video_url, filename, s3_key, cycle_count
    """
    job_id = str(uuid.uuid4())
    logger.info(f"Starting cyclic concatenation job: {job_id}")
    logger.info(f"Videos: {len(video_urls)}, Normalize: {normalize}")

    # Working directories
    work_dir = WORK_DIR / job_id
    work_dir.mkdir(exist_ok=True)

    output_path = OUTPUT_DIR / output_filename
    concat_list_path = work_dir / "concat_list.txt"
    audio_path = work_dir / "audio.mp3"

    # Track files for cleanup
    input_files: List[Path] = []
    normalized_files: List[Path] = []
    trimmed_files: List[Path] = []

    try:
        # Step 1: Download videos from URLs
        logger.info(f"📥 Downloading {len(video_urls)} videos from URLs...")
        start_download = time.time()

        for i, video_url in enumerate(video_urls):
            video_path = work_dir / f"video_{i}.mp4"

            # Detect and handle Google Drive URLs
            if 'drive.google.com' in video_url:
                logger.info(f"  📥 Video {i}: Google Drive")
                download_google_drive_file(video_url, video_path)
            else:
                # S3, HTTP, or other URLs
                logger.info(f"  📥 Video {i}: {video_url[:50]}...")
                download_file(video_url, video_path)

            input_files.append(video_path)
            file_size_mb = video_path.stat().st_size / (1024*1024)
            logger.info(f"  ✓ Video {i}: {file_size_mb:.2f} MB")

        download_time = time.time() - start_download
        logger.info(f"✅ Download complete: {download_time:.2f}s ({len(video_urls)} videos)")

        # Step 2: Download audio and get duration
        logger.info(f"📥 Downloading audio: {audio_url}")
        download_file(audio_url, audio_path)

        # Get audio duration using ffprobe
        probe_cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(audio_path)
        ]
        result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        audio_duration = float(result.stdout.strip())
        logger.info(f"🎵 Audio duration: {audio_duration:.2f}s")

        # Step 3: Get video durations with millisecond precision
        video_durations = []
        for video_path in input_files:
            probe_cmd = [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration',
                '-of', 'default=noprint_wrappers=1:nokey=1',
                str(video_path)
            ]
            result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
            duration = float(result.stdout.strip())
            video_durations.append(duration)
            logger.info(f"  ✓ Video {input_files.index(video_path)}: {duration:.3f}s")

        total_cycle_duration = sum(video_durations)
        logger.info(f"🔄 Total cycle duration: {total_cycle_duration:.3f}s")
        logger.info(f"🎵 Audio duration: {audio_duration:.3f}s")

        # Step 4: Normalize videos (if enabled)
        files_to_concat = input_files

        if normalize:
            logger.info(f"⚙️ Normalizing {len(input_files)} videos to 1080p@30fps, H.264 High (VIDEO ONLY - removing audio)...")
            start_normalize = time.time()

            for i, video_path in enumerate(input_files):
                normalized_path = work_dir / f"normalized_{i}.mp4"

                # Scale to 1080p maintaining aspect ratio, add black bars if needed
                # force_original_aspect_ratio=decrease: fits inside 1920x1080
                # pad: adds black bars to reach exact 1920x1080
                vf_scale_pad = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"

                cmd = [
                    'ffmpeg', '-y',
                    '-i', str(video_path),
                    '-vf', vf_scale_pad,  # Scale + Pad for 1080p without distortion
                    '-r', '30',           # Force 30fps
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-profile:v', 'high',
                    '-level', '4.0',
                    '-pix_fmt', 'yuv420p',
                    '-an',                # REMOVE AUDIO - only MP3 audio will be used
                    '-movflags', '+faststart',
                    str(normalized_path)
                ]

                subprocess.run(cmd, capture_output=True, text=True, check=True)
                normalized_files.append(normalized_path)
                logger.info(f"  ✓ Normalized video {i}: {normalized_path.stat().st_size / (1024*1024):.2f} MB (video only, no audio)")

            normalize_time = time.time() - start_normalize
            logger.info(f"✅ Normalization complete: {normalize_time:.2f}s")

            # Use normalized files for concatenation
            files_to_concat = normalized_files

        # Step 5: Calculate EXACT video sequence to match audio duration
        logger.info(f"🔢 Calculating exact video sequence to match audio duration...")

        video_sequence = []  # List of (video_path, duration_to_use)
        accumulated_duration = 0.0
        video_index = 0
        segment_count = 0

        while accumulated_duration < audio_duration:
            current_video = files_to_concat[video_index]
            current_video_duration = video_durations[video_index]
            remaining_audio = audio_duration - accumulated_duration

            if remaining_audio >= current_video_duration:
                # Use full video
                video_sequence.append((current_video, current_video_duration, False))
                accumulated_duration += current_video_duration
                segment_count += 1
                logger.info(f"  + Segment {segment_count}: video_{video_index} (full, {current_video_duration:.3f}s) → total: {accumulated_duration:.3f}s")
            else:
                # Use partial video - need to trim to EXACT duration
                video_sequence.append((current_video, remaining_audio, True))
                accumulated_duration += remaining_audio
                segment_count += 1
                logger.info(f"  + Segment {segment_count}: video_{video_index} (partial, {remaining_audio:.3f}s) → total: {accumulated_duration:.3f}s")
                break  # Reached exact audio duration

            # Move to next video (cyclic)
            video_index = (video_index + 1) % len(files_to_concat)

        logger.info(f"✅ Sequence calculated: {segment_count} segments, total duration: {accumulated_duration:.3f}s")

        # Step 6: Create trimmed version of partial video (if needed)
        for idx, (video_path, duration_to_use, is_partial) in enumerate(video_sequence):
            if is_partial:
                logger.info(f"✂️ Trimming last segment to {duration_to_use:.3f}s for exact match...")
                trimmed_path = work_dir / f"trimmed_last.mp4"

                # Use re-encode for frame-accurate trim (veryfast is still fast)
                # IMPORTANT: Must match normalize specs if normalize=true
                cmd = [
                    'ffmpeg', '-y',
                    '-i', str(video_path),
                    '-t', f'{duration_to_use:.3f}',  # Millisecond precision
                ]

                # Match normalization specs if enabled
                if normalize:
                    # Same scale+pad as normalize to maintain aspect ratio
                    vf_scale_pad = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black"
                    cmd.extend([
                        '-vf', vf_scale_pad,  # Scale + Pad for 1080p without distortion
                        '-r', '30',           # Force 30fps (same as normalize)
                    ])

                cmd.extend([
                    '-c:v', 'libx264',
                    '-preset', 'veryfast',
                    '-profile:v', 'high',
                    '-level', '4.0',
                    '-pix_fmt', 'yuv420p',
                ])

                # Remove audio if normalize=true (only MP3 audio will be used)
                if normalize:
                    cmd.append('-an')  # Remove audio track
                else:
                    # Keep audio if not normalizing
                    cmd.extend([
                        '-c:a', 'aac',
                        '-ar', '48000',
                        '-ac', '2',
                        '-b:a', '192k',
                    ])

                cmd.extend([
                    '-movflags', '+faststart',
                    str(trimmed_path)
                ])

                subprocess.run(cmd, capture_output=True, text=True, check=True)
                trimmed_files.append(trimmed_path)

                # Verify trimmed duration
                probe_cmd = [
                    'ffprobe', '-v', 'error',
                    '-show_entries', 'format=duration',
                    '-of', 'default=noprint_wrappers=1:nokey=1',
                    str(trimmed_path)
                ]
                result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
                actual_duration = float(result.stdout.strip())
                logger.info(f"  ✓ Trimmed video: requested {duration_to_use:.3f}s, actual {actual_duration:.3f}s")

                # Update sequence to use trimmed file
                video_sequence[idx] = (trimmed_path, duration_to_use, False)

        # Step 7: Generate concat list with exact sequence
        logger.info(f"📝 Generating concat list with {len(video_sequence)} segments...")

        with open(concat_list_path, 'w', encoding='utf-8') as f:
            for video_path, duration, _ in video_sequence:
                abs_path = str(video_path.absolute()).replace('\\', '/')
                f.write(f"file '{abs_path}'\n")

        # Step 8: Concatenate with -c copy (all videos already have correct duration)
        logger.info(f"🎬 Concatenating {len(video_sequence)} segments with -c copy...")
        start_concat = time.time()

        cmd = [
            'ffmpeg', '-y',
            '-f', 'concat',
            '-safe', '0',
            '-i', str(concat_list_path),
            '-i', str(audio_path),
            '-c:v', 'copy',              # No re-encoding!
            '-c:a', 'copy',
            '-map', '0:v:0',
            '-map', '1:a:0',
            '-shortest',                 # Stop at shortest stream (ensures perfect sync)
            '-movflags', '+faststart',
            str(output_path)
        ]

        logger.info(f"Running FFmpeg: {' '.join(cmd)}")
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)

        concat_time = time.time() - start_concat
        logger.info(f"✅ Concatenation complete: {concat_time:.2f}s")

        if not output_path.exists() or output_path.stat().st_size == 0:
            raise RuntimeError("FFmpeg produced empty output")

        file_size_mb = output_path.stat().st_size / (1024 * 1024)
        logger.info(f"✅ Final video: {output_filename} ({file_size_mb:.2f} MB)")

        # Step 9: Verify final video duration matches audio
        probe_cmd = [
            'ffprobe', '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            str(output_path)
        ]
        result = subprocess.run(probe_cmd, capture_output=True, text=True, check=True)
        final_video_duration = float(result.stdout.strip())
        duration_diff = abs(final_video_duration - audio_duration)

        logger.info(f"🔍 Duration verification:")
        logger.info(f"   Audio: {audio_duration:.3f}s")
        logger.info(f"   Video: {final_video_duration:.3f}s")
        logger.info(f"   Diff:  {duration_diff:.3f}s ({duration_diff*1000:.1f}ms)")

        if duration_diff > 0.1:  # Warn if difference > 100ms
            logger.warning(f"⚠️ Duration difference: {duration_diff*1000:.1f}ms (expected <100ms)")

        # Step 10: Upload to S3
        if not path.endswith('/'):
            path = path + '/'
        s3_key = f"{path}{output_filename}"

        logger.info(f"📤 Uploading to S3: {s3_key}")
        video_url = upload_to_s3(output_path, S3_BUCKET_NAME, s3_key)

        # Cleanup local file after S3 upload
        output_path.unlink(missing_ok=True)

        # Calculate cycles (for stats)
        full_cycles = int(accumulated_duration // total_cycle_duration)
        partial_cycle = (accumulated_duration % total_cycle_duration) > 0.001

        return {
            'video_url': video_url,
            'filename': output_filename,
            's3_key': s3_key,
            'total_segments': segment_count,
            'full_cycles': full_cycles,
            'partial_cycle': partial_cycle,
            'video_duration': final_video_duration,
            'audio_duration': audio_duration,
            'duration_diff_ms': round(duration_diff * 1000, 1)
        }

    except subprocess.CalledProcessError as e:
        logger.error(f"FFmpeg error: {e.stderr}")
        raise RuntimeError(f"FFmpeg failed: {e.stderr}")
    finally:
        # Cleanup all temporary files
        for file in input_files + normalized_files + trimmed_files:
            file.unlink(missing_ok=True)
        concat_list_path.unlink(missing_ok=True)
        if audio_path.exists():
            audio_path.unlink(missing_ok=True)

        # Remove working directory
        try:
            work_dir.rmdir()
        except:
            pass


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

        elif operation == 'concat_video_audio':
            video_urls = job_input.get('video_urls', [])
            audio_url = job_input.get('audio_url')
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')
            normalize = job_input.get('normalize', True)

            if not video_urls or not audio_url or not path or not output_filename:
                raise ValueError("Missing required fields: video_urls, audio_url, path, output_filename")

            if len(video_urls) < 1:
                raise ValueError("At least 1 video URL is required")

            # Normalize audio URL
            audio_url = normalize_url(audio_url)

            # Normalize video URLs (convert Google Drive URLs if needed)
            normalized_video_urls = []
            for i, url in enumerate(video_urls):
                if 'drive.google.com' in url:
                    # Google Drive URL - will be converted during download
                    normalized_video_urls.append(url)
                    logger.info(f"  Video {i}: Google Drive URL detected")
                else:
                    # Regular URL - normalize for UTF-8 characters
                    normalized_video_urls.append(normalize_url(url))
                    logger.info(f"  Video {i}: {url[:60]}...")

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            logger.info(f"🔁 Cyclic concatenation: {len(normalized_video_urls)} videos, normalize={normalize}")

            result = concatenate_videos_cyclic(normalized_video_urls, audio_url, path, output_filename, normalize, worker_id)

            # Build descriptive message
            cycle_info = f"{result['full_cycles']} full cycles"
            if result['partial_cycle']:
                cycle_info += " + 1 partial"

            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "total_segments": result['total_segments'],
                "full_cycles": result['full_cycles'],
                "partial_cycle": result['partial_cycle'],
                "video_duration": result['video_duration'],
                "audio_duration": result['audio_duration'],
                "duration_diff_ms": result['duration_diff_ms'],
                "message": f"Cyclic concatenation complete: {cycle_info}, {result['total_segments']} segments, sync precision: {result['duration_diff_ms']}ms"
            }

        elif operation == 'trilhasonora':
            url_video = normalize_url(job_input.get('url_video'))
            trilha_sonora_raw = job_input.get('trilha_sonora')
            path = job_input.get('path')
            output_filename = job_input.get('output_filename')
            volume_reduction_db = job_input.get('volume_reduction_db', 18.0)

            if not url_video or not trilha_sonora_raw or not path or not output_filename:
                raise ValueError("Missing required fields: url_video, trilha_sonora, path, output_filename")

            # Handle Google Drive URLs (don't normalize, will be converted during download)
            if 'drive.google.com' in trilha_sonora_raw:
                trilha_sonora = trilha_sonora_raw
                logger.info("🎵 Google Drive URL detected for trilha sonora")
            else:
                trilha_sonora = normalize_url(trilha_sonora_raw)

            logger.info(f"📤 S3 upload: bucket={S3_BUCKET_NAME}, path={path}, filename={output_filename}")
            logger.info(f"🎵 Adding trilha sonora with volume reduction: -{volume_reduction_db}dB")

            result = add_trilha_sonora(url_video, trilha_sonora, path, output_filename, volume_reduction_db, worker_id)

            return {
                "success": True,
                "video_url": result['video_url'],
                "filename": result['filename'],
                "s3_key": result['s3_key'],
                "video_duration": result['video_duration'],
                "trilha_duration": result['trilha_duration'],
                "loops_applied": result['loops_applied'],
                "volume_reduction_db": result['volume_reduction_db'],
                "message": f"Trilha sonora added successfully ({result['loops_applied']} loops, -{result['volume_reduction_db']}dB)"
            }

        else:
            raise ValueError(f"Unknown operation: {operation}")

    except Exception as e:
        logger.error(f"❌ Job failed: {e}")
        raise


if __name__ == "__main__":
    logger.info("=" * 60)
    logger.info("🎬 CPU-OPTIMIZED VIDEO WORKER STARTED")
    logger.info("=" * 60)

    # System resources
    cpu_count = multiprocessing.cpu_count()
    physical_cores = psutil.cpu_count(logical=False) or cpu_count
    ram_total = psutil.virtual_memory().total / (1024**3)  # GB
    ram_available = psutil.virtual_memory().available / (1024**3)

    logger.info(f"🖥️  CPU: {cpu_count} logical cores, {physical_cores} physical cores")
    logger.info(f"💾 RAM: {ram_total:.1f} GB total, {ram_available:.1f} GB available")

    # Directories
    logger.info(f"📂 Work dir: {WORK_DIR}")
    logger.info(f"📂 Output dir: {OUTPUT_DIR}")

    is_ram_cache = str(WORK_DIR).startswith('/dev/shm')
    logger.info(f"🚀 I/O cache: {'RAM (tmpfs)' if is_ram_cache else 'DISK (/tmp)'}")

    # Batch configuration
    logger.info(f"🔢 Dynamic BATCH_SIZE: {BATCH_SIZE} (optimal for {physical_cores} physical cores)")
    logger.info(f"🌐 HTTP server: port {HTTP_PORT}")

    # Processing mode
    logger.info("=" * 60)
    logger.info("📋 PROCESSING MODE:")
    logger.info("  • img2vid:    CPU-ONLY (libx264 veryfast)")
    logger.info("  • caption:    GPU if available, CPU fallback")
    logger.info("  • addaudio:   GPU if available, CPU fallback")
    logger.info("  • concatenate: GPU if available, CPU fallback")

    # GPU status (for non-img2vid operations)
    if GPU_AVAILABLE:
        logger.info("🎮 GPU: AVAILABLE (for caption/addaudio/concatenate)")
    else:
        logger.info("💻 GPU: NOT AVAILABLE (CPU-only for all operations)")

    logger.info("=" * 60)

    # Worker ID
    pod_id = os.getenv('RUNPOD_POD_ID')
    if pod_id:
        logger.info(f"🆔 Pod ID: {pod_id}")
        logger.info(f"🔗 Proxy URL: https://{pod_id}-{HTTP_PORT}.proxy.runpod.net/")

    # Validate FFmpeg
    try:
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True, text=True)
        ffmpeg_version = result.stdout.split('\n')[0]
        logger.info(f"✅ {ffmpeg_version}")
    except FileNotFoundError:
        logger.error("❌ FFmpeg not found!")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("✅ Worker ready to process jobs")
    logger.info("=" * 60)

    # Start RunPod handler
    runpod.serverless.start({"handler": handler})
