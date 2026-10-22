// ============================================================================
// 样品管理（4.5）· PostgreSQL 实现
//
// 接口：
//   GET  /api/samples          读取全部样品（含测试记录与履历）
//   PUT  /api/samples          保存全部样品（前端整体提交，带结构校验）
//
// 设计说明：
//   样品与其测试记录、履历日志是强关联的整体，采用整份 JSONB 文档存储，
//   与排产模块（kv_documents.production）保持一致。
//
//   相比此前的 localStorage：
//     · 换浏览器/清缓存不丢
//     · 多端共享，样品台账可多人协作
//     · 纳入统一备份（/api/backup）
// ============================================================================

const DOC_KEY = "samples";
/** 上限保护：样品数量过大时 JSON 文档会变慢，超过时提示归档 */
const MAX_SAMPLES = 20000;

const VALID_STATUS = ["in", "testing", "done", "out", "scrapped"];
const VALID_VERDICT = ["pass", "fail", "pending"];

/** 结构校验 */
function validate(list) {
  const errors = [];
  if (!Array.isArray(list)) return ["samples 必须是数组"];
  if (list.length > MAX_SAMPLES) errors.push(`样品数量超过上限 ${MAX_SAMPLES}`);

  const seen = new Set();
  for (const [i, s] of list.entries()) {
    const at = `样品 #${i + 1}`;
    if (!s || typeof s !== "object") {
      errors.push(`${at}：格式不正确`);
      continue;
    }
    if (!s.id || typeof s.id !== "string") errors.push(`${at}：缺少 id`);
    else if (seen.has(s.id)) errors.push(`样品 ${s.id}：编号重复`);
    else seen.add(s.id);

    if (!s.name) errors.push(`${at}（${s.id || "?"}）：缺少名称`);
    if (!VALID_STATUS.includes(s.status)) errors.push(`${at}（${s.id || "?"}）：状态「${s.status}」不合法`);
    if (!Array.isArray(s.tests)) errors.push(`${at}（${s.id || "?"}）：tests 必须是数组`);
    if (!Array.isArray(s.logs)) errors.push(`${at}（${s.id || "?"}）：logs 必须是数组`);

    // 测试记录抽样校验
    for (const [j, t] of (s.tests || []).entries()) {
      if (t && t.verdict !== undefined && !VALID_VERDICT.includes(t.verdict)) {
        errors.push(`${at} 测试 #${j + 1}：判定「${t.verdict}」不合法`);
      }
    }
  }
  return errors;
}

export function createSampleRoutes({ sendJSON, readBody, db, audit }) {
  const { readDoc, writeDoc } = db;

  async function log(req, action, detail) {
    if (typeof audit !== "function") return;
    try {
      await audit(req, { module: "样品", action, detail });
    } catch (e) {
      console.error("[samples] 审计写入失败：", e.message);
    }
  }

  return async function handle(req, res, path, method) {
    if (path !== "/api/samples") return false;

    // ---------------- 读取 ----------------
    if (method === "GET") {
      try {
        const doc = await readDoc(DOC_KEY, null);
        const list = Array.isArray(doc?.samples) ? doc.samples : [];
        sendJSON(res, 200, {
          ok: true,
          samples: list,
          isEmpty: list.length === 0,
          updatedAt: doc?.updatedAt || 0,
        });
      } catch (e) {
        console.error("[samples] 读取失败：", e.message);
        sendJSON(res, 500, { error: "读取样品数据失败" });
      }
      return true;
    }

    // ---------------- 保存（整体） ----------------
    if (method === "PUT") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const list = body?.samples;
      const errors = validate(list);
      if (errors.length) {
        sendJSON(res, 400, { error: "样品数据校验未通过", errors: errors.slice(0, 10) });
        return true;
      }
      try {
        const prev = await readDoc(DOC_KEY, null);
        const prevCount = Array.isArray(prev?.samples) ? prev.samples.length : 0;
        await writeDoc(DOC_KEY, { samples: list, updatedAt: Date.now() });
        // 仅在数量变化时记录审计，避免每次编辑都刷屏
        if (prevCount !== list.length) {
          await log(req, "台账变更", `样品数量 ${prevCount} → ${list.length}`);
        }
        sendJSON(res, 200, { ok: true, count: list.length, updatedAt: Date.now() });
      } catch (e) {
        console.error("[samples] 保存失败：", e.message);
        sendJSON(res, 500, { error: "保存样品数据失败" });
      }
      return true;
    }

    // 其它方法
    sendJSON(res, 405, { error: "不支持的请求方法" });
    return true;
  };
}
