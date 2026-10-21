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
  deviceName?: string;
  level: "warn" | "error";
  message: string;
  time: number;
  status: "open" | "acked";
  ackedAt?: number;
  ackedBy?: string;
}

export interface AlertQuery {
  status?: "open" | "acked" | "all";
  level?: "warn" | "error" | "all";
  deviceId?: string;
  keyword?: string;
  from?: number;
  to?: number;
  page?: number;
  pageSize?: number;
}

export interface AlertPage {
  alerts: IotAlert[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AlertStats {
  total: number;
  open: number;
  open_error: number;
  open_warn: number;
  acked: number;
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
export function fetchAlerts(): Promise<{ alerts: IotAlert[]; total?: number } | null> {
  return request(`${BASE}/alerts`);
}

/** 分页查询告警（数据库） */
export function queryAlerts(q: AlertQuery = {}): Promise<AlertPage | null> {
  const params = new URLSearchParams();
  params.set("page", String(q.page ?? 1));
  params.set("pageSize", String(q.pageSize ?? 20));
  if (q.status && q.status !== "all") params.set("status", q.status);
  if (q.level && q.level !== "all") params.set("level", q.level);
  if (q.deviceId) params.set("deviceId", q.deviceId);
  if (q.keyword) params.set("keyword", q.keyword);
  if (q.from) params.set("from", String(q.from));
  if (q.to) params.set("to", String(q.to));
  return request(`${BASE}/alerts?${params.toString()}`);
}

/** 告警统计 */
export function fetchAlertStats(): Promise<{ ok: boolean; stats: AlertStats } | null> {
  return request(`${BASE}/alerts/stats`);
}

/** 批量确认（按 id 列表，或 all=true 确认全部未处理） */
export function ackAlertsBatch(ids: string[] | null): Promise<{ ok: boolean; acked: number } | null> {
  const url = ids ? `${BASE}/alerts/ack-batch` : `${BASE}/alerts/ack-batch?all=1`;
  return request(url, { method: "PUT", body: ids ? JSON.stringify({ ids }) : undefined });
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
export function fetchDeviceLive(
  id: string,
  opts?: { from?: number; to?: number; limit?: number; bucketMs?: number },
): Promise<{ device: IotDevice; history: any[]; source?: string } | null> {
  const p = new URLSearchParams();
  if (opts?.from) p.set("from", String(opts.from));
  if (opts?.to) p.set("to", String(opts.to));
  if (opts?.limit) p.set("limit", String(opts.limit));
  if (opts?.bucketMs) p.set("bucketMs", String(opts.bucketMs));
  const qs = p.toString();
  return request(`${BASE}/devices/${encodeURIComponent(id)}/live${qs ? `?${qs}` : ""}`);
}

/** 采集数据统计（运维用） */
export function fetchPointStats(): Promise<{ ok: boolean; stats: any } | null> {
  return request(`${BASE}/points/stats`);
}

/** 物联网运维设置 */
export function fetchIotSettings(): Promise<{ ok: boolean; retentionDays: number; stats?: any } | null> {
  return request(`${BASE}/settings`);
}

/** 修改数据留存天数 */
export function updateIotSettings(retentionDays: number): Promise<{ ok: boolean; retentionDays: number } | null> {
  return request(`${BASE}/settings`, { method: "PUT", body: JSON.stringify({ retentionDays }) });
}

// ---------------------------------------------------------------------------
// 告警通知配置
// ---------------------------------------------------------------------------
export interface NotifyChannel {
  id: string;
  type: "wecom" | "dingtalk" | "webhook" | "smtp";
  name?: string;
  enabled?: boolean;
  webhook?: string;
  secret?: string;
  host?: string;
  port?: number | string;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
  to?: string;
  lastError?: string;
  lastSentAt?: number;
}

export interface NotifyConfig {
  enabled: boolean;
  minLevel: "warn" | "error";
  ratePerMinute: number;
  channels: NotifyChannel[];
}

export function fetchNotifyConfig(): Promise<{ ok: boolean; config: NotifyConfig; channelTypes: any[] } | null> {
  return request(`${BASE}/notify`);
}

export function saveNotifyConfig(cfg: NotifyConfig): Promise<{ ok: boolean; config: NotifyConfig } | null> {
  return request(`${BASE}/notify`, { method: "PUT", body: JSON.stringify(cfg) });
}

export function testNotifyChannel(id: string): Promise<{ ok: boolean; error?: string } | null> {
  return request(`${BASE}/notify/test/${encodeURIComponent(id)}`, { method: "POST" });
}

/** 导出采集数据 CSV（按设备与时间范围） */
export function exportPointsCsv(deviceId: string, from: number, to: number): string {
  return `${BASE}/points/export.csv?deviceId=${encodeURIComponent(deviceId)}&from=${from}&to=${to}`;
}
