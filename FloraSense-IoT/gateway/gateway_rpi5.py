import base64
import json
import os
import random
import socket
import sqlite3
import threading
import time
from datetime import datetime, timezone

import requests
from cryptography.hazmat.primitives import hashes, padding as sym_padding, serialization
from cryptography.hazmat.primitives.asymmetric import padding as asym_padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

AWS_API_URL = os.getenv("AWS_API_URL", "http://localhost:3001").rstrip("/")
GATEWAY_SECRET = os.getenv("GATEWAY_SECRET", "change-me-gateway-secret")
GATEWAY_ID = os.getenv("GATEWAY_ID", "raspberry-pi-5-central")
INPUT_MODE = os.getenv("INPUT_MODE", "mock").lower()  # "tcp" | "serial" | "mock"
SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyUSB0")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "115200"))
TCP_PORT = int(os.getenv("TCP_PORT", "9500"))
SYNC_INTERVAL_SEC = float(os.getenv("SYNC_INTERVAL_SEC", "5"))
LOCAL_DB_PATH = os.getenv("LOCAL_DB_PATH", "/data/rpi5_local.db")


def init_local_db(db_path: str) -> sqlite3.Connection:
    os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS telemetry_buffer (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_key TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            synced INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.commit()
    return conn


def encrypt_hybrid_rsa_aes256(public_key_pem: str, data_dict: dict) -> dict:
    pub_key = serialization.load_pem_public_key(public_key_pem.encode("utf-8"))
    aes_key = os.urandom(32)  # AES-256
    iv = os.urandom(16)

    plaintext = json.dumps(data_dict, separators=(",", ":")).encode("utf-8")
    padder = sym_padding.PKCS7(128).padder()
    padded = padder.update(plaintext) + padder.finalize()

    cipher = Cipher(algorithms.AES(aes_key), modes.CBC(iv))
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(padded) + encryptor.finalize()

    encrypted_key = pub_key.encrypt(
        aes_key,
        asym_padding.OAEP(
            mgf=asym_padding.MGF1(algorithm=hashes.SHA256()),
            algorithm=hashes.SHA256(),
            label=None,
        ),
    )

    return {
        "encryptedKey": base64.b64encode(encrypted_key).decode("ascii"),
        "iv": base64.b64encode(iv).decode("ascii"),
        "payload": base64.b64encode(ciphertext).decode("ascii"),
    }


def normalize_node_packet(raw: dict) -> dict | None:
    device_key = raw.get("deviceKey") or raw.get("origen") or raw.get("groupId")
    if not device_key:
        return None

    soil_pct = raw.get("soilMoisturePct")
    if soil_pct is None:
        soil_pct = raw.get("suelo")

    return {
        "deviceKey": str(device_key),
        "name": raw.get("name") or str(device_key),
        "groupLabel": raw.get("groupLabel") or str(device_key),
        "mac": raw.get("mac"),
        "temperatureC": raw.get("temperatureC") if raw.get("temperatureC") is not None else raw.get("temp"),
        "airHumidityPct": raw.get("airHumidityPct") if raw.get("airHumidityPct") is not None else raw.get("hum"),
        "soilMoisturePct": soil_pct,
        "soilMoistureRaw": raw.get("soilMoistureRaw"),
        "pumpOn": bool(raw.get("pumpOn") if raw.get("pumpOn") is not None else raw.get("bomba", False)),
        "fanOn": bool(raw.get("fanOn") if raw.get("fanOn") is not None else raw.get("fan", False)),
        "rssi": raw.get("rssi"),
        "firmwareVersion": raw.get("firmwareVersion") or "esp8266-mesh-c6",
    }


def ingest_json_line(
    raw_line: str,
    latest_nodes: dict,
    acks_queue: list,
    state_lock: threading.Lock,
    db: sqlite3.Connection,
    db_lock: threading.Lock,
):
    raw_line = raw_line.strip()
    if not raw_line or not raw_line.startswith("{"):
        return

    parsed = json.loads(raw_line)
    if parsed.get("ack"):
        ack_obj = {
            "commandId": parsed.get("commandId"),
            "deviceKey": parsed.get("origen") or parsed.get("deviceKey"),
            "status": parsed.get("status", "ACKNOWLEDGED"),
            "pumpOn": parsed.get("bomba", parsed.get("pumpOn")),
            "fanOn": parsed.get("fan", parsed.get("fanOn")),
        }
        with state_lock:
            acks_queue.append(ack_obj)
        print(f"[Concentrador -> RPi5] ACK recibido: {ack_obj}")
        return

    norm = normalize_node_packet(parsed)
    if norm:
        with state_lock:
            latest_nodes[norm["deviceKey"]] = norm
        with db_lock:
            db.execute(
                "INSERT INTO telemetry_buffer (device_key, payload_json, created_at) VALUES (?, ?, ?)",
                (
                    norm["deviceKey"],
                    json.dumps(norm),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            db.commit()
        print(
            f"[Concentrador -> RPi5] {norm['deviceKey']} | T={norm['temperatureC']}C | Aire={norm['airHumidityPct']}% | Suelo={norm['soilMoisturePct']}% | Bomba={norm['pumpOn']}"
        )


class MockMeshConcentrator:
    """Simula 3 grupos de ESP8266 comunicándose en Canal 6 con el Concentrador."""

    def __init__(self):
        self.lock = threading.Lock()
        self.nodes = {
            "GRUPO_1": {
                "deviceKey": "GRUPO_1",
                "name": "Grupo 1 - Invernadero Norte",
                "groupLabel": "Grupo 1",
                "mac": "24:6F:28:AA:01:01",
                "temperatureC": 24.2,
                "airHumidityPct": 61.0,
                "soilMoisturePct": 38.0,
                "pumpOn": False,
                "fanOn": False,
                "rssi": -49,
                "firmwareVersion": "esp8266-mesh-c6",
            },
            "GRUPO_2": {
                "deviceKey": "GRUPO_2",
                "name": "Grupo 2 - Invernadero Centro",
                "groupLabel": "Grupo 2",
                "mac": "24:6F:28:AA:01:02",
                "temperatureC": 26.8,
                "airHumidityPct": 54.0,
                "soilMoisturePct": 58.0,
                "pumpOn": False,
                "fanOn": False,
                "rssi": -53,
                "firmwareVersion": "esp8266-mesh-c6",
            },
            "GRUPO_3": {
                "deviceKey": "GRUPO_3",
                "name": "Grupo 3 - Invernadero Sur",
                "groupLabel": "Grupo 3",
                "mac": "24:6F:28:AA:01:03",
                "temperatureC": 29.1,
                "airHumidityPct": 48.0,
                "soilMoisturePct": 66.0,
                "pumpOn": False,
                "fanOn": True,
                "rssi": -57,
                "firmwareVersion": "esp8266-mesh-c6",
            },
        }
        self.pending_acks: list[dict] = []

    def step_sensors(self) -> list[dict]:
        with self.lock:
            snapshots = []
            for node in self.nodes.values():
                node["temperatureC"] = round(
                    max(14.0, min(35.0, node["temperatureC"] + random.uniform(-0.25, 0.25))), 1
                )
                node["airHumidityPct"] = round(
                    max(30.0, min(90.0, node["airHumidityPct"] + random.uniform(-0.6, 0.6))), 1
                )
                if node["pumpOn"]:
                    node["soilMoisturePct"] = round(min(95.0, node["soilMoisturePct"] + 3.5), 1)
                else:
                    node["soilMoisturePct"] = round(max(18.0, node["soilMoisturePct"] - 0.4), 1)

                node["soilMoistureRaw"] = int(1023 - (node["soilMoisturePct"] * 7.2))
                node["rssi"] = -46 - random.randint(0, 14)
                snapshots.append(dict(node))
            return snapshots

    def handle_command(self, cmd: dict):
        target_key = cmd.get("deviceKey")
        action = str(cmd.get("action", "")).upper()
        target_actuator = cmd.get("target", "pump")
        command_id = cmd.get("commandId")

        with self.lock:
            node = self.nodes.get(target_key)
            if not node:
                print(f"[MOCK-MESH] Nodo desconocido para comando: {target_key}")
                return

            if target_actuator == "fan":
                node["fanOn"] = action == "ON"
            else:
                node["pumpOn"] = action == "ON"

            print(
                f"[MOCK-MESH Canal 6] Concentrador -> {target_key} | {target_actuator.upper()}={action} (cmd={command_id})"
            )
            if command_id:
                self.pending_acks.append(
                    {
                        "commandId": command_id,
                        "deviceKey": target_key,
                        "status": "ACKNOWLEDGED",
                        "pumpOn": node["pumpOn"],
                        "fanOn": node["fanOn"],
                    }
                )

    def pop_acks(self) -> list[dict]:
        with self.lock:
            acks = list(self.pending_acks)
            self.pending_acks.clear()
            return acks


def fetch_aws_public_key() -> str:
    url = f"{AWS_API_URL}/api/gateway/public-key"
    resp = requests.get(url, timeout=5)
    resp.raise_for_status()
    return resp.json()["publicKeyPem"]


def main():
    print(f"[RPi5 Gateway] Iniciando en modo={INPUT_MODE} | AWS_API_URL={AWS_API_URL}")
    db = init_local_db(LOCAL_DB_PATH)
    db_lock = threading.Lock()

    latest_nodes: dict[str, dict] = {}
    acks_queue: list[dict] = []
    state_lock = threading.Lock()

    mock_mesh = MockMeshConcentrator() if INPUT_MODE == "mock" else None
    serial_conn = None

    tcp_client_lock = threading.Lock()
    tcp_client_conn: list[socket.socket | None] = [None]

    if INPUT_MODE == "serial":
        import serial  # type: ignore

        print(f"[RPi5 Gateway] Abriendo puerto USB Serial {SERIAL_PORT} @ {SERIAL_BAUD}...")
        serial_conn = serial.Serial(SERIAL_PORT, SERIAL_BAUD, timeout=1)

        def serial_reader():
            while True:
                try:
                    raw_line = serial_conn.readline().decode("utf-8", errors="ignore")
                    ingest_json_line(raw_line, latest_nodes, acks_queue, state_lock, db, db_lock)
                except Exception as exc:
                    print(f"[RPi5 Serial] Error leyendo línea: {exc}")
                    time.sleep(1)

        threading.Thread(target=serial_reader, daemon=True).start()

    elif INPUT_MODE == "tcp":
        def tcp_server():
            srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            srv.bind(("0.0.0.0", TCP_PORT))
            srv.listen(1)
            print(f"[RPi5 TCP Bridge] Escuchando en puerto :{TCP_PORT} esperando puente USB del Concentrador...")

            while True:
                conn, addr = srv.accept()
                print(f"[RPi5 TCP Bridge] Puente USB conectado desde {addr[0]}:{addr[1]}")
                with tcp_client_lock:
                    if tcp_client_conn[0] is not None:
                        try:
                            tcp_client_conn[0].close()
                        except Exception:
                            pass
                    tcp_client_conn[0] = conn

                buffer = ""
                try:
                    while True:
                        chunk = conn.recv(2048)
                        if not chunk:
                            break
                        buffer += chunk.decode("utf-8", errors="ignore")
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            try:
                                ingest_json_line(line, latest_nodes, acks_queue, state_lock, db, db_lock)
                            except Exception as exc:
                                print(f"[RPi5 TCP Bridge] Línea ignorada ({exc}): {line[:120]}")
                except Exception as exc:
                    print(f"[RPi5 TCP Bridge] Conexión cerrada: {exc}")
                finally:
                    with tcp_client_lock:
                        if tcp_client_conn[0] is conn:
                            tcp_client_conn[0] = None
                    try:
                        conn.close()
                    except Exception:
                        pass
                    print("[RPi5 TCP Bridge] Puente USB desconectado. Esperando reconexión...")

        threading.Thread(target=tcp_server, daemon=True).start()

    aws_public_key_pem: str | None = None

    while True:
        loop_start = time.time()
        try:
            if not aws_public_key_pem:
                aws_public_key_pem = fetch_aws_public_key()
                print("[RPi5 Gateway] Clave pública RSA de AWS descargada correctamente.")

            if INPUT_MODE == "mock" and mock_mesh is not None:
                nodes_batch = mock_mesh.step_sensors()
                acks_batch = mock_mesh.pop_acks()
                with db_lock:
                    now_iso = datetime.now(timezone.utc).isoformat()
                    for n in nodes_batch:
                        db.execute(
                            "INSERT INTO telemetry_buffer (device_key, payload_json, created_at) VALUES (?, ?, ?)",
                            (n["deviceKey"], json.dumps(n), now_iso),
                        )
                    db.commit()
            else:
                with state_lock:
                    nodes_batch = list(latest_nodes.values())
                    latest_nodes.clear()
                    acks_batch = list(acks_queue)
                    acks_queue.clear()

            if nodes_batch or acks_batch:
                envelope_plain = {
                    "gatewayId": GATEWAY_ID,
                    "sentAt": datetime.now(timezone.utc).isoformat(),
                    "nodes": nodes_batch,
                    "acks": acks_batch,
                }
                encrypted_body = encrypt_hybrid_rsa_aes256(aws_public_key_pem, envelope_plain)

                resp = requests.post(
                    f"{AWS_API_URL}/api/gateway/sync",
                    json=encrypted_body,
                    headers={"x-gateway-key": GATEWAY_SECRET},
                    timeout=8,
                )
                resp.raise_for_status()
                result = resp.json()

                with db_lock:
                    db.execute("UPDATE telemetry_buffer SET synced = 1 WHERE synced = 0")
                    db.commit()

                commands = result.get("commands", [])
                print(
                    f"[RPi5 -> AWS] Sync cifrado OK | nodos={len(nodes_batch)} | acks={len(acks_batch)} | comandos={len(commands)}"
                )

                for cmd in commands:
                    if INPUT_MODE == "mock" and mock_mesh is not None:
                        mock_mesh.handle_command(cmd)
                    else:
                        downlink = {
                            "destino": cmd.get("deviceKey"),
                            "commandId": cmd.get("commandId"),
                            "target": cmd.get("target", "pump"),
                            "action": cmd.get("action"),
                            "maxDurationSeconds": cmd.get("maxDurationSeconds", 30),
                        }
                        line_bytes = (json.dumps(downlink) + "\n").encode("utf-8")
                        if serial_conn is not None:
                            serial_conn.write(line_bytes)
                            print(f"[RPi5 -> Concentrador USB] Enviado: {downlink}")
                        elif INPUT_MODE == "tcp":
                            with tcp_client_lock:
                                client = tcp_client_conn[0]
                            if client is not None:
                                client.sendall(line_bytes)
                                print(f"[RPi5 -> Puente USB -> Concentrador] Enviado: {downlink}")
                            else:
                                print(f"[RPi5 TCP Bridge] Sin puente USB conectado para enviar: {downlink}")
            else:
                if INPUT_MODE == "tcp":
                    print("[RPi5 Gateway] Esperando tramas del Concentrador USB (puerto TCP :9500)...")
                else:
                    print("[RPi5 Gateway] Esperando tramas del Concentrador ESP8266...")

        except requests.exceptions.RequestException as exc:
            print(f"[RPi5 Gateway] Error conectando con AWS API ({AWS_API_URL}): {exc}")
            aws_public_key_pem = None
        except Exception as exc:
            print(f"[RPi5 Gateway] Error en ciclo sync: {exc}")

        elapsed = time.time() - loop_start
        time.sleep(max(0.5, SYNC_INTERVAL_SEC - elapsed))


if __name__ == "__main__":
    main()
