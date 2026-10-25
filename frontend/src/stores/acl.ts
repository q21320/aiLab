// ============================================================================
// 当前身份的页面权限（RBAC 前端消费点）
//
// 服务端 /api/auth/acl 一次下发：{ admin, pages, guarded }
//   · pages   ：path → "view" | "edit"
//   · guarded ：需要显式授权才可见的页面清单（未登记的页面一律放行，避免误伤新功能）
// 菜单渲染、路由守卫、页面内"新增/编辑/删除"按钮全部走这里的 canView / canEdit。
// ============================================================================

import { defineStore } from "pinia";
import { ref } from "vue";
import { fetchMyAcl, type PermLevel } from "../api/roles";

/** 动态路由 → 权限页面 key（应用运行态归属应用中心；菜单路径可能带 ?tab= 查询串） */
export function pageKeyOf(path: string): string {
  const p = String(path || "/").split("?")[0].replace(/\/+$/, "") || "/";
  if (p === "/") return "/dashboard";
  if (p.startsWith("/app/")) return "/apps";
  return p;
}

export const useAclStore = defineStore("acl", () => {
  const ready = ref(false);
  const admin = ref(false);
  const roleKey = ref("");
  const roleName = ref("");
  const pages = ref<Record<string, PermLevel>>({});
  const guarded = ref<string[]>([]);

  function apply(r: Awaited<ReturnType<typeof fetchMyAcl>>) {
    admin.value = !!r.admin;
    pages.value = r.pages || {};
    roleKey.value = r.user?.role || "";
    roleName.value = r.user?.roleName || "";
    if (r.guarded) guarded.value = r.guarded;
  }

  /** 拉取当前身份权限；登录成功、切换账号、管理员改权限后调用 */
  async function load(force = false): Promise<boolean> {
    if (ready.value && !force) return true;
    const r = await fetchMyAcl();
    if (!r.ok) return false;
    apply(r);
    ready.value = true;
    return true;
  }

  function reset() {
    ready.value = false;
    admin.value = false;
    roleKey.value = "";
    roleName.value = "";
    pages.value = {};
  }

  function levelOf(path: string): PermLevel | undefined {
    return pages.value[pageKeyOf(path)];
  }

  function canView(path: string): boolean {
    if (admin.value) return true;
    const key = pageKeyOf(path);
    // 未纳入权限清单的页面（如登录页、异常页）不拦截
    if (!guarded.value.includes(key)) return true;
    const lv = pages.value[key];
    return lv === "view" || lv === "edit";
  }

  /** 可写：决定"新增/编辑/删除"等按钮与服务端 403 是否一致 */
  function canEdit(path: string): boolean {
    return admin.value || pages.value[pageKeyOf(path)] === "edit";
  }

  /** 无权限时的落地页：优先仪表盘，否则第一个可见业务页 */
  function firstViewable(): string {
    if (canView("/dashboard")) return "/dashboard";
    const hit = guarded.value.find((p) => canView(p));
    return hit || "/dashboard";
  }

  return { ready, admin, roleKey, roleName, pages, guarded, load, reset, apply, canView, canEdit, levelOf, firstViewable };
});
