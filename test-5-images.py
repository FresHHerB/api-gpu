#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test with 5 images (below threshold of 10, should return base64)
"""
import requests
import json
import time
import sys
import os

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY", "your-api-key-here")
ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID", "your-endpoint-id")

# Generate 5 test images (below threshold)
images = []
for i in range(1, 6):
    images.append({
        "id": f"small-{i:03d}",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 2.0
    })

payload = {
    "input": {
        "operation": "img2vid",
        "images": images
    }
}

print(f"Submitting SMALL batch with {len(images)} images (below threshold of 10)")
print("Expected behavior: Return base64 (no VPS upload)")

# Submit job
response = requests.post(
    f"https://api.runpod.ai/v2/{ENDPOINT_ID}/run",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {RUNPOD_API_KEY}"
    },
    json=payload
)

print(f"\nSubmit Status: {response.status_code}")
submit_result = response.json()
job_id = submit_result.get('id')

if not job_id:
    print("Error: No job ID")
    print(json.dumps(submit_result, indent=2))
    sys.exit(1)

print(f"Job ID: {job_id}")
print("Polling...")

# Poll
for attempt in range(40):
    time.sleep(3)

    status_response = requests.get(
        f"https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{job_id}",
        headers={"Authorization": f"Bearer {RUNPOD_API_KEY}"}
    )

    status_data = status_response.json()
    job_status = status_data.get('status')

    print(f"[{attempt+1}] Status: {job_status}")

    if job_status == 'COMPLETED':
        output = status_data.get('output', {})
        videos = output.get('videos', [])

        print(f"\nSUCCESS! Got {len(videos)} videos")

        # Check if base64 or URLs
        if videos and 'video_base64' in videos[0]:
            print("✓ Videos returned as base64 (expected for small batch)")
            print(f"  First video base64 length: {len(videos[0]['video_base64'])} chars")
        elif videos and 'video_url' in videos[0]:
            print("✓ Videos returned as URLs")
            for v in videos[:3]:
                print(f"  {v['id']}: {v['video_url']}")
        else:
            print("? Unknown format")

        # Save
        with open('test-5-result.json', 'w') as f:
            json.dump(status_data, f, indent=2)
        print("\nSaved to test-5-result.json")
        break
    elif job_status in ['FAILED', 'CANCELLED', 'TIMED_OUT']:
        print(f"\nJob {job_status}")
        print(json.dumps(status_data, indent=2))
        break
else:
    print("\nTimeout")
