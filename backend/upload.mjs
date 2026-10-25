// ============================================================================
// 台账附件（自测项目「测试结果附件」、委外项目「委外合同附件」等 file 字段的上传与下载）
//
//   POST /api/attachments        上传（JSON：{ name, mime, data:<base64>, resource }）
//   GET  /api/attachments/:id    下载/预览（?dl=1 强制按附件下载）
//
// 存储：PostgreSQL attachments 表（BYTEA），见 db.mjs —— 容器重建不丢文件、随库备份。
//
// 权限：附件本身不属于某一个页面，因此上传时记录来源资源名（resource），
//       读取时按 acl.mjs 的 API_PAGE_RULES 反查该资源的页面权限，与台账本体同一口径：
//         · 上传 → 需要该页面的「可写」
//         · 读取 → 需要该页面的「只读」以上（防止看不到项目台账却能直接拉走它的附件）
//       未绑定页面的资源沿用平台默认策略（登录即可）。
//
// 安全：同源回传用户提供的字节 = 存储型 XSS 风险，所以
//       只有图片/PDF 允许 inline 预览，其余一律按 application/octet-stream 强制下载，
//       并显式 nosniff；大小由 AILAB_UPLOAD_MAX_MB 限制（默认 10MB）。
// ============================================================================

import { randomUUID } from "node:crypto";
import { API_PAGE_RULES, PAGE_BY_PATH } from "./acl.mjs";

/** 可安全地内联预览的类型（图片 + PDF）；其余即使客户端声称是 HTML 也只走下载 */
const INLINE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/bmp",
  "application/pdf",
]);

/** 常见扩展名的类型修正：客户端 mime 经常缺省或写错（尤其 Windows 上的 .ofd/.doc） */
const EXT_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".json": "application/json",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".zip": "application/zip",
  ".rar": "application/x-rar-compressed",
  ".7z": "application/x-7z-compressed",
};

/** 文件名清洗：去掉路径与不可见字符，限长（落库与 Content-Disposition 都用它） */
function safeName(v) {
  const raw = String(v ?? "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  const name = raw || "file";
  return name.length > 120 ? `${name.slice(0, 100)}${name.slice(-16)}` : name;
}

function extOf(name) {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m ? `.${m[1].toLowerCase()}` : "";
}

function guessMime(name, claimed) {
  const ext = extOf(name);
  return EXT_TYPES[ext] || String(claimed || "").split(";")[0].trim().toLowerCase() || "application/octet-stream";
}

/** 资源名 → 该资源所属页面（复用接口拦截的唯一真相源，不再另立一套表） */
function pageRuleOf(resource) {
  const name = String(resource || "");
  if (!name) return null;
  return API_PAGE_RULES.find((r) => r.prefix === `/api/crud/${name}`) || null;
}

/**
 * @param {{
 *   sendJSON: Function, db: any, auth: any, acl: any,
 *   audit?: { log: Function }, log?: Function
 * }} options
 */
export function createUploadRoutes({ sendJSON, db, auth, acl, audit, log = console.log }) {
  const MAX_MB = Math.min(200, Math.max(1, Number(process.env.AILAB_UPLOAD_MAX_MB || 10)));
  const MAX_BYTES = MAX_MB * 1024 * 1024;
  // base64 膨胀约 4/3，再加 JSON 头部余量：超过这个体积就不再缓存请求体
  const MAX_BODY_BYTES = Math.ceil(MAX_BYTES * 1.4) + 65536;

  /** 自行读取请求体并限流（公共 readBody 无长度上限，不适合承载文件） */
  function readLimitedBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      let tooLarge = false;
      req.on("data", (c) => {
        size += c.length;
        // 超限后继续接收但不缓存：既不把整包灌进内存，又能正常回 413（而不是掐断连接）
        if (size > MAX_BODY_BYTES) tooLarge = true;
        else if (!tooLarge) chunks.push(c);
      });
      req.on("end", () => {
        if (tooLarge) {
          reject(Object.assign(new Error(`附件过大，单个文件不超过 ${MAX_MB}MB`), { tooLarge: true }));
          return;
        }
        const raw = Buffer.concat(chunks).toString("utf-8");
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error("请求体不是合法 JSON"));
        }
      });
      req.on("error", reject);
    });
  }

  /** 附件权限判定：按来源资源的页面权限（admin 恒放行，未绑定页面的资源登录即可） */
  async function allow(req, resource, needEdit) {
    const session = await auth.getSession(req);
    if (!session) return { ok: false, code: 401, error: "未登录或会话已过期" };
    if (session.role === "admin") return { ok: true, session };
    const rule = pageRuleOf(resource);
    if (!rule) return { ok: true, session }; // 未登记到权限清单的台账：沿用平台默认策略
    const { pages } = await acl.resolve(session.role);
    const level = pages[rule.page];
    const allowed = needEdit ? level === "edit" : level === "view" || level === "edit";
    if (!allowed) {
      const title = PAGE_BY_PATH[rule.page]?.title || rule.page;
      return {
        ok: false,
        code: 403,
        error: `权限不足：附件属于「${title}」，需要该页面的${needEdit ? "可写" : "只读"}权限，请联系管理员在「角色权限」中配置`,
      };
    }
    return { ok: true, session };
  }

  async function handle(req, res, path, method) {
    // ------------------------------------------------ 上传
    if (method === "POST" && path === "/api/attachments") {
      // 先限流读完请求体（resource 在体里），再做权限判定：
      // 请求体体积已由 MAX_BODY_BYTES 兜住，不存在“未授权也能灌内存”的问题
      let body;
      try {
        body = await readLimitedBody(req);
      } catch (e) {
        return void sendJSON(res, e.tooLarge ? 413 : 400, { ok: false, error: e.message }), true;
      }
      const resource = String(body?.resource || "");
      const acc = await allow(req, resource, true);
      if (!acc.ok) return void sendJSON(res, acc.code, { ok: false, error: acc.error }), true;
      const name = safeName(body?.name);
      const b64 = String(body?.data || "");
      if (!b64) return void sendJSON(res, 400, { ok: false, error: "缺少文件内容" }), true;
      const buf = Buffer.from(b64, "base64");
      if (!buf.length) return void sendJSON(res, 400, { ok: false, error: "文件内容为空" }), true;
      if (buf.length > MAX_BYTES) {
        return void sendJSON(res, 413, { ok: false, error: `附件过大，单个文件不超过 ${MAX_MB}MB` }), true;
      }
      const id = `att-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const mime = guessMime(name, body?.mime);
      try {
        await db.query(
          `INSERT INTO attachments (id, name, mime, size, resource, data, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, name, mime, buf.length, resource || null, buf, acc.session.username],
        );
      } catch (e) {
        log(`[upload] 写入附件失败：${e.message}`);
        return void sendJSON(res, 500, { ok: false, error: "附件保存失败，请重试" }), true;
      }
      if (audit) {
        await audit
          .log({
            user: acc.session.name,
            role: acc.session.role,
            module: "台账附件",
            action: "上传附件",
            detail: `上传附件「${name}」（${(buf.length / 1024).toFixed(1)} KB）`,
          })
          .catch(() => {});
      }
      sendJSON(res, 200, { ok: true, id, name, mime, size: buf.length, url: `/api/attachments/${id}` });
      return true;
    }

    // ------------------------------------------------ 下载 / 预览
    const m = /^\/api\/attachments\/([A-Za-z0-9_-]{6,64})$/.exec(path);
    if (m && (method === "GET" || method === "HEAD")) {
      let row;
      try {
        const r = await db.query(
          "SELECT name, mime, size, resource, data FROM attachments WHERE id = $1",
          [m[1]],
        );
        row = r.rows[0];
      } catch (e) {
        log(`[upload] 读取附件失败：${e.message}`);
        sendJSON(res, 500, { ok: false, error: "附件读取失败" });
        return true;
      }
      if (!row) {
        sendJSON(res, 404, { ok: false, error: "附件不存在或已被清理" });
        return true;
      }
      const acc = await allow(req, row.resource, false);
      if (!acc.ok) {
        sendJSON(res, acc.code, { ok: false, error: acc.error });
        return true;
      }
      const forced = new URL(req.url, "http://localhost").searchParams.get("dl") === "1";
      const inline = !forced && INLINE_TYPES.has(row.mime);
      const data = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data || []);
      // 文件名用 RFC 5987 编码，中文/空格附件才能被浏览器正确还原
      const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(row.name)}`;
      res.writeHead(200, {
        "Content-Type": inline ? row.mime : "application/octet-stream",
        "Content-Length": String(data.length),
        "Content-Disposition": disposition,
        "X-Content-Type-Options": "nosniff",
        // 附件内容不可变（id 唯一且不再覆写），允许浏览器/中间缓存私有保存
        "Cache-Control": "private, max-age=86400",
      });
      res.end(method === "HEAD" ? undefined : data);
      return true;
    }

    return false;
  }

  handle.limits = { maxMb: MAX_MB };
  log(`[upload] 单个附件上限 ${MAX_MB}MB，存储：PostgreSQL attachments 表`);
  return handle;
}
