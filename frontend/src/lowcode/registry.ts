// ============================================================================
// 低代码平台 · 组件注册表（扩展点）
//
// 新增一个页面组件只需三步：
//   1. 在 types.ts 的 NodeType 中追加类型
//   2. 在此处 registerPageComponent(...) 注册（图标/默认节点/分类/可嵌套）
//   3. 在 SchemaRenderer.vue 中添加渲染分支、在 exporter.ts 中添加导出分支
// 即可自动出现在「组件面板」并支持拖拉拽、属性编辑与代码导出。
// ============================================================================

import type { NodeType, SchemaNode } from "./types";

export type ComponentCategory = "layout" | "basic" | "data" | "form";

/** 组件定义 */
export interface PageComponentDef {
  type: NodeType;
  /** 中文名（组件面板展示） */
  label: string;
  /** Element Plus 图标组件名 */
  icon: string;
  category: ComponentCategory;
  /** 是否允许挂载子节点 */
  canChildren: boolean;
  /** 在面板中的默认标签 */
  tip?: string;
  /** 创建默认节点（新拖拽进画布的初始结构） */
  createDefault: () => SchemaNode;
}

let seq = 0;
function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 组件注册表（Map 便于 O(1) 查找） */
const registry = new Map<NodeType, PageComponentDef>();

/** 注册一个页面组件 */
export function registerPageComponent(def: PageComponentDef): void {
  registry.set(def.type, def);
}

/** 获取组件定义 */
export function getPageComponent(type: NodeType): PageComponentDef | undefined {
  return registry.get(type);
}

/** 列出全部组件（组件面板渲染入口） */
export function listPageComponents(): PageComponentDef[] {
  return Array.from(registry.values());
}

/** 按分类分组（组件面板分组渲染） */
export function groupPageComponents(): { category: ComponentCategory; label: string; items: PageComponentDef[] }[] {
  const groups: { category: ComponentCategory; label: string; items: PageComponentDef[] }[] = [];
  const categories: { key: ComponentCategory; label: string }[] = [
    { key: "layout", label: "布局容器" },
    { key: "basic", label: "基础组件" },
    { key: "form", label: "表单组件" },
    { key: "data", label: "数据组件" },
  ];
  for (const c of categories) {
    const items = listPageComponents().filter((d) => d.category === c.key);
    if (items.length) groups.push({ category: c.key, label: c.label, items });
  }
  return groups;
}

/** 创建默认节点（带唯一 id） */
export function createPageNode(type: NodeType): SchemaNode {
  const def = registry.get(type);
  if (!def) throw new Error(`未注册的组件类型：${type}`);
  const node = def.createDefault();
  node.id = uid(type);
  return node;
}

// ============================================================================
// 内置组件注册
// ============================================================================

// ---------- 布局容器 ----------
registerPageComponent({
  type: "container",
  label: "容器",
  icon: "Grid",
  category: "layout",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "container",
    style: { padding: "12px", borderRadius: "6px", background: "#ffffff", width: "100%" },
    children: [],
  }),
});

registerPageComponent({
  type: "card",
  label: "卡片",
  icon: "Postcard",
  category: "layout",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "card",
    props: { shadow: "never" },
    style: { width: "100%", maxWidth: "480px", margin: "0 auto" },
    children: [],
  }),
});

registerPageComponent({
  type: "row",
  label: "栅格行",
  icon: "Rows",
  category: "layout",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "row",
    props: { gutter: 16 },
    style: { width: "100%" },
    children: [],
  }),
});

registerPageComponent({
  type: "col",
  label: "栅格列",
  icon: "Column",
  category: "layout",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "col",
    props: { span: 12 },
    style: { width: "100%" },
    children: [],
  }),
});

registerPageComponent({
  type: "space",
  label: "间距",
  icon: "Operation",
  category: "layout",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "space",
    style: { width: "100%" },
    children: [],
  }),
});

// ---------- 基础组件 ----------
registerPageComponent({
  type: "title",
  label: "标题",
  icon: "Document",
  category: "basic",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "title",
    text: "标题文本",
    props: { level: 3 },
    style: { marginBottom: "8px" },
  }),
});

registerPageComponent({
  type: "text",
  label: "文本",
  icon: "EditPen",
  category: "basic",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "text",
    text: "这是一段说明文字，双击在右侧修改内容。",
    style: { color: "#606266", lineHeight: "1.8", marginBottom: "8px" },
  }),
});

registerPageComponent({
  type: "button",
  label: "按钮",
  icon: "Pointer",
  category: "basic",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "button",
    text: "主要按钮",
    props: { type: "primary", size: "default" },
    style: { marginRight: "8px" },
  }),
});

registerPageComponent({
  type: "image",
  label: "图片",
  icon: "Picture",
  category: "basic",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "image",
    props: { src: "https://element-plus.org/images/element-plus-logo-small.svg", fit: "cover" },
    style: { width: "200px", height: "120px", borderRadius: "6px" },
  }),
});

registerPageComponent({
  type: "divider",
  label: "分割线",
  icon: "Minus",
  category: "basic",
  canChildren: false,
  createDefault: () => ({ id: "", type: "divider", style: { margin: "12px 0" } }),
});

registerPageComponent({
  type: "tag",
  label: "标签",
  icon: "PriceTag",
  category: "basic",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "tag",
    text: "标签",
    props: { type: "primary" },
    style: { marginRight: "8px" },
  }),
});

// ---------- 表单组件 ----------
registerPageComponent({
  type: "form",
  label: "表单",
  icon: "DocumentChecked",
  category: "form",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "form",
    props: { labelWidth: "90px" },
    style: { width: "100%", maxWidth: "560px", margin: "0 auto" },
    children: [],
  }),
});

registerPageComponent({
  type: "formItem",
  label: "表单项",
  icon: "Tickets",
  category: "form",
  canChildren: true,
  createDefault: () => ({
    id: "",
    type: "formItem",
    props: { label: "表单项" },
    children: [],
  }),
});

registerPageComponent({
  type: "input",
  label: "输入框",
  icon: "Edit",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "input",
    props: { placeholder: "请输入", clearable: true },
    style: { width: "100%" },
  }),
});

registerPageComponent({
  type: "number",
  label: "数字输入",
  icon: "Odometer",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "number",
    props: { min: 0, max: 100, step: 1 },
    style: { width: "100%" },
  }),
});

registerPageComponent({
  type: "date",
  label: "日期",
  icon: "Calendar",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "date",
    props: { placeholder: "选择日期" },
    style: { width: "100%" },
  }),
});

registerPageComponent({
  type: "switch",
  label: "开关",
  icon: "SwitchButton",
  category: "form",
  canChildren: false,
  createDefault: () => ({ id: "", type: "switch" }),
});

registerPageComponent({
  type: "radio",
  label: "单选",
  icon: "CircleCheck",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "radio",
    props: { options: ["选项一", "选项二"] },
  }),
});

registerPageComponent({
  type: "checkbox",
  label: "多选",
  icon: "Finished",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "checkbox",
    props: { options: ["选项A", "选项B"] },
  }),
});

registerPageComponent({
  type: "select",
  label: "下拉选择",
  icon: "ArrowDownBold",
  category: "form",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "select",
    props: { placeholder: "请选择", options: ["选项一", "选项二", "选项三"] },
    style: { width: "100%" },
  }),
});

// ---------- 数据组件 ----------
registerPageComponent({
  type: "table",
  label: "表格",
  icon: "Grid",
  category: "data",
  canChildren: false,
  createDefault: () => ({
    id: "",
    type: "table",
    props: {
      border: true,
      columns: [
        { prop: "name", label: "名称", width: 160 },
        { prop: "status", label: "状态", width: 100 },
        { prop: "value", label: "数值" },
      ],
      data: [
        { name: "示例记录一", status: "正常", value: 1234 },
        { name: "示例记录二", status: "异常", value: 4321 },
      ],
    },
    style: { width: "100%" },
  }),
});
