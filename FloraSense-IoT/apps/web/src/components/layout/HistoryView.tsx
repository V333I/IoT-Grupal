"use client";
import { apiFetch } from '../../lib/api';

import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar';
import { LoginView } from './LoginView';
import { TopographicPattern } from '../ui/TopographicPattern';
import { Clock, CheckCircle2, AlertCircle } from 'lucide-react';

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

type DeviceItem = {
  id: string;
  deviceKey: string;
  name: string;
};

type IrrigationEvent = {
  id: string;
  startedAt: string;
  stoppedAt: string | null;
  durationSeconds: number | null;
  origin: string;
  stopReason: string | null;
  triggeredBy: string | null;
};

export function HistoryView() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [devices, setDevices] = useState<DeviceItem[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [events, setEvents] = useState<IrrigationEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const isAuth = safeGetItem('fs_auth_token') === 'true';
    setIsAuthenticated(isAuth);
    const saved = safeGetItem('fs_active_device');
    if (saved) setSelectedDeviceId(saved);
  }, []);

  const fetchDevicesAndEvents = async (targetId?: string | null) => {
    try {
      const devsRes = await apiFetch('/api/devices');
      if (!devsRes.ok) return;
      const list: DeviceItem[] = await devsRes.json();
      setDevices(list);

      if (list.length === 0) {
        setEvents([]);
        return;
      }

      const candidate = targetId ?? selectedDeviceId ?? safeGetItem('fs_active_device');
      const activeId =
        candidate && list.some((d) => d.id === candidate) ? candidate : list[0].id;

      if (activeId !== selectedDeviceId) {
        setSelectedDeviceId(activeId);
        safeSetItem('fs_active_device', activeId);
      }

      const eventsRes = await apiFetch(`/api/devices/${activeId}/events`);
      if (eventsRes.ok) {
        setEvents(await eventsRes.json());
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      fetchDevicesAndEvents(selectedDeviceId);
      const interval = setInterval(() => fetchDevicesAndEvents(selectedDeviceId), 5000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, selectedDeviceId]);

  const handleSelectDevice = (id: string) => {
    setSelectedDeviceId(id);
    safeSetItem('fs_active_device', id);
    setLoading(true);
    fetchDevicesAndEvents(id);
  };

  if (isAuthenticated === null) return <div className="min-h-screen bg-canvas" />;
  if (!isAuthenticated) return <LoginView onLogin={() => setIsAuthenticated(true)} />;

  return (
    <div className="flex h-screen bg-canvas overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col h-full relative overflow-y-auto">
        <TopographicPattern />

        <main className="flex-1 p-6 md:p-10 lg:p-14 max-w-[1000px] mx-auto w-full relative z-10">
          <header className="mb-8">
            <h1 className="font-display text-5xl text-ink mb-2">Historial de Eventos</h1>
            <p className="text-ink-soft">
              Registro detallado de los ciclos de riego y ventilación por grupo.
            </p>

            {devices.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-6">
                {devices.map((dev) => {
                  const active = dev.id === selectedDeviceId;
                  return (
                    <button
                      key={dev.id}
                      onClick={() => handleSelectDevice(dev.id)}
                      className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-colors border ${
                        active
                          ? 'bg-ink text-canvas border-ink'
                          : 'bg-canvas-elevated text-ink-soft border-line hover:text-ink'
                      }`}
                    >
                      {dev.name}
                    </button>
                  );
                })}
              </div>
            )}
          </header>

          <div className="bg-canvas-elevated border border-line rounded-[32px] shadow-sm overflow-hidden">
            {loading ? (
              <div className="p-12 text-center text-ink-soft">Cargando registros...</div>
            ) : events.length === 0 ? (
              <div className="p-12 text-center text-ink-soft">
                No hay registros de eventos todavía para este grupo.
              </div>
            ) : (
              <div className="w-full overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas">
                      <th className="p-6 font-bold tracking-widest uppercase text-xs text-ink-soft">
                        Fecha y Hora
                      </th>
                      <th className="p-6 font-bold tracking-widest uppercase text-xs text-ink-soft">
                        Origen
                      </th>
                      <th className="p-6 font-bold tracking-widest uppercase text-xs text-ink-soft">
                        Responsable
                      </th>
                      <th className="p-6 font-bold tracking-widest uppercase text-xs text-ink-soft">
                        Duración
                      </th>
                      <th className="p-6 font-bold tracking-widest uppercase text-xs text-ink-soft">
                        Estado
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((evt) => {
                      const startDate = new Date(evt.startedAt);
                      const isRunning = evt.stoppedAt === null;

                      return (
                        <tr
                          key={evt.id}
                          className="border-b border-line/50 hover:bg-canvas transition-colors"
                        >
                          <td className="p-6">
                            <div className="font-mono-data text-ink">
                              {startDate.toLocaleDateString('es-CL', {
                                timeZone: 'America/Santiago',
                              })}
                            </div>
                            <div className="text-sm text-ink-soft mt-1">
                              {startDate.toLocaleTimeString('es-CL', {
                                timeZone: 'America/Santiago',
                              })}
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="flex flex-col gap-2">
                              <span
                                className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase self-start w-fit ${
                                  evt.origin === 'AUTO_RULE' || evt.origin === 'LOCAL_AUTO'
                                    ? 'bg-moss/10 text-moss'
                                    : 'bg-water/10 text-water'
                                }`}
                              >
                                {evt.origin === 'AUTO_RULE' || evt.origin === 'LOCAL_AUTO'
                                  ? 'Automático'
                                  : 'Manual'}
                              </span>
                              <span className="text-[10px] text-ink-soft font-bold uppercase tracking-widest mt-1 block">
                                {evt.triggeredBy?.includes('(Ventilador)')
                                  ? 'VENTILACIÓN'
                                  : 'RIEGO'}
                              </span>
                            </div>
                          </td>
                          <td className="p-6">
                            <div className="text-sm font-medium text-ink">
                              {evt.triggeredBy ||
                                (evt.origin === 'AUTO_RULE' || evt.origin === 'LOCAL_AUTO'
                                  ? 'Sistema Automático'
                                  : 'Desconocido')}
                            </div>
                          </td>
                          <td className="p-6 font-mono-data text-ink">
                            {isRunning ? (
                              <span className="flex items-center gap-2 text-water animate-pulse">
                                <Clock className="w-4 h-4" /> En curso
                              </span>
                            ) : (
                              `${evt.durationSeconds} seg`
                            )}
                          </td>
                          <td className="p-6">
                            {isRunning ? (
                              <span className="text-water">Regando...</span>
                            ) : evt.stopReason?.includes('Timeout') ||
                              evt.stopReason?.includes('CRITICAL') ? (
                              <span className="flex items-center gap-2 text-warning">
                                <AlertCircle className="w-4 h-4" /> Interrumpido ({evt.stopReason})
                              </span>
                            ) : (
                              <span className="flex items-center gap-2 text-moss">
                                <CheckCircle2 className="w-4 h-4" /> Completado
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
