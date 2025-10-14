#!/bin/bash
# Compare DNS Resolution and HTTP Response
# Run this on VPS to see if DNS resolves differently

echo "=========================================="
echo "🔍 DNS & HTTP Comparison Test"
echo "=========================================="
echo ""

# Test DNS resolution
echo "1. DNS Resolution for minio.automear.com"
echo "----------------------------------------"
echo ""

# Get all IPs
echo "All resolved IPs:"
host minio.automear.com | grep "has address" || echo "No A records found"
echo ""

# Get IP used
RESOLVED_IP=$(dig +short minio.automear.com | tail -n1)
echo "Primary IP: $RESOLVED_IP"
echo ""

# Check if it's private IP
if [[ $RESOLVED_IP =~ ^10\. ]] || [[ $RESOLVED_IP =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] || [[ $RESOLVED_IP =~ ^192\.168\. ]]; then
    echo "⚠️  WARNING: Resolved to PRIVATE IP!"
    echo "   This may indicate split-brain DNS"
    echo "   Internal network may have different data than external"
else
    echo "✅ Resolved to PUBLIC IP"
fi
echo ""

# Test both idRoteiro URLs
echo "2. Testing Image URLs"
echo "----------------------------------------"
echo ""

# idRoteiro 41 (3 Contos)
URL_41="https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"
echo "a) idRoteiro 41 (3 Contos):"
echo "   URL: $URL_41"
echo ""

# Test with curl
echo "   Testing with curl..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "$URL_41")
echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    # Get headers
    CONTENT_LENGTH=$(curl -s -I -L "$URL_41" | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
    CONTENT_TYPE=$(curl -s -I -L "$URL_41" | grep -i "content-type" | awk '{print $2}' | tr -d '\r')
    echo "   ✅ Image accessible"
    echo "   Size: $((CONTENT_LENGTH / 1024)) KB"
    echo "   Type: $CONTENT_TYPE"

    # Try to download first few bytes
    echo ""
    echo "   Downloading first 1KB to verify..."
    curl -s -L --max-time 10 -r 0-1023 "$URL_41" > /tmp/test-img-41.jpg
    if [ -f /tmp/test-img-41.jpg ]; then
        FILE_SIZE=$(stat -f%z /tmp/test-img-41.jpg 2>/dev/null || stat -c%s /tmp/test-img-41.jpg 2>/dev/null)
        echo "   Downloaded: $FILE_SIZE bytes"
        file /tmp/test-img-41.jpg 2>/dev/null || echo "   (file command not available)"
        rm /tmp/test-img-41.jpg
    fi
else
    echo "   ❌ Image NOT accessible"

    # Try with verbose to see redirect
    echo ""
    echo "   Verbose output:"
    curl -I -L -v "$URL_41" 2>&1 | grep -E "HTTP|Location|Server" | head -n 10
fi
echo ""

# idRoteiro 42 (4 Casos) - The one that's failing
URL_42="https://minio.automear.com/canais/Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/imagem_1.jpg"
echo "b) idRoteiro 42 (4 Casos) - THE FAILING ONE:"
echo "   URL: $URL_42"
echo ""

echo "   Testing with curl..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L --max-time 10 "$URL_42")
echo "   Status: $HTTP_CODE"

if [ "$HTTP_CODE" = "200" ]; then
    CONTENT_LENGTH=$(curl -s -I -L "$URL_42" | grep -i "content-length" | awk '{print $2}' | tr -d '\r')
    CONTENT_TYPE=$(curl -s -I -L "$URL_42" | grep -i "content-type" | awk '{print $2}' | tr -d '\r')
    echo "   ✅ Image accessible (BUT NODEJS SEES 404!)"
    echo "   Size: $((CONTENT_LENGTH / 1024)) KB"
    echo "   Type: $CONTENT_TYPE"
    echo ""
    echo "   💡 This means curl works but Node.js axios fails!"
    echo "      Possible causes:"
    echo "      - SSL/TLS certificate issue"
    echo "      - User-Agent blocking"
    echo "      - Rate limiting"
else
    echo "   ❌ Image NOT accessible"
    echo "   💡 This confirms the image doesn't exist!"
    echo ""
    echo "   Verbose output:"
    curl -I -L -v "$URL_42" 2>&1 | grep -E "HTTP|Location|Server|X-" | head -n 15
fi
echo ""

# Test with same User-Agent as Node.js
echo "3. Testing with Node.js User-Agent"
echo "----------------------------------------"
echo ""
echo "Simulating axios request..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L \
  -H "User-Agent: axios/1.7.9" \
  -H "Accept: */*" \
  --max-time 10 "$URL_42")
echo "Status: $HTTP_CODE"
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Works with Node.js User-Agent"
else
    echo "❌ Also fails with Node.js User-Agent"
    echo "   The image genuinely doesn't exist"
fi
echo ""

# Test SSL certificate
echo "4. Testing SSL Certificate"
echo "----------------------------------------"
echo ""
echo | openssl s_client -connect minio.automear.com:443 -servername minio.automear.com 2>/dev/null | \
  openssl x509 -noout -subject -dates 2>/dev/null || echo "SSL test failed"
echo ""

# Compare with external DNS
echo "5. Compare with External DNS"
echo "----------------------------------------"
echo ""
echo "Using Google DNS (8.8.8.8):"
EXTERNAL_IP=$(dig @8.8.8.8 +short minio.automear.com | tail -n1)
echo "External resolves to: $EXTERNAL_IP"
echo "Internal resolves to: $RESOLVED_IP"
echo ""

if [ "$EXTERNAL_IP" != "$RESOLVED_IP" ]; then
    echo "⚠️  DNS SPLIT-BRAIN DETECTED!"
    echo "   External IP: $EXTERNAL_IP"
    echo "   Internal IP: $RESOLVED_IP"
    echo ""
    echo "   💡 This explains the 404!"
    echo "      - External access: different MinIO instance"
    echo "      - Internal access: different data/buckets"
else
    echo "✅ DNS consistent (same IP from both)"
fi
echo ""

echo "=========================================="
echo "📊 DIAGNOSIS"
echo "=========================================="
echo ""

if [ "$HTTP_CODE" = "404" ]; then
    echo "❌ CONFIRMED: Image returns 404 from VPS"
    echo ""
    echo "💡 MOST LIKELY CAUSES:"
    echo "   1. Images for idRoteiro 42 don't exist in MinIO"
    echo "   2. Images were deleted after being created"
    echo "   3. Wrong project - images are in different path"
    echo ""
    echo "✅ SOLUTIONS:"
    echo "   1. Check MinIO Web UI: https://minio.automear.com/"
    echo "   2. Verify bucket 'canais' has the images"
    echo "   3. Re-upload images if missing"
    echo "   4. Use idRoteiro 41 which we know has images"
elif [ "$EXTERNAL_IP" != "$RESOLVED_IP" ]; then
    echo "⚠️  DNS SPLIT-BRAIN ISSUE"
    echo ""
    echo "   Internal and external DNS resolve to different IPs"
    echo "   May need to:"
    echo "   - Use internal MinIO URL"
    echo "   - Sync data between instances"
    echo "   - Use external IP directly"
else
    echo "✅ All tests passed from VPS side"
    echo ""
    echo "   If Node.js still fails, check:"
    echo "   - PM2 logs: pm2 logs api-gpu-orchestrator"
    echo "   - Axios timeout settings"
    echo "   - Certificate validation"
fi
echo ""
echo "=========================================="
