// ============================================================================
// 角色权限（RBAC-lite）
//
// 模型：角色 = 名称 + 页面权限映射（pages: { "/lab/projects": "edit" }）
//   · 三态：不可见（无键值）/ 只读 view / 可写 edit
//   · 用户引用角色 key；改角色 → 该角色下所有用户即时生效（无需逐个调）
//   · 内置 admin 恒有全部权限且不可配置，避免管理员把自己锁死后无法恢复
//
// 页面清单（PAGE_GROUPS）是全站唯一真相源：
//   前端菜单/路由守卫按它判定可见性，后端接口按 API_PAGE_RULES 绑定到同一份权限，
//   彻底消除「菜单能配、路由不认、接口不管」三套口径不一致的问题。
// ============================================================================

/** 权限级别 */
export const LEVELS = ["view", "edit"];

/**
 * 可授权页面清单（分组供权限矩阵页渲染）。
 * locked = 系统管理类页面，恒仅管理员，不出现在可配置矩阵中（防止关掉自己的后路）。
 */
export const PAGE_GROUPS = [
  {
    title: "概览",
    pages: [{ path: "/dashboard", title: "仪表盘" }],
  },
  {
    title: "实验室管理",
    pages: [
      { path: "/lab/projects", title: "自测项目" },
      { path: "/lab/outsource-projects", title: "委外项目" },
      { path: "/lab/customers", title: "客户信息" },
      { path: "/lab/equipment", title: "设备信息" },
      { path: "/lab/consumables", title: "耗材信息" },
      { path: "/lab/reimbursements", title: "日常报销" },
      { path: "/lab/finance/income", title: "收入项目" },
      { path: "/lab/finance/expense", title: "支出项目" },
    ],
  },
  {
    title: "工业物联",
    pages: [
      { path: "/iot", title: "设备接入" },
      { path: "/alerts", title: "告警管理" },
      { path: "/autotest", title: "自动化测试" },
    ],
  },
  {
    title: "生产与样品",
    pages: [
      { path: "/production", title: "排产管理" },
      { path: "/samples", title: "样品管理" },
    ],
  },
  {
    title: "低代码平台",
    pages: [
      { path: "/lowcode", title: "低代码开发平台" },
      { path: "/formdata", title: "表单数据" },
      { path: "/apps", title: "应用中心" },
    ],
  },
  {
    title: "系统管理",
    locked: true,
    pages: [
      { path: "/menus", title: "导航菜单" },
      { path: "/roles", title: "角色权限" },
      { path: "/logs", title: "操作日志" },
      { path: "/user", title: "用户管理" },
      { path: "/setting", title: "系统设置" },
    ],
  },
];

/** 扁平页面表：path → { path, title, group, locked } */
export const PAGE_BY_PATH = (() => {
  const out = {};
  for (const g of PAGE_GROUPS) {
    for (const p of g.pages) out[p.path] = { ...p, group: g.title, locked: !!g.locked };
  }
  return out;
})();

export const ALL_PAGE_PATHS = Object.keys(PAGE_BY_PATH);
export const CONFIGURABLE_PAGES = ALL_PAGE_PATHS.filter((p) => !PAGE_BY_PATH[p].locked);

/**
 * 接口前缀 → 页面绑定。
 *   · 写操作（POST/PUT/DELETE）一律需要该页面的 edit 权限；
 *   · 读操作默认保持平台既有策略（登录即可，大屏免登录展示不受影响）；
 *     仅 guardRead 的资源读接口也必须 view 权限——实验室台账含财务，必须接口层隔离。
 */
export const API_PAGE_RULES = [
  { prefix: "/api/crud/lab_projects", page: "/lab/projects", guardRead: true },
  { prefix: "/api/crud/lab_outsource_projects", page: "/lab/outsource-projects", guardRead: true },
  { prefix: "/api/crud/lab_customers", page: "/lab/customers", guardRead: true },
  { prefix: "/api/crud/lab_equipment", page: "/lab/equipment", guardRead: true },
  { prefix: "/api/crud/lab_consumables", page: "/lab/consumables", guardRead: true },
  { prefix: "/api/crud/lab_reimbursements", page: "/lab/reimbursements", guardRead: true },
  { prefix: "/api/crud/lab_fin_income", page: "/lab/finance/income", guardRead: true },
  { prefix: "/api/crud/lab_fin_expense", page: "/lab/finance/expense", guardRead: true },
  { prefix: "/api/iot/devices", page: "/iot" },
  { prefix: "/api/iot/write", page: "/iot" },
  { prefix: "/api/iot/simulator", page: "/iot" },
  { prefix: "/api/iot/settings", page: "/iot" },
  { prefix: "/api/iot/points", page: "/iot" },
  { prefix: "/api/autotest", page: "/autotest" },
  { prefix: "/api/samples", page: "/samples" },
  { prefix: "/api/production", page: "/production" },
  { prefix: "/api/lowcode/projects", page: "/lowcode" },
  { prefix: "/api/lowcode/apps", page: "/apps" },
  { prefix: "/api/forms", page: "/formdata" },
  // AI 生成（消耗额度）属于设计态能力，随低代码页面权限走
  { prefix: "/api/ai/generate", page: "/lowcode" },
];

/** 管理类接口：不进入矩阵，恒仅管理员 */
export const ADMIN_ONLY_RULES = [
  { prefix: "/api/users" },
  { prefix: "/api/backup" },
  { prefix: "/api/roles" },
  { prefix: "/api/iot/notify" },
  { prefix: "/api/ai/config" },
  // 审计日志含全平台操作轨迹，且旧策略下 GET 完全不登录也能读 → 一并收紧
  { prefix: "/api/audit" },
];

/** 内置角色的默认页面权限（与改造前的路由/接口口径等价，保证升级后行为不变） */
const BUILTIN_SEED = [
  {
    key: "admin",
    name: "管理员",
    builtin: true,
    pages: Object.fromEntries(ALL_PAGE_PATHS.map((p) => [p, "edit"])),
  },
  {
    key: "operator",
    name: "工程师",
    builtin: true,
    pages: {
      "/dashboard": "view",
      "/lab/projects": "edit",
      "/lab/outsource-projects": "edit",
      "/lab/customers": "edit",
      "/lab/equipment": "edit",
      "/lab/consumables": "edit",
      "/lab/reimbursements": "edit",
      "/iot": "edit",
      "/alerts": "view",
      "/autotest": "edit",
      "/production": "edit",
      "/samples": "edit",
      "/formdata": "edit",
      "/apps": "view",
    },
  },
  {
    key: "viewer",
    name: "访客",
    builtin: true,
    pages: {
      "/dashboard": "view",
      "/alerts": "view",
      "/apps": "view",
    },
  },
];

function roleKey(name) {
  const base = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  return String(name || base).slice(0, 32) && base;
}

/** 校验并清洗 pages：丢弃未知/锁定页面与非法级别 */
export function sanitizePages(pages) {
  const out = {};
  for (const [path, level] of Object.entries(pages || {})) {
    const meta = PAGE_BY_PATH[path];
    if (!meta || meta.locked) continue;
    if (!LEVELS.includes(level)) continue;
    out[path] = level;
  }
  return out;
}

/**
 * @param {{ db: any, log?: (msg: string) => void }} options
 */
export async function createAcl({ db, log = console.log }) {
  /** 内存缓存：roleKey → { key, name, builtin, pages }；写操作后立即失效 */
  let cache = new Map();

  async function rows() {
    const r = await db.query("SELECT key, name, builtin, pages FROM roles ORDER BY builtin DESC, created_at ASC");
    return r.rows;
  }

  /** 首次加载 + 内置角色补齐（幂等） */
  async function reload() {
    const next = new Map();
    for (const row of await rows()) {
      next.set(row.key, {
        key: row.key,
        name: row.name,
        builtin: !!row.builtin,
        pages: typeof row.pages === "string" ? JSON.parse(row.pages) : row.pages || {},
      });
    }
    for (const seed of BUILTIN_SEED) {
      if (next.has(seed.key)) continue;
      await db.query(
        `INSERT INTO roles (key, name, builtin, pages) VALUES ($1,$2,true,$3::jsonb) ON CONFLICT (key) DO NOTHING`,
        [seed.key, seed.name, JSON.stringify(seed.pages)],
      );
      next.set(seed.key, { ...seed });
    }
    cache = next;
    return next;
  }

  async function get(key) {
    if (!cache.has(key)) await reload();
    return cache.get(key) || null;
  }

  /** 角色列表（含引用用户数，供删除保护与影响面提示） */
  async function list() {
    await reload();
    const counts = await db.query("SELECT role, COUNT(*)::int AS n FROM users GROUP BY role");
    const byRole = new Map(counts.rows.map((r) => [r.role, Number(r.n)]));
    return [...cache.values()].map((r) => ({
      key: r.key,
      name: r.name,
      builtin: r.builtin,
      pages: r.pages,
      userCount: byRole.get(r.key) || 0,
    }));
  }

  /** 新增或更新角色；返回 { ok, key?, error? } */
  async function save({ key, name, pages }) {
    const title = String(name || "").trim();
    if (!title) return { ok: false, error: "角色名称不能为空" };
    if (title.length > 20) return { ok: false, error: "角色名称不超过 20 个字符" };
    const clean = sanitizePages(pages);
    const existed = key ? await get(key) : null;
    if (key && !existed) return { ok: false, error: "角色不存在" };
    if (key === "admin") {
      // 唯一不可配的角色：只允许改显示名，权限恒为全部（防止管理员把自己锁死）
      await db.query("UPDATE roles SET name = $2, updated_at = now() WHERE key = $1", [key, title]);
      await reload();
      return { ok: true, key };
    }
    const target = key || roleKey(title);
    await db.query(
      `INSERT INTO roles (key, name, builtin, pages) VALUES ($1,$2,false,$3::jsonb)
       ON CONFLICT (key) DO UPDATE SET name = EXCLUDED.name, pages = EXCLUDED.pages, updated_at = now()`,
      [target, title, JSON.stringify(clean)],
    );
    await reload();
    return { ok: true, key: target };
  }

  /** 删除角色：admin 不可删；仍有用户引用不可删（防止用户变成无权限的孤儿） */
  async function remove(key) {
    const role = await get(key);
    if (!role) return { ok: false, error: "角色不存在" };
    if (key === "admin") return { ok: false, error: "管理员角色不可删除" };
    const used = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = $1", [key]);
    if (Number(used.rows[0]?.n || 0) > 0) {
      return { ok: false, error: `该角色下还有 ${used.rows[0].n} 个用户，请先调整他们的角色` };
    }
    await db.query("DELETE FROM roles WHERE key = $1", [key]);
    await reload();
    return { ok: true };
  }

  /**
   * 某角色的有效权限：{ admin, name, pages }
   * admin 恒有全部页面（含锁定页），前端与接口层无需特判。
   */
  async function resolve(key) {
    const role = await get(key);
    if (key === "admin") {
      return { admin: true, name: role?.name || "管理员", pages: Object.fromEntries(ALL_PAGE_PATHS.map((p) => [p, "edit"])) };
    }
    return { admin: false, name: role?.name || key, pages: role?.pages || {} };
  }

  /** 角色下拉用（用户管理页）：[{ key, name }] */
  async function options() {
    await reload();
    return [...cache.values()].map((r) => ({ key: r.key, name: r.name, builtin: r.builtin }));
  }

  await reload();
  log(`[acl] 已加载 ${cache.size} 个角色`);

  return { list, get, save, remove, resolve, options, reload };
}
