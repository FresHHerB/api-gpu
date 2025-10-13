# Build and push Docker image for api-gpu-worker (PowerShell version)

param(
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

# Configuration
$ImageName = "oreiasccp/api-gpu-worker"
$Dockerfile = "docker/worker-python.Dockerfile"

Write-Host "🐳 Building Docker image for api-gpu-worker" -ForegroundColor Green
Write-Host "Version: $Version" -ForegroundColor Yellow
Write-Host ""

# Check if Docker is running
try {
    docker info | Out-Null
} catch {
    Write-Host "❌ Error: Docker is not running" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again"
    exit 1
}

# Check if Dockerfile exists
if (-not (Test-Path $Dockerfile)) {
    Write-Host "❌ Error: Dockerfile not found at $Dockerfile" -ForegroundColor Red
    exit 1
}

# Build image
Write-Host "📦 Building image..." -ForegroundColor Green
if ($Version -eq "latest") {
    docker build -f $Dockerfile -t "${ImageName}:latest" .
} else {
    docker build -f $Dockerfile -t "${ImageName}:latest" -t "${ImageName}:${Version}" .
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Build completed successfully" -ForegroundColor Green
Write-Host ""

# Ask for confirmation before pushing
$response = Read-Host "Push to Docker Hub? (y/N)"
if ($response -notmatch '^[Yy]$') {
    Write-Host "⏭️  Skipping push" -ForegroundColor Yellow
    exit 0
}

# Push image
Write-Host "📤 Pushing image to Docker Hub..." -ForegroundColor Green
docker push "${ImageName}:latest"

if ($Version -ne "latest") {
    docker push "${ImageName}:${Version}"
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Push failed" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Push completed successfully" -ForegroundColor Green
Write-Host ""
Write-Host "🎉 Done!" -ForegroundColor Green
Write-Host ""
Write-Host "Image: ${ImageName}:latest"
if ($Version -ne "latest") {
    Write-Host "       ${ImageName}:${Version}"
}
Write-Host ""
Write-Host "Next steps:"
Write-Host "1. Update RunPod template with new image"
Write-Host "2. Deploy to RunPod endpoint"
Write-Host "3. Test the deployment"
Write-Host ""
Write-Host "See RUNPOD_DEPLOYMENT.md for deployment instructions"
