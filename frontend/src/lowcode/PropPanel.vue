<script setup lang="ts">
import { computed } from "vue";
import type { SchemaNode } from "./types";
import { NODE_TYPE_LABELS } from "./types";

const props = defineProps<{
  node: SchemaNode | null;
}>();

// 工厂：生成绑定到 node.props[key] 的可写 computed
function propField(key: string) {
  return computed<any>({
    get: () => props.node?.props?.[key],
    set: (v) => {
      if (!props.node) return;
      props.node.props = props.node.props || {};
      props.node.props[key] = v;
    },
  });
}

// 工厂：生成绑定到 node.style[key] 的可写 computed
function styleField(key: string) {
  return computed<any>({
    get: () => props.node?.style?.[key],
    set: (v) => {
      if (!props.node) return;
      props.node.style = props.node.style || {};
      if (v) props.node.style[key] = v;
      else delete props.node.style[key];
    },
  });
}

const typeLabel = computed(() =>
  props.node ? NODE_TYPE_LABELS[props.node.type] || props.node.type : ""
);

const text = computed<string>({
  get: () => props.node?.text ?? "",
  set: (v) => {
    if (props.node) props.node.text = v;
  },
});

// 拥有文本内容的节点类型
const hasText = computed(() =>
  ["title", "text", "button", "tag"].includes(props.node?.type || "")
);

// 下拉选项：数组 <-> 逗号分隔字符串
const optionsText = computed<string>({
  get: () => (props.node?.props?.options || []).join(", "),
  set: (v) => {
    if (!props.node) return;
    props.node.props = props.node.props || {};
    props.node.props.options = v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
  },
});

// 组件属性字段
const typeProp = propField("type");
const sizeProp = propField("size");
const plainProp = propField("plain");
const roundProp = propField("round");
const placeholderProp = propField("placeholder");
const inputTypeProp = propField("type");
const clearableProp = propField("clearable");
const showPasswordProp = propField("showPassword");
const rowsProp = propField("rows");
const levelProp = propField("level");
const srcProp = propField("src");
const fitProp = propField("fit");
const shadowProp = propField("shadow");
const gutterProp = propField("gutter");
const spanProp = propField("span");

// 样式字段
const width = styleField("width");
const height = styleField("height");
const padding = styleField("padding");
const margin = styleField("margin");
const textAlign = styleField("textAlign");
const color = styleField("color");
const background = styleField("background");
</script>

<template>
  <div class="prop-panel">
    <template v-if="node">
      <div class="panel-header">
        <el-tag type="primary" effect="dark" size="small">{{ typeLabel }}</el-tag>
        <span class="node-id">{{ node.id }}</span>
      </div>

      <!-- 文本内容 -->
      <div v-if="hasText" class="field">
        <label>文本内容</label>
        <el-input v-model="text" type="textarea" :rows="2" />
      </div>

      <!-- 按钮 -->
      <template v-if="node.type === 'button'">
        <div class="field">
          <label>按钮类型</label>
          <el-select v-model="typeProp">
            <el-option label="默认" value="default" />
            <el-option label="主要" value="primary" />
            <el-option label="成功" value="success" />
            <el-option label="警告" value="warning" />
            <el-option label="危险" value="danger" />
            <el-option label="信息" value="info" />
          </el-select>
        </div>
        <div class="field">
          <label>尺寸</label>
          <el-select v-model="sizeProp" clearable>
            <el-option label="大" value="large" />
            <el-option label="默认" value="default" />
            <el-option label="小" value="small" />
          </el-select>
        </div>
        <div class="field field-inline">
          <el-checkbox v-model="plainProp">朴素</el-checkbox>
          <el-checkbox v-model="roundProp">圆角</el-checkbox>
        </div>
      </template>

      <!-- 输入框 -->
      <template v-if="node.type === 'input'">
        <div class="field">
          <label>占位提示</label>
          <el-input v-model="placeholderProp" />
        </div>
        <div class="field">
          <label>输入类型</label>
          <el-select v-model="inputTypeProp">
            <el-option label="文本" value="text" />
            <el-option label="密码" value="password" />
            <el-option label="多行文本" value="textarea" />
          </el-select>
        </div>
        <div v-if="inputTypeProp === 'textarea'" class="field">
          <label>行数</label>
          <el-input-number v-model="rowsProp" :min="1" :max="20" />
        </div>
        <div class="field field-inline">
          <el-checkbox v-model="clearableProp">可清空</el-checkbox>
          <el-checkbox v-model="showPasswordProp">密码可见</el-checkbox>
        </div>
      </template>

      <!-- 标题 -->
      <div v-if="node.type === 'title'" class="field">
        <label>标题级别</label>
        <el-select v-model="levelProp">
          <el-option v-for="l in 6" :key="l" :label="`H${l}`" :value="l" />
        </el-select>
      </div>

      <!-- 下拉选择 -->
      <template v-if="node.type === 'select'">
        <div class="field">
          <label>占位提示</label>
          <el-input v-model="placeholderProp" />
        </div>
        <div class="field">
          <label>选项（逗号分隔）</label>
          <el-input v-model="optionsText" type="textarea" :rows="2" />
        </div>
      </template>

      <!-- 图片 -->
      <template v-if="node.type === 'image'">
        <div class="field">
          <label>图片地址</label>
          <el-input v-model="srcProp" />
        </div>
        <div class="field">
          <label>填充方式</label>
          <el-select v-model="fitProp">
            <el-option label="裁剪" value="cover" />
            <el-option label="包含" value="contain" />
            <el-option label="拉伸" value="fill" />
          </el-select>
        </div>
      </template>

      <!-- 卡片 -->
      <div v-if="node.type === 'card'" class="field">
        <label>阴影</label>
        <el-select v-model="shadowProp">
          <el-option label="始终" value="always" />
          <el-option label="悬停" value="hover" />
          <el-option label="从不" value="never" />
        </el-select>
      </div>

      <!-- 栅格 -->
      <div v-if="node.type === 'row'" class="field">
        <label>栅格间隔</label>
        <el-input-number v-model="gutterProp" :min="0" :max="40" />
      </div>
      <div v-if="node.type === 'col'" class="field">
        <label>栅格宽度(span)</label>
        <el-input-number v-model="spanProp" :min="1" :max="24" />
      </div>

      <!-- 标签 -->
      <div v-if="node.type === 'tag'" class="field">
        <label>标签类型</label>
        <el-select v-model="typeProp">
          <el-option label="主要" value="primary" />
          <el-option label="成功" value="success" />
          <el-option label="警告" value="warning" />
          <el-option label="危险" value="danger" />
          <el-option label="信息" value="info" />
        </el-select>
      </div>

      <!-- 表格提示 -->
      <el-alert
        v-if="node.type === 'table'"
        title="表格的列与数据请在 Schema 视图中编辑"
        type="info"
        :closable="false"
        class="mb12"
      />

      <!-- 通用样式 -->
      <el-divider class="divider">样式</el-divider>
      <div class="field">
        <label>宽度</label>
        <el-input v-model="width" placeholder="如 240px / 100%" />
      </div>
      <div class="field">
        <label>高度</label>
        <el-input v-model="height" placeholder="如 200px / 50vh" />
      </div>
      <div class="field">
        <label>内边距</label>
        <el-input v-model="padding" placeholder="如 12px" />
      </div>
      <div class="field">
        <label>外边距</label>
        <el-input v-model="margin" placeholder="如 8px 0" />
      </div>
      <div class="field">
        <label>文本对齐</label>
        <el-select v-model="textAlign" clearable>
          <el-option label="左对齐" value="left" />
          <el-option label="居中" value="center" />
          <el-option label="右对齐" value="right" />
        </el-select>
      </div>
      <div class="field field-inline">
        <div class="color-item">
          <label>文字颜色</label>
          <el-color-picker v-model="color" />
        </div>
        <div class="color-item">
          <label>背景色</label>
          <el-color-picker v-model="background" />
        </div>
      </div>
    </template>

    <el-empty v-else description="点击预览中的组件进行编辑" :image-size="90" />
  </div>
</template>

<style scoped>
.prop-panel {
  font-size: 13px;
}
.panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.node-id {
  color: #c0c4cc;
  font-size: 11px;
  font-family: monospace;
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
  align-items: center;
  gap: 16px;
}
.color-item {
  display: flex;
  align-items: center;
  gap: 6px;
}
.color-item label {
  color: #606266;
}
.divider {
  margin: 16px 0;
}
.mb12 {
  margin-bottom: 12px;
}
</style>
