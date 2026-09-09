// ============================================================================
// 低代码平台 · 表单设计 Schema 类型定义
// ============================================================================

/** 表单字段类型 */
export type FormFieldType =
  | "input"
  | "textarea"
  | "number"
  | "select"
  | "radio"
  | "checkbox"
  | "date"
  | "switch"
  | "rating"
  | "slider"
  | "upload"
  | "text";

/** 下拉/单选/多选的选项 */
export interface FormOption {
  label: string;
  value: any;
}

/** 单个表单项 */
export interface FormField {
  id: string;
  /** 控件类型 */
  type: FormFieldType;
  /** 字段标签 */
  label: string;
  /** 字段名（提交数据 key） */
  name: string;
  placeholder?: string;
  options?: FormOption[];
  /** 是否必填 */
  required?: boolean;
  /** 校验规则提示文字 */
  message?: string;
  /** 联动提示/默认值 */
  defaultValue?: any;
  /** 栅格宽度（1-24，占整行 24） */
  span?: number;
  disabled?: boolean;
  /** 扩展属性：min/max/step/rows 等 */
  props?: Record<string, any>;
}

/** 表单设计 Schema */
export interface FormSchema {
  id: string;
  name: string;
  /** 是否显示表单标题 */
  showTitle?: boolean;
  /** 标签宽度 px */
  labelWidth?: number;
  /** 默认字段栅格宽度 */
  fieldSpan?: number;
  /** 提交按钮文本 */
  submitText?: string;
  /** 提交目标 API（可对接后端，B/S 架构） */
  submitApi?: string;
  /** 字段列表 */
  fields: FormField[];
}

/** 字段类型中文名 */
export const FORM_FIELD_LABELS: Record<FormFieldType, string> = {
  input: "单行输入",
  textarea: "多行输入",
  number: "数字输入",
  select: "下拉选择",
  radio: "单选框",
  checkbox: "多选框",
  date: "日期选择",
  switch: "开关",
  rating: "评分",
  slider: "滑块",
  upload: "文件上传",
  text: "只读文本",
};

/** 常用提示 */
export const FORM_FIELD_DEFAULT_OPTIONS: Record<string, FormOption[]> = {
  select: [
    { label: "选项一", value: 1 },
    { label: "选项二", value: 2 },
    { label: "选项三", value: 3 },
  ],
  radio: [
    { label: "是", value: true },
    { label: "否", value: false },
  ],
  checkbox: [
    { label: "选项A", value: "A" },
    { label: "选项B", value: "B" },
    { label: "选项C", value: "C" },
  ],
};
