// ============================================================================
// 工业物联网 · 设备采集调度器
//
// 解决的问题（此前真实设备只能手动点「读取」才采集）：
//   · 模拟设备每 2 秒由 simulateTick 自动产生数据；
//   · 真实设备（scpi / modbus-tcp / http）此前没有任何后台采集，
//     大屏、历史曲线、告警都只能在人工触发时更新。
//
// 设计：
//   1) **按设备独立调度**：每台设备有自己的采集周期（pollIntervalMs，默认 10s），
//      互不影响；慢设备不会拖累快设备；
//   2) **防重入**：同一设备上一次采集未完成时跳过本轮，避免请求堆积把设备打爆；
//   3) **失败退避**：连续失败时指数退避（上限 5 分钟），避免对已离线设备疯狂重试；
//   4) **并发上限**：全局同时进行的采集数受限，避免设备多时耗尽连接；
//   5) **状态跟随**：采集成功置 online，失败置 offline 并记录 lastError，
//      让运维一眼看出设备是否真的在线；
//   6) 采集到的点位进入统一数据流（历史 + 告警 + SSE），与模拟设备同一契约。
// ============================================================================

/** 默认采集周期（毫秒）；可在设备上通过 pollIntervalMs 覆盖 */
const DEFAULT_INTERVAL_MS = 10_000;
/** 最小允许周期，防止把设备打爆 */
const MIN_INTERVAL_MS = 2_000;
/** 并发采集上限 */
const MAX_CONCURRENCY = 4;
/** 失败退避上限 */
const MAX_BACKOFF_MS = 5 * 60_000;

export function createPoller({ readDevice, getDevices, onPoints, onStatusChange, log = console.log }) {
  /** 设备ID -> 运行时状态 */
  const runtime = new Map();
  let timer = null;
  let running = false;
  let stopped = false;

  function intervalOf(device) {
    const v = Number(device.pollIntervalMs);
    return Number.isFinite(v) && v > 0 ? Math.max(MIN_INTERVAL_MS, v) : DEFAULT_INTERVAL_MS;
  }

  function stateOf(id) {
    let s = runtime.get(id);
    if (!s) {
      s = { busy: false, failures: 0, nextAt: 0, lastOkAt: 0, lastError: "" };
      runtime.set(id, s);
    }
    return s;
  }

  /** 是否应该采集：真实协议设备 + 启用轮询 + 到达时间点 */
  function isCandidate(device) {
    if (!device || !device.protocol || device.protocol === "mock") return false;
    if (device.pollEnabled === false) return false;
    return true;
  }

  async function pollOne(device) {
    const st = stateOf(device.id);
    if (st.busy) return; // 上一轮还没结束，跳过（防重入）
    st.busy = true;
    try {
      const result = await readDevice(device);
      const values = result?.values || {};
      const now = Date.now();
      const points = [];

      for (const [key, v] of Object.entries(values)) {
        if (typeof v?.value !== "number" || !Number.isFinite(v.value)) continue;
        points.push({
          deviceId: device.id,
          deviceName: device.name,
          type: device.type || "test",
          time: now,
          temperature: key === "temperature" ? v.value : undefined,
          humidity: key === "humidity" ? v.value : undefined,
          power: key === "power" ? v.value : undefined,
          [key]: v.value,
          unit: v.unit || "",
        });
      }

      if (points.length) {
        onPoints?.(device, points);
      }

      // 通信成功：状态恢复、清错误、重置退避
      const wasOffline = device.status === "offline" || !!st.lastError;
      st.failures = 0;
      st.lastOkAt = now;
      st.lastError = "";
      device.lastPollAt = now;
      delete device.lastError;
      if (wasOffline) {
        device.status = "online";
        onStatusChange?.(device, "online");
        log(`[poller] ${device.name}(${device.id}) 通信恢复`);
      }
    } catch (e) {
      st.failures += 1;
      st.lastError = String(e?.message || e);
      device.lastError = st.lastError;
      device.lastPollAt = Date.now();
      // 连续失败 2 次才标记离线，避免偶发一次抖动就报警
      if (st.failures >= 2 && device.status !== "offline") {
        device.status = "offline";
        onStatusChange?.(device, "offline", st.lastError);
        log(`[poller] ${device.name}(${device.id}) 标记为离线：${st.lastError}`);
      }
    } finally {
      st.busy = false;
      // 失败退避：10s → 20s → 40s … 上限 5 分钟
      const backoff = st.failures > 0 ? Math.min(intervalOf(device) * 2 ** (st.failures - 1), MAX_BACKOFF_MS) : intervalOf(device);
      st.nextAt = Date.now() + backoff;
    }
  }

  /** 一轮调度：找出到期的设备并发采集（受并发上限约束） */
  async function tick() {
    if (running || stopped) return;
    running = true;
    try {
      const now = Date.now();
      const due = [];
      for (const d of getDevices()) {
        if (!isCandidate(d)) continue;
        const st = stateOf(d.id);
        if (st.busy || st.nextAt > now) continue;
        // 首次采集立即执行，不要等一个完整周期
        if (!st.nextAt) st.nextAt = now;
        due.push(d);
      }
      // 分批并发，避免一次打满
      for (let i = 0; i < due.length; i += MAX_CONCURRENCY) {
        const batch = due.slice(i, i + MAX_CONCURRENCY);
        await Promise.allSettled(batch.map((d) => pollOne(d)));
      }
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer || stopped) return;
    // 调度精度 1 秒：每个设备按自己的 nextAt 到期执行
    timer = setInterval(() => void tick(), 1000);
    if (typeof timer.unref === "function") timer.unref();
    log(`[poller] 设备采集调度器已启动（默认周期 ${DEFAULT_INTERVAL_MS / 1000}s）`);
  }

  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** 立即触发一次采集（用于「手动读取」后同步状态，或测试） */
  async function pollNow(deviceId) {
    const d = getDevices().find((x) => x.id === deviceId);
    if (!d || !isCandidate(d)) return false;
    const st = stateOf(d.id);
    st.nextAt = 0; // 允许立即执行
    await pollOne(d);
    return true;
  }

  /** 运行时状态快照（供 UI 展示「距下次采集」等） */
  function snapshot() {
    const out = {};
    for (const [id, s] of runtime) {
      out[id] = {
        failures: s.failures,
        lastOkAt: s.lastOkAt,
        lastError: s.lastError,
        nextAt: s.nextAt,
        busy: s.busy,
      };
    }
    return out;
  }

  return { start, stop, tick, pollNow, snapshot, intervalOf };
}
