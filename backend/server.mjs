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
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, appendFileSync, statSync, renameSync, unlinkSync } from "node:fs";
import { join, extname, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { createIotExtraRoutes } from "./iot/api.mjs";
import { createFormRoutes } from "./forms.mjs";
import { createCrudRoutes } from "./crud.mjs";
import { createAuditRoutes } from "./audit.mjs";
import { createAiRoutes } from "./ai.mjs";
import { createPoller } from "./iot/poller.mjs";
import { readDevice } from "./iot/drivers.mjs";
import { validateDevice, normalizeDevice } from "./iot/validate.mjs";
import { createAlertStore } from "./iot/alerts.mjs";
import { createPointStore } from "./iot/points.mjs";
import { createNotifier } from "./iot/notify.mjs";
import { createAuth, ROLE_LABELS } from "./auth.mjs";
import { createDatabase } from "./db.mjs";
import { paths } from "./paths.mjs";
import { assets } from "./assets.mjs";

const BACKUP_DIR = join(paths.dataDir, "backups");

/** 备份快照保留上限 */
const MAX_BACKUPS = 20;

/** 删除超出上限的最旧快照（按修改时间），只处理 backup-*.json */
function pruneBackups(keep) {
  try {
    const entries = readdirSync(BACKUP_DIR)
      .filter((f) => /^backup-.*\.json$/.test(f))
      .map((f) => {
        const full = join(BACKUP_DIR, f);
        let mtime = 0;
        try {
          mtime = statSync(full).mtimeMs;
        } catch {
          /* 文件消失则忽略 */
        }
        return { full, mtime };
      })
      .sort((a, b) => a.mtime - b.mtime); // 最旧在前
    for (let i = 0; i < entries.length - keep; i++) {
      try {
        unlinkSync(entries[i].full);
      } catch (e) {
        console.error(`[backend] 删除旧备份失败 ${entries[i].full}：`, e.message);
      }
    }
  } catch (e) {
    console.error("[backend] 清理备份失败：", e.message);
  }
}

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
    // 防路径穿越：解析后的真实路径必须仍在 publicDir 内
    const root = resolve(paths.publicDir);
    const full = resolve(root, rel);
    if (full !== root && !full.startsWith(root + sep)) {
      sendAsset404(res, rel);
      return true;
    }
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

// ---------------------------------------------------------------------------
// 存储：PostgreSQL
// 顶层 await：数据库连接 + 建表必须在任何数据读写之前完成。
// 连不上会直接抛错终止启动（绝不静默退化成文件存储）。
// ---------------------------------------------------------------------------
const db = await createDatabase({ dataDir: paths.dataDir });

/** 告警存储（PostgreSQL）：替代原来只存 100 条的内存数组 */
const alertStore = createAlertStore({ db });
/** 采集点位存储（PostgreSQL）：替代此前只有 200 点的内存环形缓冲 */
const pointStore = createPointStore({ db });
/** 告警通知（企微/钉钉/Webhook/SMTP），配置存 kv_documents.alarm_notify */
const notifier = createNotifier({ db });
await notifier.load();

// 旧版本把数据存在 JSON 文件里；首次切到数据库时自动迁移（幂等：表里已有数据则跳过）
await migrateLegacyJson();

/**
 * 读文档：原实现直接读 JSON 文件，现在读 PostgreSQL 的 kv_documents 表。
 * 保留同名函数是为了让业务代码改动最小；调用方需 await。
 */
async function readJson(key, fallback) {
  return db.readDoc(key, fallback);
}
/**
 * 原子写入：先写临时文件再 rename，避免断电/崩溃留下被截断的 JSON。
 * 写入失败会**抛错**（由路由层返回 500），不再静默吞掉。
 */
/** 写文档（原子 UPSERT；失败抛错，由路由层决定是否 500） */
async function writeJson(key, data) {
  await db.writeDoc(key, data);
}

/** 静默写入：用于不希望中断请求的埋点类写入（例如高频 IoT 落盘） */
async function writeJsonQuiet(key, data) {
  await db.writeDocQuiet(key, data);
}

/**
 * 把旧版 JSON 文件一次性迁移到 PostgreSQL。
 * 迁移规则：文档类（apps/iot/autotest）写入 kv_documents；
 * 表单提交、CRUD 行、审计日志写入各自的业务表。
 * 幂等：目标已有数据则跳过，不会重复导入。
 */
async function migrateLegacyJson() {
  const legacy = {
    apps: join(paths.dataDir, "apps.json"),
    iot: join(paths.dataDir, "iot.json"),
    autotest: join(paths.dataDir, "autotest.json"),
  };
  const readLegacy = (file) => {
    try {
      return existsSync(file) ? JSON.parse(readFileSync(file, "utf-8")) : null;
    } catch {
      return null;
    }
  };

  for (const [key, file] of Object.entries(legacy)) {
    const data = readLegacy(file);
    if (!data) continue;
    const existing = await db.readDoc(key, null);
    if (existing !== null) continue; // 已迁移过
    await db.writeDoc(key, data);
    console.log(`[db] 已迁移 ${file} → kv_documents.${key}`);
  }

  // 表单提交：逐条导入
  const subsFile = join(paths.dataDir, "form-submissions.json");
  const subs = readLegacy(subsFile);
  if (Array.isArray(subs) && subs.length) {
    const cnt = await db.query("SELECT COUNT(*)::int AS n FROM form_submissions");
    if (cnt.rows[0].n === 0) {
      for (const sub of subs) {
        await db.query(
          "INSERT INTO form_submissions (id, form_id, form_name, data, submitted_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING",
          [sub.id, sub.formId, sub.formName || "", JSON.stringify(sub.data || {}), Number(sub.submittedAt) || Date.now()],
        );
      }
      console.log(`[db] 已迁移 ${subs.length} 条表单提交`);
    }
  }

  // CRUD
  const crudFile = join(paths.dataDir, "crud.json");
  const crudDb = readLegacy(crudFile);
  if (crudDb && typeof crudDb === "object") {
    const cnt = await db.query("SELECT COUNT(*)::int AS n FROM crud_resources");
    if (cnt.rows[0].n === 0) {
      for (const [resource, res] of Object.entries(crudDb)) {
        await db.query("INSERT INTO crud_resources (resource, fields) VALUES ($1,$2::jsonb) ON CONFLICT DO NOTHING", [
          resource,
          JSON.stringify(res.fields || []),
        ]);
        for (const row of res.rows || []) {
          await db.query(
            "INSERT INTO crud_rows (resource, id, data, updated_at) VALUES ($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING",
            [resource, String(row.id), JSON.stringify(row), Number(row.updatedAt) || Date.now()],
          );
        }
      }
      console.log("[db] 已迁移 CRUD 数据");
    }
  }

  // 审计日志：JSONL 逐行导入
  const auditDir = join(paths.dataDir, "audit");
  if (existsSync(auditDir)) {
    const cnt = await db.query("SELECT COUNT(*)::int AS n FROM audit_logs");
    if (cnt.rows[0].n === 0) {
      let imported = 0;
      for (const f of readdirSync(auditDir).filter((x) => /^audit-\d{4}-\d{2}\.jsonl$/.test(x))) {
        const text = readFileSync(join(auditDir, f), "utf-8");
        for (const line of text.split("\n")) {
          if (!line.trim()) continue;
          try {
            const e = JSON.parse(line);
            await db.query(
              "INSERT INTO audit_logs (time, username, role, module, action, detail) VALUES ($1,$2,$3,$4,$5,$6)",
              [Number(e.time) || Date.now(), e.user || "系统", e.role || "viewer", e.module || "其他", e.action || "", e.detail || ""],
            );
            imported += 1;
          } catch {
            /* 跳过坏行 */
          }
        }
      }
      if (imported) console.log(`[db] 已迁移 ${imported} 条审计日志`);
    }
  }
}

// ---------------------------------------------------------------------------
// 低代码应用
// ---------------------------------------------------------------------------
let apps = await readJson("apps", []);

// ---------------------------------------------------------------------------
// 物联网：设备 + 采集 + 告警（数据源模拟器）
// ---------------------------------------------------------------------------
let iotState = await readJson("iot", null);
/** IoT 状态写入队列（串行化，保证最后写入的是最新状态） */
let iotPersistChain = Promise.resolve();
if (!iotState || !Array.isArray(iotState.devices)) {
  iotState = {
    devices: [
      { id: "DEV-001", name: "高低温试验箱", type: "env", location: "实验室A-101", status: "online", protocol: "mock", baseTemp: 35.2, baseHum: 60, power: 12.4, limits: { temperature: { max: 45, warn: 40 }, humidity: { max: 85, warn: 75 } } },
      { id: "DEV-002", name: "恒温恒湿箱", type: "env", location: "实验室A-102", status: "online", protocol: "mock", baseTemp: 28.0, baseHum: 55, power: 9.8, limits: { temperature: { max: 38, warn: 34 }, humidity: { max: 80, warn: 70 } } },
      { id: "DEV-003", name: "万能材料试验机", type: "test", location: "实验室B-201", status: "online", protocol: "mock", baseTemp: 24.5, baseHum: 45, power: 15.2, limits: { temperature: { max: 30, warn: 28 } } },
      { id: "DEV-004", name: "三坐标测量仪", type: "test", location: "实验室B-202", status: "offline", protocol: "mock", baseTemp: 23.0, baseHum: 50, power: 0, limits: { temperature: { max: 30, warn: 28 } } },
      { id: "DEV-005", name: "厂区总能耗表", type: "energy", location: "配电房", status: "online", protocol: "mock", baseTemp: 30.0, baseHum: 50, power: 42.6, limits: { power: { max: 60, warn: 50 } } },
      { id: "DEV-006", name: "3号试验箱", type: "env", location: "实验室A-103", status: "error", protocol: "mock", baseTemp: 42.1, baseHum: 70, power: 18.4, limits: { temperature: { max: 45, warn: 40 }, humidity: { max: 85, warn: 75 } } },
    ],
    alerts: [
      { id: "AL-0001", deviceId: "DEV-006", level: "error", message: "3号试验箱 温度 42.1℃ 超过预警值 40℃", time: Date.now() - 60000, status: "open" },
    ],
    serial: 100,
    tick: 0,
  };
}

// 数据修复：早期版本的种子设备没有 protocol 字段，导致驱动层 getDriver(undefined) 报错，
// 表现为「探测/读取/下发」全部失败。这里在启动时统一补为 mock（模拟设备）。
let fixedProtocol = 0;
for (const d of iotState.devices || []) {
  if (!d.protocol) {
    d.protocol = "mock";
    fixedProtocol += 1;
  }
}
if (fixedProtocol) {
  console.log(`[db] 已为 ${fixedProtocol} 台存量设备补全 protocol=mock`);
  await writeJsonQuiet("iot", iotState);
}

// 告警：以数据库为准
// iotState.alerts 只是「最近若干条」的内存缓存（供 SSE 与首页概览），
// 完整历史在 iot_alerts 表，重启后从库里恢复最近 200 条。
try {
  const recent = await alertStore.loadRecent(200);
  if (recent.length) {
    iotState.alerts = recent;
  } else if (Array.isArray(iotState.alerts) && iotState.alerts.length) {
    // 首次升级：把旧 JSON 里的告警导入数据库（幂等，按 id 冲突忽略）
    for (const a of iotState.alerts) {
      await db
        .query(
          `INSERT INTO iot_alerts (id, device_id, device_name, level, message, time, status, acked_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
          [a.id, a.deviceId, a.deviceName || "", a.level, a.message, Number(a.time) || Date.now(), a.status || "open", a.ackedAt || null],
        )
        .catch(() => {});
    }
    console.log(`[db] 已迁移 ${iotState.alerts.length} 条存量告警到 iot_alerts 表`);
  }
} catch (e) {
  console.error("[db] 恢复告警失败：", e.message);
}

// 历史数据：内存环形缓冲（供 SSE 与实时曲线）+ 异步批量落库
const histories = new Map();
/** 待写入数据库的点位缓冲：每 2 秒或积攒 200 条时批量写入，避免高频单条 INSERT */
const pendingPoints = [];
let pendingFlushTimer = null;
let pointsFlushBusy = false;

async function flushPoints() {
  if (pointsFlushBusy || !pendingPoints.length) return;
  pointsFlushBusy = true;
  const batch = pendingPoints.splice(0, pendingPoints.length);
  // 过滤脏数据：缺 deviceId 的点位无法归属设备，直接跳过并记录
  const valid = batch.filter((p) => p && p.deviceId);
  const dropped = batch.length - valid.length;
  if (dropped) console.warn(`[points] 跳过 ${dropped} 条缺少 deviceId 的点位`);
  try {
    if (valid.length) await pointStore.insertMany(valid);
  } catch (e) {
    // 批量失败时尝试逐条写入，避免一条坏数据拖累整批
    console.error("[points] 批量写入失败，改为逐条写入：", e.message);
    let ok = 0;
    for (const p of valid) {
      try {
        await pointStore.insertMany([p]);
        ok += 1;
      } catch {
        /* 单条失败：跳过该点 */
      }
    }
    if (ok < valid.length) console.error(`[points] 逐条写入完成 ${ok}/${valid.length} 条`);
  } finally {
    pointsFlushBusy = false;
  }
}

function scheduleFlush() {
  if (pendingFlushTimer) return;
  pendingFlushTimer = setTimeout(() => {
    pendingFlushTimer = null;
    void flushPoints();
  }, 2000);
}

function pushHistory(device, rawPoint) {
  // 归一化：调用方传入的 point 可能缺少 deviceId/deviceName/time（如模拟器的 computePoint），
  // 这里统一补齐，保证内存缓存与数据库写入的字段一致。
  const point = {
    deviceId: device.id,
    deviceName: device.name || "",
    type: device.type || "test",
    time: Number(rawPoint?.time) || Date.now(),
    ...rawPoint,
  };
  // 确保关键字段不被 rawPoint 中的 undefined 覆盖
  point.deviceId = device.id;
  point.deviceName = device.name || "";
  point.time = Number(point.time) || Date.now();

  const list = histories.get(device.id) || [];
  list.push(point);
  // 内存只保留最近 120 点（实时曲线足够），完整历史在数据库
  if (list.length > 120) list.shift();
  histories.set(device.id, list);

  // 落库：缓冲后批量写，避免每次采集都打一次数据库
  pendingPoints.push(point);
  if (pendingPoints.length >= 200) void flushPoints();
  else scheduleFlush();
  return point;
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

/**
 * 按阈值判定并登记告警。
 * 修复：
 *   · 去重键由「设备」改为「设备 + 告警内容」，同类告警 30s 内不刷屏，但**不同/更高级别**告警不再被压制；
 *   · 截断 100 条时优先保留 open 告警，避免未处理告警被挤掉。
 * 返回新产生的告警对象（无则 null）。
 */
async function registerAlert(device, point) {
  const alert = checkAlerts(device, point);
  if (!alert) return null;
  const key = `${device.id}|${alert.level}|${alert.message}`;
  const last = POINT_LOG.get(key) || 0;
  if (Date.now() - last < 30000) return null;
  POINT_LOG.set(key, Date.now());

  try {
    // 完全相同的告警已处于 open 状态时不重复生成（查数据库，而非内存）
    if (await alertStore.hasOpen(device.id, alert.message)) return null;
    const record = await alertStore.insert(device, alert.level, alert.message);
    // 异步推送通知，失败不影响告警入库
    void notifier.notify(record).catch((e) => console.error("[notify] 推送失败：", e.message));
    // 内存缓存仅保留最近 N 条（供 SSE/概览），数据库保留全部历史
    iotState.alerts.unshift(record);
    if (iotState.alerts.length > 200) iotState.alerts.length = 200;
    iotState.serial = Number(String(record.id).replace(/\D/g, "")) || iotState.serial;
    return record;
  } catch (e) {
    console.error("[alert] 写入告警失败：", e.message);
    return null;
  }
}

async function simulateTick() {
  iotState.tick += 1;
  const points = [];
  for (const d of iotState.devices) {
    // 真实协议设备（scpi / modbus-tcp / http）由驱动或自动化测试采集，不走模拟器
    if (d.protocol && d.protocol !== "mock") continue;
    const point = computePoint(d.id);
    if (!point) continue;
    pushHistory(d, point);
    // 修复：模拟采集此前只写历史，不回写设备当前值（真实设备路径有 onRealPoint 回写），
    // 导致 device.temperature/humidity 永远是 undefined，设备列表与读取接口拿不到当前值。
    for (const key of ["temperature", "humidity", "power"]) {
      if (typeof point[key] === "number" && Number.isFinite(point[key])) d[key] = point[key];
    }
    d.lastUpdate = Date.now();
    points.push({ deviceId: d.id, deviceName: d.name, type: d.type, ...point });
    if (await registerAlert(d, point)) await writeJsonQuiet("iot", iotState);
  }
  const overview = computeOverview(points);
  broadcast({ devices: iotState.devices, points, overview, alerts: iotState.alerts });
  return overview;
}

/** 数据库中的未处理告警数（异步刷新，概览读取缓存值） */
let openAlertCount = 0;
async function refreshOpenAlertCount() {
  try {
    openAlertCount = await alertStore.countOpen();
  } catch {
    /* 忽略：保留上一次的值 */
  }
}
setInterval(() => void refreshOpenAlertCount(), 5000);

// 告警留存清理：每天检查一次，删除 12 个月前的**已确认**告警（未处理的不删）
// 与审计日志的 36 个月留存策略一致：历史可查，但不会无限膨胀
setTimeout(() => {
  void (async () => {
    try {
      const removed = await alertStore.prune(12);
      if (removed) console.log(`[alert] 已清理 ${removed} 条超过留存期的已确认告警`);
    } catch (e) {
      console.error("[alert] 留存清理失败：", e.message);
    }
  })();
}, 60_000);
setInterval(
  () => {
    void alertStore.prune(12).catch(() => {});
  },
  24 * 60 * 60 * 1000,
);

// 采集点位留存清理：每天删除超过留存期（默认 90 天）的点位
setTimeout(() => {
  void (async () => {
    try {
      const removed = await pointStore.prune();
      if (removed) console.log(`[points] 已清理 ${removed} 条超过留存期的采集点位`);
    } catch (e) {
      console.error("[points] 留存清理失败：", e.message);
    }
  })();
}, 90_000);
setInterval(
  () => {
    void pointStore.prune().catch(() => {});
  },
  24 * 60 * 60 * 1000,
);
void refreshOpenAlertCount();

function computeOverview(points) {
  const s = (v, d = 0) => v ?? d;
  const online = iotState.devices.filter((d) => d.status !== "offline").length;
  const testCount = iotState.devices.filter((d) => d.type === "test" && d.status === "online").length;
  const energyNow = iotState.devices.filter((d) => d.type === "energy").reduce((a, b) => a + (points.find((p) => p.deviceId === b.id)?.power || b.power), 0);
  return {
    online,
    total: iotState.devices.length,
    // 未处理告警以数据库为准（内存缓存只保留最近 200 条，不能当统计口径）
    openAlerts: openAlertCount,
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
setInterval(() => void simulateTick(), 2000);

// ---------------------------------------------------------------------------
// HTTP 工具
// ---------------------------------------------------------------------------
/**
 * CORS 白名单：默认只允许同源（不回写 ACAO 头）与本地开发源。
 * 可通过环境变量 AILAB_CORS_ORIGINS="https://a.com,https://b.com" 追加部署域名。
 * 注意：不再使用 "*"，避免任意网页跨域读写平台数据。
 */
const CORS_ORIGINS = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
  "http://localhost:3800",
  "http://127.0.0.1:3800",
  ...String(process.env.AILAB_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
]);

function corsHeaders(req, res) {
  const origin = req && req.headers && req.headers.origin;
  if (!origin) return; // 同源 / 非浏览器请求：无需 CORS 头
  if (!CORS_ORIGINS.has(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}
function sendJSON(res, code, body) {
  corsHeaders(res.req, res);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
/** 安全解码路径参数：非法百分号编码返回 400 而不是抛错 */
function safeDecode(v) {
  return decodeURIComponent(String(v));
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
// poller 的间接引用：deps 用 getter 延迟解析，必须在创建 deps 之前声明，否则触发 TDZ
const pollerRef = { current: null };

const iotExtra = createIotExtraRoutes({
  sendJSON,
  readBody,
  getIot: () => iotState,
  // IoT 状态写入串行化：2 秒一次的采集与告警写入若并发，可能乱序覆盖
  persistIot: () => {
    iotPersistChain = iotPersistChain.then(() => writeJsonQuiet("iot", iotState));
    return iotPersistChain;
  },
  broadcast,
  histories,
  // 统一记录入口：内存缓冲 + 批量落库（供 iot/api.mjs 使用）
  recordPoint: (device, point) => pushHistory(device, point),
  // 历史查询（数据库）
  pointStore,
  // 告警通知
  notifier,
  dataDir: paths.dataDir,
  // 真实设备读数走与模拟设备完全相同的链路：回写状态 → 历史 → 告警 → 概览
  onRealPoint: async (device, point) => {
    for (const key of ["temperature", "humidity", "power"]) {
      if (typeof point[key] === "number" && Number.isFinite(point[key])) device[key] = point[key];
    }
    device.lastUpdate = point.time;
    if (await registerAlert(device, point)) await writeJsonQuiet("iot", iotState);
  },
  getOverview: (points) => computeOverview(points),
  // 延迟取 poller（它在下方创建，避免初始化顺序问题）
  getPoller: () => pollerRef.current,
  // 设备操作审计（接入/删除/下发留痕）
  audit: async (req2, entry) => {
    const actor = await auth.getSession(req2);
    await auditRoutes.log(entry, actor ? { name: actor.name, role: actor.role } : null);
  },
});

// ---------------------------------------------------------------------------
// 真实设备后台采集调度器
// 此前真实设备只有手动「读取」或自动化测试才采集，导致大屏/历史/告警不更新。
// ---------------------------------------------------------------------------
/** 供调度器读取设备（mock 驱动需要最近点位上下文） */
async function readDeviceForPoll(device) {
  return readDevice(device, { latestPoints: (histories.get(device.id) || []).slice(-5) });
}

const poller = createPoller({
  readDevice: (device) => readDeviceForPoll(device),
  getDevices: () => iotState.devices,
  onPoints: async (device, points) => {
    // 与模拟设备走同一链路：历史缓冲 → 设备当前值 → 告警 → SSE 推送
    for (const point of points) pushHistory(device, point);
    for (const point of points) {
      for (const key of ["temperature", "humidity", "power"]) {
        if (typeof point[key] === "number" && Number.isFinite(point[key])) device[key] = point[key];
      }
      device.lastUpdate = point.time;
    }
    let alertRaised = false;
    for (const point of points) if (await registerAlert(device, point)) alertRaised = true;
    writeJsonQuiet("iot", iotState);
    broadcast({
      devices: iotState.devices,
      points,
      overview: computeOverview(points),
      alerts: iotState.alerts,
      source: "poller",
    });
    if (alertRaised) console.log(`[poller] ${device.name} 产生新告警`);
  },
  onStatusChange: (device, status, error) => {
    writeJsonQuiet("iot", iotState);
    broadcast({ devices: iotState.devices, points: [], alerts: iotState.alerts, statusChange: { deviceId: device.id, status, error } });
  },
});

pollerRef.current = poller;
// 启动后台采集（与模拟设备的 2 秒定时器并行运行，互不干扰）
poller.start();

// AI 页面生成代理（密钥仅在服务端，见 ai.mjs）
const aiRoutes = createAiRoutes({ sendJSON, readBody, dataDir: paths.dataDir });

// 服务端会话与鉴权（存储：PostgreSQL users / sessions 表）
const auth = await createAuth({ db });

// 低代码表单提交与数据存储
const formRoutes = createFormRoutes({ sendJSON, readBody, db });

// 通用 CRUD 接口（低代码「数据表格」组件的数据源）
const crudRoutes = createCrudRoutes({ sendJSON, readBody, db, database: db });
// 从数据库加载 CRUD 初始数据（迁移后的旧数据或已有数据）
{
  const resRows = await db.query("SELECT resource, fields FROM crud_resources");
  const rowsRes = await db.query("SELECT resource, data FROM crud_rows ORDER BY updated_at ASC");
  const hydrated = {};
  for (const r of resRows.rows) hydrated[r.resource] = { fields: r.fields, rows: [] };
  for (const r of rowsRes.rows) {
    if (!hydrated[r.resource]) hydrated[r.resource] = { fields: [], rows: [] };
    hydrated[r.resource].rows.push(r.data);
  }
  if (Object.keys(hydrated).length) crudRoutes.hydrate(hydrated);
}

// 操作日志（审计）· 存储：PostgreSQL audit_logs 表（索引 + 数据库内分页）
const auditRoutes = createAuditRoutes({
  sendJSON,
  readBody,
  db,
  dataDir: paths.dataDir,
  // 身份由服务端会话推导：未登录时退回"系统/访客"，不信任 body 里的 user/role
  getActor: async (req) => {
    const s = await auth.getSession(req);
    return s ? { name: s.name, role: s.role } : { name: "访客", role: "viewer" };
  },
});

// ---------------------------------------------------------------------------
// 路由
// ---------------------------------------------------------------------------
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const path = url.pathname;
  const method = req.method || "GET";

  if (method === "OPTIONS") {
    corsHeaders(req, res);
    res.writeHead(204);
    return res.end();
  }

  // 健康检查
  if (method === "GET" && path === "/api/health") {
    return sendJSON(res, 200, { ok: true, apps: apps.length, devices: iotState.devices.length, uptime: process.uptime(), time: Date.now() });
  }

  // ---------------- 认证与会话（公开） ----------------
  if (method === "POST" && path === "/api/auth/login") {
    let body;
    try {
      body = await readBody(req);
    } catch {
      return sendJSON(res, 400, { error: "请求体不是合法 JSON" });
    }
    const result = await auth.login(body?.username, body?.password);
    if (!result) return sendJSON(res, 401, { error: "用户名或密码错误" });
    auth.setCookie(res, result.token, 12 * 60 * 60 * 1000);
    // 审计：身份由服务端推导，不信任客户端
    await auditRoutes.log({
      user: result.name,
      role: result.role,
      module: "权限",
      action: "登录",
      detail: `${result.name} 以「${ROLE_LABELS[result.role] || result.role}」身份登录系统`,
    });
    const { token, session, ...user } = result;
    return sendJSON(res, 200, { ok: true, user });
  }
  if (method === "POST" && path === "/api/auth/logout") {
    const s = await auth.getSession(req);
    if (s) {
      await auditRoutes.log({ user: s.name, role: s.role, module: "权限", action: "退出登录", detail: `${s.name} 退出系统` });
    }
    await auth.logout(req);
    auth.clearCookie(res);
    return sendJSON(res, 200, { ok: true });
  }
  if (method === "GET" && path === "/api/auth/me") {
    const s = await auth.getSession(req);
    if (!s) return sendJSON(res, 200, { ok: true, user: null });
    return sendJSON(res, 200, { ok: true, user: { username: s.username, name: s.name, role: s.role } });
  }

  // ---------------- 统一鉴权守卫 ----------------
  if (await auth.guard(req, res, path, method, sendJSON)) return;

  // AI 页面生成（后端持有密钥）
  if (await aiRoutes(req, res, path, method)) return;

  // 当前用户修改密码（服务端校验旧密码）
  if (method === "POST" && path === "/api/auth/password") {
    const s = await auth.getSession(req);
    if (!s) return sendJSON(res, 401, { error: "未登录" });
    const body = await readBody(req).catch(() => ({}));
    const r = await auth.changePassword(s, body?.oldPassword, body?.newPassword);
    if (!r.ok) return sendJSON(res, 400, { error: r.error });
    await auditRoutes.log({ user: s.name, role: s.role, module: "安全", action: "修改密码", detail: `${s.name} 修改了登录密码` });
    return sendJSON(res, 200, { ok: true });
  }

  // 用户管理
  if (path === "/api/users") {
    if (method === "GET") return sendJSON(res, 200, { ok: true, users: await auth.listUsers() });
    if (method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      const r = await auth.createUser(body || {});
      if (!r.ok) return sendJSON(res, 400, { error: r.error });
      const s = await auth.getSession(req);
      await auditRoutes.log({ user: s.name, role: s.role, module: "权限", action: "新增用户", detail: `新增用户 ${body.username}` });
      return sendJSON(res, 200, { ok: true });
    }
  }
  if (path.startsWith("/api/users/")) {
    let uname;
    try {
      uname = safeDecode(path.slice("/api/users/".length));
    } catch {
      return sendJSON(res, 400, { error: "非法的用户名编码" });
    }
    if (method === "PUT") {
      const body = await readBody(req).catch(() => ({}));
      const r = await auth.updateUser(uname, body || {});
      if (!r.ok) return sendJSON(res, 400, { error: r.error });
      return sendJSON(res, 200, { ok: true });
    }
    if (method === "DELETE") {
      const r = await auth.deleteUser(uname);
      if (!r.ok) return sendJSON(res, 400, { error: r.error });
      const s = await auth.getSession(req);
      await auditRoutes.log({ user: s.name, role: s.role, module: "权限", action: "删除用户", detail: `删除用户 ${uname}` });
      return sendJSON(res, 200, { ok: true });
    }
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
      await writeJson("apps", apps);
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
      await writeJson("apps", apps);
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
    await writeJson("apps", apps);
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
      const raw = body && body.device;
      if (!raw) return sendJSON(res, 400, { error: "缺少 device 对象" });

      // 校验：点位缺字段、寄存器非法、key 重复等在这里拦截，不再等到读取时才发现
      const check = validateDevice(raw);
      if (!check.ok) return sendJSON(res, 400, { error: "设备配置校验未通过", errors: check.errors, warnings: check.warnings });

      const d = normalizeDevice(raw);
      if (raw.id && iotState.devices.some((x) => x.id === raw.id)) return sendJSON(res, 400, { error: "设备 ID 已存在" });
      // 防止重复接入：同名 + 同协议 + 同地址视为同一台设备
      const addr = raw.address || {};
      const dup = iotState.devices.find(
        (x) =>
          x.name === d.name &&
          (x.protocol || "mock") === (d.protocol || "mock") &&
          JSON.stringify(x.address || {}) === JSON.stringify(addr),
      );
      if (dup) {
        return sendJSON(res, 409, {
          error: `设备「${d.name}」已存在（${dup.id}），请勿重复接入`,
          existingId: dup.id,
        });
      }
      // 设备编号取现有最大值 +1，避免删除后重号
      if (!d.id) {
        const maxNo = iotState.devices.reduce((m, x) => Math.max(m, Number(String(x.id).replace(/\D/g, "")) || 0), 0);
        d.id = `DEV-${String(maxNo + 1).padStart(3, "0")}`;
      }
      d.status = d.status || "online";
      d.power = d.power ?? 5;
      d.baseTemp = d.baseTemp ?? 25;
      d.baseHum = d.baseHum ?? 50;
      d.protocol = d.protocol || "mock";
      iotState.devices.push(d);
      await writeJson("iot", iotState);
      const actor = await auth.getSession(req);
      await auditRoutes.log(
        { module: "物联", action: "接入设备", detail: `接入设备 ${d.id}「${d.name}」（${d.protocol}，${(d.points || []).length} 个点位）` },
        actor ? { name: actor.name, role: actor.role } : null,
      );
      return sendJSON(res, 200, { device: d, warnings: check.warnings });
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
        // 校验「合并后的完整配置」，而不是只看补丁：
        // 只改点位表时，地址沿用原值也必须一起校验
        const patchPreview = body && body.device && typeof body.device === "object" ? body.device : body;
        const merged = { ...d, ...(patchPreview || {}), id: d.id, name: patchPreview?.name ?? d.name };
        const checkPut = validateDevice(merged);
        if (!checkPut.ok) return sendJSON(res, 400, { error: "设备配置校验未通过", errors: checkPut.errors, warnings: checkPut.warnings });
        // 修复：白名单原先缺少 protocol/address/points，导致设备接入后无法修改点位表
        // （真实仪器点位填错时只能删了重建）。这里补全全部可编辑字段，并支持 { device: {...} } 包装。
        const patch = body && body.device && typeof body.device === "object" ? body.device : body;
        const EDITABLE = ["name", "type", "location", "status", "protocol", "address", "points", "limits", "baseTemp", "baseHum", "power", "pollIntervalMs", "pollEnabled"];
        for (const key of EDITABLE) if (patch && key in patch) d[key] = patch[key];
        // 协议相关的运行时状态复位：换地址/协议后旧的探测结果不再可信
        if (patch && ("address" in patch || "protocol" in patch)) {
          d.status = d.status || "online";
          delete d.lastProbe;
          delete d.lastRead;
          delete d.lastError;
        }
        await writeJson("iot", iotState);
        const changed = Object.keys(patch || {}).filter((k) => EDITABLE.includes(k));
        const actorPut = await auth.getSession(req);
        await auditRoutes.log(
          { module: "物联", action: "修改设备", detail: `修改设备 ${d.id}「${d.name}」：${changed.join("、") || "无字段变化"}` },
          actorPut ? { name: actorPut.name, role: actorPut.role } : null,
        );
        return sendJSON(res, 200, { device: d, warnings: checkPut.warnings });
      } catch {
        return sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
      }
    }
    if (method === "DELETE") {
      const target = iotState.devices.find((d) => d.id === id);
      if (!target) return sendJSON(res, 404, { error: "设备不存在" });
      iotState.devices = iotState.devices.filter((d) => d.id !== id);
      histories.delete(id);
      await writeJson("iot", iotState);
      const actorDel = await auth.getSession(req);
      await auditRoutes.log(
        { module: "物联", action: "删除设备", detail: `删除设备 ${id}「${target.name}」（${target.protocol || "mock"}）` },
        actorDel ? { name: actorDel.name, role: actorDel.role } : null,
      );
      return sendJSON(res, 200, { ok: true });
    }
  }
  if (method === "GET" && path === "/api/iot/devices-history") {
    const all = {};
    for (const [id, list] of histories) all[id] = list;
    return sendJSON(res, 200, all);
  }
  // ---------------- 告警（PostgreSQL） ----------------
  if (method === "GET" && path === "/api/iot/alerts") {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const page = Number(url.searchParams.get("page")) || 0;
    // 兼容旧调用：不带 page 参数时返回内存中的最近告警（SSE/首页概览用）
    if (!page) {
      return sendJSON(res, 200, { alerts: iotState.alerts, total: iotState.alerts.length });
    }
    try {
      const result = await alertStore.list({
        status: url.searchParams.get("status") || undefined,
        level: url.searchParams.get("level") || undefined,
        deviceId: url.searchParams.get("deviceId") || undefined,
        keyword: url.searchParams.get("keyword") || undefined,
        from: Number(url.searchParams.get("from")) || undefined,
        to: Number(url.searchParams.get("to")) || undefined,
        page,
        pageSize: Number(url.searchParams.get("pageSize")) || 20,
      });
      return sendJSON(res, 200, result);
    } catch (e) {
      console.error("[alert] 查询失败：", e.message);
      return sendJSON(res, 500, { error: "告警查询失败", alerts: [], total: 0 });
    }
  }

  // 告警统计（首页/告警页统计卡）
  if (method === "GET" && path === "/api/iot/alerts/stats") {
    try {
      return sendJSON(res, 200, { ok: true, stats: await alertStore.stats() });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 批量确认（按 id 列表，或 ?all=1 确认全部未处理）
  if (method === "PUT" && path === "/api/iot/alerts/ack-batch") {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const actor = await auth.getSession(req);
      const by = actor?.name || "";
      let result;
      if (url.searchParams.get("all") === "1") {
        result = await alertStore.ackAllOpen(by);
      } else {
        const body = await readBody(req).catch(() => ({}));
        result = await alertStore.ackBatch(body?.ids || [], by);
      }
      // 同步内存缓存状态
      const ackedIds = new Set(result.ids || []);
      if (result.acked && !result.ids) iotState.alerts.forEach((a) => (a.status = "acked"));
      else iotState.alerts.forEach((a) => ackedIds.has(a.id) && (a.status = "acked"));
      broadcast({ alerts: iotState.alerts, alertAck: true });
      await auditRoutes.log(
        { module: "物联", action: "确认告警", detail: `批量确认 ${result.acked} 条告警` },
        actor ? { name: actor.name, role: actor.role } : null,
      );
      return sendJSON(res, 200, result);
    } catch (e) {
      console.error("[alert] 批量确认失败：", e.message);
      return sendJSON(res, 500, { error: e.message });
    }
  }

  // 单条确认
  const ackPath = path.match(/^\/api\/iot\/alerts\/([^/]+)\/ack$/);
  if (method === "PUT" && ackPath) {
    try {
      const id = decodeURIComponent(ackPath[1]);
      const actor = await auth.getSession(req);
      const result = await alertStore.ack(id, actor?.name || "");
      if (!result.ok) return sendJSON(res, 404, { error: "告警不存在" });
      // 同步内存缓存
      const a = iotState.alerts.find((x) => x.id === id);
      if (a) {
        a.status = result.alert.status;
        a.ackedAt = result.alert.ackedAt;
      }
      await auditRoutes.log(
        { module: "物联", action: "确认告警", detail: `确认告警 ${id}` },
        actor ? { name: actor.name, role: actor.role } : null,
      );
      return sendJSON(res, 200, { alert: result.alert, already: result.already });
    } catch (e) {
      return sendJSON(res, 500, { error: e.message });
    }
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
      // 保留策略：超过 20 个时删除**最旧**的快照（按 mtime 排序 + unlink）。
      // 原实现按字典序取 files[0] 并把内容写成空字符串 —— 既删错文件又会清空既有快照。
      pruneBackups(MAX_BACKUPS);
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
      await writeJson("apps", apps);
      await writeJson("iot", iotState);
      // 恢复表单提交与 CRUD（事务内完成，失败整体回滚）
      await db.transaction(async (client) => {
        if (Array.isArray(data.formSubmissions)) {
          await client.query("DELETE FROM form_submissions");
          for (const s2 of data.formSubmissions) {
            await client.query(
              "INSERT INTO form_submissions (id, form_id, form_name, data, submitted_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT DO NOTHING",
              [s2.id, s2.formId, s2.formName || "", JSON.stringify(s2.data || {}), Number(s2.submittedAt) || Date.now()],
            );
          }
        }
        if (data.crud && typeof data.crud === "object") {
          await client.query("DELETE FROM crud_rows");
          await client.query("DELETE FROM crud_resources");
          for (const [resource, res2] of Object.entries(data.crud)) {
            await client.query("INSERT INTO crud_resources (resource, fields) VALUES ($1,$2::jsonb)", [
              resource,
              JSON.stringify(res2.fields || []),
            ]);
            for (const row of res2.rows || []) {
              await client.query("INSERT INTO crud_rows (resource, id, data, updated_at) VALUES ($1,$2,$3::jsonb,$4)", [
                resource,
                String(row.id),
                JSON.stringify(row),
                Number(row.updatedAt) || Date.now(),
              ]);
            }
          }
        }
      });
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
}

/**
 * 顶层错误兜底：任何 handler 抛错（含 decodeURIComponent 的 URIError、
 * 磁盘写入失败等）都返回 500，绝不挂起请求或拖垮进程。
 */
const server = http.createServer(async (req, res) => {
  try {
    await handle(req, res);
  } catch (e) {
    const isBadUrl = e instanceof URIError || e?.statusCode === 400;
    console.error(`[backend] 处理 ${req.method} ${req.url} 失败：`, e?.stack || e);
    if (!res.headersSent) {
      sendJSON(res, isBadUrl ? 400 : 500, { error: isBadUrl ? "请求地址编码非法" : "服务器内部错误" });
    } else {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
  }
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
