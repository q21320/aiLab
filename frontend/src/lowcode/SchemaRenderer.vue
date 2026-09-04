<script setup lang="ts">
import { computed } from "vue";
import type { SchemaNode } from "./types";
import { NODE_TYPE_LABELS } from "./types";
// 组件递归引用自身，用于渲染子节点
import SchemaRenderer from "./SchemaRenderer.vue";

const props = defineProps<{
  node: SchemaNode;
  selectedId?: string;
}>();

const emit = defineEmits<{
  (e: "select", node: SchemaNode): void;
}>();

// 点击节点时选中，并阻止冒泡避免选中父节点
function selectSelf(ev: MouseEvent) {
  ev.stopPropagation();
  emit("select", props.node);
}

// 子节点选中事件向上转发
function forward(n: SchemaNode) {
  emit("select", n);
}

// 绑定到每个节点根元素的通用属性：样式、选中态、点击、类型标记
const binds = computed(() => ({
  class: ["lc-node", { "lc-node--selected": props.selectedId === props.node.id }],
  style: props.node.style || {},
  "data-type": NODE_TYPE_LABELS[props.node.type] || props.node.type,
  onClick: selectSelf,
}));

const titleTag = computed(() => "h" + (props.node.props?.level || 2));
const p = computed(() => props.node.props || {});
</script>

<template>
  <!-- 页面根 / 容器 -->
  <div v-if="node.type === 'page' || node.type === 'container'" v-bind="binds">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </div>

  <!-- 标题 -->
  <component v-else-if="node.type === 'title'" :is="titleTag" v-bind="binds" class="lc-title">
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
    :prefix-icon="p.prefixIcon"
  />

  <!-- 下拉选择 -->
  <el-select v-else-if="node.type === 'select'" v-bind="binds" :placeholder="p.placeholder">
    <el-option v-for="opt in p.options || []" :key="opt" :label="opt" :value="opt" />
  </el-select>

  <!-- 表单 -->
  <el-form v-else-if="node.type === 'form'" v-bind="binds" :label-width="p.labelWidth">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-form>

  <!-- 表单项 -->
  <el-form-item v-else-if="node.type === 'formItem'" v-bind="binds" :label="p.label">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-form-item>

  <!-- 卡片 -->
  <el-card v-else-if="node.type === 'card'" v-bind="binds" :shadow="p.shadow || 'never'">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-card>

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

  <!-- 栅格行 -->
  <el-row v-else-if="node.type === 'row'" v-bind="binds" :gutter="p.gutter || 0">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-row>

  <!-- 栅格列 -->
  <el-col v-else-if="node.type === 'col'" v-bind="binds" :span="p.span ?? 24">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-col>

  <!-- 标签 -->
  <el-tag v-else-if="node.type === 'tag'" v-bind="binds" :type="p.type || 'primary'">
    {{ node.text }}
  </el-tag>

  <!-- 间距容器 -->
  <el-space v-else-if="node.type === 'space'" v-bind="binds">
    <SchemaRenderer
      v-for="child in node.children || []"
      :key="child.id"
      :node="child"
      :selected-id="selectedId"
      @select="forward"
    />
  </el-space>

  <!-- 未知类型兜底 -->
  <div v-else v-bind="binds" class="lc-unknown">未知组件：{{ node.type }}</div>
</template>

<style scoped>
.lc-node {
  position: relative;
  cursor: pointer;
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
  z-index: 20;
  white-space: nowrap;
  pointer-events: none;
}
.lc-title {
  font-weight: 600;
  color: #1f2d3d;
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
