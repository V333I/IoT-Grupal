param(
    [string]$Port = "COM3",
    [int]$Baud = 115200
)

Write-Host "[1/3] Liberando $Port (cerrando serial-monitor de Arduino IDE si esta abierto)..." -ForegroundColor Yellow
Stop-Process -Name "serial-monitor" -Force -ErrorAction SilentlyContinue

Write-Host "[2/3] Verificando contenedor RPi5 simulada en Docker..." -ForegroundColor Cyan
$envFile = Join-Path $PSScriptRoot ".env"
$useExternalAws = $false
if (Test-Path $envFile) {
    $envRaw = Get-Content $envFile -Raw
    if ($envRaw -match 'AWS_API_URL=https?://(?!api\b|localhost\b|127\.0\.0\.1\b)') {
        $useExternalAws = $true
    }
}

if ($useExternalAws) {
    docker compose --profile sim up -d --no-deps rpi5_gateway | Out-Null
} else {
    docker compose --profile sim up -d | Out-Null
}

Write-Host "[3/3] Iniciando puente bidireccional USB <-> RPi5 Docker..." -ForegroundColor Green
& "$PSScriptRoot\bridge_usb_rpi5.ps1" -Port $Port -Baud $Baud
