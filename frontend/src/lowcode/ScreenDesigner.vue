<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  Download,
  Delete,
  Rank,
  FullScreen,
  Top,
  Bottom,
  Close,
  Promotion,
} from "@element-plus/icons-vue";
import { useLowcodeStore } from "./store";
import { defaultScreenSchema } from "./defaults";
import PublishDialog from "./PublishDialog.vue";
import type { PublishedApp } from "./publish";
import {
  SCREEN_WIDGET_LABELS,
  SCREEN_DEFAULT_SIZE,
  type ScreenSchema,
  type ScreenWidget,
  type ScreenWidgetKind,
} from "./screenTypes";
import { clone, uid } from "./schemaOps";
import ScreenWidgetView from "./ScreenWidgetView.vue";

const store = useLowcodeStore();
const screen = ref<ScreenSchema>(clone(store.projects.screen || defaultScreenSchema()));
const selectedId = ref("");
const selectedWidget = computed<ScreenWidget | undefined>(() =>
  screen.value.widgets.find((w) => w.id === selectedId.value)
);

// ---------------------------------------------------------------------------
// 缩放适配（设计尺寸 1920x1080 → 容器适配）
// ---------------------------------------------------------------------------
const stageEl = ref<HTMLDivElement | null>(null);
const scale = ref(1);
let ro: ResizeObserver | null = null;
function fit() {
  const el = stageEl.value;
  if (!el) return;
  const pad = 24;
  const availW = el.clientWidth - pad * 2;
  const availH = el.clientHeight - pad * 2;
  scale.value = Math.min(availW / screen.value.width, availH / screen.value.height);
}
onMounted(() => {
  fit();
  if (stageEl.value) {
    ro = new ResizeObserver(fit);
    ro.observe(stageEl.value);
  }
});
onBeforeUnmount(() => {
  ro?.disconnect();
});

// ---------------------------------------------------------------------------
// 组件面板
// ---------------------------------------------------------------------------
const WIDGETS: { kind: ScreenWidgetKind; label: string; icon: string; w: number; h: number }[] = [
  { kind: "title", label: "标题", icon: "EditPen", w: 600, h: 64 },
  { kind: "text", label: "文本", icon: "Document", w: 400, h: 60 },
  { kind: "clock", label: "时钟", icon: "Clock", w: 220, h: 46 },
  { kind: "stat", label: "指标卡", icon: "Odometer", w: 340, h: 130 },
  { kind: "bar", label: "柱状图", icon: "Histogram", w: 560, h: 320 },
  { kind: "line", label: "折线图", icon: "TrendCharts", w: 560, h: 320 },
  { kind: "pie", label: "饼图", icon: "PieChart", w: 560, h: 320 },
  { kind: "table", label: "滚动列表", icon: "Tickets", w: 800, h: 300 },
  { kind: "border", label: "装饰边框", icon: "Crop", w: 400, h: 200 },
  // —— 物联网实时数据组件（4.3/4.6：设备状态、测试数据、样品台账、能耗）——
  { kind: "device", label: "设备状态", icon: "Monitor", w: 460, h: 300 },
  { kind: "energy", label: "能耗趋势", icon: "Lightning", w: 560, h: 320 },
  { kind: "testData", label: "测试数据", icon: "Cpu", w: 560, h: 320 },
  { kind: "sampleList", label: "样品台账", icon: "Box", w: 560, h: 300 },
];

function makeWidget(kind: ScreenWidgetKind, x?: number, y?: number, w?: number, h?: number): ScreenWidget {
  const tmpl = WIDGETS.find((t) => t.kind === kind)!;
  const zMax = screen.value.widgets.reduce((m, wd) => Math.max(m, wd.z), 0);
  const wd = w ?? tmpl.w;
  const ht = h ?? tmpl.h;
  const px = Math.max(0, x !== undefined ? x - wd / 2 : (screen.value.width - wd) / 2);
  const py = Math.max(0, y !== undefined ? y - ht / 2 : (screen.value.height - ht) / 2);
  const widget: ScreenWidget = {
    id: uid("w"),
    kind,
    x: Math.round(Math.min(px, screen.value.width - wd)),
    y: Math.round(Math.min(py, screen.value.height - ht)),
    w: wd,
    h: ht,
    z: zMax + 10,
    title: SCREEN_WIDGET_LABELS[kind],
    config: { color: "#00e5ff" },
  };
  if (kind === "title") widget.config = { sub: "Sub Title", color: "#00e5ff" };
  if (kind === "text") widget.config = { color: "rgba(255,255,255,0.85)" };
  if (kind === "stat") widget.config = { value: 100, unit: "万", trend: "+10.2%", color: "#00e5ff" };
  if (kind === "table") widget.config = { columns: ["排名", "客户", "产品", "金额", "状态"] };
  if (kind === "device") widget.config = { color: "#00e5ff" };
  if (kind === "energy") widget.config = { color: "#00d68f" };
  if (kind === "testData") widget.config = { color: "#ffb74d" };
  if (kind === "sampleList") widget.config = { color: "#3d9bff" };
  return widget;
}

function addWidget(kind: ScreenWidgetKind) {
  const w = makeWidget(kind);
  screen.value.widgets.push(w);
  selectedId.value = w.id;
}
function removeWidget(id: string) {
  screen.value.widgets = screen.value.widgets.filter((w) => w.id !== id);
  if (selectedId.value === id) selectedId.value = "";
}

function bringToFront(id: string) {
  const w = screen.value.widgets.find((x) => x.id === id);
  if (!w) return;
  w.z = screen.value.widgets.reduce((m, x) => Math.max(m, x.z), 0) + 10;
}
function sendToBack(id: string) {
  const w = screen.value.widgets.find((x) => x.id === id);
  if (!w) return;
  w.z = screen.value.widgets.reduce((m, x) => Math.min(m, x.z), 9999) - 10;
}

// ---------------------------------------------------------------------------
// 拖拽放置 / 移动 / 缩放
// ---------------------------------------------------------------------------
function onPaletteDragStart(ev: DragEvent, kind: ScreenWidgetKind) {
  ev.dataTransfer?.setData("text/plain", "screen:" + kind);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
}
function onStageDragOver(ev: DragEvent) {
  ev.preventDefault();
}
function onStageDrop(ev: DragEvent) {
  ev.preventDefault();
  const data = ev.dataTransfer?.getData("text/plain") || "";
  if (!data.startsWith("screen:")) return;
  const kind = data.slice(7) as ScreenWidgetKind;
  const el = stageEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = (ev.clientX - rect.left) / scale.value;
  const y = (ev.clientY - rect.top) / scale.value;
  const w = makeWidget(kind, x, y);
  screen.value.widgets.push(w);
  selectedId.value = w.id;
}

// 交互状态
const gesture = reactive({
  mode: "" as "" | "move" | "e" | "s" | "se",
  id: "",
  startX: 0,
  startY: 0,
  origX: 0,
  origY: 0,
  origW: 0,
  origH: 0,
});

function onWidgetMouseDown(ev: MouseEvent, w: ScreenWidget) {
  if (ev.button !== 0) return;
  selectedId.value = w.id;
  bringToFront(w.id);
  gesture.mode = "move";
  gesture.id = w.id;
  gesture.startX = ev.clientX;
  gesture.startY = ev.clientY;
  gesture.origX = w.x;
  gesture.origY = w.y;
  gesture.origW = w.w;
  gesture.origH = w.h;
  ev.preventDefault();
}

function onHandleMouseDown(ev: MouseEvent, mode: "e" | "s" | "se", w: ScreenWidget) {
  ev.stopPropagation();
  ev.preventDefault();
  selectedId.value = w.id;
  bringToFront(w.id);
  gesture.mode = mode;
  gesture.id = w.id;
  gesture.startX = ev.clientX;
  gesture.startY = ev.clientY;
  gesture.origX = w.x;
  gesture.origY = w.y;
  gesture.origW = w.w;
  gesture.origH = w.h;
}

function onWindowMouseMove(ev: MouseEvent) {
  if (!gesture.id) return;
  const w = screen.value.widgets.find((x) => x.id === gesture.id);
  if (!w) return;
  const dx = (ev.clientX - gesture.startX) / scale.value;
  const dy = (ev.clientY - gesture.startY) / scale.value;
  if (gesture.mode === "move") {
    w.x = Math.max(0, Math.min(screen.value.width - w.w, Math.round(gesture.origX + dx)));
    w.y = Math.max(0, Math.min(screen.value.height - w.h, Math.round(gesture.origY + dy)));
  } else if (gesture.mode === "e") {
    w.w = Math.max(80, Math.min(screen.value.width - w.x, Math.round(gesture.origW + dx)));
  } else if (gesture.mode === "s") {
    w.h = Math.max(40, Math.min(screen.value.height - w.y, Math.round(gesture.origH + dy)));
  } else if (gesture.mode === "se") {
    w.w = Math.max(80, Math.min(screen.value.width - w.x, Math.round(gesture.origW + dx)));
    w.h = Math.max(40, Math.min(screen.value.height - w.y, Math.round(gesture.origH + dy)));
  }
}
function onWindowMouseUp() {
  gesture.id = "";
  gesture.mode = "";
}

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId.value) {
    e.preventDefault();
    removeWidget(selectedId.value);
  }
  if (e.key === "Escape") previewVisible.value = false;
}

onMounted(() => {
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("keydown", onKeydown);
});

// ---------------------------------------------------------------------------
// 属性绑定
// ---------------------------------------------------------------------------
function wb<K extends keyof ScreenWidget>(key: K) {
  return computed<any>({
    get: () => selectedWidget.value?.[key],
    set: (v) => {
      if (selectedWidget.value) (selectedWidget.value as any)[key] = Number(v) || v;
    },
  });
}
const wx = wb("x");
const wy = wb("y");
const ww = wb("w");
const wh = wb("h");
const wTitle = wb("title");
function wcfg(key: string) {
  return computed<any>({
    get: () => selectedWidget.value?.config?.[key],
    set: (v) => {
      if (!selectedWidget.value) return;
      selectedWidget.value.config = selectedWidget.value.config || {};
      selectedWidget.value.config[key] = v;
    },
  });
}
const cColor = wcfg("color");
const cSub = wcfg("sub");
const cValue = wcfg("value");
const cUnit = wcfg("unit");
const cTrend = wcfg("trend");
const cCategories = wcfg("categories");
const cColumns = wcfg("columns");

// ---------------------------------------------------------------------------
// 预览 / 导出 / 保存
// ---------------------------------------------------------------------------
const previewVisible = ref(false);
function openPreview() {
  previewVisible.value = true;
}
const previewScale = computed(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return Math.min((vw - 40) / screen.value.width, (vh - 100) / screen.value.height);
});

function exportJson() {
  const blob = new Blob([JSON.stringify(screen.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "screen-schema.json";
  a.click();
  URL.revokeObjectURL(url);
}

const screenName = computed<string>({
  get: () => screen.value.name,
  set: (v) => (screen.value.name = v),
});

const savedAt = ref("");
let saveTimer: number | undefined;
watch(
  screen,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.saveProject("screen", clone(screen.value));
      savedAt.value = new Date().toLocaleTimeString();
    }, 800);
  },
  { deep: true }
);

function resetExample() {
  screen.value = clone(defaultScreenSchema());
  selectedId.value = "";
  ElMessage.success("已恢复示例大屏");
}
function createNew() {
  screen.value = {
    id: uid("screen"),
    name: "未命名大屏",
    width: SCREEN_DEFAULT_SIZE.width,
    height: SCREEN_DEFAULT_SIZE.height,
    background: "linear-gradient(160deg, #061630 0%, #0a1f44 55%, #061630 100%)",
    widgets: [],
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
  <div class="screen-designer">
    <!-- 左：组件面板 -->
    <aside class="side side-left">
      <div class="side-title">
        <el-icon><Rank /></el-icon>
        <span>大屏组件</span>
      </div>
      <p class="side-desc">点击或拖拽组件到画布；拖动组件移动，右下角手柄缩放。</p>
      <div
        v-for="t in WIDGETS"
        :key="t.kind"
        class="palette-item"
        draggable="true"
        @dragstart="onPaletteDragStart($event, t.kind)"
        @click="addWidget(t.kind)"
      >
        <el-icon><component :is="t.icon" /></el-icon>
        <span>{{ t.label }}</span>
      </div>
    </aside>

    <!-- 中：设计画布（1920x1080 等比适配） -->
    <section class="side side-center">
      <div class="center-toolbar">
        <div class="toolbar-group">
          <el-button size="small" type="primary" :icon="Promotion" @click="publishVisible = true">发布</el-button>
          <el-button size="small" :icon="FullScreen" @click="openPreview">全屏预览</el-button>
          <el-button size="small" :icon="Download" @click="exportJson">导出 JSON</el-button>
          <el-button size="small" @click="createNew">新建</el-button>
          <el-button size="small" @click="resetExample">示例</el-button>
        </div>
        <span class="stats">{{ screen.width }}×{{ screen.height }} · 组件 {{ screen.widgets.length }} 个</span>
      </div>

      <div ref="stageEl" class="stage" @dragover.prevent="onStageDragOver" @drop.prevent="onStageDrop" @click="selectedId = ''">
        <div
          class="screen-canvas"
          :style="{
            width: screen.width * scale + 'px',
            height: screen.height * scale + 'px',
          }"
        >
          <div
            class="screen-inner"
            :style="{
              width: screen.width + 'px',
              height: screen.height + 'px',
              background: screen.background,
              transform: `scale(${scale})`,
            }"
          >
            <!-- 组件 -->
            <div
              v-for="w in screen.widgets"
              :key="w.id"
              class="sw-frame"
              :class="{ selected: w.id === selectedId }"
              :style="{
                left: w.x + 'px',
                top: w.y + 'px',
                width: w.w + 'px',
                height: w.h + 'px',
                zIndex: w.z,
              }"
              @mousedown.stop.prevent="onWidgetMouseDown($event, w)"
              @click.stop="selectedId = w.id"
            >
              <div class="sw-label">{{ SCREEN_WIDGET_LABELS[w.kind] }} · {{ w.title || "未命名" }}</div>
              <div class="sw-inner">
                <ScreenWidgetView :widget="w" />
              </div>
              <!-- 缩放手柄 -->
              <template v-if="w.id === selectedId">
                <span class="handle handle-e" @mousedown.stop.prevent="onHandleMouseDown($event, 'e', w)"></span>
                <span class="handle handle-s" @mousedown.stop.prevent="onHandleMouseDown($event, 's', w)"></span>
                <span class="handle handle-se" @mousedown.stop.prevent="onHandleMouseDown($event, 'se', w)"></span>
              </template>
            </div>

            <el-empty
              v-if="screen.widgets.length === 0"
              description="从左侧添加组件开始设计大屏"
              :image-size="120"
              style="background: transparent"
            />
          </div>
        </div>
      </div>

      <div class="center-footer">
        <span v-if="savedAt">已自动保存 {{ savedAt }}</span>
        <span>设计尺寸 1920×1080，预览时按屏幕等比缩放</span>
      </div>
    </section>

    <!-- 右：属性 -->
    <aside class="side side-right">
      <div class="side-title">属性</div>
      <template v-if="selectedWidget">
        <div class="field">
          <label>组件类型</label>
          <el-tag size="small" type="primary" effect="plain">{{ SCREEN_WIDGET_LABELS[selectedWidget.kind] }}</el-tag>
        </div>
        <div class="field">
          <label>标题/内容</label>
          <el-input v-model="wTitle" />
        </div>
        <div class="field field-2">
          <div><label>X</label><el-input-number v-model="wx" :min="0" :controls="false" style="width: 100%" /></div>
          <div><label>Y</label><el-input-number v-model="wy" :min="0" :controls="false" style="width: 100%" /></div>
        </div>
        <div class="field field-2">
          <div><label>宽 W</label><el-input-number v-model="ww" :min="60" :controls="false" style="width: 100%" /></div>
          <div><label>高 H</label><el-input-number v-model="wh" :min="30" :controls="false" style="width: 100%" /></div>
        </div>

        <template v-if="['stat', 'bar', 'line', 'pie', 'title', 'text', 'device', 'energy', 'testData', 'sampleList'].includes(selectedWidget.kind)">
          <div class="field">
            <label>主题色</label>
            <el-color-picker v-model="cColor" />
          </div>
        </template>

        <template v-if="selectedWidget.kind === 'stat'">
          <div class="field field-2">
            <div><label>数值</label><el-input-number v-model="cValue" :controls="false" style="width: 100%" /></div>
            <div><label>单位</label><el-input v-model="cUnit" /></div>
          </div>
          <div class="field">
            <label>趋势（+/- 百分比）</label>
            <el-input v-model="cTrend" placeholder="+12.4%" />
          </div>
        </template>

        <template v-if="selectedWidget.kind === 'title'">
          <div class="field">
            <label>副标题</label>
            <el-input v-model="cSub" />
          </div>
        </template>

        <template v-if="['bar', 'line', 'pie'].includes(selectedWidget.kind)">
          <div class="field">
            <label>分类（逗号分隔，可选）</label>
            <el-input v-model="cCategories" type="textarea" :rows="2" placeholder="1月,2月,3月... / 类型A,类型B" />
          </div>
        </template>

        <template v-if="selectedWidget.kind === 'table'">
          <div class="field">
            <label>表头（逗号分隔）</label>
            <el-input v-model="cColumns" type="textarea" :rows="2" />
          </div>
        </template>

        <div class="field">
          <label>图层</label>
          <div class="layer-ops">
            <el-button size="small" :icon="Top" @click="bringToFront(selectedWidget.id)">置顶</el-button>
            <el-button size="small" :icon="Bottom" @click="sendToBack(selectedWidget.id)">置底</el-button>
          </div>
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label>大屏名称</label>
          <el-input v-model="screenName" />
        </div>
        <div class="field">
          <label>设计尺寸</label>
          <div class="layer-ops">
            <el-tag>1920 × 1080</el-tag>
            <el-tag type="success">16:9</el-tag>
          </div>
        </div>
        <p class="hint">
          选中画布中的组件进行属性/数据配置。组件支持拖拽移动、手柄缩放、层级调整；预览时按屏幕等比缩放，适配大屏/PC/移动端观演。
        </p>
      </template>

      <el-button
        v-if="selectedWidget"
        type="danger"
        plain
        size="small"
        style="width: 100%; margin-top: 12px"
        :icon="Delete"
        @click="removeWidget(selectedWidget.id)"
      >
        删除组件 (Delete)
      </el-button>
    </aside>

    <!-- 全屏预览 -->
    <div v-if="previewVisible" class="screen-preview" :style="{ background: screen.background }">
      <div
        class="screen-preview-inner"
        :style="{
          width: screen.width * previewScale + 'px',
          height: screen.height * previewScale + 'px',
        }"
      >
        <div
          class="screen-inner"
          :style="{
            width: screen.width + 'px',
            height: screen.height + 'px',
            background: screen.background,
            transform: `scale(${previewScale})`,
          }"
        >
          <div
            v-for="w in screen.widgets"
            :key="w.id"
            :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }"
            class="sw-frame preview"
          >
            <div class="sw-inner">
              <ScreenWidgetView :widget="w" />
            </div>
          </div>
        </div>
      </div>
      <button class="preview-close" @click="previewVisible = false">
        <el-icon><Close /></el-icon> 退出预览 (Esc)
      </button>
    </div>

    <!-- 发布对话框 -->
    <PublishDialog
      v-model="publishVisible"
      kind="screen"
      :schema="screen"
      :default-name="screen.name || '大屏应用'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.screen-designer {
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
  width: 220px;
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
}
.side-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin: 0 0 12px;
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
  cursor: grab;
  transition: all 0.15s;
  user-select: none;
}
.palette-item:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
.palette-item:active {
  cursor: grabbing;
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
.stage {
  flex: 1;
  overflow: auto;
  background: #10161f;
  display: flex;
  align-items: center;
  justify-content: center;
}
.screen-canvas {
  position: relative;
  flex-shrink: 0;
}
.screen-inner {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
  border: 1px solid rgba(0, 229, 255, 0.35);
  box-shadow: 0 0 30px rgba(0, 0, 0, 0.5);
  border-radius: 4px;
}
.sw-frame {
  position: absolute;
  overflow: visible;
  cursor: move;
}
.sw-frame.selected {
  outline: 1px solid #00e5ff;
  outline-offset: 2px;
}
.sw-frame.selected .sw-label {
  display: block;
}
.sw-frame.preview {
  cursor: default;
}
.sw-label {
  display: none;
  position: absolute;
  top: -22px;
  left: 0;
  background: #00e5ff;
  color: #06223f;
  font-size: 11px;
  line-height: 18px;
  padding: 0 8px;
  border-radius: 3px 3px 0 0;
  white-space: nowrap;
  z-index: 9999;
  pointer-events: none;
}
.sw-inner {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: #00e5ff;
  border: 1px solid #fff;
  border-radius: 2px;
  z-index: 9999;
  cursor: nwse-resize;
}
.handle-e {
  right: -6px;
  top: 50%;
  transform: translateY(-50%);
  cursor: ew-resize;
}
.handle-s {
  bottom: -6px;
  left: 50%;
  transform: translateX(-50%);
  cursor: ns-resize;
}
.handle-se {
  right: -6px;
  bottom: -6px;
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
.field-2 {
  display: flex;
  gap: 8px;
}
.field-2 > div {
  flex: 1;
}
.layer-ops {
  display: flex;
  gap: 8px;
}
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.7;
  margin: 0;
}
.screen-preview {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.screen-preview-inner {
  position: relative;
  flex-shrink: 0;
}
.preview-close {
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 3001;
  border: 1px solid rgba(255, 255, 255, 0.4);
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  padding: 8px 14px;
  border-radius: 6px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
}
.preview-close:hover {
  background: rgba(0, 0, 0, 0.7);
}
</style>
