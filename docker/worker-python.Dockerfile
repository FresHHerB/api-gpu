# ==================================
# Worker Python Dockerfile (RunPod Serverless with NVENC)
# ==================================
# NVIDIA CUDA + Python + FFmpeg with NVENC support
# GPU-Accelerated video processing with CPU fallback
# Target: ~2GB with CUDA runtime + fonts

FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless GPU Worker (Python) - NVENC h264_nvenc + CPU fallback"
LABEL version="4.0.0-nvenc-enabled"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install Python 3.11 + FFmpeg with NVENC + Fonts
RUN apt-get update && apt-get install -y --no-install-recommends \
    software-properties-common \
    && add-apt-repository ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
    python3.11 \
    python3.11-distutils \
    python3-pip \
    ffmpeg \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-roboto \
    fonts-noto-core \
    fonts-open-sans \
    && fc-cache -fv \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Set Python 3.11 as default
RUN update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1

# Log available fonts for debugging (shown during build)
RUN echo "=== Fonts Available ===" && fc-list : family | sort -u

# Working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY src/worker-python/requirements.txt .
RUN pip3 install --no-cache-dir --upgrade pip \
    && pip3 install --no-cache-dir -r requirements.txt \
    && rm -rf /root/.cache/pip

# Copy handler and caption generator
COPY src/worker-python/rp_handler.py .
COPY src/worker-python/caption_generator.py .

# Create necessary directories
# Note: /dev/shm (RAM cache) will be used if available at runtime
RUN mkdir -p /tmp/work /tmp/output /dev/shm/work /dev/shm/output && \
    chmod 777 /tmp/work /tmp/output

# Environment variables for Python
ENV PYTHONUNBUFFERED=1

# NVIDIA GPU runtime configuration
ENV NVIDIA_VISIBLE_DEVICES=all
ENV NVIDIA_DRIVER_CAPABILITIES=compute,utility,video

# Note: WORK_DIR and BATCH_SIZE are calculated dynamically at runtime
# Worker auto-detects GPU availability and optimal settings

# RunPod Serverless entry point
CMD ["python3", "-u", "rp_handler.py"]
