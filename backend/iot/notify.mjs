// ============================================================================
// 告警通知（企业微信 / 钉钉 / 通用 Webhook / SMTP 邮件）
//
// 问题：此前告警只能在登录后看到，真实运维场景没人会一直盯着页面。
//
// 设计：
//   1) **多通道**：企微机器人、钉钉机器人、通用 Webhook、SMTP 邮件，可同时启用；
//   2) **异步不阻塞**：通知在后台发送，失败不影响告警入库与采集；
//   3) **去重与限流**：同一通道对同一告警只发一次；通道级别限流（默认 20 条/分钟），
//      避免设备抖动时刷屏把群聊打爆；
//   4) **失败重试**：单次发送失败重试 2 次（指数退避），仍失败则记录 lastError；
//   5) **配置持久化**：存 kv_documents.alarm_notify，界面可改；
//   6) **安全**：Webhook URL 与 SMTP 密码只存服务端，接口返回时脱敏。
// ============================================================================

/** 通道类型 */
export const CHANNEL_TYPES = [
  { id: "wecom", label: "企业微信群机器人", fields: ["webhook"] },
  { id: "dingtalk", label: "钉钉群机器人", fields: ["webhook", "secret"] },
  { id: "webhook", label: "通用 Webhook（JSON POST）", fields: ["webhook"] },
  { id: "smtp", label: "邮件（SMTP）", fields: ["host", "port", "secure", "user", "pass", "from", "to"] },
];

const DEFAULTS = {
  enabled: false,
  /** 只通知这些级别；默认仅 error（避免预警刷屏） */
  minLevel: "error",
  /** 每个通道每分钟最多发送条数 */
  ratePerMinute: 20,
  channels: [],
};

const isError = (lvl) => lvl === "error";

export function createNotifier({ db, log = console.log }) {
  let cfg = { ...DEFAULTS, channels: [] };
  /** 通道ID -> 最近发送时间戳数组（用于限流） */
  const rateBuckets = new Map();
  /** 已发送记录：`${channelId}|${alertId}`，防止重复推送 */
  const sentKeys = new Set();

  async function load() {
    try {
      const saved = await db.readDoc("alarm_notify", null);
      if (saved && typeof saved === "object") {
        cfg = { ...DEFAULTS, ...saved, channels: Array.isArray(saved.channels) ? saved.channels : [] };
      }
    } catch (e) {
      console.error("[notify] 读取配置失败：", e.message);
    }
  }

  async function save(patch) {
    cfg = { ...cfg, ...patch };
    await db.writeDoc("alarm_notify", cfg);
    return cfg;
  }

  /** 脱敏后的配置（用于接口返回，绝不回传密码与完整 URL token） */
  function publicConfig() {
    const mask = (u) => {
      const s = String(u || "");
      // 保留前缀与后 6 位，中间用 ***
      if (s.length <= 16) return s ? "***" : "";
      return `${s.slice(0, 14)}***${s.slice(-6)}`;
    };
    return {
      enabled: cfg.enabled,
      minLevel: cfg.minLevel,
      ratePerMinute: cfg.ratePerMinute,
      channels: cfg.channels.map((c) => ({
        ...c,
        webhook: mask(c.webhook),
        secret: c.secret ? "***" : "",
        pass: c.pass ? "***" : "",
        hasCredential: !!(c.webhook || c.pass),
      })),
    };
  }

  /** 限流检查 */
  function allow(channelId) {
    const now = Date.now();
    const arr = (rateBuckets.get(channelId) || []).filter((t) => now - t < 60_000);
    if (arr.length >= cfg.ratePerMinute) {
      rateBuckets.set(channelId, arr);
      return false;
    }
    arr.push(now);
    rateBuckets.set(channelId, arr);
    return true;
  }

  // -------------------------------------------------------------------------
  // 各通道发送实现
  // -------------------------------------------------------------------------
  async function sendWecom(ch, alert) {
    const body = {
      msgtype: "markdown",
      markdown: {
        content: renderMarkdown(alert),
      },
    };
    const res = await fetch(ch.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return checkJsonResponse(res, "企微");
  }

  async function sendDingtalk(ch, alert) {
    let url = ch.webhook;
    // 钉钉支持加签，避免关键词安全校验
    if (ch.secret) {
      const ts = Date.now();
      const { createHmac } = await import("node:crypto");
      const sign = createHmac("sha256", ch.secret).update(`${ts}\n${ch.secret}`).digest("base64");
      const u = new URL(url);
      u.searchParams.set("timestamp", String(ts));
      u.searchParams.set("sign", sign);
      url = u.toString();
    }
    const body = {
      msgtype: "markdown",
      markdown: { title: "物联网告警", text: renderMarkdown(alert) },
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return checkJsonResponse(res, "钉钉");
  }

  async function sendWebhook(ch, alert) {
    const res = await fetch(ch.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "iot.alert",
        alert: {
          id: alert.id,
          deviceId: alert.deviceId,
          deviceName: alert.deviceName,
          level: alert.level,
          message: alert.message,
          time: alert.time,
          status: alert.status,
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Webhook 返回 ${res.status}`);
    return true;
  }

  async function sendSmtp(ch, alert) {
    const net = await import("node:net");
    const tls = await import("node:tls");
    const { connect } = await import("node:tls");
    const port = Number(ch.port) || (ch.secure ? 465 : 25);

    return new Promise((resolve, reject) => {
      const socket = ch.secure
        ? connect({ host: ch.host, port, servername: ch.host })
        : net.createConnection({ host: ch.host, port });
      let buffer = "";
      let step = 0;
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error("SMTP 超时"));
      }, 15000);

      const write = (line) => socket.write(`${line}\r\n`);
      const fail = (msg) => {
        clearTimeout(timeout);
        socket.destroy();
        reject(new Error(msg));
      };

      socket.on("data", (d) => {
        buffer += d.toString();
        if (!buffer.includes("\r\n")) return;
        const code = Number(buffer.slice(0, 3));
        const text = buffer;
        buffer = "";
        try {
          if (code >= 400) {
            fail(`SMTP 错误 ${code}: ${text.slice(0, 120)}`);
            return;
          }
          switch (step) {
            case 0:
              write("EHLO ailab");
              step = 1;
              break;
            case 1:
              if (ch.user) {
                write("AUTH LOGIN");
                step = 2;
              } else {
                write(`MAIL FROM:<${ch.from}>`);
                step = 4;
              }
              break;
            case 2:
              write(Buffer.from(ch.user).toString("base64"));
              step = 3;
              break;
            case 3:
              write(Buffer.from(ch.pass || "").toString("base64"));
              step = 4;
              break;
            case 4:
              write(`MAIL FROM:<${ch.from}>`);
              step = 5;
              break;
            case 5:
              write(`RCPT TO:<${ch.to}>`);
              step = 6;
              break;
            case 6:
              write("DATA");
              step = 7;
              break;
            case 7: {
              const headers = [
                `From: ${ch.from}`,
                `To: ${ch.to}`,
                `Subject: =?UTF-8?B?${Buffer.from(`[AI Lab] ${alert.level === "error" ? "严重" : "预警"}告警 - ${alert.deviceName || alert.deviceId}`).toString("base64")}?=`,
                "MIME-Version: 1.0",
                "Content-Type: text/plain; charset=UTF-8",
                `Date: ${new Date().toUTCString()}`,
              ].join("\r\n");
              const bodyText = [
                `设备：${alert.deviceName || alert.deviceId}（${alert.deviceId}）`,
                `级别：${alert.level === "error" ? "严重" : "预警"}`,
                `内容：${alert.message}`,
                `时间：${new Date(alert.time).toLocaleString("zh-CN", { hour12: false })}`,
                `告警编号：${alert.id}`,
              ].join("\r\n");
              write(`${headers}\r\n\r\n${bodyText}\r\n.`);
              step = 8;
              break;
            }
            case 8:
              write("QUIT");
              clearTimeout(timeout);
              socket.end();
              resolve(true);
              break;
            default:
              break;
          }
        } catch (e) {
          fail(e.message);
        }
      });
      socket.on("error", (e) => fail(`SMTP 连接失败：${e.message}`));
    });
  }

  function checkJsonResponse(res, name) {
    return res
      .json()
      .then((data) => {
        // 企微/钉钉成功返回 errcode=0
        if (data && typeof data.errcode === "number" && data.errcode !== 0) {
          throw new Error(`${name} 返回错误 ${data.errcode}：${data.errmsg || ""}`);
        }
        return true;
      })
      .catch((e) => {
        if (e instanceof SyntaxError) return true; // 非 JSON 响应按成功处理
        throw e;
      });
  }

  function renderMarkdown(alert) {
    const lvl = alert.level === "error" ? "🔴 严重" : "🟠 预警";
    return [
      `## ${lvl}告警`,
      `> 设备：**${alert.deviceName || alert.deviceId}**（${alert.deviceId}）`,
      `> 内容：${alert.message}`,
      `> 时间：${new Date(alert.time).toLocaleString("zh-CN", { hour12: false })}`,
      `> 编号：${alert.id}`,
      "",
      `请登录 AI Lab 平台处理（告警管理 → 确认）`,
    ].join("\n");
  }

  /** 单通道发送（含重试） */
  async function sendOne(ch, alert) {
    const attempt = async () => {
      switch (ch.type) {
        case "wecom":
          return sendWecom(ch, alert);
        case "dingtalk":
          return sendDingtalk(ch, alert);
        case "webhook":
          return sendWebhook(ch, alert);
        case "smtp":
          return sendSmtp(ch, alert);
        default:
          throw new Error(`未知通道类型：${ch.type}`);
      }
    };
    let lastErr = null;
    for (let i = 0; i < 3; i++) {
      try {
        await attempt();
        ch.lastError = "";
        ch.lastSentAt = Date.now();
        return true;
      } catch (e) {
        lastErr = e;
        if (i < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** i));
      }
    }
    ch.lastError = String(lastErr?.message || lastErr);
    throw lastErr;
  }

  /**
   * 通知一条告警（异步，不阻塞调用方）。
   * @returns {Promise<{ sent: number, skipped: string[] }>}
   */
  async function notify(alert) {
    const result = { sent: 0, skipped: [] };
    if (!cfg.enabled || !alert) return result;
    // 级别过滤：默认只推严重告警
    if (cfg.minLevel === "error" && !isError(alert.level)) {
      result.skipped.push("级别过滤");
      return result;
    }
    const enabledChannels = cfg.channels.filter((c) => c.enabled !== false);
    if (!enabledChannels.length) {
      result.skipped.push("无启用通道");
      return result;
    }

    await Promise.allSettled(
      enabledChannels.map(async (ch) => {
        const key = `${ch.id}|${alert.id}`;
        if (sentKeys.has(key)) {
          result.skipped.push(`${ch.name || ch.type}:重复`);
          return;
        }
        if (!allow(ch.id)) {
          result.skipped.push(`${ch.name || ch.type}:限流`);
          return;
        }
        try {
          await sendOne(ch, alert);
          sentKeys.add(key);
          // 控制集合大小
          if (sentKeys.size > 5000) sentKeys.clear();
          result.sent += 1;
        } catch (e) {
          log(`[notify] ${ch.name || ch.type} 发送失败：${e.message}`);
        }
      }),
    );
    return result;
  }

  /** 发送测试消息（界面「测试」按钮用） */
  async function testChannel(channelId) {
    const ch = cfg.channels.find((c) => c.id === channelId);
    if (!ch) return { ok: false, error: "通道不存在" };
    const sample = {
      id: "TEST-0001",
      deviceId: "DEV-TEST",
      deviceName: "测试设备",
      level: "error",
      message: "这是一条测试告警，用于验证通知通道配置是否正确",
      time: Date.now(),
      status: "open",
    };
    try {
      await sendOne(ch, sample);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e?.message || e) };
    }
  }

  return { load, save, publicConfig, notify, testChannel, getConfig: () => cfg };
}
