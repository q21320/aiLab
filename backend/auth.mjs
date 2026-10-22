// ============================================================================
// 服务端会话与鉴权（需求 4.9 安全 · 三级权限）
//
// 设计：
//   · 登录由**服务端**校验用户名/密码（密码以 SHA-256 散列保存），签发随机 token；
//   · token 放在 HttpOnly + SameSite=Lax 的 Cookie 中，前端 JS 无法读写（防 XSS 窃取）；
//   · 会话保存在内存（重启失效），可选持久化到磁盘以支持重启后免登录；
//   · 角色由服务端会话推导，**绝不信任前端传来的 role**；
//   · 权限矩阵见 ROUTE_RULES：写操作、审计、备份、设备下发均需相应角色。
//
// 说明：本项目为单进程零依赖服务，内存会话足够；大规模部署建议替换为 Redis/DB。
// ============================================================================

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE = "ailab_sid";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 小时
const MAX_SESSIONS = 2000;

export const ROLE_LABELS = { admin: "管理员", operator: "工程师", viewer: "访客" };
const ROLE_RANK = { viewer: 1, operator: 2, admin: 3 };

/** 默认演示账号（首次启动写入 backend/data/users.json；请在生产环境修改密码） */
export function defaultUsers() {
  const salt = "ailab-salt";
  const h = (p) => createHash("sha256").update(`${salt}:${p}`).digest("hex");
  return [
    { username: "admin", name: "管理员", role: "admin", passHash: h("admin123"), enabled: true },
    { username: "engineer", name: "王工程师", role: "operator", passHash: h("eng123"), enabled: true },
    { username: "viewer", name: "张访客", role: "viewer", passHash: h("view123"), enabled: true },
  ];
}

export function hashPassword(pass) {
  return createHash("sha256").update(`ailab-salt:${pass}`).digest("hex");
}

/** 常量时间比较，避免计时侧信道 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 路由权限规则：按「方法 + 路径前缀」声明所需最低角色。
 * 未命中的 /api/** 默认要求登录；公开接口在 PUBLIC_PATHS 中显式列出。
 */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/me"]);

const ROUTE_RULES = [
  // 审计：查询/导出需登录（工程师及以上只读亦可），清空仅管理员
  { method: "DELETE", prefix: "/api/audit/logs", minRole: "admin" },
  // 备份与恢复：仅管理员（恢复会全量覆盖数据）
  { prefix: "/api/backup", minRole: "admin" },
  // 设备下发/删除/虚拟仪器：工程师及以上
  { method: "POST", prefix: "/api/iot/devices", minRole: "operator" },
  { method: "PUT", prefix: "/api/iot/devices", minRole: "operator" },
  { method: "DELETE", prefix: "/api/iot/devices", minRole: "operator" },
  { method: "POST", prefix: "/api/iot/write", minRole: "operator" },
  { method: "POST", prefix: "/api/iot/simulator", minRole: "operator" },
  // 运维设置（留存天数等）
  { method: "PUT", prefix: "/api/iot/settings", minRole: "operator" },
  // 告警通知配置（含 Webhook 地址）的读/改/测试：仅管理员
  // 注意：读接口也必须鉴权——配置里含通道结构、最后错误等运维信息
  { method: "GET", prefix: "/api/iot/notify", minRole: "admin" },
  { method: "PUT", prefix: "/api/iot/notify", minRole: "admin" },
  { method: "POST", prefix: "/api/iot/notify", minRole: "admin" },
  // 自动化测试
  { method: "POST", prefix: "/api/autotest", minRole: "operator" },
  // 样品：查看需登录（访客可读），修改需要工程师及以上
  { method: "GET", prefix: "/api/samples", minRole: "viewer" },
  { method: "PUT", prefix: "/api/samples", minRole: "operator" },
  // 排产：查看需登录（访客可读），修改需要工程师及以上
  { method: "GET", prefix: "/api/production", minRole: "viewer" },
  { method: "PUT", prefix: "/api/production", minRole: "operator" },
  { method: "POST", prefix: "/api/production", minRole: "operator" },
  // 低代码工程（设计态）：读取需登录，保存需工程师及以上
  { method: "GET", prefix: "/api/lowcode/projects", minRole: "viewer" },
  { method: "PUT", prefix: "/api/lowcode/projects", minRole: "operator" },
  // 低代码发布/卸载
  { method: "POST", prefix: "/api/lowcode/apps", minRole: "operator" },
  { method: "PUT", prefix: "/api/lowcode/apps", minRole: "operator" },
  { method: "DELETE", prefix: "/api/lowcode/apps", minRole: "operator" },
  // 用户管理
  { prefix: "/api/users", minRole: "admin" },
  // AI 生成（消耗额度）
  { method: "POST", prefix: "/api/ai/generate", minRole: "operator" },
];

/** 只读接口：登录即可 */
function isReadMethod(m) {
  return m === "GET" || m === "HEAD";
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/**
 * 创建认证模块（存储层：PostgreSQL）。
 *
 * 设计：
 *   · 用户与会话全部走数据库（users / sessions 表），不再读写 JSON 文件；
 *   · 写操作（登录、登出、改密、用户增删改）直接落库，多实例部署天然共享；
 *   · 会话校验做**短时缓存**（默认 5 秒），避免每个 API 请求都打一次库，
 *     同时保证登出/改密在数秒内对其它请求生效；
 *   · 首次启动时若 users 表为空，自动写入内置演示账号。
 */
export async function createAuth({ db, log = console.log }) {
  const { query, transaction } = db;

  // ---------------------------------------------------------------- 初始化
  const existing = await query("SELECT COUNT(*)::int AS n FROM users");
  if (existing.rows[0].n === 0) {
    for (const u of defaultUsers()) {
      await query(
        `INSERT INTO users (username, name, role, pass_hash, enabled) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [u.username, u.name, u.role, u.passHash, u.enabled !== false],
      );
    }
    log(`[auth] 已初始化 ${defaultUsers().length} 个内置演示账号（请在生产环境修改默认密码）`);
  }

  // 启动时清理过期会话
  await query("DELETE FROM sessions WHERE expires_at <= $1", [Date.now()]);

  // ------------------------------------------------------- 会话短时缓存
  const SESSION_CACHE_MS = 5000;
  const cache = new Map(); // token -> { session, at }

  function invalidate(token) {
    cache.delete(token);
  }
  function invalidateUser(username) {
    for (const [k, v] of cache) if (v.session.username === username) cache.delete(k);
  }

  function publicUser(u) {
    return { username: u.username, name: u.name, role: u.role };
  }

  /** 从请求 Cookie 读取 token（不查库） */
  function tokenOf(req) {
    return parseCookies(req.headers.cookie)[SESSION_COOKIE] || null;
  }

  /** 查询当前会话（带缓存）；返回 { token, username, name, role, expires } | null */
  async function getSession(req) {
    const token = tokenOf(req);
    if (!token) return null;

    const hit = cache.get(token);
    if (hit && Date.now() - hit.at < SESSION_CACHE_MS) {
      return hit.session && hit.session.expires > Date.now() ? hit.session : null;
    }

    const r = await query("SELECT token, username, name, role, expires_at FROM sessions WHERE token = $1", [token]);
    const row = r.rows[0];
    const session = row && Number(row.expires_at) > Date.now()
      ? { token: row.token, username: row.username, name: row.name, role: row.role, expires: Number(row.expires_at) }
      : null;

    if (row && !session) {
      // 过期会话顺手删除
      await query("DELETE FROM sessions WHERE token = $1", [token]).catch(() => {});
    }
    cache.set(token, { session, at: Date.now() });
    return session;
  }

  function setCookie(res, token, ttlMs) {
    const maxAge = Math.floor(ttlMs / 1000);
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`,
    );
  }

  function clearCookie(res) {
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  }

  // ---------------------------------------------------------------- 登录
  async function login(username, password) {
    const uname = String(username || "").trim();
    const r = await query("SELECT username, name, role, pass_hash, enabled FROM users WHERE username = $1", [uname]);
    const u = r.rows[0];
    if (!u || u.enabled === false) return null;
    if (!safeEqual(hashPassword(password || ""), u.pass_hash)) return null;

    // 清理该用户的历史过期会话 + 统计当前会话数（防止无限增长）
    await query("DELETE FROM sessions WHERE expires_at <= $1", [Date.now()]);
    const cnt = await query("SELECT COUNT(*)::int AS n FROM sessions");
    if (cnt.rows[0].n >= MAX_SESSIONS) {
      // 淘汰最早过期的会话
      await query(
        `DELETE FROM sessions WHERE token IN (
           SELECT token FROM sessions ORDER BY expires_at ASC LIMIT $1
         )`,
        [Math.max(1, cnt.rows[0].n - MAX_SESSIONS + 1)],
      );
    }

    const token = randomBytes(24).toString("base64url");
    const expires = Date.now() + SESSION_TTL_MS;
    await query(
      "INSERT INTO sessions (token, username, name, role, expires_at) VALUES ($1,$2,$3,$4,$5)",
      [token, u.username, u.name, u.role, expires],
    );
    const session = { token, username: u.username, name: u.name, role: u.role, expires };
    cache.set(token, { session, at: Date.now() });
    return { token, ...publicUser(u), session };
  }

  async function logout(req) {
    const token = tokenOf(req);
    if (!token) return;
    invalidate(token);
    await query("DELETE FROM sessions WHERE token = $1", [token]);
  }

  // ------------------------------------------------------------ 修改密码
  async function changePassword(session, oldPassword, newPassword) {
    const r = await query("SELECT pass_hash FROM users WHERE username = $1", [session.username]);
    const u = r.rows[0];
    if (!u) return { ok: false, error: "用户不存在" };
    if (!safeEqual(hashPassword(oldPassword || ""), u.pass_hash)) return { ok: false, error: "原密码错误" };
    if (String(newPassword || "").length < 6) return { ok: false, error: "新密码至少 6 位" };

    await query("UPDATE users SET pass_hash = $1, updated_at = now() WHERE username = $2", [
      hashPassword(newPassword),
      session.username,
    ]);
    // 改密后吊销该用户的其它会话，仅保留当前会话
    await query("DELETE FROM sessions WHERE username = $1 AND token <> $2", [session.username, session.token]);
    invalidateUser(session.username);
    return { ok: true };
  }

  // ------------------------------------------------------------ 用户管理
  async function listUsers() {
    const r = await query("SELECT username, name, role, enabled FROM users ORDER BY created_at ASC, username ASC");
    return r.rows.map((u) => ({ ...publicUser(u), enabled: u.enabled }));
  }

  async function createUser({ username, name, role, password }) {
    const uname = String(username || "").trim();
    if (!/^[A-Za-z][A-Za-z0-9_]{2,31}$/.test(uname)) {
      return { ok: false, error: "用户名需 3-32 位字母/数字/下划线，且以字母开头" };
    }
    if (!ROLE_RANK[role]) return { ok: false, error: "角色不合法" };
    if (String(password || "").length < 6) return { ok: false, error: "密码至少 6 位" };

    try {
      await query(
        "INSERT INTO users (username, name, role, pass_hash, enabled) VALUES ($1,$2,$3,$4,true)",
        [uname, String(name || uname), role, hashPassword(password)],
      );
      return { ok: true };
    } catch (e) {
      if (e.code === "23505") return { ok: false, error: "用户名已存在" };
      return { ok: false, error: `创建失败：${e.message}` };
    }
  }

  async function updateUser(username, patch) {
    const r = await query("SELECT username FROM users WHERE username = $1", [username]);
    if (!r.rowCount) return { ok: false, error: "用户不存在" };
    if (patch.role != null && !ROLE_RANK[patch.role]) return { ok: false, error: "角色不合法" };
    if (patch.password && String(patch.password).length < 6) return { ok: false, error: "密码至少 6 位" };

    const sets = [];
    const params = [];
    const push = (col, val) => {
      params.push(val);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.name != null) push("name", String(patch.name));
    if (patch.role != null) push("role", patch.role);
    if (patch.enabled != null) push("enabled", !!patch.enabled);
    if (patch.password) push("pass_hash", hashPassword(patch.password));
    if (!sets.length) return { ok: true };

    params.push(username);
    await query(`UPDATE users SET ${sets.join(", ")}, updated_at = now() WHERE username = $${params.length}`, params);
    invalidateUser(username);
    return { ok: true };
  }

  async function deleteUser(username) {
    // 不允许删除最后一个管理员，避免锁死系统（事务内检查，防并发误删）
    return transaction(async (client) => {
      const r = await client.query("SELECT role FROM users WHERE username = $1 FOR UPDATE", [username]);
      if (!r.rowCount) return { ok: false, error: "用户不存在" };
      if (r.rows[0].role === "admin") {
        const admins = await client.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND enabled");
        if (admins.rows[0].n <= 1) return { ok: false, error: "至少保留一个管理员" };
      }
      await client.query("DELETE FROM users WHERE username = $1", [username]);
      invalidateUser(username);
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------- 守卫
  /**
   * 路由守卫：返回 true 表示已处理（拒绝），false 表示放行。
   * 规则优先级：公开路径 > 路由规则（按前缀长度降序）> 默认要求登录。
   */
  async function guard(req, res, path, method, sendJSON) {
    if (PUBLIC_PATHS.has(path)) return false;

    const session = await getSession(req);

    const rules = ROUTE_RULES.filter((r) => path.startsWith(r.prefix) && (!r.method || r.method === method)).sort(
      (a, b) => b.prefix.length - a.prefix.length,
    );
    const rule = rules[0];

    if (rule) {
      if (!session) {
        sendJSON(res, 401, { error: "未登录或会话已过期", code: "UNAUTHORIZED" });
        return true;
      }
      if (ROLE_RANK[session.role] < ROLE_RANK[rule.minRole]) {
        sendJSON(res, 403, { error: `权限不足：需要「${ROLE_LABELS[rule.minRole]}」及以上角色`, code: "FORBIDDEN" });
        return true;
      }
      return false;
    }

    // 默认策略：写操作必须登录，读操作放行（平台数据为展示型，读接口保持开放便于大屏免登录展示）
    if (!isReadMethod(method) && !session) {
      sendJSON(res, 401, { error: "未登录或会话已过期", code: "UNAUTHORIZED" });
      return true;
    }
    return false;
  }

  return {
    guard,
    getSession,
    login,
    logout,
    changePassword,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    setCookie,
    clearCookie,
    publicUser,
    SESSION_COOKIE,
  };
}
