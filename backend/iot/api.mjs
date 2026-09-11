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
import { startSimulator, stopSimulator, simulatorStatus } from "./simulator.mjs";
import { createAutoTestEngine } from "./autotest.mjs";

export function createIotExtraRoutes(deps) {
  const { sendJSON, readBody, getIot, persistIot, broadcast, histories, dataDir } = deps;

  const engine = createAutoTestEngine({
    dataFile: `${dataDir}/autotest.json`,
    onEvent: (payload) => broadcast({ autotest: payload }),
    onPoint: (device, key, value, unit) => {
      // 真实设备采集点进入统一实时流（大屏/仪表盘同一契约）
      const point = {
        deviceId: device.id,
        deviceName: device.name,
        type: device.type || "test",
        time: Date.now(),
        temperature: key === "temperature" ? value : undefined,
        humidity: key === "humidity" ? value : undefined,
        power: key === "power" ? value : undefined,
        [key]: value,
        unit: unit || "",
      };
      const list = histories.get(device.id) || [];
      list.push(point);
      if (list.length > 200) list.shift();
      histories.set(device.id, list);
      broadcast({ devices: getIot().devices, points: [point], overview: null, alerts: getIot().alerts });
    },
  });

  function findDevice(id) {
    return getIot().devices.find((d) => d.id === id) || null;
  }

  return async function handle(req, res, path, method) {
    // ---------------- 驱动与虚拟仪器 ----------------
    if (method === "GET" && path === "/api/iot/drivers") {
      sendJSON(res, 200, { drivers: listDrivers(), simulator: simulatorStatus() });
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
        const result = await readDevice(device, { latestPoints: latestPointsOf(device.id) });
        device.lastRead = { time: Date.now(), values: result.values };
        persistIot();
        sendJSON(res, 200, { ok: true, values: result.values, time: Date.now() });
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
        const result = await writeDevicePoint(device, body.key, body.value);
        sendJSON(res, 200, { ok: true, result });
      } catch (e) {
        sendJSON(res, 200, { ok: false, error: e.message });
      }
      return true;
    }

    const liveMatch = path.match(/^\/api\/iot\/devices\/([^/]+)\/live$/);
    if (method === "GET" && liveMatch) {
      const id = decodeURIComponent(liveMatch[1]);
      const device = findDevice(id);
      sendJSON(res, 200, { device: device || null, history: (histories.get(id) || []).slice(-60) });
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
        "Access-Control-Allow-Origin": "*",
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
