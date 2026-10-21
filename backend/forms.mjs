// ============================================================================
// 表单提交与数据存储（低代码表单 → PostgreSQL）
//
// 接口：
//   POST   /api/forms/:formId/submit         提交表单数据（运行时默认接口）
//   POST   /api/forms/:formId/save           同上（兼容旧 submitApi 配置）
//   GET    /api/forms/submissions            提交记录（?formId= 过滤，?limit= 条数）
//   GET    /api/forms/submissions/export.csv 导出 CSV
//   DELETE /api/forms/submissions/:id        删除记录
//
// 相比原 JSON 文件实现的改进：
//   · 不再有 2000 条上限与"归档到 JSONL"的权宜之计——数据库天然不限量；
//   · 分页与过滤在 SQL 完成，返回真实 total；
//   · 并发提交不会互相覆盖整份文件。
// ============================================================================

import { csvText } from "./csv.mjs";

export function createFormRoutes(deps) {
  const { sendJSON, readBody, db } = deps;
  const { query } = db;

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

  function csvOf(list) {
    const keys = Array.from(new Set(list.flatMap((s) => Object.keys(s.data || {}))));
    // 全字段转义 + 防公式注入（表单数据由外部用户提交，完全不可信）
    return csvText(
      ["提交编号", "表单", "表单ID", "提交时间", ...keys],
      list.map((s) => [s.id, s.formName || s.formId, s.formId, new Date(s.submittedAt).toLocaleString("zh-CN"), ...keys.map((k) => s.data?.[k])]),
    );
  }

  const toRecord = (r) => ({
    id: r.id,
    formId: r.form_id,
    formName: r.form_name || "",
    data: r.data,
    submittedAt: Number(r.submitted_at),
  });

  return async function handle(req, res, path, method) {
    // ---------------- 提交（两个路径等价：/submit 与 /save） ----------------
    const submitMatch = path.match(/^\/api\/forms\/([^/]+)\/(submit|save)$/);
    if (method === "POST" && submitMatch) {
      const formId = safeDecode(submitMatch[1]);
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
      const now = Date.now();
      // 编号带毫秒时间戳 + 随机后缀，避免并发下重号（原来用内存 serial 计数）
      const id = `SUB-${now.toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      try {
        await query(
          "INSERT INTO form_submissions (id, form_id, form_name, data, submitted_at) VALUES ($1,$2,$3,$4::jsonb,$5)",
          [id, formId, String(body.formName || ""), JSON.stringify(data), now],
        );
      } catch (e) {
        console.error("[forms] 保存提交数据失败：", e.message);
        sendJSON(res, 500, { ok: false, error: "提交保存失败，请稍后重试" });
        return true;
      }
      sendJSON(res, 200, { ok: true, id, submittedAt: now, message: "表单提交成功" });
      return true;
    }

    // ---------------- 导出 CSV ----------------
    if (method === "GET" && path === "/api/forms/submissions/export.csv") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const formId = url.searchParams.get("formId");
      try {
        const r = formId
          ? await query("SELECT * FROM form_submissions WHERE form_id = $1 ORDER BY submitted_at DESC LIMIT 100000", [
              formId,
            ])
          : await query("SELECT * FROM form_submissions ORDER BY submitted_at DESC LIMIT 100000");
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="form-submissions.csv"`,
        });
        res.end(csvOf(r.rows.map(toRecord)));
      } catch (e) {
        console.error("[forms] 导出失败：", e.message);
        sendJSON(res, 500, { error: "导出失败" });
      }
      return true;
    }

    // ---------------- 列表（数据库分页） ----------------
    if (method === "GET" && path === "/api/forms/submissions") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const formId = url.searchParams.get("formId");
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 1000);
      const page = Math.max(Number(url.searchParams.get("page") || 1), 1);
      const offset = (page - 1) * limit;
      try {
        const totalRes = formId
          ? await query("SELECT COUNT(*)::int AS n FROM form_submissions WHERE form_id = $1", [formId])
          : await query("SELECT COUNT(*)::int AS n FROM form_submissions");
        const listRes = formId
          ? await query(
              "SELECT * FROM form_submissions WHERE form_id = $1 ORDER BY submitted_at DESC LIMIT $2 OFFSET $3",
              [formId, limit, offset],
            )
          : await query("SELECT * FROM form_submissions ORDER BY submitted_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
        sendJSON(res, 200, {
          submissions: listRes.rows.map(toRecord),
          total: totalRes.rows[0].n,
          page,
          pageSize: limit,
        });
      } catch (e) {
        console.error("[forms] 查询失败：", e.message);
        sendJSON(res, 500, { error: "查询失败", submissions: [], total: 0 });
      }
      return true;
    }

    // ---------------- 删除 ----------------
    const delMatch = path.match(/^\/api\/forms\/submissions\/([^/]+)$/);
    if (method === "DELETE" && delMatch) {
      const id = safeDecode(delMatch[1]);
      try {
        const r = await query("DELETE FROM form_submissions WHERE id = $1", [id]);
        sendJSON(res, 200, { ok: r.rowCount > 0 });
      } catch (e) {
        console.error("[forms] 删除失败：", e.message);
        sendJSON(res, 500, { error: "删除失败" });
      }
      return true;
    }

    return false;
  };
}
