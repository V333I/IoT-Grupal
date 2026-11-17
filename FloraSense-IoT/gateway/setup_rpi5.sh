#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   ./setup_rpi5.sh [AWS_EC2_IP] [GATEWAY_SECRET] [SERIAL_PORT]
# Ejemplo:
#   ./setup_rpi5.sh 54.123.45.67 mi-secreto-gateway /dev/ttyUSB0

AWS_HOST="${1:-TU_IP_PUBLICA_EC2}"
GW_SECRET="${2:-change-me-gateway-secret}"
SERIAL_DEV="${3:-auto}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RPI_USER="$(whoami)"

echo "=== [1/4] Verificando dependencias del sistema y permisos USB ($RPI_USER) ==="
if ! command -v git >/dev/null 2>&1 || ! python3 -m venv --help >/dev/null 2>&1; then
  sudo apt-get update -y
  sudo apt-get install -y git python3-venv python3-pip
fi
sudo usermod -aG dialout "$RPI_USER"

echo "=== [2/4] Configurando entorno Python en $SCRIPT_DIR/.venv ==="
python3 -m venv --system-site-packages "$SCRIPT_DIR/.venv"
if ! "$SCRIPT_DIR/.venv/bin/python" -c "import serial, cryptography, requests" >/dev/null 2>&1; then
  "$SCRIPT_DIR/.venv/bin/pip" install --upgrade pip
  "$SCRIPT_DIR/.venv/bin/pip" install -r "$SCRIPT_DIR/requirements.txt"
fi

echo "=== [3/4] Escribiendo /etc/florasense-gateway.env ==="
if [[ "$AWS_HOST" == http* ]]; then
  AWS_URL="$AWS_HOST"
else
  AWS_URL="http://${AWS_HOST}:3001"
fi

sudo tee /etc/florasense-gateway.env >/dev/null <<EOF
INPUT_MODE=serial
SERIAL_PORT=$SERIAL_DEV
SERIAL_BAUD=115200
AWS_API_URL=$AWS_URL
GATEWAY_SECRET=$GW_SECRET
GATEWAY_ID=raspberry-pi-5-central
LOCAL_DB_PATH=$SCRIPT_DIR/rpi5_local.db
SYNC_INTERVAL_SEC=5
EOF
sudo chmod 600 /etc/florasense-gateway.env

echo "=== [4/4] Configurando servicio systemd florasense-gateway.service ==="
sudo tee /etc/systemd/system/florasense-gateway.service >/dev/null <<EOF
[Unit]
Description=FloraSense Raspberry Pi 5 IoT Gateway
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RPI_USER
WorkingDirectory=$SCRIPT_DIR
EnvironmentFile=/etc/florasense-gateway.env
ExecStart=$SCRIPT_DIR/.venv/bin/python $SCRIPT_DIR/gateway_rpi5.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable florasense-gateway
sudo systemctl restart florasense-gateway

echo ""
echo "=============================================================="
echo " Raspberry Pi 5 Gateway instalado."
echo " Archivo de entorno: /etc/florasense-gateway.env"
echo " Logs en vivo:       journalctl -u florasense-gateway -f"
echo "=============================================================="
