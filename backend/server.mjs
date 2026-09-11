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
import net from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { spawn } from "node:child_process";
import { createIotExtraRoutes } from "./iot/api.mjs";
import { createFormRoutes } from "./forms.mjs";
import { createCrudRoutes } from "./crud.mjs";
import { createAuditRoutes } from "./audit.mjs";
import { paths } from "./paths.mjs";
import { assets } from "./assets.mjs";

const BACKUP_DIR = join(paths.dataDir, "backups");
const APPS_FILE = join(paths.dataDir, "apps.json");
const IOT_FILE = join(paths.dataDir, "iot.json");

// ---------------------------------------------------------------------------
// 前端静态资源（内嵌优先，其次磁盘 public/，最后提示）
// ---------------------------------------------------------------------------
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
function mimeOf(file) {
  return MIME[extname(file).toLowerCase()] || "application/octet-stream";
}

/** 安全 stat：不存在时返回 null */
function safeStat(file) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

/** 判断请求是否属于「静态资源」（而非前端路由），用于决定 404 还是回退 index.html */
function looksLikeAsset(rel) {
  if (rel === "index.html" || rel.endsWith(".html")) return false;
  if (rel.startsWith("assets/")) return true;
  // 带扩展名（.js/.css/.map/.png/.svg/.ico/.woff…）的都按资源处理
  return /\.[a-z0-9]{2,8}$/i.test(rel);
}

/** 静态资源的缓存策略：带内容哈希的产物可长缓存，index.html 一律不缓存 */
function cacheHeaderFor(rel) {
  if (rel === "index.html" || rel.endsWith(".html")) return "no-store";
  if (/^assets\/.+-[A-Za-z0-9_-]{8,}\.(js|css)$/.test(rel)) return "public, max-age=31536000, immutable";
  return "public, max-age=3600";
}

/** 资源缺失：返回明确的 404（绝不返回 HTML，避免浏览器严格 MIME 校验报错） */
function sendAsset404(res, rel) {
  res.writeHead(404, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(
    `资源不存在：/${rel}\n\n` +
      `常见原因：\n` +
      `1) 浏览器缓存了旧版本的 index.html（引用了旧的哈希文件名）→ 请按 Ctrl+F5 强制刷新\n` +
      `2) 前端构建产物与当前服务不匹配 → 重新执行 frontend 的 npm run build（会自动同步到 backend/public）\n` +
      `3) 双击 exe 的场景请确认使用的是最新打包的 exe\n`
  );
}

/** 返回 true 表示已响应 */
function serveStatic(res, path) {
  const rel = (path === "/" ? "index.html" : path.replace(/^\/+/, "")).split("?")[0];
  const isAsset = looksLikeAsset(rel);

  // 1) 内嵌资源（exe 单文件模式）
  if (assets.embedded) {
    const hit = assets.embedded[rel];
    if (hit) {
      res.writeHead(200, { "Content-Type": mimeOf(rel), "Cache-Control": cacheHeaderFor(rel) });
      res.end(Buffer.from(hit, "base64"));
      return true;
    }
    if (isAsset) {
      // 资源缺失：明确 404，不要回退成 HTML（否则触发 "MIME type of text/html" 报错）
      sendAsset404(res, rel);
      return true;
    }
    // 前端路由（如 /apps、/iot）回退到 index.html
    if (assets.embedded["index.html"]) {
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(Buffer.from(assets.embedded["index.html"], "base64"));
      return true;
    }
    return false;
  }

  // 2) 磁盘 public/（源码运行 + 已构建前端）
  if (existsSync(paths.publicDir)) {
    const full = join(paths.publicDir, rel);
    // 用 statSync 判断是否为真实文件（注意：不能用 existsSync(join(full, "."))，
    // path.join 会把 "." 规范化掉，导致判断恒为真、文件永远不被返回）
    const st = safeStat(full);
    if (st && st.isFile()) {
      try {
        const buf = readFileSync(full);
        res.writeHead(200, { "Content-Type": mimeOf(rel), "Cache-Control": cacheHeaderFor(rel) });
        res.end(buf);
        return true;
      } catch {
        /* 读取失败时按缺失处理 */
      }
    }
    if (isAsset) {
      sendAsset404(res, rel);
      return true;
    }
    const indexFile = join(paths.publicDir, "index.html");
    if (safeStat(indexFile)?.isFile()) {
      res.writeHead(200, { "Content-Type": MIME[".html"], "Cache-Control": "no-store" });
      res.end(readFileSync(indexFile));
      return true;
    }
  }
  return false;
}

const NO_UI_HINT = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>AI Lab 平台</title>
<style>body{font-family:system-ui,"Microsoft YaHei";margin:60px auto;max-width:720px;line-height:1.8;color:#303133}
code{background:#f5f7fa;padding:2px 6px;border-radius:4px}</style></head><body>
<h2>后端已启动，但未找到前端页面资源</h2>
<p>当前是「纯接口模式」。请选择一种方式提供页面：</p>
<ol>
<li>源码运行：在 <code>frontend</code> 执行 <code>npm run build</code>，产物复制到 <code>${paths.publicDir}</code></li>
<li>开发联调：<code>frontend</code> 执行 <code>npm run dev</code>，直接访问 <code>http://localhost:5173</code>（已代理 /api）</li>
<li>打包 exe：<code>node tools/build-exe.mjs</code>，前端资源会内嵌进 exe</li>
</ol>
<p>接口自检：<a href="/api/health">/api/health</a></p>
</body></html>`;

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
    mkdirSync(paths.dataDir, { recursive: true });
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
    // 真实协议设备（scpi / modbus-tcp / http）由驱动或自动化测试采集，不走模拟器
    if (d.protocol && d.protocol !== "mock") continue;
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
// 设备接入 / 真实设备读写 / 虚拟仪器 / 自动化测试（委托给 iot/api.mjs）
// ---------------------------------------------------------------------------
const iotExtra = createIotExtraRoutes({
  sendJSON,
  readBody,
  getIot: () => iotState,
  persistIot: () => writeJson(IOT_FILE, iotState),
  broadcast,
  histories,
  dataDir: paths.dataDir,
});

// 低代码表单提交与数据存储
const formRoutes = createFormRoutes({
  sendJSON,
  readBody,
  dataFile: join(paths.dataDir, "form-submissions.json"),
});

// 通用 CRUD 接口（低代码「数据表格」组件的数据源）
const crudRoutes = createCrudRoutes({
  sendJSON,
  readBody,
  dataFile: join(paths.dataDir, "crud.json"),
});

// 操作日志（审计）· 按月归档、不限条数
const auditRoutes = createAuditRoutes({
  sendJSON,
  readBody,
  dataDir: paths.dataDir,
});

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

  // 设备接入 / 真实设备读写 / 虚拟仪器 / 自动化测试
  if (await iotExtra(req, res, path, method)) return;

  // 低代码表单提交
  if (await formRoutes(req, res, path, method)) return;

  // 通用 CRUD（数据表格组件数据源）
  if (await crudRoutes(req, res, path, method)) return;

  // 操作日志（审计）
  if (await auditRoutes(req, res, path, method)) return;

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

  // 非 /api 请求：返回前端页面（内嵌资源优先，其次磁盘 public/）
  if (!path.startsWith("/api/")) {
    if (serveStatic(res, path)) return;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(NO_UI_HINT);
  }

  return sendJSON(res, 404, { error: "接口不存在" });
});

// ---------------------------------------------------------------------------
// 启动流程（健壮版：端口自动避让 + 已在运行时直接开浏览器 + 永不静默退出）
// ---------------------------------------------------------------------------
const HOST = paths.host; // 默认只监听本机，避免 Windows 防火墙弹窗
const PORT_CANDIDATES = Array.from({ length: 10 }, (_, i) => paths.port + i);

function stamp() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}
/** 启动日志写到 exe 同级 data/startup.log，便于双击失败时排查 */
function startupLog(msg) {
  const line = `[${stamp()}] ${msg}`;
  console.log(line);
  try {
    mkdirSync(paths.dataDir, { recursive: true });
    appendFileSync(join(paths.dataDir, "startup.log"), line + "\n", "utf-8");
  } catch {
    /* 忽略日志写入失败 */
  }
}

/** 探测该端口上是否已经是本平台（依据 /api/health 的 ok 标记与设备数字段） */
async function probeExisting(port) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 900);
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return body?.ok === true && typeof body?.devices === "number";
  } catch {
    return false;
  }
}

/** 打开浏览器（AILAB_NO_OPEN=1 可关闭） */
function openBrowser(port) {
  if (!paths.autoOpen) return;
  const url = `http://localhost:${port}`;
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
    console.log(`  已为你打开浏览器：${url}`);
  } catch {
    console.log(`  未能自动打开浏览器，请手动访问：${url}`);
  }
}

/** 保持控制台窗口打开（双击运行时避免"一闪而过"，按回车退出） */
function holdWindow(reason) {
  console.log("");
  console.log("  ─────────────────────────────────────────────────────────────");
  console.log(`  ${reason}`);
  console.log("  按回车键关闭本窗口…");
  console.log("  ─────────────────────────────────────────────────────────────");
  try {
    process.stdin.resume();
    process.stdin.once("data", () => process.exit(0));
    // 无人按键时也不退出（避免服务被误关）
  } catch {
    /* 无 stdin（服务方式运行）时忽略 */
  }
}

function listenOn(port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      server.removeListener("listening", onListening);
      reject(e);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  });
}

/** 端口是否已被占用（TCP 连接探测，兼容 Windows 通配地址绑定语义） */
function portIsInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve(v);
    };
    sock.setTimeout(700);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

async function bootstrap() {
  startupLog(
    `启动中：exe=${paths.isSea ? "是" : "否"} node=${process.version} 基准目录=${paths.baseDir} 数据目录=${paths.dataDir}`
  );
  for (const port of PORT_CANDIDATES) {
    if (await portIsInUse(port)) {
      // 已被占用：是本平台就只开浏览器；是别的程序就换下一个端口
      if (await probeExisting(port)) {
        startupLog(`端口 ${port} 上已检测到本平台正在运行，直接打开页面（无需重复启动）。`);
        console.log("");
        console.log(`  ✅ 平台已在运行：http://localhost:${port}`);
        openBrowser(port);
        if (paths.isSea) holdWindow("检测到平台已经在运行，无需重复启动。");
        return;
      }
      startupLog(`端口 ${port} 已被其它程序占用，自动尝试下一个端口…`);
      continue;
    }
    try {
      await listenOn(port);
      if (port !== paths.port) startupLog(`默认端口 ${paths.port} 被占用，已自动改用端口 ${port}`);
      console.log("================================================================================");
      console.log("  AI Lab 实验室数字化管理平台");
      console.log(`  访问地址：http://localhost:${port}${HOST === "0.0.0.0" ? "（局域网可访问）" : "（仅本机访问）"}`);
      console.log(`  前端资源：${assets.embedded ? "已内嵌（单文件模式）" : `磁盘目录 ${paths.publicDir}`}`);
      console.log(`  数据目录：${paths.dataDir}`);
      console.log(`  运行模式：${paths.isSea ? "打包 exe（便携模式，数据保存在 exe 同级 data 目录）" : "源码模式"}`);
      console.log("  关闭本窗口即停止服务（数据已落盘，可随时重启）");
      console.log("================================================================================");
      console.log(`  [backend] 应用 ${apps.length} 个 · 设备 ${iotState.devices.length} 台`);
      startupLog(`服务已就绪：http://localhost:${port}`);
      openBrowser(port);
      return;
    } catch (e) {
      if (e.code === "EADDRINUSE") {
        startupLog(`端口 ${port} 被其它程序占用，尝试下一个端口…`);
        continue;
      }
      startupLog(`启动失败：${e.message}`);
      holdWindow(`启动失败：${e.message}`);
      return;
    }
  }
  startupLog(`端口 ${PORT_CANDIDATES[0]}~${PORT_CANDIDATES[PORT_CANDIDATES.length - 1]} 全部被占用，无法启动。`);
  holdWindow("端口全部被占用，请关闭其它程序后重试，或用 set PORT=8080 指定端口。");
}

process.on("uncaughtException", (e) => {
  startupLog(`未捕获异常：${e?.stack || e?.message || e}`);
  holdWindow("程序遇到未预期的错误（详情见 data/startup.log）。");
});
process.on("unhandledRejection", (e) => {
  startupLog(`未处理的 Promise 拒绝：${e?.stack || e?.message || e}`);
});

bootstrap();
