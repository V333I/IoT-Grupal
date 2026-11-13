param(
    [string]$Port = "COM3",
    [int]$Baud = 115200,
    [string]$HostAddr = "127.0.0.1",
    [int]$TcpPort = 9500
)

Write-Host "=====================================================" -ForegroundColor Cyan
Write-Host " Puente USB Concentrador ($Port @ $Baud) <-> RPi5 Docker ($HostAddr`:$TcpPort)" -ForegroundColor Cyan
Write-Host " Presiona Ctrl+C antes de subir codigo desde Arduino IDE." -ForegroundColor Yellow
Write-Host "=====================================================" -ForegroundColor Cyan

$serial = New-Object System.IO.Ports.SerialPort $Port, $Baud, "None", 8, "One"
$serial.NewLine = "`n"
$serial.ReadTimeout = 50
$serial.DtrEnable = $false
$serial.RtsEnable = $false

$tcp = $null
$stream = $null
$tcpBuffer = ""

try {
    $serial.Open()
    Write-Host "[OK] Puerto serie $Port abierto." -ForegroundColor Green

    while ($true) {
        # Reconectar al contenedor Docker si se reinicia
        if ($null -eq $tcp -or -not $tcp.Connected) {
            try {
                if ($null -ne $tcp) { $tcp.Dispose() }
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect($HostAddr, $TcpPort)
                $stream = $tcp.GetStream()
                $tcpBuffer = ""
                Write-Host "[OK] Conectado a la Raspberry Pi 5 simulada en Docker ($HostAddr`:$TcpPort)." -ForegroundColor Green
            } catch {
                Write-Host "[ESPERA] No se pudo conectar a Docker $HostAddr`:$TcpPort. Reintentando en 2s..." -ForegroundColor DarkYellow
                Start-Sleep -Seconds 2
                continue
            }
        }

        # 1. Leer del NodeMCU Concentrador (USB) -> enviar a RPi5 Docker
        try {
            while ($serial.BytesToRead -gt 0) {
                $line = $serial.ReadLine().Trim()
                if ($line.Length -gt 0) {
                    Write-Host "[NodeMCU -> RPi5] $line" -ForegroundColor Cyan
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($line + "`n")
                    $stream.Write($bytes, 0, $bytes.Length)
                    $stream.Flush()
                }
            }
        } catch [System.TimeoutException] {
            # Linea parcial aun llegando, continuar
        }

        # 2. Leer comandos desde RPi5 Docker -> escribir al NodeMCU Concentrador (USB)
        if ($stream.DataAvailable) {
            $buf = New-Object byte[] 2048
            $read = $stream.Read($buf, 0, $buf.Length)
            if ($read -eq 0) {
                $tcp.Close()
                continue
            }
            $tcpBuffer += [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
            while ($tcpBuffer.Contains("`n")) {
                $idx = $tcpBuffer.IndexOf("`n")
                $cmdLine = $tcpBuffer.Substring(0, $idx).Trim()
                $tcpBuffer = $tcpBuffer.Substring($idx + 1)
                if ($cmdLine.Length -gt 0) {
                    Write-Host "[RPi5 -> NodeMCU] $cmdLine" -ForegroundColor Magenta
                    $serial.WriteLine($cmdLine)
                }
            }
        }

        Start-Sleep -Milliseconds 30
    }
} finally {
    if ($null -ne $tcp) { $tcp.Dispose() }
    if ($serial.IsOpen) { $serial.Close() }
    $serial.Dispose()
    Write-Host "`n[CERRADO] Puerto $Port liberado." -ForegroundColor Yellow
}
