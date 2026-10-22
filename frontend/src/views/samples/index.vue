<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, DataAnalysis, Compass } from "@element-plus/icons-vue";
import {
  useSampleStore,
  SAMPLE_STATUS_LABELS,
  fmt,
  type Sample,
  type SampleStatus,
} from "../../stores/samples";
import ReportBlockView from "../../lowcode/ReportBlockView.vue";

const store = useSampleStore();

// 从后端加载样品台账（此前只存 localStorage，换设备会丢）
onMounted(() => {
  void store.loadFromServer();
});

/** 测试合格率（基于结构化判定，历史文本自动推断） */
const passStats = computed(() => store.passRate());

// ---------------------------------------------------------------------------
// 编辑样品
// ---------------------------------------------------------------------------
const editVisible = ref(false);
const editForm = reactive({ id: "", name: "", type: "", batch: "", location: "", owner: "", note: "" });

function openEdit(row: any) {
  Object.assign(editForm, {
    id: row.id,
    name: row.name,
    type: row.type,
    batch: row.batch,
    location: row.location,
    owner: row.owner,
    note: row.note || "",
  });
  editVisible.value = true;
}

function saveEdit() {
  if (!editForm.name.trim()) {
    ElMessage.warning("样品名称不能为空");
    return;
  }
  const ok = store.updateSample(editForm.id, {
    name: editForm.name.trim(),
    type: editForm.type,
    batch: editForm.batch,
    location: editForm.location,
    owner: editForm.owner,
    note: editForm.note,
  });
  editVisible.value = false;
  ElMessage.success(ok ? "样品信息已更新" : "更新失败");
}

// ---------------------------------------------------------------------------
// 删除样品
// ---------------------------------------------------------------------------
async function doRemove(row: any) {
  try {
    await ElMessageBox.confirm(
      `确定删除样品「${row.name}」（${row.id}）？\n\n注意：已有测试记录的样品属于质量档案，不允许删除。`,
      "删除样品",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const r = store.removeSample(row.id);
  if (r.ok) ElMessage.success("已删除");
  else ElMessage.error(r.reason || "删除失败");
}
const keyword = ref("");
const statusFilter = ref<SampleStatus | "all">("all");

const filtered = computed(() =>
  store.samples.filter(
    (s) =>
      (statusFilter.value === "all" || s.status === statusFilter.value) &&
      (!keyword.value.trim() || s.id.toLowerCase().includes(keyword.value.trim().toLowerCase()) || s.name.includes(keyword.value.trim()))
  )
);

// ---------------------------------------------------------------------------
// 新增入库
// ---------------------------------------------------------------------------
const addDialog = ref(false);
const addForm = ref({ name: "", type: "金属", batch: "", location: "", owner: "" });
const sampleTypes = ["金属", "电子", "高分子", "化工", "复合材料", "涂层", "其他"];
function openAdd() {
  addForm.value = { name: "", type: "金属", batch: `B-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`, location: "A区-1号柜", owner: "" };
  addDialog.value = true;
}
function saveAdd() {
  if (!addForm.value.name.trim() || !addForm.value.owner.trim()) {
    ElMessage.warning("请填写样品名称与责任人");
    return;
  }
  store.addSample(addForm.value);
  addDialog.value = false;
  ElMessage.success("样品已入库");
}

// ---------------------------------------------------------------------------
// 测试记录 / 出库 / 报废
// ---------------------------------------------------------------------------
const testDialog = ref(false);
const testingSample = ref<Sample | null>(null);
const testForm = ref({ item: "", result: "", tester: "" });
function openTest(s: Sample) {
  testingSample.value = s;
  testForm.value = { item: "", result: "合格", tester: "检测员-赵工" };
  testDialog.value = true;
}
function saveTest() {
  if (!testingSample.value || !testForm.value.item.trim()) {
    ElMessage.warning("请填写测试项");
    return;
  }
  if (!store.recordTest(testingSample.value.id, testForm.value)) {
    ElMessage.error("该样品已出库或已报废，不能继续记录测试");
    return;
  }
  testDialog.value = false;
  ElMessage.success("测试记录已写入履历");
}
function finishTest(s: Sample) {
  if (!store.finishTest(s.id)) {
    ElMessage.error("当前状态不允许标记完成（已出库/已报废）");
    return;
  }
  ElMessage.success("样品已完成全部测试");
}
async function doOutbound(s: Sample) {
  try {
    const { value } = await ElMessageBox.prompt("出库去向/领用人", "样品出库", { inputValue: "项目组A-李工" });
    if (!store.outbound(s.id, value || "库管-王工")) {
      ElMessage.error("当前状态不允许出库（仅「已完成」样品可出库）");
      return;
    }
    ElMessage.success("已出库，履历已更新");
  } catch {
    /* 取消 */
  }
}
async function doScrap(s: Sample) {
  try {
    const { value } = await ElMessageBox.prompt("报废原因", "样品报废", { inputValue: "复测不合格" });
    if (!store.scrap(s.id, value || "复测不合格")) {
      ElMessage.error("该样品已是终态（已出库/已报废）");
      return;
    }
    ElMessage.success("已报废，履历已更新");
  } catch {
    /* 取消 */
  }
}

// ---------------------------------------------------------------------------
// 履历
// ---------------------------------------------------------------------------
const detailDrawer = ref(false);
const detailSample = ref<Sample | null>(null);
function openDetail(s: Sample) {
  detailSample.value = store.trace(s.id);
  detailDrawer.value = true;
}

// ---------------------------------------------------------------------------
// 溯源
// ---------------------------------------------------------------------------
const traceDialog = ref(false);
const traceId = ref("");
const traceResult = ref<Sample | null>(null);
function runTrace() {
  const s = store.trace(traceId.value);
  traceResult.value = s;
  if (!s) ElMessage.warning(`未找到样品 ${traceId.value}`);
}

// ---------------------------------------------------------------------------
// 统计报表（台账报表快速配置，4.5）
// ---------------------------------------------------------------------------
const reportVisible = ref(false);
const reportRows = computed(() => {
  const byStatus: Record<string, number> = { 在库待测: 0, 测试中: 0, 测试完成: 0, 已出库: 0, 已报废: 0 };
  const byMonth: Record<string, number> = {};
  for (const s of store.samples) {
    byStatus[SAMPLE_STATUS_LABELS[s.status].text] += 1;
    const m = `${new Date(s.inDate).getMonth() + 1}月`;
    byMonth[m] = (byMonth[m] || 0) + 1;
  }
  const ds = {
    fields: [
      { name: "状态", label: "状态", type: "string" as const },
      { name: "数量", label: "数量", type: "number" as const },
      { name: "月份", label: "月份", type: "string" as const },
    ],
    rows: [
      ...Object.entries(byStatus).map(([状态, 数量]) => ({ 状态, 数量 })),
      ...Object.entries(byMonth).map(([月份, 数量]) => ({ 月份, 数量 })),
    ],
  };
  return ds;
});
const reportBlocks = [
  { id: "r1", kind: "pie" as const, title: "样品状态分布", xField: "状态", yField: "数量", agg: "sum" as const, color: "#409eff" },
  { id: "r2", kind: "bar" as const, title: "月度入库趋势", xField: "月份", yField: "数量", agg: "sum" as const, color: "#67c23a" },
];

function cloneRows() {
  return reportRows.value.rows;
}
</script>

<template>
  <div class="samples">
    <!-- 数据同步状态 -->
    <div class="sync-row">
      <el-tag v-if="store.backendOnline === true" type="success" size="small" effect="plain">已同步到数据库</el-tag>
      <el-tag v-else-if="store.backendOnline === false" type="warning" size="small" effect="plain">
        仅本地保存（{{ store.lastSyncError || "后端不可达" }}）
      </el-tag>
      <el-tag v-else type="info" size="small" effect="plain">加载中…</el-tag>
      <span class="pass-rate" v-if="passStats.total">
        测试合格率 <b>{{ passStats.rate }}%</b>
        <span class="muted">（合格 {{ passStats.pass }} / 不合格 {{ passStats.fail }}<template v-if="passStats.pending"> / 待复检 {{ passStats.pending }}</template>）</span>
      </span>
    </div>

    <!-- 统计卡 -->
    <div class="stat-cards">
      <div v-for="(st, key) in SAMPLE_STATUS_LABELS" :key="key" class="stat-card" :class="{ active: statusFilter === key }" @click="statusFilter = statusFilter === key ? 'all' : key">
        <div class="stat-num">{{ store.counts[key as SampleStatus] }}</div>
        <div class="stat-label">{{ st.text }}</div>
      </div>
    </div>

    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="openAdd">样品入库</el-button>
      <el-button :icon="Compass" @click="traceDialog = true">溯源查询</el-button>
      <el-button :icon="DataAnalysis" @click="reportVisible = true">统计报表</el-button>
      <el-select v-model="statusFilter" size="default" style="width: 160px">
        <el-option label="全部状态" value="all" />
        <el-option v-for="(st, key) in SAMPLE_STATUS_LABELS" :key="key" :label="st.text" :value="key" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索编号/名称" :prefix-icon="Search" style="width: 240px" clearable />
    </div>

    <el-table :data="filtered" border style="width: 100%">
      <el-table-column prop="id" label="样品编号" width="120" />
      <el-table-column prop="name" label="名称" min-width="150" />
      <el-table-column prop="type" label="类型" width="100" />
      <el-table-column prop="batch" label="批次" width="100" />
      <el-table-column label="入库时间" width="150">
        <template #default="{ row }">{{ fmt(row.inDate) }}</template>
      </el-table-column>
      <el-table-column prop="location" label="库位" width="110" />
      <el-table-column prop="owner" label="责任人" width="110" />
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <el-tag size="small" :type="SAMPLE_STATUS_LABELS[row.status as SampleStatus].type">{{ SAMPLE_STATUS_LABELS[row.status as SampleStatus].text }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="360" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" @click="openDetail(row)">履历</el-button>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.status === 'in'" size="small" text type="warning" @click="openTest(row)">开始测试</el-button>
          <el-button v-if="row.status === 'testing'" size="small" text type="warning" @click="openTest(row)">加测</el-button>
          <el-button v-if="row.status === 'testing'" size="small" text type="success" @click="finishTest(row)">完成</el-button>
          <el-button v-if="['in', 'testing', 'done'].includes(row.status)" size="small" text type="primary" @click="doOutbound(row)">出库</el-button>
          <el-button v-if="['in', 'testing'].includes(row.status)" size="small" text type="danger" @click="doScrap(row)">报废</el-button>
          <el-button v-if="row.status === 'in' && !row.tests.length" size="small" text type="danger" @click="doRemove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 入库 -->
    <!-- 编辑样品 -->
    <el-dialog v-model="editVisible" title="编辑样品信息" width="520px">
      <div class="form-field"><label>样品编号</label><el-input v-model="editForm.id" disabled /></div>
      <div class="form-field"><label>名称</label><el-input v-model="editForm.name" /></div>
      <div class="form-field"><label>类型</label><el-input v-model="editForm.type" /></div>
      <div class="form-field"><label>批次</label><el-input v-model="editForm.batch" /></div>
      <div class="form-field"><label>库位</label><el-input v-model="editForm.location" /></div>
      <div class="form-field"><label>负责人</label><el-input v-model="editForm.owner" /></div>
      <div class="form-field"><label>备注</label><el-input v-model="editForm.note" type="textarea" :rows="2" /></div>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="addDialog" title="样品入库登记" width="520px">
      <div class="form-field"><label>样品名称</label><el-input v-model="addForm.name" placeholder="如：铝合金拉伸试样" /></div>
      <div class="form-field">
        <label>样品类型</label>
        <el-select v-model="addForm.type" style="width: 100%">
          <el-option v-for="t in sampleTypes" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="form-field"><label>批次</label><el-input v-model="addForm.batch" /></div>
      <div class="form-field"><label>库位</label><el-input v-model="addForm.location" /></div>
      <div class="form-field"><label>责任人</label><el-input v-model="addForm.owner" /></div>
      <template #footer>
        <el-button @click="addDialog = false">取消</el-button>
        <el-button type="primary" @click="saveAdd">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 测试记录 -->
    <el-dialog v-model="testDialog" title="测试记录（写入履历）" width="520px">
      <p class="hint" v-if="testingSample">样品：{{ testingSample.id }} · {{ testingSample.name }}</p>
      <div class="form-field"><label>测试项</label><el-input v-model="testForm.item" placeholder="如：抗拉强度" /></div>
      <div class="form-field"><label>结果</label><el-input v-model="testForm.result" placeholder="合格 / 不合格 / 待复核" /></div>
      <div class="form-field"><label>测试人</label><el-input v-model="testForm.tester" /></div>
      <template #footer>
        <el-button @click="testDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTest">保存记录</el-button>
      </template>
    </el-dialog>

    <!-- 履历抽屉 -->
    <el-drawer v-model="detailDrawer" title="样品履历" size="560px">
      <template v-if="detailSample">
        <div class="detail-head">
          <h3>{{ detailSample.id }} · {{ detailSample.name }}</h3>
          <el-tag size="small" :type="SAMPLE_STATUS_LABELS[detailSample.status].type">{{ SAMPLE_STATUS_LABELS[detailSample.status].text }}</el-tag>
        </div>
        <template v-if="detailSample.tests.length">
          <h4 class="detail-title">测试记录</h4>
          <el-table :data="detailSample.tests" size="small" border>
            <el-table-column label="时间" width="170">
              <template #default="{ row }">{{ fmt(row.time) }}</template>
            </el-table-column>
            <el-table-column prop="item" label="测试项" />
            <el-table-column prop="result" label="结果" />
            <el-table-column prop="tester" label="测试人" width="110" />
          </el-table>
        </template>
        <h4 class="detail-title">全流程履历</h4>
        <el-timeline>
          <el-timeline-item v-for="(log, i) in [...detailSample.logs].reverse()" :key="i" :timestamp="fmt(log.time)" :type="log.action === '报废' ? 'danger' : log.action === '出库' ? 'warning' : 'primary'">
            <b>{{ log.action }}</b>（{{ log.by }}） — {{ log.desc }}
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-drawer>

    <!-- 溯源 -->
    <el-dialog v-model="traceDialog" title="样品溯源查询" width="640px">
      <div class="trace-bar">
        <el-input v-model="traceId" placeholder="输入样品编号，如 SMP-1001" :prefix-icon="Search" @keyup.enter="runTrace" />
        <el-button type="primary" :icon="Compass" @click="runTrace">溯源</el-button>
      </div>
      <template v-if="traceResult">
        <div class="detail-head">
          <h3>{{ traceResult.id }} · {{ traceResult.name }}</h3>
          <el-tag size="small" :type="SAMPLE_STATUS_LABELS[traceResult.status].type">{{ SAMPLE_STATUS_LABELS[traceResult.status].text }}</el-tag>
        </div>
        <p class="hint">批次 {{ traceResult.batch }} · 库位 {{ traceResult.location }} · 责任人 {{ traceResult.owner }}</p>
        <el-timeline>
          <el-timeline-item v-for="(log, i) in [...traceResult.logs].reverse()" :key="i" :timestamp="fmt(log.time)">
            <b>{{ log.action }}</b>（{{ log.by }}） — {{ log.desc }}
          </el-timeline-item>
        </el-timeline>
      </template>
      <el-empty v-else description="输入编号查询全链路履历" :image-size="70" />
    </el-dialog>

    <!-- 统计报表 -->
    <el-dialog v-model="reportVisible" title="样品台账统计报表" width="960px" top="6vh">
      <div class="report-grid">
        <div v-for="b in reportBlocks" :key="b.id" class="report-cell">
          <ReportBlockView :block="b" :rows="cloneRows()" :fields="reportRows.fields" />
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.sync-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}
.pass-rate {
  font-size: 13px;
  color: #606266;
}
.pass-rate b {
  color: #67c23a;
  font-size: 15px;
}
.pass-rate .muted {
  color: #909399;
  font-size: 12px;
}
.samples {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 10px;
}
.stat-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 16px;
  text-align: center;
  cursor: pointer;
  transition: all 0.15s;
}
.stat-card:hover,
.stat-card.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.stat-num {
  font-size: 24px;
  font-weight: 700;
  color: #1f2d3d;
}
.stat-label {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.form-field {
  margin-bottom: 14px;
}
.form-field label {
  display: block;
  margin-bottom: 6px;
  color: #606266;
}
.hint {
  font-size: 13px;
  color: #606266;
  margin: 0 0 10px;
}
.detail-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
}
.detail-head h3 {
  margin: 0;
  color: #1f2d3d;
}
.detail-title {
  color: #1f2d3d;
  margin: 14px 0 8px;
}
.trace-bar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.report-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.report-cell {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  height: 320px;
  padding: 8px;
}
</style>
