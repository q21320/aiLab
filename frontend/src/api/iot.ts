// ============================================================================
// 物联网（IoT）接口客户端：设备/采集/告警/概览
// ============================================================================

import { apiUrl } from "./base";

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
  /** 真实设备协议：mock | scpi | modbus-tcp | http */
  protocol?: string;
  /** 连接参数：{ host, port, unitId, baseUrl, token } */
  address?: Record<string, any>;
  /** 点位表 */
  points?: IotPointDef[];
  lastProbe?: { time: number; info: Record<string, any> };
  lastRead?: { time: number; values: Record<string, any> };
}

/** 点位定义：SCPI 用 query/command，Modbus 用 register/type/scale */
export interface IotPointDef {
  key: string;
  label: string;
  unit?: string;
  query?: string;
  command?: string;
  register?: number;
  type?: "uint16" | "int16" | "uint32" | "int32" | "float32";
  order?: "AB" | "CD";
  scale?: number;
  offset?: number;
  decimals?: number;
  url?: string;
  path?: string;
  method?: string;
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
    const res = await fetch(apiUrl(url), {
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

// ---------------------------------------------------------------------------
// 真实设备接入：驱动 / 虚拟仪器 / 探测 / 读写 / 实时数据
// ---------------------------------------------------------------------------
export interface DriverField {
  key: string;
  label: string;
  type?: string;
  default?: any;
  placeholder?: string;
}
export interface DriverDef {
  id: string;
  label: string;
  fields: DriverField[];
}

export function fetchDrivers(): Promise<{ drivers: DriverDef[]; simulator: any } | null> {
  return request(`${BASE}/drivers`);
}
export function startSimulator(): Promise<{ ok: boolean; hint: string } | null> {
  return request(`${BASE}/simulator/start`, { method: "POST" });
}
export function stopSimulator(): Promise<{ ok: boolean } | null> {
  return request(`${BASE}/simulator/stop`, { method: "POST" });
}
export function fetchSimulatorStatus(): Promise<{ simulator: any } | null> {
  return request(`${BASE}/simulator/status`);
}
/** 探测真实设备信息（SCPI *IDN? / Modbus 寄存器） */
export function probeDevice(
  id: string
): Promise<{ ok: boolean; info?: Record<string, any>; error?: string; protocol?: string } | null> {
  return request(`${BASE}/devices/${encodeURIComponent(id)}/probe`, { method: "POST" });
}
/** 读取设备实时点位 */
export function readDevicePoints(
  id: string
): Promise<{ ok: boolean; values?: Record<string, any>; error?: string } | null> {
  return request(`${BASE}/devices/${encodeURIComponent(id)}/read`, { method: "POST" });
}
/** 下发控制（写点位） */
export function writeDevicePoint(
  id: string,
  key: string,
  value: any
): Promise<{ ok: boolean; result?: any; error?: string } | null> {
  return request(`${BASE}/devices/${encodeURIComponent(id)}/write`, {
    method: "POST",
    body: JSON.stringify({ key, value }),
  });
}
/** 设备最近采集数据（曲线用） */
export function fetchDeviceLive(id: string): Promise<{ device: IotDevice; history: any[] } | null> {
  return request(`${BASE}/devices/${encodeURIComponent(id)}/live`);
}
