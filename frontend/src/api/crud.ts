// ============================================================================
// 通用 CRUD 接口客户端（低代码「数据表格」组件的数据源）
// ============================================================================

import { apiUrl } from "./base";

export interface CrudField {
  prop: string;
  label: string;
  type: string;
  required?: boolean;
  options?: { label: string; value: any }[];
}

export interface CrudListResult {
  ok: boolean;
  list: Record<string, any>[];
  total: number;
  page: number;
  pageSize: number;
  fields: CrudField[];
  error?: string;
}

export interface CrudQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  sort?: string;
  order?: "asc" | "desc";
}

async function req<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; status?: number; error?: string }> {
  try {
    const res = await fetch(apiUrl(url), { headers: { "Content-Type": "application/json" }, ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      return { ok: false, status: res.status, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, data: body as T };
  } catch (e) {
    return { ok: false, error: `无法连接后端（${(e as Error).message}）` };
  }
}

/** 平台通用 CRUD：列表 + 分页 + 搜索 */
export async function listCrud(resource: string, q: CrudQuery = {}): Promise<CrudListResult> {
  const params = new URLSearchParams();
  params.set("page", String(q.page || 1));
  params.set("pageSize", String(q.pageSize || 20));
  if (q.keyword) params.set("keyword", q.keyword);
  if (q.sort) params.set("sort", q.sort);
  if (q.order) params.set("order", q.order);
  const res = await req<any>(`/api/crud/${encodeURIComponent(resource)}?${params.toString()}`);
  if (!res.ok || !res.data) {
    return { ok: false, list: [], total: 0, page: q.page || 1, pageSize: q.pageSize || 20, fields: [], error: res.error };
  }
  return {
    ok: true,
    list: res.data.list || [],
    total: res.data.total || 0,
    page: res.data.page || 1,
    pageSize: res.data.pageSize || 20,
    fields: res.data.fields || [],
  };
}

export function createCrud(resource: string, data: Record<string, any>) {
  return req(`/api/crud/${encodeURIComponent(resource)}`, { method: "POST", body: JSON.stringify({ data }) });
}
export function updateCrud(resource: string, id: string, data: Record<string, any>) {
  return req(`/api/crud/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}
export function deleteCrud(resource: string, id: string) {
  return req(`/api/crud/${encodeURIComponent(resource)}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
export function fetchCrudResources() {
  return req<{ resources: { name: string; count: number; fields: CrudField[] }[] }>("/api/crud/resources");
}

/** 读取对象点路径（对接自有接口时的响应映射，如 data.records） */
export function getByPath(obj: any, path: string): any {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
