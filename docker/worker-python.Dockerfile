# ==================================
# Worker Python Dockerfile (RunPod Serverless)
# ==================================
# Ultra-minimal: Python slim + FFmpeg Ubuntu (with NVENC via RunPod GPU runtime)
# Target: <700MB for ultra-fast cold start

FROM python:3.11-slim

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless GPU Worker (Python) - Minimal with NVENC"

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install FFmpeg from Ubuntu repos (RunPod provides NVENC via GPU runtime)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Working directory
WORKDIR /app

# Copy requirements and install Python dependencies
COPY src/worker-python/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt \
    && rm -rf /root/.cache/pip

# Copy handler
COPY src/worker-python/rp_handler.py .

# Create necessary directories
RUN mkdir -p /tmp/work /tmp/output

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV WORK_DIR=/tmp/work
ENV OUTPUT_DIR=/tmp/output
ENV BATCH_SIZE=3
ENV HTTP_PORT=8000

# Expose HTTP port for serving videos
EXPOSE 8000

# RunPod Serverless entry point
CMD ["python", "-u", "rp_handler.py"]
