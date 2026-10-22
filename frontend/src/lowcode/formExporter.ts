// ============================================================================
// 低代码平台 · 表单设计 → Vue 单文件组件导出
// ============================================================================

import type { FormSchema } from "./formTypes";

function esc(s: string): string {
  return (s || "").replace(/"/g, "&quot;");
}

function indent(n: number): string {
  return "  ".repeat(n);
}

/** 字段控件渲染 */
function renderControl(f: FormSchema["fields"][number], lv: number): string {
  const pad = indent(lv);
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
  // 修复：原来只有 input 类型导出 disabled，其它控件勾选「禁用」后导出仍可交互。
  // 统一在此生成 disabled 属性，保证所有控件行为一致。
  const dis = f.disabled ? " disabled" : "";
  switch (f.type) {
    case "input":
      return `${pad}<el-input v-model="form.${f.name}"${ph}${dis} />`;
    case "textarea":
      return `${pad}<el-input v-model="form.${f.name}" type="textarea" :rows="${f.props?.rows || 3}"${ph}${dis} />`;
    case "number":
      return `${pad}<el-input-number v-model="form.${f.name}" :min="${f.props?.min ?? 0}" :max="${f.props?.max ?? 9999}"${dis} />`;
    case "select": {
      const opts = (f.options || [])
        .map((o) => `${indent(lv + 1)}<el-option label="${esc(o.label)}" :value='${JSON.stringify(o.value)}' />`)
        .join("\n");
      return `${pad}<el-select v-model="form.${f.name}"${ph}${dis}>${f.options?.length ? "\n" + opts + "\n" + pad : ""}</el-select>`;
    }
    case "radio": {
      const opts = (f.options || [])
        .map((o) => `${indent(lv + 1)}<el-radio :label='${JSON.stringify(o.value)}'>${esc(o.label)}</el-radio>`)
        .join("\n");
      return `${pad}<el-radio-group v-model="form.${f.name}"${dis}>\n${opts}\n${pad}</el-radio-group>`;
    }
    case "checkbox": {
      const opts = (f.options || [])
        .map((o) => `${indent(lv + 1)}<el-checkbox :label='${JSON.stringify(o.value)}'>${esc(o.label)}</el-checkbox>`)
        .join("\n");
      return `${pad}<el-checkbox-group v-model="form.${f.name}"${dis}>\n${opts}\n${pad}</el-checkbox-group>`;
    }
    case "date":
      return `${pad}<el-date-picker v-model="form.${f.name}" type="date"${ph}${dis} />`;
    case "switch":
      return `${pad}<el-switch v-model="form.${f.name}"${dis} />`;
    case "rating":
      return `${pad}<el-rate v-model="form.${f.name}" :max="${f.props?.max ?? 5}"${dis} />`;
    case "slider":
      return `${pad}<el-slider v-model="form.${f.name}" :min="${f.props?.min ?? 0}" :max="${f.props?.max ?? 100}"${dis} />`;
    case "upload":
      return `${pad}<el-upload action=""><el-button>上传文件</el-button></el-upload>`;
    case "text":
      return `${pad}<span class="form-text">{{ form.${f.name} }}</span>`;
    default:
      return `${pad}<el-input v-model="form.${f.name}"${ph} />`;
  }
}

/** 导出表单为 Vue SFC */
export function formToVue(form: FormSchema): string {
  const rules = form.fields
    .filter((f) => f.required)
    .map(
      (f) =>
        `${indent(4)}${f.name}: [{ required: true, message: "${esc(f.message || `请填写${f.label}`)}", trigger: "blur" }]`
    )
    .join(",\n");

  const body = form.fields
    .map((f) => {
      const lv = 3;
      const pad = indent(lv);
      const span = f.span ?? form.fieldSpan ?? 24;
      return `${pad}<el-col :span="${span}">\n${indent(lv + 1)}<el-form-item label="${esc(f.label)}" prop="${f.name}">\n${renderControl(f, lv + 2)}\n${indent(lv + 1)}</el-form-item>\n${pad}</el-col>`;
    })
    .join("\n");

  return `<script setup lang="ts">
// 由 AI Lab 低代码平台 · 表单设计器生成
// 依赖：Element Plus
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";

const formRef = ref();
const form = reactive({
${form.fields
  .map((f) => `${indent(2)}${f.name}: ${JSON.stringify(defaultFor(f))},`)
  .join("\n")}
});

const rules = {
${rules}
};

function onSubmit() {
  formRef.value?.validate((valid: boolean) => {
    if (valid) {
      ElMessage.success("提交成功，请对接后端接口保存数据");
      console.log(JSON.stringify(form));
    }
  });
}
<\/script>

<template>
  <el-form ref="formRef" :model="form" :rules="rules" :label-width="'${form.labelWidth || 100}px'">
${form.showTitle ? `${indent(2)}<h3 style="text-align: center">${esc(form.name)}</h3>\n` : ""}    <el-row :gutter="16">
${body}
      <el-col :span="24">
        <el-form-item>
          <el-button type="primary" @click="onSubmit">${esc(form.submitText || "提交")}</el-button>
        </el-form-item>
      </el-col>
    </el-row>
  </el-form>
</template>
`;
}

/** 格式化字段默认值 */
function defaultFor(f: FormSchema["fields"][number]): any {
  if (f.defaultValue !== undefined) return f.defaultValue;
  if (f.type === "checkbox") return [];
  if (f.type === "switch") return false;
  return "";
}
