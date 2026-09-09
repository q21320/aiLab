<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ReportBlock, ReportField } from "./reportTypes";
import { echarts, groupAggregate, chartOption } from "./charts";

const props = defineProps<{
  block: ReportBlock;
  rows: Record<string, any>[];
  fields: ReportField[];
}>();

const chartEl = ref<HTMLDivElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const chartData = computed(() => {
  if (!props.block.xField || !props.block.yField) return { labels: [], values: [] };
  return groupAggregate(
    props.rows,
    props.block.xField,
    props.block.yField,
    props.block.agg || "sum"
  );
});

const metricValue = computed(() => {
  const b = props.block;
  const target = b.metricField || b.yField;
  if (!target) return "-";
  const agg = b.agg || "sum";
  const { values } = groupAggregate(props.rows, "__all__", target, agg);
  return values.length ? values[0] : 0;
});

function renderChart() {
  if (!chartEl.value) return;
  if (props.block.kind === "bar" || props.block.kind === "line" || props.block.kind === "pie") {
    if (!chart) {
      chart = echarts.init(chartEl.value);
      ro = new ResizeObserver(() => chart?.resize());
      ro.observe(chartEl.value);
    }
    const { labels, values } = chartData.value;
    chart.setOption(chartOption(props.block.kind, labels, values, props.block.color, props.block.title), true);
    if (!labels.length) {
      chart.setOption(
        {
          graphic: {
            type: "text",
            left: "center",
            top: "middle",
            style: { text: "请在右侧配置维度与指标", fill: "#c0c4cc", fontSize: 13 },
          },
        },
        false
      );
    }
  }
}

onMounted(renderChart);
onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
  chart = null;
});
watch([() => props.block, () => props.rows], renderChart, { deep: true });

function fmt(v: any): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") return v.toLocaleString("zh-CN");
  return String(v);
}
</script>

<template>
  <div class="report-block-view">
    <!-- 指标卡 -->
    <div v-if="block.kind === 'metric'" class="metric">
      <div class="metric-label">{{ block.title || block.metricLabel || "指标" }}</div>
      <div class="metric-value" :style="{ color: block.color || '#409eff' }">
        {{ typeof metricValue === 'number' && metricValue >= 10000 ? (metricValue / 10000).toFixed(2) + ' 万' : fmt(metricValue) }}
      </div>
      <div class="metric-agg">{{ block.agg ? `聚合：${block.agg}` : "聚合：sum" }}</div>
    </div>

    <!-- 图表 -->
    <div v-else-if="block.kind === 'bar' || block.kind === 'line' || block.kind === 'pie'" ref="chartEl" class="chart"></div>

    <!-- 明细表 -->
    <el-table v-else-if="block.kind === 'table'" :data="rows" size="small" border max-height="340">
      <el-table-column
        v-for="col in block.columns || []"
        :key="col"
        :prop="col"
        :label="fields.find((f) => f.name === col)?.label || col"
        min-width="110"
      >
        <template #default="{ row }">{{ fmt(row[col]) }}</template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.report-block-view {
  width: 100%;
  height: 100%;
}
.metric {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 6px;
}
.metric-label {
  font-size: 13px;
  color: #909399;
}
.metric-value {
  font-size: 30px;
  font-weight: 700;
  font-family: "DIN Alternate", "Arial Narrow", sans-serif;
}
.metric-agg {
  font-size: 11px;
  color: #c0c4cc;
}
.chart {
  width: 100%;
  height: 100%;
  min-height: 220px;
}
</style>
