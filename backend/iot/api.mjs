// ============================================================================
// 工业物联网 · 设备接入 / 真实设备读写 / 虚拟仪器 / 自动化测试 接口
//
// 由 server.mjs 挂载（返回 false 表示未命中，交回原路由处理）：
//   GET    /api/iot/drivers                     可用协议驱动列表
//   POST   /api/iot/simulator/start|stop        虚拟仪器服务器开关
//   GET    /api/iot/simulator/status
//   POST   /api/iot/devices/:id/probe           探测真实设备信息（*IDN? / 寄存器）
//   POST   /api/iot/devices/:id/read            读取设备实时点位
//   POST   /api/iot/devices/:id/write           下发控制（写点位）
//   GET    /api/iot/devices/:id/live            最近采集数据（曲线用）
//   GET    /api/autotest/plans                  测试方案列表
//   POST   /api/autotest/plans                  新增/更新方案
//   DELETE /api/autotest/plans/:id
//   POST   /api/autotest/plans/:id/run          启动测试（真实设备执行）
//   GET    /api/autotest/runs                   运行记录
//   GET    /api/autotest/runs/:id               单次运行详情（含数据与结论）
//   GET    /api/autotest/runs/:id/report.csv    测试报告下载
// ============================================================================

import { listDrivers, probeDevice, readDevice, writeDevicePoint } from "./drivers.mjs";
import { csvText } from "../csv.mjs";
import { CHANNEL_TYPES } from "./notify.mjs";
import { startSimulator, stopSimulator, simulatorStatus } from "./simulator.mjs";
import { createAutoTestEngine } from "./autotest.mjs";

export function createIotExtraRoutes(deps) {
  const { sendJSON, readBody, getIot, persistIot, broadcast, histories, dataDir, onRealPoint, getOverview, audit, recordPoint, pointStore, notifier } = deps;

  /** 校验通知配置 */
  function validateNotifyConfig(cfg) {
    const errors = [];
    if (!cfg || typeof cfg !== "object") return ["配置为空"];
    if (cfg.channels !== undefined && !Array.isArray(cfg.channels)) errors.push("channels 必须是数组");
    if (cfg.ratePerMinute !== undefined) {
      const n = Number(cfg.ratePerMinute);
      if (!Number.isFinite(n) || n < 1 || n > 600) errors.push("每分钟限流需在 1-600 之间");
    }
    if (cfg.minLevel !== undefined && !["warn", "error"].includes(cfg.minLevel)) {
      errors.push("minLevel 只能是 warn 或 error");
    }
    const validTypes = CHANNEL_TYPES.map((t) => t.id);
    for (const [i, ch] of (cfg.channels || []).entries()) {
      const at = `通道 #${i + 1}`;
      if (!ch || !validTypes.includes(ch.type)) {
        errors.push(`${at}：类型不合法（可选：${validTypes.join(" / ")}）`);
        continue;
      }
      if (!ch.id) errors.push(`${at}：缺少 id`);
      if (ch.type === "smtp") {
        if (!ch.host) errors.push(`${at}：缺少 SMTP 服务器地址`);
        if (!ch.from) errors.push(`${at}：缺少发件人地址`);
        if (!ch.to) errors.push(`${at}：缺少收件人地址`);
      } else {
        if (!ch.webhook) errors.push(`${at}：缺少 Webhook 地址`);
        else {
          try {
            const u = new URL(ch.webhook);
            if (!/^https?:$/.test(u.protocol)) errors.push(`${at}：Webhook 必须是 http(s) 地址`);
          } catch {
            errors.push(`${at}：Webhook 地址格式不正确`);
          }
        }
      }
    }
    return errors;
  }

  /**
   * 记录采集点：统一走 server.mjs 的 pushHistory（内存缓冲 + 批量落库）。
   * 此前这里直接操作 histories，绕过了落库逻辑，导致真实设备的点位不进数据库。
   */
  function record(device, point) {
    if (typeof recordPoint === "function") {
      recordPoint(device, point);
      return;
    }
    // 兜底：未注入时仍写内存
    const list = histories.get(device.id) || [];
    list.push(point);
    if (list.length > 200) list.shift();
    histories.set(device.id, list);
  }

  /**
   * 动态获取采集调度器。
   * 注意：不能在此处直接解构 deps.poller —— deps 是普通对象，解构在创建时就把
   * poller 的值（当时还是 null）复制进来了，之后 pollerRef.current 变化不会被感知。
   * 因此通过 getPoller() 每次实时读取。
   */
  const getPoller = () => (typeof deps.getPoller === "function" ? deps.getPoller() : deps.poller || null);

  /** 记录设备操作审计（下发属于影响物理设备的操作，必须留痕） */
  async function auditLog(req, module, action, detail) {
    if (typeof audit !== "function") return;
    try {
      await audit(req, { module, action, detail });
    } catch (e) {
      console.error("[iot] 审计写入失败：", e.message);
    }
  }

  /** 采集批次累加器：deviceId -> { device, time, data, units, timer } */
  // 必须在 engine 创建之前声明：onPoint 回调闭包引用它，提前声明避免 TDZ
  const pointAccumulator = new Map();

  const engine = createAutoTestEngine({
    dataFile: `${dataDir}/autotest.json`,
    onEvent: (payload) => broadcast({ autotest: payload }),
    // 供 mock 驱动取最近点位（函数声明会提升，可在下方定义）
    getLatestPoints: (deviceId) => latestPointsOf(deviceId),
    onPoint: (device, key, value, unit) => {
      // 问题：自动化测试每读一个点位就回调一次，原实现每次直接写一条历史记录，
      // 导致「一次采集」被拆成多条（每个点位一行、其余字段为空），
      // 曲线图上表现为同一时刻多个点、数据断断续续。
      // 修复：按「设备 + 采集时刻」聚合，短时间内（默认 1.5 秒）的同批点位合并为一条记录。
      const now = Date.now();
      const acc = pointAccumulator.get(device.id);
      if (acc && now - acc.time < 1500) {
        // 同一批：合并到已有记录
        acc.data[key] = value;
        if (unit) acc.units[key] = unit;
        acc.time = now;
        return;
      }
      // 新的一批：先把上一批提交，再开始新的累积
      if (acc) flushAccumulator(acc, device);
      const fresh = {
        device,
        time: now,
        data: { [key]: value },
        units: unit ? { [key]: unit } : {},
        timer: null,
      };
      fresh.timer = setTimeout(() => {
        if (pointAccumulator.get(device.id) === fresh) {
          pointAccumulator.delete(device.id);
          flushAccumulator(fresh, device);
        }
      }, 1500);
      if (typeof fresh.timer.unref === "function") fresh.timer.unref();
      pointAccumulator.set(device.id, fresh);
    },
  });

  /** 提交一个采集批次：合并为**一条**记录（含本次采集的所有点位） */
  function flushAccumulator(acc, device) {
    if (acc.timer) clearTimeout(acc.timer);
    const point = {
      deviceId: device.id,
      deviceName: device.name,
      type: device.type || "test",
      time: acc.time,
      ...acc.data,
    };
    // 单位取主点位的（保留兼容字段），完整信息在 values 中
    const firstUnit = Object.values(acc.units)[0];
    if (firstUnit) point.unit = firstUnit;

    record(device, point);
    if (typeof onRealPoint === "function") onRealPoint(device, point);
    const overview = typeof getOverview === "function" ? getOverview([point]) : null;
    broadcast({ devices: getIot().devices, points: [point], overview, alerts: getIot().alerts });
  }

  function findDevice(id) {
    return getIot().devices.find((d) => d.id === id) || null;
  }

  return async function handle(req, res, path, method) {
    // ---------------- 驱动与虚拟仪器 ----------------
    if (method === "GET" && path === "/api/iot/drivers") {
      sendJSON(res, 200, { drivers: listDrivers(), simulator: simulatorStatus() });
      return true;
    }

    // 采集调度器状态（每台设备的采集周期、下次采集时间、最近错误）
    if (method === "GET" && path === "/api/iot/poller") {
      sendJSON(res, 200, {
        running: !!getPoller(),
        devices: typeof getPoller()?.snapshot === "function" ? getPoller().snapshot() : {},
        defaultIntervalMs: getPoller()?.defaultIntervalMs ?? null,
      });
      return true;
    }

    // 立即触发一次采集（调试/运维用）
    const pollMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/poll$/);
    if (method === "POST" && pollMatch) {
      const device = findDevice(decodeURIComponent(pollMatch[1]));
      if (!device) return sendJSON(res, 404, { error: "设备不存在" }), true;
      const plt = getPoller();
      if (typeof plt?.pollNow !== "function") return sendJSON(res, 503, { error: "采集调度器未启动" }), true;
      try {
        await plt.pollNow(device.id);
        sendJSON(res, 200, { ok: true, device: device.id, status: device.status, values: device.temperature });
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }
    if (method === "POST" && path === "/api/iot/simulator/start") {
      const status = await startSimulator();
      sendJSON(res, 200, { ok: true, simulator: status, hint: `SCPI 127.0.0.1:${status.scpiPort} · Modbus TCP 127.0.0.1:${status.modbusPort}` });
      return true;
    }
    if (method === "POST" && path === "/api/iot/simulator/stop") {
      const status = await stopSimulator();
      sendJSON(res, 200, { ok: true, simulator: status });
      return true;
    }
    if (method === "GET" && path === "/api/iot/simulator/status") {
      sendJSON(res, 200, { simulator: simulatorStatus() });
      return true;
    }

    // ---------------- 真实设备：探测 / 读 / 写 ----------------
    const probeMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/probe$/);
    if (method === "POST" && probeMatch) {
      const device = findDevice(decodeURIComponent(probeMatch[1]));
      if (!device) return sendJSON(res, 404, { error: "设备不存在" }), true;
      try {
        const result = await probeDevice(device, { latestPoints: latestPointsOf(device.id) });
        device.lastProbe = { time: Date.now(), info: result.info };
        device.status = "online";
        persistIot();
        sendJSON(res, 200, { ok: true, device: device.id, protocol: device.protocol || "mock", info: result.info });
      } catch (e) {
        device.status = "error";
        persistIot();
        sendJSON(res, 200, { ok: false, error: e.message });
      }
      return true;
    }

    const readMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/read$/);
    if (method === "POST" && readMatch) {
      const device = findDevice(decodeURIComponent(readMatch[1]));
      if (!device) return sendJSON(res, 404, { error: "设备不存在" }), true;
      try {
        let result = await readDevice(device, { latestPoints: latestPointsOf(device.id) });
        // 模拟设备通常没有点位表，mock 驱动会返回空对象 → 界面看起来"读取成功但没数据"。
        // 这里用设备当前值（模拟器实时更新的 temperature/humidity/power）补全，便于演示。
        if ((!result?.values || !Object.keys(result.values).length) && (device.protocol === "mock" || !device.protocol)) {
          const synthetic = {};
          for (const [k, label, unit] of [
            ["temperature", "温度", "℃"],
            ["humidity", "湿度", "%"],
            ["power", "功率", "kW"],
          ]) {
            const v = device[k];
            if (typeof v === "number") synthetic[k] = { label, value: v, raw: v, unit };
          }
          if (Object.keys(synthetic).length) result = { ...result, ok: true, values: synthetic };
        }
        const now = Date.now();
        device.lastRead = { time: now, values: result.values };
        // 手动「读取」与自动测试采集走同一条链路：回写设备当前值 + 历史曲线 + 阈值告警 + SSE 推送。
        // 否则设备接入页读到的数据不会出现在大屏/历史里，真实超限也不会告警。
        const points = [];
        for (const [key, v] of Object.entries(result.values || {})) {
          if (typeof v?.value !== "number" || !Number.isFinite(v.value)) continue;
          const point = {
            deviceId: device.id,
            deviceName: device.name,
            type: device.type || "test",
            time: now,
            temperature: key === "temperature" ? v.value : undefined,
            humidity: key === "humidity" ? v.value : undefined,
            power: key === "power" ? v.value : undefined,
            [key]: v.value,
            unit: v.unit || "",
          };
          record(device, point);
          if (typeof onRealPoint === "function") onRealPoint(device, point);
          points.push(point);
        }
        persistIot();
        if (points.length) {
          broadcast({ devices: getIot().devices, points, overview: typeof getOverview === "function" ? getOverview(points) : null, alerts: getIot().alerts });
        }
        sendJSON(res, 200, { ok: true, values: result.values, time: now });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: e.message });
      }
      return true;
    }

    const writeMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/write$/);
    if (method === "POST" && writeMatch) {
      const device = findDevice(decodeURIComponent(writeMatch[1]));
      if (!device) return sendJSON(res, 404, { error: "设备不存在" }), true;
      try {
        const body = await readBody(req);
        if (!body.key) {
          sendJSON(res, 400, { error: "缺少点位 key" });
          return true;
        }
        // 记录下发前的值，前端可据此展示"设定值 → 实测值"的对比
        const before = device[body.key];
        const result = await writeDevicePoint(device, body.key, body.value);
        if (result && result.ok === false) {
          // 仪器明确拒绝了命令（例如 SCPI 返回 ERROR:...）
          sendJSON(res, 200, { ok: false, error: result.error || "设备拒绝该命令", result });
          return true;
        }
        await auditLog(
          req,
          "物联",
          "设备下发",
          `向 ${device.id}「${device.name}」下发 ${body.key} = ${body.value}（${result?.command || "寄存器写入"}）`,
        );
        sendJSON(res, 200, { ok: true, result, before: typeof before === "number" ? before : null, command: result?.command || "" });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: e.message });
      }
      return true;
    }

    const liveMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/live$/);
    if (method === "GET" && liveMatch) {
      const id = decodeURIComponent(liveMatch[1]);
      const device = findDevice(id);
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const from = Number(url.searchParams.get("from")) || 0;
      const to = Number(url.searchParams.get("to")) || 0;
      const limit = Number(url.searchParams.get("limit")) || 0;
      const bucketMs = Number(url.searchParams.get("bucketMs")) || 0;

      // 带时间范围 → 查数据库（完整历史）；否则返回内存实时缓冲（兼容旧调用）
      if ((from || to || limit > 60) && typeof pointStore?.queryHistory === "function") {
        try {
          const history = await pointStore.queryHistory({ deviceId: id, from, to, limit: limit || 500, bucketMs });
          sendJSON(res, 200, { device: device || null, history, source: "db" });
          return true;
        } catch (e) {
          console.error("[iot] 历史查询失败：", e.message);
        }
      }
      sendJSON(res, 200, { device: device || null, history: (histories.get(id) || []).slice(-60), source: "memory" });
      return true;
    }

    // 采集数据导出 CSV（按设备与时间范围）
    if (method === "GET" && path === "/api/iot/points/export.csv") {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      const deviceId = url.searchParams.get("deviceId") || "";
      const from = Number(url.searchParams.get("from")) || 0;
      const to = Number(url.searchParams.get("to")) || 0;
      try {
        const rows = await pointStore.exportRows({ deviceId: deviceId || undefined, from, to, maxRows: 100000 });
        // 动态列：temperature/humidity/power + values 里的自定义 key
        const extraKeys = new Set();
        for (const r of rows) {
          for (const [k, v] of Object.entries(r)) {
            if (!["deviceId", "deviceName", "time", "type", "unit", "temperature", "humidity", "power"].includes(k) && typeof v === "number") {
              extraKeys.add(k);
            }
          }
        }
        const header = ["设备ID", "时间", "温度", "湿度", "功率", ...extraKeys];
        const data = rows.map((r) => [
          r.deviceId,
          new Date(r.time).toLocaleString("zh-CN", { hour12: false }),
          r.temperature ?? "",
          r.humidity ?? "",
          r.power ?? "",
          ...[...extraKeys].map((k) => r[k] ?? ""),
        ]);
        const csv = csvText(header, data);
        const fname = `iot-points-${deviceId || "all"}-${new Date().toISOString().slice(0, 10)}.csv`;
        res.writeHead(200, {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${fname}"`,
        });
        res.end(csv);
      } catch (e) {
        console.error("[iot] 导出失败：", e.message);
        sendJSON(res, 500, { error: "导出失败：" + e.message });
      }
      return true;
    }

    // ---------------- 告警通知配置 ----------------
    if (path === "/api/iot/notify") {
      if (method === "GET") {
        sendJSON(res, 200, {
          ok: true,
          config: notifier?.publicConfig?.() || null,
          channelTypes: CHANNEL_TYPES,
        });
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req).catch(() => ({}));
        // 字段校验
        const problems = validateNotifyConfig(body);
        if (problems.length) {
          sendJSON(res, 400, { error: "配置校验未通过", errors: problems });
          return true;
        }
        await notifier.save(body);
        if (typeof audit === "function") {
          const names = (body.channels || []).map((c) => c.name || c.type).join("、") || "无";
          await audit(req, { module: "物联", action: "通知配置", detail: `更新告警通知配置（启用=${!!body.enabled}，通道：${names}）` });
        }
        sendJSON(res, 200, { ok: true, config: notifier.publicConfig() });
        return true;
      }
    }

    // 发送测试消息（验证通道配置）
    const testMatch = path.match(/^\/api\/iot\/notify\/test\/([^/]+)$/);
    if (method === "POST" && testMatch) {
      const cid = decodeURIComponent(testMatch[1]);
      const r = await notifier.testChannel(cid);
      sendJSON(res, r.ok ? 200 : 400, r);
      return true;
    }

    // 物联网运维设置（数据留存天数）
    if (path === "/api/iot/settings") {
      if (method === "GET") {
        let stats = null;
        try {
          stats = await pointStore.stats();
        } catch {
          /* 统计失败不影响读取配置 */
        }
        sendJSON(res, 200, {
          ok: true,
          retentionDays: pointStore.getRetentionDays?.() ?? 90,
          stats,
        });
        return true;
      }
      if (method === "PUT") {
        const body = await readBody(req).catch(() => ({}));
        const r = pointStore.setRetentionDays?.(body?.retentionDays);
        if (!r || !r.ok) {
          sendJSON(res, 400, { error: r?.error || "设置失败" });
          return true;
        }
        if (typeof audit === "function") {
          await audit(req, { module: "物联", action: "修改设置", detail: `采集数据留存期改为 ${r.retentionDays} 天` });
        }
        sendJSON(res, 200, { ok: true, retentionDays: r.retentionDays });
        return true;
      }
    }

    // 采集数据统计（运维用）
    if (method === "GET" && path === "/api/iot/points/stats") {
      try {
        sendJSON(res, 200, { ok: true, stats: await pointStore.stats() });
      } catch (e) {
        sendJSON(res, 500, { error: e.message });
      }
      return true;
    }

    // ---------------- 自动化测试 ----------------
    if (method === "GET" && path === "/api/autotest/plans") {
      sendJSON(res, 200, { plans: engine.listPlans() });
      return true;
    }
    if (method === "POST" && path === "/api/autotest/plans") {
      try {
        const body = await readBody(req);
        if (!body.plan) {
          sendJSON(res, 400, { error: "缺少 plan" });
          return true;
        }
        sendJSON(res, 200, { plan: engine.savePlan(body.plan) });
      } catch {
        sendJSON(res, 400, { error: "请求体 JSON 解析失败" });
      }
      return true;
    }
    const planDel = path.match(/^\/api\/autotest\/plans\/([^/]+)$/);
    if (method === "DELETE" && planDel) {
      sendJSON(res, 200, { ok: engine.deletePlan(decodeURIComponent(planDel[1])) });
      return true;
    }
    const planRun = path.match(/^\/api\/autotest\/plans\/([^/]+)\/run$/);
    if (method === "POST" && planRun) {
      try {
        const body = await readBody(req);
        const planId = decodeURIComponent(planRun[1]);
        const plan = engine.listPlans().find((p) => p.id === planId);
        const deviceId = body.deviceId || plan?.deviceId;
        const device = deviceId ? findDevice(deviceId) : null;
        const run = engine.runPlan(planId, device, { sampleId: body.sampleId });
        sendJSON(res, 200, { ok: true, run: { id: run.id, planName: run.planName, deviceName: run.deviceName } });
      } catch (e) {
        sendJSON(res, 400, { error: e.message });
      }
      return true;
    }
    if (method === "GET" && path === "/api/autotest/runs") {
      sendJSON(res, 200, { runs: engine.listRuns().map((r) => ({ ...r, series: undefined, report: undefined })) });
      return true;
    }
    const runCsv = path.match(/^\/api\/autotest\/runs\/([^/]+)\/report\.csv$/);
    if (method === "GET" && runCsv) {
      const csv = engine.reportCsv(decodeURIComponent(runCsv[1]));
      if (!csv) {
        sendJSON(res, 404, { error: "运行记录不存在" });
        return true;
      }
      res.writeHead(200, {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="autotest-report.csv"`,
      });
      res.end(csv);
      return true;
    }
    const runGet = path.match(/^\/api\/autotest\/runs\/([^/]+)$/);
    if (method === "GET" && runGet) {
      const run = engine.getRun(decodeURIComponent(runGet[1]));
      if (!run) {
        sendJSON(res, 404, { error: "运行记录不存在" });
        return true;
      }
      sendJSON(res, 200, { run });
      return true;
    }

    return false;
  };

  function latestPointsOf(deviceId) {
    return (histories.get(deviceId) || []).slice(-5);
  }
}
