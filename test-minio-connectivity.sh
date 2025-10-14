#!/bin/bash
# Test MinIO Connectivity from VPS
# Run this on the VPS to diagnose 404 errors

echo "=========================================="
echo "🔍 MinIO Connectivity Test"
echo "=========================================="
echo ""

# Test DNS resolution
echo "1. Testing DNS resolution..."
echo "   Host: minio.automear.com"
if host minio.automear.com > /dev/null 2>&1; then
    echo "   ✅ DNS resolves:"
    host minio.automear.com | head -n 5
else
    echo "   ❌ DNS resolution FAILED"
    echo "      This is likely the problem!"
fi
echo ""

# Test ping
echo "2. Testing network connectivity..."
if ping -c 3 minio.automear.com > /dev/null 2>&1; then
    echo "   ✅ Ping successful"
else
    echo "   ⚠️  Ping failed (may be blocked, but not necessarily a problem)"
fi
echo ""

# Test HTTP connectivity
echo "3. Testing HTTP connectivity..."
echo "   Testing: https://minio.automear.com/"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://minio.automear.com/)
echo "   Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "403" ] || [ "$HTTP_STATUS" = "307" ]; then
    echo "   ✅ MinIO server is reachable"
else
    echo "   ❌ MinIO server is NOT reachable"
    echo "      HTTP Status: $HTTP_STATUS"
fi
echo ""

# Test specific image URLs
echo "4. Testing image URLs..."
echo ""

# Test image from idRoteiro 41 (3 Contos)
TEST_URL_41="https://minio.automear.com/canais/Mr. Nightmare/3 Contos VERDADEIROS de Casas Assombradas QUE VÃO TE ARREPIAR/imagens/temp/imagem_1.jpg"
echo "   a) Testing idRoteiro 41 image:"
echo "      URL: $TEST_URL_41"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$TEST_URL_41")
echo "      Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "200" ]; then
    FILE_SIZE=$(curl -s -I "$TEST_URL_41" | grep -i content-length | awk '{print $2}' | tr -d '\r')
    echo "      ✅ Image accessible - Size: $((FILE_SIZE / 1024)) KB"
else
    echo "      ❌ Image NOT accessible (404)"
fi
echo ""

# Test image from idRoteiro 42 (4 Casos)
TEST_URL_42="https://minio.automear.com/canais/Mr. Nightmare/4 Casos VERDADEIROS de Casas Assombradas Que Terminaram Mal/imagens/temp/imagem_1.jpg"
echo "   b) Testing idRoteiro 42 image:"
echo "      URL: $TEST_URL_42"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$TEST_URL_42")
echo "      Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "200" ]; then
    FILE_SIZE=$(curl -s -I "$TEST_URL_42" | grep -i content-length | awk '{print $2}' | tr -d '\r')
    echo "      ✅ Image accessible - Size: $((FILE_SIZE / 1024)) KB"
else
    echo "      ❌ Image NOT accessible (404)"
    echo "      💡 This is likely the problem!"
    echo "         Images for idRoteiro 42 don't exist or were deleted"
fi
echo ""

# Test with URL encoding
echo "5. Testing URL encoding..."
ENCODED_URL=$(echo "$TEST_URL_41" | sed 's/ /%20/g')
echo "   Original: $TEST_URL_41"
echo "   Encoded:  $ENCODED_URL"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$ENCODED_URL")
echo "   Status: $HTTP_STATUS"
if [ "$HTTP_STATUS" = "200" ]; then
    echo "   ✅ URL encoding works correctly"
else
    echo "   ⚠️  URL encoding may have issues"
fi
echo ""

# Test MinIO API
echo "6. Testing MinIO API..."
echo "   Listing buckets..."
BUCKETS=$(curl -s --max-time 10 https://minio.automear.com/ 2>&1)
if echo "$BUCKETS" | grep -q "ListAllMyBucketsResult\|AccessDenied\|canais"; then
    echo "   ✅ MinIO API responds"
else
    echo "   ⚠️  MinIO API response unclear"
fi
echo ""

echo "=========================================="
echo "📊 DIAGNOSIS"
echo "=========================================="
echo ""

# Determine the issue
if [ "$HTTP_STATUS" = "000" ]; then
    echo "❌ NETWORK CONNECTIVITY ISSUE"
    echo "   - VPS cannot reach minio.automear.com"
    echo "   - Check firewall rules"
    echo "   - Check network configuration"
elif host minio.automear.com > /dev/null 2>&1; then
    echo "🔍 MinIO is reachable, but images return 404"
    echo ""
    echo "💡 LIKELY CAUSES:"
    echo "   1. Images were deleted from MinIO"
    echo "   2. Images were moved to different path"
    echo "   3. Bucket permissions changed"
    echo "   4. Wrong path in the request"
    echo ""
    echo "💡 SOLUTIONS:"
    echo "   1. Check MinIO web UI: https://minio.automear.com/"
    echo "   2. Verify images exist for idRoteiro 42"
    echo "   3. Re-upload images if needed"
    echo "   4. Check bucket policies and permissions"
else
    echo "❌ DNS RESOLUTION FAILED"
    echo "   - VPS cannot resolve minio.automear.com"
    echo "   - Check /etc/resolv.conf"
    echo "   - Check DNS configuration"
fi
echo ""
echo "=========================================="
