// ============================================================================
// 低代码平台 · 页面设计 Schema 类型定义
// ============================================================================

/** 支持的组件类型 */
export type NodeType =
  | "page"
  | "container"
  | "title"
  | "text"
  | "button"
  | "input"
  | "number"
  | "date"
  | "switch"
  | "radio"
  | "checkbox"
  | "select"
  | "form"
  | "formItem"
  | "table"
  | "card"
  | "image"
  | "divider"
  | "row"
  | "col"
  | "tag"
  | "space";

/** 表格列定义 */
export interface TableColumn {
  prop: string;
  label: string;
  width?: number;
}

/** 单个 Schema 节点 */
export interface SchemaNode {
  /** 唯一标识 */
  id: string;
  /** 组件类型 */
  type: NodeType;
  /** 文本内容（标题/文字/按钮等） */
  text?: string;
  /** 组件属性，如按钮 type、输入框 placeholder、表格 columns/data 等 */
  props?: Record<string, any>;
  /** 内联样式 */
  style?: Record<string, string>;
  /** 子节点 */
  children?: SchemaNode[];
}

/** 整个页面的 Schema 根节点 */
export interface PageSchema extends SchemaNode {
  type: "page";
  children: SchemaNode[];
}

/** 页面组件的默认属性映射（属性面板回退值与 Schema 约定） */
export const NODE_TYPE_LABELS: Record<NodeType, string> = {
  page: "页面",
  container: "容器",
  title: "标题",
  text: "文本",
  button: "按钮",
  input: "输入框",
  number: "数字输入",
  date: "日期选择",
  switch: "开关",
  radio: "单选",
  checkbox: "多选",
  select: "下拉选择",
  form: "表单",
  formItem: "表单项",
  table: "表格",
  card: "卡片",
  image: "图片",
  divider: "分割线",
  row: "行",
  col: "列",
  tag: "标签",
  space: "间距",
};

/** 允许挂载子节点的容器类型 */
export const CONTAINER_TYPES: NodeType[] = [
  "page",
  "container",
  "form",
  "formItem",
  "card",
  "row",
  "col",
  "space",
];
