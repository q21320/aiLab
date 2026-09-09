<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { SchemaNode } from "./types";
import { NODE_TYPE_LABELS } from "./types";
import { getPageComponent } from "./registry";

const props = defineProps<{
  node: SchemaNode | null;
}>();

/** 属性字段定义（扩展点：新组件在这里追加字段即可自动获得属性编辑器） */
interface FieldDef {
  key: string;
  label: string;
  control: "text" | "textarea" | "number" | "switch" | "select" | "color" | "options" | "json";
  options?: { label: string; value: any }[];
  placeholder?: string;
}

const FIELD_DEFS: Record<string, FieldDef[]> = {
  button: [
    { key: "type", label: "按钮类型", control: "select", options: [
      { label: "默认", value: "default" }, { label: "主要", value: "primary" },
      { label: "成功", value: "success" }, { label: "警告", value: "warning" },
      { label: "危险", value: "danger" }, { label: "信息", value: "info" },
    ]},
    { key: "size", label: "尺寸", control: "select", options: [
      { label: "大", value: "large" }, { label: "默认", value: "default" }, { label: "小", value: "small" },
    ]},
    { key: "plain", label: "朴素", control: "switch" },
    { key: "round", label: "圆角", control: "switch" },
  ],
  input: [
    { key: "placeholder", label: "占位提示", control: "text" },
    { key: "type", label: "输入类型", control: "select", options: [
      { label: "文本", value: "text" }, { label: "密码", value: "password" }, { label: "多行文本", value: "textarea" },
    ]},
    { key: "rows", label: "行数（多行时）", control: "number" },
    { key: "clearable", label: "可清空", control: "switch" },
    { key: "showPassword", label: "密码可见", control: "switch" },
  ],
  number: [
    { key: "min", label: "最小值", control: "number" },
    { key: "max", label: "最大值", control: "number" },
    { key: "step", label: "步长", control: "number" },
  ],
  date: [
    { key: "placeholder", label: "占位提示", control: "text" },
  ],
  select: [
    { key: "placeholder", label: "占位提示", control: "text" },
    { key: "options", label: "选项（逗号分隔）", control: "options" },
  ],
  radio: [{ key: "options", label: "选项（逗号分隔）", control: "options" }],
  checkbox: [{ key: "options", label: "选项（逗号分隔）", control: "options" }],
  title: [
    { key: "level", label: "标题级别", control: "select", options: Array.from({ length: 6 }, (_, i) => ({ label: `H${i + 1}`, value: i + 1 })) },
  ],
  image: [
    { key: "src", label: "图片地址", control: "text", placeholder: "https://..." },
    { key: "fit", label: "填充方式", control: "select", options: [
      { label: "裁剪", value: "cover" }, { label: "包含", value: "contain" }, { label: "拉伸", value: "fill" },
    ]},
  ],
  card: [
    { key: "shadow", label: "阴影", control: "select", options: [
      { label: "始终", value: "always" }, { label: "悬停", value: "hover" }, { label: "从不", value: "never" },
    ]},
  ],
  row: [{ key: "gutter", label: "栅格间隔", control: "number" }],
  col: [{ key: "span", label: "栅格宽度 (1-24)", control: "number" }],
  tag: [
    { key: "type", label: "标签类型", control: "select", options: [
      { label: "主要", value: "primary" }, { label: "成功", value: "success" }, { label: "警告", value: "warning" },
      { label: "危险", value: "danger" }, { label: "信息", value: "info" },
    ]},
  ],
  form: [{ key: "labelWidth", label: "标签宽度", control: "text", placeholder: "90px" }],
  formItem: [{ key: "label", label: "标签文本", control: "text" }],
  table: [
    { key: "border", label: "显示边框", control: "switch" },
  ],
};

const typeLabel = computed(() =>
  props.node ? NODE_TYPE_LABELS[props.node.type] || props.node.type : ""
);

const fieldsFor = computed<FieldDef[]>(() =>
  props.node ? FIELD_DEFS[props.node.type] || [] : []
);

// 节点文本（拥有文本内容的组件）
const hasText = computed(() => {
  const t = props.node?.type;
  return ["title", "text", "button", "tag"].includes(t || "");
});
const text = computed<string>({
  get: () => props.node?.text ?? "",
  set: (v) => { if (props.node) props.node.text = v; },
});

/** 选项 <-> 逗号文本 */
function optionsField(key: string) {
  return computed<string>({
    get: () => (props.node?.props?.[key] || []).join(", "),
    set: (v) => {
      if (!props.node) return;
      props.node.props = props.node.props || {};
      props.node.props[key] = v
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
    },
  });
}

/** 取字段显示值（options 控件显示逗号文本） */
function fieldGet(f: FieldDef): any {
  if (f.control === "options") return optionsField(f.key).value;
  return props.node?.props?.[f.key];
}

/** 写字段值（options 控件解析逗号文本） */
function fieldSet(f: FieldDef, v: any) {
  if (f.control === "options") {
    optionsField(f.key).value = v;
    return;
  }
  if (!props.node) return;
  props.node.props = props.node.props || {};
  if (v !== "" && v !== null && v !== undefined) props.node.props[f.key] = v;
  else delete props.node.props[f.key];
}

/** JSON 文本编辑（表格数据等） */
const jsonText = ref("");
const jsonError = ref(false);
watch(
  () => props.node?.id,
  () => {
    jsonText.value = props.node?.type === "table" ? JSON.stringify(props.node?.props?.data || [], null, 2) : "";
    jsonError.value = false;
  },
  { immediate: true }
);
function applyJson() {
  if (!props.node) return;
  try {
    const v = JSON.parse(jsonText.value);
    props.node.props = props.node.props || {};
    props.node.props.data = Array.isArray(v) ? v : [v];
    jsonError.value = false;
  } catch {
    jsonError.value = true;
  }
}

// 表格列编辑
const columns = computed({
  get: () => (props.node?.type === "table" ? (props.node.props?.columns || []) : []) as any[],
  set: (v) => {
    if (!props.node) return;
    props.node.props = props.node.props || {};
    props.node.props.columns = v;
  },
});
function addColumn() {
  const n = columns.value.length + 1;
  const list = columns.value.concat({ prop: `field${n}`, label: `列${n}`, width: 140 });
  columns.value = list;
}
function removeColumn(i: number) {
  const list = columns.value.slice();
  list.splice(i, 1);
  columns.value = list;
}

// 样式编辑
function styleField(key: string) {
  return computed<string>({
    get: () => props.node?.style?.[key] ?? "",
    set: (v) => {
      if (!props.node) return;
      props.node.style = props.node.style || {};
      if (v) props.node.style[key] = v;
      else delete props.node.style[key];
    },
  });
}
const styleWidth = styleField("width");
const styleHeight = styleField("height");
const stylePadding = styleField("padding");
const styleMargin = styleField("margin");
const styleBg = styleField("background");
const styleColor = styleField("color");
const styleAlign = styleField("textAlign");
const styleFontSize = styleField("fontSize");

/** 自定义样式键值对 */
const customStyles = computed<{ k: string; v: string }[]>(() => {
  const s = props.node?.style || {};
  const common = ["width", "height", "padding", "margin", "background", "color", "textAlign", "fontSize"];
  return Object.entries(s || {})
    .filter(([k]) => !common.includes(k))
    .map(([k, v]) => ({ k, v: v ?? "" }));
});
function setCustomStyle(k: string, v: string) {
  if (!props.node) return;
  props.node.style = props.node.style || {};
  if (v) props.node.style[k] = v;
  else delete props.node.style[k];
}
function addCustomStyle() {
  if (!props.node) return;
  props.node.style = props.node.style || {};
  let i = 1;
  let key = "custom1";
  while (props.node.style[key] !== undefined) {
    i += 1;
    key = `custom${i}`;
  }
  props.node.style[key] = "";
}
function removeCustomStyle(k: string) {
  setCustomStyle(k, "");
}

const compTip = computed(() => getPageComponent(props.node?.type || ("" as any))?.tip || "");
</script>

<template>
  <div class="prop-panel">
    <template v-if="node">
      <div class="panel-header">
        <el-tag type="primary" effect="dark" size="small">{{ typeLabel }}</el-tag>
        <span class="node-id">{{ node.id }}</span>
        <span v-if="compTip" class="tip">{{ compTip }}</span>
      </div>

      <!-- 文本内容 -->
      <div v-if="hasText" class="field">
        <label>内容</label>
        <el-input v-model="text" type="textarea" :rows="2" />
      </div>

      <!-- 通用属性字段 -->
      <div v-for="f in fieldsFor" :key="f.key" class="field">
        <label>{{ f.label }}</label>
        <el-select
          v-if="f.control === 'select'"
          :model-value="fieldGet(f)"
          :placeholder="f.placeholder"
          @update:model-value="fieldSet(f, $event)"
        >
          <el-option v-for="o in f.options" :key="String(o.value)" :label="o.label" :value="o.value" />
        </el-select>
        <el-input
          v-else-if="f.control === 'text'"
          :model-value="fieldGet(f)"
          :placeholder="f.placeholder"
          @update:model-value="fieldSet(f, $event)"
        />
        <el-input
          v-else-if="f.control === 'textarea' || f.control === 'options'"
          :model-value="fieldGet(f)"
          type="textarea"
          :rows="3"
          :placeholder="f.placeholder"
          @update:model-value="fieldSet(f, $event)"
        />
        <el-input-number
          v-else-if="f.control === 'number'"
          :model-value="fieldGet(f)"
          :controls="false"
          style="width: 100%"
          @update:model-value="fieldSet(f, $event)"
        />
        <el-switch
          v-else-if="f.control === 'switch'"
          :model-value="fieldGet(f)"
          @update:model-value="fieldSet(f, $event)"
        />
        <el-color-picker
          v-else-if="f.control === 'color'"
          :model-value="fieldGet(f)"
          @update:model-value="fieldSet(f, $event)"
        />
      </div>

      <!-- 表格：列管理 -->
      <template v-if="node.type === 'table'">
        <el-divider class="divider">表格列</el-divider>
        <div v-for="(col, i) in columns" :key="i" class="col-row">
          <el-input v-model="col.label" size="small" placeholder="列名" style="width: 90px" />
          <el-input v-model="col.prop" size="small" placeholder="字段" style="flex: 1" />
          <el-input-number v-model="col.width" size="small" :controls="false" :min="40" style="width: 70px" />
          <el-button size="small" text type="danger" @click="removeColumn(i)">删</el-button>
        </div>
        <el-button size="small" style="width: 100%" @click="addColumn">+ 添加列</el-button>

        <el-divider class="divider">表格数据 (JSON)</el-divider>
        <el-input
          v-model="jsonText"
          type="textarea"
          :rows="8"
          spellcheck="false"
          :class="{ 'json-error': jsonError }"
          placeholder='[{"字段": "值"}]'
        />
        <el-button size="small" type="primary" style="width: 100%; margin-top: 6px" @click="applyJson">
          应用数据
        </el-button>
      </template>

      <!-- 通用样式 -->
      <el-divider class="divider">样式</el-divider>
      <div class="field">
        <label>宽度</label>
        <el-input v-model="styleWidth" placeholder="如 240px / 100%" />
      </div>
      <div class="field">
        <label>高度</label>
        <el-input v-model="styleHeight" placeholder="如 200px / 50vh" />
      </div>
      <div class="field">
        <label>内边距</label>
        <el-input v-model="stylePadding" placeholder="如 12px" />
      </div>
      <div class="field">
        <label>外边距</label>
        <el-input v-model="styleMargin" placeholder="如 8px 0" />
      </div>
      <div class="field">
        <label>字号</label>
        <el-input v-model="styleFontSize" placeholder="如 14px" />
      </div>
      <div class="field">
        <label>文本对齐</label>
        <el-select v-model="styleAlign" clearable placeholder="默认">
          <el-option label="左对齐" value="left" />
          <el-option label="居中" value="center" />
          <el-option label="右对齐" value="right" />
        </el-select>
      </div>
      <div class="field field-inline">
        <div class="color-item">
          <label>文字颜色</label>
          <el-color-picker v-model="styleColor" />
        </div>
        <div class="color-item">
          <label>背景色</label>
          <el-color-picker v-model="styleBg" />
        </div>
      </div>

      <!-- 自定义样式 -->
      <el-divider class="divider">高级样式</el-divider>
      <div v-for="cs in customStyles" :key="cs.k" class="col-row">
        <el-input v-model="cs.k" size="small" disabled style="width: 110px" />
        <el-input v-model="cs.v" size="small" placeholder="值" style="flex: 1" @change="setCustomStyle(cs.k, $event)" />
        <el-button size="small" text type="danger" @click="removeCustomStyle(cs.k)">删</el-button>
      </div>
      <el-button size="small" style="width: 100%" @click="addCustomStyle">+ 添加样式键</el-button>
      <p class="hint">支持任意 CSS 键，如 display、flexDirection、justifyContent、borderRadius。</p>
    </template>

    <el-empty v-else description="点击画布中的组件进行编辑" :image-size="90" />
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
  flex-wrap: wrap;
}
.node-id {
  color: #c0c4cc;
  font-size: 11px;
  font-family: monospace;
}
.tip {
  color: #909399;
  font-size: 11px;
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
.col-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}
.json-error :deep(textarea) {
  border-color: #f56c6c;
}
.hint {
  color: #909399;
  font-size: 11px;
  line-height: 1.5;
  margin: 6px 0 0;
}
</style>
