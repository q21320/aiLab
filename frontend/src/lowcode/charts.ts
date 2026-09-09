// ============================================================================
// 低代码平台 · 图表引擎（报表/大屏共用）
// ============================================================================

import * as echarts from "echarts";
import type { ReportAgg } from "./reportTypes";

export { echarts };

/** 调色板 */
export const PALETTE = [
  "#409eff",
  "#67c23a",
  "#e6a23c",
  "#f56c6c",
  "#9254de",
  "#00bcd4",
  "#ff8a65",
  "#7cb342",
  "#f06292",
  "#7986cb",
];

/** 按维度分组聚合 */
export function groupAggregate(
  rows: Record<string, any>[],
  dimField: string,
  measureField: string,
  agg: ReportAgg = "sum"
): { labels: string[]; values: number[] } {
  const groups = new Map<string, number[]>();
  for (const row of rows) {
    const key = String(row[dimField] ?? "-");
    const val = Number(row[measureField]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(Number.isFinite(val) ? val : 0);
  }
  const labels: string[] = [];
  const values: number[] = [];
  for (const [key, nums] of groups) {
    labels.push(key);
    let v = 0;
    switch (agg) {
      case "sum":
        v = nums.reduce((a, b) => a + b, 0);
        break;
      case "avg":
        v = nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
        break;
      case "max":
        v = Math.max(...nums);
        break;
      case "min":
        v = Math.min(...nums);
        break;
      case "count":
        v = nums.length;
        break;
    }
    values.push(Math.round(v * 100) / 100);
  }
  return { labels, values };
}

/** 计算图表配置（水印/空态/数据缺失兜底） */
export function chartOption(
  kind: "bar" | "line" | "pie",
  labels: string[],
  values: number[],
  color?: string,
  title?: string
): echarts.EChartsOption {
  const base = {
    color: color ? [color, ...PALETTE.filter((c) => c !== color)] : PALETTE,
    title: title
      ? {
          text: title,
          left: "center",
          textStyle: { fontSize: 14, color: "#606266" },
        }
      : undefined,
    tooltip: { trigger: kind === "pie" ? "item" : "axis" },
    grid: { left: 48, right: 24, top: title ? 44 : 24, bottom: 36 },
  } as echarts.EChartsOption;

  if (kind === "bar") {
    return {
      ...base,
      xAxis: { type: "category", data: labels, axisLabel: { color: "#909399" } },
      yAxis: { type: "value", axisLabel: { color: "#909399" }, splitLine: { lineStyle: { color: "#f0f2f5" } } },
      series: [{ type: "bar", data: values, barMaxWidth: 36, itemStyle: { borderRadius: [4, 4, 0, 0] } }],
    };
  }
  if (kind === "line") {
    return {
      ...base,
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { color: "#909399" } },
      yAxis: { type: "value", axisLabel: { color: "#909399" }, splitLine: { lineStyle: { color: "#f0f2f5" } } },
      series: [{ type: "line", data: values, smooth: true, symbolSize: 6, areaStyle: { opacity: 0.12 } }],
    };
  }
  return {
    ...base,
    legend: { bottom: 0, textStyle: { color: "#909399" }, type: "scroll" },
    series: [
      {
        type: "pie",
        radius: ["38%", "66%"],
        center: ["50%", "48%"],
        data: labels.map((l, i) => ({ name: l, value: values[i] })),
        label: { color: "#606266" },
        itemStyle: { borderColor: "#fff", borderWidth: 1 },
      },
    ],
  };
}

/** 大屏深色主题图表配置 */
export function screenOption(
  kind: "bar" | "line" | "pie",
  labels: string[],
  values: number[],
  color?: string
): echarts.EChartsOption {
  const c = color || "#00e5ff";
  const axis = {
    axisLine: { lineStyle: { color: "rgba(255,255,255,0.25)" } },
    axisLabel: { color: "rgba(255,255,255,0.75)", fontSize: 11 },
    splitLine: { lineStyle: { color: "rgba(255,255,255,0.12)" } },
  };
  if (kind === "bar") {
    return {
      color: [c],
      grid: { left: 44, right: 16, top: 30, bottom: 26 },
      tooltip: { trigger: "axis", backgroundColor: "rgba(10,31,68,0.9)", textStyle: { color: "#fff" } },
      xAxis: { type: "category", data: labels, ...axis },
      yAxis: { type: "value", ...axis },
      series: [{ type: "bar", data: values, barMaxWidth: 26, itemStyle: { borderRadius: [3, 3, 0, 0] } }],
    };
  }
  if (kind === "line") {
    return {
      color: [c],
      grid: { left: 44, right: 16, top: 30, bottom: 26 },
      tooltip: { trigger: "axis", backgroundColor: "rgba(10,31,68,0.9)", textStyle: { color: "#fff" } },
      xAxis: { type: "category", data: labels, boundaryGap: false, ...axis },
      yAxis: { type: "value", ...axis },
      series: [{ type: "line", data: values, smooth: true, symbolSize: 4, areaStyle: { opacity: 0.25 } }],
    };
  }
  return {
    color: [c, "#3d9bff", "#00d68f", "#ffb74d", "#f06292"],
    legend: { bottom: 4, textStyle: { color: "rgba(255,255,255,0.75)", fontSize: 11 }, itemWidth: 12, itemHeight: 8 },
    tooltip: { trigger: "item", backgroundColor: "rgba(10,31,68,0.9)", textStyle: { color: "#fff" } },
    series: [
      {
        type: "pie",
        radius: ["36%", "64%"],
        center: ["50%", "46%"],
        data: labels.map((l, i) => ({ name: l, value: values[i] })),
        label: { color: "rgba(255,255,255,0.8)", fontSize: 11 },
        itemStyle: { borderColor: "rgba(6,22,48,0.9)", borderWidth: 2 },
      },
    ],
  };
}
