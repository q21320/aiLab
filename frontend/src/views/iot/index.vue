<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
import { echarts, chartOption } from "../../lowcode/charts";

startIotLive();
onMounted(() => {
  loadDrivers();
  refreshSimulator();
});

const drivers = ref<DriverDef[]>([]);
const simulator = ref<any>(null);
const devices = computed<IotDevice[]>(() => iotLive.devices as IotDevice[]);

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
}>({
  id: "",
  name: "",
  type: "env",
  location: "",
  protocol: "scpi",
  address: {},
  points: [],
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
function openWrite(device: IotDevice) {
  writeDevicePoints.value = (device.points || []).filter((p) => p.command || p.register !== undefined);
  writeForm.value = { deviceId: device.id, key: writeDevicePoints.value[0]?.key || "", value: 30 };
  writeVisible.value = true;
}
async function doWrite() {
  const res = await writeDevicePoint(writeForm.value.deviceId, writeForm.value.key, writeForm.value.value);
  if (res?.ok) {
    ElMessage.success(`下发成功：${writeForm.value.key} = ${writeForm.value.value}`);
    writeVisible.value = false;
  } else {
    ElMessage.error(res?.error || "下发失败");
  }
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

async function openChart(device: IotDevice) {
  chartDevice.value = device;
  chartKey.value = (device.points || [])[0]?.key || "temperature";
  chartVisible.value = true;
  await new Promise((r) => setTimeout(r, 60));
  renderChart();
  clearInterval(pollTimer);
  pollTimer = window.setInterval(renderChart, 2000);
}
async function renderChart() {
  if (!chartVisible.value || !chartDevice.value || !chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  const res = await fetchDeviceLive(chartDevice.value.id);
  const history = (res?.history || []) as any[];
  const labels = history.map((h) => new Date(h.time).toLocaleTimeString("zh-CN", { hour12: false }));
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
      </div>
    </el-card>

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
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTag(row.status)">{{ row.status === "online" ? "在线" : row.status === "error" ? "异常" : "离线" }}</el-tag>
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
    <el-dialog v-model="writeVisible" title="下发控制（写真实设备）" width="480px">
      <div class="form-field">
        <label>控制点位</label>
        <el-select v-model="writeForm.key" style="width: 100%">
          <el-option v-for="p in writeDevicePoints" :key="p.key" :label="`${p.label || p.key}（${p.key}）`" :value="p.key" />
        </el-select>
      </div>
      <div class="form-field"><label>目标值</label><el-input v-model="writeForm.value" placeholder="如 60" /></div>
      <template #footer>
        <el-button @click="writeVisible = false">取消</el-button>
        <el-button type="primary" @click="doWrite">下发</el-button>
      </template>
    </el-dialog>

    <!-- 实时曲线 -->
    <el-dialog v-model="chartVisible" :title="`实时曲线 · ${chartDevice?.name || ''}`" width="860px" @close="closeChart">
      <el-radio-group v-model="chartKey" size="small" style="margin-bottom: 10px" @change="renderChart">
        <el-radio-button v-for="p in chartDevice?.points || []" :key="p.key" :value="p.key">{{ p.label || p.key }}</el-radio-button>
      </el-radio-group>
      <div ref="chartEl" class="live-chart"></div>
      <p class="tip">数据来自设备真实采集（每 2 秒刷新），同一份数据也进入平台实时流供大屏/仪表盘使用。</p>
    </el-dialog>
  </div>
</template>

<style scoped>
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
