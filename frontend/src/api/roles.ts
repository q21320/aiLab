// ============================================================================
// 角色权限（RBAC）接口客户端
//
// 真相源在服务端 roles 表：角色 = 名称 + 页面权限（view/edit）。
// 前端菜单、路由守卫、页面内按钮一律以这里的返回值判定，不再各自维护常量表。
// ============================================================================

import { apiUrl } from "./base";

export type PermLevel = "view" | "edit";

export interface PageMeta {
  path: string;
  title: string;
  /** locked = 系统管理类页面，恒仅管理员，不在矩阵中开放配置 */
  locked?: boolean;
}

export interface PageGroup {
  title: string;
  locked?: boolean;
  pages: PageMeta[];
}

export interface RoleInfo {
  key: string;
  name: string;
  builtin: boolean;
  pages: Record<string, PermLevel>;
  userCount: number;
}

async function req<T>(url: string, init?: RequestInit): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetch(apiUrl(url), { headers: { "Content-Type": "application/json" }, credentials: "include", ...init });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) return { ok: false, error: body.error || `HTTP ${res.status}` };
    return { ok: true, data: body as T };
  } catch (e) {
    return { ok: false, error: `无法连接后端（${(e as Error).message}）` };
  }
}

/** 角色列表 + 可授权页面清单（仅管理员，非管理员返回 403） */
export async function fetchRoles(): Promise<{ ok: boolean; roles: RoleInfo[]; groups: PageGroup[]; error?: string }> {
  const r = await req<{ roles: RoleInfo[]; groups: PageGroup[] }>("/api/roles");
  return { ok: r.ok, roles: r.data?.roles || [], groups: r.data?.groups || [], error: r.error };
}

export function createRole(name: string, pages: Record<string, PermLevel>) {
  return req<{ key: string }>("/api/roles", { method: "POST", body: JSON.stringify({ name, pages }) });
}

export function updateRole(key: string, patch: { name?: string; pages?: Record<string, PermLevel> }) {
  return req(`/api/roles/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(patch) });
}

export function deleteRole(key: string) {
  return req(`/api/roles/${encodeURIComponent(key)}`, { method: "DELETE" });
}

/** 当前身份的页面权限（登录后立即可取，用于渲染菜单与放行路由） */
export async function fetchMyAcl(): Promise<{
  ok: boolean;
  user: { username: string; name: string; role: string; roleName: string } | null;
  admin: boolean;
  pages: Record<string, PermLevel>;
  /** 需显式授权才可见的页面清单 */
  guarded: string[];
  error?: string;
}> {
  const r = await req<{ user: any; admin: boolean; pages: Record<string, PermLevel>; guarded: string[] }>("/api/auth/acl");
  return {
    ok: r.ok,
    user: r.data?.user || null,
    admin: !!r.data?.admin,
    pages: r.data?.pages || {},
    guarded: r.data?.guarded || [],
    error: r.error,
  };
}
