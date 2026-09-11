// ============================================================================
// 表单提交与数据接口客户端
// ============================================================================

import { apiUrl } from "./base";

export interface FormSubmission {
  id: string;
  formId: string;
  formName: string;
  data: Record<string, any>;
  submittedAt: number;
}

export interface SubmitResult {
  ok: boolean;
  id?: string;
  error?: string;
  status?: number;
}

/** 提交到平台默认接口：POST /api/forms/:formId/submit */
export async function submitToPlatform(
  formId: string,
  formName: string,
  data: Record<string, any>
): Promise<SubmitResult> {
  const url = apiUrl(`/api/forms/${encodeURIComponent(formId)}/submit`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ formName, data }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      return { ok: false, status: res.status, error: body.error || `HTTP ${res.status}` };
    }
    return { ok: true, id: body.id, status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: `无法连接后端（${(e as Error).message}）——请确认后端已启动（cd backend && npm start），或表单配置的提交地址可访问`,
    };
  }
}

/** 提交到表单自定义的 submitApi（按原始字段 POST） */
export async function submitToCustomApi(
  apiPath: string,
  data: Record<string, any>
): Promise<SubmitResult> {
  const url = apiUrl(apiPath.startsWith("/") || /^https?:/i.test(apiPath) ? apiPath : `/${apiPath}`);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint =
        res.status === 404
          ? `：接口 404（${apiPath}）不存在——请在表单设置中改用平台默认接口 /api/forms/:formId/submit，或填写你们真实的业务接口`
          : "";
      return { ok: false, status: res.status, error: `HTTP ${res.status}${hint}` };
    }
    return { ok: true, id: body.id, status: res.status };
  } catch (e) {
    return { ok: false, error: `无法连接 ${apiPath}（${(e as Error).message}）` };
  }
}

/** 提交记录（可按表单过滤） */
export async function fetchSubmissions(formId?: string): Promise<FormSubmission[] | null> {
  try {
    const qs = formId ? `?formId=${encodeURIComponent(formId)}` : "";
    const res = await fetch(apiUrl(`/api/forms/submissions${qs}`));
    if (!res.ok) return null;
    const body = await res.json();
    return Array.isArray(body.submissions) ? body.submissions : null;
  } catch {
    return null;
  }
}

export async function deleteSubmission(id: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl(`/api/forms/submissions/${encodeURIComponent(id)}`), { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}

export function submissionsExportUrl(formId?: string): string {
  return apiUrl(`/api/forms/submissions/export.csv${formId ? `?formId=${encodeURIComponent(formId)}` : ""}`);
}
