"""
RunPod Serverless Handler for GPU Video Processing
Handles: caption, img2vid (batch), addaudio operations
"""

import runpod
import os
import sys
import logging
import subprocess
import requests
import uuid
from pathlib import Path
from typing import Dict, List, Any
from concurrent.futures import ThreadPoolExecutor, as_completed

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

# Ensure directories exist
WORK_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


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
            raise Exception(f"Downloaded file is empty: {url}")

    except Exception as e:
        logger.error(f"Download failed for {url}: {e}")
        raise Exception(f"Failed to download {url}: {str(e)}")


def run_ffmpeg(args: List[str]) -> None:
    """Run FFmpeg command"""
    cmd = ['ffmpeg', '-y'] + args
    logger.info(f"Running FFmpeg: {' '.join(cmd)}")

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        logger.error(f"FFmpeg error: {result.stderr}")
        raise Exception(f"FFmpeg failed: {result.stderr}")

    logger.info("FFmpeg completed successfully")


def add_caption(url_video: str, url_srt: str) -> str:
    """Add captions to video"""
    job_id = str(uuid.uuid4())
    video_path = WORK_DIR / f"{job_id}_input.mp4"
    srt_path = WORK_DIR / f"{job_id}_sub.srt"
    output_path = OUTPUT_DIR / f"{job_id}_captioned.mp4"

    try:
        # Download files
        download_file(url_video, video_path)
        download_file(url_srt, srt_path)

        # Add captions with GPU acceleration
        run_ffmpeg([
            '-hwaccel', 'cuda',
            '-hwaccel_output_format', 'cuda',
            '-i', str(video_path),
            '-vf', f"subtitles='{srt_path}'",
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-cq', '23',
            '-b:v', '5M',
            '-c:a', 'copy',
            str(output_path)
        ])

        # Cleanup
        video_path.unlink(missing_ok=True)
        srt_path.unlink(missing_ok=True)

        return str(output_path)

    except Exception as e:
        logger.error(f"Caption failed: {e}")
        # Cleanup on error
        video_path.unlink(missing_ok=True)
        srt_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise


def image_to_video(image_id: str, image_url: str, duracao: float) -> Dict[str, str]:
    """Convert single image to video with Ken Burns effect"""
    job_id = str(uuid.uuid4())
    image_path = WORK_DIR / f"{job_id}_{image_id}_input.jpg"
    output_path = OUTPUT_DIR / f"{job_id}_{image_id}_video.mp4"

    try:
        logger.info(f"Processing image {image_id}: url={image_url}, duration={duracao}s")

        # Download image
        download_file(image_url, image_path)

        # Verify image was downloaded
        if not image_path.exists():
            raise Exception(f"Image file not found after download: {image_path}")

        # Calculate zoom parameters (24fps fixed)
        total_frames = int(duracao * 24)
        zoom_factor = 1.324  # 32.4% zoom

        # Ken Burns effect with GPU acceleration
        run_ffmpeg([
            '-loop', '1',
            '-framerate', '24',
            '-i', str(image_path),
            '-vf', (
                f"scale=6720:3840,zoompan=z='min(zoom+0.0015,{zoom_factor})':"
                f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d={total_frames}:"
                f"s=1920x1080:fps=24"
            ),
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-cq', '23',
            '-b:v', '8M',
            '-pix_fmt', 'yuv420p',
            '-t', str(duracao),
            str(output_path)
        ])

        # Cleanup
        image_path.unlink(missing_ok=True)

        return {'id': image_id, 'video_path': str(output_path)}

    except Exception as e:
        logger.error(f"Image to video failed for {image_id}: {e}")
        # Cleanup on error
        image_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise


def images_to_videos(images: List[Dict]) -> List[Dict[str, str]]:
    """Convert multiple images to videos in parallel batches"""
    batch_job_id = str(uuid.uuid4())
    logger.info(f"Starting batch img2vid job {batch_job_id}: {len(images)} images, batch_size={BATCH_SIZE}")

    results = []
    errors = []

    # Process in batches
    for i in range(0, len(images), BATCH_SIZE):
        batch = images[i:i + BATCH_SIZE]
        batch_num = (i // BATCH_SIZE) + 1
        total_batches = (len(images) + BATCH_SIZE - 1) // BATCH_SIZE

        logger.info(f"Processing batch {batch_num}/{total_batches} ({len(batch)} images)")

        # Process batch in parallel
        with ThreadPoolExecutor(max_workers=BATCH_SIZE) as executor:
            future_to_image = {
                executor.submit(
                    image_to_video,
                    img['id'],
                    img['image_url'],
                    img['duracao']
                ): img for img in batch
            }

            for future in as_completed(future_to_image):
                img = future_to_image[future]
                try:
                    result = future.result()
                    results.append(result)
                    logger.info(f"✅ Image {img['id']} processed successfully")
                except Exception as e:
                    error_msg = str(e)
                    errors.append({'id': img['id'], 'error': error_msg})
                    logger.error(f"❌ Image {img['id']} failed: {error_msg}")

    if errors:
        logger.warning(f"Batch completed with {len(errors)} errors: {errors}")

    if len(results) == 0:
        error_details = "; ".join([f"{e['id']}: {e['error']}" for e in errors])
        raise Exception(f"All images failed to process: {error_details}")

    logger.info(f"Batch job completed: {len(results)}/{len(images)} succeeded")

    return results


def add_audio(url_video: str, url_audio: str) -> str:
    """Add audio to video"""
    job_id = str(uuid.uuid4())
    video_path = WORK_DIR / f"{job_id}_video.mp4"
    audio_path = WORK_DIR / f"{job_id}_audio.mp3"
    output_path = OUTPUT_DIR / f"{job_id}_final.mp4"

    try:
        # Download files
        download_file(url_video, video_path)
        download_file(url_audio, audio_path)

        # Merge audio with GPU acceleration
        run_ffmpeg([
            '-hwaccel', 'cuda',
            '-hwaccel_output_format', 'cuda',
            '-i', str(video_path),
            '-i', str(audio_path),
            '-c:v', 'h264_nvenc',
            '-preset', 'p4',
            '-cq', '23',
            '-b:v', '5M',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-shortest',
            str(output_path)
        ])

        # Cleanup
        video_path.unlink(missing_ok=True)
        audio_path.unlink(missing_ok=True)

        return str(output_path)

    except Exception as e:
        logger.error(f"Add audio failed: {e}")
        # Cleanup on error
        video_path.unlink(missing_ok=True)
        audio_path.unlink(missing_ok=True)
        output_path.unlink(missing_ok=True)
        raise


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """
    RunPod Serverless Handler
    Expects job = {"input": {"operation": "...", ...}}
    """
    job_input = job.get("input", {})
    operation = job_input.get("operation")

    if not operation:
        return {"error": "Missing 'operation' in input"}

    logger.info(f"🚀 Job received: {operation}")

    try:
        if operation == "caption":
            url_video = job_input.get("url_video")
            url_srt = job_input.get("url_srt")

            if not url_video or not url_srt:
                return {"error": "Missing url_video or url_srt"}

            video_url = add_caption(url_video, url_srt)
            return {
                "success": True,
                "video_url": video_url,
                "message": "Caption added successfully"
            }

        elif operation == "img2vid":
            images = job_input.get("images")

            if not images or not isinstance(images, list):
                return {"error": "Missing or invalid 'images' array"}

            # Validate images
            for img in images:
                if not all(k in img for k in ['id', 'image_url', 'duracao']):
                    return {"error": "Each image must have id, image_url, and duracao"}

            videos = images_to_videos(images)

            return {
                "success": True,
                "videos": [{"id": v['id'], "video_url": v['video_path']} for v in videos],
                "total": len(images),
                "processed": len(videos),
                "message": "Images converted to videos successfully"
            }

        elif operation == "addaudio":
            url_video = job_input.get("url_video")
            url_audio = job_input.get("url_audio")

            if not url_video or not url_audio:
                return {"error": "Missing url_video or url_audio"}

            video_url = add_audio(url_video, url_audio)
            return {
                "success": True,
                "video_url": video_url,
                "message": "Audio added successfully"
            }

        else:
            return {"error": f"Unknown operation: {operation}"}

    except Exception as e:
        logger.error(f"❌ Job failed: {e}", exc_info=True)
        return {"error": str(e)}


# Start RunPod serverless worker
if __name__ == "__main__":
    logger.info("🏁 Starting RunPod Serverless Worker (Python)")
    logger.info(f"⚙️ WORK_DIR: {WORK_DIR}")
    logger.info(f"⚙️ OUTPUT_DIR: {OUTPUT_DIR}")
    logger.info(f"⚙️ BATCH_SIZE: {BATCH_SIZE}")

    runpod.serverless.start({"handler": handler})
