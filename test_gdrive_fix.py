#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test Google Drive download fix
Tests the UUID extraction and new download URL format
"""

import sys
import io
import requests
import re

# Fix Windows console encoding
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')

def test_google_drive_download(file_id):
    """Test downloading a file from Google Drive"""
    url = f"https://drive.google.com/uc?export=download&id={file_id}"

    print(f"\n{'='*60}")
    print(f"Testing file ID: {file_id}")
    print(f"Initial URL: {url}")
    print(f"{'='*60}")

    session = requests.Session()
    response = session.get(url, stream=True, timeout=30, allow_redirects=True)

    content_type = response.headers.get('Content-Type', '')
    print(f"Content-Type: {content_type}")

    if 'text/html' in content_type:
        print("⚠️  HTML detected - Virus scan warning")

        html_content = response.text

        # Extract UUID and file ID from HTML
        uuid_match = re.search(r'name="uuid"\s+value="([a-f0-9\-]+)"', html_content)
        file_id_match = re.search(r'name="id"\s+value="([a-zA-Z0-9_\-]+)"', html_content)

        if uuid_match and file_id_match:
            uuid = uuid_match.group(1)
            extracted_file_id = file_id_match.group(1)

            print(f"✅ Extracted UUID: {uuid}")
            print(f"✅ Extracted File ID: {extracted_file_id}")

            # Build new download URL
            confirm_url = f"https://drive.usercontent.google.com/download?id={extracted_file_id}&export=download&confirm=t&uuid={uuid}"
            print(f"🔗 New download URL: {confirm_url[:80]}...")

            # Try downloading with new URL
            print("📥 Attempting download with new URL...")
            response = session.get(confirm_url, stream=True, timeout=30, allow_redirects=True)

            # Check first bytes
            first_bytes = b''
            for chunk in response.iter_content(chunk_size=12):
                first_bytes = chunk
                break

            if b'ftyp' in first_bytes:
                print("✅ SUCCESS! Video file detected (ftyp signature found)")
                print(f"   First bytes: {first_bytes[:12]}")
                return True
            else:
                print(f"❌ FAIL! Not a video file")
                print(f"   First bytes: {first_bytes[:20]}")
                return False
        else:
            print("❌ Could not extract UUID/File ID from HTML")
            print("First 500 chars of HTML:")
            print(html_content[:500])
            return False
    else:
        # Direct download (no virus warning)
        print("✅ Direct download (no virus warning)")

        # Check first bytes
        first_bytes = b''
        for chunk in response.iter_content(chunk_size=12):
            first_bytes = chunk
            break

        if b'ftyp' in first_bytes:
            print("✅ Video file detected")
            return True
        else:
            print(f"⚠️  Unexpected content: {first_bytes[:20]}")
            return False

if __name__ == "__main__":
    # Test the 3 file IDs from the error
    file_ids = [
        "1NqKX2GhVXAUz-sO4BDCkfqtufXG6DZlk",  # Should work directly
        "1NygY7KetEL5IeNNqXkzZ8C0ni7FMgqmH",  # Large file - needs UUID (117MB)
        "1NwWreoBpOvyF1BpvjZhsQ9ddR6jRWtcE",  # Should work directly
    ]

    results = []
    for file_id in file_ids:
        result = test_google_drive_download(file_id)
        results.append(result)

    print(f"\n{'='*60}")
    print("SUMMARY:")
    print(f"{'='*60}")
    for i, (file_id, result) in enumerate(zip(file_ids, results)):
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"File {i+1}: {status}")

    if all(results):
        print(f"\n🎉 All tests PASSED!")
    else:
        print(f"\n⚠️  Some tests FAILED")
