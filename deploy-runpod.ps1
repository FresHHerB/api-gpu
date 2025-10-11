# ============================================
# RunPod Deployment Script - v2.10.0 (PowerShell)
# Multi-Zoom Support: zoomin, zoomout, zoompanright
# ============================================

Write-Host "🚀 RunPod Deployment - v2.10.0 Multi-Zoom Support" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Configuration
$DOCKER_IMAGE = "oreiasccp/api-gpu-worker"
$VERSION = "v2.10.0"
$RUNPOD_API_KEY = $env:RUNPOD_API_KEY
if (-not $RUNPOD_API_KEY) {
    $RUNPOD_API_KEY = (Get-Content .env | Select-String "RUNPOD_API_KEY=").ToString().Split('=')[1]
}

# Step 1: Build Docker Image
Write-Host "📦 Step 1: Building Docker image..." -ForegroundColor Blue
docker build -f docker/worker-python.Dockerfile -t "${DOCKER_IMAGE}:${VERSION}" -t "${DOCKER_IMAGE}:latest" .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

# Step 2: Push to Docker Hub
Write-Host "🚢 Step 2: Pushing to Docker Hub..." -ForegroundColor Blue
docker push "${DOCKER_IMAGE}:${VERSION}"
docker push "${DOCKER_IMAGE}:latest"

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker push failed" -ForegroundColor Red
    exit 1
}

# Step 3: Create RunPod Template
Write-Host "📝 Step 3: Creating RunPod template..." -ForegroundColor Blue

$templateBody = @{
    query = "mutation { saveTemplate(input: { name: \`"api-gpu-worker-v2.10\`", imageName: \`"$DOCKER_IMAGE`:$VERSION\`", dockerArgs: \`"python -u rp_handler.py\`", containerDiskInGb: 10, volumeInGb: 0, isServerless: true, env: [{key: \`"WORK_DIR\`", value: \`"/tmp/work\`"}, {key: \`"OUTPUT_DIR\`", value: \`"/tmp/output\`"}, {key: \`"BATCH_SIZE\`", value: \`"3\`"}] }) { id name imageName } }"
} | ConvertTo-Json

$templateResponse = Invoke-RestMethod -Uri "https://api.runpod.io/graphql" `
    -Method Post `
    -Headers @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $RUNPOD_API_KEY"
    } `
    -Body $templateBody

$TEMPLATE_ID = $templateResponse.data.saveTemplate.id

if (-not $TEMPLATE_ID) {
    Write-Host "❌ Failed to create template" -ForegroundColor Red
    Write-Host ($templateResponse | ConvertTo-Json) -ForegroundColor Red
    exit 1
}

Write-Host "✅ Template created: $TEMPLATE_ID" -ForegroundColor Green

# Step 4: Create RunPod Endpoint
Write-Host "🔌 Step 4: Creating RunPod endpoint..." -ForegroundColor Blue

$endpointBody = @{
    query = "mutation { saveEndpoint(input: { name: \`"api-gpu-worker\`", templateId: \`"$TEMPLATE_ID\`", workersMin: 0, workersMax: 3, gpuIds: \`"AMPERE_16,AMPERE_24,NVIDIA RTX A4000\`", scalerType: \`"QUEUE_DELAY\`", scalerValue: 3, networkVolumeId: \`"\`" }) { id name templateId } }"
} | ConvertTo-Json

$endpointResponse = Invoke-RestMethod -Uri "https://api.runpod.io/graphql" `
    -Method Post `
    -Headers @{
        "Content-Type" = "application/json"
        "Authorization" = "Bearer $RUNPOD_API_KEY"
    } `
    -Body $endpointBody

$ENDPOINT_ID = $endpointResponse.data.saveEndpoint.id

if (-not $ENDPOINT_ID) {
    Write-Host "❌ Failed to create endpoint" -ForegroundColor Red
    Write-Host ($endpointResponse | ConvertTo-Json) -ForegroundColor Red
    exit 1
}

Write-Host "✅ Endpoint created: $ENDPOINT_ID" -ForegroundColor Green

# Step 5: Update .env file
Write-Host "📝 Step 5: Updating .env file..." -ForegroundColor Blue
$envContent = Get-Content .env
$envContent = $envContent -replace '^RUNPOD_ENDPOINT_ID=.*', "RUNPOD_ENDPOINT_ID=$ENDPOINT_ID"
$envContent | Set-Content .env

Write-Host ""
Write-Host "🎉 Deployment complete!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "Template ID: $TEMPLATE_ID" -ForegroundColor Yellow
Write-Host "Endpoint ID: $ENDPOINT_ID" -ForegroundColor Yellow
Write-Host "Image: ${DOCKER_IMAGE}:${VERSION}" -ForegroundColor Yellow
Write-Host ""
Write-Host "📋 Next steps:" -ForegroundColor Blue
Write-Host "1. Restart orchestrator to use new endpoint"
Write-Host "2. Test with new zoom_types parameter"
Write-Host ""
Write-Host "🎬 Example request:" -ForegroundColor Blue
Write-Host @'
{
  "images": [
    {"id": "img-1", "image_url": "https://example.com/photo1.jpg", "duracao": 6.48},
    {"id": "img-2", "image_url": "https://example.com/photo2.jpg", "duracao": 5.0},
    {"id": "img-3", "image_url": "https://example.com/photo3.jpg", "duracao": 3.42}
  ],
  "path": "Project/videos/temp/",
  "zoom_types": ["zoomin", "zoomout", "zoompanright"]
}
'@ -ForegroundColor Gray
Write-Host ""
