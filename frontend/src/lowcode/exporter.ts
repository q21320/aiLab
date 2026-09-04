// 代码导出工具：将页面 Schema 转换为标准 Vue SFC 代码与 JSON

import type { SchemaNode, PageSchema } from "./types";

function indent(n: number): string {
  return "  ".repeat(n);
}

function camelToKebab(s: string): string {
  return s.replace(/([A-Z])/g, "-$1").toLowerCase();
}

function styleToStr(style?: Record<string, string>): string {
  if (!style || Object.keys(style).length === 0) return "";
  const css = Object.entries(style)
    .filter(([, v]) => v)
    .map(([k, v]) => `${camelToKebab(k)}: ${v}`)
    .join("; ");
  return css ? ` style="${css}"` : "";
}

function esc(s: string): string {
  return (s || "").replace(/"/g, "&quot;");
}

/** 递归渲染单个节点为模板字符串 */
function renderNode(node: SchemaNode, level: number): string {
  const pad = indent(level);
  const style = styleToStr(node.style);
  const p = node.props || {};
  const kids = (node.children || [])
    .map((c) => renderNode(c, level + 1))
    .join("\n");

  switch (node.type) {
    case "page":
      return `${pad}<div class="page"${style}>\n${kids}\n${pad}</div>`;
    case "container":
      return `${pad}<div${style}>\n${kids}\n${pad}</div>`;
    case "title": {
      const l = p.level || 2;
      return `${pad}<h${l}${style}>${esc(node.text || "")}</h${l}>`;
    }
    case "text":
      return `${pad}<p${style}>${esc(node.text || "")}</p>`;
    case "button": {
      const t = p.type ? ` type="${p.type}"` : "";
      const s = p.size ? ` size="${p.size}"` : "";
      const plain = p.plain ? " plain" : "";
      const round = p.round ? " round" : "";
      return `${pad}<el-button${t}${s}${plain}${round}${style}>${esc(node.text || "")}</el-button>`;
    }
    case "input": {
      const ph = p.placeholder ? ` placeholder="${esc(p.placeholder)}"` : "";
      const ty = p.type ? ` type="${p.type}"` : "";
      const rows = p.rows ? ` :rows="${p.rows}"` : "";
      const cl = p.clearable ? " clearable" : "";
      const sp = p.showPassword ? " show-password" : "";
      const pi = p.prefixIcon ? ` :prefix-icon="${p.prefixIcon}"` : "";
      return `${pad}<el-input${ph}${ty}${rows}${cl}${sp}${pi}${style} />`;
    }
    case "select": {
      const ph = p.placeholder ? ` placeholder="${esc(p.placeholder)}"` : "";
      const opts = (p.options || [])
        .map((o: string) => `${indent(level + 1)}<el-option label="${esc(o)}" value="${esc(o)}" />`)
        .join("\n");
      return `${pad}<el-select${ph}${style}>\n${opts}\n${pad}</el-select>`;
    }
    case "form": {
      const lw = p.labelWidth ? ` label-width="${p.labelWidth}"` : "";
      return `${pad}<el-form${lw}${style}>\n${kids}\n${pad}</el-form>`;
    }
    case "formItem": {
      const lb = p.label ? ` label="${esc(p.label)}"` : "";
      return `${pad}<el-form-item${lb}${style}>\n${kids}\n${pad}</el-form-item>`;
    }
    case "card": {
      const sh = p.shadow ? ` shadow="${p.shadow}"` : "";
      return `${pad}<el-card${sh}${style}>\n${kids}\n${pad}</el-card>`;
    }
    case "table": {
      const data = JSON.stringify(p.data || []).replace(/'/g, "\\'");
      const border = p.border ? " border" : "";
      const cols = (p.columns || [])
        .map((c: any) => {
          const w = c.width ? ` :width="${c.width}"` : "";
          return `${indent(level + 1)}<el-table-column prop="${c.prop}" label="${esc(c.label)}"${w} />`;
        })
        .join("\n");
      return `${pad}<el-table :data='${data}'${border}${style}>\n${cols}\n${pad}</el-table>`;
    }
    case "image": {
      const src = p.src ? ` src="${esc(p.src)}"` : "";
      const fit = p.fit ? ` fit="${p.fit}"` : "";
      return `${pad}<el-image${src}${fit}${style} />`;
    }
    case "divider":
      return `${pad}<el-divider${style} />`;
    case "row": {
      const g = p.gutter ? ` :gutter="${p.gutter}"` : "";
      return `${pad}<el-row${g}${style}>\n${kids}\n${pad}</el-row>`;
    }
    case "col": {
      const sp = p.span != null ? ` :span="${p.span}"` : "";
      return `${pad}<el-col${sp}${style}>\n${kids}\n${pad}</el-col>`;
    }
    case "tag": {
      const t = p.type ? ` type="${p.type}"` : "";
      return `${pad}<el-tag${t}${style}>${esc(node.text || "")}</el-tag>`;
    }
    case "space":
      return `${pad}<el-space${style}>\n${kids}\n${pad}</el-space>`;
    default:
      return `${pad}<!-- 未知组件: ${node.type} -->`;
  }
}

/** 导出为 Vue 单文件组件代码 */
export function schemaToVue(schema: PageSchema): string {
  const body = renderNode(schema, 1);
  return `<script setup lang="ts">
// 由 AI 低代码平台生成
// 依赖：Element Plus
<\/script>

<template>
${body}
</template>

<style scoped>
.page {
  padding: 20px;
}
</style>
`;
}

/** 导出为 JSON Schema 字符串 */
export function schemaToJson(schema: PageSchema): string {
  return JSON.stringify(schema, null, 2);
}
