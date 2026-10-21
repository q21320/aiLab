<script setup lang="ts">
import { computed, ref } from "vue";
import type { CapacityLine, WorkOrder } from "../../stores/production";
import { computeLoad, findBottleneck, loadLevel, LOAD_LEVEL_META } from "../../stores/loadAnalysis";

const props = defineProps<{
  lines: CapacityLine[];
  workOrders: WorkOrder[];
  /** 统计天数 */
  days?: number;
}>();

const dayCount = ref(props.days || 7);

/** 统计起点：今天 0 点 */
const fromTs = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
})();

const loads = computed(() => computeLoad(props.lines as any, props.workOrders as any, fromTs, dayCount.value));
const bottleneck = computed(() => findBottleneck(loads.value));

/**
 * 整体负荷率。
 * 注意：若要反映"紧张程度"，用「期间平均值」会掩盖某天爆表的情况
 * （例如 7 天里 1 天排满、其余空闲，平均只有 14%）。
 * 因此这里同时给出平均值与峰值日，峰值更有决策价值。
 */
const overall = computed(() => {
  const cap = loads.value.reduce((a, l) => a + l.totalCapacityHours, 0);
  const load = loads.value.reduce((a, l) => a + l.totalLoadHours, 0);
  return cap > 0 ? Math.round((load / cap) * 100) : 0;
});

/** 峰值日负荷率（所有产线中最高的一天） */
const peakDay = computed(() => {
  let best: { util: number; date: string } | null = null;
  for (const l of loads.value) {
    for (const d of l.days) {
      if (d.capacityHours <= 0) continue;
      if (!best || d.utilization > best.util) best = { util: d.utilization, date: d.date };
    }
  }
  return best;
});

/** 全部产线每天的负荷合计（用于趋势） */
const dailyTotals = computed(() => {
  const first = loads.value[0];
  if (!first) return [];
  return first.days.map((d, i) => {
    const cap = loads.value.reduce((a, l) => a + (l.days[i]?.capacityHours || 0), 0);
    const load = loads.value.reduce((a, l) => a + (l.days[i]?.loadHours || 0), 0);
    return {
      date: d.date,
      capacityHours: Math.round(cap * 10) / 10,
      loadHours: Math.round(load * 10) / 10,
      utilization: cap > 0 ? Math.round((load / cap) * 100) : 0,
    };
  });
});

/** 某天是周几 */
function weekday(ymd: string): string {
  const names = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return names[new Date(`${ymd}T00:00:00`).getDay()];
}

function shortDate(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function cellColor(util: number): string {
  return LOAD_LEVEL_META[loadLevel(util)].color;
}

const hoverTip = (lineName: string, day: { date: string; loadHours: number; capacityHours: number; utilization: number; workOrderCount: number }) =>
  `${lineName} · ${day.date} ${weekday(day.date)}\n负荷 ${day.loadHours}h / 产能 ${day.capacityHours}h（${day.utilization}%）\n涉及 ${day.workOrderCount} 个工单`;
</script>

<template>
  <div class="load-panel">
    <!-- 概览 -->
    <el-row :gutter="12" class="load-stats">
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">平均 / 峰值负荷率（{{ dayCount }} 天）</div>
          <div class="v" :style="{ color: cellColor(peakDay?.util ?? 0) }">
            {{ overall }}%
            <span class="peak">峰值 {{ peakDay?.util ?? 0 }}%</span>
          </div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">瓶颈产线</div>
          <div class="v small">{{ bottleneck?.lineName || "无" }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">过载天数（全部产线）</div>
          <div class="v danger">{{ loads.reduce((a, l) => a + l.overloadedDays, 0) }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">工单总数</div>
          <div class="v">{{ props.workOrders.length }}</div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 工具栏 -->
    <div class="load-toolbar">
      <span class="label">统计范围：</span>
      <el-radio-group v-model="dayCount" size="small">
        <el-radio-button :value="7">7 天</el-radio-button>
        <el-radio-button :value="14">14 天</el-radio-button>
        <el-radio-button :value="30">30 天</el-radio-button>
      </el-radio-group>
      <div class="legend">
        <span v-for="(meta, key) in LOAD_LEVEL_META" :key="key" class="legend-item">
          <i :style="{ background: meta.color }"></i>{{ meta.label }}
        </span>
      </div>
    </div>

    <!-- 负荷热力图 -->
    <el-card shadow="never" class="mt12">
      <template #header>
        <b>产能负荷热力图</b>
        <span class="sub-hint">数字为负荷率，超出 100% 表示该日产线排不下</span>
      </template>
      <div class="heatmap-wrap">
        <table class="heatmap">
          <thead>
            <tr>
              <th class="line-col">产线</th>
              <th v-for="d in loads[0]?.days || []" :key="d.date" class="day-col">
                <div>{{ shortDate(d.date) }}</div>
                <div class="wk">{{ weekday(d.date) }}</div>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in loads" :key="l.lineId">
              <td class="line-col">
                <div class="line-name">{{ l.lineName }}</div>
                <div class="line-cap">{{ l.totalCapacityHours }}h 产能</div>
              </td>
              <td v-for="d in l.days" :key="d.date" class="cell-col">
                <el-tooltip :content="hoverTip(l.lineName, d)" placement="top">
                  <div
                    class="cell"
                    :style="{
                      background: cellColor(d.utilization),
                      opacity: d.loadHours > 0 ? 1 : 0.35,
                      color: d.utilization > 85 ? '#fff' : '#303133',
                    }"
                  >
                    {{ d.loadHours > 0 ? d.utilization + "%" : "—" }}
                  </div>
                </el-tooltip>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </el-card>

    <!-- 逐日明细 -->
    <el-card shadow="never" class="mt12">
      <template #header><b>每日负荷明细（汇总全部产线）</b></template>
      <el-table :data="dailyTotals" size="small" border max-height="320">
        <el-table-column label="日期" width="140">
          <template #default="{ row }">{{ row.date }} {{ weekday(row.date) }}</template>
        </el-table-column>
        <el-table-column prop="capacityHours" label="产能(h)" width="100" />
        <el-table-column prop="loadHours" label="负荷(h)" width="100" />
        <el-table-column label="负荷率" width="200">
          <template #default="{ row }">
            <el-progress
              :percentage="Math.min(row.utilization, 100)"
              :status="row.utilization > 100 ? 'exception' : row.utilization > 85 ? 'warning' : 'success'"
            />
            <span class="util-text" :class="{ over: row.utilization > 100 }">{{ row.utilization }}%</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="LOAD_LEVEL_META[loadLevel(row.utilization)].type">
              {{ LOAD_LEVEL_META[loadLevel(row.utilization)].label }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.load-panel {
  display: flex;
  flex-direction: column;
}
.load-stats .stat {
  border-radius: 8px;
}
.load-stats .k {
  font-size: 12px;
  color: #909399;
}
.load-stats .v {
  font-size: 24px;
  font-weight: 600;
  margin-top: 4px;
}
.load-stats .peak {
  font-size: 13px;
  font-weight: 500;
  color: #909399;
  margin-left: 6px;
}
.load-stats .v.small {
  font-size: 18px;
}
.load-stats .v.danger {
  color: #f56c6c;
}
.load-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.load-toolbar .label {
  font-size: 13px;
  color: #606266;
}
.legend {
  display: flex;
  gap: 12px;
  margin-left: auto;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #606266;
}
.legend-item i {
  width: 12px;
  height: 12px;
  border-radius: 3px;
  display: inline-block;
}
.mt12 {
  margin-top: 12px;
}
.sub-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
.heatmap-wrap {
  overflow-x: auto;
}
.heatmap {
  border-collapse: separate;
  border-spacing: 3px;
  width: 100%;
  font-size: 12px;
}
.heatmap th {
  font-weight: 500;
  color: #606266;
  padding: 4px 2px;
  text-align: center;
  white-space: nowrap;
}
.heatmap .day-col {
  min-width: 46px;
}
.heatmap .wk {
  font-size: 11px;
  color: #c0c4cc;
}
.line-col {
  text-align: left;
  min-width: 120px;
  white-space: nowrap;
}
.line-name {
  font-weight: 600;
  color: #303133;
}
.line-cap {
  font-size: 11px;
  color: #909399;
}
.cell-col {
  padding: 0;
}
.cell {
  border-radius: 4px;
  padding: 10px 4px;
  text-align: center;
  font-weight: 600;
  cursor: default;
  min-width: 42px;
}
.util-text {
  font-size: 12px;
  color: #909399;
  margin-left: 6px;
}
.util-text.over {
  color: #f56c6c;
  font-weight: 600;
}
</style>
