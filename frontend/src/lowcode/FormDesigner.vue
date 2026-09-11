<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import {
  Download,
  Delete,
  CopyDocument,
  View,
  Top,
  Bottom,
  Rank,
  Promotion,
} from "@element-plus/icons-vue";
import { useLowcodeStore } from "./store";
import { defaultFormSchema } from "./defaults";
import PublishDialog from "./PublishDialog.vue";
import type { PublishedApp } from "./publish";
import { submitToCustomApi, submitToPlatform } from "../api/forms";
import {
  FORM_FIELD_LABELS,
  FORM_FIELD_DEFAULT_OPTIONS,
  type FormField,
  type FormFieldType,
  type FormSchema,
} from "./formTypes";
import { clone, uid } from "./schemaOps";
import { formToVue } from "./formExporter";

const store = useLowcodeStore();
const form = ref<FormSchema>(clone(store.projects.form || defaultFormSchema()));
const selectedId = ref("");
const selectedField = computed<FormField | undefined>(() =>
  form.value.fields.find((f) => f.id === selectedId.value)
);

// 画布设备宽度
type DeviceMode = "pc" | "tablet" | "phone";
const deviceMode = ref<DeviceMode>("pc");
const deviceWidth = computed(() =>
  deviceMode.value === "pc" ? "100%" : deviceMode.value === "tablet" ? "768px" : "375px"
);

// ---------------------------------------------------------------------------
// 字段组件面板（扩展点：向 FIELD_PALETTE 添加类型即可扩展）
// ---------------------------------------------------------------------------
const FIELD_PALETTE: { type: FormFieldType; label: string; icon: string }[] = [
  { type: "input", label: "单行输入", icon: "Edit" },
  { type: "textarea", label: "多行输入", icon: "Document" },
  { type: "number", label: "数字输入", icon: "Odometer" },
  { type: "select", label: "下拉选择", icon: "ArrowDownBold" },
  { type: "radio", label: "单选框", icon: "CircleCheck" },
  { type: "checkbox", label: "多选框", icon: "Finished" },
  { type: "date", label: "日期选择", icon: "Calendar" },
  { type: "switch", label: "开关", icon: "SwitchButton" },
  { type: "rating", label: "评分", icon: "Star" },
  { type: "slider", label: "滑块", icon: "SetUp" },
  { type: "upload", label: "文件上传", icon: "UploadFilled" },
  { type: "text", label: "只读文本", icon: "Tickets" },
];

function createField(type: FormFieldType): FormField {
  const label = FORM_FIELD_LABELS[type] || type;
  let idx = 1;
  const used = form.value.fields.map((f) => f.name);
  while (used.includes(`field_${idx}`)) idx += 1;
  const field: FormField = {
    id: uid("f"),
    type,
    label,
    name: `field_${idx}`,
    required: false,
    span: form.value.fieldSpan ?? 12,
  };
  if (["select", "radio", "checkbox"].includes(type)) {
    field.options = clone(FORM_FIELD_DEFAULT_OPTIONS[type] || []);
  }
  if (type === "input" || type === "textarea" || type === "select") {
    field.placeholder = `请输入${label}${type === "select" ? "（点击下拉）" : ""}`;
  }
  return field;
}

// ---------------------------------------------------------------------------
// 拖拽（调色板 → 画布；画布内排序）
// ---------------------------------------------------------------------------
const fieldEls = ref<(Element | null)[]>([]);
const dragOverIndex = ref(-1);
const draggingId = ref("");
const paletteType = ref<FormFieldType | "">("");

function setFieldRef(el: unknown, i: number) {
  fieldEls.value[i] = (el as Element) || null;
}

function computeIndex(ev: DragEvent): number {
  const els = fieldEls.value.filter((v): v is Element => !!v);
  let idx = els.length;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (ev.clientY < r.top + r.height / 2) {
      idx = i;
      break;
    }
  }
  return idx;
}

function onCanvasDragOver(ev: DragEvent) {
  ev.preventDefault();
  dragOverIndex.value = computeIndex(ev);
}
function onCanvasDragLeave() {
  dragOverIndex.value = -1;
}
function onCanvasDrop(ev: DragEvent) {
  ev.preventDefault();
  const idx = dragOverIndex.value;
  dragOverIndex.value = -1;
  const id = draggingId.value;
  const type = paletteType.value;
  draggingId.value = "";
  paletteType.value = "";
  if (id) {
    // 画布内移动
    const from = form.value.fields.findIndex((f) => f.id === id);
    if (from < 0) return;
    const list = form.value.fields.slice();
    const [item] = list.splice(from, 1);
    const target = idx > from ? idx - 1 : idx;
    list.splice(Math.max(0, Math.min(target, list.length)), 0, item);
    form.value.fields = list;
    return;
  }
  if (type) {
    const field = createField(type as FormFieldType);
    const list = form.value.fields.slice();
    list.splice(Math.max(0, Math.min(idx, list.length)), 0, field);
    form.value.fields = list;
    selectedId.value = field.id;
  }
}

function onPaletteDragStart(ev: DragEvent, type: FormFieldType) {
  paletteType.value = type;
  ev.dataTransfer?.setData("text/plain", type);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
}
function onFieldDragStart(ev: DragEvent, field: FormField) {
  draggingId.value = field.id;
  ev.dataTransfer?.setData("text/plain", "move:" + field.id);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
}

function addField(type: FormFieldType) {
  const field = createField(type);
  form.value.fields.push(field);
  selectedId.value = field.id;
}

// ---------------------------------------------------------------------------
// 字段操作
// ---------------------------------------------------------------------------
function removeField(id: string) {
  form.value.fields = form.value.fields.filter((f) => f.id !== id);
  if (selectedId.value === id) selectedId.value = "";
}
function duplicateField(field: FormField) {
  const copy = clone(field);
  copy.id = uid("f");
  if (copy.name) copy.name = copy.name + "_copy";
  const list = form.value.fields.slice();
  const idx = list.findIndex((f) => f.id === field.id);
  list.splice(idx + 1, 0, copy);
  form.value.fields = list;
  selectedId.value = copy.id;
}
function moveField(id: string, dir: -1 | 1) {
  const list = form.value.fields.slice();
  const idx = list.findIndex((f) => f.id === id);
  const target = idx + dir;
  if (idx < 0 || target < 0 || target >= list.length) return;
  const [item] = list.splice(idx, 1);
  list.splice(target, 0, item);
  form.value.fields = list;
}

// ---------------------------------------------------------------------------
// 字段属性（右侧面板绑定）
// ---------------------------------------------------------------------------
function bindField<K extends keyof FormField>(key: K) {
  return computed<any>({
    get: () => selectedField.value?.[key],
    set: (v) => {
      if (selectedField.value) (selectedField.value as any)[key] = v;
    },
  });
}
const fLabel = bindField("label");
const fName = bindField("name");
const fPlaceholder = bindField("placeholder");
const fRequired = bindField("required");
const fMessage = bindField("message");
const fSpan = bindField("span");
const fDisabled = bindField("disabled");
const fDefault = bindField("defaultValue");

function fieldProp<K extends keyof NonNullable<FormField["props"]>>(key: K) {
  return computed<any>({
    get: () => selectedField.value?.props?.[key],
    set: (v) => {
      if (!selectedField.value) return;
      selectedField.value.props = selectedField.value.props || {};
      if (v !== undefined && v !== null) selectedField.value.props[key] = v;
      else delete selectedField.value.props[key];
    },
  });
}
const pMin = fieldProp("min");
const pMax = fieldProp("max");
const pStep = fieldProp("step");
const pRows = fieldProp("rows");
const pRateMax = fieldProp("max");

// 选项编辑（select/radio/checkbox）
const optionsText = computed<string>({
  get: () => (selectedField.value?.options || []).map((o) => o.label).join(", "),
  set: (v) => {
    if (!selectedField.value) return;
    selectedField.value.options = v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((label, i) => ({ label, value: i + 1 }));
  },
});

// ---------------------------------------------------------------------------
// 表单设置（右侧面板）
// ---------------------------------------------------------------------------
const settingsTab = ref<"field" | "form">("field");
const formName = computed<string>({
  get: () => form.value.name,
  set: (v) => (form.value.name = v),
});
const formLabelWidth = computed<number>({
  get: () => form.value.labelWidth ?? 100,
  set: (v) => (form.value.labelWidth = v),
});
const formFieldSpan = computed<number>({
  get: () => form.value.fieldSpan ?? 12,
  set: (v) => (form.value.fieldSpan = v),
});
const formSubmitText = computed<string>({
  get: () => form.value.submitText ?? "提交",
  set: (v) => (form.value.submitText = v),
});
const formSubmitApi = computed<string>({
  get: () => form.value.submitApi ?? "",
  set: (v) => (form.value.submitApi = v),
});
const formShowTitle = computed<boolean>({
  get: () => form.value.showTitle !== false,
  set: (v) => (form.value.showTitle = v),
});

// ---------------------------------------------------------------------------
// 预览（交互式：校验 + 提交数据查看）
// ---------------------------------------------------------------------------
const previewVisible = ref(false);
const previewDevice = ref<DeviceMode>("pc");
const previewData = ref<Record<string, any>>({});
const previewRules = computed<FormRules>(() => {
  const rules: FormRules = {};
  for (const f of form.value.fields) {
    if (f.required) rules[f.name] = [{ required: true, message: f.message || `请填写${f.label}`, trigger: "blur" }];
  }
  return rules;
});
const previewFormRef = ref<FormInstance>();
const submitted = ref("");
const submittedId = ref("");
function openPreview() {
  previewData.value = {};
  form.value.fields.forEach((f) => {
    previewData.value[f.name] = f.defaultValue ?? (f.type === "checkbox" ? [] : f.type === "switch" ? false : "");
  });
  submitted.value = "";
  submittedId.value = "";
  previewVisible.value = true;
}
async function submitPreview() {
  const valid = await previewFormRef.value?.validate().catch(() => false);
  if (!valid) {
    ElMessage.warning("请检查必填项");
    return;
  }
  submitted.value = JSON.stringify(previewData.value, null, 2);
  const custom = (form.value.submitApi || "").trim();
  const res = custom
    ? await submitToCustomApi(custom, previewData.value)
    : await submitToPlatform(form.value.id, form.value.name, previewData.value);
  if (res.ok) {
    submittedId.value = res.id || "";
    ElMessage.success(res.id ? `提交成功，提交编号 ${res.id}` : "提交成功");
  } else {
    ElMessage.error(`提交失败：${res.error || "未知错误"}`);
  }
}

// ---------------------------------------------------------------------------
// 导出
// ---------------------------------------------------------------------------
const exportVisible = ref(false);
const exportType = ref<"vue" | "json">("vue");
const exportCode = ref("");
function openExport(type: "vue" | "json") {
  exportType.value = type;
  exportCode.value = type === "vue" ? formToVue(form.value) : JSON.stringify(form.value, null, 2);
  exportVisible.value = true;
}
async function copyCode() {
  try {
    await navigator.clipboard.writeText(exportCode.value);
    ElMessage.success("已复制");
  } catch {
    ElMessage.error("复制失败");
  }
}

function downloadCode() {
  const filename = exportType.value === "vue" ? "GeneratedForm.vue" : "form-schema.json";
  const blob = new Blob([exportCode.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已开始下载");
}

// ---------------------------------------------------------------------------
// 自动保存
// ---------------------------------------------------------------------------
const savedAt = ref("");
let saveTimer: number | undefined;
watch(
  () => form.value,
  () => {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.saveProject("form", clone(form.value));
      savedAt.value = new Date().toLocaleTimeString();
    }, 800);
  },
  { deep: true }
);

// 键盘删除
function onKeydown(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  if ((e.key === "Delete" || e.key === "Backspace") && selectedId.value) {
    e.preventDefault();
    removeField(selectedId.value);
  }
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

function resetExample() {
  form.value = clone(defaultFormSchema());
  selectedId.value = "";
  ElMessage.success("已恢复示例表单");
}
function createNew() {
  form.value = {
    id: uid("form"),
    name: "未命名表单",
    showTitle: true,
    labelWidth: 100,
    fieldSpan: 24,
    submitText: "提交",
    submitApi: "",
    fields: [],
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
  <div class="form-designer">
    <!-- 左：字段面板 -->
    <aside class="side side-left">
      <div class="side-title">
        <el-icon><Rank /></el-icon>
        <span>字段组件</span>
      </div>
      <p class="side-desc">拖拽或点击字段到画布，支持画布内拖拽排序。</p>
      <div
        v-for="fp in FIELD_PALETTE"
        :key="fp.type"
        class="palette-item"
        draggable="true"
        @dragstart="onPaletteDragStart($event, fp.type)"
        @click="addField(fp.type)"
      >
        <el-icon><component :is="fp.icon" /></el-icon>
        <span>{{ fp.label }}</span>
      </div>
    </aside>

    <!-- 中：画布 -->
    <section class="side side-center">
      <div class="center-toolbar">
        <el-radio-group v-model="deviceMode" size="small">
          <el-radio-button value="pc">PC</el-radio-button>
          <el-radio-button value="tablet">平板</el-radio-button>
          <el-radio-button value="phone">手机</el-radio-button>
        </el-radio-group>
        <div class="toolbar-group">
          <el-button size="small" type="primary" :icon="Promotion" @click="publishVisible = true">发布</el-button>
          <el-button size="small" :icon="View" @click="openPreview">预览</el-button>
          <el-button size="small" :icon="Download" @click="openExport('vue')">导出</el-button>
          <el-button size="small" @click="createNew">新建</el-button>
          <el-button size="small" @click="resetExample">示例</el-button>
        </div>
      </div>

      <div class="canvas-scroll">
        <div class="canvas-frame" :style="{ maxWidth: deviceWidth }">
          <div
            class="form-canvas"
            @dragover.prevent="onCanvasDragOver"
            @dragleave="onCanvasDragLeave"
            @drop.prevent="onCanvasDrop"
            @click="selectedId = ''"
          >
            <h3 v-if="form.showTitle" class="form-title">{{ form.name }}</h3>
            <el-form :label-width="(form.labelWidth || 100) + 'px'" label-position="right">
              <el-row :gutter="16">
                <template v-for="(f, i) in form.fields" :key="f.id">
                  <div v-if="dragOverIndex === i" class="drop-marker"></div>
                  <el-col :ref="(el: any) => setFieldRef(el, i)" :span="f.span ?? form.fieldSpan ?? 24">
                    <div
                      class="field-shell"
                      :class="{ selected: f.id === selectedId }"
                      draggable="true"
                      @dragstart="onFieldDragStart($event, f)"
                      @click.stop="selectedId = f.id"
                    >
                      <el-form-item :label="f.label">
                        <div class="fb-control fb-control--design">
                          <!-- 设计态控件（禁用交互） -->
                          <el-input v-if="f.type === 'input'" :placeholder="f.placeholder" disabled />
                          <el-input v-else-if="f.type === 'textarea'" type="textarea" :rows="f.props?.rows || 3" :placeholder="f.placeholder" disabled />
                          <el-input-number v-else-if="f.type === 'number'" :min="f.props?.min ?? 0" :max="f.props?.max ?? 9999" disabled />
                          <el-select v-else-if="f.type === 'select'" :placeholder="f.placeholder" disabled>
                            <el-option v-for="o in f.options" :key="String(o.value)" :label="o.label" :value="o.value" />
                          </el-select>
                          <el-radio-group v-else-if="f.type === 'radio'" disabled>
                            <el-radio v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-radio>
                          </el-radio-group>
                          <el-checkbox-group v-else-if="f.type === 'checkbox'" disabled>
                            <el-checkbox v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-checkbox>
                          </el-checkbox-group>
                          <el-date-picker v-else-if="f.type === 'date'" type="date" :placeholder="f.placeholder || '选择日期'" disabled />
                          <el-switch v-else-if="f.type === 'switch'" disabled />
                          <el-rate v-else-if="f.type === 'rating'" :max="f.props?.max || 5" disabled />
                          <el-slider v-else-if="f.type === 'slider'" :min="f.props?.min ?? 0" :max="f.props?.max ?? 100" disabled />
                          <el-button v-else-if="f.type === 'upload'" disabled>上传文件</el-button>
                          <span v-else-if="f.type === 'text'" class="form-text">{{ f.placeholder || f.label }}</span>
                          <el-input v-else :placeholder="f.placeholder" disabled />
                          <span class="required-star" v-if="f.required">*</span>
                        </div>
                      </el-form-item>
                      <!-- 字段快捷操作 -->
                      <div class="field-ops" @click.stop>
                        <el-tooltip content="上移">
                          <el-button size="small" text :icon="Top" @click="moveField(f.id, -1)" />
                        </el-tooltip>
                        <el-tooltip content="下移">
                          <el-button size="small" text :icon="Bottom" @click="moveField(f.id, 1)" />
                        </el-tooltip>
                        <el-tooltip content="复制">
                          <el-button size="small" text :icon="CopyDocument" @click="duplicateField(f)" />
                        </el-tooltip>
                        <el-tooltip content="删除">
                          <el-button size="small" text type="danger" :icon="Delete" @click="removeField(f.id)" />
                        </el-tooltip>
                      </div>
                    </div>
                  </el-col>
                </template>
                <div v-if="dragOverIndex === form.fields.length" class="drop-marker"></div>
                <el-col :span="24">
                  <el-button type="primary" class="submit-btn">{{ form.submitText || "提交" }}</el-button>
                </el-col>
              </el-row>
              <el-empty v-if="form.fields.length === 0" description="从左侧拖拽字段到此处开始设计" :image-size="100" />
            </el-form>
          </div>
        </div>
      </div>

      <div class="center-footer">
        <span>共 {{ form.fields.length }} 个字段</span>
        <span v-if="savedAt">已自动保存 {{ savedAt }}</span>
      </div>
    </section>

    <!-- 右：属性 -->
    <aside class="side side-right">
      <el-tabs v-model="settingsTab" class="right-tabs">
        <el-tab-pane label="字段属性" name="field">
          <template v-if="selectedField">
            <div class="field">
              <label>组件类型</label>
              <el-input :model-value="FORM_FIELD_LABELS[selectedField.type]" disabled />
            </div>
            <div class="field">
              <label>标签</label>
              <el-input v-model="fLabel" />
            </div>
            <div class="field">
              <label>字段名（提交 key）</label>
              <el-input v-model="fName" />
            </div>
            <div v-if="['input', 'textarea', 'select'].includes(selectedField.type)" class="field">
              <label>占位提示</label>
              <el-input v-model="fPlaceholder" />
            </div>
            <div v-if="['select', 'radio', 'checkbox'].includes(selectedField.type)" class="field">
              <label>选项（逗号分隔）</label>
              <el-input v-model="optionsText" type="textarea" :rows="2" />
            </div>
            <div v-if="selectedField.type === 'number'" class="field field-inline">
              <div><label>最小值</label><el-input-number v-model="pMin" :controls="false" style="width: 100%" /></div>
              <div><label>最大值</label><el-input-number v-model="pMax" :controls="false" style="width: 100%" /></div>
              <div><label>步长</label><el-input-number v-model="pStep" :controls="false" style="width: 100%" /></div>
            </div>
            <div v-if="selectedField.type === 'textarea'" class="field">
              <label>行数</label>
              <el-input-number v-model="pRows" :min="1" :max="20" />
            </div>
            <div v-if="selectedField.type === 'rating'" class="field">
              <label>最大分数</label>
              <el-input-number v-model="pRateMax" :min="3" :max="10" />
            </div>
            <div class="field">
              <label>宽度占比（1-24，24 为整行）</label>
              <el-input-number v-model="fSpan" :min="1" :max="24" />
            </div>
            <div class="field">
              <label>默认值</label>
              <el-input v-model="fDefault" placeholder="可选" />
            </div>
            <div class="field field-inline">
              <el-checkbox v-model="fRequired">必填</el-checkbox>
              <el-checkbox v-model="fDisabled">禁用</el-checkbox>
            </div>
            <div v-if="fRequired" class="field">
              <label>校验提示</label>
              <el-input v-model="fMessage" placeholder="如：姓名不能为空" />
            </div>
          </template>
          <el-empty v-else description="点击画布中的字段进行编辑" :image-size="80" />
        </el-tab-pane>

        <el-tab-pane label="表单设置" name="form">
          <div class="field">
            <label>表单名称</label>
            <el-input v-model="formName" />
          </div>
          <div class="field field-inline">
            <el-checkbox v-model="formShowTitle">显示表单标题</el-checkbox>
          </div>
          <div class="field">
            <label>标签宽度 (px)</label>
            <el-input-number v-model="formLabelWidth" :min="0" :max="240" />
          </div>
          <div class="field">
            <label>默认字段宽度 (1-24)</label>
            <el-input-number v-model="formFieldSpan" :min="1" :max="24" />
          </div>
          <div class="field">
            <label>提交按钮文本</label>
            <el-input v-model="formSubmitText" />
          </div>
          <div class="field">
            <label>提交 API（对接后端）</label>
            <el-input v-model="formSubmitApi" placeholder="POST /api/xxx" />
          </div>
        </el-tab-pane>
      </el-tabs>
    </aside>

    <!-- 预览 -->
    <el-dialog v-model="previewVisible" title="表单预览（支持校验与提交模拟）" width="780px" top="5vh">
      <div style="text-align: center; margin-bottom: 12px">
        <el-radio-group v-model="previewDevice" size="small">
          <el-radio-button value="pc">PC</el-radio-button>
          <el-radio-button value="tablet">平板</el-radio-button>
          <el-radio-button value="phone">手机</el-radio-button>
        </el-radio-group>
      </div>
      <div class="preview-frame" :style="{ maxWidth: previewDevice === 'pc' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px' }">
        <el-form ref="previewFormRef" :model="previewData" :rules="previewRules" :label-width="(form.labelWidth || 100) + 'px'">
          <h3 v-if="form.showTitle" class="form-title">{{ form.name }}</h3>
          <el-row :gutter="16">
            <el-col v-for="f in form.fields" :key="f.id" :span="previewDevice === 'phone' ? 24 : f.span ?? form.fieldSpan ?? 24">
              <el-form-item :label="f.label" :prop="f.name">
                <el-input v-if="f.type === 'input'" v-model="previewData[f.name]" :placeholder="f.placeholder" :disabled="f.disabled" />
                <el-input v-else-if="f.type === 'textarea'" v-model="previewData[f.name]" type="textarea" :rows="f.props?.rows || 3" :placeholder="f.placeholder" :disabled="f.disabled" />
                <el-input-number v-else-if="f.type === 'number'" v-model="previewData[f.name]" :min="f.props?.min ?? 0" :max="f.props?.max ?? 9999" :disabled="f.disabled" />
                <el-select v-else-if="f.type === 'select'" v-model="previewData[f.name]" :placeholder="f.placeholder" :disabled="f.disabled" style="width: 100%">
                  <el-option v-for="o in f.options" :key="String(o.value)" :label="o.label" :value="o.value" />
                </el-select>
                <el-radio-group v-else-if="f.type === 'radio'" v-model="previewData[f.name]" :disabled="f.disabled">
                  <el-radio v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-radio>
                </el-radio-group>
                <el-checkbox-group v-else-if="f.type === 'checkbox'" v-model="previewData[f.name]" :disabled="f.disabled">
                  <el-checkbox v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-checkbox>
                </el-checkbox-group>
                <el-date-picker v-else-if="f.type === 'date'" v-model="previewData[f.name]" type="date" :placeholder="f.placeholder || '选择日期'" :disabled="f.disabled" />
                <el-switch v-else-if="f.type === 'switch'" v-model="previewData[f.name]" :disabled="f.disabled" />
                <el-rate v-else-if="f.type === 'rating'" v-model="previewData[f.name]" :max="f.props?.max || 5" :disabled="f.disabled" />
                <el-slider v-else-if="f.type === 'slider'" v-model="previewData[f.name]" :min="f.props?.min ?? 0" :max="f.props?.max ?? 100" :disabled="f.disabled" />
                <el-button v-else-if="f.type === 'upload'" :disabled="f.disabled">上传文件</el-button>
                <span v-else-if="f.type === 'text'" class="form-text">{{ previewData[f.name] || f.placeholder || f.label }}</span>
                <el-input v-else v-model="previewData[f.name]" :placeholder="f.placeholder" />
              </el-form-item>
            </el-col>
            <el-col :span="24">
              <el-button type="primary" class="submit-btn" @click="submitPreview">{{ form.submitText || "提交" }}</el-button>
            </el-col>
          </el-row>
        </el-form>
        <template v-if="submitted">
          <el-divider>
            提交结果
            <el-tag v-if="submittedId" size="small" type="success" effect="plain" style="margin-left: 8px">
              提交编号 {{ submittedId }}
            </el-tag>
          </el-divider>
          <pre class="code-block">{{ submitted }}</pre>
        </template>
      </div>
    </el-dialog>

    <!-- 导出 -->
    <el-dialog v-model="exportVisible" title="导出表单" width="720px" top="6vh">
      <div class="export-tabs">
        <el-radio-group v-model="exportType" size="small">
          <el-radio-button value="vue">Vue 组件</el-radio-button>
          <el-radio-button value="json">JSON Schema</el-radio-button>
        </el-radio-group>
        <div>
          <el-button size="small" @click="copyCode">复制</el-button>
          <el-button size="small" type="primary" :icon="Download" @click="downloadCode">下载</el-button>
        </div>
      </div>
      <pre class="code-block"><code>{{ exportCode }}</code></pre>
    </el-dialog>

    <!-- 发布对话框 -->
    <PublishDialog
      v-model="publishVisible"
      kind="form"
      :schema="form"
      :default-name="form.name || '表单应用'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.form-designer {
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
  width: 230px;
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}
.side-right {
  width: 300px;
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
}
.canvas-scroll {
  flex: 1;
  overflow: auto;
  background: #e8ebf0;
  padding: 20px;
}
.canvas-frame {
  margin: 0 auto;
  background: #fff;
  border-radius: 8px;
  padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
.form-canvas {
  min-height: 400px;
}
.form-title {
  text-align: center;
  margin: 0 0 18px;
  color: #1f2d3d;
}
.field-shell {
  position: relative;
  border: 1px dashed transparent;
  border-radius: 6px;
  padding: 4px;
  transition: all 0.15s;
  margin-bottom: 4px;
}
.field-shell:hover {
  border-color: #a0cfff;
}
.field-shell.selected {
  border-color: #409eff;
  background: rgba(64, 158, 255, 0.04);
}
.field-ops {
  position: absolute;
  top: 0;
  right: 0;
  z-index: 30;
  display: none;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 4px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.field-shell:hover .field-ops,
.field-shell.selected .field-ops {
  display: flex;
}
.fb-control--design {
  position: relative;
  pointer-events: none;
}
.required-star {
  color: #f56c6c;
  position: absolute;
  right: -12px;
  top: 8px;
}
.drop-marker {
  width: 100%;
  height: 3px;
  background: #409eff;
  border-radius: 2px;
  margin: 2px 0;
  pointer-events: none;
}
.form-text {
  color: #606266;
}
.right-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.right-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 10px;
}
.right-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
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
  gap: 12px;
  flex-wrap: wrap;
}
.field-inline > div {
  flex: 1;
  min-width: 80px;
}
.center-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #ebeef5;
}
.preview-frame {
  margin: 0 auto;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fff;
  padding: 16px;
  max-height: 66vh;
  overflow: auto;
}
.submit-btn {
  width: 160px;
}
.export-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.code-block {
  margin: 0;
  padding: 16px;
  background: #282c34;
  color: #abb2bf;
  border-radius: 6px;
  max-height: 60vh;
  overflow: auto;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
