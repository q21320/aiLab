<script setup lang="ts">
import { ZoomIn, ZoomOut } from "@element-plus/icons-vue";
import { computed, onBeforeUnmount, ref } from "vue";
import type { CapacityLine, WorkOrder } from "../../stores/production";

const props = defineProps<{
  lines: CapacityLine[];
  workOrders: WorkOrder[];
  days?: number;
}>();

const emit = defineEmits<{
  (e: "move", payload: { woId: string; lineId: string; start: number }): void;
  (e: "select", wo: WorkOrder | null): void;
}>();

const DAYS = props.days || 7;
/** 排产窗口：今日 9:00 起 7 天 */
const dayStart = (() => {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d.getTime();
})();
const ROW_H = 46;
const HEAD_H = 60;
/** 缩放档位：每小时像素 */
const ZOOM_STEPS = [3, 6, 9, 14, 20, 30];
const zoomIdx = ref(2); // 默认 9px/小时
const PPH = computed(() => ZOOM_STEPS[zoomIdx.value]);
const DAY_W = computed(() => 24 * PPH.value);
const TOTAL_W = computed(() => DAYS * DAY_W.value);
function zoomIn() {
  if (zoomIdx.value < ZOOM_STEPS.length - 1) zoomIdx.value += 1;
}
function zoomOut() {
  if (zoomIdx.value > 0) zoomIdx.value -= 1;
}

const now = Date.now();

const days = computed(() =>
  Array.from({ length: DAYS }, (_, i) => {
    const d = new Date(dayStart + i * 86400000);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  })
);

function barX(wo: WorkOrder): number {
  return ((wo.start - dayStart) / 3600000) * PPH.value;
}
function barW(wo: WorkOrder): number {
  return Math.max(16, wo.hours * PPH.value);
}
function barColor(wo: WorkOrder): string {
  if (wo.status === "done") return "#67c23a";
  if (wo.status === "exception") return "#f56c6c";
  if (wo.status === "running") return "#409eff";
  return "#b3c8e8";
}

/** 冲突检测：同产线时间重叠（拖拽时实时提示） */
function conflicts(): Set<string> {
  const set = new Set<string>();
  for (let i = 0; i < props.workOrders.length; i++) {
    for (let j = i + 1; j < props.workOrders.length; j++) {
      const a = props.workOrders[i];
      const b = props.workOrders[j];
      if (a.lineId === b.lineId && a.start < b.start + b.hours * 3600000 && b.start < a.start + a.hours * 3600000) {
        set.add(a.id);
        set.add(b.id);
      }
    }
  }
  return set;
}
const conflictSet = computed(() => conflicts());

// ---------------------------------------------------------------------------
// 拖拽
// ---------------------------------------------------------------------------
const drag = ref({ active: false, woId: "", dx: 0, dy: 0, lineIdx: 0 });
const selectedId = ref("");
const svgRef = ref<SVGSVGElement | null>(null);

/**
 * 鼠标坐标 → SVG viewBox 坐标。
 *
 * 修复：原实现对 x 乘 `TOTAL_W / rect.width`，但落点时又把 viewBox 单位的 dx 当 CSS 像素
 * 再除以 PPH，单位混用导致拖拽位置成倍偏移（容器越窄偏得越多）。
 * 现在统一在 **viewBox 坐标系** 内计算：px 与 barX()/PPH 同单位，落点公式
 *   start = dayStart + (x_viewBox / PPH) * 3600000
 * 才与渲染位置严格一致。
 */
function toCanvas(ev: MouseEvent): { x: number; y: number } {
  const rect = svgRef.value?.getBoundingClientRect();
  if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
  const sx = TOTAL_W.value / rect.width;
  const sy = (HEAD_H + props.lines.length * ROW_H) / rect.height;
  return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}

function onBarMouseDown(ev: MouseEvent, wo: WorkOrder, rowIdx: number) {
  if (ev.button !== 0) return;
  const pt = toCanvas(ev);
  drag.value = {
    active: true,
    woId: wo.id,
    dx: pt.x - barX(wo),
    dy: pt.y - (HEAD_H + rowIdx * ROW_H),
    lineIdx: rowIdx,
  };
  selectedId.value = wo.id;
  emit("select", wo);
  ev.preventDefault();
}

function onSvgMouseMove(ev: MouseEvent) {
  if (!drag.value.active) return;
  const pt = toCanvas(ev);
  const lineIdx = Math.max(0, Math.min(props.lines.length - 1, Math.floor((pt.y - drag.value.dy - HEAD_H) / ROW_H)));
  drag.value.lineIdx = lineIdx;
}

function onSvgMouseUp() {
  drag.value.active = false;
}

/** 拖拽结束后应用新排产位置 */
function onBarMouseUp(ev: MouseEvent) {
  if (!drag.value.active) return;
  const wo = props.workOrders.find((w) => w.id === drag.value.woId);
  if (wo) {
    const pt = toCanvas(ev);
    // dx 与 pt 同为 viewBox 单位，相减后就是工单条新的左边距（px 单位与 PPH 一致）
    const x = Math.max(0, pt.x - drag.value.dx);
    const start = dayStart + (x / PPH.value) * 3600000;
    const line = props.lines[Math.max(0, Math.min(props.lines.length - 1, drag.value.lineIdx))];
    if (line) emit("move", { woId: wo.id, lineId: line.id, start });
  }
  drag.value.active = false;
}

onBeforeUnmount(() => {
  drag.value.active = false;
});
</script>

<template>
  <div class="gantt">
    <div class="gantt-toolbar">
      <span class="zoom-label">缩放：</span>
      <el-button size="small" :icon="ZoomOut" :disabled="zoomIdx === 0" @click="zoomOut">缩小</el-button>
      <span class="zoom-value">{{ PPH }}px/小时</span>
      <el-button size="small" :icon="ZoomIn" :disabled="zoomIdx === ZOOM_STEPS.length - 1" @click="zoomIn">放大</el-button>
      <span class="zoom-hint">拖动工单条可调整时间与产线；红色虚线框表示同产线时间冲突</span>
    </div>
    <div class="gantt-scroll">
    <svg
      ref="svgRef"
      class="gantt-svg"
      :viewBox="`0 0 ${TOTAL_W} ${HEAD_H + lines.length * ROW_H}`"
      @mousemove="onSvgMouseMove"
      @mouseup="onSvgMouseUp"
    >
      <!-- 表头日期 -->
      <g class="head">
        <rect x="0" y="0" :width="TOTAL_W" :height="HEAD_H" fill="#f5f7fa" />
        <text x="6" y="24" font-size="12" fill="#909399">产线 / 时间</text>
        <g v-for="(d, i) in days" :key="i">
          <rect :x="i * DAY_W" y="30" :width="DAY_W" height="22" fill="transparent" />
          <text :x="i * DAY_W + DAY_W / 2" y="45" text-anchor="middle" font-size="12" fill="#606266">{{ d }}</text>
          <line :x1="i * DAY_W" y1="26" :x2="i * DAY_W" y2="1100" stroke="#ebeef5" stroke-width="1" />
        </g>
      </g>

      <!-- 行与工单条 -->
      <g v-for="(line, i) in lines" :key="line.id">
        <rect :x="0" :y="HEAD_H + i * ROW_H" :width="TOTAL_W" :height="ROW_H" fill="transparent" />
        <text :x="6" :y="HEAD_H + i * ROW_H + 28" font-size="12" fill="#606266">
          {{ line.name }}
        </text>
        <line :x1="120" :y1="HEAD_H + i * ROW_H" :x2="TOTAL_W" :y2="HEAD_H + i * ROW_H" stroke="#f0f2f5" />
        <g
          v-for="wo in workOrders.filter((w) => w.lineId === line.id)"
          :key="wo.id"
          class="gantt-bar"
          :class="{ selected: selectedId === wo.id, conflict: conflictSet.has(wo.id) }"
          :transform="`translate(${barX(wo)}, ${HEAD_H + i * ROW_H + 8})`"
          @mousedown.stop.prevent="onBarMouseDown($event, wo, i)"
          @mouseup.stop.prevent="onBarMouseUp($event)"
        >
          <rect :width="barW(wo)" :height="ROW_H - 16" rx="6" :fill="barColor(wo)" fill-opacity="0.85" />
          <text
            :x="barW(wo) / 2"
            :y="(ROW_H - 16) / 2 + 4"
            text-anchor="middle"
            font-size="11"
            fill="#fff"
          >
            {{ wo.processName }} {{ wo.status === "done" ? "✓" : wo.progress ? wo.progress + "%" : "" }}
          </text>
        </g>
      </g>

      <!-- 当前时刻线 -->
      <line :x1="((now - dayStart) / 3600000) * PPH" y1="30" :x2="((now - dayStart) / 3600000) * PPH" :y2="HEAD_H + lines.length * ROW_H" stroke="#f56c6c" stroke-dasharray="4 3" />
    </svg>
    </div>
  </div>
</template>

<style scoped>
.gantt-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.zoom-label {
  font-size: 13px;
  color: #606266;
}
.zoom-value {
  font-size: 12px;
  color: #909399;
  min-width: 80px;
  text-align: center;
}
.zoom-hint {
  font-size: 12px;
  color: #c0c4cc;
  margin-left: auto;
}
.gantt-scroll {
  overflow-x: auto;
}
.gantt {
  background: #fff;
  border-radius: 8px;
  padding: 8px;
}
.gantt-svg {
  width: 100%;
  min-width: 760px;
  user-select: none;
}
.gantt-bar {
  cursor: grab;
}
.gantt-bar:active {
  cursor: grabbing;
}
.gantt-bar.selected rect {
  stroke: #409eff;
  stroke-width: 2;
}
.gantt-bar.conflict rect {
  stroke: #f56c6c;
  stroke-width: 2;
  stroke-dasharray: 4 2;
}
</style>
