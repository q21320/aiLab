// ============================================================================
// 操作日志（审计）· 后端持久化
//
// 设计要点（对标 4.8 存储≥3年 / 4.9 操作日志）：
//   · 不再限制条数：按月写入 JSONL 追加文件 backend/data/audit/audit-YYYY-MM.jsonl
//   · 查询支持 分页 + 模块/角色/用户/关键字/时间范围 过滤，跨月自动合并读取
//   · 导出 CSV、按范围清理、留存策略（默认保留 36 个月，超期归档文件不自动删除，
//     仅当显式调用清理且超过留存期时才会移除）
//
// 接口：
//   POST   /api/audit/logs            批量写入 [{module,action,detail,user,role,time}]
//   GET    /api/audit/logs            分页查询（?page&pageSize&module&role&user&keyword&from&to）
//   GET    /api/audit/logs/export.csv 按同样条件导出
//   GET    /api/audit/stats           统计（总数/今日/按模块 Top）
//   DELETE /api/audit/logs            清理（?before=时间戳 或 all=1）
// ============================================================================

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const RETENTION_MONTHS = 36; // 留存 3 年

function monthKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function createAuditRoutes({ sendJSON, readBody, dataDir }) {
  const dir = join(dataDir, "audit");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const fileOf = (m) => join(dir, `audit-${m}.jsonl`);

  function monthsInRange(from, to) {
    const out = [];
    const start = new Date(from || Date.now() - 30 * 86400000);
    const end = new Date(to || Date.now());
    const cur = new Date(start.getFullYear(), start.getMonth(), 1);
    while (cur <= end) {
      out.push(monthKey(cur.getTime()));
      cur.setMonth(cur.getMonth() + 1);
    }
    return Array.from(new Set(out));
  }

  function allMonthFiles() {
    try {
      return readdirSync(dir)
        .filter((f) => /^audit-\d{4}-\d{2}\.jsonl$/.test(f))
        .sort()
        .reverse(); // 最新在前
    } catch {
      return [];
    }
  }

  /** 读取（可限定月份）并过滤 */
  function query({ module, role, user, keyword, from, to }) {
    const files = from || to ? monthsInRange(from, to).map((m) => `audit-${m}.jsonl`) : allMonthFiles();
    const rows = [];
    for (const f of files) {
      const full = join(dir, f);
      if (!existsSync(full)) continue;
      const text = readFileSync(full, "utf-8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue;
        }
        if (from && e.time < from) continue;
        if (to && e.time > to) continue;
        if (module && e.module !== module) continue;
        if (role && e.role !== role) continue;
        if (user && !String(e.user || "").includes(user)) continue;
        if (keyword) {
          const k = keyword.toLowerCase();
          const hit = [e.action, e.detail, e.user, e.module].some((v) =>
            String(v || "").toLowerCase().includes(k)
          );
          if (!hit) continue;
        }
        rows.push(e);
      }
    }
    rows.sort((a, b) => (b.time || 0) - (a.time || 0));
    return rows;
  }

  function csvOf(rows) {
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = "时间,用户,角色,模块,操作,详情";
    return (
      "\uFEFF" +
      [header, ...rows.map((r) => [new Date(r.time).toLocaleString("zh-CN"), r.user, r.role, r.module, r.action, esc(r.detail)].join(","))].join("\n")
    );
  }

  return async function handle(req, res, path, method) {
    // 写入（支持单条或批量）
    if (method === "POST" && path === "/api/audit/logs") {
      try {
        const body = await readBody(req);
        const list = Array.isArray(body.logs) ? body.logs : body.log ? [body.log] : [];
        if (!list.length) {
          sendJSON(res, 400, { ok: false, error: "缺少 logs 数组" });
          return true;
        }
        const byMonth = new Map();
        for (const raw of list) {
          const entry = {
            time: Number(raw.time) || Date.now(),
            user: String(raw.user || "系统"),
            role: String(raw.role || "viewer"),
            module: String(raw.module || "其他"),
            action: String(raw.action || ""),
            detail: String(raw.detail || ""),
          };
          const m = monthKey(entry.time);
          if (!byMonth.has(m)) byMonth.set(m, []);
          byMonth.get(m).push(JSON.stringify(entry));
        }
        for (const [m, lines] of byMonth) {
          appendFileSync(fileOf(m), lines.join("\n") + "\n", "utf-8");
        }
        sendJSON(res, 200, { ok: true, saved: list.length });
      } catch {
        sendJSON(res, 400, { ok: false, error: "请求体 JSON 解析失败" });
      }
      return true;
    }

    // 导出 CSV
    if (method === "GET" && path === "/api/audit/logs/export.csv") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const rows = query({
        module: url.searchParams.get("module") || undefined,
        role: url.searchParams.get("role") || undefined,
        user: url.searchParams.get("user") || undefined,
        keyword: url.searchParams.get("keyword") || undefined,
        from: Number(url.searchParams.get("from")) || undefined,
        to: Number(url.searchParams.get("to")) || undefined,
      });
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="audit-logs.csv"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(csvOf(rows));
      return true;
    }

    // 统计
    if (method === "GET" && path === "/api/audit/stats") {
      const rows = query({});
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const byModule = {};
      for (const r of rows) byModule[r.module] = (byModule[r.module] || 0) + 1;
      sendJSON(res, 200, {
        total: rows.length,
        today: rows.filter((r) => r.time >= today.getTime()).length,
        byModule,
        files: allMonthFiles(),
        retentionMonths: RETENTION_MONTHS,
        dir,
      });
      return true;
    }

    // 清理
    if (method === "DELETE" && path === "/api/audit/logs") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const all = url.searchParams.get("all") === "1";
      const before = Number(url.searchParams.get("before")) || 0;
      let removed = 0;
      for (const f of allMonthFiles()) {
        const full = join(dir, f);
        const text = readFileSync(full, "utf-8");
        const lines = text.split("\n").filter((l) => l.trim());
        if (all) {
          removed += lines.length;
          writeFileSync(full, "", "utf-8");
          continue;
        }
        if (!before) continue;
        const keep = [];
        for (const l of lines) {
          try {
            const e = JSON.parse(l);
            if (e.time < before) removed += 1;
            else keep.push(l);
          } catch {
            /* 丢弃坏行 */
          }
        }
        writeFileSync(full, keep.length ? keep.join("\n") + "\n" : "", "utf-8");
      }
      sendJSON(res, 200, { ok: true, removed });
      return true;
    }

    // 分页查询
    if (method === "GET" && path === "/api/audit/logs") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
      const rows = query({
        module: url.searchParams.get("module") || undefined,
        role: url.searchParams.get("role") || undefined,
        user: url.searchParams.get("user") || undefined,
        keyword: url.searchParams.get("keyword") || undefined,
        from: Number(url.searchParams.get("from")) || undefined,
        to: Number(url.searchParams.get("to")) || undefined,
      });
      const start = (page - 1) * pageSize;
      sendJSON(res, 200, {
        logs: rows.slice(start, start + pageSize),
        total: rows.length,
        page,
        pageSize,
      });
      return true;
    }

    return false;
  };
}
