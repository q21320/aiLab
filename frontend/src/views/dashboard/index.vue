<script setup lang="ts">
// ============================================================================
// 仪表盘 · 实验室运营总览
//
// 数据来源：实验室管理 7 个台账（/api/crud/lab_*），前端聚合，后端零改动。
//   · 指标卡：在办项目 / 待收款 / 本月支出 / 设备在用
//   · 图表：近 6 个月收支趋势 + 项目完成情况（另见设备状态分布）
//   · 列表：最近项目 + 待办提醒
// 权限口径：每张卡/每个模块只在当前角色拥有对应页面 view 权限时才请求与展示
//   （见 stores/acl.ts，由服务端「角色权限」下发），财务类不再特指管理员。
// 口径说明：
//   收入/支出台账的「价格」按万元录入（字段 unitWan），本页汇总时 ×10000 对齐成元，
//   与日常报销（元）同口径后再交给 fmtMoney / 坐标轴格式化；
//   「待收款」= 收入台账中到账情况 ≠ 已到账 的金额合计；
//   「本月支出」= 支出项目 + 日常报销 中日期落在本月的金额合计。
// ============================================================================
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useViewport } from "../../utils/viewport";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { ArrowRight, Box, Clock, Coin, Money, Monitor, Tickets } from "@element-plus/icons-vue";
import { listCrud } from "../../api/crud";
import { echarts } from "../../lowcode/charts";
import { useAclStore } from "../../stores/acl";

type Row = Record<string, any>;

const router = useRouter();
const { isMobile } = useViewport();
const acl = useAclStore();

/** 低库存阈值（耗材数量 ≤ 该值时进入待办） */
const LOW_STOCK = 5;

// ---------------------------------------------------------------- 页面权限
// 各台账能不能看，完全由服务端「角色权限」决定；无权限就不发请求，避免满屏 403
const canProjects = computed(() => acl.canView("/lab/projects"));
const canOutsource = computed(() => acl.canView("/lab/outsource-projects"));
const canEquipment = computed(() => acl.canView("/lab/equipment"));
const canConsumables = computed(() => acl.canView("/lab/consumables"));
const canReimburse = computed(() => acl.canView("/lab/reimbursements"));
const canIncome = computed(() => acl.canView("/lab/finance/income"));
const canExpense = computed(() => acl.canView("/lab/finance/expense"));
/** 收支趋势图要同时算收入与支出，两个页面都有权限才有意义 */
const canFinance = computed(() => canIncome.value && canExpense.value);

const PAGE_TITLES: Record<string, string> = {
  "/lab/projects": "测试项目",
  "/lab/outsource-projects": "委外项目",
  "/lab/customers": "客户信息",
  "/lab/equipment": "设备信息",
  "/lab/consumables": "耗材信息",
  "/lab/reimbursements": "日常报销",
  "/lab/finance/income": "收入项目",
  "/lab/finance/expense": "支出项目",
};

/** 跳转前校验页面权限，无权限给出明确提示（避免“点了没反应”） */
function goto(path: string) {
  if (!acl.canView(path)) {
    ElMessage.warning(
      `当前角色「${acl.roleName || acl.roleKey || "未识别"}」没有「${PAGE_TITLES[path] || path}」页面的查看权限，请联系管理员在「角色权限」中配置`,
    );
    return;
  }
  router.push(path);
}

// ---------------------------------------------------------------- 数据加载
const loading = ref(false);
const projects = ref<Row[]>([]);
/** 委外项目（委托三方测）：与测试项目分开两张台账，项目类指标合在一起算 */
const outsourceProjects = ref<Row[]>([]);
const income = ref<Row[]>([]);
const expense = ref<Row[]>([]);
const reimburse = ref<Row[]>([]);
const equipment = ref<Row[]>([]);
const consumables = ref<Row[]>([]);

/** 分页拉全量（后端单页上限 200；实验室数据量级足够，上限 20 页兜底） */
async function listAll(resource: string): Promise<Row[]> {
  const all: Row[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const r = await listCrud(resource, { page, pageSize: 200 });
    if (!r.ok) break;
    all.push(...r.list);
    if (all.length >= r.total || r.list.length === 0) break;
  }
  return all;
}

async function load() {
  loading.value = true;
  try {
    // 只拉当前角色有权访问的台账（后端对 lab_* 资源也做了接口层拦截）
    const [p, op, eq, cs, inc, exp, re] = await Promise.all([
      canProjects.value ? listAll("lab_projects") : [],
      canOutsource.value ? listAll("lab_outsource_projects") : [],
      canEquipment.value ? listAll("lab_equipment") : [],
      canConsumables.value ? listAll("lab_consumables") : [],
      canIncome.value ? listAll("lab_fin_income") : [],
      canExpense.value ? listAll("lab_fin_expense") : [],
      canReimburse.value ? listAll("lab_reimbursements") : [],
    ]);
    projects.value = p as Row[];
    outsourceProjects.value = op as Row[];
    equipment.value = eq as Row[];
    consumables.value = cs as Row[];
    income.value = inc as Row[];
    expense.value = exp as Row[];
    reimburse.value = re as Row[];
  } finally {
    loading.value = false;
  }
}

onMounted(load);

// ---------------------------------------------------------------- 通用工具
const num = (v: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
/** 日期统一取 YYYY-MM（台账里存的是 YYYY-MM-DD 字符串） */
const monthKey = (v: any): string => String(v ?? "").slice(0, 7);
const currentMonth = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return "¥0";
  if (Math.abs(n) >= 10000) return `¥${(n / 10000).toFixed(1)} 万`;
  return `¥${n.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------- 指标计算
/** 两个项目台账合并后的口径（没权限的那个为空数组，不影响另一个）；_kind 用于列表区分测试/委外 */
const allProjects = computed<Row[]>(() => [
  ...projects.value.map((p) => ({ ...p, _kind: "测试" })),
  ...outsourceProjects.value.map((p) => ({ ...p, _kind: "委外" })),
]);

const openProjects = computed(() => allProjects.value.filter((p) => String(p.progress ?? "未开始") !== "已完成"));
const pausedProjects = computed(() => allProjects.value.filter((p) => String(p.progress ?? "") === "已暂停"));

const monthNewProjects = computed(() => {
  const m = currentMonth();
  return allProjects.value.filter((p) => monthKey(p.date) === m);
});

const receivableRows = computed(() => income.value.filter((r) => String(r.receiveStatus ?? "") !== "已到账"));
// 收入 price 存万元，×10000 回到元口径
const receivable = computed(() => receivableRows.value.reduce((sum, r) => sum + num(r.price) * 10000, 0));

const monthExpense = computed(() => {
  const m = currentMonth();
  // 支出 price 存万元→元；日常报销仍按元
  const a = expense.value.filter((r) => monthKey(r.date) === m).reduce((s, r) => s + num(r.price) * 10000, 0);
  const b = reimburse.value.filter((r) => monthKey(r.purchaseDate) === m).reduce((s, r) => s + num(r.price), 0);
  return a + b;
});

const deviceBusy = computed(() => equipment.value.filter((d) => String(d.status ?? "") === "运行中").length);
const deviceRepair = computed(() => equipment.value.filter((d) => String(d.status ?? "") === "维修中").length);
const lowStock = computed(() => consumables.value.filter((c) => num(c.qty) <= LOW_STOCK));

/** 顶部指标卡：按页面权限拼装（财务卡仅在有收入/支出页面权限时出现），最多 4 张 */
const stats = computed(() => {
  const cards: { title: string; value: string; note: string; icon: any; color: string; link: string }[] = [
    {
      title: "在办项目",
      value: String(openProjects.value.length),
      note: `本月新增 ${monthNewProjects.value.length} · 测试 ${projects.value.length} / 委外 ${outsourceProjects.value.length}`,
      icon: Tickets,
      color: "#409eff",
      link: "/lab/projects",
    },
  ];
  if (canIncome.value) {
    cards.push({
      title: "待收款",
      value: fmtMoney(receivable.value),
      note: `涉及 ${receivableRows.value.length} 个项目`,
      icon: Money,
      color: "#e6a23c",
      link: "/lab/finance/income",
    });
  }
  if (canExpense.value) {
    cards.push({
      title: "本月支出",
      value: fmtMoney(monthExpense.value),
      note: "委外 + 日常报销",
      icon: Coin,
      color: "#f56c6c",
      link: "/lab/finance/expense",
    });
  }
  cards.push(
    {
      title: "设备在用",
      value: `${deviceBusy.value} / ${equipment.value.length}`,
      note: deviceRepair.value ? `维修中 ${deviceRepair.value} 台` : "设备状态正常",
      icon: Monitor,
      color: "#67c23a",
      link: "/lab/equipment",
    },
    {
      title: "本月新增项目",
      value: String(monthNewProjects.value.length),
      note: `累计 ${allProjects.value.length} 个（测试 + 委外）`,
      icon: Clock,
      color: "#e6a23c",
      link: "/lab/projects",
    },
    {
      title: "低库存耗材",
      value: String(lowStock.value.length),
      note: `数量 ≤ ${LOW_STOCK} 的耗材`,
      icon: Box,
      color: "#f56c6c",
      link: "/lab/consumables",
    },
  );
  return cards.filter((c) => acl.canView(c.link)).slice(0, 4);
});

// ---------------------------------------------------------------- 图表数据
/** 近 6 个月（含本月） */
const lastMonths = computed(() => {
  const out: { key: string; label: string }[] = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`,
      label: `${d.getMonth() + 1} 月`,
    });
  }
  return out;
});

const trendData = computed(() => {
  if (!canFinance.value) return { labels: [] as string[], income: [] as number[], expense: [] as number[] };
  const labels: string[] = [];
  const inc: number[] = [];
  const exp: number[] = [];
  for (const m of lastMonths.value) {
    labels.push(m.label);
    // 收支台账 price 按万元存，×10000 与报销（元）同口径后上轴
    inc.push(income.value.filter((r) => monthKey(r.date) === m.key).reduce((s, r) => s + num(r.price) * 10000, 0));
    const outsourced = expense.value.filter((r) => monthKey(r.date) === m.key).reduce((s, r) => s + num(r.price) * 10000, 0);
    const daily = reimburse.value
      .filter((r) => monthKey(r.purchaseDate) === m.key)
      .reduce((s, r) => s + num(r.price), 0);
    exp.push(outsourced + daily);
  }
  return { labels, income: inc, expense: exp };
});

const PROJECT_STATES = ["未开始", "进行中", "已完成", "已暂停"];
const STATE_COLORS: Record<string, string> = {
  未开始: "#909399",
  进行中: "#409eff",
  已完成: "#67c23a",
  已暂停: "#e6a23c",
};

const progressData = computed(() =>
  PROJECT_STATES.map((s) => ({
    name: s,
    value: allProjects.value.filter((p) => String(p.progress ?? "未开始") === s).length,
  })).filter((d) => d.value > 0),
);

const deviceData = computed(() =>
  ["运行中", "待机", "维修中", "停用"]
    .map((s) => ({ name: s, value: equipment.value.filter((d) => String(d.status ?? "") === s).length }))
    .filter((d) => d.value > 0),
);

/** 设备状态分布图：有设备台账权限，且图表区还有空位时才补上 */
const showDeviceChart = computed(() => canEquipment.value && !(canFinance.value && canProjects.value));

// ---------------------------------------------------------------- 列表数据
const recentProjects = computed(() =>
  [...allProjects.value]
    .sort((a, b) => String(b.date ?? "").localeCompare(String(a.date ?? "")))
    .slice(0, 5),
);

/** 最近项目行点击：跳到该行所属的那个项目模块（测试 / 委外） */
function openProjectRow(row: Row) {
  void goto(row._kind === "委外" ? "/lab/outsource-projects" : "/lab/projects");
}

function progressTagType(progress: string): "success" | "info" | "warning" | "primary" {
  const v = String(progress ?? "");
  if (v === "已完成") return "success";
  if (v === "进行中") return "primary";
  if (v === "已暂停") return "warning";
  return "info";
}

/** 待办提醒：只列当前角色有权访问的台账，全部可点击直达 */
const todos = computed(() => {
  const list: { label: string; count: number; path: string; hint: string }[] = [];
  if (canIncome.value) {
    list.push({
      label: "未开票收入",
      count: income.value.filter((r) => String(r.invoiceStatus ?? "") !== "已开票").length,
      path: "/lab/finance/income",
      hint: "开票情况 ≠ 已开票",
    });
    list.push({
      label: "未到账款项",
      count: receivableRows.value.length,
      path: "/lab/finance/income",
      hint: "到账情况 ≠ 已到账",
    });
  }
  if (canExpense.value) {
    list.push({
      label: "未付款委外",
      count: expense.value.filter((r) => String(r.payStatus ?? "") !== "已付款").length,
      path: "/lab/finance/expense",
      hint: "付款情况 ≠ 已付款",
    });
  }
  // 没有财务权限的角色（如工程师）改成项目口径提醒（测试 + 委外合并算）
  const projectPath = canProjects.value ? "/lab/projects" : "/lab/outsource-projects";
  if (!canFinance.value && (canProjects.value || canOutsource.value)) {
    list.push({
      label: "进行中项目",
      count: allProjects.value.filter((p) => String(p.progress ?? "") === "进行中").length,
      path: projectPath,
      hint: "完成情况 = 进行中",
    });
    list.push({
      label: "已暂停项目",
      count: pausedProjects.value.length,
      path: projectPath,
      hint: "完成情况 = 已暂停",
    });
  }
  if (canConsumables.value) {
    list.push({
      label: "低库存耗材",
      count: lowStock.value.length,
      path: "/lab/consumables",
      hint: `现有数量 ≤ ${LOW_STOCK}`,
    });
  }
  return list;
});

// ---------------------------------------------------------------- 图表渲染
const trendEl = ref<HTMLDivElement | null>(null);
const progressEl = ref<HTMLDivElement | null>(null);
const deviceEl = ref<HTMLDivElement | null>(null);

let trendChart: ReturnType<typeof echarts.init> | null = null;
let progressChart: ReturnType<typeof echarts.init> | null = null;
let deviceChart: ReturnType<typeof echarts.init> | null = null;
let ro: ResizeObserver | null = null;

const AXIS_LABEL = { color: "#909399", fontSize: 11 };

function trendOption() {
  const { labels, income: inc, expense: exp } = trendData.value;
  return {
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      valueFormatter: (v: any) => fmtMoney(Number(v)),
    },
    legend: { data: ["收入", "支出"], top: 0, right: 0, itemWidth: 10, itemHeight: 10 },
    grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
    xAxis: {
      type: "category",
      data: labels,
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#e4e7ed" } },
      axisLabel: AXIS_LABEL,
    },
    yAxis: {
      type: "value",
      splitLine: { lineStyle: { type: "dashed", color: "#f0f2f5" } },
      axisLabel: {
        ...AXIS_LABEL,
        formatter: (v: number) => (Math.abs(v) >= 10000 ? `${v / 10000}万` : String(v)),
      },
    },
    series: [
      {
        name: "收入",
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: "#409eff", borderRadius: [4, 4, 0, 0] },
        data: inc,
      },
      {
        name: "支出",
        type: "bar",
        barMaxWidth: 18,
        itemStyle: { color: "#f56c6c", borderRadius: [4, 4, 0, 0] },
        data: exp,
      },
    ],
  };
}

function pieOption(data: { name: string; value: number }[], colors?: Record<string, string>) {
  return {
    tooltip: { trigger: "item", formatter: "{b}：{c}（{d}%）" },
    legend: { bottom: 0, icon: "circle", itemWidth: 8, itemHeight: 8, textStyle: { fontSize: 12, color: "#606266" } },
    color: colors ? data.map((d) => colors[d.name] || "#909399") : undefined,
    series: [
      {
        type: "pie",
        radius: ["46%", "68%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        label: { show: false },
        data,
      },
    ],
  };
}

function renderCharts() {
  if (trendEl.value) {
    if (!trendChart) trendChart = echarts.init(trendEl.value);
    trendChart.setOption(trendOption(), true);
  }
  if (progressEl.value && progressData.value.length) {
    if (!progressChart) progressChart = echarts.init(progressEl.value);
    progressChart.setOption(pieOption(progressData.value, STATE_COLORS), true);
  }
  if (deviceEl.value && deviceData.value.length) {
    if (!deviceChart) deviceChart = echarts.init(deviceEl.value);
    deviceChart.setOption(
      pieOption(deviceData.value, { 运行中: "#67c23a", 待机: "#409eff", 维修中: "#e6a23c", 停用: "#909399" }),
      true,
    );
  }
}

// 数据或布局变化后重绘（v-if 控制空态时元素可能刚挂载）
watch([trendData, progressData, deviceData], () => nextTick(renderCharts), { deep: true });

onMounted(() => {
  nextTick(() => {
    renderCharts();
    if (trendEl.value) {
      ro = new ResizeObserver(() => {
        trendChart?.resize();
        progressChart?.resize();
        deviceChart?.resize();
      });
      ro.observe(trendEl.value);
    }
  });
});

onBeforeUnmount(() => {
  ro?.disconnect();
  ro = null;
  trendChart?.dispose();
  progressChart?.dispose();
  deviceChart?.dispose();
  trendChart = null;
  progressChart = null;
  deviceChart = null;
});
</script>

<template>
  <div v-loading="loading" class="dashboard">
    <!-- 实验室核心指标 -->
    <el-row :gutter="20">
      <el-col v-for="s in stats" :key="s.title" :xs="12" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card" @click="goto(s.link)">
          <div class="stat-content">
            <div class="stat-icon" :style="{ background: s.color }">
              <el-icon :size="24"><component :is="s.icon" /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-title">{{ s.title }}</div>
              <div class="stat-value">{{ s.value }}</div>
              <div class="stat-note" :title="s.note">{{ s.note }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <!-- 图表区 -->
    <el-row :gutter="20" class="mt20">
      <el-col v-if="canFinance" :xs="24" :md="16">
        <el-card shadow="never" class="panel">
          <template #header>
            <span class="panel-title">近 6 个月收支</span>
            <el-tag size="small" effect="plain" class="panel-tag">收入 / 支出（委外 + 报销）</el-tag>
          </template>
          <div ref="trendEl" class="chart chart-lg" />
        </el-card>
      </el-col>

      <el-col v-if="canProjects" :xs="24" :md="canFinance ? 8 : 12">
        <el-card shadow="never" class="panel">
          <template #header><span class="panel-title">项目完成情况</span></template>
          <div v-if="progressData.length" ref="progressEl" class="chart chart-lg" />
          <el-empty v-else description="暂无项目数据" :image-size="70" />
        </el-card>
      </el-col>

      <el-col v-if="showDeviceChart" :xs="24" :md="12">
        <el-card shadow="never" class="panel">
          <template #header><span class="panel-title">设备状态分布</span></template>
          <div v-if="deviceData.length" ref="deviceEl" class="chart chart-lg" />
          <el-empty v-else description="暂无设备数据" :image-size="70" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 最近项目 + 待办 -->
    <el-row :gutter="20" class="mt20">
      <el-col v-if="canProjects || canOutsource" :xs="24" :md="14">
        <el-card shadow="never" class="panel">
          <template #header>
            <span class="panel-title">最近项目</span>
            <span class="panel-link" @click="goto('/lab/projects')">
              查看全部项目 <el-icon><ArrowRight /></el-icon>
            </span>
          </template>
          <el-table :data="recentProjects" size="small" @row-click="openProjectRow">
            <el-table-column prop="date" label="日期" :width="isMobile ? 88 : 110">
              <template #default="{ row }">{{ row.date || "-" }}</template>
            </el-table-column>
            <el-table-column label="类型" :width="isMobile ? 56 : 70" align="center">
              <template #default="{ row }">
                <el-tag size="small" :type="row._kind === '委外' ? 'warning' : 'info'" effect="plain">
                  {{ row._kind }}
                </el-tag>
              </template>
            </el-table-column>
            <!-- 项目编号在手机上挤占委托单位的空间，窄屏隐列（详情页可见） -->
            <el-table-column v-if="!isMobile" prop="projectNo" label="项目编号" width="150" show-overflow-tooltip>
              <template #default="{ row }">{{ row.projectNo || "-" }}</template>
            </el-table-column>
            <el-table-column prop="clientName" label="委托单位" min-width="80" show-overflow-tooltip>
              <template #default="{ row }">{{ row.clientName || "-" }}</template>
            </el-table-column>
            <el-table-column label="完成情况" :width="isMobile ? 84 : 100" align="center">
              <template #default="{ row }">
                <el-tag size="small" effect="plain" :type="progressTagType(row.progress)">
                  {{ row.progress || "未开始" }}
                </el-tag>
              </template>
            </el-table-column>
            <template #empty>
              <el-empty description="暂无项目，点击右上角入口去录入" :image-size="70" />
            </template>
          </el-table>
        </el-card>
      </el-col>

      <el-col v-if="todos.length" :xs="24" :md="canProjects ? 10 : 24">
        <el-card shadow="never" class="panel">
          <template #header><span class="panel-title">待办提醒</span></template>
          <div v-for="td in todos" :key="td.label" class="todo" @click="goto(td.path)">
            <div class="todo-main">
              <span class="todo-label">{{ td.label }}</span>
              <span class="todo-hint">{{ td.hint }}</span>
            </div>
            <el-tag :type="td.count ? 'warning' : 'info'" effect="plain" class="todo-count">{{ td.count }}</el-tag>
            <el-icon class="todo-arrow"><ArrowRight /></el-icon>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.mt20 {
  margin-top: 20px;
}
.stat-card {
  border-radius: 8px;
  cursor: pointer;
}
.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}
.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.stat-title {
  font-size: 14px;
  color: #909399;
}
.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #1f2d3d;
  margin: 2px 0;
  line-height: 1.2;
}
.stat-note {
  font-size: 12px;
  color: #a0a6ad;
  /* 单行省略，避免中文在卡片里换行断字 */
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel {
  border-radius: 8px;
  height: 100%;
}
.panel-title {
  font-weight: 600;
  color: #1f2d3d;
}
.panel-tag {
  float: right;
  color: #909399;
}
.panel-link {
  float: right;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.chart {
  width: 100%;
}
.chart-lg {
  height: 300px;
}

/* ---------- 手机端 ---------- */
@media (max-width: 767px) {
  /* 统计卡两列排布后，行与行之间要留缝（栅格 flex 换行用 row-gap） */
  .dashboard :deep(.el-row) {
    row-gap: 10px;
  }
  /* 半宽卡片里 52px 图标 + 三行文字挤不下，整体缩一档 */
  .stat-content {
    gap: 10px;
  }
  .stat-icon {
    width: 40px;
    height: 40px;
    border-radius: 8px;
  }
  .stat-title {
    font-size: 12px;
  }
  .stat-value {
    font-size: 19px;
  }
  .chart-lg {
    height: 240px;
  }
  /* 头部的「查看全部」float:right 在窄屏会与标题抢位，改 flex 两端对齐 */
  .panel-tag,
  .panel-link {
    float: none;
  }
  .panel :deep(.el-card__header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 4px;
  }
}
.todo {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.todo + .todo {
  margin-top: 10px;
}
.todo:hover {
  border-color: #409eff;
  background: #ecf5ff;
}
.todo-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.todo-label {
  font-size: 14px;
  color: #1f2d3d;
}
.todo-hint {
  font-size: 12px;
  color: #a0a6ad;
}
.todo-count {
  min-width: 36px;
  justify-content: center;
}
.todo-arrow {
  color: #c0c4cc;
}
</style>
