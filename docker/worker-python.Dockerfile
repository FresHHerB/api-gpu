# ==================================
# Worker Python Dockerfile (RunPod Serverless)
# ==================================
# Python slim + FFmpeg + Fonts for subtitle styling
# Target: ~800MB with fonts for caption_style support

FROM python:3.11-slim

# Metadata
LABEL maintainer="api-gpu-team"
LABEL description="RunPod Serverless GPU Worker (Python) - NVENC + Subtitle Fonts"
LABEL version="2.0.0"

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
RUN mkdir -p /tmp/work /tmp/output

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV WORK_DIR=/tmp/work
ENV OUTPUT_DIR=/tmp/output
ENV BATCH_SIZE=3

# RunPod Serverless entry point
CMD ["python", "-u", "rp_handler.py"]
