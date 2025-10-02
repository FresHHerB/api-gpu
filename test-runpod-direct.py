#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script to submit directly to RunPod endpoint
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

# Generate 15 test images (above threshold of 10)
images = []
for i in range(1, 16):
    images.append({
        "id": f"test-{i:03d}",
        "image_url": "https://picsum.photos/1920/1080",
        "duracao": 2.0
    })

payload = {
    "input": {
        "operation": "img2vid",
        "images": images
    }
}

print(f"Submitting batch with {len(images)} images to RunPod...")
print(f"Endpoint: {ENDPOINT_ID}")

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
print(json.dumps(submit_result, indent=2))

job_id = submit_result.get('id')
if not job_id:
    print("\nError: No job ID received")
    sys.exit(1)

print(f"\nJob ID: {job_id}")
print("Polling for results...")

# Poll for results
for attempt in range(60):  # 5 min max
    time.sleep(5)

    status_response = requests.get(
        f"https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{job_id}",
        headers={"Authorization": f"Bearer {RUNPOD_API_KEY}"}
    )

    status_data = status_response.json()
    job_status = status_data.get('status')

    print(f"[{attempt+1}] Status: {job_status}")

    if job_status == 'COMPLETED':
        print("\nJob completed!")
        print(json.dumps(status_data, indent=2))

        # Save result
        with open('test-runpod-result.json', 'w') as f:
            json.dump(status_data, f, indent=2)
        print("\nFull response saved to test-runpod-result.json")
        break
    elif job_status in ['FAILED', 'CANCELLED', 'TIMED_OUT']:
        print(f"\nJob {job_status}!")
        print(json.dumps(status_data, indent=2))
        break
else:
    print("\nTimeout waiting for job completion")
