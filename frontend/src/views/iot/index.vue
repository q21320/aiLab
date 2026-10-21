<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Delete, Connection, Search, VideoPlay, Setting, Refresh, Cpu } from "@element-plus/icons-vue";
import {
  addDevice,
  deleteDevice,
  fetchDeviceLive,
  fetchDrivers,
  fetchSimulatorStatus,
  probeDevice,
  readDevicePoints,
  startSimulator,
  stopSimulator,
  writeDevicePoint,
  type DriverDef,
  type IotDevice,
  type IotPointDef,
} from "../../api/iot";
import { iotLive, startIotLive } from "../../lowcode/iotLive";
import { exportPointsCsv, fetchIotSettings, updateIotSettings } from "../../api/iot";
import { Download } from "@element-plus/icons-vue";
import { echarts, chartOption } from "../../lowcode/charts";

startIotLive();
onMounted(async () => {
  loadDrivers();
  refreshSimulator();
  // 从告警页跳转过来时自动打开对应设备的曲线并定位时间点
  await applyJumpQuery();
});

const drivers = ref<DriverDef[]>([]);
const simulator = ref<any>(null);
const devices = computed<IotDevice[]>(() => iotLive.devices as IotDevice[]);

// 从告警页跳转：/iot?device=DEV-001&time=<毫秒时间戳> 自动打开该设备曲线并定位到告警时刻
const route = useRoute();
const router = useRouter();
const jumpHandled = ref(false);
async function applyJumpQuery() {
  if (jumpHandled.value) return;
  const devId = String(route.query.device || "");
  const t = Number(route.query.time) || 0;
  if (!devId || !t) return;
  jumpHandled.value = true;
  // 等待设备列表通过 SSE / 接口加载完成（最多 4 秒）
  for (let i = 0; i < 20 && !devices.value.length; i++) await new Promise((r) => setTimeout(r, 200));
  const dev = devices.value.find((d) => d.id === devId);
  if (dev) {
    await openChart(dev, t);
    router.replace({ path: "/iot" });
  }
}

// ---------------------------------------------------------------------------
// 采集数据导出 / 留存设置
// ---------------------------------------------------------------------------
function exportCurrentChart() {
  if (!chartDevice.value) return;
  const rangeMin = chartRange.value || 60;
  const center = chartFocusTime.value || Date.now();
  const from = center - rangeMin * 60_000;
  const to = chartFocusTime.value ? center + 5 * 60_000 : Date.now();
  const url = exportPointsCsv(chartDevice.value.id, from, to);
  // 用 Cookie 会话下载，避免新窗口丢失认证
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
  ElMessage.success("正在导出 CSV（浏览器将开始下载）");
}

const settingsVisible = ref(false);
const retentionDays = ref(90);
const pointStats = ref<any>(null);
async function openSettings() {
  settingsVisible.value = true;
  const res = await fetchIotSettings();
  if (res) {
    retentionDays.value = res.retentionDays ?? 90;
    pointStats.value = res.stats || null;
  }
}
async function saveSettings() {
  const res = await updateIotSettings(retentionDays.value);
  if (res?.ok) {
    ElMessage.success(`留存期已更新为 ${res.retentionDays} 天`);
    settingsVisible.value = false;
  } else {
    ElMessage.error("设置失败，需工程师及以上权限");
  }
}

async function loadDrivers() {
  const res = await fetchDrivers();
  if (res) {
    drivers.value = res.drivers;
    simulator.value = res.simulator;
  }
}
async function refreshSimulator() {
  const res = await fetchSimulatorStatus();
  if (res) simulator.value = res.simulator;
}
async function toggleSimulator() {
  if (simulator.value?.running) {
    await stopSimulator();
    ElMessage.success("虚拟仪器已停止");
  } else {
    const res = await startSimulator();
    if (res?.ok) ElMessage.success(`虚拟仪器已启动：${res.hint}`);
    else ElMessage.error("启动失败（端口 5025/5020 可能被占用）");
  }
  await refreshSimulator();
}
async function refreshAll() {
  await loadDrivers();
  await refreshSimulator();
  ElMessage.success("设备清单与虚拟仪器状态已刷新");
}

// ---------------------------------------------------------------------------
// 新增真实设备
// ---------------------------------------------------------------------------
const addVisible = ref(false);
const deviceForm = ref<{
  id: string;
  name: string;
  type: string;
  location: string;
  protocol: string;
  address: Record<string, any>;
  points: IotPointDef[];
  pollIntervalMs: number;
  pollEnabled: boolean;
}>({
  id: "",
  name: "",
  type: "env",
  location: "",
  protocol: "scpi",
  address: {},
  points: [],
  pollIntervalMs: 10000,
  pollEnabled: true,
});

const currentDriver = computed(() => drivers.value.find((d) => d.id === deviceForm.value.protocol));

function openAdd() {
  const id = `DEV-${Date.now().toString(36).toUpperCase()}`;
  deviceForm.value = {
    id,
    name: "",
    type: "env",
    location: "实验室A-101",
    protocol: "scpi",
    address: {},
    points: [],
    pollIntervalMs: 10000,
    pollEnabled: true,
  };
  applyDefaults();
  applyTemplate("scpi");
  addVisible.value = true;
}
function applyDefaults() {
  const d = currentDriver.value;
  deviceForm.value.address = {};
  for (const f of d?.fields || []) deviceForm.value.address[f.key] = f.default ?? "";
}
function onProtocolChange() {
  applyDefaults();
  applyTemplate(deviceForm.value.protocol);
}
function applyTemplate(protocol: string) {
  if (protocol === "scpi") {
    deviceForm.value.points = [
      { key: "setpoint", label: "设定温度", command: "SOUR:TEMP {value}", unit: "℃" },
      { key: "temperature", label: "实测温度", query: "MEAS:TEMP?", unit: "℃" },
      { key: "humidity", label: "湿度", query: "MEAS:HUMI?", unit: "%" },
      { key: "power", label: "功率", query: "MEAS:POW?", unit: "kW" },
    ];
  } else if (protocol === "modbus-tcp") {
    deviceForm.value.points = [
      { key: "temperature", label: "温度", register: 0, type: "int16", scale: 0.1, unit: "℃" },
      { key: "humidity", label: "湿度", register: 1, type: "int16", scale: 0.1, unit: "%" },
      { key: "power", label: "功率", register: 2, type: "int16", scale: 0.1, unit: "kW" },
      { key: "setpoint", label: "设定温度(写)", register: 4, type: "int16", scale: 0.1, unit: "℃" },
    ];
  } else if (protocol === "http") {
    deviceForm.value.points = [{ key: "temperature", label: "温度", path: "data.temperature", unit: "℃" }];
  } else {
    deviceForm.value.points = [];
  }
}
function addPointRow() {
  deviceForm.value.points.push({ key: "", label: "" });
}
function removePointRow(i: number) {
  deviceForm.value.points.splice(i, 1);
}
async function saveDevice() {
  if (!deviceForm.value.name.trim()) {
    ElMessage.warning("请输入设备名称");
    return;
  }
  const res = await addDevice({
    ...deviceForm.value,
    type: deviceForm.value.type as IotDevice["type"],
    status: "online",
  } as Partial<IotDevice>);
  if (res?.device) {
    addVisible.value = false;
    ElMessage.success(`设备已接入：${res.device.name}，建议先点「探测」确认通信`);
    iotLive.devices = [...iotLive.devices, res.device];
  } else {
    ElMessage.error("接入失败（设备 ID 可能已存在）");
  }
}

// ---------------------------------------------------------------------------
// 探测 / 读取 / 下发
// ---------------------------------------------------------------------------
const probeVisible = ref(false);
const probeInfo = ref<Record<string, any>>({});
const probeDeviceName = ref("");
async function doProbe(device: IotDevice) {
  probeDeviceName.value = device.name;
  const res = await probeDevice(device.id);
  if (res?.ok) {
    probeInfo.value = res.info || {};
    probeVisible.value = true;
  } else {
    ElMessage.error(res?.error || "探测失败：请检查 IP / 端口 / 网络 / 协议参数");
  }
}

const readVisible = ref(false);
const readRows = ref<{ key: string; label: string; value: any; unit: string; raw: any }[]>([]);
async function doRead(device: IotDevice) {
  const res = await readDevicePoints(device.id);
  if (res?.ok) {
    readRows.value = Object.entries(res.values || {}).map(([key, v]: [string, any]) => ({
      key,
      label: v.label || key,
      value: v.value,
      unit: v.unit || "",
      raw: v.raw,
    }));
    readVisible.value = true;
  } else {
    ElMessage.error(res?.error || "读取失败");
  }
}

const writeVisible = ref(false);
const writeForm = ref<{ deviceId: string; key: string; value: number | string }>({ deviceId: "", key: "", value: 0 });
const writeDevicePoints = ref<IotPointDef[]>([]);
const writeDevice = ref<IotDevice | null>(null);
const writeSending = ref(false);

/**
 * 下发结果（用于界面上"看得出到底成功没有"）。
 * 关键点：命令发送成功 ≠ 设定值已生效。
 * 环境箱这类设备有热惯性，设定 85℃ 后实测值是逐步爬升的，
 * 因此这里展示「下发前值 → 下发后回读值 → 目标值」，并给出明确判定。
 */
interface WriteOutcome {
  ok: boolean;
  command: string;
  target: number;
  before: number | null;
  after: number | null;
  afterAt: number;
  raw: string;
  error: string;
}
const writeOutcome = ref<WriteOutcome | null>(null);
const writeError = ref("");

async function openWrite(device: IotDevice) {
  writeDevice.value = device;
  writeDevicePoints.value = (device.points || []).filter((p) => p.command || p.register !== undefined);
  writeForm.value = { deviceId: device.id, key: writeDevicePoints.value[0]?.key || "", value: 30 };
  writeOutcome.value = null;
  writeError.value = "";
  writeVisible.value = true;
  // 打开时先读一次当前值，给用户一个"下发前"的基准
  void refreshWriteBaseline();
}

async function refreshWriteBaseline() {
  const id = writeForm.value.deviceId;
  const key = writeForm.value.key;
  if (!id || !key) return;
  const res = await readDevicePoints(id);
  const v = res?.values?.[key]?.value;
  if (typeof v === "number") {
    if (writeOutcome.value) {
      writeOutcome.value.after = v;
      writeOutcome.value.afterAt = Date.now();
    } else {
      writeBaseline.value = v;
    }
  }
}
const writeBaseline = ref<number | null>(null);

async function doWrite() {
  if (writeSending.value) return;
  const target = Number(writeForm.value.value);
  if (!Number.isFinite(target)) {
    ElMessage.warning("目标值必须是数字");
    return;
  }
  writeSending.value = true;
  writeOutcome.value = null;
  writeError.value = "";
  try {
    const res: any = await writeDevicePoint(writeForm.value.deviceId, writeForm.value.key, writeForm.value.value);
    if (!res?.ok) {
      // 仪器明确拒绝（如 SCPI 返回 ERROR:...）或通信失败
      writeError.value = res?.error || "下发失败";
      ElMessage.error(writeError.value);
      return;
    }
    // 命令已送达。立即回读一次，给用户可验证的实际值。
    const readBack = await readDevicePoints(writeForm.value.deviceId);
    const after = readBack?.values?.[writeForm.value.key]?.value;
    writeOutcome.value = {
      ok: true,
      command: res.command || "",
      target,
      before: typeof res.before === "number" ? res.before : null,
      after: typeof after === "number" ? after : null,
      afterAt: Date.now(),
      raw: res.result?.raw || "",
      error: "",
    };
    ElMessage.success("指令已下发，已自动回读实测值");
  } catch (e: any) {
    writeError.value = e?.message || "下发失败";
    ElMessage.error(writeError.value);
  } finally {
    writeSending.value = false;
  }
}

/** 回读值是否已达到目标（环境箱有惯性，可能仍在爬升） */
function writeSettled(o: WriteOutcome): boolean {
  if (o.after == null) return false;
  return Math.abs(o.after - o.target) <= Math.max(0.5, Math.abs(o.target) * 0.02);
}

// ---------------------------------------------------------------------------
// 实时曲线
// ---------------------------------------------------------------------------
const chartVisible = ref(false);
const chartEl = ref<HTMLDivElement | null>(null);
const chartDevice = ref<IotDevice | null>(null);
const chartKey = ref("");
let chart: ReturnType<typeof echarts.init> | null = null;
let pollTimer: number | undefined;

/** 聚焦时间点：从告警跳转时传入，曲线窗口以该时刻为中心 */
const chartFocusTime = ref<number>(0);

async function openChart(device: IotDevice, focusTime?: number) {
  chartDevice.value = device;
  chartKey.value = (device.points || [])[0]?.key || "temperature";
  chartFocusTime.value = Number(focusTime) || 0;
  // 带焦点时间时默认切到 1 小时历史窗口，便于看到告警前后趋势
  chartRange.value = chartFocusTime.value ? 60 : 0;
  chartVisible.value = true;
  await new Promise((r) => setTimeout(r, 60));
  renderChart();
  clearInterval(pollTimer);
  // 实时模式每 2 秒刷新；历史模式不自动刷新（避免反复查库）
  if (!chartRange.value) pollTimer = window.setInterval(renderChart, 2000);
}
/** 曲线时间范围（分钟）：0 表示实时（内存缓冲），>0 表示查数据库历史 */
const chartRange = ref<number>(0);

async function renderChart() {
  if (!chartVisible.value || !chartDevice.value || !chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);

  const rangeMin = chartRange.value;
  // 有焦点时间（从告警跳转）时，窗口以该时刻为中心；否则以当前时刻结束
  const center = chartFocusTime.value || Date.now();
  const from = center - rangeMin * 60_000;
  const to = chartFocusTime.value ? center + 5 * 60_000 : Date.now();
  const res = rangeMin
    ? await fetchDeviceLive(chartDevice.value.id, {
        from,
        to,
        limit: 2000,
        // 长时间跨度自动降采样，避免点太密
        bucketMs: rangeMin >= 60 ? Math.floor((rangeMin * 60_000) / 200) : undefined,
      })
    : await fetchDeviceLive(chartDevice.value.id);
  const history = (res?.history || []) as any[];
  const labels = history.map((h) =>
    rangeMin >= 60
      ? new Date(h.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      : new Date(h.time).toLocaleTimeString("zh-CN", { hour12: false }),
  );
  const values = history.map((h) => {
    const v = h[chartKey.value];
    return typeof v === "number" ? v : null;
  }) as number[];
  chart.setOption(chartOption("line", labels, values, "#409eff", `${chartDevice.value.name} · ${chartKey.value}`), true);
}
function closeChart() {
  chartVisible.value = false;
  clearInterval(pollTimer);
  chart?.dispose();
  chart = null;
}

async function removeDeviceRow(device: IotDevice) {
  try {
    await ElMessageBox.confirm(`确定删除设备「${device.name}」？`, "删除设备", { type: "warning" });
    const res = await deleteDevice(device.id);
    if (res?.ok) {
      iotLive.devices = iotLive.devices.filter((d) => d.id !== device.id);
      ElMessage.success("已删除");
    }
  } catch {
    /* 取消 */
  }
}

function protocolLabel(p?: string): string {
  return drivers.value.find((d) => d.id === p)?.label.split("（")[0] || p || "平台模拟";
}
function addressText(d: IotDevice): string {
  const a = d.address || {};
  if (a.baseUrl) return String(a.baseUrl);
  if (a.host) return `${a.host}:${a.port ?? 502}`;
  return "平台内置";
}
function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString("zh-CN", { hour12: false });
}

function statusTag(s: string) {
  return s === "online" ? "success" : s === "error" ? "danger" : "info";
}
</script>

<template>
  <div class="iot-page">
    <!-- 虚拟仪器（无硬件演示/联调用） -->
    <el-card shadow="never" class="sim-card">
      <div class="sim-row">
        <el-icon class="sim-icon"><Cpu /></el-icon>
        <div class="sim-info">
          <b>虚拟仪器服务器（VC-300 高低温试验箱）</b>
          <p>
            {{ simulator?.running ? `运行中 · SCPI 127.0.0.1:${simulator.scpiPort} · Modbus TCP 127.0.0.1:${simulator.modbusPort}` : "未启动（用于无真实硬件时验证整条链路）" }}
            <span v-if="simulator?.model"> · 当前 {{ simulator.model.temperature }}℃ / 设定 {{ simulator.model.setpoint }}℃</span>
          </p>
        </div>
        <el-button :type="simulator?.running ? 'danger' : 'primary'" :icon="VideoPlay" @click="toggleSimulator">
          {{ simulator?.running ? "停止虚拟仪器" : "启动虚拟仪器" }}
        </el-button>
        <el-button @click="refreshAll">刷新设备清单</el-button>
        <el-button @click="openSettings">数据留存设置</el-button>
      </div>
    </el-card>

    <!-- 数据留存设置 -->
    <el-dialog v-model="settingsVisible" title="采集数据留存设置" width="520px">
      <el-form label-width="120px">
        <el-form-item label="留存天数">
          <el-input-number v-model="retentionDays" :min="1" :max="3650" :step="30" />
        </el-form-item>
      </el-form>
      <el-alert type="info" :closable="false" show-icon>
        超过留存期的采集点位会被自动清理（每天执行一次）。历史告警不受此设置影响（告警留存 12 个月）。
      </el-alert>
      <div v-if="pointStats" class="stats-box">
        <div>当前点位总量：<b>{{ pointStats.total }}</b> 条</div>
        <div>设备数：<b>{{ pointStats.devices }}</b></div>
        <div>占用空间：<b>{{ pointStats.size }}</b></div>
        <div v-if="pointStats.oldest">
          最早数据：<b>{{ new Date(pointStats.oldest).toLocaleString("zh-CN", { hour12: false }) }}</b>
        </div>
      </div>
      <template #footer>
        <el-button @click="settingsVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSettings">保存</el-button>
      </template>
    </el-dialog>

    <!-- 设备列表 -->
    <el-card shadow="never">
      <template #header>
        <div class="table-head">
          <span class="panel-title">设备接入清单（{{ devices.length }}）</span>
          <div class="head-actions">
            <el-button size="small" :icon="Refresh" @click="loadDrivers">刷新</el-button>
            <el-button size="small" type="primary" :icon="Plus" @click="openAdd">接入真实设备</el-button>
          </div>
        </div>
      </template>
      <el-table :data="devices" border style="width: 100%">
        <el-table-column prop="name" label="设备名称" min-width="170" />
        <el-table-column label="协议" width="150">
          <template #default="{ row }">{{ protocolLabel(row.protocol) }}</template>
        </el-table-column>
        <el-table-column label="连接地址" width="190">
          <template #default="{ row }">{{ addressText(row) }}</template>
        </el-table-column>
        <el-table-column prop="location" label="位置" width="120" />
        <el-table-column label="状态" width="130">
          <template #default="{ row }">
            <el-tooltip v-if="row.lastError" :content="row.lastError" placement="top">
              <el-tag size="small" :type="statusTag(row.status)">
                {{ row.status === "online" ? "在线" : row.status === "error" ? "异常" : "离线" }}
              </el-tag>
            </el-tooltip>
            <el-tag v-else size="small" :type="statusTag(row.status)">
              {{ row.status === "online" ? "在线" : row.status === "error" ? "异常" : "离线" }}
            </el-tag>
            <div v-if="row.lastPollAt" class="poll-time">
              {{ row.protocol === "mock" || !row.protocol ? "模拟" : `采集 ${fmtClock(row.lastPollAt)}` }}
            </div>
          </template>
        </el-table-column>
        <el-table-column label="最近探测" min-width="200">
          <template #default="{ row }">
            <span v-if="row.lastProbe" class="probe-text">
              {{ Object.entries(row.lastProbe.info || {}).slice(0, 2).map(([k, v]) => `${k}:${v}`).join(" · ") }}
            </span>
            <span v-else class="muted">未探测</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="330" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="Connection" @click="doProbe(row)">探测</el-button>
            <el-button size="small" :icon="Search" @click="doRead(row)">读取</el-button>
            <el-button size="small" :icon="Setting" @click="openWrite(row)">下发</el-button>
            <el-button size="small" type="primary" :icon="Connection" @click="openChart(row)">曲线</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removeDeviceRow(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 接入真实设备 -->
    <el-dialog v-model="addVisible" title="接入真实设备" width="880px" top="4vh">
      <div class="form-grid">
        <div class="form-field"><label>设备名称</label><el-input v-model="deviceForm.name" placeholder="如：高低温试验箱" /></div>
        <div class="form-field">
          <label>设备类型</label>
          <el-select v-model="deviceForm.type">
            <el-option label="环境设备" value="env" />
            <el-option label="测试设备" value="test" />
            <el-option label="能耗计量" value="energy" />
            <el-option label="其他" value="other" />
          </el-select>
        </div>
        <div class="form-field"><label>安装位置</label><el-input v-model="deviceForm.location" /></div>
        <div class="form-field">
          <label>通信协议</label>
          <el-select v-model="deviceForm.protocol" @change="onProtocolChange">
            <el-option v-for="d in drivers" :key="d.id" :label="d.label" :value="d.id" />
          </el-select>
        </div>
        <div v-for="f in currentDriver?.fields || []" :key="f.key" class="form-field">
          <label>{{ f.label }}</label>
          <el-input v-model="deviceForm.address[f.key]" :placeholder="f.placeholder" />
        </div>
        <div v-if="deviceForm.protocol !== 'mock'" class="form-field">
          <label>采集周期（毫秒）</label>
          <el-input-number v-model="deviceForm.pollIntervalMs" :min="2000" :step="1000" :max="3600000" style="width: 100%" />
        </div>
        <div v-if="deviceForm.protocol !== 'mock'" class="form-field">
          <label>自动采集</label>
          <el-switch v-model="deviceForm.pollEnabled" active-text="开启" inactive-text="关闭" />
        </div>
      </div>

      <div class="points-head">
        <b>点位表（{{ deviceForm.points.length }}）</b>
        <div>
          <el-button size="small" @click="applyTemplate(deviceForm.protocol)">套用示例点位</el-button>
          <el-button size="small" :icon="Plus" @click="addPointRow">添加点位</el-button>
        </div>
      </div>
      <el-table :data="deviceForm.points" size="small" border max-height="260">
        <el-table-column label="点位 key" width="130">
          <template #default="{ row }"><el-input v-model="row.key" size="small" placeholder="temperature" /></template>
        </el-table-column>
        <el-table-column label="名称" width="120">
          <template #default="{ row }"><el-input v-model="row.label" size="small" /></template>
        </el-table-column>
        <el-table-column label="SCPI 查询" width="150">
          <template #default="{ row }"><el-input v-model="row.query" size="small" placeholder="MEAS:TEMP?" /></template>
        </el-table-column>
        <el-table-column label="SCPI 下发命令" width="170">
          <template #default="{ row }"><el-input v-model="row.command" size="small" placeholder="SOUR:TEMP {value}" /></template>
        </el-table-column>
        <el-table-column label="寄存器" width="90">
          <template #default="{ row }"><el-input v-model.number="row.register" size="small" /></template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-select v-model="row.type" size="small" clearable>
              <el-option v-for="t in ['uint16', 'int16', 'uint32', 'int32', 'float32']" :key="t" :label="t" :value="t" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="系数" width="80">
          <template #default="{ row }"><el-input v-model.number="row.scale" size="small" /></template>
        </el-table-column>
        <el-table-column label="单位" width="80">
          <template #default="{ row }"><el-input v-model="row.unit" size="small" /></template>
        </el-table-column>
        <el-table-column label="" width="50">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="removePointRow($index)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" @click="saveDevice">接入设备</el-button>
      </template>
    </el-dialog>

    <!-- 探测结果：真实设备信息 -->
    <el-dialog v-model="probeVisible" :title="`设备信息 · ${probeDeviceName}`" width="560px">
      <el-descriptions :column="1" border>
        <el-descriptions-item v-for="(v, k) in probeInfo" :key="k" :label="String(k)">{{ v }}</el-descriptions-item>
      </el-descriptions>
      <p class="tip">真实设备信息由协议驱动直接读取（SCPI `*IDN?` / Modbus 寄存器），非平台模拟数据。</p>
    </el-dialog>

    <!-- 实时读数 -->
    <el-dialog v-model="readVisible" title="设备实时读数" width="560px">
      <el-table :data="readRows" size="small" border>
        <el-table-column prop="label" label="点位" />
        <el-table-column prop="value" label="数值" />
        <el-table-column prop="unit" label="单位" width="80" />
        <el-table-column prop="raw" label="原始值" width="120" />
      </el-table>
    </el-dialog>

    <!-- 下发控制 -->
    <el-dialog v-model="writeVisible" title="下发控制（写真实设备）" width="560px">
      <div class="form-field">
        <label>控制点位</label>
        <el-select v-model="writeForm.key" style="width: 100%" @change="refreshWriteBaseline">
          <el-option v-for="p in writeDevicePoints" :key="p.key" :label="`${p.label || p.key}（${p.key}）`" :value="p.key" />
        </el-select>
      </div>
      <div class="form-field"><label>目标值</label><el-input v-model="writeForm.value" placeholder="如 60" /></div>

      <!-- 下发前基准 -->
      <div v-if="!writeOutcome" class="write-baseline">
        下发前实测值：<b>{{ writeBaseline ?? "—" }}</b>
        <span class="muted">（打开弹窗时自动读取，用于对比）</span>
      </div>

      <!-- 下发结果：让人一眼看出成功没有、生效了没有 -->
      <el-alert v-if="writeError" type="error" :closable="false" show-icon class="mt12">
        <template #title>下发失败</template>
        {{ writeError }}
      </el-alert>

      <div v-if="writeOutcome" class="write-result">
        <el-alert type="success" :closable="false" show-icon>
          <template #title>指令已送达设备</template>
          <code>{{ writeOutcome.command || "（已写入）" }}</code>
        </el-alert>

        <div class="result-grid">
          <div class="result-cell">
            <div class="k">下发前</div>
            <div class="v">{{ writeOutcome.before ?? "—" }}</div>
          </div>
          <div class="result-cell">
            <div class="k">目标值</div>
            <div class="v target">{{ writeOutcome.target }}</div>
          </div>
          <div class="result-cell">
            <div class="k">回读实测（{{ new Date(writeOutcome.afterAt).toLocaleTimeString("zh-CN", { hour12: false }) }}）</div>
            <div class="v" :class="{ ok: writeSettled(writeOutcome), pending: !writeSettled(writeOutcome) }">
              {{ writeOutcome.after ?? "—" }}
            </div>
          </div>
        </div>

        <el-alert
          v-if="writeSettled(writeOutcome)"
          type="success" :closable="false" show-icon class="mt12"
          title="设定值已生效（回读值与目标一致）"
        />
        <el-alert
          v-else
          type="warning" :closable="false" show-icon class="mt12"
        >
          <template #title>指令已送达，但实测值尚未达到目标</template>
          环境箱/试验机存在热惯性，温度需要时间爬升，这是正常现象。可点击下方
          <b>重新回读</b> 查看最新值，或用「曲线」查看趋势。
        </el-alert>

        <div class="result-actions">
          <el-button size="small" :icon="Refresh" @click="refreshWriteBaseline">重新回读</el-button>
          <el-button size="small" @click="openChart(writeDevice!); writeVisible = false">查看曲线</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="writeVisible = false">关闭</el-button>
        <el-button type="primary" :loading="writeSending" @click="doWrite">
          {{ writeOutcome ? "再次下发" : "下发" }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 实时曲线 -->
    <el-dialog v-model="chartVisible" :title="`实时曲线 · ${chartDevice?.name || ''}`" width="860px" @close="closeChart">
      <div class="chart-toolbar">
        <span class="range-label">时间范围：</span>
        <el-radio-group v-model="chartRange" size="small" @change="openChart(chartDevice!)">
          <el-radio-button :value="0">实时</el-radio-button>
          <el-radio-button :value="10">10 分钟</el-radio-button>
          <el-radio-button :value="60">1 小时</el-radio-button>
          <el-radio-button :value="1440">24 小时</el-radio-button>
          <el-radio-button :value="10080">7 天</el-radio-button>
        </el-radio-group>
      </div>
      <el-radio-group v-model="chartKey" size="small" style="margin-bottom: 10px" @change="renderChart">
        <el-radio-button v-for="p in chartDevice?.points || []" :key="p.key" :value="p.key">{{ p.label || p.key }}</el-radio-button>
      </el-radio-group>
      <div ref="chartEl" class="live-chart"></div>
      <el-alert
        v-if="chartFocusTime"
        type="warning"
        :closable="false"
        show-icon
        class="focus-alert"
        :title="`已定位到告警时刻：${new Date(chartFocusTime).toLocaleString('zh-CN', { hour12: false })}（曲线以该时刻为中心）`"
      />
      <p class="tip">
        实时模式读取内存缓冲（每 2 秒刷新）；历史模式查询数据库（支持 10 分钟 ~ 7 天）。
        采集数据已持久化到 PostgreSQL，重启不丢失。
      </p>
      <template #footer>
        <el-button :icon="Download" @click="exportCurrentChart">导出当前范围 CSV</el-button>
        <el-button @click="closeChart">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.chart-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.stats-box {
  margin-top: 12px;
  padding: 10px 12px;
  background: #f5f7fa;
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.9;
  color: #606266;
}
.focus-alert {
  margin-top: 8px;
}
.range-label {
  font-size: 13px;
  color: #606266;
}
.write-baseline {
  margin-top: 8px;
  font-size: 13px;
  color: #606266;
}
.write-baseline b {
  color: #409eff;
  font-size: 16px;
  margin: 0 4px;
}
.mt12 {
  margin-top: 12px;
}
.write-result {
  margin-top: 12px;
}
.result-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-top: 12px;
}
.result-cell {
  background: #f5f7fa;
  border-radius: 8px;
  padding: 10px 12px;
  text-align: center;
}
.result-cell .k {
  font-size: 12px;
  color: #909399;
  margin-bottom: 4px;
}
.result-cell .v {
  font-size: 20px;
  font-weight: 600;
  color: #303133;
}
.result-cell .v.target {
  color: #409eff;
}
.result-cell .v.ok {
  color: #67c23a;
}
.result-cell .v.pending {
  color: #e6a23c;
}
.result-actions {
  margin-top: 12px;
  display: flex;
  gap: 8px;
}
.iot-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sim-card {
  border-radius: 8px;
}
.sim-row {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
}
.sim-icon {
  font-size: 30px;
  color: #409eff;
}
.sim-info {
  flex: 1;
  min-width: 260px;
}
.sim-info b {
  color: #1f2d3d;
}
.sim-info p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #909399;
}
.table-head,
.points-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-weight: 600;
  color: #1f2d3d;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.probe-text {
  font-size: 12px;
  color: #606266;
}
.muted {
  color: #c0c4cc;
  font-size: 12px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 16px;
}
.form-field {
  margin-bottom: 14px;
}
.form-field label {
  display: block;
  margin-bottom: 6px;
  color: #606266;
}
.points-head {
  margin: 6px 0 10px;
}
.tip {
  font-size: 12px;
  color: #909399;
  margin: 10px 0 0;
}
.live-chart {
  width: 100%;
  height: 320px;
}
</style>
