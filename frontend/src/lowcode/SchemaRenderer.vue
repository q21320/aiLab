<script setup lang="ts">
import { computed, inject, ref } from "vue";
import { CopyDocument, Delete } from "@element-plus/icons-vue";
import type { SchemaNode } from "./types";
import { NODE_TYPE_LABELS, CONTAINER_TYPES } from "./types";
import { LC_DRAG_KEY, LC_ACTIONS_KEY } from "./lcCore";
// 组件递归引用自身，用于渲染子节点
import SchemaRenderer from "./SchemaRenderer.vue";

const props = withDefaults(
  defineProps<{
    node: SchemaNode;
    selectedId?: string;
    editable?: boolean;
  }>(),
  { selectedId: "", editable: false }
);

const emit = defineEmits<{
  (e: "select", node: SchemaNode): void;
}>();

const dragState = inject(LC_DRAG_KEY, null);
const actions = inject(LC_ACTIONS_KEY, null);

const isContainer = computed(() => CONTAINER_TYPES.includes(props.node.type));
const isSelected = computed(() => props.editable && props.selectedId === props.node.id);

// 子树 DOM 引用（用于计算拖拽插入位置）
const childRefs = ref<(Element | null)[]>([]);

function setChildRef(el: unknown, index: number) {
  childRefs.value[index] = (el as Element) || null;
}

/** 根据鼠标位置计算插入索引：以子树中线为分界 */
function computeDropIndex(ev: DragEvent): number {
  const els = childRefs.value.filter((v): v is Element => !!v);
  const containerEl = (ev.currentTarget as HTMLElement)?.getBoundingClientRect();
  if (!containerEl) return els.length;
  const style = (ev.currentTarget as HTMLElement)?.closest("[data-lc-node]") as HTMLElement | null;
  const row = style && style.style?.flexDirection === "row";
  const field = row ? ev.clientX : ev.clientY;
  let idx = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    const center = row ? r.left + r.width / 2 : r.top + r.height / 2;
    if (field < center) {
      idx = i;
      break;
    }
  }
  return idx;
}

function onContainerDragOver(ev: DragEvent, node: SchemaNode) {
  if (!props.editable || !dragState) return;
  if (!ev.dataTransfer?.types.includes("text/plain")) return;
  ev.preventDefault();
  dragState.active = true;
  dragState.parentId = node.id;
  dragState.index = computeDropIndex(ev);
}

function onContainerDrop(ev: DragEvent) {
  if (!props.editable || !dragState) return;
  ev.preventDefault();
  const parentId = dragState.parentId;
  const index = dragState.index;
  const payload = ev.dataTransfer?.getData("text/plain") || "";
  dragState.active = false;
  dragState.parentId = "";
  dragState.index = -1;
  if (actions && parentId && payload) actions.drop(parentId, index, payload);
}

function onContainerDragLeave() {
  if (dragState) {
    dragState.active = false;
    dragState.parentId = "";
    dragState.index = -1;
  }
}

/** 渲染拖拽插入位置的指示条 */
function isMarker(index: number): boolean {
  return !!(
    dragState &&
    dragState.active &&
    dragState.parentId === props.node.id &&
    dragState.index === index
  );
}

function selectSelf(ev: MouseEvent) {
  ev.stopPropagation();
  emit("select", props.node);
  actions?.select(props.node);
}

function forward(n: SchemaNode) {
  emit("select", n);
  actions?.select(n);
}

function removeSelf(ev: MouseEvent) {
  ev.stopPropagation();
  actions?.remove(props.node.id);
}
function duplicateSelf(ev: MouseEvent) {
  ev.stopPropagation();
  actions?.duplicate(props.node.id);
}

// 通用绑定：样式、选中态、点击、类型标记、节点拖拽
const binds = computed(() => ({
  class: [
    "lc-node",
    "lc-node--" + props.node.type,
    { "lc-node--selected": isSelected.value },
  ],
  style: props.node.style || {},
  "data-type": NODE_TYPE_LABELS[props.node.type] || props.node.type,
  "data-lc-node": true,
  onClick: selectSelf,
  draggable: props.editable && props.node.type !== "page",
  onDragstart: props.editable && props.node.type !== "page"
    ? (ev: DragEvent) => {
        ev.dataTransfer?.setData("text/plain", "move:" + props.node.id);
        if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
      }
    : undefined,
}));

// 容器节点附加拖拽绑定
const containerBinds = computed(() =>
  isContainer.value
    ? {
        onDragover: props.editable
          ? (ev: DragEvent) => {
              ev.stopPropagation();
              onContainerDragOver(ev, props.node);
            }
          : undefined,
        onDrop: props.editable
          ? (ev: DragEvent) => {
              ev.stopPropagation();
              onContainerDrop(ev);
            }
          : undefined,
        onDragleave: props.editable ? onContainerDragLeave : undefined,
      }
    : {}
);

const titleTag = computed(() => "h" + (props.node.props?.level || 2));
const p = computed(() => props.node.props || {});

// 合并基础绑定与容器拖拽绑定（Vue 不允许同一元素出现两个无参数 v-bind）
const allBinds = computed(() => ({ ...binds.value, ...containerBinds.value }));
</script>

<template>
  <!-- 页面根 / 容器 -->
  <div v-if="node.type === 'page' || node.type === 'container'" v-bind="allBinds">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
    <div v-if="editable && (node.children || []).length === 0" class="lc-empty-hint">
      拖拽左侧组件到此处
    </div>
  </div>

  <!-- 表单容器 -->
  <el-form v-else-if="node.type === 'form'" v-bind="allBinds" :label-width="p.labelWidth">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
    <div v-if="editable && (node.children || []).length === 0" class="lc-empty-hint">
      拖拽表单项/组件到此处
    </div>
  </el-form>

  <!-- 表单项 -->
  <el-form-item v-else-if="node.type === 'formItem'" v-bind="allBinds" :label="p.label">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
  </el-form-item>

  <!-- 卡片 -->
  <el-card v-else-if="node.type === 'card'" v-bind="allBinds" :shadow="p.shadow || 'never'">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
  </el-card>

  <!-- 栅格行 -->
  <el-row v-else-if="node.type === 'row'" v-bind="allBinds" :gutter="p.gutter || 0">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
  </el-row>

  <!-- 栅格列 -->
  <el-col v-else-if="node.type === 'col'" v-bind="allBinds" :span="p.span ?? 24">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
  </el-col>

  <!-- 间距容器 -->
  <el-space v-else-if="node.type === 'space'" v-bind="allBinds">
    <template v-for="(child, i) in node.children || []" :key="child.id">
      <div v-if="editable && isMarker(i)" class="lc-drop-marker"></div>
      <SchemaRenderer
        :ref="(el) => setChildRef(el, i)"
        :node="child"
        :selected-id="selectedId"
        :editable="editable"
        @select="forward"
      />
    </template>
    <div v-if="editable && isMarker((node.children || []).length)" class="lc-drop-marker"></div>
  </el-space>

  <!-- 标题 -->
  <component
    v-else-if="node.type === 'title'"
    :is="titleTag"
    v-bind="binds"
    class="lc-title"
  >
    {{ node.text }}
  </component>

  <!-- 文本 -->
  <p v-else-if="node.type === 'text'" v-bind="binds" class="lc-text">{{ node.text }}</p>

  <!-- 按钮 -->
  <el-button
    v-else-if="node.type === 'button'"
    v-bind="binds"
    :type="p.type || 'default'"
    :size="p.size"
    :plain="p.plain"
    :round="p.round"
  >
    {{ node.text }}
  </el-button>

  <!-- 输入框 -->
  <el-input
    v-else-if="node.type === 'input'"
    v-bind="binds"
    :placeholder="p.placeholder"
    :type="p.type || 'text'"
    :rows="p.rows"
    :clearable="p.clearable"
    :show-password="p.showPassword"
  />

  <!-- 数字输入 -->
  <el-input-number
    v-else-if="node.type === 'number'"
    v-bind="binds"
    :min="p.min"
    :max="p.max"
    :step="p.step"
    controls-position="right"
  />

  <!-- 日期选择 -->
  <el-date-picker
    v-else-if="node.type === 'date'"
    v-bind="binds"
    type="date"
    :placeholder="p.placeholder || '选择日期'"
  />

  <!-- 开关 -->
  <el-switch v-else-if="node.type === 'switch'" v-bind="binds" />

  <!-- 单选 -->
  <el-radio-group v-else-if="node.type === 'radio'" v-bind="binds">
    <el-radio v-for="opt in p.options || []" :key="opt" :label="opt" class="lc-inline">{{ opt }}</el-radio>
  </el-radio-group>

  <!-- 多选 -->
  <el-checkbox-group v-else-if="node.type === 'checkbox'" v-bind="binds">
    <el-checkbox v-for="opt in p.options || []" :key="opt" class="lc-inline">{{ opt }}</el-checkbox>
  </el-checkbox-group>

  <!-- 下拉选择 -->
  <el-select v-else-if="node.type === 'select'" v-bind="binds" :placeholder="p.placeholder">
    <el-option v-for="opt in p.options || []" :key="opt" :label="opt" :value="opt" />
  </el-select>

  <!-- 表格 -->
  <el-table v-else-if="node.type === 'table'" v-bind="binds" :data="p.data || []" :border="p.border">
    <el-table-column
      v-for="col in p.columns || []"
      :key="col.prop"
      :prop="col.prop"
      :label="col.label"
      :width="col.width"
    />
  </el-table>

  <!-- 图片 -->
  <el-image v-else-if="node.type === 'image'" v-bind="binds" :src="p.src" :fit="p.fit || 'cover'" />

  <!-- 分割线 -->
  <el-divider v-else-if="node.type === 'divider'" v-bind="binds" />

  <!-- 标签 -->
  <el-tag v-else-if="node.type === 'tag'" v-bind="binds" :type="p.type || 'primary'">
    {{ node.text }}
  </el-tag>

  <!-- 未知类型兜底 -->
  <div v-else v-bind="binds" class="lc-unknown">未知组件：{{ node.type }}</div>

  <!-- 编辑态快捷操作 -->
  <div
    v-if="editable && isSelected"
    class="lc-actions"
    @mousedown.stop
    @click.stop
  >
    <el-button size="small" text class="lc-mini-btn" :icon="CopyDocument" @click="duplicateSelf">
      复制
    </el-button>
    <el-button size="small" text class="lc-mini-btn danger" :icon="Delete" @click="removeSelf">
      删除
    </el-button>
  </div>
</template>

<style scoped>
.lc-node {
  position: relative;
  cursor: pointer;
  min-width: 0;
}
.lc-node:hover {
  outline: 1px dashed #a0cfff;
}
.lc-node--selected,
.lc-node--selected:hover {
  outline: 2px solid #409eff;
}
.lc-node--selected::after {
  content: attr(data-type);
  position: absolute;
  top: 0;
  left: 0;
  transform: translateY(-100%);
  background: #409eff;
  color: #fff;
  font-size: 11px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 3px 3px 0 0;
  z-index: 60;
  white-space: nowrap;
  pointer-events: none;
}
.lc-actions {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 70;
  transform: translateY(-100%);
  background: #409eff;
  border-radius: 4px 4px 0 0;
  display: flex;
  padding: 2px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
}
.lc-mini-btn {
  color: #fff !important;
  padding: 2px 6px !important;
  font-size: 12px;
}
.lc-mini-btn.danger:hover {
  color: #ffd04b !important;
}
.lc-drop-marker {
  height: 3px;
  margin: 2px 0;
  background: #409eff;
  border-radius: 2px;
  pointer-events: none;
}
.lc-empty-hint {
  padding: 12px;
  text-align: center;
  color: #c0c4cc;
  font-size: 12px;
  border: 1px dashed #dcdfe6;
  border-radius: 6px;
  margin: 6px 0;
}
.lc-inline {
  margin-right: 12px;
}
.lc-title {
  font-weight: 600;
  color: #1f2d3d;
  margin: 0;
}
.lc-text {
  margin: 0;
  color: #606266;
  line-height: 1.6;
}
.lc-unknown {
  padding: 8px;
  color: #f56c6c;
  border: 1px dashed #f56c6c;
}
</style>
