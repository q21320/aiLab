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

export function createCrudRoutes({ sendJSON, readBody, dataFile, database }) {
  /** 安全解码路径参数：畸形百分号编码返回 400，而不是抛出 URIError 打挂请求 */
  function safeDecode(v) {
    try {
      return decodeURIComponent(String(v));
    } catch {
      const e = new Error("路径参数编码非法");
      e.statusCode = 400;
      throw e;
    }
  }
  const dbConn = database || null;

  // 存储：内存模型 + PostgreSQL 持久化
  // （业务代码仍操作 db 对象；每次变更后异步落库，并发写入走 UPSERT 不再整份覆盖）
  let db = seedDb();
  /** 数据库就绪后由外部注入初值（从数据库读取或从旧 JSON 迁移） */
  function hydrate(data) {
    if (data && typeof data === "object" && Object.keys(data).length) db = data;
  }

  function persist() {
    if (!dbConn) return;
    const snapshot = JSON.parse(JSON.stringify(db));
    dbConn
      .transaction(async (client) => {
        for (const [resource, res] of Object.entries(snapshot)) {
          await client.query(
            `INSERT INTO crud_resources (resource, fields) VALUES ($1, $2::jsonb)
             ON CONFLICT (resource) DO UPDATE SET fields = EXCLUDED.fields`,
            [resource, JSON.stringify(res.fields || [])],
          );
          // 以「整资源替换」方式同步行数据，保证与内存模型一致
          await client.query("DELETE FROM crud_rows WHERE resource = $1", [resource]);
          for (const row of res.rows || []) {
            await client.query("INSERT INTO crud_rows (resource, id, data, updated_at) VALUES ($1,$2,$3::jsonb,$4)", [
              resource,
              String(row.id),
              JSON.stringify(row),
              Number(row.updatedAt) || Date.now(),
            ]);
          }
        }
      })
      .catch((e) => console.error("[crud] 保存数据失败：", e.message));
  }

  /** 资源名白名单：防止任意 URL / 原型键（__proto__、constructor）落盘 */
  const RESOURCE_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/;
  function isValidResource(name) {
    return RESOURCE_RE.test(String(name || ""));
  }
  /** 只读取现有资源，不存在返回 null（GET 不再凭空创建资源） */
  function getResource(name) {
    if (!name || !Object.hasOwn(db, name)) return null;
    return db[name];
  }

  function ensureResource(name) {
    if (!Object.hasOwn(db, name)) {
      db[name] = { fields: [{ prop: "id", label: "ID", type: "text", required: true }], rows: [] };
      persist();
    }
    return db[name];
  }

  /**
   * 解析并校验资源名；非法时直接回 400 并返回 null。
   * create=true 表示当前操作允许新建资源（仅写入类操作）。
   */
  function resolveResource(res, name, { create = false } = {}) {
    if (!isValidResource(name)) {
      sendJSON(res, 400, { error: "资源名非法：需字母开头，仅含字母/数字/下划线/短横线（≤41 字符）" });
      return null;
    }
    const found = getResource(name);
    if (found) return found;
    if (!create) {
      sendJSON(res, 404, { error: `资源不存在：${name}` });
      return null;
    }
    return ensureResource(name);
  }

  /** 推断字段：合并注册元数据与首行数据推断（确保不被只有 id 的初始注册卡住） */
  function inferFields(res) {
    const registered = res.fields || [];
    const first = res.rows[0];
    if (!first) return registered;
    // 从首行推断完整字段集
    const inferred = Object.keys(first)
      .filter((k) => !["createdAt", "updatedAt"].includes(k))
      .map((k) => {
        const v = first[k];
        const type = typeof v === "number" ? "number" : typeof v === "boolean" ? "switch" : "text";
        return { prop: k, label: k, type: FIELD_TYPES.includes(type) ? type : "text" };
      });
    // 合并：注册信息优先（保留 label/type/required/options），缺失的从推断补
    const regMap = new Map(registered.map((f) => [f.prop, f]));
    const merged = inferred.map((inf) => {
      const reg = regMap.get(inf.prop);
      if (!reg) return inf;
      // 合并：保留注册字段的 label/required/options/type（若注册有值的话）
      return { ...inf, ...Object.fromEntries(Object.entries(reg).filter(([, v]) => v !== undefined && v !== "")) };
    });
    // 确保 registered 中有但 inferred 中没有的字段也保留（如自定义注册字段）
    for (const reg of registered) {
      if (!merged.some((m) => m.prop === reg.prop)) merged.push(reg);
    }
    return merged;
  }

  const ok = (res, data) => sendJSON(res, 200, { ok: true, ...data });

  async function handle(req, res, path, method) {
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
      const name = safeDecode(listMatch[1]);
      // GET 只读：不存在的资源返回 404，不再因为拼错名字就落盘一个空表
      const r = resolveResource(res, name, { create: method === "POST" });
      if (!r) return true;
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
          // id 为系统主键：缺失时下方会自动生成，不应作为用户必填字段拦截（否则无 id 字段的表单无法提交）
          if (f.prop === "id") continue;
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
      const name = safeDecode(metaMatch[1]);
      const r = resolveResource(res, name);
      ok(res, { resource: name, fields: inferFields(r), count: r.rows.length });
      return true;
    }

    // 详情 / 修改 / 删除：/api/crud/:resource/:id
    const itemMatch = path.match(/^\/api\/crud\/([^/]+)\/([^/]+)$/);
    if (itemMatch) {
      const name = safeDecode(itemMatch[1]);
      const id = safeDecode(itemMatch[2]);
      const r = resolveResource(res, name, { create: method === "PUT" || method === "POST" });
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
  }

  // 暴露给 server.mjs：用数据库中的初始数据填充内存模型
  handle.hydrate = hydrate;
  handle.snapshot = () => JSON.parse(JSON.stringify(db));
  return handle;
}
