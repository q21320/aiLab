// ============================================================================
// 操作日志（审计）· PostgreSQL 实现
//
// 接口：
//   POST   /api/audit/logs              写入（支持单条或批量，身份由服务端会话推导）
//   GET    /api/audit/logs              分页查询（模块/角色/用户/关键字/时间范围）
//   GET    /api/audit/logs/export.csv   按同样条件导出
//   GET    /api/audit/stats             统计（总数/今日/按模块）
//   DELETE /api/audit/logs              清理（?all=1 或 ?before=<时间戳>）
//
// 相比原 JSONL 实现的改进：
//   · 分页在数据库完成（LIMIT/OFFSET + time 索引），不再把 36 个月全部读进内存排序；
//   · 统计用聚合查询，几十万条也不会阻塞事件循环；
//   · 并发写入天然安全（原来 appendFileSync 在大并发下可能交错）。
// ============================================================================

import { csvText } from "./csv.mjs";

/** 默认留存月数（仅用于展示与清理策略说明） */
const RETENTION_MONTHS = 36;

export function createAuditRoutes({ sendJSON, readBody, db, dataDir, getActor }) {
  const { query } = db;

  /** 规范化单条日志：去掉换行避免破坏展示，截断超长字段 */
  function normalize(raw, actor) {
    const clean = (v, max) =>
      String(v == null ? "" : v)
        .replace(/[\r\n]+/g, " ")
        .slice(0, max);
    return {
      time: typeof raw.time === "number" && raw.time > 0 ? raw.time : Date.now(),
      // 身份优先取服务端会话，客户端自报的值不可信
      username: clean(actor?.name || raw.user || "系统", 64),
      role: clean(actor?.role || raw.role || "viewer", 16),
      module: clean(raw.module || "其他", 32),
      action: clean(raw.action || "", 64),
      detail: clean(raw.detail || "", 500),
    };
  }

  /** 服务端直接写日志（登录/权限变更等），actor 必传 */
  async function log(entry, actor) {
    try {
      const e = normalize(entry, actor);
      await query(
        `INSERT INTO audit_logs (time, username, role, module, action, detail) VALUES ($1,$2,$3,$4,$5,$6)`,
        [e.time, e.username, e.role, e.module, e.action, e.detail],
      );
      return true;
    } catch (err) {
      console.error("[audit] 写入失败：", err.message);
      return false;
    }
  }

  /** 把查询参数拼成 WHERE 子句（参数化，防注入） */
  function buildWhere({ module, role, user, keyword, from, to }) {
    const conds = [];
    const params = [];
    const add = (sql, val) => {
      params.push(val);
      conds.push(sql.replace("?", `$${params.length}`));
    };
    if (from) add("time >= ?", from);
    if (to) add("time <= ?", to);
    if (module) add("module = ?", module);
    if (role) add("role = ?", role);
    if (user) add("username ILIKE ?", `%${user}%`);
    if (keyword) {
      const like = `%${keyword}%`;
      params.push(like, like, like, like);
      const n = params.length;
      conds.push(`(action ILIKE $${n - 3} OR detail ILIKE $${n - 2} OR username ILIKE $${n - 1} OR module ILIKE $${n})`);
    }
    return { where: conds.length ? `WHERE ${conds.join(" AND ")}` : "", params };
  }

  const toRow = (r) => ({
    time: Number(r.time),
    user: r.username,
    role: r.role,
    module: r.module,
    action: r.action,
    detail: r.detail,
  });

  /** 分页查询（数据库内完成分页） */
  async function queryPage(opts) {
    const { where, params } = buildWhere(opts);
    const pageSize = Math.min(Math.max(Number(opts.pageSize) || 20, 1), 500);
    const page = Math.max(Number(opts.page) || 1, 1);
    const offset = (page - 1) * pageSize;

    const totalRes = await query(`SELECT COUNT(*)::int AS n FROM audit_logs ${where}`, params);
    const listRes = await query(
      `SELECT time, username, role, module, action, detail
         FROM audit_logs ${where}
         ORDER BY time DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pageSize, offset],
    );
    return { rows: listRes.rows.map(toRow), total: totalRes.rows[0].n, page, pageSize };
  }

  /** 导出用：不分页但设上限，避免一次拉爆内存 */
  async function queryAll(opts, limit = 100000) {
    const { where, params } = buildWhere(opts);
    const r = await query(
      `SELECT time, username, role, module, action, detail FROM audit_logs ${where}
        ORDER BY time DESC, id DESC LIMIT $${params.length + 1}`,
      [...params, limit],
    );
    return r.rows.map(toRow);
  }

  function csvOf(rows) {
    // 全字段转义 + 防公式注入
    return csvText(
      ["时间", "用户", "角色", "模块", "操作", "详情"],
      rows.map((r) => [new Date(r.time).toLocaleString("zh-CN"), r.user, r.role, r.module, r.action, r.detail]),
    );
  }

  function parseQuery(url) {
    return {
      module: url.searchParams.get("module") || undefined,
      role: url.searchParams.get("role") || undefined,
      user: url.searchParams.get("user") || undefined,
      keyword: url.searchParams.get("keyword") || undefined,
      from: Number(url.searchParams.get("from")) || undefined,
      to: Number(url.searchParams.get("to")) || undefined,
      page: Number(url.searchParams.get("page")) || 1,
      pageSize: Number(url.searchParams.get("pageSize")) || 20,
    };
  }

  async function handle(req, res, path, method) {
    // 身份一律由服务端会话推导（getActor 可能是异步的）
    const actor = typeof getActor === "function" ? await getActor(req) : null;

    // ---------------- 写入（支持单条或批量） ----------------
    if (method === "POST" && path === "/api/audit/logs") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { ok: false, error: "请求体 JSON 解析失败" });
        return true;
      }
      const list = Array.isArray(body.logs) ? body.logs : body.log ? [body.log] : [];
      if (!list.length) {
        sendJSON(res, 400, { ok: false, error: "缺少 logs 数组" });
        return true;
      }
      const entries = list.slice(0, 200).map((raw) => normalize(raw, actor));
      const params = [];
      const tuples = entries.map((e, i) => {
        const b = i * 6;
        params.push(e.time, e.username, e.role, e.module, e.action, e.detail);
        return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`;
      });
      try {
        await query(`INSERT INTO audit_logs (time, username, role, module, action, detail) VALUES ${tuples.join(",")}`, params);
        sendJSON(res, 200, { ok: true, saved: entries.length });
      } catch (e) {
        console.error("[audit] 批量写入失败：", e.message);
        sendJSON(res, 500, { ok: false, error: "日志写入失败" });
      }
      return true;
    }

    // ---------------- 导出 CSV ----------------
    if (method === "GET" && path === "/api/audit/logs/export.csv") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      try {
        const rows = await queryAll(parseQuery(url));
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="audit-logs.csv"`,
        });
        res.end(csvOf(rows));
      } catch (e) {
        console.error("[audit] 导出失败：", e.message);
        sendJSON(res, 500, { error: "导出失败" });
      }
      return true;
    }

    // ---------------- 统计 ----------------
    if (method === "GET" && path === "/api/audit/stats") {
      try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const [totalRes, todayRes, byModuleRes] = await Promise.all([
          query("SELECT COUNT(*)::int AS n FROM audit_logs"),
          query("SELECT COUNT(*)::int AS n FROM audit_logs WHERE time >= $1", [today.getTime()]),
          query("SELECT module, COUNT(*)::int AS n FROM audit_logs GROUP BY module ORDER BY n DESC"),
        ]);
        const byModule = {};
        for (const r of byModuleRes.rows) byModule[r.module] = r.n;
        sendJSON(res, 200, {
          total: totalRes.rows[0].n,
          today: todayRes.rows[0].n,
          byModule,
          storage: "PostgreSQL",
          retentionMonths: RETENTION_MONTHS,
        });
      } catch (e) {
        console.error("[audit] 统计失败：", e.message);
        sendJSON(res, 500, { error: "统计失败" });
      }
      return true;
    }

    // ---------------- 清理 ----------------
    if (method === "DELETE" && path === "/api/audit/logs") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const all = url.searchParams.get("all") === "1";
      const before = Number(url.searchParams.get("before")) || 0;
      if (!all && !before) {
        sendJSON(res, 400, { error: "请指定 ?all=1 或 ?before=<时间戳>" });
        return true;
      }
      try {
        const r = all
          ? await query("DELETE FROM audit_logs")
          : await query("DELETE FROM audit_logs WHERE time < $1", [before]);
        sendJSON(res, 200, { ok: true, removed: r.rowCount });
      } catch (e) {
        console.error("[audit] 清理失败：", e.message);
        sendJSON(res, 500, { error: "清理失败" });
      }
      return true;
    }

    // ---------------- 分页查询 ----------------
    if (method === "GET" && path === "/api/audit/logs") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      try {
        const { rows, total, page, pageSize } = await queryPage(parseQuery(url));
        sendJSON(res, 200, { logs: rows, total, page, pageSize });
      } catch (e) {
        console.error("[audit] 查询失败：", e.message);
        sendJSON(res, 500, { error: "查询失败", logs: [], total: 0 });
      }
      return true;
    }

    return false;
  }

  handle.log = log;
  return handle;
}
