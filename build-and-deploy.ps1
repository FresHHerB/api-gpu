# ============================================
# Build and Deploy Script - v2.10.0
# Execute este script após o Docker Desktop estar rodando
# ============================================

Write-Host "🚀 Build and Deploy - v2.10.0" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build Docker Image
Write-Host "📦 Step 1: Building Docker image..." -ForegroundColor Blue
docker build -f docker/worker-python.Dockerfile -t oreiasccp/api-gpu-worker:v2.10.0 -t oreiasccp/api-gpu-worker:latest .

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker build failed" -ForegroundColor Red
    exit 1
}

# Step 2: Push to Docker Hub
Write-Host "🚢 Step 2: Pushing to Docker Hub..." -ForegroundColor Blue
docker push oreiasccp/api-gpu-worker:v2.10.0
docker push oreiasccp/api-gpu-worker:latest

if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Docker push failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "✅ Build and push completed!" -ForegroundColor Green
Write-Host "Next: Run deploy-runpod.ps1 to update RunPod template and endpoint" -ForegroundColor Yellow
