// ============================================================================
// 左侧导航菜单（多级）· 配置中心
//
// - 支持任意层级（子菜单可再嵌套）
// - 每项可配置：名称 / 图标 / 路径(支持 ?query) / 可见角色 / 启用
// - 管理入口：系统管理 → 导航菜单（可视化增删改、排序、重置）
// - 持久化：localStorage（可导出/导入 JSON 配置，便于交付与多环境同步）
// ============================================================================

import { defineStore } from "pinia";
import type { UserRole } from "./user";

export interface MenuItem {
  id: string;
  title: string;
  /** Element Plus 图标组件名 */
  icon: string;
  /** 路由路径，支持 /lowcode?tab=page 形式；分组节点可为空 */
  path: string;
  /** 可见角色（空数组 = 全部角色可见） */
  roles: UserRole[];
  enable: boolean;
  children?: MenuItem[];
}

const LS_KEY = "ailab.menus.v1";

let seq = 0;
export function menuId(): string {
  seq += 1;
  return `menu_${Date.now().toString(36)}_${seq}`;
}

/** 默认多级导航（与平台功能对应；叶子节点的角色与路由守卫保持一致） */
export function defaultMenus(): MenuItem[] {
  return [
    { id: menuId(), title: "仪表盘", icon: "Odometer", path: "/dashboard", roles: [], enable: true },
    {
      id: menuId(),
      title: "低代码平台",
      icon: "Grid",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "平台工作台", icon: "MagicStick", path: "/lowcode", roles: ["admin"], enable: true },
        { id: menuId(), title: "表单数据", icon: "Document", path: "/formdata", roles: ["admin", "operator"], enable: true },
      ],
    },
    { id: menuId(), title: "应用中心", icon: "Star", path: "/apps", roles: [], enable: true },
    {
      id: menuId(),
      title: "工业物联",
      icon: "Monitor",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "设备接入", icon: "Monitor", path: "/iot", roles: ["admin", "operator"], enable: true },
        { id: menuId(), title: "自动化测试", icon: "Cpu", path: "/autotest", roles: ["admin", "operator"], enable: true },
      ],
    },
    {
      id: menuId(),
      title: "生产管理",
      icon: "Operation",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "排产管理", icon: "Operation", path: "/production", roles: ["admin", "operator"], enable: true },
        { id: menuId(), title: "样品管理", icon: "Box", path: "/samples", roles: ["admin", "operator"], enable: true },
      ],
    },
    {
      id: menuId(),
      title: "系统管理",
      icon: "Setting",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "导航菜单", icon: "Menu", path: "/menus", roles: ["admin"], enable: true },
        { id: menuId(), title: "操作日志", icon: "Notebook", path: "/logs", roles: ["admin"], enable: true },
        { id: menuId(), title: "用户管理", icon: "UserFilled", path: "/user", roles: ["admin"], enable: true },
        { id: menuId(), title: "系统设置", icon: "Setting", path: "/setting", roles: ["admin"], enable: true },
      ],
    },
  ];
}

/** 深拷贝并补 id（导入配置时用） */
function normalize(items: MenuItem[]): MenuItem[] {
  return (items || []).map((it) => ({
    id: it.id || menuId(),
    title: it.title || "未命名菜单",
    icon: it.icon || "Document",
    path: it.path || "",
    roles: Array.isArray(it.roles) ? it.roles : [],
    enable: it.enable !== false,
    children: it.children && it.children.length ? normalize(it.children) : undefined,
  }));
}

function loadLocal(): MenuItem[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? normalize(parsed) : null;
  } catch {
    return null;
  }
}

/** 按角色 + 启用状态过滤（父节点无子节点时自动隐藏） */
export function filterMenus(items: MenuItem[], role: UserRole): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it.enable) continue;
    if (it.roles.length && !it.roles.includes(role)) continue;
    if (it.children && it.children.length) {
      const kids = filterMenus(it.children, role);
      if (kids.length) out.push({ ...it, children: kids });
      continue;
    }
    // 叶子节点：有 path 才显示
    if (it.path) out.push(it);
  }
  return out;
}

/** 拍平（用于查找与高亮） */
export function flattenMenus(items: MenuItem[]): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    out.push(it);
    if (it.children?.length) out.push(...flattenMenus(it.children));
  }
  return out;
}

function findIn(items: MenuItem[], id: string): { item: MenuItem; parent: MenuItem | null; siblings: MenuItem[]; index: number } | null {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) return { item: items[i], parent: null, siblings: items, index: i };
    const kids = items[i].children;
    if (kids?.length) {
      const found = findIn(kids, id);
      if (found) return { item: found.item, parent: items[i], siblings: kids, index: kids.findIndex((k) => k.id === id) };
    }
  }
  return null;
}

export const useMenuStore = defineStore("menus", {
  state: () => ({
    items: loadLocal() || defaultMenus(),
    loaded: true,
  }),
  getters: {
    /** 所有菜单项拍平后的数量 */
    total(state): number {
      return flattenMenus(state.items).length;
    },
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.items));
      } catch {
        /* ignore */
      }
    },
    /** 新增（parentId 为空则加为根节点） */
    addItem(parentId: string | null, preset?: Partial<MenuItem>) {
      const item: MenuItem = {
        id: menuId(),
        title: preset?.title || "新建菜单",
        icon: preset?.icon || "Document",
        path: preset?.path || "",
        roles: preset?.roles || [],
        enable: true,
        children: undefined,
      };
      if (parentId) {
        const found = findIn(this.items, parentId);
        if (!found) return null;
        found.item.children = found.item.children || [];
        found.item.children.push(item);
      } else {
        this.items.push(item);
      }
      this.persist();
      return item;
    },
    updateItem(id: string, patch: Partial<MenuItem>) {
      const found = findIn(this.items, id);
      if (!found) return;
      Object.assign(found.item, patch);
      if (patch.children === undefined && found.item.children && found.item.children.length === 0) {
        delete found.item.children;
      }
      this.persist();
    },
    removeItem(id: string) {
      const found = findIn(this.items, id);
      if (!found) return false;
      found.siblings.splice(found.index, 1);
      this.persist();
      return true;
    },
    /** 同级上移/下移 */
    moveItem(id: string, dir: -1 | 1) {
      const found = findIn(this.items, id);
      if (!found) return;
      const t = found.index + dir;
      if (t < 0 || t >= found.siblings.length) return;
      const [it] = found.siblings.splice(found.index, 1);
      found.siblings.splice(t, 0, it);
      this.persist();
    },
    /** 变为上一级节点的子菜单（降级） */
    indentItem(id: string) {
      const found = findIn(this.items, id);
      if (!found || found.index === 0) return;
      const prev = found.siblings[found.index - 1];
      found.siblings.splice(found.index, 1);
      prev.children = prev.children || [];
      prev.children.push(found.item);
      this.persist();
    },
    /** 提升为父级同级（升级） */
    outdentItem(id: string) {
      const found = findIn(this.items, id);
      if (!found || !found.parent) return;
      const parentRef = findIn(this.items, found.parent.id);
      if (!parentRef) return;
      const parentKids = parentRef.item.children!;
      // 父节点没有 children 时删除该字段
      const idx = parentKids.findIndex((k) => k.id === id);
      if (idx < 0) return;
      parentKids.splice(idx, 1);
      if (parentKids.length === 0) delete parentRef.item.children;
      parentRef.siblings.splice(parentRef.index + 1, 0, found.item);
      this.persist();
    },
    reset() {
      this.items = defaultMenus();
      this.persist();
    },
    exportJson(): string {
      return JSON.stringify(this.items, null, 2);
    },
    importJson(text: string): boolean {
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed) || parsed.length === 0) return false;
        this.items = normalize(parsed);
        this.persist();
        return true;
      } catch {
        return false;
      }
    },
  },
});

/** 菜单图标候选（Element Plus） */
export const MENU_ICONS = [
  "Odometer", "Grid", "Star", "MagicStick", "Document", "Tickets", "Connection", "DataAnalysis",
  "Monitor", "Cpu", "Operation", "Box", "Notebook", "UserFilled", "Setting", "Menu",
  "Histogram", "TrendCharts", "PieChart", "Coin", "Files", "FolderOpened", "House", "Lightning",
  "Clock", "Bell", "Search", "List", "Management", "Platform", "Promotion", "Compass",
  "Calendar", "Collection", "Upload", "Download", "EditPen", "Finished", "Key", "Link",
  "Lock", "Message", "Picture", "Pointer", "Position", "PriceTag", "Refresh", "School",
  "Service", "Share", "Stamp", "Timer", "Tools", "Trophy", "VideoPlay", "View",
];
