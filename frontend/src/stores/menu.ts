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
/** 菜单配置版本：结构性调整时 +1，老配置在读取时按版本补齐 */
const MENU_VERSION_KEY = "ailab.menus.v1.version";
const MENU_VERSION = 9;

let seq = 0;
export function menuId(): string {
  seq += 1;
  return `menu_${Date.now().toString(36)}_${seq}`;
}

type MenuPreset = Omit<MenuItem, "id" | "children"> & { children?: Omit<MenuItem, "id">[] };

/** 「实验室管理」下的业务模块（默认菜单与老配置迁移共用同一份定义）
 *  项目与财务都是“一对”模块 → 各自进子分组，菜单层级保持对称 */
const LAB_MENU_PRESETS: MenuPreset[] = [
  {
    title: "项目管理",
    icon: "Folder",
    path: "",
    roles: ["admin", "operator"],
    enable: true,
    children: [
      { title: "测试项目", icon: "Tickets", path: "/lab/projects", roles: ["admin", "operator"], enable: true },
      { title: "委外项目", icon: "Van", path: "/lab/outsource-projects", roles: ["admin", "operator"], enable: true },
    ],
  },
  { title: "客户信息", icon: "Service", path: "/lab/customers", roles: ["admin", "operator"], enable: true },
  { title: "设备信息", icon: "Monitor", path: "/lab/equipment", roles: ["admin", "operator"], enable: true },
  { title: "耗材信息", icon: "Box", path: "/lab/consumables", roles: ["admin", "operator"], enable: true },
  { title: "日常报销", icon: "Coin", path: "/lab/reimbursements", roles: ["admin", "operator"], enable: true },
  {
    title: "财务管理",
    icon: "Money",
    path: "",
    roles: ["admin"],
    enable: true,
    children: [
      { title: "收入项目", icon: "TrendCharts", path: "/lab/finance/income", roles: ["admin"], enable: true },
      { title: "支出项目", icon: "Histogram", path: "/lab/finance/expense", roles: ["admin"], enable: true },
    ],
  },
];

/** 「系统管理」下的固定入口（角色权限页为新增，需对老配置做补齐迁移） */
const SYSTEM_MENU_PRESETS: MenuPreset[] = [
  { title: "导航菜单", icon: "Menu", path: "/menus", roles: ["admin"], enable: true },
  { title: "角色权限", icon: "Lock", path: "/roles", roles: ["admin"], enable: true },
  { title: "操作日志", icon: "Notebook", path: "/logs", roles: ["admin"], enable: true },
  { title: "用户管理", icon: "UserFilled", path: "/user", roles: ["admin"], enable: true },
  { title: "系统设置", icon: "Setting", path: "/setting", roles: ["admin"], enable: true },
];

function makeMenu(preset: MenuPreset): MenuItem {
  return {
    id: menuId(),
    ...preset,
    children: preset.children?.map((c) => ({ id: menuId(), ...c })),
  };
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
      enable: false,
      children: [
        { id: menuId(), title: "平台工作台", icon: "MagicStick", path: "/lowcode", roles: ["admin"], enable: true },
        { id: menuId(), title: "表单数据", icon: "Document", path: "/formdata", roles: ["admin", "operator"], enable: true },
      ],
    },
    { id: menuId(), title: "应用中心", icon: "Star", path: "/apps", roles: [], enable: false },
    {
      id: menuId(),
      title: "工业物联",
      icon: "Monitor",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "设备接入", icon: "Monitor", path: "/iot", roles: ["admin", "operator"], enable: true },
        { id: menuId(), title: "告警管理", icon: "Warning", path: "/alerts", roles: ["admin", "operator", "viewer"], enable: true },
        { id: menuId(), title: "自动化测试", icon: "Cpu", path: "/autotest", roles: ["admin", "operator"], enable: true },
      ],
    },
    {
      id: menuId(),
      title: "实验室管理",
      icon: "Operation",
      path: "",
      roles: [],
      enable: true,
      children: [
        { id: menuId(), title: "排产管理", icon: "Operation", path: "/production", roles: ["admin", "operator"], enable: false },
        { id: menuId(), title: "样品管理", icon: "Box", path: "/samples", roles: ["admin", "operator"], enable: false },
        ...LAB_MENU_PRESETS.map(makeMenu),
      ],
    },
    {
      id: menuId(),
      title: "系统管理",
      icon: "Setting",
      path: "",
      roles: [],
      enable: true,
      children: SYSTEM_MENU_PRESETS.map(makeMenu),
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

/** 历史菜单迁移（v2）：分组与页面改名。
 *  按 path 匹配而非 title，避免将来新增的同名模块被误改。 */
const LEGACY_TITLES: Record<string, string> = {
  生产管理: "实验室管理",
};
const LEGACY_TITLE_BY_PATH: Record<string, string> = {
  "/production": "排产管理",
  "/samples": "样品管理",
  // v7：「项目信息」拆为测试 / 委外两个模块，老菜单项按路径改名
  "/lab/projects": "测试项目",
};

function migrateTitles(items: MenuItem[]): MenuItem[] {
  return items.map((it) => {
    let title = LEGACY_TITLES[it.title] || it.title;
    if (it.path && LEGACY_TITLE_BY_PATH[it.path]) title = LEGACY_TITLE_BY_PATH[it.path];
    return { ...it, title, children: it.children ? migrateTitles(it.children) : it.children };
  });
}

/** 结构性迁移（v3、v7、v8）：在「实验室管理」下补齐新增模块，并把成对模块收进子分组。
 *  菜单存 localStorage，只改默认值对用过的浏览器无效；按 path 去重，不覆盖用户已有配置。 */
function ensureLabMenus(items: MenuItem[]): MenuItem[] {
  const group = items.find((it) => it.title === "实验室管理" && Array.isArray(it.children));
  if (!group?.children) return items;
  const children = group.children;
  const paths = new Set(flattenMenus(items).map((m) => m.path).filter(Boolean));
  // 插入位置跟预设顺序：放在「上一个已存在的预设项」之后，新模块不会掉到分组末尾
  let insertAt = 0;
  for (const preset of LAB_MENU_PRESETS) {
    if (preset.children) {
      let sub = children.find((c) => c.title === preset.title && Array.isArray(c.children));
      if (!sub) {
        sub = { ...makeMenu(preset), children: [] };
        children.splice(insertAt, 0, sub);
      }
      sub.children = sub.children || [];
      for (const child of preset.children) {
        const existing = sub.children.find((c) => c.path === child.path);
        // v7 曾把新模块直接平铺在本分组下 → 搬进子分组，避免同一路径出现两个菜单项
        const flatAt = children.findIndex((c) => c !== sub && c.path === child.path);
        if (flatAt >= 0) {
          const flat = children.splice(flatAt, 1)[0];
          if (existing) sub.children.splice(sub.children.indexOf(existing), 1);
          sub.children.push({ ...flat, title: child.title || flat.title });
          continue;
        }
        if (existing) continue;
        // paths 里有但不在本分组也不在子分组：用户自己把它改放到了别处，不重复加
        if (paths.has(child.path)) continue;
        sub.children.push({ id: menuId(), ...child });
      }
      const gi = children.findIndex((c) => c.title === preset.title);
      if (gi >= 0) insertAt = gi + 1;
      continue;
    }
    const at = children.findIndex((c) => c.path === preset.path);
    if (at >= 0) {
      insertAt = at + 1;
      continue;
    }
    if (paths.has(preset.path)) continue;
    children.splice(insertAt, 0, makeMenu(preset));
    insertAt += 1;
  }
  return items;
}

/** 按 path 去重补齐指定分组下缺失的菜单（存 localStorage，只改默认值对老浏览器无效） */
function ensureGroupMenus(items: MenuItem[], groupTitle: string, presets: MenuPreset[]): MenuItem[] {
  const group = items.find((it) => it.title === groupTitle);
  if (!group) return items;
  const paths = new Set(flattenMenus(items).map((m) => m.path).filter(Boolean));
  const missing = presets.filter((p) => p.path && !paths.has(p.path));
  if (!missing.length) return items;
  group.children = group.children || [];
  // 逐个按预设顺序插入到「前一个已有预设项」之后，保持预设项相邻且不乱序，用户自加的菜单不受影响
  const missingKeys = new Set(missing.map((p) => p.path));
  let insertAt = 0;
  for (const preset of presets) {
    const at = group.children.findIndex((c) => c.path === preset.path);
    if (at >= 0) {
      insertAt = at + 1;
      continue;
    }
    if (!missingKeys.has(preset.path)) continue;
    group.children.splice(insertAt, 0, makeMenu(preset));
    insertAt += 1;
  }
  return items;
}

/** 隐藏入口（v4）：暂时不对用户展示的菜单。
 *  用 enable=false 而不是删除：配置仍在，可在「系统管理→导航菜单」里随时重新启用。 */
const HIDDEN_MENU_TITLES = new Set(["低代码平台"]);
const HIDDEN_MENU_PATHS = new Set(["/production", "/samples", "/apps"]);

function hideMenus(items: MenuItem[]): MenuItem[] {
  return items.map((it) => ({
    ...it,
    enable: HIDDEN_MENU_TITLES.has(it.title) || (it.path && HIDDEN_MENU_PATHS.has(it.path)) ? false : it.enable,
    children: it.children ? hideMenus(it.children) : it.children,
  }));
}

function loadLocal(): MenuItem[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.length) return null;
    let items = normalize(parsed);
    const version = Number(localStorage.getItem(MENU_VERSION_KEY) || 0);
    if (version < MENU_VERSION) {
      items = ensureLabMenus(migrateTitles(items));
      items = hideMenus(items);
      // v6：「系统管理」补上「角色权限」入口（页面可见性已由服务端权限控制）
      items = ensureGroupMenus(items, "系统管理", SYSTEM_MENU_PRESETS);
      localStorage.setItem(LS_KEY, JSON.stringify(items));
      localStorage.setItem(MENU_VERSION_KEY, String(MENU_VERSION));
    }
    return items;
  } catch {
    return null;
  }
}

/** 按「页面权限 + 启用状态」过滤（父节点无可见子节点时自动隐藏）。
 *  注：MenuItem.roles 已废弃——可见性由服务端「角色权限」统一决定，避免菜单页与权限页两处配置打架。 */
export function filterMenus(items: MenuItem[], canView: (path: string) => boolean): MenuItem[] {
  const out: MenuItem[] = [];
  for (const it of items) {
    if (!it.enable) continue;
    if (it.children && it.children.length) {
      const kids = filterMenus(it.children, canView);
      if (kids.length) out.push({ ...it, children: kids });
      continue;
    }
    // 叶子节点：有 path 且当前身份可见才显示
    if (it.path && canView(it.path)) out.push(it);
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
