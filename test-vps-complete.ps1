# Complete VPS Test - PowerShell version
# Usage: .\test-vps-complete.ps1 [VPS_URL]

param(
    [string]$VpsUrl = "http://185.173.110.7:3000",
    [int]$WebhookPort = 8888
)

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "🧪 Complete VPS Endpoint Test" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "VPS URL: $VpsUrl"
Write-Host "Webhook Port: $WebhookPort"
Write-Host ""

# Check if webhook server port is in use
$port = Get-NetTCPConnection -LocalPort $WebhookPort -ErrorAction SilentlyContinue
if ($port) {
    Write-Host "⚠️  Port $WebhookPort is already in use" -ForegroundColor Yellow
    Write-Host "   Stopping existing process..."
    $processId = $port.OwningProcess
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# Start webhook server
Write-Host "1. Starting webhook server..." -ForegroundColor Green
$webhookServer = Start-Process -FilePath "node" -ArgumentList "test-webhook-server.js" -PassThru -WindowStyle Hidden -RedirectStandardOutput "webhook-server.log" -RedirectStandardError "webhook-error.log"

Start-Sleep -Seconds 2

# Check if server started
if (!$webhookServer -or $webhookServer.HasExited) {
    Write-Host "❌ Failed to start webhook server" -ForegroundColor Red
    Get-Content "webhook-error.log" -ErrorAction SilentlyContinue
    exit 1
}

Write-Host "✅ Webhook server started (PID: $($webhookServer.Id))" -ForegroundColor Green
Write-Host ""

# Run test
Write-Host "2. Running test..." -ForegroundColor Green
$env:VPS_URL = $VpsUrl
node test-vps-img2vid.js

# Wait for webhook
Write-Host ""
Write-Host "3. Waiting for webhook response..." -ForegroundColor Yellow
Write-Host "   (Will wait 30 seconds, press Ctrl+C to stop early)"

Start-Sleep -Seconds 30

# Show webhook logs
Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "📊 Webhook Server Logs" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

if (Test-Path "webhook-server.log") {
    Get-Content "webhook-server.log" -Tail 50
}

# Cleanup
Write-Host ""
Write-Host "Stopping webhook server..." -ForegroundColor Yellow
Stop-Process -Id $webhookServer.Id -Force -ErrorAction SilentlyContinue

Write-Host "✅ Test complete" -ForegroundColor Green
