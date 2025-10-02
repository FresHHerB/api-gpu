# ==================================
# Worker Python Dockerfile (RunPod Serverless)
# ==================================
# Minimal Python 3.11 + FFmpeg NVENC + RunPod SDK
# Optimized for fast startup and GPU acceleration

FROM nvidia/cuda:12.1.0-runtime-ubuntu22.04

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless GPU Worker (Python) - Optimized for NVENC"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install minimal dependencies for Python + FFmpeg NVENC
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 \
    python3-pip \
    ffmpeg \
    ca-certificates \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1 \
    && update-alternatives --install /usr/bin/python python /usr/bin/python3.11 1 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Working directory
WORKDIR /app

# Copy requirements and install Python dependencies (minimal, no cache)
COPY src/worker-python/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /root/.cache/pip

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
