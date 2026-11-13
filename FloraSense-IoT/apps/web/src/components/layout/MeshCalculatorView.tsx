"use client";

import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyRound,
  Plus,
  RefreshCw,
  Copy,
  Download,
  Check,
  Trash2,
  Dice5,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import { Sidebar } from './Sidebar';
import { LoginView } from './LoginView';
import { TopographicPattern } from '../ui/TopographicPattern';

type RsaKeyParts = {
  n: Uint8Array;
  p: Uint8Array;
  q: Uint8Array;
  dp: Uint8Array;
  dq: Uint8Array;
  qi: Uint8Array;
};

type MeshNode = {
  id: string;
  nombre: string;
  rol: 'CONCENTRADOR' | 'INVERNADERO';
  mac: string;
  rsa: RsaKeyParts | null;
};

type TabType = 'publico' | 'privado' | 'sketch' | 'macscanner';

const ESPRESSIF_OUIS = [
  [0x24, 0x6f, 0x28],
  [0x84, 0xf3, 0xeb],
  [0xcc, 0x50, 0xe3],
  [0xec, 0xfa, 0xbc],
];

const safeGetItem = (k: string) => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null;
  } catch {
    return null;
  }
};

function genId() {
  if (typeof window !== 'undefined' && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function base64UrlToBytes(base64Url: string, targetLength: number): Uint8Array {
  let base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  const raw = window.atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  if (!targetLength || bytes.length === targetLength) return bytes;
  const result = new Uint8Array(targetLength);
  if (bytes.length > targetLength) {
    result.set(bytes.slice(bytes.length - targetLength));
  } else {
    result.set(bytes, targetLength - bytes.length);
  }
  return result;
}

function bytesToCHexArray(bytes: Uint8Array, porLinea = 12, indent = '      '): string {
  const hexItems = Array.from(bytes).map(
    (b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0'),
  );
  const lines: string[] = [];
  for (let i = 0; i < hexItems.length; i += porLinea) {
    lines.push(indent + hexItems.slice(i, i + porLinea).join(', '));
  }
  return lines.join(',\n');
}

function macToCHex(macStr: string): string {
  return macStr
    .split(':')
    .map((h) => '0x' + h.toUpperCase())
    .join(', ');
}

function esMacValida(mac: string): boolean {
  return /^([0-9A-Fa-f]{2}:){5}([0-9A-Fa-f]{2})$/.test(mac.trim());
}

function crearMacEspressif(indice: number): string {
  const oui = ESPRESSIF_OUIS[indice % ESPRESSIF_OUIS.length];
  const b3 = Math.floor(Math.random() * 256);
  const b4 = Math.floor(Math.random() * 256);
  const b5 = indice & 0xff;
  return [oui[0], oui[1], oui[2], b3, b4, b5]
    .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
    .join(':');
}

async function generarClavesRSAParaNodo(bits: number): Promise<RsaKeyParts> {
  if (typeof window === 'undefined' || !window.crypto?.subtle) {
    throw new Error(
      'WebCrypto requiere un contexto seguro (http://localhost o HTTPS) para generar claves RSA reales.',
    );
  }
  const modBytes = bits / 8;
  const primeBytes = modBytes / 2;

  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: bits,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['encrypt', 'decrypt'],
  );

  const jwkPriv = await window.crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    n: base64UrlToBytes(jwkPriv.n!, modBytes),
    p: base64UrlToBytes(jwkPriv.p!, primeBytes),
    q: base64UrlToBytes(jwkPriv.q!, primeBytes),
    dp: base64UrlToBytes(jwkPriv.dp!, primeBytes),
    dq: base64UrlToBytes(jwkPriv.dq!, primeBytes),
    qi: base64UrlToBytes(jwkPriv.qi!, primeBytes),
  };
}

export function MeshCalculatorView() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [meshChannel, setMeshChannel] = useState<string>('6');
  const [rsaBits, setRsaBits] = useState<number>(1024);
  const [nodos, setNodos] = useState<MeshNode[]>([]);
  const [tabActual, setTabActual] = useState<TabType>('publico');
  const [selectedNodoId, setSelectedNodoId] = useState<string>('');
  const [generando, setGenerando] = useState<boolean>(false);
  const [cryptoError, setCryptoError] = useState<string>('');
  const [copiado, setCopiado] = useState<boolean>(false);

  // Formulario nuevo nodo
  const [inputNombre, setInputNombre] = useState<string>('GRUPO_4');
  const [inputRol, setInputRol] = useState<'CONCENTRADOR' | 'INVERNADERO'>('INVERNADERO');
  const [inputMac, setInputMac] = useState<string>('24:6F:28:AA:01:04');
  const [errorInput, setErrorInput] = useState<string>('');

  useEffect(() => {
    const isAuth = safeGetItem('fs_auth_token') === 'true';
    setIsAuthenticated(isAuth);
  }, []);

  const cargarPlantilla = async (cantidadNodos: number, prefijo = 'GRUPO', bitsOverride?: number) => {
    const bits = bitsOverride ?? rsaBits;
    setGenerando(true);
    setCryptoError('');

    const plantillaBase: MeshNode[] = [
      {
        id: genId(),
        nombre: 'CONCENTRADOR',
        rol: 'CONCENTRADOR',
        mac: '78:1C:3C:85:BB:C8',
        rsa: null,
      },
    ];

    for (let i = 1; i <= cantidadNodos; i++) {
      const hexIdx = i.toString(16).toUpperCase().padStart(2, '0');
      const macNodo =
        i === 1 && prefijo === 'GRUPO' ? 'A4:CF:12:FE:F2:CC' : `24:6F:28:AA:01:${hexIdx}`;
      plantillaBase.push({
        id: genId(),
        nombre: `${prefijo}_${i}`,
        rol: 'INVERNADERO',
        mac: macNodo,
        rsa: null,
      });
    }

    try {
      for (let i = 0; i < plantillaBase.length; i++) {
        plantillaBase[i].rsa = await generarClavesRSAParaNodo(bits);
      }
    } catch (e: any) {
      setCryptoError(e.message || 'Error generando claves RSA.');
    }

    setNodos(plantillaBase);
    setSelectedNodoId(plantillaBase[0].id);
    setInputNombre(`GRUPO_${cantidadNodos + 1}`);
    setInputMac(crearMacEspressif(plantillaBase.length + 1));
    setGenerando(false);
  };

  useEffect(() => {
    if (isAuthenticated && nodos.length === 0) {
      cargarPlantilla(3, 'GRUPO');
    }
  }, [isAuthenticated]);

  const recalcularTodasLasClaves = async (bitsOverride?: number) => {
    if (generando || nodos.length === 0) return;
    const bits = bitsOverride ?? rsaBits;
    setGenerando(true);
    setCryptoError('');
    try {
      const actualizados: MeshNode[] = [];
      for (const n of nodos) {
        const rsa = await generarClavesRSAParaNodo(bits);
        actualizados.push({ ...n, rsa });
      }
      setNodos(actualizados);
    } catch (e: any) {
      setCryptoError(e.message || 'Error regenerando claves RSA.');
    } finally {
      setGenerando(false);
    }
  };

  const handleRsaBitsChange = async (newBits: number) => {
    setRsaBits(newBits);
    await recalcularTodasLasClaves(newBits);
  };

  const handleAgregarNodo = async () => {
    const nombreRaw = inputNombre
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');
    const mac = inputMac.trim().toUpperCase();

    if (!nombreRaw) {
      setErrorInput('Ingresa un nombre para el nodo (ej. GRUPO_4).');
      return;
    }
    if (!esMacValida(mac)) {
      setErrorInput('Formato de MAC inválido. Usa 6 pares hexadecimales como 24:6F:28:AA:BB:CC.');
      return;
    }
    if (nodos.some((n) => n.mac === mac)) {
      setErrorInput('Esa dirección MAC ya está registrada en otro nodo.');
      return;
    }

    setErrorInput('');
    setGenerando(true);
    try {
      const claves = await generarClavesRSAParaNodo(rsaBits);
      const nuevo: MeshNode = {
        id: genId(),
        nombre: nombreRaw,
        rol: inputRol,
        mac,
        rsa: claves,
      };
      const nextList = [...nodos, nuevo];
      setNodos(nextList);
      setSelectedNodoId(nuevo.id);
      const numGrupos = nextList.filter((n) => n.rol === 'INVERNADERO').length;
      setInputNombre(`GRUPO_${numGrupos + 1}`);
      setInputRol('INVERNADERO');
      setInputMac(crearMacEspressif(nextList.length + 1));
    } catch (e: any) {
      setErrorInput(e.message || 'No se pudieron generar las claves RSA.');
    } finally {
      setGenerando(false);
    }
  };

  const handleActualizarMac = (id: string, valor: string) => {
    const upper = valor.toUpperCase();
    setNodos((prev) => prev.map((n) => (n.id === id ? { ...n, mac: upper } : n)));
  };

  const handleEliminarNodo = (id: string) => {
    if (nodos.length <= 2) return;
    const next = nodos.filter((n) => n.id !== id);
    setNodos(next);
    if (selectedNodoId === id && next.length > 0) {
      setSelectedNodoId(next[0].id);
    }
  };

  const nodoActivo = useMemo(
    () => nodos.find((n) => n.id === selectedNodoId) || nodos[0] || null,
    [nodos, selectedNodoId],
  );

  const modBytes = rsaBits / 8;
  const totalFlash = nodos.length * (6 + 1 + modBytes);
  const tamPaquete = 6 + 6 + 1 + 16 + modBytes + 64;

  const codigoGenerado = useMemo(() => {
    if (tabActual === 'publico') {
      const idxConcentrador = Math.max(
        0,
        nodos.findIndex((n) => n.rol === 'CONCENTRADOR'),
      );
      const entradasStruct = nodos
        .map((n, i) => {
          const rolNum = n.rol === 'CONCENTRADOR' ? '1' : '0';
          const macHex = esMacValida(n.mac) ? macToCHex(n.mac) : '0x00, 0x00, 0x00, 0x00, 0x00, 0x00';
          const hexMod = n.rsa ? bytesToCHexArray(n.rsa.n, 16, '      ') : '';
          return `  // [${i}] ${n.nombre} (${n.rol}) - MAC: ${n.mac}
  {
    "${n.nombre}",
    { ${macHex} },
    ${rolNum},
    {
${hexMod}
    }
  }`;
        })
        .join(',\n');

      return `// ============================================================================
// ARCHIVO: directorio_publico.h
// Compartido por TODOS los NodeMCU (Grupos y Concentrador Principal)
// Red Mesh en Canal ${meshChannel} con Claves Públicas RSA-${rsaBits} hardcodeadas por MAC
// ============================================================================
#pragma once
#include <Arduino.h>

#define MESH_WIFI_CHANNEL     ${meshChannel}
#define TOTAL_NODOS_MESH      ${nodos.length}
#define INDICE_CONCENTRADOR   ${idxConcentrador}
#define RSA_MOD_BYTES         ${modBytes}   // ${rsaBits} bits

struct NodoMeshInfo {
  const char* nombre;
  uint8_t mac[6];
  uint8_t esConcentrador; // 1 = Concentrador Principal, 0 = Grupo/Invernadero
  uint8_t rsa_pub_mod[RSA_MOD_BYTES];
};

// Guardado en memoria Flash (PROGMEM) para ahorrar RAM en el ESP8266
const NodoMeshInfo TABLA_NODOS[TOTAL_NODOS_MESH] PROGMEM = {
${entradasStruct}
};
`;
    }

    if (tabActual === 'privado') {
      if (!nodoActivo || !nodoActivo.rsa) return '// Generando o seleccionando un nodo válido...';
      const primeBytes = rsaBits / 16;
      return `// ============================================================================
// ARCHIVO: clave_privada_nodo.h
// EXCLUSIVO PARA EL NODO: ${nodoActivo.nombre} (MAC: ${nodoActivo.mac})
// ¡NO COMPARTIR EN OTROS NODOS! Se usa con BearSSL para descifrar AES-256
// ============================================================================
#pragma once
#include <Arduino.h>

#define RSA_PRIME_BYTES ${primeBytes}

// Componentes privados CRT (Chinese Remainder Theorem) para BearSSL en ESP8266
const uint8_t MI_RSA_P[RSA_PRIME_BYTES] = {
${bytesToCHexArray(nodoActivo.rsa.p, 12, '  ')}
};

const uint8_t MI_RSA_Q[RSA_PRIME_BYTES] = {
${bytesToCHexArray(nodoActivo.rsa.q, 12, '  ')}
};

const uint8_t MI_RSA_DP[RSA_PRIME_BYTES] = {
${bytesToCHexArray(nodoActivo.rsa.dp, 12, '  ')}
};

const uint8_t MI_RSA_DQ[RSA_PRIME_BYTES] = {
${bytesToCHexArray(nodoActivo.rsa.dq, 12, '  ')}
};

const uint8_t MI_RSA_IQ[RSA_PRIME_BYTES] = {
${bytesToCHexArray(nodoActivo.rsa.qi, 12, '  ')}
};
`;
    }

    if (tabActual === 'sketch') {
      return `// ============================================================================
// SKETCH BIDIRECCIONAL NODEMCU (ESP8266): ${nodoActivo ? nodoActivo.nombre : 'NODO_MESH'}
// Red Mesh ESP-NOW Canal ${meshChannel} | Cifrado Híbrido RSA-OAEP + AES-256-CBC (BearSSL)
// Compatible con Raspberry Pi 5 (gateway_rpi5.py por USB Serial 115200) + FloraSense AWS
// Coloca "directorio_publico.h" y "clave_privada_nodo.h" en la misma carpeta
// ============================================================================
#include <Arduino.h>
#include <ESP8266WiFi.h>
#include <espnow.h>
#include <bearssl/bearssl.h>

#include "directorio_publico.h"
#include "clave_privada_nodo.h"

// Pines por defecto (ajusta según el cableado de tu grupo)
const int SOIL_MOISTURE_PIN = A0; // Sensor humedad de tierra (YL-69)
const int PUMP_PIN          = 5;  // D1 (GPIO5) - Relé Bomba Sumergible
const int FAN_PIN           = 4;  // D2 (GPIO4) - Relé Extractor/Ventilador (opcional)
const int DRY_ADC           = 1023;
const int WET_ADC           = 300;

#define MSG_TELEMETRIA  1
#define MSG_COMANDO     2
#define MSG_ACK         3

#define TARGET_PUMP     0
#define TARGET_FAN      1

// Payload de 64 bytes exactos (4 bloques AES-256)
struct __attribute__((packed)) MensajeMesh {
  uint8_t  tipo;           // 1=TELEMETRIA, 2=COMANDO, 3=ACK
  uint8_t  bomba_on;       // 1=ON, 0=OFF
  uint8_t  fan_on;         // 1=ON, 0=OFF
  uint8_t  target;         // 0=pump, 1=fan
  float    temperatura;    // °C
  float    humedad_aire;   // % HR
  float    humedad_suelo;  // % Tierra
  uint16_t max_duracion;   // seg seguridad bomba
  uint16_t reservado;
  uint32_t id_paquete;     // Secuencia anti-replay
  char     command_id[40]; // UUID de comando FloraSense
};

// Trama ESP-NOW Canal ${meshChannel} (221 bytes con RSA-1024 <= 250 bytes)
struct __attribute__((packed)) PaqueteMeshCifrado {
  uint8_t mac_origen[6];
  uint8_t mac_destino[6];
  uint8_t ttl_saltos;
  uint8_t iv[16];
  uint8_t clave_aes_cifrada[RSA_MOD_BYTES];
  uint8_t payload_aes256[sizeof(MensajeMesh)];
};

uint8_t miMAC[6];
int miIndiceNodo = -1;
bool soyConcentrador = false;
uint32_t secuenciaEnvio = 1;

bool estadoBomba = false;
bool estadoFan = false;
unsigned long bombaApagadoAutoMs = 0;

// Cola de recepción segura fuera de la interrupción ESP-NOW
#define RX_QUEUE_SIZE 4
PaqueteMeshCifrado colaRx[RX_QUEUE_SIZE];
volatile uint8_t colaHead = 0;
volatile uint8_t colaTail = 0;

String bufferSerialRPi = "";

int buscarNodoPorMAC(const uint8_t* macBuscada) {
  for (int i = 0; i < TOTAL_NODOS_MESH; i++) {
    uint8_t macTabla[6];
    memcpy_P(macTabla, TABLA_NODOS[i].mac, 6);
    if (memcmp(macBuscada, macTabla, 6) == 0) {
      return i;
    }
  }
  return -1;
}

const char* obtenerNombreNodo(int idx) {
  const char* ptr = nullptr;
  memcpy_P(&ptr, &TABLA_NODOS[idx].nombre, sizeof(const char*));
  return ptr ? ptr : "DESCONOCIDO";
}

int buscarNodoPorNombre(const char* nombreBuscado) {
  for (int i = 0; i < TOTAL_NODOS_MESH; i++) {
    if (strcmp(obtenerNombreNodo(i), nombreBuscado) == 0) {
      return i;
    }
  }
  return -1;
}

bool extraerCampoJson(const String& json, const char* clave, String& salida) {
  String patron = String("\\"") + clave + "\\"";
  int pos = json.indexOf(patron);
  if (pos < 0) return false;
  pos = json.indexOf(':', pos + patron.length());
  if (pos < 0) return false;
  pos++;
  while (pos < (int)json.length() && (json[pos] == ' ' || json[pos] == '\\t')) pos++;
  if (pos >= (int)json.length()) return false;

  if (json[pos] == '"') {
    int fin = json.indexOf('"', pos + 1);
    if (fin < 0) return false;
    salida = json.substring(pos + 1, fin);
    return true;
  } else {
    int fin = pos;
    while (fin < (int)json.length() && json[fin] != ',' && json[fin] != '}') fin++;
    salida = json.substring(pos, fin);
    salida.trim();
    return true;
  }
}

bool cifrarMensajeHaciaNodo(int indiceDestino, const MensajeMesh& msg, PaqueteMeshCifrado* pktOut) {
  memcpy(pktOut->mac_origen, miMAC, 6);
  memcpy_P(pktOut->mac_destino, TABLA_NODOS[indiceDestino].mac, 6);
  pktOut->ttl_saltos = 4;

  uint8_t claveSesionAES[32];
  for (int i = 0; i < 32; i += 4) {
    uint32_t r = RANDOM_REG32;
    memcpy(claveSesionAES + i, &r, 4);
  }
  for (int i = 0; i < 16; i += 4) {
    uint32_t r = RANDOM_REG32;
    memcpy(pktOut->iv + i, &r, 4);
  }

  br_aes_big_cbcenc_keys aesEncCtx;
  br_aes_big_cbcenc_init(&aesEncCtx, claveSesionAES, 32);
  uint8_t ivCopia[16];
  memcpy(ivCopia, pktOut->iv, 16);
  memcpy(pktOut->payload_aes256, &msg, sizeof(MensajeMesh));
  br_aes_big_cbcenc_run(&aesEncCtx, ivCopia, pktOut->payload_aes256, sizeof(MensajeMesh));

  uint8_t moduloPublicoDestino[RSA_MOD_BYTES];
  memcpy_P(moduloPublicoDestino, TABLA_NODOS[indiceDestino].rsa_pub_mod, RSA_MOD_BYTES);
  uint8_t expPublico[] = {0x01, 0x00, 0x01};

  br_rsa_public_key pubKey = {
    moduloPublicoDestino, RSA_MOD_BYTES,
    expPublico, sizeof(expPublico)
  };

  br_hmac_drbg_context rng;
  uint32_t semilla = RANDOM_REG32;
  br_hmac_drbg_init(&rng, &br_sha256_vtable, &semilla, sizeof(semilla));

  ESP.wdtFeed();
  br_rsa_oaep_encrypt enc = br_rsa_oaep_encrypt_get_default();
  size_t len = enc(&rng.vtable, &br_sha256_vtable, NULL, 0, &pubKey,
                   pktOut->clave_aes_cifrada, RSA_MOD_BYTES, claveSesionAES, 32);
  ESP.wdtFeed();

  return (len == RSA_MOD_BYTES);
}

bool descifrarMensajeRecibido(PaqueteMeshCifrado* pktIn, MensajeMesh* msgOut) {
  br_rsa_private_key miClavePrivada = {
    RSA_MOD_BYTES * 8,
    (unsigned char*)MI_RSA_P,  RSA_PRIME_BYTES,
    (unsigned char*)MI_RSA_Q,  RSA_PRIME_BYTES,
    (unsigned char*)MI_RSA_DP, RSA_PRIME_BYTES,
    (unsigned char*)MI_RSA_DQ, RSA_PRIME_BYTES,
    (unsigned char*)MI_RSA_IQ, RSA_PRIME_BYTES
  };

  size_t len = RSA_MOD_BYTES;
  ESP.wdtFeed();
  br_rsa_oaep_decrypt dec = br_rsa_oaep_decrypt_get_default();
  uint32_t exito = dec(&br_sha256_vtable, NULL, 0, &miClavePrivada, pktIn->clave_aes_cifrada, &len);
  ESP.wdtFeed();

  if (exito != 1 || len != 32) return false;

  uint8_t claveSesionAES[32];
  memcpy(claveSesionAES, pktIn->clave_aes_cifrada, 32);

  br_aes_big_cbcdec_keys aesDecCtx;
  br_aes_big_cbcdec_init(&aesDecCtx, claveSesionAES, 32);
  uint8_t ivCopia[16];
  memcpy(ivCopia, pktIn->iv, 16);
  br_aes_big_cbcdec_run(&aesDecCtx, ivCopia, pktIn->payload_aes256, sizeof(MensajeMesh));
  memcpy(msgOut, pktIn->payload_aes256, sizeof(MensajeMesh));

  return true;
}

void enviarPaqueteMesh(int indiceDestino, const MensajeMesh& msg) {
  PaqueteMeshCifrado paquete;
  if (cifrarMensajeHaciaNodo(indiceDestino, msg, &paquete)) {
    uint8_t macDestino[6];
    memcpy_P(macDestino, TABLA_NODOS[indiceDestino].mac, 6);
    esp_now_send(macDestino, (uint8_t*)&paquete, sizeof(PaqueteMeshCifrado));
  }
}

float leerHumedadSueloPct() {
  int raw = analogRead(SOIL_MOISTURE_PIN);
  long pct = map(raw, DRY_ADC, WET_ADC, 0, 100);
  return (float)constrain(pct, 0, 100);
}

void enviarTelemetriaAConcentrador() {
  MensajeMesh msg;
  memset(&msg, 0, sizeof(msg));
  msg.tipo          = MSG_TELEMETRIA;
  msg.bomba_on      = estadoBomba ? 1 : 0;
  msg.fan_on        = estadoFan ? 1 : 0;
  msg.temperatura   = 24.5f; // Reemplazar con lectura real DHT11/DHT22 de tu grupo
  msg.humedad_aire  = 58.0f; // Reemplazar con lectura real DHT11/DHT22 de tu grupo
  msg.humedad_suelo = leerHumedadSueloPct();
  msg.id_paquete    = secuenciaEnvio++;

  enviarPaqueteMesh(INDICE_CONCENTRADOR, msg);
}

void enviarAckAConcentrador(const char* commandId) {
  MensajeMesh ack;
  memset(&ack, 0, sizeof(ack));
  ack.tipo       = MSG_ACK;
  ack.bomba_on   = estadoBomba ? 1 : 0;
  ack.fan_on     = estadoFan ? 1 : 0;
  ack.id_paquete = secuenciaEnvio++;
  strncpy(ack.command_id, commandId, sizeof(ack.command_id) - 1);

  enviarPaqueteMesh(INDICE_CONCENTRADOR, ack);
}

void alRecibirDatosMesh(uint8_t *macSaltoAnterior, uint8_t *datos, uint8_t len) {
  if (len != sizeof(PaqueteMeshCifrado)) return;
  uint8_t siguiente = (colaHead + 1) % RX_QUEUE_SIZE;
  if (siguiente != colaTail) {
    memcpy(&colaRx[colaHead], datos, sizeof(PaqueteMeshCifrado));
    colaHead = siguiente;
  }
}

void procesarPaqueteEncolado(PaqueteMeshCifrado& pkt) {
  int idxOrigen = buscarNodoPorMAC(pkt.mac_origen);
  if (idxOrigen < 0) return;

  if (memcmp(pkt.mac_destino, miMAC, 6) == 0) {
    MensajeMesh msg;
    if (!descifrarMensajeRecibido(&pkt, &msg)) return;

    if (soyConcentrador) {
      const char* nombreOrigen = obtenerNombreNodo(idxOrigen);
      if (msg.tipo == MSG_TELEMETRIA) {
        Serial.printf(
          "{\\"origen\\":\\"%s\\",\\"temp\\":%.2f,\\"hum\\":%.2f,\\"suelo\\":%.2f,\\"bomba\\":%s,\\"fan\\":%s,\\"seq\\":%u}\\n",
          nombreOrigen,
          msg.temperatura,
          msg.humedad_aire,
          msg.humedad_suelo,
          msg.bomba_on ? "true" : "false",
          msg.fan_on ? "true" : "false",
          msg.id_paquete
        );
      } else if (msg.tipo == MSG_ACK) {
        Serial.printf(
          "{\\"ack\\":true,\\"origen\\":\\"%s\\",\\"commandId\\":\\"%s\\",\\"status\\":\\"ACKNOWLEDGED\\",\\"bomba\\":%s,\\"fan\\":%s}\\n",
          nombreOrigen,
          msg.command_id,
          msg.bomba_on ? "true" : "false",
          msg.fan_on ? "true" : "false"
        );
      }
    } else if (msg.tipo == MSG_COMANDO) {
      if (msg.target == TARGET_FAN) {
        estadoFan = (msg.fan_on == 1);
        digitalWrite(FAN_PIN, estadoFan ? HIGH : LOW);
      } else {
        estadoBomba = (msg.bomba_on == 1);
        digitalWrite(PUMP_PIN, estadoBomba ? HIGH : LOW);
        if (estadoBomba && msg.max_duracion > 0) {
          bombaApagadoAutoMs = millis() + ((unsigned long)msg.max_duracion * 1000UL);
        } else {
          bombaApagadoAutoMs = 0;
        }
      }
      enviarAckAConcentrador(msg.command_id);
      enviarTelemetriaAConcentrador();
    }
  } else if (pkt.ttl_saltos > 0) {
    pkt.ttl_saltos--;
    esp_now_send(pkt.mac_destino, (uint8_t*)&pkt, sizeof(PaqueteMeshCifrado));
  }
}

void procesarComandosSerialRPi5() {
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\\n') {
      bufferSerialRPi.trim();
      if (bufferSerialRPi.startsWith("{")) {
        String destino, cmdId, target, action, durStr;
        if (extraerCampoJson(bufferSerialRPi, "destino", destino) &&
            extraerCampoJson(bufferSerialRPi, "action", action)) {
          extraerCampoJson(bufferSerialRPi, "commandId", cmdId);
          extraerCampoJson(bufferSerialRPi, "target", target);
          extraerCampoJson(bufferSerialRPi, "maxDurationSeconds", durStr);

          int idxDest = buscarNodoPorNombre(destino.c_str());
          if (idxDest >= 0) {
            MensajeMesh cmd;
            memset(&cmd, 0, sizeof(cmd));
            cmd.tipo = MSG_COMANDO;
            cmd.target = (target == "fan") ? TARGET_FAN : TARGET_PUMP;
            bool encender = (action == "ON" || action == "on");
            cmd.bomba_on = (cmd.target == TARGET_PUMP && encender) ? 1 : 0;
            cmd.fan_on   = (cmd.target == TARGET_FAN && encender) ? 1 : 0;
            cmd.max_duracion = (uint16_t)(durStr.length() > 0 ? durStr.toInt() : 30);
            cmd.id_paquete = secuenciaEnvio++;
            strncpy(cmd.command_id, cmdId.c_str(), sizeof(cmd.command_id) - 1);

            enviarPaqueteMesh(idxDest, cmd);
          }
        }
      }
      bufferSerialRPi = "";
    } else if (c != '\\r') {
      bufferSerialRPi += c;
      if (bufferSerialRPi.length() > 384) bufferSerialRPi = "";
    }
  }
}

void setup() {
  pinMode(PUMP_PIN, OUTPUT);
  pinMode(FAN_PIN, OUTPUT);
  digitalWrite(PUMP_PIN, LOW);
  digitalWrite(FAN_PIN, LOW);

  Serial.begin(115200);
  delay(500);

  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  wifi_promiscuous_enable(1);
  wifi_set_channel(MESH_WIFI_CHANNEL);
  wifi_promiscuous_enable(0);

  WiFi.macAddress(miMAC);
  miIndiceNodo = buscarNodoPorMAC(miMAC);

  if (esp_now_init() != 0) {
    Serial.println("Error iniciando ESP-NOW");
    return;
  }
  esp_now_set_self_role(ESP_NOW_ROLE_COMBO);
  esp_now_register_recv_cb(alRecibirDatosMesh);

  for (int i = 0; i < TOTAL_NODOS_MESH; i++) {
    uint8_t macVecino[6];
    memcpy_P(macVecino, TABLA_NODOS[i].mac, 6);
    if (i == miIndiceNodo) {
      soyConcentrador = (pgm_read_byte(&TABLA_NODOS[i].esConcentrador) == 1);
      Serial.printf("\\n[OK] Nodo=%s | Concentrador=%d | Canal=%d\\n",
                    obtenerNombreNodo(i), soyConcentrador ? 1 : 0, wifi_get_channel());
    } else {
      esp_now_add_peer(macVecino, ESP_NOW_ROLE_COMBO, MESH_WIFI_CHANNEL, NULL, 0);
    }
  }
}

unsigned long ultimoEnvio = 0;

void loop() {
  while (colaTail != colaHead) {
    PaqueteMeshCifrado pkt = colaRx[colaTail];
    colaTail = (colaTail + 1) % RX_QUEUE_SIZE;
    procesarPaqueteEncolado(pkt);
  }

  if (soyConcentrador) {
    procesarComandosSerialRPi5();
  }

  if (!soyConcentrador && estadoBomba && bombaApagadoAutoMs > 0 && millis() >= bombaApagadoAutoMs) {
    estadoBomba = false;
    bombaApagadoAutoMs = 0;
    digitalWrite(PUMP_PIN, LOW);
    enviarTelemetriaAConcentrador();
  }

  if (!soyConcentrador && miIndiceNodo >= 0 && (millis() - ultimoEnvio >= 5000)) {
    ultimoEnvio = millis();
    enviarTelemetriaAConcentrador();
  }
}
`;
    }

    return `// ============================================================================
// SKETCH AUXILIAR: Obtener la dirección MAC de cada NodeMCU para pegarla aquí
// ============================================================================
#include <Arduino.h>
#include <ESP8266WiFi.h>

void setup() {
  Serial.begin(115200);
  delay(1000);
  WiFi.mode(WIFI_STA);

  uint8_t mac[6];
  WiFi.macAddress(mac);

  Serial.println("\\n==========================================");
  Serial.printf("COPIA ESTA MAC EN FLORASENSE: %02X:%02X:%02X:%02X:%02X:%02X\\n",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  Serial.println("==========================================");
}

void loop() {
  delay(5000);
}
`;
  }, [tabActual, nodos, nodoActivo, meshChannel, rsaBits]);

  const handleCopiar = () => {
    navigator.clipboard?.writeText(codigoGenerado).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = codigoGenerado;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1800);
  };

  const handleDescargar = () => {
    let nombreArchivo = 'directorio_publico.h';
    if (tabActual === 'privado' && nodoActivo) {
      nombreArchivo = `clave_privada_${nodoActivo.nombre.toLowerCase()}.h`;
    } else if (tabActual === 'sketch' && nodoActivo) {
      nombreArchivo = `nodo_mesh_${nodoActivo.nombre.toLowerCase()}.ino`;
    } else if (tabActual === 'macscanner') {
      nombreArchivo = 'leer_mac_nodemcu.ino';
    }
    const blob = new Blob([codigoGenerado], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nombreArchivo;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isAuthenticated === null) return <div className="min-h-screen bg-canvas" />;
  if (!isAuthenticated) return <LoginView onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col h-full relative overflow-y-auto">
        <TopographicPattern />

        <main className="flex-1 p-6 md:p-10 lg:p-12 max-w-[1440px] mx-auto w-full relative z-10">
          <header className="mb-8 flex flex-col lg:flex-row lg:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-water mb-2">
                <Radio className="w-4 h-4" />
                <span>ESP-NOW Canal {meshChannel} • BearSSL RSA + AES-256</span>
              </div>
              <h1 className="font-display text-4xl md:text-5xl text-ink mb-2">
                Calculadora Mesh + MAC (NodeMCU)
              </h1>
              <p className="text-ink-soft max-w-2xl">
                Pega las direcciones MAC físicas de tu Concentrador y de los 3 Grupos para generar sus claves RSA reales y el código Arduino bidireccional.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => cargarPlantilla(3, 'GRUPO')}
                className="px-4 py-2.5 rounded-xl bg-canvas-elevated border border-line hover:border-water text-xs font-bold uppercase tracking-wider text-ink transition-colors"
              >
                👥 Concentrador + 3 Grupos
              </button>
              <button
                onClick={() => cargarPlantilla(10, 'INVERNADERO')}
                className="px-4 py-2.5 rounded-xl bg-moss/15 border border-moss/30 hover:bg-moss/25 text-xs font-bold uppercase tracking-wider text-moss transition-colors"
              >
                🌱 Diagrama 10 Invernaderos
              </button>
            </div>
          </header>

          {cryptoError && (
            <div className="mb-6 p-4 rounded-2xl border border-warning bg-warning/10 text-warning text-sm font-medium">
              {cryptoError}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* COLUMNA IZQUIERDA */}
            <section className="lg:col-span-5 flex flex-col gap-6">
              {/* Parámetros */}
              <div className="border border-line rounded-[28px] p-6 bg-canvas-elevated shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink-soft mb-4">
                  1. Parámetros Radio Mesh y BearSSL
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs text-ink-soft mb-1.5 font-medium">
                      Canal Wi-Fi / ESP-NOW
                    </label>
                    <select
                      value={meshChannel}
                      onChange={(e) => setMeshChannel(e.target.value)}
                      className="w-full bg-canvas border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-water"
                    >
                      <option value="1">Canal 1 (2412 MHz)</option>
                      <option value="6">Canal 6 (2437 MHz - Recomendado)</option>
                      <option value="11">Canal 11 (2462 MHz)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-soft mb-1.5 font-medium">
                      Tamaño Clave RSA
                    </label>
                    <select
                      value={rsaBits}
                      onChange={(e) => handleRsaBitsChange(Number(e.target.value))}
                      className="w-full bg-canvas border border-line rounded-xl px-3 py-2.5 text-sm text-ink focus:outline-none focus:border-water"
                    >
                      <option value={1024}>RSA-1024 (Cabe en ESP-NOW)</option>
                      <option value={2048}>RSA-2048 (Requiere fragmentar)</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-line text-center">
                  <div className="bg-canvas rounded-2xl p-2.5 border border-line">
                    <span className="block text-[10px] uppercase tracking-wider text-ink-soft">Nodos</span>
                    <span className="font-mono-data text-base font-bold text-ink">{nodos.length}</span>
                  </div>
                  <div className="bg-canvas rounded-2xl p-2.5 border border-line">
                    <span className="block text-[10px] uppercase tracking-wider text-ink-soft">Flash</span>
                    <span className="font-mono-data text-base font-bold text-water">
                      {totalFlash > 1024 ? `${(totalFlash / 1024).toFixed(1)} KB` : `${totalFlash} B`}
                    </span>
                  </div>
                  <div className="bg-canvas rounded-2xl p-2.5 border border-line">
                    <span className="block text-[10px] uppercase tracking-wider text-ink-soft">Trama</span>
                    <span
                      className={`font-mono-data text-base font-bold ${
                        tamPaquete <= 250 ? 'text-moss' : 'text-warning'
                      }`}
                    >
                      {tamPaquete}/250 B
                    </span>
                  </div>
                </div>
              </div>

              {/* Lista editable de MACs */}
              <div className="border border-line rounded-[28px] p-6 bg-canvas-elevated shadow-sm">
                <div className="flex items-center justify-between gap-2 mb-4">
                  <h2 className="text-xs font-bold uppercase tracking-widest text-ink-soft">
                    2. Nodos y MACs ({nodos.length})
                  </h2>
                  <button
                    onClick={() => recalcularTodasLasClaves()}
                    disabled={generando}
                    className="px-3.5 py-2 rounded-xl bg-ink text-canvas text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 hover:bg-ink/90 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${generando ? 'animate-spin' : ''}`} />
                    {generando ? 'Generando...' : 'Regenerar Claves'}
                  </button>
                </div>

                <p className="text-xs text-ink-soft mb-3">
                  Pega la MAC física de cada ESP8266 directamente en el campo <strong>MAC</strong> de su tarjeta:
                </p>

                <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                  {nodos.map((nodo, idx) => {
                    const valida = esMacValida(nodo.mac);
                    const fp = nodo.rsa
                      ? Array.from(nodo.rsa.n.slice(0, 4))
                          .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
                          .join('') + '...'
                      : '...';
                    const isSelected = nodo.id === nodoActivo?.id;

                    return (
                      <div
                        key={nodo.id}
                        className={`rounded-2xl p-3.5 border transition-colors bg-canvas ${
                          isSelected ? 'border-water' : 'border-line'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono-data text-xs font-bold text-ink truncate">
                              {idx + 1}. {nodo.nombre}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                                nodo.rol === 'CONCENTRADOR'
                                  ? 'bg-water/15 text-water'
                                  : 'bg-moss/15 text-moss'
                              }`}
                            >
                              {nodo.rol === 'CONCENTRADOR' ? 'CONCENTRADOR' : 'GRUPO'}
                            </span>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                setSelectedNodoId(nodo.id);
                                setTabActual('privado');
                              }}
                              title="Ver clave privada de este nodo"
                              className="p-1.5 rounded-lg border border-line hover:bg-line text-ink-soft hover:text-ink"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </button>
                            {nodos.length > 2 && (
                              <button
                                onClick={() => handleEliminarNodo(nodo.id)}
                                title="Eliminar nodo"
                                className="p-1.5 rounded-lg border border-line hover:bg-warning/10 text-ink-soft hover:text-warning"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 flex-1">
                            <span className="font-mono-data text-xs text-ink-soft">MAC:</span>
                            <input
                              type="text"
                              value={nodo.mac}
                              maxLength={17}
                              placeholder="AA:BB:CC:DD:EE:FF"
                              onChange={(e) => handleActualizarMac(nodo.id, e.target.value)}
                              className={`bg-canvas-elevated border rounded-lg px-2.5 py-1 text-xs font-mono-data w-44 focus:outline-none ${
                                valida
                                  ? 'border-moss/50 text-ink focus:border-water'
                                  : 'border-warning text-warning'
                              }`}
                            />
                          </div>
                          <span className="text-[11px] font-mono-data text-ink-soft hidden sm:inline">
                            RSA: 0x{fp}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Agregar nodo manual */}
              <div className="border border-line rounded-[28px] p-6 bg-canvas-elevated shadow-sm">
                <h2 className="text-xs font-bold uppercase tracking-widest text-ink-soft mb-4">
                  3. Añadir Otro NodeMCU por MAC
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                  <input
                    type="text"
                    value={inputNombre}
                    onChange={(e) => setInputNombre(e.target.value)}
                    placeholder="Ej. GRUPO_4"
                    className="bg-canvas border border-line rounded-xl px-3 py-2 text-sm font-mono-data text-ink focus:outline-none focus:border-water"
                  />
                  <select
                    value={inputRol}
                    onChange={(e) => setInputRol(e.target.value as 'CONCENTRADOR' | 'INVERNADERO')}
                    className="bg-canvas border border-line rounded-xl px-3 py-2 text-sm text-ink focus:outline-none focus:border-water"
                  >
                    <option value="INVERNADERO">Nodo Grupo (Sensor/Bomba)</option>
                    <option value="CONCENTRADOR">Concentrador Principal</option>
                  </select>
                </div>

                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    maxLength={17}
                    value={inputMac}
                    onChange={(e) => setInputMac(e.target.value.toUpperCase())}
                    placeholder="24:6F:28:AA:BB:04"
                    className="flex-1 bg-canvas border border-line rounded-xl px-3 py-2 text-sm font-mono-data text-ink focus:outline-none focus:border-water"
                  />
                  <button
                    onClick={() => setInputMac(crearMacEspressif(nodos.length + 1))}
                    title="Generar MAC aleatoria Espressif"
                    className="px-3 py-2 rounded-xl border border-line bg-canvas hover:bg-line text-xs font-bold text-ink flex items-center gap-1"
                  >
                    <Dice5 className="w-4 h-4" /> Azar
                  </button>
                </div>

                {errorInput && <p className="text-xs text-warning mb-3">{errorInput}</p>}

                <button
                  onClick={handleAgregarNodo}
                  disabled={generando}
                  className="w-full py-2.5 rounded-xl bg-water text-canvas font-bold text-xs uppercase tracking-widest hover:bg-water-soft flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" /> Añadir Nodo a la Malla
                </button>
              </div>
            </section>

            {/* COLUMNA DERECHA: VISOR DE CÓDIGO */}
            <section className="lg:col-span-7 flex flex-col border border-line rounded-[28px] bg-canvas-elevated shadow-sm overflow-hidden min-h-[680px]">
              <div className="border-b border-line bg-canvas px-4 pt-3 flex flex-wrap gap-1">
                {(
                  [
                    { id: 'publico', label: '1. directorio_publico.h' },
                    { id: 'privado', label: '2. clave_privada_nodo.h' },
                    { id: 'sketch', label: '3. Sketch Arduino (.ino)' },
                    { id: 'macscanner', label: '4. Leer MAC' },
                  ] as { id: TabType; label: string }[]
                ).map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTabActual(t.id)}
                    className={`px-4 py-2.5 text-xs font-bold rounded-t-xl border-t border-x transition-colors ${
                      tabActual === t.id
                        ? 'bg-[#0b1120] text-emerald-400 border-line'
                        : 'border-transparent text-ink-soft hover:text-ink'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="bg-canvas-elevated border-b border-line px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                {(tabActual === 'privado' || tabActual === 'sketch') && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-ink-soft">Compilar para:</span>
                    <select
                      value={nodoActivo?.id || ''}
                      onChange={(e) => setSelectedNodoId(e.target.value)}
                      className="bg-canvas border border-line rounded-lg px-2.5 py-1.5 text-xs font-mono-data text-ink focus:outline-none focus:border-water"
                    >
                      {nodos.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.nombre} ({n.mac})
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="flex items-center gap-2 ml-auto">
                  <button
                    onClick={handleCopiar}
                    className="px-3.5 py-2 rounded-xl border border-line bg-canvas hover:bg-line text-xs font-bold text-ink flex items-center gap-1.5"
                  >
                    {copiado ? <Check className="w-3.5 h-3.5 text-moss" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiado ? '¡Copiado!' : 'Copiar'}
                  </button>
                  <button
                    onClick={handleDescargar}
                    className="px-3.5 py-2 rounded-xl bg-moss text-canvas text-xs font-bold flex items-center gap-1.5 hover:opacity-90"
                  >
                    <Download className="w-3.5 h-3.5" /> Descargar
                  </button>
                </div>
              </div>

              <div className="flex-1 bg-[#0b1120] overflow-auto p-5">
                <pre className="text-xs leading-relaxed font-mono-data text-slate-200 select-all whitespace-pre">
                  <code>{codigoGenerado}</code>
                </pre>
              </div>

              <div className="bg-canvas border-t border-line px-4 py-3 text-xs text-ink-soft flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-moss" />
                  <span>
                    Cifrado híbrido activo: <strong>RSA-OAEP (SHA-256)</strong> +{' '}
                    <strong>AES-256-CBC</strong> en BearSSL (ESP8266).
                  </span>
                </div>
                <span className="font-mono-data">Canal {meshChannel} • USB Serial 115200</span>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
