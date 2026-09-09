// ============================================================================
// 物联网（IoT）接口客户端：设备/采集/告警/概览
// ============================================================================

export interface IotDevice {
  id: string;
  name: string;
  type: "env" | "test" | "energy" | "other";
  location: string;
  status: "online" | "offline" | "error";
  baseTemp: number;
  baseHum: number;
  power: number;
  limits?: Record<string, any>;
}

export interface IotPoint {
  deviceId: string;
  deviceName: string;
  type: string;
  time: number;
  temperature: number;
  humidity: number;
  power: number;
}

export interface IotAlert {
  id: string;
  deviceId: string;
  level: "warn" | "error";
  message: string;
  time: number;
  status: "open" | "acked";
  ackedAt?: number;
}

export interface IotOverview {
  online: number;
  total: number;
  openAlerts: number;
  energyNow: number;
  energyToday: number;
  testToday: number;
  samplesInToday: number;
  samplesTesting: number;
  samplesOutToday: number;
  tick: number;
  time: number;
}

const BASE = "/api/iot";

async function request<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchDevices(): Promise<{ devices: IotDevice[] } | null> {
  return request(`${BASE}/devices`);
}
export function fetchOverview(): Promise<IotOverview | null> {
  return request(`${BASE}/overview`);
}
export function fetchAlerts(): Promise<{ alerts: IotAlert[] } | null> {
  return request(`${BASE}/alerts`);
}
export function addDevice(device: Partial<IotDevice>): Promise<{ device: IotDevice } | null> {
  return request(`${BASE}/devices`, { method: "POST", body: JSON.stringify({ device }) });
}
export function deleteDevice(id: string): Promise<{ ok: boolean } | null> {
  return request(`${BASE}/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function ackAlert(id: string): Promise<{ alert: IotAlert } | null> {
  return request(`${BASE}/alerts/${encodeURIComponent(id)}/ack`, { method: "PUT" });
}
