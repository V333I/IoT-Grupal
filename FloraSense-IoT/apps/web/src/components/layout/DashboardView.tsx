"use client";
import { apiFetch } from '../../lib/api';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Droplets, Thermometer, Wind, Power, ShieldCheck, Radio, Loader2 } from 'lucide-react';
import { HealthStrip } from '../domain/HealthStrip';
import { SoilMoistureInstrument } from '../domain/SoilMoistureInstrument';
import { PumpControl } from '../domain/PumpControl';
import { FanControl } from '../domain/FanControl';
import { EnvironmentalReading } from '../domain/EnvironmentalReading';
import { Sidebar } from './Sidebar';
import { TopographicPattern } from '../ui/TopographicPattern';
import { HistoryChart } from '../charts/HistoryChart';
import { AirHistoryChart } from '../charts/AirHistoryChart';
import { LoginView } from './LoginView';

const safeGetItem = (k: string) => {
  try {
    return typeof window !== 'undefined' ? window.localStorage.getItem(k) : null;
  } catch {
    return null;
  }
};
const safeSetItem = (k: string, v: string) => {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(k, v);
  } catch {}
};

type LastEvent = {
  startedAt: string;
  durationSeconds: number | null;
};

type DeviceOverview = {
  id: string;
  deviceKey: string;
  name: string;
  locationLabel?: string | null;
  status: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';
  mode: 'AUTO' | 'MANUAL';
  lastSeenAt: string | null;
  pendingCommands: number;
  lastTelemetry: {
    temperatureC: number | null;
    airHumidityPct: number | null;
    soilMoisturePct: number | null;
    pumpOn: boolean;
    fanOn: boolean;
    timestamp: string;
  } | null;
  lastEvent: LastEvent | null;
};

type GatewayStatus = {
  connected: boolean;
  gatewayId: string | null;
  lastSyncAt: string | null;
  totalEncryptedSyncs: number;
  lastNodesCount: number;
  encryption: string;
};

function formatAge(timestamp?: string | null) {
  if (!timestamp) return 'Sin datos';
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (diffSec < 60) return `hace ${diffSec} s`;
  if (diffSec < 3600) return `hace ${Math.floor(diffSec / 60)} min`;
  return `hace ${Math.floor(diffSec / 3600)} h`;
}

export function DashboardView() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<DeviceOverview[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingPumpId, setTogglingPumpId] = useState<string | null>(null);
  const [togglingModeId, setTogglingModeId] = useState<string | null>(null);
  const manualSelectRef = useRef(false);

  useEffect(() => {
    const isAuth = safeGetItem('fs_auth_token') === 'true';
    setIsAuthenticated(isAuth);
    const saved = safeGetItem('fs_active_device');
    if (saved) setSelectedId(saved);
  }, []);

  const handleLogin = () => {
    safeSetItem('fs_auth_token', 'true');
    setIsAuthenticated(true);
  };

  const fetchOverview = async () => {
    if (!isAuthenticated) return;
    try {
      const [overviewRes, gwRes] = await Promise.all([
        apiFetch(`/api/devices/overview?_t=${Date.now()}`),
        apiFetch(`/api/gateway/status?_t=${Date.now()}`),
      ]);

      if (overviewRes.ok) {
        const list: DeviceOverview[] = await overviewRes.json();
        setDevices(list);

        if (list.length > 0) {
          const saved = safeGetItem('fs_active_device');
          const savedDevice = saved ? list.find((d) => d.id === saved) : undefined;
          const onlineDevice = list.find((d) => d.status === 'ONLINE');

          let nextId = savedDevice ? savedDevice.id : list[0].id;
          if (!manualSelectRef.current && (!savedDevice || savedDevice.status !== 'ONLINE') && onlineDevice) {
            nextId = onlineDevice.id;
          }

          setSelectedId(nextId);
          if (nextId !== saved) safeSetItem('fs_active_device', nextId);
        }
      }

      if (gwRes.ok) {
        setGatewayStatus(await gwRes.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchOverview();
      const interval = setInterval(fetchOverview, 2000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated]);

  const handleSelectDevice = (id: string) => {
    manualSelectRef.current = true;
    setSelectedId(id);
    safeSetItem('fs_active_device', id);
  };

  const handleQuickPumpToggle = async (
    e: React.MouseEvent,
    device: DeviceOverview,
  ) => {
    e.stopPropagation();
    const action = device.lastTelemetry?.pumpOn ? 'off' : 'on';
    setTogglingPumpId(device.id);
    try {
      await apiFetch(`/api/devices/${device.id}/pump/${action}`, {
        method: 'POST',
      });
      setTimeout(fetchOverview, 400);
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingPumpId(null);
    }
  };

  const handleToggleMode = async (device: DeviceOverview) => {
    const nextMode = device.mode === 'AUTO' ? 'MANUAL' : 'AUTO';
    setTogglingModeId(device.id);
    try {
      await apiFetch(`/api/devices/${device.id}/mode`, {
        method: 'PUT',
        body: JSON.stringify({ mode: nextMode }),
      });
      fetchOverview();
    } catch (err) {
      console.error(err);
    } finally {
      setTogglingModeId(null);
    }
  };

  if (isAuthenticated === null) {
    return <div className="min-h-screen bg-canvas" />;
  }

  if (!isAuthenticated) {
    return <LoginView onLogin={handleLogin} />;
  }

  if (loading && devices.length === 0) {
    return (
      <div className="flex h-screen bg-canvas items-center justify-center">
        <div className="text-ink-soft animate-pulse font-mono-data tracking-widest uppercase">
          Cargando instrumentos de los grupos...
        </div>
      </div>
    );
  }

  if (devices.length === 0) {
    return (
      <div className="flex h-screen bg-canvas items-center justify-center">
        <div className="text-center">
          <h2 className="font-display text-4xl mb-4 text-ink">Aún no hay grupos conectados</h2>
          <p className="text-ink-soft">
            Inicia el Gateway Raspberry Pi 5 o registra un nodo ESP8266 para comenzar a recibir datos.
          </p>
        </div>
      </div>
    );
  }

  const data = devices.find((d) => d.id === selectedId) || devices[0];
  const { lastTelemetry, lastEvent } = data;
  const lastReadingText = formatAge(lastTelemetry?.timestamp);

  let soilStatus: 'SECO' | 'OPTIMO' | 'SATURADO' | 'OFFLINE' = 'OFFLINE';
  if (lastTelemetry && lastTelemetry.soilMoisturePct !== null) {
    if (lastTelemetry.soilMoisturePct < 40) soilStatus = 'SECO';
    else if (lastTelemetry.soilMoisturePct > 70) soilStatus = 'SATURADO';
    else soilStatus = 'OPTIMO';
  }

  const isCritical =
    lastTelemetry && lastTelemetry.soilMoisturePct !== null && lastTelemetry.soilMoisturePct >= 100;

  let lastCycleText = 'Nunca';
  if (lastEvent) {
    const dt = new Date(lastEvent.startedAt);
    const timeStr = dt.toLocaleTimeString('es-CL', {
      timeZone: 'America/Santiago',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    lastCycleText = lastEvent.durationSeconds
      ? `${timeStr} • ${lastEvent.durationSeconds}s`
      : `${timeStr} • En curso...`;
  }

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col h-full relative overflow-y-auto">
        <TopographicPattern />

        <HealthStrip
          deviceId={`${data.deviceKey} (${data.id.substring(0, 6)})`}
          status={data.status === 'ONLINE' ? 'ONLINE' : 'OFFLINE'}
          lastReading={lastReadingText}
          pumpStatus={lastTelemetry?.pumpOn ? 'ON' : 'OFF'}
        />

        <main className="flex-1 p-6 md:p-10 lg:p-14 max-w-[1400px] mx-auto w-full relative z-10">
          {/* --- SECCIÓN MULTI-GRUPO: TODOS LOS GRUPOS SIMULTÁNEOS --- */}
          <section className="mb-12">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
              <div>
                <h2 className="font-display text-3xl md:text-4xl text-ink">
                  Monitorización Multi-Grupo ({devices.length})
                </h2>
                <p className="text-sm text-ink-soft mt-1">
                  Datos en vivo desde la malla ESP8266 (Canal 6) → Concentrador → Raspberry Pi 5 → AWS
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2 px-3.5 py-2 rounded-full border border-line bg-canvas-elevated text-xs font-mono-data">
                  <Radio
                    className={`w-3.5 h-3.5 ${
                      gatewayStatus?.connected ? 'text-moss animate-pulse' : 'text-ink-soft'
                    }`}
                  />
                  <span className="text-ink font-semibold">
                    RPi 5 Gateway: {gatewayStatus?.connected ? 'CONECTADO' : 'EN ESPERA'}
                  </span>
                  {gatewayStatus?.lastSyncAt && (
                    <span className="text-ink-soft">• {formatAge(gatewayStatus.lastSyncAt)}</span>
                  )}
                </div>
                <div
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-moss/30 bg-moss/10 text-moss text-xs font-mono-data"
                  title={gatewayStatus?.encryption || 'RSA-OAEP + AES-256-CBC'}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>RSA + AES-256 ({gatewayStatus?.totalEncryptedSyncs ?? 0})</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {devices.map((dev) => {
                const isSelected = dev.id === data.id;
                const tel = dev.lastTelemetry;
                const soilPct = tel?.soilMoisturePct ?? 0;
                const pumpOn = Boolean(tel?.pumpOn);
                const isToggling = togglingPumpId === dev.id;

                return (
                  <div
                    key={dev.id}
                    onClick={() => handleSelectDevice(dev.id)}
                    className={`cursor-pointer rounded-[28px] p-6 border transition-all bg-canvas-elevated shadow-sm flex flex-col justify-between gap-5 ${
                      isSelected
                        ? 'border-water ring-2 ring-water/25 shadow-md'
                        : 'border-line hover:border-ink-soft/40'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                                dev.status === 'ONLINE' ? 'bg-moss animate-pulse' : 'bg-warning'
                              }`}
                            />
                            <h3 className="font-display text-2xl text-ink truncate">{dev.name}</h3>
                          </div>
                          <div className="text-[11px] font-mono-data text-ink-soft mt-1 uppercase tracking-wider flex items-center gap-2">
                            <span>{dev.deviceKey}</span>
                            <span>•</span>
                            <span>{formatAge(tel?.timestamp)}</span>
                          </div>
                        </div>

                        <div className="flex flex-col items-end gap-1 shrink-0">
                          <span
                            className={`text-[10px] font-mono-data px-2.5 py-0.5 rounded-full uppercase font-bold ${
                              dev.mode === 'AUTO'
                                ? 'bg-moss/15 text-moss'
                                : 'bg-line text-ink-soft'
                            }`}
                          >
                            {dev.mode}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] font-bold uppercase tracking-widest text-water">
                              Seleccionado
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Humedad de Tierra */}
                      <div className="mt-4">
                        <div className="flex justify-between items-baseline text-xs mb-1.5">
                          <span className="uppercase tracking-widest font-bold text-ink-soft">
                            Humedad Tierra
                          </span>
                          <span className="font-mono-data text-lg font-bold text-ink">
                            {tel?.soilMoisturePct !== null && tel?.soilMoisturePct !== undefined
                              ? `${tel.soilMoisturePct.toFixed(1)}%`
                              : '--'}
                          </span>
                        </div>
                        <div className="w-full h-2.5 rounded-full bg-line overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              soilPct < 40
                                ? 'bg-warning'
                                : soilPct > 70
                                  ? 'bg-water'
                                  : 'bg-moss'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, soilPct))}%` }}
                          />
                        </div>
                      </div>

                      {/* Temperatura y Humedad Aire */}
                      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-line/70 text-center">
                        <div className="bg-canvas rounded-2xl p-2.5">
                          <div className="flex items-center justify-center gap-1 text-[10px] text-ink-soft uppercase font-bold">
                            <Thermometer className="w-3 h-3 text-warning" /> Temp
                          </div>
                          <div className="font-mono-data text-sm font-bold text-ink mt-0.5">
                            {tel?.temperatureC !== null && tel?.temperatureC !== undefined
                              ? `${tel.temperatureC.toFixed(1)}°C`
                              : '--'}
                          </div>
                        </div>
                        <div className="bg-canvas rounded-2xl p-2.5">
                          <div className="flex items-center justify-center gap-1 text-[10px] text-ink-soft uppercase font-bold">
                            <Wind className="w-3 h-3 text-moss" /> Aire
                          </div>
                          <div className="font-mono-data text-sm font-bold text-ink mt-0.5">
                            {tel?.airHumidityPct !== null && tel?.airHumidityPct !== undefined
                              ? `${tel.airHumidityPct.toFixed(0)}%`
                              : '--'}
                          </div>
                        </div>
                        <div className="bg-canvas rounded-2xl p-2.5">
                          <div className="flex items-center justify-center gap-1 text-[10px] text-ink-soft uppercase font-bold">
                            <Droplets className="w-3 h-3 text-water" /> Bomba
                          </div>
                          <div
                            className={`font-mono-data text-sm font-bold mt-0.5 ${
                              pumpOn ? 'text-water' : 'text-ink-soft'
                            }`}
                          >
                            {pumpOn ? 'ON' : 'OFF'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Control bidireccional rápido de bomba por grupo */}
                    <button
                      onClick={(e) => handleQuickPumpToggle(e, dev)}
                      disabled={isToggling}
                      className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold uppercase tracking-widest flex items-center justify-center gap-2 transition-colors ${
                        pumpOn
                          ? 'bg-warning/15 text-warning hover:bg-warning/25'
                          : 'bg-water text-canvas hover:bg-water-soft'
                      }`}
                    >
                      {isToggling ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Power className="w-3.5 h-3.5" />
                      )}
                      {pumpOn ? 'Apagar Bomba' : 'Encender Bomba'}
                      {dev.pendingCommands > 0 && (
                        <span className="ml-1 text-[10px] opacity-80">
                          ({dev.pendingCommands} env.)
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          {/* --- DETALLE DEL GRUPO SELECCIONADO --- */}
          <header className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-4 pt-6 border-t border-line">
            <div>
              <div className="text-xs font-bold uppercase tracking-widest text-water mb-1">
                Detalle del Nodo Seleccionado • {data.deviceKey}
              </div>
              <h1 className="font-display text-5xl text-ink mb-2">{data.name}</h1>
              <div className="flex flex-wrap items-center gap-3 text-ink-soft text-sm font-mono-data uppercase tracking-wider">
                <button
                  onClick={() => handleToggleMode(data)}
                  disabled={togglingModeId === data.id}
                  className={`px-3 py-1 rounded-full text-xs font-bold transition-colors ${
                    data.mode === 'AUTO'
                      ? 'bg-moss/15 text-moss hover:bg-moss/25'
                      : 'bg-line text-ink hover:bg-line/80'
                  }`}
                  title="Haz clic para alternar entre modo AUTO y MANUAL"
                >
                  Modo {data.mode} (cambiar)
                </button>
                <span>•</span>
                <span>Sync: {lastReadingText}</span>
              </div>
            </div>
            <div className="text-right hidden md:block">
              <div className="text-3xl font-display text-ink">Hoy</div>
              <div className="text-sm text-ink-soft">Riego Inteligente</div>
            </div>
          </header>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 mb-8">
            {/* --- FILA 1: SUELO Y RIEGO --- */}
            <div className="col-span-1 lg:col-span-8 flex flex-col">
              <div className="border border-line rounded-[32px] p-8 lg:p-12 bg-canvas-elevated shadow-sm relative overflow-hidden h-full flex flex-col">
                <div className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-moss/5 to-transparent pointer-events-none" />
                <div className="relative z-10 flex justify-between items-start mb-12">
                  <h2 className="font-display text-4xl text-ink">Estado del suelo</h2>
                  <div className="text-right">
                    <div className="text-xs text-ink-soft uppercase tracking-widest font-bold mb-1">
                      Tendencia
                    </div>
                    <div className="font-mono-data text-moss font-medium">Estable</div>
                  </div>
                </div>

                <div className="mb-12 relative z-10">
                  {lastTelemetry && lastTelemetry.soilMoisturePct !== null ? (
                    <div className="w-full">
                      <SoilMoistureInstrument
                        valuePct={lastTelemetry.soilMoisturePct}
                        status={soilStatus}
                      />
                    </div>
                  ) : (
                    <div className="py-8 text-center text-ink-soft">Esperando lectura...</div>
                  )}
                </div>

                <div className="flex-grow min-h-[200px] relative z-10 flex flex-col">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-sm font-bold uppercase tracking-widest text-ink-soft">
                      Historial de Humedad
                    </h3>
                    <Link href="/history">
                      <button className="text-xs font-bold uppercase tracking-widest text-water hover:text-water-soft transition-colors">
                        Ver reporte
                      </button>
                    </Link>
                  </div>
                  <div className="flex-grow">
                    <HistoryChart
                      currentMoisture={lastTelemetry?.soilMoisturePct ?? undefined}
                      deviceId={data.id}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-1 lg:col-span-4 flex flex-col gap-8">
              <PumpControl
                deviceId={data.id}
                pumpOn={lastTelemetry?.pumpOn || false}
                lastCycle={lastCycleText}
                onRefresh={fetchOverview}
              />

              <div
                className={`border rounded-[32px] p-8 relative overflow-hidden transition-colors duration-500 flex-grow ${
                  isCritical
                    ? 'bg-warning border-warning text-canvas'
                    : 'bg-ink border-line text-canvas'
                }`}
              >
                <TopographicPattern className="opacity-10 text-moss-bright" />
                <div className="relative z-10">
                  <h3
                    className={`text-xs font-bold tracking-widest uppercase mb-4 ${
                      isCritical ? 'text-canvas/80' : 'text-moss-bright'
                    }`}
                  >
                    Análisis Automático
                  </h3>
                  <p className="font-display text-2xl leading-snug">
                    {isCritical
                      ? '"Los niveles muy altos de humedad pueden ser dañinos. Se ha forzado el apagado por seguridad."'
                      : lastTelemetry &&
                          lastTelemetry.soilMoisturePct !== null &&
                          lastTelemetry.soilMoisturePct < 40
                        ? '"Nivel de humedad crítico. Requiere ciclo de riego pronto."'
                        : '"El suelo se mantiene dentro del rango objetivo. No se requiere riego inmediato."'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* --- FILA 2: CLIMA Y VENTILACION --- */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="col-span-1 lg:col-span-8 flex flex-col">
              <div className="border border-line rounded-[32px] p-8 bg-canvas-elevated shadow-sm h-full flex flex-col">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="font-display text-3xl text-ink">Historial de Humedad de Aire</h3>
                  <Link href="/history">
                    <button className="text-xs font-bold uppercase tracking-widest text-water hover:text-water-soft transition-colors">
                      Ver reporte
                    </button>
                  </Link>
                </div>
                <div className="flex-grow min-h-[300px]">
                  <AirHistoryChart
                    currentHumidity={lastTelemetry?.airHumidityPct ?? undefined}
                    deviceId={data.id}
                  />
                </div>
              </div>
            </div>

            <div className="col-span-1 lg:col-span-4 flex flex-col gap-8">
              <EnvironmentalReading
                temp={lastTelemetry?.temperatureC || 0}
                humidity={lastTelemetry?.airHumidityPct || 0}
                trendText="El ambiente se mantiene estable. Última variación registrada hace unos instantes."
              />

              <FanControl
                deviceId={data.id}
                fanOn={lastTelemetry?.fanOn || false}
                lastCycle="Nunca"
                onRefresh={fetchOverview}
              />

              <div
                className={`border rounded-[32px] p-8 relative overflow-hidden transition-colors duration-500 flex-grow ${
                  lastTelemetry &&
                  lastTelemetry.temperatureC !== null &&
                  lastTelemetry.temperatureC > 28
                    ? 'bg-warning border-warning text-canvas'
                    : lastTelemetry &&
                        lastTelemetry.temperatureC !== null &&
                        lastTelemetry.temperatureC < 15
                      ? 'bg-water border-water text-canvas'
                      : 'bg-ink border-line text-canvas'
                }`}
              >
                <TopographicPattern className="opacity-10 text-moss-bright" />
                <div className="relative z-10">
                  <h3
                    className={`text-xs font-bold tracking-widest uppercase mb-4 ${
                      lastTelemetry &&
                      lastTelemetry.temperatureC !== null &&
                      (lastTelemetry.temperatureC > 28 || lastTelemetry.temperatureC < 15)
                        ? 'text-canvas/80'
                        : 'text-moss-bright'
                    }`}
                  >
                    Análisis Climático
                  </h3>
                  <p className="font-display text-2xl leading-snug">
                    {lastTelemetry &&
                    lastTelemetry.temperatureC !== null &&
                    lastTelemetry.temperatureC > 28
                      ? '"Temperatura elevada. Se recomienda encender la extracción para disipar el calor."'
                      : lastTelemetry &&
                          lastTelemetry.temperatureC !== null &&
                          lastTelemetry.temperatureC < 15
                        ? '"Temperatura baja. El metabolismo y desarrollo de la planta podría ralentizarse."'
                        : '"Clima en rango óptimo para el desarrollo vegetativo. No se requiere acción."'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
