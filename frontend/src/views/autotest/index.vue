<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Delete, VideoPlay, Download, Refresh, EditPen, Top, Bottom } from "@element-plus/icons-vue";
import {
  deletePlan,
  fetchPlans,
  fetchRun,
  fetchRuns,
  reportUrl,
  runPlan,
  savePlan,
  type AutoTestPlan,
  type AutoTestRun,
  type AutoTestStep,
} from "../../api/autotest";
import type { IotDevice } from "../../api/iot";
import { iotLive, startIotLive } from "../../lowcode/iotLive";
import { useSampleStore } from "../../stores/samples";
import { useUserStore } from "../../stores/user";
import { echarts, chartOption } from "../../lowcode/charts";

startIotLive();
const sampleStore = useSampleStore();
const userStore = useUserStore();

const plans = ref<AutoTestPlan[]>([]);
const runs = ref<AutoTestRun[]>([]);
const devices = computed<IotDevice[]>(() => (iotLive.devices as IotDevice[]).filter((d) => d.protocol || d.id));

const selectedPlanId = ref("");
const selectedDeviceId = ref("");
const selectedSampleId = ref("");
const selectedPlan = computed(() => plans.value.find((p) => p.id === selectedPlanId.value));

const currentRun = ref<AutoTestRun | null>(null);
const liveSeries = ref<{ t: number; values: Record<string, number> }[]>([]);
const running = ref(false);

onMounted(async () => {
  await loadAll();
  if (devices.value.length && !selectedDeviceId.value) {
    selectedDeviceId.value = devices.value.find((d) => d.protocol && d.protocol !== "mock")?.id || devices.value[0].id;
  }
});

async function loadAll() {
  const [p, r] = await Promise.all([fetchPlans(), fetchRuns()]);
  if (p) plans.value = p.plans;
  if (r) runs.value = r.runs;
  if (!selectedPlanId.value && plans.value.length) selectedPlanId.value = plans.value[0].id;
}

// ---------------------------------------------------------------------------
// 实时事件（SSE）：进度 / 采样 / 判定
// ---------------------------------------------------------------------------
watch(
  () => iotLive.autotest,
  (ev: any) => {
    if (!ev || !currentRun.value || ev.runId !== currentRun.value.id) return;
    if (ev.line) currentRun.value.progress.push(ev.line);
    if (ev.judgment) currentRun.value.judgments.push(ev.judgment);
    if (ev.sample) {
      liveSeries.value.push({ t: ev.sample.t, values: ev.sample.values });
      renderChart();
    }
    if (ev.loop) currentRun.value.currentLoop = ev.loop;
    if (ev.status === "done") {
      running.value = false;
      currentRun.value.status = "done";
      currentRun.value.conclusion = ev.conclusion;
      ElMessage.success(ev.conclusion === "qualified" ? "自动化测试完成：合格 ✓" : "自动化测试完成：不合格 ✗");
      writeSampleRecord(ev.conclusion);
      loadAll();
    }
    if (ev.status === "failed") {
      running.value = false;
      ElMessage.error(`测试执行失败：${ev.error}`);
      loadAll();
    }
  },
  { deep: false }
);

/** 测试结论回写样品履历（4.5 联动） */
function writeSampleRecord(conclusion: string) {
  if (!selectedSampleId.value || !currentRun.value) return;
  sampleStore.recordTest(selectedSampleId.value, {
    item: `${currentRun.value.planName}（自动化）`,
    result: conclusion === "qualified" ? "合格" : "不合格",
    tester: `${userStore.name || "系统"}-自动测试`,
  });
  ElMessage.success("测试结论已写入样品履历");
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
async function startTest() {
  if (!selectedPlan.value) {
    ElMessage.warning("请先选择测试方案");
    return;
  }
  if (!selectedDeviceId.value) {
    ElMessage.warning("请选择要测试的设备（可先在「设备接入」中添加真实设备）");
    return;
  }
  const res = await runPlan(selectedPlan.value.id, selectedDeviceId.value, selectedSampleId.value);
  if (!res?.ok || !res.run) {
    ElMessage.error(res?.error || "启动失败（设备可能已有测试在执行）");
    return;
  }
  const detail = await fetchRun(res.run.id);
  if (detail) {
    currentRun.value = detail.run;
    liveSeries.value = [];
    running.value = true;
    ElMessage.success(`测试已启动：${res.run.planName} @ ${res.run.deviceName}`);
    await new Promise((r) => setTimeout(r, 80));
    renderChart();
  }
}

async function viewRun(run: AutoTestRun) {
  const detail = await fetchRun(run.id);
  if (detail) {
    currentRun.value = detail.run;
    liveSeries.value = [];
    for (const list of Object.values(detail.run.series || {})) {
      for (const s of list) liveSeries.value.push({ t: s.t, values: s.values });
    }
    liveSeries.value.sort((a, b) => a.t - b.t);
    running.value = detail.run.status === "running";
    await new Promise((r) => setTimeout(r, 80));
    renderChart();
  }
}

// ---------------------------------------------------------------------------
// 实时曲线
// ---------------------------------------------------------------------------
const chartEl = ref<HTMLDivElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
function renderChart() {
  if (!chartEl.value) return;
  if (!chart) chart = echarts.init(chartEl.value);
  const labels = liveSeries.value.map((s) => new Date(s.t).toLocaleTimeString("zh-CN", { hour12: false }));
  const keys = Array.from(new Set(liveSeries.value.flatMap((s) => Object.keys(s.values)))).slice(0, 4);
  const series = keys.map((k) => ({
    type: "line",
    smooth: true,
    name: k,
    data: liveSeries.value.map((s) => s.values[k] ?? null),
  }));
  chart.setOption(
    {
      ...chartOption("line", labels, [], "#409eff", currentRun.value ? `${currentRun.value.planName} · ${currentRun.value.deviceName}` : "自动化测试实时数据"),
      series,
      legend: { bottom: 0, textStyle: { color: "#909399" } },
    } as any,
    true
  );
}

// ---------------------------------------------------------------------------
// 方案编辑
// ---------------------------------------------------------------------------
const planVisible = ref(false);
const planForm = ref<AutoTestPlan>({ id: "", name: "", deviceId: "", loops: 1, steps: [] });

function openNewPlan() {
  planForm.value = {
    id: "",
    name: "新建测试方案",
    deviceId: selectedDeviceId.value || devices.value[0]?.id || "",
    loops: 1,
    steps: [
      { type: "write", key: "setpoint", value: 60, label: "设定温度 60℃" },
      { type: "wait", seconds: 8, label: "恒温稳定" },
      { type: "collect", key: "temperature", count: 5, interval: 1, label: "采集数据" },
      { type: "judge", key: "temperature", mode: "absDevLte", ref: 60, value: 3, label: "温度偏差 ≤ 3℃" },
    ],
  };
  planVisible.value = true;
}
function editPlan(plan: AutoTestPlan) {
  planForm.value = JSON.parse(JSON.stringify(plan));
  planVisible.value = true;
}
function addStep(type: AutoTestStep["type"]) {
  const base: Record<string, AutoTestStep> = {
    write: { type: "write", key: "setpoint", value: 60, label: "下发设定" },
    wait: { type: "wait", seconds: 5, label: "等待稳定" },
    collect: { type: "collect", key: "temperature", count: 5, interval: 1, label: "采集数据" },
    judge: { type: "judge", key: "temperature", mode: "absDevLte", ref: 60, value: 3, label: "判定" },
  };
  planForm.value.steps.push({ ...base[type] });
}
function removeStep(i: number) {
  planForm.value.steps.splice(i, 1);
}
function moveStep(i: number, dir: -1 | 1) {
  const t = i + dir;
  if (t < 0 || t >= planForm.value.steps.length) return;
  const list = planForm.value.steps;
  [list[i], list[t]] = [list[t], list[i]];
}
async function savePlanForm() {
  if (!planForm.value.name.trim()) {
    ElMessage.warning("请输入方案名称");
    return;
  }
  if (planForm.value.steps.length === 0) {
    ElMessage.warning("请至少添加一个步骤");
    return;
  }
  const res = await savePlan(planForm.value);
  if (res?.plan) {
    planVisible.value = false;
    ElMessage.success("方案已保存");
    await loadAll();
    selectedPlanId.value = res.plan.id;
  } else {
    ElMessage.error("保存失败");
  }
}
async function removePlan(plan: AutoTestPlan) {
  try {
    await ElMessageBox.confirm(`删除测试方案「${plan.name}」？`, "删除方案", { type: "warning" });
    await deletePlan(plan.id);
    ElMessage.success("已删除");
    await loadAll();
  } catch {
    /* 取消 */
  }
}

function stepSummary(s: AutoTestStep): string {
  if (s.type === "write") return `写 ${s.key} = ${s.value}`;
  if (s.type === "wait") return `等待 ${s.seconds}s`;
  if (s.type === "collect") return `采集 ${s.key} × ${s.count}（间隔 ${s.interval}s）`;
  const modeText: Record<string, string> = { absDevLte: `与 ${s.ref} 偏差 ≤ ${s.value}`, gte: `≥ ${s.value}`, lte: `≤ ${s.value}`, between: `${s.min} ~ ${s.max}` };
  return `判定 ${s.key} ${modeText[s.mode || "absDevLte"]}`;
}
function conclusionTag(run: AutoTestRun) {
  if (run.status === "running") return { text: "执行中", type: "warning" as const };
  if (run.status === "failed") return { text: "失败", type: "danger" as const };
  return run.conclusion === "qualified" ? { text: "合格", type: "success" as const } : { text: "不合格", type: "danger" as const };
}
function fmtTime(t: number): string {
  return t ? new Date(t).toLocaleString("zh-CN", { hour12: false }) : "-";
}
/** 下载测试报告（CSV） */
function openReport(id: string) {
  window.open(reportUrl(id), "_blank");
}
</script>

<template>
  <div class="autotest-page">
    <!-- 执行区 -->
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span class="panel-title">自动化测试执行</span>
          <el-tag size="small" :type="iotLive.connected ? 'success' : 'info'" effect="plain">
            {{ iotLive.connected ? "后端已连接 · 数据实时回传" : "后端未连接" }}
          </el-tag>
        </div>
      </template>
      <div class="run-bar">
        <el-select v-model="selectedPlanId" placeholder="选择测试方案" style="width: 240px">
          <el-option v-for="p in plans" :key="p.id" :label="p.name" :value="p.id" />
        </el-select>
        <el-select v-model="selectedDeviceId" placeholder="选择被测设备" style="width: 240px">
          <el-option v-for="d in devices" :key="d.id" :label="`${d.name}（${d.protocol || 'mock'}）`" :value="d.id" />
        </el-select>
        <el-select v-model="selectedSampleId" placeholder="关联样品（可选）" clearable style="width: 220px">
          <el-option
            v-for="s in sampleStore.samples"
            :key="s.id"
            :label="`${s.id} ${s.name}`"
            :value="s.id"
          />
        </el-select>
        <el-button type="primary" :icon="VideoPlay" :loading="running" @click="startTest">开始自动测试</el-button>
        <el-button :icon="Refresh" @click="loadAll">刷新</el-button>
      </div>

      <div v-if="currentRun" class="run-detail">
        <div class="run-meta">
          <el-tag size="small" :type="conclusionTag(currentRun).type">{{ conclusionTag(currentRun).text }}</el-tag>
          <span>{{ currentRun.id }} · {{ currentRun.planName }} @ {{ currentRun.deviceName }}</span>
          <span v-if="currentRun.sampleId">样品：{{ currentRun.sampleId }}</span>
          <el-button v-if="currentRun.status === 'done'" size="small" :icon="Download" @click="openReport(currentRun.id)">
            下载报告 CSV
          </el-button>
        </div>
        <div class="run-grid">
          <div class="run-chart-card">
            <div ref="chartEl" class="run-chart"></div>
          </div>
          <div class="run-side">
            <div class="side-title">执行进度（第 {{ currentRun.currentLoop }}/{{ currentRun.loops }} 轮）</div>
            <div class="progress-log">
              <div v-for="(line, i) in currentRun.progress.slice(-40)" :key="i" class="log-line">{{ line }}</div>
              <div v-if="currentRun.progress.length === 0" class="log-line muted">等待设备响应…</div>
            </div>
          </div>
        </div>
        <template v-if="currentRun.judgments.length">
          <div class="side-title" style="margin-top: 10px">判定结果</div>
          <el-table :data="currentRun.judgments" size="small" border>
            <el-table-column prop="loop" label="轮次" width="70" />
            <el-table-column prop="label" label="测试项" min-width="180" />
            <el-table-column prop="expect" label="判定要求" min-width="170" />
            <el-table-column prop="actual" label="实测" width="100" />
            <el-table-column prop="samples" label="采样点" width="90" />
            <el-table-column label="结论" width="90">
              <template #default="{ row }">
                <el-tag size="small" :type="row.pass ? 'success' : 'danger'">{{ row.pass ? "合格" : "不合格" }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </template>
      </div>
      <el-empty v-else description="选择方案与设备后点击「开始自动测试」，平台将驱动真实设备执行并回传数据" :image-size="80" />
    </el-card>

    <!-- 方案管理 -->
    <el-card shadow="never">
      <template #header>
        <div class="head">
          <span class="panel-title">测试方案（{{ plans.length }}）</span>
          <el-button size="small" type="primary" :icon="Plus" @click="openNewPlan">新建方案</el-button>
        </div>
      </template>
      <el-table :data="plans" border>
        <el-table-column prop="name" label="方案名称" min-width="180" />
        <el-table-column label="步骤" min-width="380">
          <template #default="{ row }">
            <span class="steps-text">{{ row.steps.map(stepSummary).join(" → ") }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="loops" label="循环" width="70" />
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="EditPen" @click="editPlan(row)">编辑</el-button>
            <el-button size="small" type="primary" @click="selectedPlanId = row.id; startTest()">执行</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removePlan(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 历史记录 -->
    <el-card shadow="never">
      <template #header><span class="panel-title">测试记录（最近 50 次）</span></template>
      <el-table :data="runs" border>
        <el-table-column prop="id" label="运行编号" width="150" />
        <el-table-column prop="planName" label="方案" min-width="160" />
        <el-table-column prop="deviceName" label="设备" min-width="150" />
        <el-table-column label="开始时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.startedAt) }}</template>
        </el-table-column>
        <el-table-column label="结论" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="conclusionTag(row).type">{{ conclusionTag(row).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="viewRun(row)">查看</el-button>
            <el-button size="small" :icon="Download" @click="openReport(row.id)">报告</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 方案编辑 -->
    <el-dialog v-model="planVisible" title="测试方案" width="960px" top="4vh">
      <div class="form-grid">
        <div class="form-field"><label>方案名称</label><el-input v-model="planForm.name" /></div>
        <div class="form-field">
          <label>默认设备</label>
          <el-select v-model="planForm.deviceId" style="width: 100%">
            <el-option v-for="d in devices" :key="d.id" :label="d.name" :value="d.id" />
          </el-select>
        </div>
        <div class="form-field"><label>循环次数</label><el-input-number v-model="planForm.loops" :min="1" :max="20" /></div>
      </div>

      <div class="steps-head">
        <b>测试步骤</b>
        <div class="step-buttons">
          <el-button size="small" @click="addStep('write')">+ 下发设定</el-button>
          <el-button size="small" @click="addStep('wait')">+ 等待</el-button>
          <el-button size="small" @click="addStep('collect')">+ 采集</el-button>
          <el-button size="small" @click="addStep('judge')">+ 判定</el-button>
        </div>
      </div>

      <el-table :data="planForm.steps" size="small" border>
        <el-table-column label="步骤" width="120">
          <template #default="{ row }">
            <el-select v-model="row.type" size="small">
              <el-option label="下发设定" value="write" />
              <el-option label="等待" value="wait" />
              <el-option label="采集" value="collect" />
              <el-option label="判定" value="judge" />
            </el-select>
          </template>
        </el-table-column>
        <el-table-column label="说明" width="150">
          <template #default="{ row }"><el-input v-model="row.label" size="small" /></template>
        </el-table-column>
        <el-table-column label="点位 key" width="130">
          <template #default="{ row }">
            <el-input v-if="row.type !== 'wait'" v-model="row.key" size="small" />
          </template>
        </el-table-column>
        <el-table-column label="参数" min-width="330">
          <template #default="{ row }">
            <template v-if="row.type === 'write'">
              <span class="param-label">目标值</span><el-input v-model.number="row.value" size="small" style="width: 90px" />
            </template>
            <template v-else-if="row.type === 'wait'">
              <span class="param-label">秒数</span><el-input v-model.number="row.seconds" size="small" style="width: 80px" />
            </template>
            <template v-else-if="row.type === 'collect'">
              <span class="param-label">次数</span><el-input v-model.number="row.count" size="small" style="width: 70px" />
              <span class="param-label">间隔s</span><el-input v-model.number="row.interval" size="small" style="width: 70px" />
            </template>
            <template v-else>
              <el-select v-model="row.mode" size="small" style="width: 150px">
                <el-option label="偏差不超过" value="absDevLte" />
                <el-option label="不小于" value="gte" />
                <el-option label="不大于" value="lte" />
                <el-option label="区间内" value="between" />
              </el-select>
              <template v-if="row.mode === 'absDevLte'">
                <span class="param-label">基准</span><el-input v-model.number="row.ref" size="small" style="width: 70px" />
                <span class="param-label">±</span><el-input v-model.number="row.value" size="small" style="width: 70px" />
              </template>
              <template v-else-if="row.mode === 'between'">
                <span class="param-label">最小</span><el-input v-model.number="row.min" size="small" style="width: 70px" />
                <span class="param-label">最大</span><el-input v-model.number="row.max" size="small" style="width: 70px" />
              </template>
              <template v-else>
                <span class="param-label">阈值</span><el-input v-model.number="row.value" size="small" style="width: 80px" />
              </template>
              <el-select v-model="row.agg" size="small" style="width: 100px; margin-left: 6px" placeholder="均值">
                <el-option label="均值" value="avg" />
                <el-option label="最大值" value="max" />
                <el-option label="最小值" value="min" />
                <el-option label="末值" value="last" />
              </el-select>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="" width="120">
          <template #default="{ $index }">
            <el-button size="small" text :icon="Top" @click="moveStep($index, -1)" />
            <el-button size="small" text :icon="Bottom" @click="moveStep($index, 1)" />
            <el-button size="small" text type="danger" :icon="Delete" @click="removeStep($index)" />
          </template>
        </el-table-column>
      </el-table>

      <template #footer>
        <el-button @click="planVisible = false">取消</el-button>
        <el-button type="primary" @click="savePlanForm">保存方案</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.autotest-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.head,
.steps-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-weight: 600;
  color: #1f2d3d;
}
.run-bar {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}
.run-detail {
  margin-top: 14px;
}
.run-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #606266;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.run-grid {
  display: grid;
  grid-template-columns: 1fr 420px;
  gap: 12px;
}
@media (max-width: 1200px) {
  .run-grid {
    grid-template-columns: 1fr;
  }
}
.run-chart-card {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 6px;
}
.run-chart {
  width: 100%;
  height: 300px;
}
.run-side {
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 8px;
  display: flex;
  flex-direction: column;
}
.side-title {
  font-weight: 600;
  color: #1f2d3d;
  font-size: 13px;
  margin-bottom: 6px;
}
.progress-log {
  flex: 1;
  max-height: 270px;
  overflow-y: auto;
  background: #0f172a;
  border-radius: 4px;
  padding: 8px;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
}
.log-line {
  color: #9fd7ff;
  white-space: pre-wrap;
  word-break: break-all;
}
.log-line.muted {
  color: #7a8aa3;
}
.steps-text {
  font-size: 12px;
  color: #606266;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr 200px;
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
.step-buttons {
  display: flex;
  gap: 8px;
}
.param-label {
  color: #909399;
  font-size: 12px;
  margin: 0 4px 0 8px;
}
</style>
