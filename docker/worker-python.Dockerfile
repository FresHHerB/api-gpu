# ==================================
# Worker Python Dockerfile (RunPod Serverless)
# ==================================
# Python 3.11 + CUDA + FFmpeg NVENC + RunPod SDK
# Optimized for RunPod Serverless with GPU acceleration

FROM nvidia/cuda:12.1.0-base-ubuntu22.04

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless GPU Worker (Python) for video processing with FFmpeg + CUDA"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3.11, FFmpeg with NVENC, and dependencies
RUN apt-get update && apt-get install -y \
    python3.11 \
    python3.11-dev \
    python3-pip \
    wget \
    xz-utils \
    ca-certificates \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && wget https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
    && tar -xf ffmpeg-release-amd64-static.tar.xz \
    && mv ffmpeg-*-amd64-static/ffmpeg /usr/local/bin/ \
    && mv ffmpeg-*-amd64-static/ffprobe /usr/local/bin/ \
    && rm -rf ffmpeg-* \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify installations
RUN python --version && pip --version && ffmpeg -version

# Working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY src/worker-python/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy handler
COPY src/worker-python/rp_handler.py .

# Create necessary directories
RUN mkdir -p /tmp/work /tmp/output /app/logs

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV WORK_DIR=/tmp/work
ENV OUTPUT_DIR=/tmp/output
ENV BATCH_SIZE=3

# RunPod Serverless entry point
CMD ["python", "-u", "rp_handler.py"]
