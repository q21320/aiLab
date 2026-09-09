// ============================================================================
// AI Lab 实验室数字化管理平台 · 后端服务（零依赖 Node HTTP Server）
//
// 运行：cd backend && npm start   （或 node server.mjs）
// 端口：3800（环境变量 PORT 可覆盖）
//
// 接口：
//   GET    /api/health                       健康检查
//   GET    /api/lowcode/apps                 低代码应用列表
//   POST   /api/lowcode/apps                 发布/更新应用
//   PUT    /api/lowcode/apps/:kind/:id       更新应用字段
//   DELETE /api/lowcode/apps/:kind/:id       卸载应用
//   GET    /api/iot/overview                 物联网概览（在线/告警/能耗/样测）
//   GET    /api/iot/devices                  设备列表
//   POST   /api/iot/devices                  接入设备
//   PUT    /api/iot/devices/:id              更新设备
//   DELETE /api/iot/devices/:id              删除设备
//   GET    /api/iot/devices/:id/history      设备历史数据
//   GET    /api/iot/alerts                   告警列表
//   PUT    /api/iot/alerts/:id/ack           确认告警
//   GET    /api/iot/stream                   SSE 实时数据流（2s 推送一次）
//   GET    /api/backup                       全量导出备份
//   POST   /api/backup/restore               恢复备份
//   GET    /api/backup/snapshots             备份文件列表
//
// 数据持久化：backend/data/apps.json / iot.json / backups/
// ============================================================================

import http from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "data");
const BACKUP_DIR = join(DATA_DIR, "backups");
const APPS_FILE = join(DATA_DIR, "apps.json");
const IOT_FILE = join(DATA_DIR, "iot.json");
const PORT = Number(process.env.PORT || 3800);

function readJson(file, fallback) {
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf-8"));
  } catch (e) {
    console.error(`[backend] 读取 ${file} 失败：`, e.message);
  }
  return fallback;
}
function writeJson(file, data) {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2), "utf-8");
  } catch (e) {
    console.error(`[backend] 写入 ${file} 失败：`, e.message);
  }
}

// ---------------------------------------------------------------------------
// 低代码应用
// ---------------------------------------------------------------------------
let apps = readJson(APPS_FILE, []);

// ---------------------------------------------------------------------------
// 物联网：设备 + 采集 + 告警（数据源模拟器）
// ---------------------------------------------------------------------------
let iotState = readJson(IOT_FILE, null);
if (!iotState || !Array.isArray(iotState.devices)) {
  iotState = {
    devices: [
      { id: "DEV-001", name: "高低温试验箱", type: "env", location: "实验室A-101", status: "online", baseTemp: 35.2, baseHum: 60, power: 12.4, limits: { temperature: { max: 45, warn: 40 }, humidity: { max: 85, warn: 75 } } },
      { id: "DEV-002", name: "恒温恒湿箱", type: "env", location: "实验室A-102", status: "online", baseTemp: 28.0, baseHum: 55, power: 9.8, limits: { temperature: { max: 38, warn: 34 }, humidity: { max: 80, warn: 70 } } },
      { id: "DEV-003", name: "万能材料试验机", type: "test", location: "实验室B-201", status: "online", baseTemp: 24.5, baseHum: 45, power: 15.2, limits: { temperature: { max: 30, warn: 28 } } },
      { id: "DEV-004", name: "三坐标测量仪", type: "test", location: "实验室B-202", status: "offline", baseTemp: 23.0, baseHum: 50, power: 0, limits: { temperature: { max: 30, warn: 28 } } },
      { id: "DEV-005", name: "厂区总能耗表", type: "energy", location: "配电房", status: "online", baseTemp: 30.0, baseHum: 50, power: 42.6, limits: { power: { max: 60, warn: 50 } } },
      { id: "DEV-006", name: "3号试验箱", type: "env", location: "实验室A-103", status: "error", baseTemp: 42.1, baseHum: 70, power: 18.4, limits: { temperature: { max: 45, warn: 40 }, humidity: { max: 85, warn: 75 } } },
    ],
    alerts: [
      { id: "AL-0001", deviceId: "DEV-006", level: "error", message: "3号试验箱 温度 42.1℃ 超过预警值 40℃", time: Date.now() - 60000, status: "open" },
    ],
    serial: 100,
    tick: 0,
  };
}

// 历史数据（内存环形缓冲，保留最近 120 点/设备）
const histories = new Map();
function pushHistory(device, point) {
  const list = histories.get(device.id) || [];
  list.push(point);
  if (list.length > 120) list.shift();
  histories.set(device.id, list);
}

function rand(base, amp) {
  return Math.round((base + (Math.random() - 0.5) * 2 * amp) * 100) / 100;
}

function computePoint(id) {
  const d = iotState.devices.find((x) => x.id === id);
  if (!d || d.status === "offline") return null;
  const point = {
    time: Date.now(),
    temperature: d.type === "energy" ? rand(d.baseTemp, 2) : rand(d.baseTemp, 3),
    humidity: d.type === "energy" ? rand(d.baseHum, 5) : rand(d.baseHum, 6),
    power: d.type === "energy" ? rand(d.power, 2.5) : rand(d.power, 0.8),
  };
  return point;
}

function checkAlerts(device, point) {
  if (!point || !device.limits) return null;
  const limits = device.limits;
  if (limits.temperature && point.temperature > limits.temperature.warn) {
    return {
      level: point.temperature > limits.temperature.max ? "error" : "warn",
      message: `${device.name} 温度 ${point.temperature}℃ 超过预警值 ${limits.temperature.warn}℃`,
    };
  }
  if (limits.humidity && point.humidity > limits.humidity.warn) {
    return {
      level: point.humidity > limits.humidity.max ? "error" : "warn",
      message: `${device.name} 湿度 ${point.humidity}% 超过预警值 ${limits.humidity.warn}%`,
    };
  }
  if (limits.power && point.power > limits.power.warn) {
    return {
      level: point.power > limits.power.max ? "error" : "warn",
      message: `${device.name} 功率 ${point.power}kW 超过预警值 ${limits.power.warn}kW`,
    };
  }
  return null;
}

const POINT_LOG = new Map(); // 记录最近一次告警时间，避免刷屏
function simulateTick() {
  iotState.tick += 1;
  const points = [];
  for (const d of iotState.devices) {
    const point = computePoint(d.id);
    if (!point) continue;
    pushHistory(d, point);
    points.push({ deviceId: d.id, deviceName: d.name, type: d.type, ...point });
    const alert = checkAlerts(d, point);
    if (alert) {
      const last = POINT_LOG.get(d.id) || 0;
      if (!iotState.alerts.some((a) => a.deviceId === d.id && a.status === "open") && Date.now() - last > 30000) {
        POINT_LOG.set(d.id, Date.now());
        iotState.serial += 1;
        iotState.alerts.unshift({
          id: `AL-${String(iotState.serial).padStart(4, "0")}`,
          deviceId: d.id,
          level: alert.level,
          message: alert.message,
          time: Date.now(),
          status: "open",
        });
        if (iotState.alerts.length > 100) iotState.alerts.length = 100;
        writeJson(IOT_FILE, iotState);
      }
    }
  }
  const overview = computeOverview(points);
  broadcast({ devices: iotState.devices, points, overview, alerts: iotState.alerts });
  return overview;
}

function computeOverview(points) {
  const s = (v, d = 0) => v ?? d;
  const online = iotState.devices.filter((d) => d.status !== "offline").length;
  const testCount = iotState.devices.filter((d) => d.type === "test" && d.status === "online").length;
  const energyNow = iotState.devices.filter((d) => d.type === "energy").reduce((a, b) => a + (points.find((p) => p.deviceId === b.id)?.power || b.power), 0);
  return {
    online,
    total: iotState.devices.length,
    openAlerts: iotState.alerts.filter((a) => a.status === "open").length,
    energyNow: Math.round(energyNow * 100) / 100,
    energyToday: Math.round(energyNow * 24 * 100) / 100,
    testToday: s(testCount * 6 + iotState.tick % 7),
    samplesInToday: 12 + (iotState.tick % 5),
    samplesTesting: 6 + (iotState.tick % 4),
    samplesOutToday: 8 + (iotState.tick % 6),
    tick: iotState.tick,
    time: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// SSE 实时推送
// ---------------------------------------------------------------------------
const clients = new Set();
function broadcast(payload) {
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try {
      res.write(data);
    } catch {
      clients.delete(res);
    }
  }
}
setInterval(simulateTick, 2000);

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
function corsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJSON(res, code, body) {
  corsHeaders(res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    corsHeaders(res);
    res.writeHead(204);
    return res.end();
  }

  // 健康检查
  if (method === "GET" && path === "/api/health") {
    return sendJSON(res, 200, { ok: true, apps: apps.length, devices: iotState.devices.length, uptime: process.uptime(), time: Date.now() });
  }

  // ---------------- 低代码应用 ----------------
  if (method === "GET" && path === "/api/lowcode/apps") {
    return sendJSON(res, 200, { apps });
  }
  if (method === "POST" && path === "/api/lowcode/apps") {
    try {
      const body = await readBody(req);
      const app = body && body.app;
      if (!app || !app.kind || !app.id) return sendJSON(res, 400, { error: "app 对象必须包含 kind 与 id" });
      const idx = apps.findIndex((a) => a.kind === app.kind && a.id === app.id);
      if (idx >= 0) apps[idx] = app;
      else apps.push(app);
      writeJson(APPS_FILE, apps);
      return sendJSON(res, 200, { app });
    } catch {
      return sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
    }
  }
  const putApp = path.match(/^\/api\/lowcode\/apps\/([^/]+)\/([^/]+)$/);
  if (method === "PUT" && putApp) {
    const [, kind, id] = putApp;
    const idx = apps.findIndex((a) => a.kind === kind && a.id === id);
    if (idx < 0) return sendJSON(res, 404, { error: "应用不存在" });
    try {
      const body = await readBody(req);
      const target = apps[idx];
      for (const key of ["name", "enable", "menu", "schema"]) if (key in body) target[key] = body[key];
      target.updatedAt = Date.now();
      writeJson(APPS_FILE, apps);
      return sendJSON(res, 200, { app: target });
    } catch {
      return sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
    }
  }
  const delApp = path.match(/^\/api\/lowcode\/apps\/([^/]+)\/([^/]+)$/);
  if (method === "DELETE" && delApp) {
    const [, kind, id] = delApp;
    const before = apps.length;
    apps = apps.filter((a) => !(a.kind === kind && a.id === id));
    writeJson(APPS_FILE, apps);
    return sendJSON(res, 200, { ok: apps.length < before });
  }

  // ---------------- 物联网 ----------------
  if (method === "GET" && path === "/api/iot/overview") {
    return sendJSON(res, 200, computeOverview([]));
  }
  if (method === "GET" && path === "/api/iot/devices") {
    return sendJSON(res, 200, { devices: iotState.devices });
  }
  if (method === "POST" && path === "/api/iot/devices") {
    try {
      const body = await readBody(req);
      const d = body && body.device;
      if (!d || !d.name) return sendJSON(res, 400, { error: "设备必须包含 name" });
      if (iotState.devices.some((x) => x.id === d.id)) return sendJSON(res, 400, { error: "设备 ID 已存在" });
      d.id = d.id || `DEV-${String(iotState.devices.length + 1).padStart(3, "0")}`;
      d.status = d.status || "online";
      d.power = d.power ?? 5;
      d.baseTemp = d.baseTemp ?? 25;
      d.baseHum = d.baseHum ?? 50;
      iotState.devices.push(d);
      writeJson(IOT_FILE, iotState);
      return sendJSON(res, 200, { device: d });
    } catch {
      return sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
    }
  }
  const iotDevicePath = path.match(/^\/api\/iot\/devices\/([^/]+)$/);
  if (iotDevicePath) {
    const id = decodeURIComponent(iotDevicePath[1]);
    if (method === "GET") {
      const list = histories.get(id) || [];
      return sendJSON(res, 200, { device: iotState.devices.find((d) => d.id === id) || null, history: list });
    }
    if (method === "PUT") {
      try {
        const body = await readBody(req);
        const d = iotState.devices.find((x) => x.id === id);
        if (!d) return sendJSON(res, 404, { error: "设备不存在" });
        for (const key of ["name", "location", "status", "limits"]) if (key in body) d[key] = body[key];
        writeJson(IOT_FILE, iotState);
        return sendJSON(res, 200, { device: d });
      } catch {
        return sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
      }
    }
    if (method === "DELETE") {
      const before = iotState.devices.length;
      iotState.devices = iotState.devices.filter((d) => d.id !== id);
      histories.delete(id);
      writeJson(IOT_FILE, iotState);
      return sendJSON(res, 200, { ok: iotState.devices.length < before });
    }
  }
  if (method === "GET" && path === "/api/iot/devices-history") {
    const all = {};
    for (const [id, list] of histories) all[id] = list;
    return sendJSON(res, 200, all);
  }
  if (method === "GET" && path === "/api/iot/alerts") {
    return sendJSON(res, 200, { alerts: iotState.alerts });
  }
  const ackPath = path.match(/^\/api\/iot\/alerts\/([^/]+)\/ack$/);
  if (method === "PUT" && ackPath) {
    const a = iotState.alerts.find((x) => x.id === decodeURIComponent(ackPath[1]));
    if (!a) return sendJSON(res, 404, { error: "告警不存在" });
    a.status = "acked";
    a.ackedAt = Date.now();
    writeJson(IOT_FILE, iotState);
    return sendJSON(res, 200, { alert: a });
  }
  if (method === "GET" && path === "/api/iot/stream") {
    corsHeaders(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify({ hello: true, time: Date.now() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // ---------------- 备份与恢复（4.8 数据存储/备份） ----------------
  if (method === "GET" && path === "/api/backup") {
    return sendJSON(res, 200, {
      exportedAt: Date.now(),
      apps,
      iot: iotState,
    });
  }
  if (method === "POST" && path === "/api/backup/snapshot") {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      const name = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
      writeFileSync(join(BACKUP_DIR, name), JSON.stringify({ apps, iot: iotState }, null, 2), "utf-8");
      const files = readdirSync(BACKUP_DIR);
      if (files.length > 20) writeFileSync(join(BACKUP_DIR, files[0]), "", "utf-8");
      return sendJSON(res, 200, { ok: true, file: name });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }
  if (method === "GET" && path === "/api/backup/snapshots") {
    try {
      mkdirSync(BACKUP_DIR, { recursive: true });
      return sendJSON(res, 200, { files: readdirSync(BACKUP_DIR) });
    } catch {
      return sendJSON(res, 200, { files: [] });
    }
  }
  if (method === "POST" && path === "/api/backup/restore") {
    try {
      const body = await readBody(req);
      const data = body && body.data;
      if (!data || !Array.isArray(data.apps) || !data.iot) return sendJSON(res, 400, { error: "备份数据格式不正确" });
      apps = data.apps;
      iotState = data.iot;
      writeJson(APPS_FILE, apps);
      writeJson(IOT_FILE, iotState);
      return sendJSON(res, 200, { ok: true });
    } catch {
      return sendJSON(res, 400, { error: "恢复失败：JSON 解析错误" });
    }
  }

  return sendJSON(res, 404, { error: "接口不存在" });
});

server.listen(PORT, () => {
  console.log(`[backend] 实验室数字化管理平台后端已启动：http://localhost:${PORT}`);
  console.log(`[backend] 应用 ${apps.length} 个 · 设备 ${iotState.devices.length} 台 · 数据目录 ${DATA_DIR}`);
});
