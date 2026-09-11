// ============================================================================
// 工业物联网 · 真实协议驱动层
//
// 每个驱动实现统一接口：
//   probe(cfg, points)            → { ok, info }        探测真实设备信息（*IDN?/寄存器）
//   read(cfg, points)             → { ok, values }      读取实时数据（点位表）
//   write(cfg, point, value)      → { ok }              下发控制（SCPI 命令/写寄存器）
//
// 驱动：scpi（TCP 仪器）、modbus-tcp（PLC/试验箱/能耗表）、http（REST 设备）、
//       mqtt（订阅）、mock（平台内模拟设备，用于无硬件演示）
// ============================================================================

import net from "node:net";

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

function toNumber(raw) {
  if (raw === null || raw === undefined) return NaN;
  const m = String(raw).match(/-?\d+(\.\d+)?([eE][-+]?\d+)?/);
  return m ? Number(m[0]) : NaN;
}
function applyScale(raw, point) {
  const n = toNumber(raw);
  const scale = point?.scale ?? 1;
  const offset = point?.offset ?? 0;
  const v = Number.isFinite(n) ? n * scale + offset : null;
  return point?.decimals !== undefined && v !== null ? Number(v.toFixed(point.decimals)) : v;
}

// ---------------------------------------------------------------------------
// 1) SCPI over TCP —— 可编程电源/万用表/示波器/材料试验机等
// ---------------------------------------------------------------------------
function scpiCommand(host, port, cmd, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: Number(port) });
    let buf = "";
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      err ? reject(err) : resolve(data);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => sock.write(String(cmd) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString("utf8");
      if (buf.includes("\n")) finish(null, buf.trim());
    });
    sock.on("timeout", () => finish(new Error(`SCPI 超时（${host}:${port}），请检查 IP/端口/网络`)));
    sock.on("error", (e) => finish(new Error(`SCPI 连接失败（${host}:${port}）：${e.message}`)));
  });
}

export const scpiDriver = {
  id: "scpi",
  label: "SCPI 仪器（TCP，电源/万用表/试验机）",
  fields: [
    { key: "host", label: "IP 地址", placeholder: "192.168.1.100" },
    { key: "port", label: "端口", type: "number", default: 5025 },
  ],
  async probe(cfg) {
    const raw = await scpiCommand(cfg.host, cfg.port, "*IDN?");
    const [manufacturer = "", model = "", serial = "", firmware = ""] = raw.split(",").map((s) => s.trim());
    const probe = { ok: true, info: { 厂商: manufacturer, 型号: model, 序列号: serial, 固件: firmware, 原始响应: raw } };
    try {
      probe.info["设备状态"] = await scpiCommand(cfg.host, cfg.port, "SYST:STAT?");
    } catch {
      /* 可选命令，忽略 */
    }
    return probe;
  },
  async read(cfg, points) {
    const values = {};
    for (const p of points || []) {
      if (!p.query) continue;
      const raw = await scpiCommand(cfg.host, cfg.port, p.query);
      values[p.key] = { label: p.label || p.key, value: applyScale(raw, p), raw, unit: p.unit || "" };
    }
    return { ok: true, values };
  },
  async write(cfg, point, value) {
    const cmd = String(point.command || "").replace("{value}", String(value));
    await scpiCommand(cfg.host, cfg.port, cmd);
    return { ok: true, command: cmd };
  },
};

// ---------------------------------------------------------------------------
// 2) Modbus TCP —— 环境试验箱/PLC/电表/能耗表
// ---------------------------------------------------------------------------
function modbusTCP(host, port, unitId, pdu, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const txId = Math.floor(Math.random() * 0xffff);
    const header = Buffer.alloc(7);
    header.writeUInt16BE(txId, 0);
    header.writeUInt16BE(0, 2);
    header.writeUInt16BE(pdu.length + 1, 4);
    header.writeUInt8(Number(unitId) || 1, 6);
    const frame = Buffer.concat([header, Buffer.from(pdu)]);

    const sock = net.createConnection({ host, port: Number(port) });
    let buf = Buffer.alloc(0);
    let settled = false;
    const finish = (err, data) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      err ? reject(err) : resolve(data);
    };
    sock.setTimeout(timeoutMs);
    sock.on("connect", () => sock.write(frame));
    sock.on("data", (d) => {
      buf = Buffer.concat([buf, d]);
      if (buf.length >= 9) {
        const len = buf.readUInt16BE(4);
        if (buf.length >= 6 + len) {
          const pduResp = buf.subarray(7, 6 + len);
          if (pduResp[0] & 0x80) {
            finish(new Error(`Modbus 异常响应，功能码异常码 ${pduResp[1]}`));
          } else {
            finish(null, Buffer.from(pduResp));
          }
        }
      }
    });
    sock.on("timeout", () => finish(new Error(`Modbus 超时（${host}:${port}）`)));
    sock.on("error", (e) => finish(new Error(`Modbus 连接失败（${host}:${port}）：${e.message}`)));
  });
}

function decodeRegisters(regs, type, order = "AB") {
  const u16 = (i) => regs[i] ?? 0;
  switch (type) {
    case "int16":
      return u16(0) > 32767 ? u16(0) - 65536 : u16(0);
    case "uint32":
      return order === "AB" ? u16(0) * 65536 + u16(1) : u16(1) * 65536 + u16(0);
    case "int32": {
      const v = order === "AB" ? u16(0) * 65536 + u16(1) : u16(1) * 65536 + u16(0);
      return v > 2147483647 ? v - 4294967296 : v;
    }
    case "float32": {
      const b = Buffer.alloc(4);
      if (order === "AB") {
        b.writeUInt16BE(u16(0), 0);
        b.writeUInt16BE(u16(1), 2);
      } else {
        b.writeUInt16BE(u16(1), 0);
        b.writeUInt16BE(u16(0), 2);
      }
      return b.readFloatBE(0);
    }
    case "uint16":
    default:
      return u16(0);
  }
}

function pointRegisterCount(type) {
  return type === "uint32" || type === "int32" || type === "float32" ? 2 : 1;
}

export const modbusTcpDriver = {
  id: "modbus-tcp",
  label: "Modbus TCP（PLC / 试验箱 / 能耗表）",
  fields: [
    { key: "host", label: "IP 地址", placeholder: "192.168.1.50" },
    { key: "port", label: "端口", type: "number", default: 502 },
    { key: "unitId", label: "从站号", type: "number", default: 1 },
  ],
  async probe(cfg, points) {
    const first = (points || [])[0] || { register: 0, type: "uint16", label: "寄存器0" };
    const pdu = [0x03, (first.register >> 8) & 0xff, first.register & 0xff, 0, pointRegisterCount(first.type)];
    const resp = await modbusTCP(cfg.host, cfg.port, cfg.unitId, pdu);
    const regs = [];
    for (let i = 2; i < resp.length; i += 2) regs.push(resp.readUInt16BE(i));
    return {
      ok: true,
      info: {
        协议: "Modbus TCP",
        从站号: cfg.unitId ?? 1,
        通信状态: "正常（寄存器读取成功）",
        首个寄存器: `地址 ${first.register} = ${decodeRegisters(regs, first.type, first.order)}`,
        寄存器快照: regs.slice(0, 8).join(", "),
      },
    };
  },
  async read(cfg, points) {
    const values = {};
    for (const p of points || []) {
      const fc = p.fc === 4 ? 0x04 : 0x03;
      const pdu = [fc, (p.register >> 8) & 0xff, p.register & 0xff, 0, pointRegisterCount(p.type)];
      const resp = await modbusTCP(cfg.host, cfg.port, cfg.unitId, pdu);
      const regs = [];
      for (let i = 2; i < resp.length; i += 2) regs.push(resp.readUInt16BE(i));
      const raw = decodeRegisters(regs, p.type || "uint16", p.order || "AB");
      values[p.key] = {
        label: p.label || p.key,
        value: applyScale(raw, p),
        raw,
        unit: p.unit || "",
        register: p.register,
      };
    }
    return { ok: true, values };
  },
  async write(cfg, point, value) {
    const addr = point.register;
    const raw = Math.round((Number(value) - (point.offset ?? 0)) / (point.scale ?? 1));
    if (point.type === "float32" || point.type === "uint32" || point.type === "int32") {
      const b = Buffer.alloc(4);
      if (point.type === "float32") b.writeFloatBE(raw, 0);
      else b.writeUInt32BE(raw >>> 0, 0);
      const pdu = [0x10, (addr >> 8) & 0xff, addr & 0xff, 0, 2, 4, b[0], b[1], b[2], b[3]];
      await modbusTCP(cfg.host, cfg.port, cfg.unitId, pdu);
    } else {
      const pdu = [0x06, (addr >> 8) & 0xff, addr & 0xff, (raw >> 8) & 0xff, raw & 0xff];
      await modbusTCP(cfg.host, cfg.port, cfg.unitId, pdu);
    }
    return { ok: true, register: addr, value };
  },
};

// ---------------------------------------------------------------------------
// 3) HTTP / REST 设备（带接口的新仪器、边缘网关）
// ---------------------------------------------------------------------------
function getByPath(obj, path) {
  return String(path || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, k) => (acc == null ? acc : acc[k]), obj);
}

export const httpDriver = {
  id: "http",
  label: "HTTP / REST 设备（带接口仪器、网关）",
  fields: [
    { key: "baseUrl", label: "接口地址", placeholder: "http://192.168.1.60/api" },
    { key: "token", label: "Token（可选）" },
  ],
  async probe(cfg) {
    const res = await withTimeout(fetch(`${cfg.baseUrl}/info`, { headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {} }), 4000, "HTTP 设备探测超时");
    const data = await res.json().catch(() => ({}));
    return { ok: true, info: { 接口: `${cfg.baseUrl}/info`, HTTP状态: res.status, 设备信息: JSON.stringify(data).slice(0, 300) } };
  },
  async read(cfg, points) {
    const values = {};
    for (const p of points || []) {
      const url = p.url || `${cfg.baseUrl}/value?key=${encodeURIComponent(p.key)}`;
      const res = await withTimeout(fetch(url, { headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {} }), 4000, `HTTP 读取超时：${url}`);
      const data = await res.json().catch(() => ({}));
      const raw = p.path ? getByPath(data, p.path) : data.value ?? data[p.key];
      values[p.key] = { label: p.label || p.key, value: applyScale(raw, p), raw, unit: p.unit || "" };
    }
    return { ok: true, values };
  },
  async write(cfg, point, value) {
    const url = point.url || `${cfg.baseUrl}/write`;
    await withTimeout(
      fetch(url, {
        method: point.method || "POST",
        headers: { "Content-Type": "application/json", ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) },
        body: JSON.stringify({ key: point.key, value }),
      }),
      4000,
      "HTTP 下发超时"
    );
    return { ok: true };
  },
};

// ---------------------------------------------------------------------------
// 4) mock —— 平台内模拟设备（无硬件演示/回归测试）
// ---------------------------------------------------------------------------
export const mockDriver = {
  id: "mock",
  label: "平台模拟设备（无硬件演示）",
  fields: [],
  async probe() {
    return { ok: true, info: { 类型: "平台内置模拟设备", 说明: "由后端采集模拟器提供数据" } };
  },
  async read(cfg, points, ctx) {
    const point = (ctx?.latestPoints || []).find((p) => p.deviceId === cfg.deviceId);
    const values = {};
    for (const p of points || []) {
      const raw = point ? point[p.key] ?? point.temperature : null;
      values[p.key] = { label: p.label || p.key, value: raw, raw, unit: p.unit || "" };
    }
    return { ok: true, values };
  },
  async write() {
    return { ok: true, note: "模拟设备写入已忽略" };
  },
};

// ---------------------------------------------------------------------------
// 注册表
// ---------------------------------------------------------------------------
export const DRIVERS = {
  scpi: scpiDriver,
  "modbus-tcp": modbusTcpDriver,
  http: httpDriver,
  mock: mockDriver,
};

export function listDrivers() {
  return Object.values(DRIVERS).map((d) => ({ id: d.id, label: d.label, fields: d.fields }));
}

export function getDriver(protocol) {
  const d = DRIVERS[protocol];
  if (!d) throw new Error(`不支持的协议：${protocol}（可选：${Object.keys(DRIVERS).join(" / ")}）`);
  return d;
}

/** 设备配置：{ protocol, address:{host,port,unitId,baseUrl,token}, points:[...] } */
export async function probeDevice(device, ctx) {
  return getDriver(device.protocol).probe(device.address || {}, device.points || [], ctx);
}
export async function readDevice(device, ctx) {
  return getDriver(device.protocol).read(device.address || {}, device.points || [], ctx);
}
export async function writeDevicePoint(device, pointKey, value) {
  const point = (device.points || []).find((p) => p.key === pointKey);
  if (!point) throw new Error(`设备 ${device.id} 不存在点位 ${pointKey}`);
  return getDriver(device.protocol).write(device.address || {}, point, value);
}
