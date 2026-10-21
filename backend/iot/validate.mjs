// ============================================================================
// 设备配置校验
//
// 问题：此前接入设备完全不校验——点位缺少 query、register 非法、key 重复
// 都能保存成功，直到读取时才失败，排查成本高。
//
// 本模块在**接入/修改设备时**按协议给出字段级错误，让问题在入口暴露。
// ============================================================================

/** 各协议的点位必填字段与可选字段 */
const PROTOCOL_RULES = {
  scpi: {
    address: { host: "required", port: "port" },
    point: { required: ["key"], oneOf: [["query"], ["command"]] },
  },
  "modbus-tcp": {
    address: { host: "required", port: "port", unitId: "int" },
    point: { required: ["key", "register"] },
  },
  http: {
    address: { baseUrl: "url" },
    point: { required: ["key"], oneOf: [["path"], ["url"]] },
  },
  mock: {
    address: {},
    point: { required: ["key"] },
  },
};

const VALID_TYPES = new Set(["int16", "uint16", "int32", "uint32", "float32"]);

const RE_IP_OR_HOST = /^[A-Za-z0-9._-]{1,253}$/;
const RE_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function isValidPort(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 && n < 65536;
}

/**
 * 校验设备配置。
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateDevice(device) {
  const errors = [];
  const warnings = [];

  if (!device || typeof device !== "object") {
    return { ok: false, errors: ["设备配置为空"], warnings };
  }
  if (!device.name || !String(device.name).trim()) errors.push("设备名称不能为空");

  const protocol = device.protocol || "mock";
  const rules = PROTOCOL_RULES[protocol];
  if (!rules) {
    return { ok: false, errors: [`不支持的协议：${protocol}`], warnings };
  }

  // ---------------- 地址 ----------------
  const addr = device.address || {};
  if (protocol !== "mock") {
    if (!addr.host && !addr.baseUrl) {
      errors.push(`${protocol} 协议需要填写设备地址`);
    }
    if (addr.host && !RE_IP_OR_HOST.test(String(addr.host))) {
      errors.push(`IP 地址格式不正确：${addr.host}`);
    }
    if (addr.port !== undefined && addr.port !== "" && !isValidPort(addr.port)) {
      errors.push(`端口号非法：${addr.port}（应为 1-65535 的整数）`);
    }
    if (addr.baseUrl) {
      try {
        const u = new URL(String(addr.baseUrl));
        if (!/^https?:$/.test(u.protocol)) errors.push("接口地址必须以 http:// 或 https:// 开头");
      } catch {
        errors.push(`接口地址格式不正确：${addr.baseUrl}`);
      }
    }
    if (protocol !== "http" && !addr.port && addr.port !== 0) {
      warnings.push(`未填写端口，将使用默认端口（${protocol === "scpi" ? 5025 : 502}）`);
    }
  }

  // ---------------- 点位 ----------------
  const points = Array.isArray(device.points) ? device.points : [];
  if (protocol !== "mock" && points.length === 0) {
    errors.push("至少需要配置一个点位，否则无法采集数据");
  }

  const seenKeys = new Set();
  points.forEach((p, i) => {
    const at = `点位 #${i + 1}`;
    const key = String(p?.key || "").trim();
    if (!key) {
      errors.push(`${at}：key 不能为空`);
    } else if (!RE_KEY.test(key)) {
      errors.push(`${at}：key「${key}」只能包含字母、数字、下划线，且不能以数字开头`);
    } else if (seenKeys.has(key)) {
      errors.push(`${at}：key「${key}」重复，同一设备内必须唯一`);
    } else {
      seenKeys.add(key);
    }

    for (const field of rules.point.required || []) {
      if (p?.[field] === undefined || p?.[field] === "" || p?.[field] === null) {
        errors.push(`${at}（${key || "未命名"}）：缺少必填字段 ${field}`);
      }
    }

    // 至少要有一种取值方式
    if (rules.point.oneOf) {
      const any = rules.point.oneOf.some((group) => group.some((f) => p?.[f] !== undefined && p?.[f] !== ""));
      if (!any) {
        const hint = rules.point.oneOf.map((g) => g.join(" 或 ")).join("，或提供 ");
        errors.push(`${at}（${key || "未命名"}）：需要提供 ${hint}`);
      }
    }

    if (protocol === "modbus-tcp") {
      const reg = Number(p?.register);
      if (!Number.isInteger(reg) || reg < 0 || reg > 65535) {
        errors.push(`${at}（${key || "未命名"}）：寄存器地址应为 0-65535 的整数，当前为 ${p?.register}`);
      }
      const t = p?.type || "uint16";
      if (!VALID_TYPES.has(t)) {
        errors.push(`${at}（${key || "未命名"}）：数据类型「${t}」不支持，可选：${[...VALID_TYPES].join(" / ")}`);
      }
      if (p?.scale !== undefined && !Number.isFinite(Number(p.scale))) {
        errors.push(`${at}（${key || "未命名"}）：scale 必须是数字`);
      }
      if ((t === "int32" || t === "uint32" || t === "float32") && reg >= 65535) {
        errors.push(`${at}（${key || "未命名"}）：32 位类型需要连续 2 个寄存器，地址不能为 65535`);
      }
    }

    if (protocol === "scpi" && p?.command && !String(p.command).includes("{value}")) {
      warnings.push(`${at}（${key}）的 command 未包含 {value} 占位符，下发时不会替换为设定值`);
    }
  });

  // 采集周期
  if (device.pollIntervalMs !== undefined && device.pollIntervalMs !== "") {
    const iv = Number(device.pollIntervalMs);
    if (!Number.isFinite(iv) || iv < 2000) {
      errors.push("采集周期至少 2000 毫秒（2 秒），过短会给设备造成压力");
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 规范化设备配置：补默认值、去空白、限制字段 */
export function normalizeDevice(raw) {
  const d = { ...(raw || {}) };
  d.name = String(d.name || "").trim();
  if (d.address && typeof d.address === "object") {
    const a = { ...d.address };
    if (a.port !== undefined && a.port !== "") a.port = Number(a.port);
    if (a.unitId !== undefined && a.unitId !== "") a.unitId = Number(a.unitId);
    for (const k of Object.keys(a)) if (a[k] === "") delete a[k];
    d.address = a;
  }
  if (Array.isArray(d.points)) {
    d.points = d.points.map((p) => {
      const out = { ...(p || {}) };
      out.key = String(out.key || "").trim();
      if (out.register !== undefined && out.register !== "") out.register = Number(out.register);
      if (out.scale !== undefined && out.scale !== "") out.scale = Number(out.scale);
      if (out.offset !== undefined && out.offset !== "") out.offset = Number(out.offset);
      return out;
    });
  }
  if (d.pollIntervalMs !== undefined && d.pollIntervalMs !== "") d.pollIntervalMs = Number(d.pollIntervalMs);
  return d;
}
