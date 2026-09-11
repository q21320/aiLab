// ============================================================================
// 表单提交与数据存储（低代码表单 → 后端落库）
//
// 接口：
//   POST   /api/forms/:formId/submit        提交表单数据（运行时默认接口）
//   POST   /api/forms/:formId/save          同上（兼容旧 submitApi 配置）
//   GET    /api/forms/submissions           提交记录（?formId= 过滤，?limit= 条数）
//   GET    /api/forms/submissions/export.csv 导出 CSV
//   DELETE /api/forms/submissions/:id       删除记录
//
// 数据持久化：backend/data/form-submissions.json
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function createFormRoutes(deps) {
  const { sendJSON, readBody, dataFile } = deps;

  let submissions = [];
  try {
    if (existsSync(dataFile)) submissions = JSON.parse(readFileSync(dataFile, "utf-8"));
  } catch (e) {
    console.error("[forms] 读取提交数据失败：", e.message);
    submissions = [];
  }
  function persist() {
    try {
      mkdirSync(dataFile.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
      writeFileSync(dataFile, JSON.stringify(submissions, null, 2), "utf-8");
    } catch (e) {
      console.error("[forms] 保存提交数据失败：", e.message);
    }
  }

  let serial = submissions.length;

  function csvOf(list) {
    const keys = Array.from(new Set(list.flatMap((s) => Object.keys(s.data || {}))));
    const header = ["提交编号", "表单", "表单ID", "提交时间", ...keys].join(",");
    const esc = (v) => {
      const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = list.map((s) =>
      [
        s.id,
        s.formName || s.formId,
        s.formId,
        new Date(s.submittedAt).toLocaleString("zh-CN"),
        ...keys.map((k) => esc(s.data?.[k])),
      ].join(",")
    );
    return "\uFEFF" + [header, ...rows].join("\n");
  }

  return async function handle(req, res, path, method) {
    // 提交（两个路径等价：/submit 与 /save）
    const submitMatch = path.match(/^\/api\/forms\/([^/]+)\/(submit|save)$/);
    if (method === "POST" && submitMatch) {
      const formId = decodeURIComponent(submitMatch[1]);
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { ok: false, error: "请求体不是合法 JSON" });
        return true;
      }
      const data = body && typeof body === "object" && body.data && typeof body.data === "object" ? body.data : body;
      if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length === 0) {
        sendJSON(res, 400, { ok: false, error: "提交数据为空：请以 JSON 对象提交表单字段" });
        return true;
      }
      serial += 1;
      const record = {
        id: `SUB-${Date.now().toString(36).toUpperCase()}-${String(serial).padStart(3, "0")}`,
        formId,
        formName: body.formName || "",
        data,
        submittedAt: Date.now(),
      };
      submissions.unshift(record);
      if (submissions.length > 2000) submissions.length = 2000;
      persist();
      sendJSON(res, 200, { ok: true, id: record.id, submittedAt: record.submittedAt, message: "表单提交成功" });
      return true;
    }

    // 导出 CSV
    if (method === "GET" && path === "/api/forms/submissions/export.csv") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const formId = url.searchParams.get("formId");
      const list = formId ? submissions.filter((s) => s.formId === formId) : submissions;
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="form-submissions.csv"`,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(csvOf(list));
      return true;
    }

    // 列表
    if (method === "GET" && path === "/api/forms/submissions") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const formId = url.searchParams.get("formId");
      const limit = Number(url.searchParams.get("limit") || 200);
      const list = (formId ? submissions.filter((s) => s.formId === formId) : submissions).slice(0, limit);
      sendJSON(res, 200, { submissions: list, total: submissions.length });
      return true;
    }

    // 删除
    const delMatch = path.match(/^\/api\/forms\/submissions\/([^/]+)$/);
    if (method === "DELETE" && delMatch) {
      const id = decodeURIComponent(delMatch[1]);
      const before = submissions.length;
      submissions = submissions.filter((s) => s.id !== id);
      persist();
      sendJSON(res, 200, { ok: submissions.length < before });
      return true;
    }

    return false;
  };
}
