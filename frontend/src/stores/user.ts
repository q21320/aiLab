// ============================================================================
// 登录会话（服务端会话 + 本地展示缓存）
//
// 安全变更：登录、角色、密码校验全部由**后端**完成（backend/auth.mjs）：
//   · 用户名/密码 POST /api/auth/login → 服务端校验并下发 HttpOnly 会话 Cookie；
//   · 角色由 GET /api/auth/me 从服务端会话读取，localStorage 中的旧值不再可信；
//   · 前端 token 仅为「本地是否已登录」的 UI 提示，不再是权限依据。
//
// 角色不再是固定三档：key 由服务端 roles 表定义（用户可自建），
// 页面可见/可写判定全部走 stores/acl.ts（不要再在会话 store 里做角色比较）。
// ============================================================================

import { defineStore } from "pinia";
import { ref } from "vue";
import { apiUrl } from "../api/base";

/** 角色 key（内置 admin/operator/viewer，也允许自定义角色） */
export type UserRole = string;

/** 内置角色显示名兜底；实际显示名以服务端 roles 表为准（acl.roleName） */
export const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  operator: "工程师",
  viewer: "访客",
};

/** 本地仅缓存展示用信息；权限判断始终以服务端为准 */
const STORAGE_KEY = "ailab.session";

interface SessionUser {
  username: string;
  name: string;
  role: UserRole;
}

function readCached(): SessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    // 角色 key 可能是自定义值，只校验必填字段，不再限定枚举
    if (!v || !v.username || typeof v.role !== "string") return null;
    return { username: v.username, name: v.name || v.username, role: v.role };
  } catch {
    return null;
  }
}

export const useUserStore = defineStore("user", () => {
  const cached = readCached();
  const token = ref<string>(cached ? "session" : "");
  const username = ref<string>(cached?.username || "");
  const name = ref<string>(cached?.name || "");
  const role = ref<UserRole>(cached?.role || "viewer");
  /** 是否已向服务端确认过会话（避免首屏闪烁） */
  const ready = ref(false);
  /** 上次向服务端校验会话的时间戳（用于节流） */
  let lastValidatedAt = 0;

  function apply(user: SessionUser | null) {
    if (user) {
      token.value = "session";
      username.value = user.username;
      name.value = user.name;
      role.value = user.role;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    } else {
      token.value = "";
      username.value = "";
      name.value = "";
      role.value = "viewer";
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  /** 登录：由服务端校验密码并下发 HttpOnly Cookie */
  async function login(user: string, password: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(apiUrl("/api/auth/login"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user.trim(), password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.user) {
        return { ok: false, error: body?.error || `登录失败（${res.status}）` };
      }
      apply(body.user);
      lastValidatedAt = Date.now();
      // 登录事件由后端写入审计（身份由服务端推导），前端无需再自报
      return { ok: true };
    } catch {
      return { ok: false, error: "无法连接后端服务，请确认 backend 已启动（npm start）" };
    }
  }

  /** 向服务端确认当前会话（刷新页面 / 路由初始化时调用） */
  // 会话校验的最小间隔：避免每次路由切换/刷新都发起一次 /api/auth/me。
  // 这不影响安全性（真正的权限由后端校验），只影响体验与请求量。
  const VALIDATE_INTERVAL_MS = 30 * 1000;

  async function refresh(force = false): Promise<boolean> {
    // 刚校验过且本地有缓存 → 直接复用，不再请求
    if (!force && token.value && Date.now() - lastValidatedAt < VALIDATE_INTERVAL_MS) {
      ready.value = true;
      return true;
    }
    try {
      const res = await fetch(apiUrl("/api/auth/me"), { credentials: "include" });
      const body = await res.json().catch(() => ({}));
      const user: SessionUser | null = body?.user || null;
      lastValidatedAt = Date.now();
      // 服务端明确回答"没有会话"（HTTP 200 且 user 为 null）→ 必须退出登录。
      // 注意：只有真正的网络异常才保留本地缓存，避免把"后端挂了"误判成"会话失效"。
      if (res.ok && !user) {
        apply(null);
        lastValidatedAt = 0;
        ready.value = true;
        return false;
      }
      apply(user);
      ready.value = true;
      return !!user;
    } catch {
      // 后端不可达：保留本地缓存，仅当本地无缓存时视为未登录
      ready.value = true;
      return !!token.value;
    }
  }

  async function logout() {
    try {
      await fetch(apiUrl("/api/auth/logout"), { method: "POST", credentials: "include" });
    } catch {
      /* 后端不可达时忽略：本地状态仍需清空 */
    }
    apply(null);
    lastValidatedAt = 0;
  }

  /** 修改密码：服务端校验原密码（本地无法伪造） */
  async function changePassword(oldPassword: string, newPassword: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(apiUrl("/api/auth/password"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldPassword, newPassword }),
      });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { ok: true } : { ok: false, error: body?.error || `修改失败（${res.status}）` };
    } catch {
      return { ok: false, error: "无法连接后端服务" };
    }
  }

  /** 角色显示名：优先服务端下发的角色名，退回内置映射 */
  function roleLabel(key: UserRole = role.value): string {
    return ROLE_LABELS[key] || key;
  }

  return { token, username, name, role, ready, login, logout, refresh, changePassword, roleLabel };
});
