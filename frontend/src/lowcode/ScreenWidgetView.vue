<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { ScreenWidget } from "./screenTypes";
import { echarts, screenOption } from "./charts";
import { iotLive, startIotLive } from "./iotLive";

const props = defineProps<{ widget: ScreenWidget }>();

// ---------------------------------------------------------------------------
// 物联网实时数据（4.3/4.6）
// ---------------------------------------------------------------------------
const live = iotLive;
const deviceRows = computed(() => live.devices);
const energyHistory = computed(() => {
  const series = live.histories["DEV-005"] || live.points.filter((p) => p.type === "energy");
  return {
    labels: series.map((p) => new Date(p.time).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" })),
    values: series.map((p) => +(p.power || 0).toFixed(1)),
  };
});
const testHistory = computed(() => {
  const testDevices = live.devices.filter((d) => d.type === "test" || d.type === "env");
  const latest = live.points;
  return {
    labels: testDevices.map((d) => d.name),
    values: testDevices.map((d) => {
      const p = latest.find((x) => x.deviceId === d.id);
      return p ? p.temperature : d.baseTemp;
    }),
  };
});
const sampleRows = computed(() => {
  const ov = live.overview;
  const names = ["铝合金试样", "不锈钢拉伸件", "PCB 可靠性板", "高分子材料片", "电子元器件", "涂层试片"];
  const sts = ov ? ["测试中", "待测试", "待测试", "已出库", "测试中", "待测试"] : [];
  return names.map((n, i) => ({ name: n, id: `SMP-${1001 + i}`, status: sts[i] || "待测试", batch: `B-26-${i + 1}` }));
});

// ---------------------------------------------------------------------------
// 伪随机数据（以组件 id 为种子，保证每次渲染稳定）
// ---------------------------------------------------------------------------
function seeded(_kind: "bar" | "line", seed: string): { labels: string[]; values: number[] } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 9973;
  const rnd = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280;
  };
  let categories: string[] = [];
  const raw = props.widget.config.categories;
  if (typeof raw === "string" && raw.trim()) {
    categories = raw.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean);
  }
  const labels: string[] = categories.length
    ? categories
    : ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const values = labels.map(() => Math.round(20 + rnd() * 80));
  return { labels, values };
}

function seededPie(seed: string): { name: string; value: number }[] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 53 + seed.charCodeAt(i)) % 7919;
  const rnd = () => {
    h = (h * 9301 + 49297) % 233280;
    return h / 233280;
  };
  const raw = props.widget.config.categories;
  const labels: string[] =
    typeof raw === "string" && raw.trim()
      ? raw.split(/[,，]/).map((s: string) => s.trim()).filter(Boolean)
      : ["智能终端", "云服务", "数据平台", "安全服务", "咨询"];
  return labels.map((name) => ({ name, value: Math.round(10 + rnd() * 90) }));
}

// ---------------------------------------------------------------------------
// 时钟
// ---------------------------------------------------------------------------
const now = ref("");
let clockTimer: number | undefined;
function tick() {
  const d = new Date();
  now.value = d.toLocaleTimeString("zh-CN", { hour12: false });
}
function mountClock() {
  if (props.widget.kind !== "clock") return;
  tick();
  clockTimer = window.setInterval(tick, 1000);
}
watch(
  () => props.widget.kind,
  (k) => {
    if (k === "clock") mountClock();
    else if (clockTimer !== undefined) {
      clearInterval(clockTimer);
      clockTimer = undefined;
    }
  }
);
mountClock();
onBeforeUnmount(() => {
  if (clockTimer !== undefined) clearInterval(clockTimer);
});

// ---------------------------------------------------------------------------
// 图表
// ---------------------------------------------------------------------------
const chartEl = ref<HTMLDivElement | null>(null);
let chart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

function renderChart() {
  if (!chartEl.value) return;
  const kind = props.widget.kind;
  if (kind !== "bar" && kind !== "line" && kind !== "pie" && kind !== "energy" && kind !== "testData") return;
  if (!chart) {
    chart = echarts.init(chartEl.value);
    ro = new ResizeObserver(() => chart?.resize());
    ro.observe(chartEl.value);
  }
  const color = props.widget.config.color || "#00e5ff";
  if (kind === "pie") {
    chart.setOption(screenOption("pie", [], [], color) as any, true);
    chart.setOption({ series: [{ data: seededPie(props.widget.id) }] });
  } else if (kind === "energy") {
    const { labels, values } = energyHistory.value;
    chart.setOption(screenOption("line", labels, values, color), true);
  } else if (kind === "testData") {
    const { labels, values } = testHistory.value;
    chart.setOption(screenOption("bar", labels, values, color), true);
  } else {
    const { labels, values } = seeded(kind, props.widget.id);
    chart.setOption(screenOption(kind, labels, values, color), true);
  }
}

watch(
  () => props.widget,
  () => renderChart(),
  { deep: true }
);
watch(
  () => [iotLive.points, iotLive.histories],
  () => renderChart(),
  { deep: true }
);
onMounted(() => {
  startIotLive();
  renderChart();
});
onBeforeUnmount(() => {
  ro?.disconnect();
  chart?.dispose();
  chart = null;
});

// 滚动列表
const tableRows = computed(() => {
  const names = ["华为", "腾讯", "阿里", "字节", "小米", "网易", "京东", "美团", "百度", "蔚来"];
  const products = ["智能终端", "云服务", "数据平台", "安全服务", "咨询"];
  const statuses = ["履约中", "已完成", "待付款"];
  return names.map((n, i) => ({
    rank: i + 1,
    customer: n,
    product: products[i % products.length],
    amount: 20 + ((i * 37) % 900) + "万",
    status: statuses[i % statuses.length],
  }));
});

const statTrendUp = computed(() => !(props.widget.config.trend || "").startsWith("-"));
</script>

<template>
  <div class="sw-content">
    <!-- 标题 -->
    <div v-if="widget.kind === 'title'" class="sw-title">
      <div class="sw-title-text">{{ widget.title || "大屏标题" }}</div>
      <div v-if="widget.config.sub" class="sw-title-sub">{{ widget.config.sub }}</div>
    </div>

    <!-- 文本 -->
    <div v-else-if="widget.kind === 'text'" class="sw-text" :style="{ color: widget.config.color || 'rgba(255,255,255,0.8)' }">
      {{ widget.title }}
    </div>

    <!-- 时钟 -->
    <div v-else-if="widget.kind === 'clock'" class="sw-clock">
      <div class="sw-clock-time">{{ now }}</div>
    </div>

    <!-- 指标卡 -->
    <div v-else-if="widget.kind === 'stat'" class="sw-stat">
      <div class="sw-stat-label">{{ widget.title }}</div>
      <div class="sw-stat-value" :style="{ color: widget.config.color || '#00e5ff' }">
        {{ widget.config.value }}
        <span class="sw-stat-unit">{{ widget.config.unit || "" }}</span>
      </div>
      <div class="sw-stat-trend" :class="statTrendUp ? 'up' : 'down'">
        {{ widget.config.trend || "+0%" }}
      </div>
    </div>

    <!-- 图表 -->
    <template v-else-if="widget.kind === 'bar' || widget.kind === 'line' || widget.kind === 'pie'">
      <div class="sw-chart-title">{{ widget.title }}</div>
      <div ref="chartEl" class="sw-chart"></div>
    </template>

    <!-- 滚动列表 -->
    <div v-else-if="widget.kind === 'table'" class="sw-table">
      <div class="sw-chart-title">{{ widget.title }}</div>
      <div class="sw-table-head">
        <span v-for="c in widget.config.columns || []" :key="c" class="td">{{ c }}</span>
      </div>
      <div class="sw-table-body">
        <div v-for="(r, i) in tableRows" :key="i" class="sw-table-row" :class="{ odd: i % 2 === 1 }">
          <span class="td">{{ r.rank }}</span>
          <span class="td">{{ r.customer }}</span>
          <span class="td">{{ r.product }}</span>
          <span class="td">{{ r.amount }}</span>
          <span class="td">{{ r.status }}</span>
        </div>
      </div>
    </div>

    <!-- 装饰边框 -->
    <div v-else-if="widget.kind === 'border'" class="sw-border"></div>

    <!-- 设备状态（实时，4.3/4.6） -->
    <div v-else-if="widget.kind === 'device'" class="sw-iot">
      <div class="sw-iot-head">
        <span class="live-dot" :class="{ on: live.connected }"></span>
        <span>设备状态</span>
        <span class="sw-iot-sub">{{ live.connected ? "实时数据" : "离线演示" }} · {{ deviceRows.length }} 台</span>
      </div>
      <div class="sw-device-row" v-for="d in deviceRows" :key="d.id">
        <span class="status-dot" :class="d.status"></span>
        <span class="sw-device-name">{{ d.name }}</span>
        <span class="sw-device-meta">{{ d.location }}</span>
        <span class="sw-device-val" :style="{ color: widget.config.color || '#00e5ff' }">
          {{ d.status === "offline" ? "离线" : d.power + "kW" }}
        </span>
      </div>
    </div>

    <!-- 能耗趋势（实时，4.3/4.6） -->
    <template v-else-if="widget.kind === 'energy' || widget.kind === 'testData'">
      <div class="sw-chart-title">
        {{ widget.title }}
        <span class="sw-iot-live">{{ live.connected ? "实时" : "离线" }}</span>
      </div>
      <div ref="chartEl" class="sw-chart"></div>
    </template>

    <!-- 样品台账（实时统计 + 列表，4.3/4.5） -->
    <div v-else-if="widget.kind === 'sampleList'" class="sw-iot">
      <div class="sw-iot-head">
        <span class="live-dot" :class="{ on: live.connected }"></span>
        <span>样品台账（今日）</span>
        <span class="sw-iot-sub">
          入库 {{ live.overview?.samplesInToday ?? 0 }} · 测试中 {{ live.overview?.samplesTesting ?? 0 }} · 出库 {{ live.overview?.samplesOutToday ?? 0 }}
        </span>
      </div>
      <div class="sw-table-head">
        <span class="td">编号</span><span class="td">名称</span><span class="td">批次</span><span class="td">状态</span>
      </div>
      <div class="sw-table-body">
        <div v-for="(s, i) in sampleRows" :key="s.id" class="sw-table-row" :class="{ odd: i % 2 === 1 }">
          <span class="td">{{ s.id }}</span>
          <span class="td">{{ s.name }}</span>
          <span class="td">{{ s.batch }}</span>
          <span class="td">{{ s.status }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sw-content {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
  font-family: "PingFang SC", "Microsoft YaHei", sans-serif;
}
.sw-title {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.sw-title-text {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 8px;
  color: #eaf6ff;
  text-shadow: 0 0 12px rgba(0, 229, 255, 0.6);
}
.sw-title-sub {
  font-size: 12px;
  color: rgba(234, 246, 255, 0.55);
  letter-spacing: 4px;
}
.sw-text {
  font-size: 16px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow: hidden;
}
.sw-clock {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}
.sw-clock-time {
  font-size: 22px;
  font-weight: 600;
  color: #eaf6ff;
  font-family: "DIN Alternate", "Arial Narrow", monospace;
}
.sw-stat {
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  background: linear-gradient(180deg, rgba(0, 229, 255, 0.06), rgba(0, 229, 255, 0.01));
  border: 1px solid rgba(0, 229, 255, 0.25);
  border-radius: 6px;
  padding: 8px;
}
.sw-stat-label {
  font-size: 14px;
  color: rgba(234, 246, 255, 0.75);
}
.sw-stat-value {
  font-size: 34px;
  font-weight: 700;
  font-family: "DIN Alternate", "Arial Narrow", sans-serif;
  text-shadow: 0 0 14px currentColor;
}
.sw-stat-unit {
  font-size: 13px;
  margin-left: 4px;
  color: rgba(234, 246, 255, 0.7);
}
.sw-stat-trend {
  font-size: 12px;
}
.sw-stat-trend.up {
  color: #00d68f;
}
.sw-stat-trend.down {
  color: #ff5252;
}
.sw-chart-title {
  font-size: 14px;
  color: rgba(234, 246, 255, 0.85);
  padding: 6px 10px 2px;
  letter-spacing: 1px;
}
.sw-chart {
  width: 100%;
  height: calc(100% - 26px);
}
.sw-table {
  height: 100%;
}
.sw-table-head,
.sw-table-row {
  display: flex;
  font-size: 12px;
  padding: 4px 8px;
}
.sw-table-head {
  color: rgba(0, 229, 255, 0.9);
  border-bottom: 1px solid rgba(0, 229, 255, 0.3);
}
.sw-table-row {
  color: rgba(234, 246, 255, 0.8);
}
.sw-table-row.odd {
  background: rgba(0, 229, 255, 0.05);
}
.td {
  flex: 1;
  text-align: left;
  overflow: hidden;
  white-space: nowrap;
}
.sw-border {
  width: 100%;
  height: 100%;
  background: linear-gradient(135deg, rgba(0, 229, 255, 0.12), transparent 40%, rgba(0, 229, 255, 0.05));
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 4px;
  box-shadow: inset 0 0 24px rgba(0, 229, 255, 0.08);
}
.sw-iot {
  height: 100%;
  padding: 4px 2px;
  overflow: hidden;
}
.sw-iot-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: rgba(234, 246, 255, 0.85);
  padding: 2px 6px 6px;
}
.sw-iot-sub {
  margin-left: auto;
  font-size: 11px;
  color: rgba(234, 246, 255, 0.55);
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ff5252;
}
.live-dot.on {
  background: #00d68f;
  box-shadow: 0 0 6px #00d68f;
}
.sw-device-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: rgba(234, 246, 255, 0.8);
  padding: 4px 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: #7a8aa3;
}
.status-dot.online {
  background: #00d68f;
  box-shadow: 0 0 6px rgba(0, 214, 143, 0.8);
}
.status-dot.error {
  background: #ff5252;
  box-shadow: 0 0 6px rgba(255, 82, 82, 0.8);
}
.status-dot.offline {
  background: #7a8aa3;
}
.sw-device-name {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sw-device-meta {
  font-size: 11px;
  color: rgba(234, 246, 255, 0.45);
}
.sw-device-val {
  font-weight: 600;
  font-family: "DIN Alternate", monospace;
}
.sw-iot-live {
  font-size: 11px;
  color: #00d68f;
  margin-left: 8px;
}
</style>
