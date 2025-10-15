# ==================================
# Worker Python Dockerfile (RunPod Serverless)
# ==================================
# Python slim + FFmpeg + Fonts for subtitle styling
# CPU-Optimized for short video processing
# Target: ~800MB with fonts for caption_style support

FROM python:3.11-slim

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless CPU-Optimized Worker (Python) - libx264 veryfast + Subtitle Fonts"
LABEL version="3.0.0-cpu-optimized"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install FFmpeg + Fonts for subtitle rendering with custom styling
RUN apt-get update && apt-get install -y --no-install-recommends \
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

# Log available fonts for debugging (shown during build)
RUN echo "=== Fonts Available ===" && fc-list : family | sort -u

# Working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY src/worker-python/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /root/.cache/pip

# Copy handler and caption generator
COPY src/worker-python/rp_handler.py .
COPY src/worker-python/caption_generator.py .

# Create necessary directories
# Note: /dev/shm (RAM cache) will be used if available at runtime
RUN mkdir -p /tmp/work /tmp/output /dev/shm/work /dev/shm/output && \
    chmod 777 /tmp/work /tmp/output

# Environment variables
ENV PYTHONUNBUFFERED=1
# Note: WORK_DIR and BATCH_SIZE are calculated dynamically at runtime
# No longer hardcoded - worker auto-detects optimal values

# RunPod Serverless entry point
CMD ["python", "-u", "rp_handler.py"]
