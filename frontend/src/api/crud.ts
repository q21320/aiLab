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

/**
 * 取下一个自动编号（服务端分配，避免并发重号）。
 * @param params 影响编号的业务字段，如 { date: "2026-10-25" }
 */
export async function nextCrudNo(
  resource: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; value?: string; error?: string }> {
  const q = new URLSearchParams(params).toString();
  const res = await req<{ value?: string }>(
    `/api/crud/${encodeURIComponent(resource)}/next-no${q ? `?${q}` : ""}`,
  );
  if (!res.ok || !res.data?.value) return { ok: false, error: res.error };
  return { ok: true, value: res.data.value };
}

export function fetchCrudResources() {
  return req<{ resources: { name: string; count: number; fields: CrudField[] }[] }>("/api/crud/resources");
}

export interface ImportRowError {
  /** CSV 中的数据序号（从 1 起，不是文件行号） */
  row: number;
  error: string;
}

export interface ImportResult {
  total: number;
  created: number;
  rejected: number;
  /** 校验通过的行是否真正写库（dryRun 或整批回滚时为 false） */
  saved: boolean;
  errors: ImportRowError[];
}

export interface ImportField {
  prop: string;
  label: string;
  required?: boolean;
}

/**
 * 批量导入：一次提交 N 行，服务端一次落库。
 * 不用逐条 POST：那会产出 N 次「整资源替换」写入，既慢又把并发窗口拉到最大。
 * @param opts.dryRun 只跑服务端校验不写库
 * @param opts.skipErrors true 跳过错误行只导合法行；false 有错误则整批不导
 * @param opts.fields 字段元数据（台账的字段定义只活在前端，不带则服务端推不出谁是必填）
 */
export async function importCrud(
  resource: string,
  rows: Record<string, any>[],
  opts: { dryRun?: boolean; skipErrors?: boolean; fields?: ImportField[] } = {},
): Promise<{ ok: boolean; result?: ImportResult; error?: string }> {
  const res = await req<ImportResult>(`/api/crud/${encodeURIComponent(resource)}/import`, {
    method: "POST",
    body: JSON.stringify({ rows, ...opts }),
  });
  if (!res.ok || !res.data) return { ok: false, error: res.error };
  return { ok: true, result: res.data };
}

/** 读取对象点路径（对接自有接口时的响应映射，如 data.records） */
export function getByPath(obj: any, path: string): any {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}
