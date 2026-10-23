// ============================================================================
// AI 页面生成代理（4.1 低代码 AI 生成）
//
// 安全要点：密钥**只存在于服务端**，绝不进入前端 bundle。
// 前端仅调用同源接口 POST /api/ai/generate，由本模块读取环境变量后转发到上游
// OpenAI 兼容服务，并负责：超时控制、错误归一、响应体裁剪（只回传 content）。
//
// 上游可指向任意 OpenAI 兼容服务（阿里云 DashScope / 本地小模型 Ollama、
// LM Studio、vLLM 等），全部通过环境变量配置：
//   AI_BASE_URL     基础地址，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
//                   本地示例：http://host.docker.internal:11434/v1（Ollama）
//   AI_MODEL        模型名，默认 qwen-max（本地小模型示例：qwen2.5:7b-instruct）
//   AI_API_KEY      上游密钥；留空回退 DASHSCOPE_API_KEY。本机/内网 http 上游可免密钥
//   AI_TEMPERATURE  采样温度，默认 0.4（小模型出结构化 JSON 建议偏低）
//   AI_TIMEOUT_MS   上游请求超时毫秒，默认 180000（本地大模型生成整页较慢，放宽）
//
// 安全边界：https 上游放行任意主机；http 仅放行本机/内网/容器服务名（防 SSRF）。
// ============================================================================

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const REQUEST_TIMEOUT_MS = 180_000;
/** 单次请求允许的最大提示词长度，避免被当作免费 LLM 代理。
 *  追问采用“整页 JSON 回传”，中大页面整页 JSON 动辄上万字符，8000 会误判 413；
 *  放宽到 16000 容纳合理规模整页，超大页面由前端自动降级为“大纲+ops”不再发整页。*/
const MAX_PROMPT_CHARS = 16000;

// 运行时可覆盖的上游配置（管理员在「AI 模型配置」里设置）。
// 存储：优先写入 PostgreSQL 的 kv_documents（key=ai-config），与用户/CRUD 一样落在
// pgdata 卷里，重建镜像/重启容器都不会丢；无数据库（源码兜底运行）时回退到
// data/ai-config.json 文件。进程内缓存，保存时失效重算。密钥只存在服务端，绝不回传前端。
const DB_KEY = "ai-config";
let cachedCfg;
let cachedRuntime = null; // null 表示尚未加载

const runtimeFile = (dataDir) => join(dataDir, "ai-config.json");

/** 读缓存的运行时存储 { profiles:[], defaultId }（须先经 ensureRuntimeLoaded 预热） */
function loadRuntime() {
  return cachedRuntime || { profiles: [], defaultId: null };
}

const genProfileId = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

/** 归一存储结构 { profiles, defaultId }；兼容旧的「单一扁平配置」→ 自动迁移为一个 profile */
function normalizeStore(raw) {
  if (raw && Array.isArray(raw.profiles)) {
    const profiles = raw.profiles
      .filter((p) => p && typeof p === "object")
      .map((p) => ({
        id: String(p.id || genProfileId()),
        name: String(p.name || "").trim(),
        baseUrl: String(p.baseUrl || "").trim(),
        model: String(p.model || "").trim(),
        apiKey: p.apiKey != null ? String(p.apiKey) : "",
        temperature: p.temperature != null && Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : undefined,
      }));
    const defaultId = profiles.some((p) => p.id === raw.defaultId) ? raw.defaultId : profiles[0]?.id || null;
    return { profiles, defaultId };
  }
  const legacy = raw && (raw.baseUrl || raw.model || raw.apiKey || raw.temperature !== undefined);
  if (legacy) {
    const id = genProfileId();
    return {
      profiles: [
        {
          id,
          name: "默认",
          baseUrl: String(raw.baseUrl || "").trim(),
          model: String(raw.model || "").trim(),
          apiKey: raw.apiKey != null ? String(raw.apiKey) : "",
          temperature:
            raw.temperature != null && Number.isFinite(Number(raw.temperature)) ? Number(raw.temperature) : undefined,
        },
      ],
      defaultId: id,
    };
  }
  return { profiles: [], defaultId: null };
}

/** 异步确保运行时配置已加载到缓存：DB 优先，无则尝试导入遗留文件（一次性迁移） */
async function ensureRuntimeLoaded(db, dataDir) {
  if (cachedRuntime !== null) return cachedRuntime;
  let obj = null;
  if (db && typeof db.readDoc === "function") {
    obj = await db.readDoc(DB_KEY, null);
    if (obj === null) {
      try {
        const f = runtimeFile(dataDir);
        if (f && existsSync(f)) obj = JSON.parse(readFileSync(f, "utf-8"));
      } catch {
        obj = null;
      }
    }
  } else {
    try {
      const f = runtimeFile(dataDir);
      obj = f && existsSync(f) ? JSON.parse(readFileSync(f, "utf-8")) : null;
    } catch {
      obj = null;
    }
  }
  cachedRuntime = normalizeStore(obj);
  return cachedRuntime;
}

/** 保存运行时配置：更新缓存(归一) + 持久化（DB 优先，回退文件）。返回 Promise。 */
async function saveRuntime(db, dataDir, obj) {
  cachedRuntime = normalizeStore(obj);
  cachedCfg = undefined; // 生效配置失效，下次请求重算
  if (db && typeof db.writeDoc === "function") {
    await db.writeDoc(DB_KEY, cachedRuntime);
  } else {
    try {
      writeFileSync(runtimeFile(dataDir), JSON.stringify(cachedRuntime, null, 2));
    } catch (e) {
      console.error(`[ai] 运行时配置落盘失败：${e?.message}`);
    }
  }
}

/** 当前生效的 profile：defaultId 命中，否则首个；无方案返回 null */
function activeProfile(store) {
  const list = Array.isArray(store?.profiles) ? store.profiles : [];
  if (!list.length) return null;
  return (store.defaultId && list.find((p) => p.id === store.defaultId)) || list[0];
}

/** 归一化基础地址：去尾斜杠，未带版本号则补 /v1 */
function normalizeBase(raw) {
  let b = String(raw || "").trim().replace(/\/+$/, "");
  if (b && !/\/v\d+$/i.test(b)) b += "/v1";
  return b;
}

/** 是否本机 / 内网 / 容器服务名（这类上游允许走明文 http） */
function isLocalHost(h) {
  if (!h) return false;
  const s = h.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "localhost" || s.endsWith(".localhost")) return true;
  if (s === "host.docker.internal" || s.endsWith(".internal")) return true;
  if (s === "::1") return true;
  if (!s.includes(".")) return true; // 无点的裸主机名：容器服务名 / 局域网别名
  if (/^127\./.test(s) || /^10\./.test(s) || /^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(s)) return true;
  if (/^169\.254\./.test(s)) return true;
  return false;
}

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

/** 解析某个 profile(或 null) 与 .env/环境变量合并为生效配置；profile 非空字段优先 */
function resolveCfg(profile, dataDir) {
  const env = { ...readDotEnv(dataDir), ...process.env };
  const pick = (v) => v !== undefined && v !== null && String(v).trim() !== "";
  const baseUrl =
    normalizeBase(pick(profile?.baseUrl) ? profile.baseUrl : env.AI_BASE_URL || DEFAULT_BASE) || DEFAULT_BASE;
  const model = String(pick(profile?.model) ? profile.model : env.AI_MODEL || "qwen-max").trim() || "qwen-max";
  // 密钥：profile 自带则用它；否则回退环境（AI_API_KEY / DASHSCOPE_API_KEY）
  const apiKey = String(
    pick(profile?.apiKey) ? profile.apiKey : env.AI_API_KEY || env.DASHSCOPE_API_KEY || "",
  ).trim();
  const tempSrc = pick(profile?.temperature) ? profile.temperature : env.AI_TEMPERATURE;
  const temperature = Number.isFinite(Number(tempSrc)) ? Math.min(2, Math.max(0, Number(tempSrc))) : 0.4;
  const timeoutMs = Number.isFinite(Number(env.AI_TIMEOUT_MS))
    ? Math.min(600_000, Math.max(5_000, Number(env.AI_TIMEOUT_MS)))
    : REQUEST_TIMEOUT_MS;
  let hostname = "";
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    hostname = "";
  }
  const local = isLocalHost(hostname);
  // 本机/内网 http 上游可免密钥；公网 https 必须提供密钥
  const configured = Boolean(baseUrl) && (local || Boolean(apiKey));
  return {
    baseUrl,
    model,
    apiKey,
    temperature,
    timeoutMs,
    hostname,
    local,
    configured,
    source: profile ? "runtime" : "env",
    name: profile?.name || "",
  };
}

/** 生效配置 = 默认(或首个)profile 合并环境；进程内缓存，保存时失效 */
function getConfig(dataDir) {
  if (cachedCfg !== undefined) return cachedCfg;
  cachedCfg = resolveCfg(activeProfile(loadRuntime()), dataDir);
  return cachedCfg;
}

/** 对外展示的掩码生效配置：绝不返回完整密钥 */
function publicConfig(cfg) {
  const k = cfg.apiKey || "";
  return {
    name: cfg.name || "",
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    local: cfg.local,
    configured: cfg.configured,
    source: cfg.source,
    hasKey: k.length > 0,
    keyPreview: k.length > 4 ? `****${k.slice(-4)}` : k.length ? "****" : "",
  };
}

/** 掩码化单个 profile（供列表展示；绝不含密钥） */
function publicProfile(p) {
  const k = p.apiKey || "";
  return {
    id: p.id,
    name: p.name || "",
    baseUrl: p.baseUrl || "",
    model: p.model || "",
    temperature: Number.isFinite(Number(p.temperature)) ? Number(p.temperature) : null,
    hasKey: k.length > 0,
    keyPreview: k.length > 4 ? `****${k.slice(-4)}` : k.length ? "****" : "",
  };
}

/** https 放行任意主机；http 仅放行本机/内网/容器服务名（纵深防御） */
function isSafeUpstream(url) {
  try {
    const u = new URL(url);
    if (u.protocol === "https:") return true;
    if (u.protocol === "http:") return isLocalHost(u.hostname);
    return false;
  } catch {
    return false;
  }
}

/** 无协议时补 http://（便于用户只填 localhost:11434/v1；公网未写 https 会被下游 http 白名单拒绝） */
function ensureScheme(raw) {
  const s = String(raw || "").trim();
  if (!s) return s;
  return /^https?:\/\//i.test(s) ? s : `http://${s}`;
}

/**
 * 关闭“思考/推理”输出：结构化页面生成不需要思维链，且本地小模型上下文极紧，
 * 推理段既占 num_ctx 又会污染 JSON 抽取。按上游类型给对应字段（DashScope / Ollama）；
 * 其它 OpenAI 兼容服务不额外塞字段，以免严格校验报错。
 */
function thinkingOffFields(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)dashscope\.aliyuncs\.com$/i.test(u.hostname)) return { enable_thinking: false };
    if (u.port === "11434" || /ollama/i.test(u.hostname)) return { think: false };
  } catch {
    /* ignore */
  }
  return {};
}

/** 归一上游错误为简短中文提示（不泄露密钥/额度细节） */
function upstreamHint(status) {
  if (status === 401 || status === 403) return "密钥无效或无权限";
  if (status === 429) return "请求过于频繁或额度不足";
  if (status === 404) return "模型或接口路径不存在（检查服务地址/模型名）";
  return "上游服务异常";
}

/** 调用上游 OpenAI 兼容 /chat/completions，返回文本内容（generate 与 test 共用） */
async function callUpstream(cfg, messages, opts = {}) {
  const url = `${cfg.baseUrl}/chat/completions`;
  if (!isSafeUpstream(url)) {
    const e = new Error("上游地址校验失败（http 仅允许本机/内网/容器服务名）");
    e.code = "UNSAFE_UPSTREAM";
    throw e;
  }
  const timeoutMs = opts.timeoutMs || cfg.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        temperature: opts.temperature != null ? opts.temperature : cfg.temperature,
        ...thinkingOffFields(url),
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      const raw = await upstream.text().catch(() => "");
      console.error(`[ai] 上游返回 ${upstream.status}：${raw.slice(0, 300)}`);
      const e = new Error(upstreamHint(upstream.status));
      e.status = upstream.status;
      throw e;
    }
    const data = await upstream.json();
    return String(data?.choices?.[0]?.message?.content || "");
  } finally {
    clearTimeout(timer);
  }
}

export function createAiRoutes({ sendJSON, readBody, dataDir, audit, db }) {
  return async function handleAi(req, res, path, method) {
    // 首次触达时从 DB（或遗留文件）预热运行时配置，之后各同步路径直接读缓存
    await ensureRuntimeLoaded(db, dataDir);
    // 供前端展示当前接入的上游（不含密钥）
    if (path === "/api/ai/status" && method === "GET") {
      const cfg = getConfig(dataDir);
      sendJSON(res, 200, {
        ok: true,
        configured: cfg.configured,
        model: cfg.model,
        host: cfg.hostname || "",
        local: cfg.local,
      });
      return true;
    }

    // ---------------- 上游模型配置（多方案 profile，仅管理员；路由守卫已在 auth.mjs 拦截）----------------
    // 只读：返回全部方案(掩码) + 默认 id + 当前生效配置。绝不回传完整密钥。
    if (path === "/api/ai/config" && method === "GET") {
      const store = loadRuntime();
      sendJSON(res, 200, {
        ok: true,
        active: publicConfig(getConfig(dataDir)),
        defaultId: store.defaultId || null,
        profiles: store.profiles.map(publicProfile),
      });
      return true;
    }

    // 新增/更新一个方案（按 id upsert）。密钥含掩码则保持原值；不传 apiKey 字段则不改动。
    if (path === "/api/ai/config/profile" && method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const store = loadRuntime();
      const profiles = store.profiles.map((x) => ({ ...x }));
      let p = body?.id ? profiles.find((x) => x.id === body.id) : null;
      const isNew = !p;
      if (isNew) {
        p = { id: genProfileId(), name: "", baseUrl: "", model: "", apiKey: "", temperature: undefined };
        profiles.push(p);
      }
      if (body?.name !== undefined) p.name = String(body.name).trim();
      if (body?.model !== undefined) p.model = String(body.model).trim();
      if (isNew && !p.name) p.name = p.model ? `方案 ${p.model}` : "未命名方案";
      if (body?.baseUrl !== undefined) {
        const raw = String(body.baseUrl).trim();
        if (!raw) {
          p.baseUrl = "";
        } else {
          const base = normalizeBase(ensureScheme(raw));
          if (!isSafeUpstream(`${base}/chat/completions`)) {
            sendJSON(res, 400, { error: "上游地址不合法：http 仅允许本机/内网/容器服务名，公网请用 https" });
            return true;
          }
          p.baseUrl = base;
        }
      }
      if (body?.temperature !== undefined && body.temperature !== null && String(body.temperature).trim() !== "") {
        const t = Number(body.temperature);
        if (!Number.isFinite(t)) {
          sendJSON(res, 400, { error: "温度需为数字" });
          return true;
        }
        p.temperature = Math.min(2, Math.max(0, t));
      } else if (body?.temperature === "" || body?.temperature === null) {
        p.temperature = undefined;
      }
      // 密钥：掩码回填(含 ****)=不改；非空=覆盖；显式空串=清除
      if (body?.apiKey !== undefined && body.apiKey !== null) {
        const k = String(body.apiKey);
        if (!k.includes("****")) p.apiKey = k.trim();
      }
      let defaultId = store.defaultId;
      if (!defaultId || !profiles.some((x) => x.id === defaultId)) defaultId = profiles[0]?.id || null;
      await saveRuntime(db, dataDir, { profiles, defaultId });
      const msg = `${isNew ? "新增" : "更新"} AI 方案：${p.name}（${p.baseUrl || "默认地址"}/${p.model || "默认模型"}）`;
      if (typeof audit === "function") await audit(req, { module: "系统", action: "AI配置", detail: msg });
      const s = loadRuntime();
      sendJSON(res, 200, {
        ok: true,
        active: publicConfig(getConfig(dataDir)),
        defaultId: s.defaultId,
        profiles: s.profiles.map(publicProfile),
      });
      return true;
    }

    // 设为默认：生成链路切到该方案
    if (path === "/api/ai/config/default" && method === "PUT") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const store = loadRuntime();
      const id = String(body?.id || "");
      if (!store.profiles.some((x) => x.id === id)) {
        sendJSON(res, 400, { error: "方案不存在" });
        return true;
      }
      await saveRuntime(db, dataDir, { profiles: store.profiles, defaultId: id });
      const prof = store.profiles.find((x) => x.id === id);
      if (typeof audit === "function")
        await audit(req, { module: "系统", action: "AI配置", detail: `切换默认 AI 方案：${prof?.name || id}` });
      const s = loadRuntime();
      sendJSON(res, 200, {
        ok: true,
        active: publicConfig(getConfig(dataDir)),
        defaultId: s.defaultId,
        profiles: s.profiles.map(publicProfile),
      });
      return true;
    }

    // 删除方案：若删的是默认，默认顺延到剩余首个
    if (path === "/api/ai/config/delete" && method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      const store = loadRuntime();
      const id = String(body?.id || "");
      const removed = store.profiles.find((x) => x.id === id);
      if (!removed) {
        sendJSON(res, 400, { error: "方案不存在" });
        return true;
      }
      const profiles = store.profiles.filter((x) => x.id !== id);
      const defaultId = store.defaultId === id ? profiles[0]?.id || null : store.defaultId;
      await saveRuntime(db, dataDir, { profiles, defaultId });
      if (typeof audit === "function")
        await audit(req, { module: "系统", action: "AI配置", detail: `删除 AI 方案：${removed.name || id}` });
      const s = loadRuntime();
      sendJSON(res, 200, {
        ok: true,
        active: publicConfig(getConfig(dataDir)),
        defaultId: s.defaultId,
        profiles: s.profiles.map(publicProfile),
      });
      return true;
    }

    // 一键恢复环境变量默认（清空全部方案）；非 clear 的 PUT 引导使用 profile 端点
    if (path === "/api/ai/config" && method === "PUT") {
      let body;
      try {
        body = await readBody(req);
      } catch {
        sendJSON(res, 400, { error: "请求体不是合法 JSON" });
        return true;
      }
      if (body?.clear === true) {
        await saveRuntime(db, dataDir, { profiles: [], defaultId: null });
        if (typeof audit === "function")
          await audit(req, { module: "系统", action: "AI配置", detail: "清除全部 AI 方案，恢复为环境变量默认" });
        const s = loadRuntime();
        sendJSON(res, 200, {
          ok: true,
          active: publicConfig(getConfig(dataDir)),
          defaultId: s.defaultId,
          profiles: s.profiles.map(publicProfile),
        });
        return true;
      }
      sendJSON(res, 400, { error: "请使用 /api/ai/config/profile 管理模型方案" });
      return true;
    }

    // 连通性测试：默认测当前生效方案；带 {id} 可测指定方案（尚未设为默认时也能试）
    if (path === "/api/ai/config/test" && method === "POST") {
      let body = null;
      try {
        body = await readBody(req);
      } catch {
        body = null;
      }
      const store = loadRuntime();
      const id = String(body?.id || "");
      const prof = id ? store.profiles.find((x) => x.id === id) : activeProfile(store);
      const cfg = resolveCfg(prof || null, dataDir);
      if (!cfg.configured) {
        sendJSON(res, 200, { ok: false, error: "AI 未配置，无法测试" });
        return true;
      }
      try {
        const content = await callUpstream(cfg, [{ role: "user", content: "只回复两个字母：ok" }], {
          temperature: 0,
          timeoutMs: Math.min(20_000, cfg.timeoutMs),
        });
        sendJSON(res, 200, { ok: true, sample: String(content).slice(0, 40) });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: e?.message || "测试失败" });
      }
      return true;
    }

    if (path !== "/api/ai/generate") return false;

    if (method !== "POST") {
      sendJSON(res, 405, { error: "仅支持 POST" });
      return true;
    }

    const cfg = getConfig(dataDir);
    if (!cfg.configured) {
      sendJSON(res, 503, {
        error: "AI 服务未配置：请在环境变量或 backend/.env 设置 AI_BASE_URL / AI_MODEL（公网 https 上游还需 AI_API_KEY 或 DASHSCOPE_API_KEY）",
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

    const url = `${cfg.baseUrl}/chat/completions`;
    if (!isSafeUpstream(url)) {
      sendJSON(res, 500, { error: "上游地址校验失败（http 仅允许本机/内网/容器服务名）" });
      return true;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
          temperature: cfg.temperature,
          ...thinkingOffFields(url),
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
