#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script to submit 100 images to img2vid endpoint
"""
import requests
import json
import sys

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# Generate 100 test images
images = []
for i in range(1, 101):
    images.append({
        "id": f"image-{i:03d}",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 2.0
    })

payload = {
    "images": images
}

print(f"Submitting batch with {len(images)} images...")

response = requests.post(
    "https://api-gpu.automear.com/video/img2vid",
    headers={
        "Content-Type": "application/json",
        "X-API-Key": "api-gpu-2025-secure-key-change-me"
    },
    json=payload,
    timeout=600
)

print(f"\nStatus: {response.status_code}")

if response.status_code == 200:
    result = response.json()
    print(f"\nSuccess!")
    print(f"Total: {result.get('stats', {}).get('total', 'N/A')}")
    print(f"Processed: {result.get('stats', {}).get('processed', 'N/A')}")
    print(f"Duration: {result.get('execution', {}).get('durationSeconds', 'N/A')}s")

    # Show first 3 videos
    videos = result.get('videos', [])
    print(f"\nVideos ({len(videos)} total):")
    for video in videos[:3]:
        print(f"  - {video['id']}: {video['video_url']}")

    if len(videos) > 3:
        print(f"  ... and {len(videos) - 3} more")

    # Save full response
    with open('test-100-result.json', 'w') as f:
        json.dump(result, f, indent=2)
    print(f"\nFull response saved to test-100-result.json")
else:
    print(f"\nError: {response.text}")
