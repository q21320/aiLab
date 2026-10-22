<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  Download,
  Delete,
  Rank,
  MagicStick,
  VideoPlay,
  Refresh,
  Promotion,
} from "@element-plus/icons-vue";
import { useLowcodeStore } from "./store";
import { defaultFlowSchema } from "./defaults";
import PublishDialog from "./PublishDialog.vue";
import type { PublishedApp } from "./publish";
import {
  FLOW_NODE_LABELS,
  FLOW_NODE_SIZE,
  FLOW_NODE_DEFAULT_CONFIG,
  type FlowEdge,
  type FlowNode,
  type FlowNodeType,
  type FlowSchema,
} from "./flowTypes";
import { clone, uid } from "./schemaOps";
import { autoLayout } from "./flowLayout";

const store = useLowcodeStore();

// 从「应用中心 · 重新设计」进入时，父级传入该应用的真实 Schema（修复：原先永远加载内置示例）
const props = defineProps<{ schema?: FlowSchema | null }>();
const flow = ref<FlowSchema>(clone(props.schema || store.projects.flow || defaultFlowSchema()));

// 画布逻辑尺寸（viewBox）
const CANVAS_W = 1280;
const CANVAS_H = 720;

// 选中项（node:xxx / edge:xxx）
const selected = ref("");
const selectedNode = computed<FlowNode | null>(() =>
  selected.value.startsWith("node:")
    ? flow.value.nodes.find((n) => n.id === selected.value.slice(5)) || null
    : null
);
const selectedEdge = computed(() =>
  selected.value.startsWith("edge:")
    ? flow.value.edges.find((e) => e.id === selected.value.slice(5)) || null
    : null
);

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------
function nodeCenter(n: FlowNode) {
  const s = FLOW_NODE_SIZE[n.type];
  return { x: n.x + s.width / 2, y: n.y + s.height / 2 };
}

function edgeSource(e: FlowEdge): FlowNode | null {
  return flow.value.nodes.find((n) => n.id === e.source) || null;
}
function edgeTarget(e: FlowEdge): FlowNode | null {
  return flow.value.nodes.find((n) => n.id === e.target) || null;
}
function edgeLabel2(e: FlowEdge): boolean {
  return !!(e.label && e.label.trim());
}

/** 边路径（左→右贝塞尔） */
function edgePath(source: FlowNode, target: FlowNode): string {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

function edgeMid(source: FlowNode, target: FlowNode): { x: number; y: number } {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 8 };
}

// ---------------------------------------------------------------------------
// 画布坐标换算
// ---------------------------------------------------------------------------
const svgEl = ref<SVGSVGElement | null>(null);
function toCanvasPoint(ev: MouseEvent | DragEvent): { x: number; y: number } {
  const el = svgEl.value;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  const sx = CANVAS_W / rect.width;
  const sy = CANVAS_H / rect.height;
  return { x: (ev.clientX - rect.left) * sx, y: (ev.clientY - rect.top) * sy };
}

// ---------------------------------------------------------------------------
// 添加节点（调色板 / 拖放）
// ---------------------------------------------------------------------------
function makeNode(type: FlowNodeType, x: number, y: number): FlowNode {
  const size = FLOW_NODE_SIZE[type];
  return {
    id: uid("n"),
    type,
    x: Math.max(0, Math.min(CANVAS_W - size.width, x - size.width / 2)),
    y: Math.max(0, Math.min(CANVAS_H - size.height, y - size.height / 2)),
    name: FLOW_NODE_LABELS[type],
    config: clone(FLOW_NODE_DEFAULT_CONFIG[type] || {}),
  };
}

function addNode(type: FlowNodeType, x?: number, y?: number) {
  const count = flow.value.nodes.length;
  const px = x ?? 80 + (count % 6) * 40;
  const py = y ?? 60 + (count % 5) * 56;
  const node = makeNode(type, px, py);
  flow.value.nodes.push(node);
  selected.value = "node:" + node.id;
}

function onPaletteDragStart(ev: DragEvent, type: FlowNodeType) {
  ev.dataTransfer?.setData("text/plain", "flow:" + type);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
}
function onSvgDragOver(ev: DragEvent) {
  ev.preventDefault();
}
function onSvgDrop(ev: DragEvent) {
  ev.preventDefault();
  const data = ev.dataTransfer?.getData("text/plain") || "";
  if (data.startsWith("flow:")) {
    const type = data.slice(5) as FlowNodeType;
    const pt = toCanvasPoint(ev);
    addNode(type, pt.x, pt.y);
  }
}

// ---------------------------------------------------------------------------
// 节点拖动
// ---------------------------------------------------------------------------
const dragging = reactive({ id: "", offsetX: 0, offsetY: 0 });
function onNodeMouseDown(ev: MouseEvent, node: FlowNode) {
  selected.value = "node:" + node.id;
  const pt = toCanvasPoint(ev);
  dragging.id = node.id;
  dragging.offsetX = pt.x - node.x;
  dragging.offsetY = pt.y - node.y;
}
function onWindowMouseMove(ev: MouseEvent) {
  if (!dragging.id) return;
  const node = flow.value.nodes.find((n) => n.id === dragging.id);
  if (!node) return;
  const size = FLOW_NODE_SIZE[node.type];
  const pt = toCanvasPoint(ev);
  node.x = Math.max(0, Math.min(CANVAS_W - size.width, pt.x - dragging.offsetX));
  node.y = Math.max(0, Math.min(CANVAS_H - size.height, pt.y - dragging.offsetY));
}
function onWindowMouseUp() {
  dragging.id = "";
}

// ---------------------------------------------------------------------------
// 连线
// ---------------------------------------------------------------------------
const connecting = reactive({ active: false, source: "", sx: 0, sy: 0, x: 0, y: 0 });
function startConnect(ev: MouseEvent, node: FlowNode) {
  ev.stopPropagation();
  connecting.active = true;
  connecting.source = node.id;
  const c = nodeCenter(node);
  connecting.sx = c.x;
  connecting.sy = c.y;
  connecting.x = c.x;
  connecting.y = c.y;
  selected.value = "node:" + node.id;
}
function onSvgMouseMove(ev: MouseEvent) {
  if (!connecting.active) return;
  const pt = toCanvasPoint(ev);
  connecting.x = pt.x;
  connecting.y = pt.y;
}
function onNodeConnect(ev: MouseEvent, target: FlowNode) {
  if (!connecting.active) return;
  ev.stopPropagation();
  const source = connecting.source;
  connecting.active = false;
  if (source === target.id) return;
  if (flow.value.edges.some((e) => e.source === source && e.target === target.id)) {
    ElMessage.warning("两点之间已存在连线");
    return;
  }
  const edge = { id: uid("e"), source, target: target.id, label: "" };
  flow.value.edges.push(edge);
  selected.value = "edge:" + edge.id;
}
function cancelConnect() {
  connecting.active = false;
  connecting.source = "";
}

/**
 * 全局 mouseup：连线拖到空白处松手时取消。
 * 修复前用节点上的 @mouseleave 取消连线，导致鼠标离开源节点的瞬间
 * connecting.active 就被置 false，任何连线都无法完成。
 */
function onWindowMouseUpForConnect() {
  if (!connecting.active) return;
  // 节点上的 @mouseup 先于 window 的冒泡阶段执行（前者是目标阶段）；
  // 但为避免依赖事件顺序，这里延迟到下一个宏任务再判断：
  // 若节点已处理则 active 已为 false，不会误取消。
  setTimeout(() => {
    if (connecting.active) cancelConnect();
  }, 0);
}
if (typeof window !== "undefined") {
  window.addEventListener("mouseup", onWindowMouseUpForConnect);
}

// ---------------------------------------------------------------------------
// 边 / 节点操作
// ---------------------------------------------------------------------------
function selectEdge(id: string) {
  selected.value = "edge:" + id;
}
function removeSelected() {
  if (selectedNode.value) {
    const id = selectedNode.value.id;
    flow.value.nodes = flow.value.nodes.filter((n) => n.id !== id);
    flow.value.edges = flow.value.edges.filter((e) => e.source !== id && e.target !== id);
    selected.value = "";
  } else if (selectedEdge.value) {
    flow.value.edges = flow.value.edges.filter((e) => e.id !== selectedEdge.value!.id);
    selected.value = "";
  }
}

function edgeLabel(id: string, v: string) {
  const e = flow.value.edges.find((x) => x.id === id);
  if (e) e.label = v;
}

// ---------------------------------------------------------------------------
// 节点属性绑定
// ---------------------------------------------------------------------------
const nodeName = computed<string>({
  get: () => selectedNode.value?.name || "",
  set: (v) => {
    if (selectedNode.value) selectedNode.value.name = v;
  },
});
function nodeConfig(key: string) {
  return computed<any>({
    get: () => selectedNode.value?.config?.[key],
    set: (v) => {
      if (!selectedNode.value) return;
      selectedNode.value.config = selectedNode.value.config || {};
      selectedNode.value.config[key] = v;
    },
  });
}
const cfgApprover = nodeConfig("approver");
const cfgMultiple = nodeConfig("multiple");
const cfgTargets = nodeConfig("targets");
const cfgExpr = nodeConfig("expression");
const cfgTrue = nodeConfig("trueLabel");
const cfgFalse = nodeConfig("falseLabel");
const cfgForm = nodeConfig("form");
const cfgWait = nodeConfig("desc");
const cfgCron = nodeConfig("cron");
const edgeLabelText = computed<string>({
  get: () => selectedEdge.value?.label || "",
  set: (v) => edgeLabel(selectedEdge.value?.id || "", v),
});

// 流程设置
const flowName = computed<string>({
  get: () => flow.value.name,
  set: (v) => (flow.value.name = v),
});

// ---------------------------------------------------------------------------
// 校验：Start/End 节点
// ---------------------------------------------------------------------------
const startNode = computed(() => flow.value.nodes.find((n) => n.type === "start"));
const endNodes = computed(() => flow.value.nodes.filter((n) => n.type === "end"));
const validation = computed(() => {
  const problems: string[] = [];
  if (!startNode.value) problems.push("缺少「开始」节点");
  if (endNodes.value.length === 0) problems.push("缺少「结束」节点");
  const unreachable = flow.value.nodes.filter(
    (n) => n.type !== "start" && !flow.value.edges.some((e) => e.target === n.id)
  );
  if (unreachable.length) problems.push(`${unreachable.map((n) => n.name).join("、")} 无入边`);
  return problems;
});

// ---------------------------------------------------------------------------
// 预览 + 仿真
// ---------------------------------------------------------------------------
const previewVisible = ref(false);
const simulateOrder = ref<string[]>([]);
const simulateStatus = ref("");
let simulateTimer: number | undefined;
function openPreview() {
  previewVisible.value = true;
  simulateOrder.value = [];
  simulateStatus.value = "就绪";
}

/** 以 BFS 找一条 start → end 的路径（条件分支优先走第一条出边） */
function findPath(): string[] {
  if (!startNode.value) return [];
  const prev = new Map<string, string>();
  const queue: string[] = [startNode.value.id];
  const visited = new Set<string>([startNode.value.id]);
  while (queue.length) {
    const cur = queue.shift()!;
    const node = flow.value.nodes.find((n) => n.id === cur);
    if (!node) continue;
    const outs = flow.value.edges.filter((e) => e.source === cur);
    for (const e of outs) {
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      prev.set(e.target, cur);
      queue.push(e.target);
      const tn = flow.value.nodes.find((n) => n.id === e.target);
      if (tn?.type === "end") {
        const path = [e.target];
        let curId = e.target;
        while (prev.get(curId)) {
          curId = prev.get(curId)!;
          path.unshift(curId);
        }
        return path;
      }
    }
  }
  return [];
}

function simulate() {
  clearInterval(simulateTimer);
  const path = findPath();
  if (path.length === 0) {
    ElMessage.warning("无法找到完整的开始→结束路径（请检查流程连线）");
    return;
  }
  simulateOrder.value = [];
  simulateStatus.value = "仿真运行中...";
  let i = 0;
  simulateTimer = window.setInterval(() => {
    if (i >= path.length) {
      clearInterval(simulateTimer);
      simulateStatus.value = "仿真完成 ✓";
      return;
    }
    simulateOrder.value = path.slice(0, i + 1);
    const n = flow.value.nodes.find((x) => x.id === path[i]);
    simulateStatus.value = `当前节点：${n?.name || ""} (${i + 1}/${path.length})`;
    i += 1;
  }, 600);
}

// ---------------------------------------------------------------------------
// 导出 / 自动保存 / 快捷键
// ---------------------------------------------------------------------------
function exportJson() {
  const blob = new Blob([JSON.stringify(flow.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "flow-schema.json";
  a.click();
  URL.revokeObjectURL(url);
}

const savedAt = ref("");
let saveTimer: number | undefined;
watch(
  flow,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.saveProject("flow", clone(flow.value));
      savedAt.value = new Date().toLocaleTimeString();
    }, 800);
  },
  { deep: true }
);

function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    e.preventDefault();
    removeSelected();
  }
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("mousemove", onWindowMouseMove);
  window.addEventListener("mouseup", onWindowMouseUp);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("mousemove", onWindowMouseMove);
  window.removeEventListener("mouseup", onWindowMouseUp);
  window.removeEventListener("mouseup", onWindowMouseUpForConnect);
  clearInterval(simulateTimer);
});

function resetExample() {
  flow.value = { ...clone(defaultFlowSchema()), id: uid("flow") };
  selected.value = "";
  ElMessage.success("已恢复示例流程");
}
function createNew() {
  flow.value = { id: uid("flow"), name: "未命名流程", nodes: [], edges: [] };
  selected.value = "";
}

// 发布（生成应用 → 应用中心 → 可挂载菜单运行）
const publishVisible = ref(false);
function onPublished(app: PublishedApp) {
  ElMessage.success(`已发布「${app.name}」，可在「应用中心」打开运行${app.menu ? "并已挂载到左侧菜单" : ""}`);
}

// 节点视觉样式
const NODE_STYLE: Record<FlowNodeType, { fill: string; stroke: string; text: string; shape: "rect" | "diamond" }> = {
  start: { fill: "#f0f9eb", stroke: "#67c23a", text: "#529b2e", shape: "rect" },
  end: { fill: "#fef0f0", stroke: "#f56c6c", text: "#c45656", shape: "rect" },
  approval: { fill: "#ecf5ff", stroke: "#409eff", text: "#337ecc", shape: "rect" },
  cc: { fill: "#f9f0ff", stroke: "#9254de", text: "#722ed1", shape: "rect" },
  condition: { fill: "#fdf6ec", stroke: "#e6a23c", text: "#b88230", shape: "diamond" },
  wait: { fill: "#fdf6ec", stroke: "#e6a23c", text: "#b88230", shape: "rect" },
  timer: { fill: "#f0f9eb", stroke: "#67c23a", text: "#529b2e", shape: "rect" },
};

function nodeStyle(type: FlowNodeType) {
  return NODE_STYLE[type];
}
function nodeSize(type: FlowNodeType) {
  return FLOW_NODE_SIZE[type];
}

const palette = [
  { type: "start" as FlowNodeType, label: "开始", icon: "VideoPlay" },
  { type: "end" as FlowNodeType, label: "结束", icon: "CircleClose" },
  { type: "approval" as FlowNodeType, label: "审批", icon: "Stamp" },
  { type: "cc" as FlowNodeType, label: "抄送", icon: "Message" },
  { type: "condition" as FlowNodeType, label: "条件", icon: "Share" },
  { type: "wait" as FlowNodeType, label: "等待", icon: "Clock" },
  { type: "timer" as FlowNodeType, label: "定时", icon: "AlarmClock" },
];
</script>

<template>
  <div class="flow-designer">
    <!-- 左：节点面板 -->
    <aside class="side side-left">
      <div class="side-title">
        <el-icon><Rank /></el-icon>
        <span>流程节点</span>
      </div>
      <p class="side-desc">点击或拖拽添加节点；从节点右侧圆点连线。</p>
      <div
        v-for="p in palette"
        :key="p.type"
        class="palette-item"
        draggable="true"
        @dragstart="onPaletteDragStart($event, p.type)"
        @click="addNode(p.type)"
      >
        <el-icon><component :is="p.icon" /></el-icon>
        <span>{{ p.label }}</span>
      </div>
      <el-divider />
      <div class="help">
        <p>· 拖动节点调整位置</p>
        <p>· 拖动右侧圆点建立连线</p>
        <p>· 点击连线可编辑标签</p>
        <p>· Delete 删除选中元素</p>
      </div>
    </aside>

    <!-- 中：画布 -->
    <section class="side side-center">
      <div class="center-toolbar">
        <div class="toolbar-group">
          <el-button size="small" type="primary" :icon="Promotion" @click="publishVisible = true">发布</el-button>
          <el-button size="small" :icon="MagicStick" @click="autoLayout(flow)">自动布局</el-button>
          <el-button size="small" :icon="VideoPlay" @click="openPreview">预览/仿真</el-button>
          <el-button size="small" :icon="Download" @click="exportJson">导出 JSON</el-button>
          <el-button size="small" @click="createNew">新建</el-button>
          <el-button size="small" @click="resetExample">示例</el-button>
        </div>
        <div class="validation" :class="{ ok: validation.length === 0 }">
          <el-icon><Refresh /></el-icon>
          <span v-if="validation.length === 0">流程结构校验通过</span>
          <span v-else>{{ validation.join("；") }}</span>
        </div>
      </div>

      <div class="canvas-wrap">
        <svg
          ref="svgEl"
          class="flow-svg"
          :viewBox="`0 0 ${CANVAS_W} ${CANVAS_H}`"
          @dragover.prevent="onSvgDragOver"
          @drop.prevent="onSvgDrop"
          @mousemove="onSvgMouseMove"
          @mousedown="selected = ''; cancelConnect()"
        >
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
            </marker>
          </defs>

          <!-- 连线 -->
          <g v-for="e in flow.edges" :key="e.id">
            <path
              v-if="edgeSource(e) && edgeTarget(e)"
              :d="edgePath(edgeSource(e)!, edgeTarget(e)!)"
              fill="none"
              stroke="#909399"
              stroke-width="2"
              marker-end="url(#arrow)"
              class="edge-path"
              :class="{ active: selectedEdge?.id === e.id }"
              @click.stop="selectEdge(e.id)"
            />
          </g>

          <!-- 连线标签 -->
          <g v-for="e in flow.edges" :key="e.id + '_label'">
            <rect
              v-if="edgeLabel2(e) && edgeSource(e) && edgeTarget(e)"
              :x="edgeMid(edgeSource(e)!, edgeTarget(e)!).x - 18"
              :y="edgeMid(edgeSource(e)!, edgeTarget(e)!).y"
              width="36"
              height="20"
              rx="4"
              fill="#fff"
              stroke="#dcdfe6"
              @click.stop="selectEdge(e.id)"
            />
            <text
              v-if="edgeLabel2(e) && edgeSource(e) && edgeTarget(e)"
              :x="edgeMid(edgeSource(e)!, edgeTarget(e)!).x"
              :y="edgeMid(edgeSource(e)!, edgeTarget(e)!).y + 13"
              text-anchor="middle"
              font-size="12"
              fill="#606266"
              @click.stop="selectEdge(e.id)"
            >
              {{ e.label }}
            </text>
          </g>

          <!-- 临时连线 -->
          <path
            v-if="connecting.active"
            :d="`M ${connecting.sx} ${connecting.sy} C ${connecting.sx + 60} ${connecting.sy}, ${connecting.x - 60} ${connecting.y}, ${connecting.x} ${connecting.y}`"
            fill="none"
            stroke="#409eff"
            stroke-width="2"
            stroke-dasharray="5 4"
          />

          <!-- 节点 -->
          <g
            v-for="n in flow.nodes"
            :key="n.id"
            class="node-g"
            :class="{ active: selectedNode?.id === n.id, simulated: simulateOrder.includes(n.id) }"
            :transform="`translate(${n.x}, ${n.y})`"
            @mousedown.stop.prevent="onNodeMouseDown($event, n)"
            @mouseup.stop.prevent="onNodeConnect($event, n)"
          >
            <rect
              v-if="nodeStyle(n.type).shape === 'rect'"
              :width="nodeSize(n.type).width"
              :height="nodeSize(n.type).height"
              rx="8"
              :fill="nodeStyle(n.type).fill"
              :stroke="nodeStyle(n.type).stroke"
              stroke-width="2"
            />
            <rect
              v-else
              :width="nodeSize(n.type).width"
              :height="nodeSize(n.type).height"
              transform="skewX(-22)"
              :fill="nodeStyle(n.type).fill"
              :stroke="nodeStyle(n.type).stroke"
              stroke-width="2"
            />
            <text
              :x="nodeSize(n.type).width / 2"
              :y="nodeSize(n.type).height / 2 + 4"
              text-anchor="middle"
              font-size="13"
              font-weight="600"
              :fill="nodeStyle(n.type).text"
            >
              {{ n.name }}
            </text>

            <!-- 输出端口 -->
            <circle
              :cx="nodeSize(n.type).width"
              :cy="nodeSize(n.type).height / 2"
              r="5"
              fill="#409eff"
              stroke="#fff"
              stroke-width="1.5"
              class="port"
              @mousedown.stop.prevent="startConnect($event, n)"
            />
            <!-- 输入端口 -->
            <circle
              :cx="0"
              :cy="nodeSize(n.type).height / 2"
              r="5"
              fill="#67c23a"
              stroke="#fff"
              stroke-width="1.5"
              class="port"
            />
          </g>

          <!-- 空状态 -->
          <text v-if="flow.nodes.length === 0" :x="CANVAS_W / 2" :y="CANVAS_H / 2" text-anchor="middle" font-size="15" fill="#c0c4cc">
            从左侧添加节点，开始设计你的业务流程
          </text>
        </svg>
      </div>

      <div class="center-footer">
        <span>节点 {{ flow.nodes.length }} 个 / 连线 {{ flow.edges.length }} 条</span>
        <span v-if="savedAt">已自动保存 {{ savedAt }}</span>
      </div>
    </section>

    <!-- 右：属性 -->
    <aside class="side side-right">
      <div class="side-title">属性设置</div>

      <template v-if="selectedNode">
        <div class="field">
          <label>节点名称</label>
          <el-input v-model="nodeName" />
        </div>
        <div class="field">
          <label>节点类型</label>
          <el-tag size="small" type="primary" effect="plain">{{ FLOW_NODE_LABELS[selectedNode.type] }}</el-tag>
        </div>

        <template v-if="selectedNode.type === 'approval'">
          <div class="field">
            <label>审批人</label>
            <el-input v-model="cfgApprover" placeholder="如：部门经理 / 角色/人员" />
          </div>
          <div class="field">
            <label>审批方式</label>
            <el-select v-model="cfgMultiple">
              <el-option label="或签（任意一人）" value="or" />
              <el-option label="会签（全部同意）" value="all" />
              <el-option label="顺签（依次审批）" value="seq" />
            </el-select>
          </div>
        </template>

        <template v-if="selectedNode.type === 'cc'">
          <div class="field">
            <label>抄送对象</label>
            <el-input v-model="cfgTargets" />
          </div>
        </template>

        <template v-if="selectedNode.type === 'condition'">
          <div class="field">
            <label>条件表达式</label>
            <el-input v-model="cfgExpr" placeholder="如：金额 > 10000" />
          </div>
          <div class="field field-inline">
            <div>
              <label>是-标签</label>
              <el-input v-model="cfgTrue" />
            </div>
            <div>
              <label>否-标签</label>
              <el-input v-model="cfgFalse" />
            </div>
          </div>
        </template>

        <template v-if="selectedNode.type === 'start'">
          <div class="field">
            <label>关联发起表单</label>
            <el-input v-model="cfgForm" />
          </div>
        </template>

        <template v-if="selectedNode.type === 'wait'">
          <div class="field">
            <label>等待说明</label>
            <el-input v-model="cfgWait" />
          </div>
        </template>

        <template v-if="selectedNode.type === 'timer'">
          <div class="field">
            <label>定时表达式</label>
            <el-input v-model="cfgCron" placeholder="如：0 9 * * *" />
          </div>
        </template>

        <template v-if="selectedNode.type === 'end'">
          <p class="hint">结束节点的出边用于描述“驳回/退回”分支。</p>
        </template>
      </template>

      <template v-else-if="selectedEdge">
        <div class="field">
          <label>连线名称</label>
          <el-input v-model="edgeLabelText" placeholder="如：是 / 否 / 通过 / 驳回" />
        </div>
        <div class="field">
          <label>源节点</label>
          <el-input :model-value="flow.nodes.find((n) => n.id === selectedEdge!.source)?.name || ''" disabled />
        </div>
        <div class="field">
          <label>目标节点</label>
          <el-input :model-value="flow.nodes.find((n) => n.id === selectedEdge!.target)?.name || ''" disabled />
        </div>
      </template>

      <template v-else>
        <div class="field">
          <label>流程名称</label>
          <el-input v-model="flowName" />
        </div>
        <el-divider />
        <p class="hint">设计器说明：</p>
        <ul class="help-list">
          <li>「开始」「结束」节点是流程骨架，请保证二者都存在</li>
          <li>条件节点出边建议标注「是/否」</li>
          <li>点击右侧「自动布局」一键排布</li>
          <li>导出 JSON 供流程引擎（如 Flowable/Activiti）对接</li>
        </ul>
      </template>

      <el-button v-if="selected" type="danger" plain size="small" style="width: 100%; margin-top: 12px" :icon="Delete" @click="removeSelected">
        删除选中{{ selectedNode ? "节点" : "连线" }}
      </el-button>
    </aside>

    <!-- 预览 / 仿真 -->
    <el-dialog v-model="previewVisible" title="流程预览与仿真" width="1000px" top="5vh">
      <div class="sim-bar">
        <el-button type="primary" size="small" :icon="VideoPlay" @click="simulate">执行仿真</el-button>
        <span class="sim-status">{{ simulateStatus }}</span>
      </div>
      <svg class="preview-svg" :viewBox="`0 0 ${CANVAS_W} ${CANVAS_H}`">
        <defs>
          <marker id="arrow2" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
          </marker>
        </defs>
        <g v-for="e in flow.edges" :key="e.id">
          <path
            v-if="edgeSource(e) && edgeTarget(e)"
            :d="edgePath(edgeSource(e)!, edgeTarget(e)!)"
            fill="none"
            stroke="#909399"
            stroke-width="2"
            marker-end="url(#arrow2)"
          />
        </g>
        <g v-for="n in flow.nodes" :key="n.id" :transform="`translate(${n.x}, ${n.y})`" class="node-g" :class="{ simulated: simulateOrder.includes(n.id) }">
          <rect
            :width="nodeSize(n.type).width"
            :height="nodeSize(n.type).height"
            rx="8"
            :fill="nodeStyle(n.type).fill"
            :stroke="nodeStyle(n.type).stroke"
            stroke-width="2"
          />
          <text :x="nodeSize(n.type).width / 2" :y="nodeSize(n.type).height / 2 + 4" text-anchor="middle" font-size="13" font-weight="600" :fill="nodeStyle(n.type).text">
            {{ n.name }}
          </text>
        </g>
      </svg>
    </el-dialog>

    <!-- 发布对话框 -->
    <PublishDialog
      v-model="publishVisible"
      kind="flow"
      :schema="flow"
      :default-name="flow.name || '流程应用'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.flow-designer {
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
  min-width: 320px;
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
.help {
  font-size: 12px;
  color: #909399;
}
.help p {
  margin: 4px 0;
}
.help-list {
  font-size: 12px;
  color: #909399;
  padding-left: 18px;
  line-height: 1.8;
  margin: 0;
}
.center-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.validation {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #e6a23c;
}
.validation.ok {
  color: #67c23a;
}
.canvas-wrap {
  flex: 1;
  overflow: auto;
  background: #f5f7fa;
  background-image: linear-gradient(#e8ebf0 1px, transparent 1px), linear-gradient(90deg, #e8ebf0 1px, transparent 1px);
  background-size: 20px 20px;
}
.flow-svg {
  width: 100%;
  height: 100%;
  min-height: 480px;
  cursor: crosshair;
  touch-action: none;
}
.node-g {
  cursor: move;
}
.node-g.active rect {
  filter: drop-shadow(0 0 4px rgba(64, 158, 255, 0.8));
}
.node-g.simulated rect {
  filter: drop-shadow(0 0 8px rgba(64, 158, 255, 0.9));
  stroke: #409eff !important;
  stroke-width: 3 !important;
}
.port {
  cursor: crosshair;
}
.port:hover {
  r: 7;
  fill: #f56c6c;
}
.edge-path {
  cursor: pointer;
}
.edge-path:hover {
  stroke: #409eff;
  stroke-width: 3;
}
.edge-path.active {
  stroke: #409eff;
  stroke-width: 3;
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
.field-inline {
  display: flex;
  gap: 10px;
}
.field-inline > div {
  flex: 1;
}
.hint {
  font-size: 12px;
  color: #909399;
  margin: 0 0 6px;
}
.sim-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.sim-status {
  font-size: 13px;
  color: #606266;
}
.preview-svg {
  width: 100%;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  background: #fafafa;
}
</style>
