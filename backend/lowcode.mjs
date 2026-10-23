// ============================================================================
// 低代码平台 · 工程（设计态）存储
//
// 接口：
//   GET  /api/lowcode/projects          读取五类设计器工程
//   PUT  /api/lowcode/projects          保存（页面/表单/流程/报表/大屏）
//
// 设计说明：
//   此前设计器工程只存浏览器 localStorage：
//     · 换设备/清缓存设计稿全丢
//     · 「已发布应用」在数据库、「设计态」在浏览器，两份数据割裂
//
//   现在设计态也进数据库（kv_documents.lowcode_projects），与发布态一致。
//   注意：published apps 仍存 apps 表（结构不同，可多版本），此处只存设计稿。
// ============================================================================

const DOC_KEY = "lowcode_projects";
const KINDS = ["page", "form", "flow", "report", "screen"];
/** 单个工程体积上限（字符数），防止超大 schema 拖垮接口 */
const MAX_SIZE_PER_PROJECT = 5 * 1024 * 1024;

/** 结构校验 */
function validate(projects) {
  const errors = [];
  if (!projects || typeof projects !== "object" || Array.isArray(projects)) {
    return ["projects 必须是对象"];
  }
  for (const k of KINDS) {
    const v = projects[k];
    if (v === undefined || v === null) continue;
    if (typeof v !== "object") {
      errors.push(`${k} 必须是对象或 null`);
      continue;
    }
    const text = JSON.stringify(v);
    if (text.length > MAX_SIZE_PER_PROJECT) {
      errors.push(`${k} 体积过大（${(text.length / 1024 / 1024).toFixed(1)}MB，上限 5MB）`);
    }
    // 根节点需有 type/id（页面/表单/流程/报表/大屏都有）
    if (!v.type && !v.id) errors.push(`${k} 缺少 type 或 id 字段`);
  }
  return errors;
}

export function createLowcodeProjectsRoutes({ sendJSON, readBody, db, audit }) {
  const { readDoc, writeDoc } = db;

  async function log(req, action, detail) {
    if (typeof audit !== "function") return;
    try {
      await audit(req, { module: "低代码", action, detail });
    } catch (e) {
      console.error("[lowcode] 审计写入失败：", e.message);
    }
  }

  return async function handle(req, res, path, method) {
    if (path !== "/api/lowcode/projects") return false;

    if (method === "GET") {
      try {
        const doc = await readDoc(DOC_KEY, null);
        sendJSON(res, 200, {
          ok: true,
          projects: doc?.projects || null,
          chats: doc?.chats || null,
          updatedAt: doc?.updatedAt || 0,
        });
      } catch (e) {
        console.error("[lowcode] 读取工程失败：", e.message);
        sendJSON(res, 500, { error: "读取工程失败" });
      }
      return true;
    }

    if (method === "PUT") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const projects = body?.projects;
      const errors = validate(projects);
      if (errors.length) {
        sendJSON(res, 400, { error: "工程数据校验未通过", errors });
        return true;
      }
      try {
        const prev = await readDoc(DOC_KEY, null);
        await writeDoc(DOC_KEY, { projects, chats: body?.chats ?? prev?.chats ?? null, updatedAt: Date.now() });
        // 记录哪些设计器发生了变化（避免每次自动保存都刷屏）
        const changed = KINDS.filter((k) => JSON.stringify(prev?.projects?.[k] ?? null) !== JSON.stringify(projects[k] ?? null));
        if (changed.length) {
          await log(req, "保存工程", `更新设计器：${changed.join("、")}`);
        }
        sendJSON(res, 200, { ok: true, updatedAt: Date.now() });
      } catch (e) {
        console.error("[lowcode] 保存工程失败：", e.message);
        sendJSON(res, 500, { error: "保存工程失败" });
      }
      return true;
    }

    sendJSON(res, 405, { error: "不支持的请求方法" });
    return true;
  };
}
