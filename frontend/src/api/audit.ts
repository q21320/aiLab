// ============================================================================
// 操作日志（审计）接口客户端
// ============================================================================

import { apiUrl } from "./base";

export interface AuditLog {
  time: number;
  user: string;
  role: string;
  module: string;
  action: string;
  detail: string;
}

export interface AuditQuery {
  page?: number;
  pageSize?: number;
  module?: string;
  role?: string;
  user?: string;
  keyword?: string;
  from?: number;
  to?: number;
}

export interface AuditPage {
  ok: boolean;
  logs: AuditLog[];
  total: number;
  page: number;
  pageSize: number;
  error?: string;
}

/** 批量写入日志 */
export async function pushLogs(logs: AuditLog[]): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/api/audit/logs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ logs }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 分页查询 */
export async function fetchLogs(q: AuditQuery = {}): Promise<AuditPage> {
  const params = new URLSearchParams();
  params.set("page", String(q.page || 1));
  params.set("pageSize", String(q.pageSize || 20));
  for (const k of ["module", "role", "user", "keyword"] as const) {
    if (q[k]) params.set(k, String(q[k]));
  }
  if (q.from) params.set("from", String(q.from));
  if (q.to) params.set("to", String(q.to));
  try {
    const res = await fetch(apiUrl(`/api/audit/logs?${params.toString()}`));
    if (!res.ok) return { ok: false, logs: [], total: 0, page: 1, pageSize: 20, error: `HTTP ${res.status}` };
    const body = await res.json();
    return {
      ok: true,
      logs: body.logs || [],
      total: body.total || 0,
      page: body.page || 1,
      pageSize: body.pageSize || 20,
    };
  } catch (e) {
    return { ok: false, logs: [], total: 0, page: 1, pageSize: 20, error: `无法连接后端（${(e as Error).message}）` };
  }
}

export function logsExportUrl(q: AuditQuery = {}): string {
  const params = new URLSearchParams();
  for (const k of ["module", "role", "user", "keyword"] as const) {
    if (q[k]) params.set(k, String(q[k]));
  }
  if (q.from) params.set("from", String(q.from));
  if (q.to) params.set("to", String(q.to));
  return apiUrl(`/api/audit/logs/export.csv?${params.toString()}`);
}

export async function clearLogs(all = true): Promise<{ ok: boolean; removed?: number; error?: string }> {
  try {
    const res = await fetch(apiUrl(`/api/audit/logs?${all ? "all=1" : ""}`), { method: "DELETE" });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, removed: body.removed };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function fetchAuditStats(): Promise<any | null> {
  try {
    const res = await fetch(apiUrl("/api/audit/stats"));
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
