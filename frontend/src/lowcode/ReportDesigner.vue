<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  Download,
  Delete,
  CopyDocument,
  View,
  Plus,
  Top,
  Bottom,
  Collection,
  DataAnalysis,
  Promotion,
} from "@element-plus/icons-vue";
import { useLowcodeStore } from "./store";
import { defaultReportSchema } from "./defaults";
import PublishDialog from "./PublishDialog.vue";
import type { PublishedApp } from "./publish";
import {
  REPORT_BLOCK_LABELS,
  REPORT_AGG_LABELS,
  type ReportBlock,
  type ReportBlockKind,
  type ReportSchema,
} from "./reportTypes";
import { clone, uid } from "./schemaOps";
import ReportBlockView from "./ReportBlockView.vue";

const store = useLowcodeStore();

// 从「应用中心 · 重新设计」进入时，父级传入该应用的真实 Schema（修复：原先永远加载内置示例）
const props = defineProps<{ schema?: ReportSchema | null }>();
const report = ref<ReportSchema>(clone(props.schema || store.projects.report || defaultReportSchema()));
const selectedId = ref("");
const selectedBlock = computed<ReportBlock | undefined>(() =>
  report.value.blocks.find((b) => b.id === selectedId.value)
);

// ---------------------------------------------------------------------------
// 区块组件面板
// ---------------------------------------------------------------------------
const BLOCKS: { kind: ReportBlockKind; label: string; icon: string }[] = [
  { kind: "metric", label: "指标卡", icon: "Odometer" },
  { kind: "bar", label: "柱状图", icon: "Histogram" },
  { kind: "line", label: "折线图", icon: "TrendCharts" },
  { kind: "pie", label: "饼图", icon: "PieChart" },
  { kind: "table", label: "明细表", icon: "Tickets" },
];

function addBlock(kind: ReportBlockKind) {
  const block: ReportBlock = {
    id: uid("b"),
    kind,
    title: REPORT_BLOCK_LABELS[kind],
    color: "#409eff",
  };
  if (kind === "metric") {
    block.metricField = report.value.dataset.fields.find((f) => f.type === "number")?.name;
    block.metricLabel = "统计值";
    block.agg = "sum";
  } else if (kind === "table") {
    block.columns = report.value.dataset.fields.map((f) => f.name);
  } else {
    block.xField = report.value.dataset.fields.find((f) => f.type === "string")?.name;
    block.yField = report.value.dataset.fields.find((f) => f.type === "number")?.name;
    block.agg = "sum";
  }
  report.value.blocks.push(block);
  selectedId.value = block.id;
}

// ---------------------------------------------------------------------------
// 区块操作
// ---------------------------------------------------------------------------
function removeBlock(id: string) {
  report.value.blocks = report.value.blocks.filter((b) => b.id !== id);
  if (selectedId.value === id) selectedId.value = "";
}
function duplicateBlock(block: ReportBlock) {
  const copy = clone(block);
  copy.id = uid("b");
  const list = report.value.blocks.slice();
  list.splice(list.findIndex((b) => b.id === block.id) + 1, 0, copy);
  report.value.blocks = list;
  selectedId.value = copy.id;
}
function moveBlock(id: string, dir: -1 | 1) {
  const list = report.value.blocks.slice();
  const idx = list.findIndex((b) => b.id === id);
  const t = idx + dir;
  if (idx < 0 || t < 0 || t >= list.length) return;
  const [item] = list.splice(idx, 1);
  list.splice(t, 0, item);
  report.value.blocks = list;
}

// ---------------------------------------------------------------------------
// 区块属性绑定
// ---------------------------------------------------------------------------
function blockBind<K extends keyof ReportBlock>(key: K) {
  return computed<any>({
    get: () => selectedBlock.value?.[key],
    set: (v) => {
      if (selectedBlock.value) (selectedBlock.value as any)[key] = v;
    },
  });
}
const bTitle = blockBind("title");
const bX = blockBind("xField");
const bY = blockBind("yField");
const bAgg = blockBind("agg");
const bColor = blockBind("color");
const bMetricField = blockBind("metricField");
const bMetricLabel = blockBind("metricLabel");
const bColumns = blockBind("columns");

const stringFields = computed(() => report.value.dataset.fields.filter((f) => f.type === "string"));
const numberFields = computed(() => report.value.dataset.fields.filter((f) => f.type === "number"));

// ---------------------------------------------------------------------------
// 数据集
// ---------------------------------------------------------------------------
const datasetName = computed<string>({
  get: () => report.value.dataset.name,
  set: (v) => (report.value.dataset.name = v),
});
const reportName = computed<string>({
  get: () => report.value.name,
  set: (v) => (report.value.name = v),
});

/** 新增字段 */
const newFieldName = ref("");
const newFieldLabel = ref("");
const newFieldType = ref<"string" | "number">("string");
function addField() {
  const name = newFieldName.value.trim();
  if (!name) {
    ElMessage.warning("请输入字段英文名");
    return;
  }
  if (report.value.dataset.fields.some((f) => f.name === name)) {
    ElMessage.warning("字段已存在");
    return;
  }
  report.value.dataset.fields.push({
    name,
    label: newFieldLabel.value.trim() || name,
    type: newFieldType.value,
  });
  report.value.dataset.rows.forEach((r) => (r[name] = newFieldType.value === "number" ? 0 : ""));
  newFieldName.value = "";
  newFieldLabel.value = "";
}
function removeField(name: string) {
  report.value.dataset.fields = report.value.dataset.fields.filter((f) => f.name !== name);
  report.value.dataset.rows.forEach((r) => delete r[name]);
}

/** 数据行编辑 */
const dataDialog = ref(false);
function openDataDialog() {
  dataDialog.value = true;
  if (report.value.dataset.rows.length === 0 && report.value.dataset.fields.length) addRow();
}
function addRow() {
  const row: Record<string, any> = {};
  report.value.dataset.fields.forEach((f) => (row[f.name] = f.type === "number" ? 0 : ""));
  report.value.dataset.rows.push(row);
}
function removeRow(i: number) {
  report.value.dataset.rows.splice(i, 1);
}
function editCell(row: Record<string, any>, name: string, v: any) {
  row[name] = v;
}

// ---------------------------------------------------------------------------
// 导出 / 预览 / 自动保存
// ---------------------------------------------------------------------------
const previewVisible = ref(false);
function openPreview() {
  previewVisible.value = true;
}
function exportJson() {
  const blob = new Blob([JSON.stringify(report.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "report-schema.json";
  a.click();
  URL.revokeObjectURL(url);
}

const savedAt = ref("");
let saveTimer: number | undefined;
watch(
  report,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.saveProject("report", clone(report.value));
      savedAt.value = new Date().toLocaleTimeString();
    }, 800);
  },
  { deep: true }
);

function resetExample() {
  report.value = { ...clone(defaultReportSchema()), id: uid("report") };
  selectedId.value = "";
  ElMessage.success("已恢复示例报表");
}
function createNew() {
  report.value = {
    id: uid("report"),
    name: "未命名报表",
    dataset: {
      id: uid("ds"),
      name: "未命名数据集",
      fields: [
        { name: "维度", label: "维度", type: "string" },
        { name: "指标", label: "指标", type: "number" },
      ],
      rows: [],
    },
    blocks: [],
  };
  selectedId.value = "";
}

// 发布（生成应用 → 应用中心 → 可挂载菜单运行）
const publishVisible = ref(false);
function onPublished(app: PublishedApp) {
  ElMessage.success(`已发布「${app.name}」，可在「应用中心」打开运行${app.menu ? "并已挂载到左侧菜单" : ""}`);
}
</script>

<template>
  <div class="report-designer">
    <!-- 左：数据集 & 组件 -->
    <aside class="side side-left">
      <div class="side-title">
        <el-icon><Collection /></el-icon>
        <span>数据集</span>
        <el-button size="small" text type="primary" @click="openDataDialog">编辑数据</el-button>
      </div>
      <el-input v-model="datasetName" size="small" placeholder="数据集名称" />
      <div class="field-list">
        <div v-for="f in report.dataset.fields" :key="f.name" class="field-chip">
          <span class="fc-name">{{ f.label }}</span>
          <el-tag size="small" :type="f.type === 'number' ? 'success' : 'info'" effect="plain" class="fc-type">
            {{ f.type === "number" ? "数字" : "文本" }}
          </el-tag>
          <el-button size="small" text type="danger" @click="removeField(f.name)">×</el-button>
        </div>
        <el-empty v-if="report.dataset.fields.length === 0" description="暂无字段" :image-size="50" />
      </div>

      <div class="new-field">
        <div class="new-field-grid">
          <el-input v-model="newFieldName" size="small" placeholder="字段名(英)" />
          <el-input v-model="newFieldLabel" size="small" placeholder="显示名" />
          <el-select v-model="newFieldType" size="small">
            <el-option label="文本" value="string" />
            <el-option label="数字" value="number" />
          </el-select>
          <el-button size="small" :icon="Plus" @click="addField" />
        </div>
      </div>

      <el-divider />

      <div class="side-title">
        <el-icon><DataAnalysis /></el-icon>
        <span>报表组件</span>
      </div>
      <div
        v-for="b in BLOCKS"
        :key="b.kind"
        class="palette-item"
        @click="addBlock(b.kind)"
      >
        <el-icon><component :is="b.icon" /></el-icon>
        <span>{{ b.label }}</span>
      </div>
    </aside>

    <!-- 中：报表画布 -->
    <section class="side side-center">
      <div class="center-toolbar">
        <div class="toolbar-group">
          <el-button size="small" type="primary" :icon="Promotion" @click="publishVisible = true">发布</el-button>
          <el-button size="small" :icon="View" @click="openPreview">预览</el-button>
          <el-button size="small" :icon="Download" @click="exportJson">导出 JSON</el-button>
          <el-button size="small" @click="createNew">新建</el-button>
          <el-button size="small" @click="resetExample">示例</el-button>
        </div>
        <span class="stats">共 {{ report.blocks.length }} 个区块 · {{ report.dataset.rows.length }} 行数据</span>
      </div>

      <div class="canvas-scroll" @click="selectedId = ''">
        <div class="report-paper">
          <h2 class="report-title">{{ report.name }}</h2>
          <div
            v-for="b in report.blocks"
            :key="b.id"
            class="report-block"
            :class="{ selected: b.id === selectedId }"
            @click.stop="selectedId = b.id"
          >
            <div class="block-head">
              <el-tag size="small" type="primary" effect="plain">{{ REPORT_BLOCK_LABELS[b.kind] }}</el-tag>
              <el-input v-model="b.title" size="small" class="block-title-input" placeholder="区块标题" />
              <div class="block-ops" @click.stop>
                <el-tooltip content="上移">
                  <el-button size="small" text :icon="Top" @click="moveBlock(b.id, -1)" />
                </el-tooltip>
                <el-tooltip content="下移">
                  <el-button size="small" text :icon="Bottom" @click="moveBlock(b.id, 1)" />
                </el-tooltip>
                <el-tooltip content="复制">
                  <el-button size="small" text :icon="CopyDocument" @click="duplicateBlock(b)" />
                </el-tooltip>
                <el-tooltip content="删除">
                  <el-button size="small" text type="danger" :icon="Delete" @click="removeBlock(b.id)" />
                </el-tooltip>
              </div>
            </div>
            <div class="block-body" :style="{ height: b.kind === 'metric' ? '110px' : b.kind === 'table' ? 'auto' : '300px' }">
              <ReportBlockView :block="b" :rows="report.dataset.rows" :fields="report.dataset.fields" />
            </div>
            <div v-if="b.kind !== 'table' && !(b.xField && b.yField) && !b.metricField" class="block-hint">
              请在右侧配置维度与指标字段
            </div>
          </div>
          <el-empty v-if="report.blocks.length === 0" description="从左侧添加指标卡/图表/明细表开始设计" :image-size="110" />
        </div>
      </div>

      <div class="center-footer">
        <span>数据集：{{ report.dataset.name }}（{{ report.dataset.fields.length }} 字段）</span>
        <span v-if="savedAt">已自动保存 {{ savedAt }}</span>
      </div>
    </section>

    <!-- 右：配置 -->
    <aside class="side side-right">
      <div class="side-title">配置</div>
      <template v-if="selectedBlock">
        <div class="field">
          <label>区块标题</label>
          <el-input v-model="bTitle" />
        </div>
        <div v-if="selectedBlock.kind !== 'table'" class="field">
          <label>区块颜色</label>
          <el-color-picker v-model="bColor" />
        </div>

        <template v-if="selectedBlock.kind === 'metric'">
          <div class="field">
            <label>指标字段</label>
            <el-select v-model="bMetricField">
              <el-option v-for="f in numberFields" :key="f.name" :label="f.label" :value="f.name" />
            </el-select>
          </div>
          <div class="field">
            <label>指标名称</label>
            <el-input v-model="bMetricLabel" />
          </div>
          <div class="field">
            <label>聚合方式</label>
            <el-select v-model="bAgg">
              <el-option v-for="(label, key) in REPORT_AGG_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
          </div>
        </template>

        <template v-else-if="selectedBlock.kind !== 'table'">
          <div class="field">
            <label>维度字段 (X)</label>
            <el-select v-model="bX" clearable>
              <el-option v-for="f in stringFields" :key="f.name" :label="f.label" :value="f.name" />
            </el-select>
          </div>
          <div class="field">
            <label>指标字段 (Y)</label>
            <el-select v-model="bY" clearable>
              <el-option v-for="f in numberFields" :key="f.name" :label="f.label" :value="f.name" />
            </el-select>
          </div>
          <div class="field">
            <label>聚合方式</label>
            <el-select v-model="bAgg">
              <el-option v-for="(label, key) in REPORT_AGG_LABELS" :key="key" :label="label" :value="key" />
            </el-select>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label>显示列（多选）</label>
            <el-select v-model="bColumns" multiple>
              <el-option v-for="f in report.dataset.fields" :key="f.name" :label="f.label" :value="f.name" />
            </el-select>
          </div>
        </template>
      </template>

      <template v-else>
        <div class="field">
          <label>报表名称</label>
          <el-input v-model="reportName" />
        </div>
        <div class="field">
          <label>数据集名称</label>
          <el-input v-model="datasetName" />
        </div>
        <p class="hint">
          选中画布中的区块编辑其维度、指标与聚合方式；点击左上「编辑数据」维护数据集明细，支持对接后端数据源接口。
        </p>
      </template>
    </aside>

    <!-- 数据编辑对话框 -->
    <el-dialog v-model="dataDialog" title="数据明细编辑" width="920px" top="4vh">
      <el-table :data="report.dataset.rows" size="small" border>
        <el-table-column v-for="f in report.dataset.fields" :key="f.name" :label="f.label" min-width="120">
          <template #default="{ row }">
            <el-input
              size="small"
              :model-value="row[f.name]"
              @input="editCell(row, f.name, $event)"
            />
          </template>
        </el-table-column>
        <el-table-column label="" width="60">
          <template #default="{ $index }">
            <el-button size="small" text type="danger" @click="removeRow($index)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button :icon="Plus" @click="addRow">添加行</el-button>
        <el-button type="primary" @click="dataDialog = false">完成</el-button>
      </template>
    </el-dialog>

    <!-- 预览 -->
    <el-dialog v-model="previewVisible" title="报表预览" width="1100px" top="4vh">
      <div class="report-paper preview-paper">
        <h2 class="report-title">{{ report.name }}</h2>
        <div v-for="b in report.blocks" :key="b.id" class="report-block preview-block">
          <div class="block-body" :style="{ height: b.kind === 'metric' ? '110px' : b.kind === 'table' ? 'auto' : '300px' }">
            <ReportBlockView :block="b" :rows="report.dataset.rows" :fields="report.dataset.fields" />
          </div>
        </div>
      </div>
    </el-dialog>

    <!-- 发布对话框 -->
    <PublishDialog
      v-model="publishVisible"
      kind="report"
      :schema="report"
      :default-name="report.name || '报表应用'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.report-designer {
  display: flex;
  gap: 12px;
  height: calc(100vh - 132px);
  min-height: 480px;
}
.side {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-left {
  width: 260px;
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}
.side-right {
  width: 300px;
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}
.side-center {
  flex: 1;
  min-width: 360px;
}
.side-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1f2d3d;
  margin-bottom: 8px;
  justify-content: space-between;
}
.field-list {
  margin-top: 10px;
}
.field-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  background: #f5f7fa;
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 13px;
}
.fc-name {
  flex: 1;
  color: #303133;
}
.new-field-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
  margin-top: 10px;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 6px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  cursor: pointer;
  transition: all 0.15s;
  user-select: none;
}
.palette-item:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
.center-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.toolbar-group {
  display: flex;
  gap: 6px;
}
.stats {
  font-size: 12px;
  color: #909399;
}
.canvas-scroll {
  flex: 1;
  overflow: auto;
  background: #e8ebf0;
  padding: 20px;
}
.report-paper {
  max-width: 900px;
  margin: 0 auto;
  background: #fff;
  border-radius: 8px;
  padding: 20px 24px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.report-title {
  text-align: center;
  margin: 0 0 16px;
  color: #1f2d3d;
}
.report-block {
  border: 1px dashed transparent;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 12px;
  transition: all 0.15s;
}
.report-block:hover {
  border-color: #a0cfff;
}
.report-block.selected {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.03);
}
.block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.block-title-input {
  width: 220px;
}
.block-ops {
  margin-left: auto;
  display: none;
}
.report-block:hover .block-ops,
.report-block.selected .block-ops {
  display: flex;
}
.block-body {
  width: 100%;
}
.block-hint {
  text-align: center;
  color: #c0c4cc;
  font-size: 12px;
  padding: 4px 0 8px;
}
.center-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #ebeef5;
}
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  margin-bottom: 6px;
  color: #606266;
}
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.7;
  margin: 0;
}
.preview-paper {
  max-width: 100%;
}
.preview-block {
  border: none;
}
</style>
