// ============================================================================
// 通用 CRUD 接口（低代码页面「数据表格」组件的默认数据源）
//
// 页面只需配置资源名（如 devices），即可获得完整的增删改查 + 分页 + 搜索：
//   GET    /api/crud/resources              资源列表（含字段定义与数据量）
//   GET    /api/crud/:resource              列表（?page=1&pageSize=20&keyword=&sort=）
//   POST   /api/crud/:resource              新增
//   GET    /api/crud/:resource/:id          详情
//   PUT    /api/crud/:resource/:id          修改
//   DELETE /api/crud/:resource/:id          删除
//
// 数据持久化：backend/data/crud.json
// 说明：真实项目可把本模块替换为数据库实现（接口形状保持不变，前端零改动）；
//       也可在页面里改成对接已有业务接口（api 模板 + 字段路径映射）。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const FIELD_TYPES = ["text", "number", "select", "date", "switch"];

function seedDb() {
  const now = Date.now();
  return {
    devices: {
      fields: [
        { prop: "id", label: "设备ID", type: "text", required: true },
        { prop: "name", label: "设备名称", type: "text", required: true },
        { prop: "template", label: "设备母版", type: "text" },
      ],
      rows: [
        { id: "213213", name: "ces", template: "demo", createdAt: now - 86400000, updatedAt: now - 86400000 },
        { id: "rcw", name: "RCWDemo", template: "demo", createdAt: now - 3600000, updatedAt: now - 1800000 },
      ],
    },
  };
}

export function createCrudRoutes({ sendJSON, readBody, dataFile }) {
  let db;
  try {
    db = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf-8")) : seedDb();
  } catch (e) {
    console.error("[crud] 读取数据失败，使用内置示例：", e.message);
    db = seedDb();
  }
  if (!db || typeof db !== "object" || Object.keys(db).length === 0) db = seedDb();

  function persist() {
    try {
      mkdirSync(dataFile.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
      writeFileSync(dataFile, JSON.stringify(db, null, 2), "utf-8");
    } catch (e) {
      console.error("[crud] 保存数据失败：", e.message);
    }
  }
  persist();

  function ensureResource(name) {
    if (!db[name]) {
      db[name] = { fields: [{ prop: "id", label: "ID", type: "text", required: true }], rows: [] };
      persist();
    }
    return db[name];
  }

  /** 推断字段（未配置时按首行数据生成） */
  function inferFields(res) {
    if (res.fields && res.fields.length) return res.fields;
    const first = res.rows[0];
    if (!first) return [];
    return Object.keys(first)
      .filter((k) => !["createdAt", "updatedAt"].includes(k))
      .map((k) => {
        const v = first[k];
        const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "switch" : "text";
        return { prop: k, label: k, type: FIELD_TYPES.includes(type) ? type : "text" };
      });
  }

  const ok = (res, data) => sendJSON(res, 200, { ok: true, ...data });

  return async function handle(req, res, path, method) {
    // 资源清单
    if (method === "GET" && path === "/api/crud/resources") {
      ok(res, {
        resources: Object.entries(db).map(([name, r]) => ({
          name,
          count: r.rows.length,
          fields: inferFields(r),
        })),
      });
      return true;
    }

    // 列表：/api/crud/:resource
    const listMatch = path.match(/^\/api\/crud\/([^/]+)$/);
    if (listMatch && (method === "GET" || method === "POST")) {
      const name = decodeURIComponent(listMatch[1]);
      const r = ensureResource(name);
      if (method === "GET") {
        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
        const page = Math.max(1, Number(url.searchParams.get("page") || 1));
        const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get("pageSize") || 20)));
        const keyword = (url.searchParams.get("keyword") || "").trim().toLowerCase();
        const sort = url.searchParams.get("sort") || "";
        const order = url.searchParams.get("order") === "desc" ? -1 : 1;

        let rows = r.rows.slice();
        if (keyword) {
          rows = rows.filter((row) =>
            Object.values(row).some((v) => String(v ?? "").toLowerCase().includes(keyword))
          );
        }
        if (sort) {
          rows.sort((a, b) => {
            const x = a[sort];
            const y = b[sort];
            if (typeof x === "number" && typeof y === "number") return (x - y) * order;
            return String(x ?? "").localeCompare(String(y ?? ""), "zh-CN") * order;
          });
        }
        const total = rows.length;
        const start = (page - 1) * pageSize;
        ok(res, {
          resource: name,
          fields: inferFields(r),
          list: rows.slice(start, start + pageSize),
          total,
          page,
          pageSize,
        });
        return true;
      }
      // 新增
      try {
        const body = await readBody(req);
        const data = body && body.data && typeof body.data === "object" ? body.data : body;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          sendJSON(res, 400, { ok: false, error: "请求体应为字段对象" });
          return true;
        }
        const fields = inferFields(r);
        for (const f of fields) {
          if (f.required && (data[f.prop] === undefined || data[f.prop] === "")) {
            sendJSON(res, 400, { ok: false, error: `字段「${f.label || f.prop}」为必填` });
            return true;
          }
        }
        const row = { ...data };
        if (!row.id) row.id = `${name.slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
        if (r.rows.some((x) => String(x.id) === String(row.id))) {
          sendJSON(res, 409, { ok: false, error: `ID「${row.id}」已存在` });
          return true;
        }
        row.createdAt = Date.now();
        row.updatedAt = row.createdAt;
        r.rows.unshift(row);
        persist();
        ok(res, { row });
        return true;
      } catch {
        sendJSON(res, 400, { ok: false, error: "请求体 JSON 解析失败" });
        return true;
      }
    }

    // 资源字段元数据（供设计器自动带出列/表单字段）—— 必须放在 /:resource/:id 之前
    const metaMatch = path.match(/^\/api\/crud\/([^/]+)\/meta$/);
    if (method === "GET" && metaMatch) {
      const name = decodeURIComponent(metaMatch[1]);
      const r = ensureResource(name);
      ok(res, { resource: name, fields: inferFields(r), count: r.rows.length });
      return true;
    }

    // 详情 / 修改 / 删除：/api/crud/:resource/:id
    const itemMatch = path.match(/^\/api\/crud\/([^/]+)\/([^/]+)$/);
    if (itemMatch) {
      const name = decodeURIComponent(itemMatch[1]);
      const id = decodeURIComponent(itemMatch[2]);
      const r = ensureResource(name);
      const idx = r.rows.findIndex((x) => String(x.id) === String(id));
      if (method === "GET") {
        if (idx < 0) {
          sendJSON(res, 404, { ok: false, error: "记录不存在" });
          return true;
        }
        ok(res, { row: r.rows[idx] });
        return true;
      }
      if (method === "PUT") {
        if (idx < 0) {
          sendJSON(res, 404, { ok: false, error: "记录不存在" });
          return true;
        }
        try {
          const body = await readBody(req);
          const data = body && body.data && typeof body.data === "object" ? body.data : body;
          const target = { ...r.rows[idx], ...data, id: r.rows[idx].id, updatedAt: Date.now() };
          r.rows[idx] = target;
          persist();
          ok(res, { row: target });
          return true;
        } catch {
          sendJSON(res, 400, { ok: false, error: "请求体 JSON 解析失败" });
          return true;
        }
      }
      if (method === "DELETE") {
        if (idx < 0) {
          sendJSON(res, 404, { ok: false, error: "记录不存在" });
          return true;
        }
        r.rows.splice(idx, 1);
        persist();
        ok(res, { deleted: id });
        return true;
      }
    }

    return false;
  };
}
