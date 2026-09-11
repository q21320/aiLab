// ============================================================================
// 低代码平台 · 后端接口客户端（发布应用：列表/发布/更新/卸载）
//
// 请求失败会带回 { ok:false, status, error }，由发布中心降级到本地存储，
// 并把失败原因显示到界面（避免"静默失败"或只看到 404 不知所措）。
// ============================================================================

import { apiUrl } from "./base";
import type { PublishKind } from "../lowcode/publish";

export interface PublishedAppDTO {
  id: string;
  kind: PublishKind;
  name: string;
  schema: any;
  publishedAt: number;
  updatedAt: number;
  enable: boolean;
  menu: boolean;
}

export interface ApiResult<T = any> {
  ok: boolean;
  status?: number;
  data?: T;
  /** 面向用户的失败原因（含环境提示） */
  error?: string;
}

const BASE = "/api/lowcode";

function describe(status: number | undefined, url: string): string {
  if (status === 404) {
    return `接口 404（${url}）：当前前端不是通过带 /api 代理的方式访问。请用 npm run dev / npm run preview 打开，或为静态部署配置 nginx 反向代理，或设置 VITE_API_BASE 指向后端地址`;
  }
  if (status === undefined) {
    return "无法连接后端接口：请确认已启动后端（cd backend && npm start，端口 3800）";
  }
  return `接口返回 HTTP ${status}`;
}

async function request(url: string, init?: RequestInit): Promise<ApiResult> {
  const full = apiUrl(url);
  try {
    const res = await fetch(full, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) return { ok: false, status: res.status, error: describe(res.status, full) };
    const data = await res.json().catch(() => ({}));
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, error: `${describe(undefined, full)}（${(e as Error).message}）` };
  }
}

/** 拉取全部已发布应用 */
export async function fetchAppsFromServer(): Promise<ApiResult<PublishedAppDTO[]>> {
  const res = await request(`${BASE}/apps`);
  if (!res.ok) return res;
  const apps = res.data?.apps;
  if (!Array.isArray(apps)) return { ok: false, error: "接口返回格式不正确（缺少 apps 数组）" };
  return { ok: true, data: apps as PublishedAppDTO[] };
}

/** 新建/更新应用 */
export function postAppToServer(app: PublishedAppDTO): Promise<ApiResult> {
  return request(`${BASE}/apps`, { method: "POST", body: JSON.stringify({ app }) });
}

/** 更新应用字段 */
export function putAppToServer(
  kind: PublishKind,
  id: string,
  patch: Partial<Pick<PublishedAppDTO, "name" | "enable" | "menu" | "schema">>
): Promise<ApiResult> {
  return request(`${BASE}/apps/${kind}/${id}`, { method: "PUT", body: JSON.stringify(patch) });
}

/** 卸载应用 */
export function deleteAppFromServer(kind: PublishKind, id: string): Promise<ApiResult> {
  return request(`${BASE}/apps/${kind}/${id}`, { method: "DELETE" });
}
