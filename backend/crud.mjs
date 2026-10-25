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

// ---------------------------------------------------------------------------
// 台账编号自动生成（与前端 resources.ts 中标记 autoNo 的字段一一对应）
//   项目分两个模块，编号靠前缀区分、各自独立排序：
//     自测项目   lab_projects            → Z-20261025-0001
//     委外项目   lab_outsource_projects  → W-20261025-0001
//   序号以日期为分组键，跨天自动从 0001 重新开始；
//   日期优先取该行填写的「日期」字段（便于补录昨天的项目归入昨天的序列），
//   没填或格式不对则取今天。
//   为何放在服务端：编号是业务主键，两人同时录入时仅靠前端算会重号。
// ---------------------------------------------------------------------------
const AUTO_NO_RULES = {
  lab_projects: { field: "projectNo", dateField: "date", pad: 4, prefix: "Z-" },
  lab_outsource_projects: { field: "projectNo", dateField: "date", pad: 4, prefix: "W-" },
};
/** “像自动生成的编号”：只在这种情况下才拿服务端值覆盖前端预览值（兼容早期的无前缀写法） */
const AUTO_NO_SHAPE = /^(?:[A-Z]{1,2}-?)?\d{8}-\d{4,}$/;

function dayKey(v) {
  const digits = String(v ?? "").replace(/\D/g, "");
  if (digits.length >= 8) return digits.slice(0, 8);
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** 编号前缀（如 Z- / W-）拼进正则前先转义，避免特殊字符把模式改坏 */
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 单次批量导入的行数上限：防止一次灌入超大文件把「整资源替换」写抖住 */
const MAX_IMPORT_ROWS = 1000;

/** 扫描同日期已有编号取最大序号 +1（台账量级小，内存全量扫描比建序列表更划算） */
function computeNextNo(rows, rule, dateVal) {
  const base = `${rule.prefix || ""}${dayKey(dateVal)}`;
  const re = new RegExp(`^${reEsc(base)}-(\\d+)$`);
  let max = 0;
  for (const row of rows || []) {
    const m = re.exec(String(row?.[rule.field] ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${base}-${String(max + 1).padStart(rule.pad || 4, "0")}`;
}

/**
 * 生成行 ID：时间戳（36 进制）+ 随机后缀。
 * 只用时间戳时，同一毫秒内的连续写入（批量导入 / 脚本灌数据 / 快速连点）
 * 会算出同一个 ID 并回 409，这里用后缀 + 重查兼顾可读性与不重号。
 * @param takenSet 占用集合；批量导入必须传——本批已生成的行还没进 rows，
 *                 只按 rows 重查会让同毫秒的两行拿到同一个 ID。
 */
function genRowId(name, rows, takenSet) {
  const prefix = name.slice(0, 3).toUpperCase();
  const stamp = Date.now().toString(36).toUpperCase();
  const taken = takenSet || new Set((rows || []).map((x) => String(x?.id ?? "")));
  let id = `${prefix}-${stamp}`;
  for (let i = 0; i < 40 && taken.has(id); i += 1) {
    id = `${prefix}-${stamp}${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
  return id;
}

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
  // （业务代码只操作 db 对象；每次变更后异步落库）
  let db = seedDb();
  /** 数据库就绪后由外部注入初值（从数据库读取或从旧 JSON 迁移） */
  function hydrate(data) {
    if (data && typeof data === "object" && Object.keys(data).length) db = data;
  }

  // 落库必须串行：写入采用「整资源替换」（先 DELETE 再批量 INSERT），若两次 persist()
  // 并发提交，先取快照的那次可能后提交，用旧数据覆盖新数据（快速连续新增会丢行）。
  // 同一时刻只跑一个事务；写入期间发生的变更只记下“待写”状态，写完再补一轮最新快照。
  let writing = false;
  let dirty = false;

  async function drainWrites() {
    writing = true;
    while (dirty) {
      dirty = false;
      const snapshot = JSON.parse(JSON.stringify(db));
      try {
        await dbConn.transaction(async (client) => {
          for (const [resource, res] of Object.entries(snapshot)) {
            await client.query(
              `INSERT INTO crud_resources (resource, fields) VALUES ($1, $2::jsonb)
               ON CONFLICT (resource) DO UPDATE SET fields = EXCLUDED.fields`,
              [resource, JSON.stringify(res.fields || [])],
            );
            // 以「整资源替换」方式同步行数据，保证与内存模型一致（seq 存下标 → 重启后顺序不变）
            await client.query("DELETE FROM crud_rows WHERE resource = $1", [resource]);
            for (const [i, row] of (res.rows || []).entries()) {
              await client.query("INSERT INTO crud_rows (resource, id, data, updated_at, seq) VALUES ($1,$2,$3::jsonb,$4,$5)", [
                resource,
                String(row.id),
                JSON.stringify(row),
                Number(row.updatedAt) || Date.now(),
                i,
              ]);
            }
          }
        });
      } catch (e) {
        console.error("[crud] 保存数据失败：", e.message);
      }
    }
    writing = false;
  }

  function persist() {
    if (!dbConn) return;
    dirty = true;
    if (!writing) void drainWrites();
  }
  /** 退出前等落库排空，避免最后一笔变更没写完（备份/恢复与优雅关闭可用） */
  async function flush() {
    while (writing || dirty) {
      if (!writing) void drainWrites();
      await new Promise((r) => setTimeout(r, 50));
    }
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
        // 自动编号：在必填校验之前分配（readBody 之后到下面 unshift 之间没有任何 await，
        // 处于同一个事件循环回合 → 算号与入库之间不可能被别的请求插队重号）
        const rule = AUTO_NO_RULES[name];
        if (rule) {
          const given = String(data[rule.field] ?? "").trim();
          // 留空 → 用服务端编号；提交的是同形状的值（表单预览）→ 也用服务端最新值，
          // 避免两个会话拿到同一预览值后先提交的成功、后提交的报重号；
          // 手工沿用旧编号体系（不像自动形状）→ 尊重手工值，只拒绝重复
          data[rule.field] = !given || AUTO_NO_SHAPE.test(given) ? computeNextNo(r.rows, rule, data[rule.dateField]) : given;
          const dup = r.rows.some((x) => String(x?.[rule.field] ?? "").trim() === data[rule.field]);
          if (dup) {
            sendJSON(res, 409, { ok: false, error: `编号「${data[rule.field]}」已存在，请重新打开表单获取新编号` });
            return true;
          }
        }
        for (const f of fields) {
          // id 为系统主键：缺失时下方会自动生成，不应作为用户必填字段拦截（否则无 id 字段的表单无法提交）
          if (f.prop === "id") continue;
          if (f.required && (data[f.prop] === undefined || data[f.prop] === "")) {
            sendJSON(res, 400, { ok: false, error: `字段「${f.label || f.prop}」为必填` });
            return true;
          }
        }
        const row = { ...data };
        if (!row.id) row.id = genRowId(name, r.rows);
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
      if (!r) return true;
      ok(res, { resource: name, fields: inferFields(r), count: r.rows.length });
      return true;
    }

    // 下一个自动编号预览（新增表单打开时展示用）：必须放在 /:resource/:id 之前，
    // 否则会被当成 id 为 "next-no" 的详情请求
    const nextNoMatch = path.match(/^\/api\/crud\/([^/]+)\/next-no$/);
    if (method === "GET" && nextNoMatch) {
      const name = safeDecode(nextNoMatch[1]);
      const rule = AUTO_NO_RULES[name];
      if (!rule) {
        sendJSON(res, 404, { ok: false, error: `「${name}」未配置自动编号` });
        return true;
      }
      // 资源还不存在（台账里还没有一条数据）也算得出来，不回 404、也不凭空建资源
      const r = getResource(name);
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const value = computeNextNo(r?.rows, rule, url.searchParams.get(rule.dateField));
      ok(res, { resource: name, field: rule.field, value });
      return true;
    }

    // 批量导入（台账「导入」按钮）：一次校验 N 行、一次落库，避开逐条 POST 产出的 N 次「整资源替换」；
    // 必须放在 /:resource/:id 之前，否则会被当成 id 为 "import" 的详情请求
    const importMatch = path.match(/^\/api\/crud\/([^/]+)\/import$/);
    if (method === "POST" && importMatch) {
      const name = safeDecode(importMatch[1]);
      const r = resolveResource(res, name, { create: true });
      if (!r) return true;
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { ok: false, error: "请求体 JSON 解析失败" });
        return true;
      }
      const input = Array.isArray(body?.rows) ? body.rows : null;
      if (!input) {
        sendJSON(res, 400, { ok: false, error: "rows 应为待导入行的数组" });
        return true;
      }
      if (input.length > MAX_IMPORT_ROWS) {
        sendJSON(res, 400, { ok: false, error: `单次最多导入 ${MAX_IMPORT_ROWS} 行，请拆分文件` });
        return true;
      }
      const rule = AUTO_NO_RULES[name];
      /**
       * 必填复核的字段元数据来源。
       * 实验室台账这类模块的字段定义活在前端（后端只存 JSON 行），资源登记里常常只有初始的 id 字段，
       * 直接拿 inferFields 会得到“全部非必填”→ 服务端校验形同虚设。所以导入允许随请求带上字段表，
       * 没带时回落到资源已登记/推断的元数据（低代码自建资源那种情况）。
       */
      const reqFields = Array.isArray(body?.fields)
        ? body.fields
            .filter((f) => f && typeof f === "object" && /^[A-Za-z_][\w.]*$/.test(String(f.prop || "")))
            .map((f) => ({ prop: String(f.prop), label: String(f.label || f.prop), required: f.required === true }))
        : null;
      const fields = reqFields?.length ? reqFields : inferFields(r);
      // dryRun：只跑服务端校验不写库；skipErrors=false：有任何错误行则整批不导（相当于回滚）
      const dryRun = body?.dryRun === true;
      const skipErrors = body?.skipErrors !== false;
      const taken = new Set(r.rows.map((x) => String(x?.id ?? "")));
      const autoTaken = new Set(r.rows.map((x) => String(x?.[rule?.field ?? ""] ?? "").trim()));
      const errors = [];
      const prepared = [];
      input.forEach((raw, i) => {
        const rowNo = i + 1;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
          errors.push({ row: rowNo, error: "行内容应为字段对象" });
          return;
        }
        const item = JSON.parse(JSON.stringify(raw));
        if (rule) {
          // 与单条新增同规则：留空或形如自动编号（日期+序号）的都由服务端重算，同批内依次取号不互撞
          const given = String(item[rule.field] ?? "").trim();
          item[rule.field] = !given || AUTO_NO_SHAPE.test(given)
            ? computeNextNo([...r.rows, ...prepared], rule, item[rule.dateField])
            : given;
          // 只查占、不先占：否则一条被必填拦下的行会把号占住，后面合法的行反而被判成重号
          if (autoTaken.has(String(item[rule.field]))) {
            errors.push({ row: rowNo, error: `编号「${item[rule.field]}」已存在` });
            return;
          }
        }
        const missing = fields
          .filter(
            (f) =>
              f.prop !== "id" &&
              f.required &&
              (item[f.prop] === undefined || item[f.prop] === null || String(item[f.prop]).trim() === ""),
          )
          .map((f) => f.label || f.prop);
        if (missing.length) {
          errors.push({ row: rowNo, error: `缺少必填字段：${missing.join("、")}` });
          return;
        }
        if (!item.id) item.id = genRowId(name, r.rows, taken);
        if (taken.has(String(item.id))) {
          errors.push({ row: rowNo, error: `ID「${item.id}」重复` });
          return;
        }
        taken.add(String(item.id));
        if (rule) autoTaken.add(String(item[rule.field]));
        item.createdAt = Date.now();
        item.updatedAt = item.createdAt;
        prepared.push(item);
      });
      // 整批模式（skipErrors=false）下存在错误行时一行都不写，避免用户以为“导了一半”
      const abort = !skipErrors && errors.length > 0;
      if (!dryRun && !abort && prepared.length) {
        r.rows.unshift(...prepared);
        persist();
      }
      ok(res, {
        total: input.length,
        created: dryRun || abort ? 0 : prepared.length,
        rejected: errors.length,
        // 校验通过的行是否真正写库（dryRun / 整批回滚都为 false）
        saved: !dryRun && !abort && prepared.length > 0,
        errors,
      });
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
  handle.flush = flush;
  return handle;
}
