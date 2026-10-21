// ============================================================================
// 自动化测试引擎（真实设备）
//
// 测试方案（TestPlan）由步骤组成，后端按步骤驱动真实设备执行：
//   write   : 下发设定（SCPI 命令 / 写 Modbus 寄存器 / HTTP）
//   wait    : 稳定等待
//   collect : 按间隔采样 N 次（真实读数，边采边推送到实时流）
//   judge   : 判定（偏差 absDevLte / 不小于 gte / 不大于 lte / 区间 between）
// 支持 loops 循环（如高低温循环 3 次），全部判定通过 → 合格。
// ============================================================================

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import { readDevice, writeDevicePoint } from "./drivers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => (typeof v === "number" && Number.isFinite(v) ? Number(v.toFixed(d)) : v);

export function createAutoTestEngine({ dataFile, onEvent, onPoint, getLatestPoints }) {
  let state = { plans: [], runs: [], serial: 100 };

  try {
    if (existsSync(dataFile)) state = JSON.parse(readFileSync(dataFile, "utf-8"));
  } catch (e) {
    console.error("[autotest] 读取测试数据失败：", e.message);
  }
  function persist() {
    try {
      mkdirSync(dirname(dataFile), { recursive: true });
      // 原子写：避免崩溃时留下截断的 JSON（截断会导致下次启动回退为空 state，历史全部丢失）
      const tmp = `${dataFile}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2), "utf-8");
      renameSync(tmp, dataFile);
    } catch (e) {
      console.error("[autotest] 保存测试数据失败：", e.message);
    }
  }

  // 崩溃恢复：进程重启后仍标记为 running 的记录不可能再继续，标记为已中止，
  // 否则 runPlan 的「该设备已有测试任务在执行」判断会永久拒绝该设备的新测试。
  for (const r of state.runs) {
    if (r.status === "running") {
      r.status = "aborted";
      r.conclusion = "aborted";
      r.finishedAt = Date.now();
      r.progress = [...(r.progress || []), `[${new Date().toLocaleTimeString("zh-CN")}] 服务重启，任务已中止`];
    }
  }

  // 首次运行内置一个演示方案（配合虚拟仪器 VC-300：60℃ 恒温测试）
  if (state.plans.length === 0) {
    state.plans.push({
      id: "PLAN-DEMO-1",
      name: "恒温自动测试（示例方案）",
      deviceId: "",
      loops: 1,
      steps: [
        { type: "write", key: "setpoint", value: 60, label: "设定温度 60℃" },
        { type: "wait", seconds: 8, label: "恒温稳定" },
        { type: "collect", key: "temperature", count: 5, interval: 1, label: "采集温度/湿度/功率" },
        { type: "judge", key: "temperature", mode: "absDevLte", ref: 60, value: 3, label: "温度偏差 ≤ 3℃" },
        { type: "judge", key: "power", mode: "lte", value: 25, agg: "max", label: "功率峰值 ≤ 25kW" },
      ],
      createdAt: Date.now(),
    });
    persist();
  }

  const emit = (runId, payload) => {
    try {
      onEvent?.({ runId, ...payload });
    } catch {
      /* 推送失败不影响执行 */
    }
  };

  function listPlans() {
    return state.plans;
  }
  function savePlan(plan) {
    if (!plan.id) plan.id = `PLAN-${++state.serial}`;
    plan.updatedAt = Date.now();
    const idx = state.plans.findIndex((p) => p.id === plan.id);
    if (idx >= 0) state.plans[idx] = plan;
    else state.plans.push(plan);
    persist();
    return plan;
  }
  function deletePlan(id) {
    const before = state.plans.length;
    state.plans = state.plans.filter((p) => p.id !== id);
    persist();
    return state.plans.length < before;
  }
  function listRuns() {
    return state.runs.slice(0, 50);
  }
  function getRun(id) {
    return state.runs.find((r) => r.id === id) || null;
  }

  function describeJudge(step) {
    if (step.mode === "absDevLte") return `与 ${step.ref} 偏差 ≤ ${step.value}`;
    if (step.mode === "gte") return `≥ ${step.value}`;
    if (step.mode === "lte") return `≤ ${step.value}`;
    if (step.mode === "between") return `${step.min} ~ ${step.max}`;
    return String(step.value ?? "");
  }

  /**
   * 从全部采样点中提取某个点位的数值（跨点位判定：
   * 如采集温度时同时记录了功率，判定步骤可直接对功率判定）
   */
  function collectValues(run, key, loop) {
    const nums = [];
    for (const list of Object.values(run.series)) {
      for (const s of list) {
        if (loop && s.loop !== loop) continue;
        const v = s.values?.[key];
        if (typeof v === "number" && Number.isFinite(v)) nums.push(v);
      }
    }
    return nums;
  }

  function aggregate(nums, agg = "avg") {
    if (!nums.length) return null;
    if (agg === "max") return Math.max(...nums);
    if (agg === "min") return Math.min(...nums);
    if (agg === "last") return nums[nums.length - 1];
    if (agg === "first") return nums[0];
    return nums.reduce((a, b) => a + b, 0) / nums.length;
  }

  function judgeValue(step, actual) {
    if (typeof actual !== "number" || !Number.isFinite(actual)) return false;
    if (step.mode === "absDevLte") return Math.abs(actual - step.ref) <= step.value;
    if (step.mode === "gte") return actual >= step.value;
    if (step.mode === "lte") return actual <= step.value;
    if (step.mode === "between") return actual >= step.min && actual <= step.max;
    return false;
  }

  /** 启动一次测试运行（后台异步执行，立即返回 runId） */
  function runPlan(planId, device, opts = {}) {
    const plan = state.plans.find((p) => p.id === planId);
    if (!plan) throw new Error("测试方案不存在");
    if (!device) throw new Error("请先选择要测试的设备");
    if (state.runs.some((r) => r.status === "running" && r.deviceId === device.id)) {
      throw new Error("该设备已有测试任务在执行，请等待完成");
    }

    const run = {
      id: `RUN-${Date.now().toString(36).toUpperCase()}`,
      planId,
      planName: plan.name,
      deviceId: device.id,
      deviceName: device.name,
      sampleId: opts.sampleId || "",
      loops: plan.loops || 1,
      currentLoop: 0,
      status: "running",
      startedAt: Date.now(),
      finishedAt: 0,
      progress: [],
      series: {},
      judgments: [],
      conclusion: "",
      error: "",
      report: [],
    };
    state.runs.unshift(run);
    if (state.runs.length > 50) state.runs.length = 50;
    persist();
    emit(run.id, { status: "running", planName: plan.name, deviceName: device.name });

    (async () => {
      try {
        for (let loop = 1; loop <= run.loops; loop++) {
          run.currentLoop = loop;
          emit(run.id, { loop, status: "running" });
          for (const step of plan.steps) {
            const stamp = () => new Date().toLocaleTimeString("zh-CN", { hour12: false });
            if (step.type === "write") {
              const res = await writeDevicePoint(device, step.key, step.value);
              const line = `[${stamp()}] 第${loop}轮 下发 ${step.label || step.key} = ${step.value}${res?.command ? `（${res.command}）` : ""}`;
              run.progress.push(line);
              emit(run.id, { line });
            } else if (step.type === "wait") {
              const line = `[${stamp()}] 第${loop}轮 等待 ${step.seconds}s（${step.label || "稳定" }）`;
              run.progress.push(line);
              emit(run.id, { line });
              await sleep(Math.min(step.seconds, 600) * 1000);
            } else if (step.type === "collect") {
              const count = Math.max(1, Math.min(step.count || 1, 200));
              const interval = Math.min(step.interval || 1, 60);
              for (let i = 1; i <= count; i++) {
                // mock 驱动依赖 ctx.latestPoints；不传时所有采样都是 null → 恒判不合格
                const res = await readDevice(device, { latestPoints: typeof getLatestPoints === "function" ? getLatestPoints(device.id) : [] });
                const readings = res?.values || {};
                const arr = run.series[step.key] || (run.series[step.key] = []);
                const sample = { t: Date.now(), loop, values: {} };
                for (const [k, v] of Object.entries(readings)) {
                  sample.values[k] = v.value;
                  onPoint?.(device, k, v.value, v.unit);
                }
                arr.push(sample);
                const main = readings[step.key];
                const line = `[${stamp()}] 第${loop}轮 采集 ${i}/${count}：${step.label || step.key} = ${main ? main.value : "-"}${main?.unit || ""}`;
                run.progress.push(line);
                emit(run.id, { line, sample: { t: sample.t, loop, values: sample.values } });
                if (i < count) await sleep(interval * 1000);
              }
            } else if (step.type === "judge") {
              const nums = collectValues(run, step.key, loop);
              const actual = aggregate(nums, step.agg || "avg");
              const pass = judgeValue(step, actual);
              const aggLabel = { avg: "均值", max: "最大值", min: "最小值", last: "末值", first: "首值" }[step.agg || "avg"];
              const item = {
                loop,
                key: step.key,
                label: step.label || step.key,
                mode: step.mode,
                agg: step.agg || "avg",
                expect: `${describeJudge(step)}（按${aggLabel}）`,
                actual: round(actual),
                samples: nums.length,
                pass,
              };
              run.judgments.push(item);
              const line = `[${stamp()}] 第${loop}轮 判定 ${item.label}：实测 ${item.actual}，要求 ${item.expect} → ${pass ? "合格" : "不合格"}`;
              run.progress.push(line);
              emit(run.id, { line, judgment: item });
            }
          }
          persist();
        }
        run.conclusion = run.judgments.length && run.judgments.every((j) => j.pass) ? "qualified" : "unqualified";
        run.status = "done";
        run.finishedAt = Date.now();
        run.report = buildReport(run);
        emit(run.id, { status: "done", conclusion: run.conclusion, report: run.report });
      } catch (e) {
        run.status = "failed";
        run.error = e.message;
        run.finishedAt = Date.now();
        run.progress.push(`[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] 执行失败：${e.message}`);
        emit(run.id, { status: "failed", error: e.message });
      }
      persist();
    })();

    return run;
  }

  function buildReport(run) {
    const rows = run.judgments.map((j) => ({
      循环: j.loop,
      测试项: j.label,
      采样点数: j.samples,
      实测均值: j.actual,
      判定要求: j.expect,
      结论: j.pass ? "合格" : "不合格",
    }));
    for (const [key, list] of Object.entries(run.series)) {
      const nums = list.map((s) => s.values[key]).filter((v) => typeof v === "number");
      if (!nums.length) continue;
      rows.push({
        循环: "全部",
        测试项: `${key} 统计`,
        采样点数: nums.length,
        实测均值: round(nums.reduce((a, b) => a + b, 0) / nums.length),
        判定要求: `最大 ${round(Math.max(...nums))} / 最小 ${round(Math.min(...nums))}`,
        结论: "-",
      });
    }
    return rows;
  }

  function reportCsv(runId) {
    const run = getRun(runId);
    if (!run) return null;
    const header = "循环,测试项,采样点数,实测均值,判定要求,结论";
    const rows = (run.report || []).map((r) => [r.循环, r.测试项, r.采样点数, r.实测均值, r.判定要求, r.结论].join(","));
    const meta = [
      `# 自动化测试报告`,
      `# 方案,${run.planName}`,
      `# 设备,${run.deviceName}`,
      `# 样品,${run.sampleId || "-"}`,
      `# 开始时间,${new Date(run.startedAt).toLocaleString("zh-CN")}`,
      `# 结束时间,${run.finishedAt ? new Date(run.finishedAt).toLocaleString("zh-CN") : "-"}`,
      `# 结论,${run.conclusion === "qualified" ? "合格" : run.conclusion === "unqualified" ? "不合格" : run.status}`,
      "",
    ];
    return "\uFEFF" + [...meta, header, ...rows].join("\n");
  }

  return { listPlans, savePlan, deletePlan, listRuns, getRun, runPlan, reportCsv };
}
