param(
    [string]$Port = "COM3",
    [int]$Baud = 115200
)

Write-Host "[1/3] Liberando $Port (cerrando serial-monitor de Arduino IDE si esta abierto)..." -ForegroundColor Yellow
Stop-Process -Name "serial-monitor" -Force -ErrorAction SilentlyContinue

Write-Host "[2/3] Verificando contenedores Docker (FloraSense + RPi5 simulada)..." -ForegroundColor Cyan
docker compose --profile sim up -d | Out-Null

Write-Host "[3/3] Iniciando puente bidireccional USB <-> RPi5 Docker..." -ForegroundColor Green
& "$PSScriptRoot\bridge_usb_rpi5.ps1" -Port $Port -Baud $Baud
