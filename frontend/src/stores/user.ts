// ============================================================================
// 统一权限（4.9 / 4.7）：三级角色 + 密码散列 + 会话
//   admin    管理员    全部功能（含低代码平台、用户管理、系统设置、日志）
//   operator 工程师    业务功能：应用中心、排产、样品、大屏
//   viewer   访客      只读：应用中心、大屏、报表
// ============================================================================

import { defineStore } from "pinia";
import { ref } from "vue";
import { sha256Hex } from "../utils/crypto";

export type UserRole = "admin" | "operator" | "viewer";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "管理员",
  operator: "工程师",
  viewer: "访客",
};

/** 演示账号（密码以 SHA-256 散列存储，绝不存明文） */
const DEMO_USERS = [
  { username: "admin", name: "管理员", role: "admin" as UserRole, pass: "admin123" },
  { username: "engineer", name: "王工程师", role: "operator" as UserRole, pass: "eng123" },
  { username: "viewer", name: "张访客", role: "viewer" as UserRole, pass: "view123" },
];

async function hash(pass: string): Promise<string> {
  return sha256Hex(`ailab-salt:${pass}`);
}

export const useUserStore = defineStore("user", () => {
  const token = ref<string>(localStorage.getItem("token") || "");
  const name = ref<string>(localStorage.getItem("username") || "");
  const role = ref<UserRole>((localStorage.getItem("role") as UserRole) || "viewer");

  /** 登录：校验散列密码，写入角色与权限 */
  async function login(username: string, password: string): Promise<boolean> {
    const user = DEMO_USERS.find((u) => u.username === username.trim());
    if (!user) return false;
    const passHash = await hash(password);
    if (passHash !== (await hash(user.pass))) return false;
    token.value = "token-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    name.value = user.name;
    role.value = user.role;
    localStorage.setItem("token", token.value);
    localStorage.setItem("username", name.value);
    localStorage.setItem("role", role.value);
    const { useAuditStore } = await import("./audit");
    useAuditStore().log("权限", "登录", `${user.name} 以「${ROLE_LABELS[user.role]}」身份登录系统`);
    return true;
  }

  function logout() {
    void (async () => {
      const { useAuditStore } = await import("./audit");
      useAuditStore().log("权限", "退出登录", `${name.value} 退出系统`);
    })();
    token.value = "";
    name.value = "";
    role.value = "viewer";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("role");
  }

  function hasRole(roles: UserRole[] | undefined): boolean {
    if (!roles || roles.length === 0) return true;
    return roles.includes(role.value);
  }

  return { token, name, role, login, logout, hasRole };
});
