// ============================================================================
// 低代码平台 · 报表设计 Schema 类型定义
// ============================================================================

/** 数据字段类型 */
export type ReportFieldType = "string" | "number" | "date";

/** 数据集字段 */
export interface ReportField {
  name: string;
  label: string;
  type: ReportFieldType;
}

/** 报表数据集（字段 + 明细数据） */
export interface ReportDataset {
  id: string;
  name: string;
  fields: ReportField[];
  rows: Record<string, any>[];
}

/** 聚合方式 */
export type ReportAgg = "sum" | "avg" | "count" | "max" | "min";

/** 报表区块类型 */
export type ReportBlockKind = "metric" | "bar" | "line" | "pie" | "table";

/** 报表区块 */
export interface ReportBlock {
  id: string;
  kind: ReportBlockKind;
  title: string;
  /** 维度字段 */
  xField?: string;
  /** 指标字段 */
  yField?: string;
  agg?: ReportAgg;
  /** 明细表列的字段名 */
  columns?: string[];
  /** 指标卡：显示数值的字段 */
  metricField?: string;
  metricLabel?: string;
  color?: string;
}

/** 报表设计 Schema */
export interface ReportSchema {
  id: string;
  name: string;
  dataset: ReportDataset;
  blocks: ReportBlock[];
}

export const REPORT_BLOCK_LABELS: Record<ReportBlockKind, string> = {
  metric: "指标卡",
  bar: "柱状图",
  line: "折线图",
  pie: "饼图",
  table: "明细表",
};

export const REPORT_AGG_LABELS: Record<ReportAgg, string> = {
  sum: "求和",
  avg: "平均",
  count: "计数",
  max: "最大",
  min: "最小",
};
