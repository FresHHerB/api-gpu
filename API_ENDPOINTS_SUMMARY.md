# API Endpoints Summary - Orchestrator Routes

## Overview

Comprehensive documentation for all API endpoints in src/orchestrator/routes/
Base URL: Application root | Authentication: X-API-Key header (except health checks)

## Video Processing - RunPod (GPU)

### POST /runpod/video/img2vid
Convert images to videos with zoom effects
- Mode: Asynchronous (202) | Auth: Required
- zoom_types: zoomin, zoomout, zoompanright

### POST /runpod/video/addaudio
Synchronize audio with video (GPU)
- Mode: Asynchronous (202) | Auth: Required

### POST /runpod/video/concatenate
Concatenate multiple videos (min: 2)
- Mode: Asynchronous (202) | Auth: Required

### POST /runpod/video/concat_video_audio
Cycle videos to match audio duration
- Mode: Asynchronous (202) | Auth: Required
- Supports Google Drive, S3/MinIO, HTTP/HTTPS URLs

### POST /runpod/video/caption_style
Add styled captions (segments SRT or highlight karaoke)
- Mode: Asynchronous (202) | Auth: Required
- type: segments or highlight
- Includes font, colors, borders, positioning options

## Video Processing - VPS (Local CPU)

Same endpoints as RunPod with _vps suffix (operations: img2vid_vps, addaudio_vps, etc.)

### POST /vps/video/transcribe_youtube
Extract YouTube auto-generated captions
- Mode: Synchronous (200) | Auth: Required

## Audio Processing

### POST /vps/audio/concatenate
Concatenate multiple audio files (min: 2)
- Mode: Synchronous (200) | Auth: NOT Required
- Returns S3 URL, duration, processing time

### GET /vps/audio/health
Health check for audio service
- Auth: NOT Required

## Image Generation

### POST /vps/imagem/gerarPrompts
Generate image prompts using OpenRouter LLM
- Mode: Synchronous | Auth: Required

### POST /vps/imagem/gerarImagens
Generate images using Runware WebSocket
- Mode: Synchronous | Auth: Required
- Dimensions: 512-2048 pixels

## Transcription

### POST /runpod/audio/transcribe
Process audio transcription with faster-whisper
- Mode: Synchronous | Auth: Required
- Models: tiny, base, small, medium, large-v1, large-v2, large-v3, turbo
- Outputs: SRT, JSON, ASS Karaoke

### GET /runpod/audio/transcribe/health
Health check for transcription
- Auth: NOT Required

## Job Management

### GET /jobs/:jobId
Check job status (QUEUED, SUBMITTED, PROCESSING, COMPLETED, FAILED, CANCELLED)
- Auth: Required

### POST /jobs/:jobId/cancel
Cancel job (only QUEUED or SUBMITTED)
- Auth: Required

### GET /queue/stats
Get queue and worker statistics
- Auth: Required
- Returns: queued, submitted, processing, completed, failed, cancelled, totalJobs, activeWorkers, availableWorkers

## Admin/Monitoring

### POST /admin/recover-workers
Recover leaked workers from interrupted jobs
- Auth: Required

### GET /admin/workers/status
Get detailed worker and job status
- Auth: Required
- Returns: summary, activeJobs with details, queueStats

## Special Features Documentation

### img2vid Zoom Types
- zoomin: 0.8x to 1.2x (focus effect)
- zoomout: 1.2x to 0.8x (pull-back effect)
- zoompanright: 0.9x to 1.1x with right pan (dynamic movement)
Types distributed proportionally if array provided. Default: zoomin for all.

### caption_style ASS Configuration
Position Alignment Mapping (Numpad):
  7 8 9  (top)
  4 5 6  (middle)
  1 2 3  (bottom)

Segments style: Uses simple SRT-based structure converted to ASS
- Font sizes: 20-200 points (default: 36)
- Border styles: 1=outline+shadow, 3=opaque box, 4=background box

Highlight (Karaoke) style: Advanced ASS with word-by-word highlighting
- Font: Large (default 72pt)
- Opacity: 0-100% converted to 0-255 alpha (formula: round((opacity/100)*255))
- Colors: Hex format (#RRGGBB)

### URL Handling
Auto-encodes fields with spaces/pipes: url_video, url_srt, url_audio, url_caption, image_urls[], video_urls[]
Google Drive: Auto-converts all formats to direct download, handles >25MB files
MinIO: Uses encodeURI for special characters in paths

## HTTP Status Codes
200: OK (synchronous)
202: Accepted (async job)
400: Bad Request (validation)
401: Unauthorized (API key)
404: Not Found
429: Too Many Requests
500: Internal Server Error
503: Service Unavailable
504: Gateway Timeout

---
Document Generated: 2025-10-21
Last Updated: Based on all route files in src/orchestrator/routes/
