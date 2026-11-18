"use client";

import React, { useEffect, useState } from 'react';
import { Lock, ShieldCheck, Radio, Pause, Play, ArrowRight, KeyRound, Cpu, Cloud } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { Sidebar } from './Sidebar';
import { LoginView } from './LoginView';
import { TopographicPattern } from '../ui/TopographicPattern';

type PacketTrace = {
  id: string;
  receivedAt: string;
  gatewayId: string;
  encrypted: boolean;
  algorithm: string;
  cloudEnvelope: {
    iv: string | null;
    encryptedKey: string | null;
    payload: string | null;
    payloadBytes: number;
  };
  nodes: Array<{
    deviceKey: string;
    mac: string | null;
    meshIv: string | null;
    meshRsa: string | null;
    meshCipher: string | null;
    temperatureC: number | null;
    airHumidityPct: number | null;
    soilMoisturePct: number | null;
    pumpOn: boolean;
    fanOn: boolean;
  }>;
};

type GatewayStatus = {
  connected: boolean;
  gatewayId: string | null;
  lastSyncAt: string | null;
  totalEncryptedSyncs: number;
  lastNodesCount: number;
  encryption: string;
};

export function EncryptionInspectorView() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [packets, setPackets] = useState<PacketTrace[]>([]);
  const [gwStatus, setGwStatus] = useState<GatewayStatus | null>(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    try {
      setIsAuthenticated(localStorage.getItem('fs_auth_token') === 'true');
    } catch {
      setIsAuthenticated(false);
    }
  }, []);

  const fetchPackets = async () => {
    if (!isAuthenticated) return;
    try {
      const [pktRes, statusRes] = await Promise.all([
        apiFetch(`/api/gateway/packets?_t=${Date.now()}`),
        apiFetch(`/api/gateway/status?_t=${Date.now()}`),
      ]);
      if (pktRes.ok) {
        setPackets(await pktRes.json());
      }
      if (statusRes.ok) {
        setGwStatus(await statusRes.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated || paused) return;
    fetchPackets();
    const timer = setInterval(fetchPackets, 2500);
    return () => clearInterval(timer);
  }, [isAuthenticated, paused]);

  if (isAuthenticated === null) return <div className="min-h-screen bg-canvas" />;
  if (!isAuthenticated) {
    return (
      <LoginView
        onLogin={() => {
          localStorage.setItem('fs_auth_token', 'true');
          setIsAuthenticated(true);
        }}
      />
    );
  }

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full relative overflow-y-auto">
        <TopographicPattern />

        <main className="flex-1 p-6 md:p-10 lg:p-12 max-w-[1400px] mx-auto w-full relative z-10">
          <header className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-moss mb-2">
                <Lock className="w-4 h-4" /> Inspector Criptográfico en Vivo
              </div>
              <h1 className="font-display text-4xl md:text-5xl text-ink">
                Tráfico Cifrado de Extremo a Extremo
              </h1>
              <p className="text-ink-soft text-sm mt-2 max-w-3xl">
                Visualiza en tiempo real los bytes cifrados reales capturados antes del descifrado tanto en la malla
                <strong> ESP-NOW Canal 6</strong> (BearSSL RSA-1024 + AES-256) como en el túnel
                <strong> Raspberry Pi 5 → AWS EC2</strong> (RSA-2048 OAEP + AES-256-CBC).
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="px-4 py-2 rounded-full border border-line bg-canvas-elevated text-xs font-mono-data flex items-center gap-2">
                <Radio
                  className={`w-3.5 h-3.5 ${gwStatus?.connected ? 'text-moss animate-pulse' : 'text-ink-soft'}`}
                />
                <span>
                  {gwStatus?.connected ? 'RPi 5 CONECTADO' : 'EN ESPERA'} •{' '}
                  {gwStatus?.totalEncryptedSyncs ?? 0} syncs
                </span>
              </div>

              <button
                onClick={() => setPaused((p) => !p)}
                className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-2 border transition-colors ${
                  paused
                    ? 'bg-moss text-canvas border-moss'
                    : 'bg-canvas-elevated text-ink border-line hover:border-ink-soft'
                }`}
              >
                {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {paused ? 'Reanudar captura' : 'Pausar captura'}
              </button>
            </div>
          </header>

          {loading && packets.length === 0 ? (
            <div className="border border-line rounded-3xl p-12 bg-canvas-elevated text-center text-ink-soft animate-pulse font-mono-data">
              Esperando paquetes cifrados desde Raspberry Pi 5...
            </div>
          ) : packets.length === 0 ? (
            <div className="border border-line rounded-3xl p-12 bg-canvas-elevated text-center">
              <ShieldCheck className="w-10 h-10 text-moss mx-auto mb-3" />
              <h2 className="font-display text-2xl text-ink mb-2">Sin capturas recientes en memoria</h2>
              <p className="text-sm text-ink-soft max-w-lg mx-auto">
                En cuanto la Raspberry Pi 5 envíe el siguiente lote cada 5 segundos hacia{' '}
                <code>/api/gateway/sync</code>, aparecerán aquí los paquetes cifrados reales antes y después de
                descifrarlos.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {packets.map((pkt) => (
                <div
                  key={pkt.id}
                  className="border border-line rounded-[28px] p-6 bg-canvas-elevated shadow-sm space-y-5"
                >
                  {/* Encabezado del lote */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-line/70">
                    <div className="flex items-center gap-3">
                      <span className="px-3 py-1 rounded-full bg-moss/15 text-moss text-xs font-mono-data font-bold flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5" /> {pkt.algorithm}
                      </span>
                      <span className="text-xs font-mono-data text-ink-soft">
                        Gateway: <strong className="text-ink">{pkt.gatewayId}</strong>
                      </span>
                    </div>
                    <div className="text-xs font-mono-data text-ink-soft">
                      {new Date(pkt.receivedAt).toLocaleTimeString('es-CL', {
                        timeZone: 'America/Santiago',
                        hour12: false,
                      })}{' '}
                      • {pkt.cloudEnvelope.payloadBytes} bytes cifrados
                    </div>
                  </div>

                  {/* Tramo 2: RPi 5 -> AWS */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-line bg-canvas p-4 space-y-2">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-water">
                        <Cloud className="w-4 h-4" /> Tramo Internet (RPi 5 → AWS EC2) — Sobre Cifrado Recibido
                      </div>
                      <div className="text-[11px] font-mono-data space-y-1.5 text-ink-soft break-all">
                        <div>
                          <span className="text-ink font-semibold">iv (Base64): </span>
                          {pkt.cloudEnvelope.iv || 'N/A'}
                        </div>
                        <div>
                          <span className="text-ink font-semibold">encryptedKey RSA-2048 (Base64): </span>
                          {pkt.cloudEnvelope.encryptedKey
                            ? `${pkt.cloudEnvelope.encryptedKey.slice(0, 72)}...`
                            : 'N/A'}
                        </div>
                        <div>
                          <span className="text-ink font-semibold">payload AES-256-CBC (Base64): </span>
                          <span className="text-warning">
                            {pkt.cloudEnvelope.payload
                              ? `${pkt.cloudEnvelope.payload.slice(0, 140)}...`
                              : 'N/A'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Nodos descifrados + Tramo 1 Mesh ESP-NOW */}
                    <div className="rounded-2xl border border-line bg-canvas p-4 space-y-3">
                      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-moss">
                        <Cpu className="w-4 h-4" /> Tramo Aire ESP-NOW (Nodo → Concentrador) & Descifrado RDS
                      </div>
                      {pkt.nodes.map((node, nIdx) => (
                        <div
                          key={nIdx}
                          className="rounded-xl bg-canvas-elevated border border-line/80 p-3 space-y-2"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono-data">
                            <span className="font-bold text-ink">
                              {node.deviceKey} {node.mac ? `• MAC ${node.mac}` : ''}
                            </span>
                            <span className="text-moss font-semibold flex items-center gap-1">
                              <ArrowRight className="w-3 h-3" />
                              T={node.temperatureC ?? '--'}°C | Aire={node.airHumidityPct ?? '--'}% | Suelo=
                              {node.soilMoisturePct ?? '--'}% | Bomba={node.pumpOn ? 'ON' : 'OFF'}
                            </span>
                          </div>

                          {node.meshCipher ? (
                            <div className="text-[11px] font-mono-data text-ink-soft break-all space-y-1 pt-1 border-t border-line/60">
                              <div className="flex items-center gap-1 text-ink font-semibold">
                                <KeyRound className="w-3 h-3 text-water" /> Cifrado ESP-NOW (Hex antes de
                                descifrar):
                              </div>
                              <div>IV: {node.meshIv}</div>
                              <div>RSA-1024 Key: {node.meshRsa}...</div>
                              <div className="text-warning">AES-256: {node.meshCipher}...</div>
                            </div>
                          ) : (
                            <div className="text-[11px] font-mono-data text-ink-soft italic">
                              (Traza hex ESP-NOW pendiente de actualizar Concentrador.ino)
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
