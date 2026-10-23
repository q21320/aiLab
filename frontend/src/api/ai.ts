// ============================================================================
// AI 上游模型配置客户端（多套「模型方案 profile」·仅管理员可读写·密钥存后端不回传）
//
// 与 /api/ai/generate 代理配套：生成链路始终走服务端，前端不需要、也拿不到密钥。
// 面板支持维护多套方案（各自 名称/地址/模型/密钥/温度），选一个为「默认」；
// 全站 AI 生成走当前默认方案。
// ============================================================================

import { apiUrl } from "./base";

/** 单个模型方案（掩码后，绝不含明文密钥） */
export interface AiProfile {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  temperature: number | null;
  hasKey: boolean;
  keyPreview: string;
}

/** 当前生效（默认）方案合并环境后的展示配置 */
export interface AiActive {
  name: string;
  baseUrl: string;
  model: string;
  temperature: number;
  local: boolean;
  configured: boolean;
  source: "runtime" | "env";
  hasKey: boolean;
  keyPreview: string;
}

export interface AiConfigResp {
  ok: boolean;
  active?: AiActive;
  defaultId?: string | null;
  profiles?: AiProfile[];
  error?: string;
}

export interface AiTestResp {
  ok: boolean;
  sample?: string;
  error?: string;
}

/** 无论状态码都解析 JSON（401/403 也带 { error }，便于前端提示权限不足） */
async function req<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(apiUrl(url), { headers: { "Content-Type": "application/json" }, ...init });
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function fetchAiConfig(): Promise<AiConfigResp | null> {
  return req<AiConfigResp>("/api/ai/config");
}

/** 新增/更新一个方案（带 id 为更新；apiKey 含掩码或不传=不改动密钥） */
export interface AiProfilePatch {
  id?: string;
  name?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number | string;
  apiKey?: string;
}

export function saveAiProfile(patch: AiProfilePatch): Promise<AiConfigResp | null> {
  return req<AiConfigResp>("/api/ai/config/profile", { method: "POST", body: JSON.stringify(patch) });
}

/** 设为默认：全站生成切到该方案 */
export function setAiDefault(id: string): Promise<AiConfigResp | null> {
  return req<AiConfigResp>("/api/ai/config/default", { method: "PUT", body: JSON.stringify({ id }) });
}

/** 删除一个方案 */
export function deleteAiProfile(id: string): Promise<AiConfigResp | null> {
  return req<AiConfigResp>("/api/ai/config/delete", { method: "POST", body: JSON.stringify({ id }) });
}

/** 清空全部方案，恢复环境变量默认 */
export function resetAiConfig(): Promise<AiConfigResp | null> {
  return req<AiConfigResp>("/api/ai/config", { method: "PUT", body: JSON.stringify({ clear: true }) });
}

/** 连通性测试：不传 id 测当前默认方案；传 id 测指定方案 */
export function testAiConfig(id?: string): Promise<AiTestResp | null> {
  return req<AiTestResp>("/api/ai/config/test", { method: "POST", body: JSON.stringify(id ? { id } : {}) });
}
