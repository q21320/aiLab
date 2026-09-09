// ============================================================================
// 低代码平台 · 后端接口客户端
//
// 与 backend/server.mjs 对接（vite 已配置 /api → http://localhost:3800 代理）。
// 所有请求失败均返回 null/false，由调用方（publish store）降级到本地存储，
// 保证后端未启动时平台仍可正常演示。
// ============================================================================

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

const BASE = "/api/lowcode";

async function request(url: string, init?: RequestInit): Promise<any | null> {
  try {
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/** 拉取全部已发布应用 */
export async function fetchAppsFromServer(): Promise<PublishedAppDTO[] | null> {
  const data = await request(`${BASE}/apps`);
  if (!data || !Array.isArray(data.apps)) return null;
  return data.apps as PublishedAppDTO[];
}

/** 新建/更新应用 */
export async function postAppToServer(app: PublishedAppDTO): Promise<boolean> {
  return !!(await request(`${BASE}/apps`, {
    method: "POST",
    body: JSON.stringify({ app }),
  }));
}

/** 更新应用字段（名称/启用/挂载菜单/Schema） */
export async function putAppToServer(
  kind: PublishKind,
  id: string,
  patch: Partial<Pick<PublishedAppDTO, "name" | "enable" | "menu" | "schema">>
): Promise<boolean> {
  return !!(await request(`${BASE}/apps/${kind}/${id}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  }));
}

/** 卸载应用 */
export async function deleteAppFromServer(kind: PublishKind, id: string): Promise<boolean> {
  return !!(await request(`${BASE}/apps/${kind}/${id}`, { method: "DELETE" }));
}
