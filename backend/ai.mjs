// ============================================================================
// AI 页面生成代理（4.1 低代码 AI 生成）
//
// 安全要点：DashScope 密钥**只存在于服务端**，绝不进入前端 bundle。
// 前端仅调用同源接口 POST /api/ai/generate，由本模块读取环境变量后转发到阿里云，
// 并负责：超时控制、错误归一、响应体裁剪（只回传 content，不泄露上游细节）。
//
// 密钥来源（按优先级）：
//   1) 环境变量 DASHSCOPE_API_KEY
//   2) backend/.env 文件中的 DASHSCOPE_API_KEY=...
// 未配置时返回 503，并给出明确提示（前端会展示给用户）。
// ============================================================================

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com/compatible-mode";
const MODEL_NAME = process.env.AI_MODEL || "qwen-max";
const REQUEST_TIMEOUT_MS = 60_000;
/** 单次请求允许的最大提示词长度，避免被当作免费 LLM 代理 */
const MAX_PROMPT_CHARS = 8000;

/** 读取 backend/.env（极简解析，仅 key=value，支持 # 注释与引号） */
function readDotEnv(dataDir) {
  const file = join(dataDir, ".env");
  const out = {};
  if (!existsSync(file)) return out;
  try {
    for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (k) out[k] = v;
    }
  } catch {
    /* 读取失败按未配置处理 */
  }
  return out;
}

let cachedKey;
function getApiKey(dataDir) {
  if (cachedKey !== undefined) return cachedKey;
  const fromEnv = process.env.DASHSCOPE_API_KEY;
  const fromFile = readDotEnv(dataDir).DASHSCOPE_API_KEY;
  cachedKey = String(fromEnv || fromFile || "").trim() || "";
  return cachedKey;
}

/** 仅允许 http(s) 且非本机/保留地址 —— 转发目标由服务端固定，这里只是纵深防御 */
function isSafeUpstream(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname === "dashscope.aliyuncs.com";
  } catch {
    return false;
  }
}

export function createAiRoutes({ sendJSON, readBody, dataDir }) {
  return async function handleAi(req, res, path, method) {
    if (path !== "/api/ai/generate") return false;

    if (method !== "POST") {
      sendJSON(res, 405, { error: "仅支持 POST" });
      return true;
    }

    const apiKey = getApiKey(dataDir);
    if (!apiKey) {
      sendJSON(res, 503, {
        error: "AI 服务未配置：请在环境变量或 backend/.env 中设置 DASHSCOPE_API_KEY（密钥不再内置到前端代码中）",
      });
      return true;
    }

    let body;
    try {
      body = await readBody(req);
    } catch {
      sendJSON(res, 400, { error: "请求体不是合法 JSON" });
      return true;
    }

    const prompt = String(body?.prompt || "").trim();
    const system = String(body?.system || "").trim();
    if (!prompt) {
      sendJSON(res, 400, { error: "缺少 prompt" });
      return true;
    }
    if (prompt.length > MAX_PROMPT_CHARS || system.length > MAX_PROMPT_CHARS * 2) {
      sendJSON(res, 413, { error: "提示词过长" });
      return true;
    }

    const url = `${DASHSCOPE_BASE}/v1/chat/completions`;
    if (!isSafeUpstream(url)) {
      sendJSON(res, 500, { error: "上游地址校验失败" });
      return true;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
          temperature: 0.7,
          enable_thinking: false,
        }),
        signal: controller.signal,
      });

      if (!upstream.ok) {
        // 上游细节只写日志，不回传给浏览器（避免泄露账号/额度信息）
        const raw = await upstream.text().catch(() => "");
        console.error(`[ai] 上游返回 ${upstream.status}：${raw.slice(0, 300)}`);
        const hint =
          upstream.status === 401 || upstream.status === 403
            ? "密钥无效或无权限"
            : upstream.status === 429
              ? "请求过于频繁或额度不足"
              : "上游服务异常";
        sendJSON(res, 502, { error: `AI 服务调用失败：${hint}` });
        return true;
      }

      const data = await upstream.json();
      const content = data?.choices?.[0]?.message?.content || "";
      if (!content) {
        sendJSON(res, 502, { error: "AI 返回内容为空" });
        return true;
      }
      sendJSON(res, 200, { ok: true, content });
      return true;
    } catch (e) {
      const aborted = e && (e.name === "AbortError" || e.code === "ABORT_ERR");
      console.error("[ai] 代理失败：", e?.message);
      sendJSON(res, aborted ? 504 : 502, { error: aborted ? "AI 请求超时" : "AI 请求失败（网络异常）" });
      return true;
    } finally {
      clearTimeout(timer);
    }
  };
}
