// ============================================================================
// 台账附件（测试项目「测试结果附件」、委外项目「委外合同附件 / 测试结果附件」等 file 字段）
//
// 上传走 JSON + base64（与平台既有的纯 JSON 接口风格一致，后端不需要 multipart 依赖）；
// 下载直接给 <a href> 用浏览器原生能力（后端按来源台账的页面权限判定能否读取）。
// ============================================================================

import { apiUrl } from "./base";

/** 附件引用：存进台账字段的形状（数组），只存元数据，二进制留在库里 */
export interface AttachmentRef {
  id: string;
  name: string;
  size: number;
  mime?: string;
  url: string;
}

/** 与后端 AILAB_UPLOAD_MAX_MB 默认值对齐；超限先在前端拦下，省一次无谓上传 */
export const MAX_UPLOAD_MB = 10;

/** File → base64（去掉 data: 前缀） */
function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || "").split(",")[1] || "");
    fr.onerror = () => reject(fr.error || new Error("读取文件失败"));
    fr.readAsDataURL(file);
  });
}

/**
 * 上传一个附件。
 * @param resource 来源台账资源名（如 lab_projects）—— 服务端据此校验页面权限
 */
export async function uploadAttachment(
  file: File,
  resource: string,
): Promise<{ ok: boolean; ref?: AttachmentRef; error?: string }> {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return { ok: false, error: `「${file.name}」超过 ${MAX_UPLOAD_MB}MB，请先压缩或拆分` };
  }
  let data = "";
  try {
    data = await toBase64(file);
  } catch (e) {
    return { ok: false, error: (e as Error).message || "读取文件失败" };
  }
  try {
    const res = await fetch(apiUrl("/api/attachments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, mime: file.type, resource, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      return { ok: false, error: body.error || `上传失败（HTTP ${res.status}）` };
    }
    return {
      ok: true,
      ref: { id: body.id, name: body.name, size: body.size, mime: body.mime, url: body.url },
    };
  } catch (e) {
    return { ok: false, error: `无法连接后端（${(e as Error).message}）` };
  }
}

/** 附件访问地址：dl=1 强制下载（图片/PDF 默认在浏览器里预览） */
export function attachmentUrl(ref: Pick<AttachmentRef, "id" | "url">, download = false): string {
  const raw = ref.url || `/api/attachments/${ref.id}`;
  return apiUrl(raw) + (download ? (raw.includes("?") ? "&dl=1" : "?dl=1") : "");
}

/** 体积显示：表格与表单里都按 KB / MB 呈现 */
export function sizeText(size?: number): string {
  const n = Number(size || 0);
  if (!n) return "";
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 把字段值统一成附件数组（历史数据可能是字符串或空） */
export function toRefs(v: unknown): AttachmentRef[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = x as Partial<AttachmentRef>;
      const id = String(o?.id ?? "");
      if (!id) return null;
      return { id, name: String(o.name ?? id), size: Number(o.size ?? 0), mime: o.mime, url: String(o.url ?? `/api/attachments/${id}`) };
    })
    .filter(Boolean) as AttachmentRef[];
}
