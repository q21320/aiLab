<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, VideoPlay, Warning, Delete, RefreshRight, Download } from "@element-plus/icons-vue";
import { useProductionStore, type ProductionOrder, type WorkOrder } from "../../stores/production";
import { iotLive, startIotLive } from "../../lowcode/iotLive";
import GanttBoard from "./GanttBoard.vue";
import LoadAnalysis from "./LoadAnalysis.vue";

startIotLive();
const store = useProductionStore();
// 从后端加载排产数据（此前只存在 localStorage，换设备会丢）
onMounted(() => {
  void store.loadFromServer();
});
const tab = ref<"orders" | "gantt" | "wos" | "exceptions" | "process" | "load">("gantt");

// ---------------------------------------------------------------------------
// 订单
// ---------------------------------------------------------------------------
const orderDialog = ref(false);
const orderForm = ref({ product: "", qty: 100, due: "", priority: "normal" as ProductionOrder["priority"] });
function openOrderDialog() {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  orderForm.value = { product: "", qty: 100, due: d.toISOString().slice(0, 10), priority: "normal" };
  orderDialog.value = true;
}
function saveOrder() {
  if (!orderForm.value.product.trim()) {
    ElMessage.warning("请输入产品名称");
    return;
  }
  store.addOrder(orderForm.value);
  orderDialog.value = false;
  ElMessage.success("订单已创建");
}

const orderStatusLabel: Record<string, { text: string; type: string }> = {
  draft: { text: "待排产", type: "info" },
  scheduled: { text: "已排产", type: "warning" },
  producing: { text: "生产中", type: "primary" },
  done: { text: "完成", type: "success" },
};
const priorityLabel: Record<string, { text: string; type: string }> = {
  high: { text: "高", type: "danger" },
  normal: { text: "中", type: "info" },
  low: { text: "低", type: "info" },
};

function schedule(order: ProductionOrder) {
  const r = store.scheduleOrder(order.id);
  if (!r.ok) {
    ElMessage.warning(r.reason || "排产失败");
    return;
  }
  if (r.late) {
    ElMessageBox.alert(
      `订单 ${order.id} 已排产，但预计**逾期 ${r.lateDays} 天**（交期 ${order.due}）。\n\n建议：` +
        `\n· 提高相关工序产能或增加产线` +
        `\n· 调整订单优先级或与客户协商交期`,
      "⚠️ 交期预警",
      { type: "warning", confirmButtonText: "查看排产" },
    ).catch(() => {});
  } else {
    ElMessage.success(`订单 ${order.id} 已排产，可在交期内完成`);
  }
  tab.value = "gantt";
}

// ---------------------------------------------------------------------------
// 导出 CSV
// ---------------------------------------------------------------------------
function csvCell(v: unknown): string {
  const raw = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  // 防公式注入
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const text = "\uFEFF" + [header.map(csvCell).join(","), ...rows.map((r) => r.map(csvCell).join(","))].join("\r\n");
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  ElMessage.success(`已导出 ${filename}`);
}

/** 导出订单 */
function exportOrders() {
  downloadCsv(
    `订单-${new Date().toISOString().slice(0, 10)}.csv`,
    ["订单号", "产品", "数量", "交期", "优先级", "状态", "预计完成", "是否逾期"],
    store.orders.map((o) => {
      const plan = orderPlan(o);
      return [
        o.id,
        o.product,
        o.qty,
        o.due,
        priorityLabel[o.priority]?.text || o.priority,
        orderStatusLabel[o.status]?.text || o.status,
        plan ? new Date(plan.end).toLocaleString("zh-CN", { hour12: false }) : "",
        plan?.late ? `逾期 ${plan.lateDays} 天` : "否",
      ];
    }),
  );
}

/** 导出工单 */
function exportWorkOrders() {
  downloadCsv(
    `工单-${new Date().toISOString().slice(0, 10)}.csv`,
    ["工单号", "订单号", "工序", "产线", "计划开始", "计划工时", "实际工时", "进度%", "状态", "实际产量", "操作人"],
    filteredWos.value.map((w) => [
      w.id,
      w.orderId,
      w.processName,
      w.lineName,
      new Date(w.start).toLocaleString("zh-CN", { hour12: false }),
      w.hours,
      w.actualHours ?? "",
      w.progress,
      woStatus(w).text,
      w.actualQty ?? "",
      w.operator || "",
    ]),
  );
}

// 排产预览
const previewDialog = ref(false);
const previewData = ref<{
  order: ProductionOrder;
  planned: Array<{ processName: string; lineName: string; start: number; end: number; hours: number }>;
  plannedEnd: number;
  late: boolean;
  lateDays: number;
} | null>(null);

function openPreview(order: ProductionOrder) {
  const r = store.previewSchedule(order.id);
  if (!r.ok) {
    ElMessage.warning(r.reason || "无法预演该订单");
    return;
  }
  previewData.value = {
    order,
    planned: r.planned!,
    plannedEnd: r.plannedEnd!,
    late: r.late!,
    lateDays: r.lateDays!,
  };
  previewDialog.value = true;
}

function confirmSchedule() {
  const d = previewData.value;
  if (!d) return;
  const r = store.scheduleOrder(d.order.id);
  previewDialog.value = false;
  if (r.ok) {
    ElMessage.success(`订单 ${d.order.id} 已按预览方案排产`);
    tab.value = "gantt";
  } else {
    ElMessage.error(r.reason || "排产失败");
  }
}

/** 一键自动排产：按优先级(高→低) + 交期(早→晚) 排序后依次排产 */
function autoScheduleAll() {
  const drafts = store.orders.filter((o) => o.status === "draft");
  if (!drafts.length) {
    ElMessage.info("没有待排产的订单");
    return;
  }
  const priorityRank: Record<string, number> = { high: 0, normal: 1, low: 2 };
  const sorted = [...drafts].sort((a, b) => {
    const pr = (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1);
    if (pr !== 0) return pr;
    return String(a.due).localeCompare(String(b.due));
  });

  let okCount = 0;
  const lateOrders: string[] = [];
  const failed: string[] = [];
  for (const o of sorted) {
    const r = store.scheduleOrder(o.id);
    if (r.ok) {
      okCount += 1;
      if (r.late) lateOrders.push(`${o.id}（逾期 ${r.lateDays} 天）`);
    } else {
      failed.push(`${o.id}：${r.reason}`);
    }
  }

  const lines = [`✅ 成功排产 ${okCount} 个订单（按优先级+交期排序）`];
  if (lateOrders.length) lines.push(`\n⚠️ 以下订单将逾期：\n  ${lateOrders.join("\n  ")}`);
  if (failed.length) lines.push(`\n❌ 以下订单排产失败：\n  ${failed.join("\n  ")}`);
  ElMessageBox.alert(lines.join(""), "自动排产结果", {
    type: lateOrders.length || failed.length ? "warning" : "success",
    confirmButtonText: "查看排产看板",
  }).catch(() => {});
  tab.value = "gantt";
}
async function removeOrder(order: ProductionOrder) {
  try {
    await ElMessageBox.confirm(`删除订单 ${order.id} 将同时删除其工单，确认？`, "删除订单", { type: "warning" });
    store.removeOrder(order.id);
    ElMessage.success("已删除");
  } catch {
    /* 取消 */
  }
}

// ---------------------------------------------------------------------------
// 工单
// ---------------------------------------------------------------------------
function startWo(woId: string) {
  const wo = store.workOrders.find((w) => w.id === woId);
  if (!wo) return;
  // 开始生产：进度从 0 起，记录实际开始时间
  store.setProgress(woId, wo.progress || 0, "running");
  ElMessage.success("工单已开始生产，可随时「录入进度」更新实际完成度");
}

/** 进度录入弹窗 */
const progressDialog = ref(false);
const progressWo = ref<WorkOrder | null>(null);
const progressForm = ref({ progress: 0, actualQty: 0, operator: "", note: "" });

function openProgressDialog(wo: WorkOrder) {
  progressWo.value = wo;
  progressForm.value = {
    progress: wo.progress || 0,
    actualQty: wo.actualQty ?? 0,
    operator: wo.operator || "",
    note: wo.note || "",
  };
  progressDialog.value = true;
}

function saveProgress() {
  const wo = progressWo.value;
  if (!wo) return;
  const p = Number(progressForm.value.progress);
  if (!Number.isFinite(p) || p < 0 || p > 100) {
    ElMessage.warning("进度需在 0-100 之间");
    return;
  }
  // 进度 100 视为完成
  const status: WorkOrder["status"] = p >= 100 ? "done" : p > 0 ? "running" : wo.status;
  store.setProgress(wo.id, p, status, {
    actualQty: progressForm.value.actualQty,
    operator: progressForm.value.operator || undefined,
    note: progressForm.value.note || undefined,
  });
  progressDialog.value = false;
  ElMessage.success(`工单 ${wo.id} 进度已更新为 ${p}%`);
}

function finishWo(wo: WorkOrder) {
  const order = store.orders.find((o) => o.id === wo.orderId);
  ElMessageBox.prompt(
    `工单 ${wo.id}（${wo.processName}）\n计划工时 ${wo.hours}h，订单数量 ${order?.qty ?? "-"}\n\n请输入实际耗时（小时）：`,
    "完成工单",
    {
      inputValue: String(wo.hours),
      inputPattern: /^\d+(\.\d+)?$/,
      inputErrorMessage: "请输入数字",
      confirmButtonText: "确认完成",
    },
  )
    .then(({ value }) => {
      store.setProgress(wo.id, 100, "done", { actualHours: Number(value) });
      ElMessage.success(`工单 ${wo.id} 已完成，实际工时 ${value}h`);
    })
    .catch(() => {});
}

function raiseWoException(row: WorkOrder) {
  ElMessageBox.prompt(`请描述工单 ${row.id}（${row.processName}）的异常情况：`, "上报异常", {
    inputValue: "现场反馈设备故障，暂停生产",
    confirmButtonText: "上报",
  })
    .then(({ value }) => {
      store.raiseException({
        orderId: row.orderId,
        woId: row.id,
        type: "设备故障",
        desc: value || "现场反馈异常",
      });
      // 工单标记异常
      store.setProgress(row.id, row.progress, "exception");
      ElMessage.success("异常已上报，工单已标记为异常");
    })
    .catch(() => {});
}
function woStatus(wo: any): { text: string; type: string } {
  if (wo.status === "done") return { text: "完成", type: "success" };
  if (wo.status === "exception") return { text: "异常", type: "danger" };
  if (wo.status === "running") return { text: "生产中", type: "primary" };
  return { text: "待开始", type: "info" };
}

// ---------------------------------------------------------------------------
// 异常
// ---------------------------------------------------------------------------
const exDialog = ref(false);
const exForm = ref({ orderId: "", type: "设备故障", desc: "" });
const exTypes = ["设备故障", "缺料", "质量异常", "交期风险", "人员不足"];
function openExDialog() {
  exForm.value = { orderId: store.orders[0]?.id || "", type: "设备故障", desc: "" };
  exDialog.value = true;
}
function saveEx() {
  if (!exForm.value.desc.trim()) {
    ElMessage.warning("请填写异常描述");
    return;
  }
  store.raiseException(exForm.value);
  exDialog.value = false;
  ElMessage.success("异常已上报");
}
function resolveEx(id: string) {
  store.closeException(id, "生产管理员");
  ElMessage.success("异常已处理");
}

// ---------------------------------------------------------------------------
// 工序 / 产能
// ---------------------------------------------------------------------------
const prDialog = ref(false);
const prForm = ref({ name: "", hours: 4, deviceType: "" });
const lnDialog = ref(false);
const lnForm = ref({ name: "", type: "", hoursPerDay: 16 });
function saveProcess() {
  if (!prForm.value.name.trim()) return ElMessage.warning("请输入工序名称");
  store.addProcess(prForm.value);
  prDialog.value = false;
  ElMessage.success("工序已添加");
}
function saveLine() {
  if (!lnForm.value.name.trim()) return ElMessage.warning("请输入产线名称");
  store.addLine(lnForm.value);
  lnDialog.value = false;
  ElMessage.success("产线已添加");
}

/** 订单排产结果：预计完成时间与是否逾期 */
function orderPlan(order: ProductionOrder) {
  const wos = store.workOrders.filter((w) => w.orderId === order.id);
  if (!wos.length) return null;
  const end = Math.max(...wos.map((w) => w.start + w.hours * 3600000));
  const start = Math.min(...wos.map((w) => w.start));
  const due = order.due ? new Date(`${order.due}T23:59:59`).getTime() : 0;
  const late = due > 0 && end > due;
  return {
    start,
    end,
    late,
    lateDays: late ? Math.ceil((end - due) / 86400000) : 0,
  };
}

// 工单筛选与统计
const woKeyword = ref("");
const woStatusFilter = ref<"all" | WorkOrder["status"]>("all");
const filteredWos = computed(() => {
  const k = woKeyword.value.trim().toLowerCase();
  return store.workOrders.filter((w) => {
    if (woStatusFilter.value !== "all" && w.status !== woStatusFilter.value) return false;
    if (!k) return true;
    return (
      w.id.toLowerCase().includes(k) ||
      w.orderId.toLowerCase().includes(k) ||
      (w.processName || "").toLowerCase().includes(k)
    );
  });
});
const totalPlanHours = computed(() => Math.round(filteredWos.value.reduce((a, w) => a + (w.hours || 0), 0) * 10) / 10);
const totalActualHours = computed(() =>
  Math.round(filteredWos.value.reduce((a, w) => a + (w.actualHours || 0), 0) * 10) / 10,
);

const iotBadge = computed(() => ({
  online: iotLive.overview?.online ?? 0,
  alerts: iotLive.overview?.openAlerts ?? 0,
  connected: iotLive.connected,
}));

// 排产看板数据（供甘特使用）
const ganttLines = computed(() => store.lines);
const ganttWos = computed(() => store.workOrders);
function onGanttMove(payload: { woId: string; lineId: string; start: number }) {
  const wo = store.workOrders.find((w) => w.id === payload.woId);
  if (wo && wo.status !== "done") {
    store.moveWorkOrder(payload.woId, payload.lineId, payload.start);
  }
}
</script>

<template>
  <div class="production">
    <!-- 顶部：页签 + 物联网状态（4.7 数据互通） -->
    <div class="prod-header">
      <div class="sync-badge">
        <el-tag v-if="store.backendOnline === true" type="success" size="small" effect="plain">已同步到数据库</el-tag>
        <el-tag v-else-if="store.backendOnline === false" type="warning" size="small" effect="plain">
          仅本地保存（{{ store.lastSyncError || "后端不可达" }}）
        </el-tag>
        <el-tag v-else type="info" size="small" effect="plain">加载中…</el-tag>
      </div>
      <el-tabs v-model="tab" class="prod-tabs">
        <el-tab-pane label="订单管理" name="orders" />
        <el-tab-pane label="排产看板" name="gantt" />
        <el-tab-pane label="工单与进度" name="wos" />
        <el-tab-pane label="异常管理" name="exceptions" />
        <el-tab-pane label="工序与产能" name="process" />
        <el-tab-pane label="产能负荷" name="load" />
      </el-tabs>
      <div class="iot-badge" :class="{ on: iotBadge.connected }">
        物联网：在线设备 {{ iotBadge.online }} 台 · 未处理告警 {{ iotBadge.alerts }} 条
      </div>
    </div>

    <!-- 订单管理 -->
    <template v-if="tab === 'orders'">
      <div class="toolbar">
        <el-button :icon="Download" @click="exportOrders">导出订单</el-button>
        <el-button type="primary" :icon="Plus" @click="openOrderDialog">新增订单</el-button>
        <span class="hint">点击「排产」将按工序 + 产能自动生成工单并进入排产看板</span>
      </div>
      <el-table :data="store.orders" border>
        <el-table-column prop="id" label="订单号" width="110" />
        <el-table-column prop="product" label="产品" min-width="160" />
        <el-table-column prop="qty" label="数量" width="100" />
        <el-table-column prop="due" label="交期" width="120" />
        <el-table-column label="预计完成" width="170">
          <template #default="{ row }">
            <template v-if="orderPlan(row)">
              <span :class="{ late: orderPlan(row)!.late }">
                {{ new Date(orderPlan(row)!.end).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }}
              </span>
              <el-tag v-if="orderPlan(row)!.late" type="danger" size="small" style="margin-left: 4px">
                逾期 {{ orderPlan(row)!.lateDays }} 天
              </el-tag>
            </template>
            <span v-else class="muted">未排产</span>
          </template>
        </el-table-column>
        <el-table-column label="优先级" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="priorityLabel[row.priority]?.type">{{ priorityLabel[row.priority]?.text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="orderStatusLabel[row.status]?.type">{{ orderStatusLabel[row.status]?.text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :disabled="row.status !== 'draft'" @click="openPreview(row)">预览</el-button>
            <el-button size="small" type="primary" :icon="VideoPlay" :disabled="row.status !== 'draft'" @click="schedule(row)">
              排产
            </el-button>
            <el-button size="small" :icon="RefreshRight" :disabled="true">下发</el-button>
            <el-button size="small" text type="danger" :icon="Delete" @click="removeOrder(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 排产看板（甘特图拖拽，4.4） -->
    <template v-else-if="tab === 'gantt'">
      <div class="toolbar">
        <el-button type="primary" :icon="VideoPlay" @click="autoScheduleAll">
          一键自动排产
        </el-button>
        <span class="hint">拖动工单条可调整开始时间与所属产线；红色虚线框表示同产线时间冲突；绿色=完成、蓝色=生产中、灰色=待开始、红色=异常</span>
      </div>
      <GanttBoard :lines="ganttLines" :work-orders="ganttWos" :days="7" @move="onGanttMove" />
    </template>

    <!-- 工单与进度 -->
    <template v-else-if="tab === 'wos'">
      <div class="toolbar">
        <el-input v-model="woKeyword" placeholder="搜索工单号 / 订单号 / 工序" clearable style="width: 240px" />
        <el-select v-model="woStatusFilter" style="width: 140px">
          <el-option label="全部状态" value="all" />
          <el-option label="待开始" value="pending" />
          <el-option label="生产中" value="running" />
          <el-option label="已完成" value="done" />
          <el-option label="异常" value="exception" />
        </el-select>
        <div class="spacer" />
        <span class="wo-summary">
          共 {{ filteredWos.length }} 个工单 · 计划 {{ totalPlanHours }}h · 实际 {{ totalActualHours }}h
        </span>
        <el-button :icon="Download" @click="exportWorkOrders">导出工单</el-button>
      </div>
      <el-table :data="filteredWos" border>
        <el-table-column prop="id" label="工单号" width="110" />
        <el-table-column prop="orderId" label="来源订单" width="110" />
        <el-table-column prop="processName" label="工序" width="110" />
        <el-table-column prop="lineName" label="产线" width="120" />
        <el-table-column label="计划开始" width="140">
          <template #default="{ row }">{{ new Date(row.start).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }}</template>
        </el-table-column>
        <el-table-column label="计划/实际工时" width="130">
          <template #default="{ row }">
            <span>{{ row.hours }}h</span>
            <span v-if="row.actualHours != null" class="actual-hours">
              / <b :class="{ overrun: row.actualHours > row.hours }">{{ row.actualHours }}h</b>
            </span>
          </template>
        </el-table-column>
        <el-table-column label="进度" min-width="150">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :status="row.status === 'done' ? 'success' : row.status === 'exception' ? 'exception' : undefined" />
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="woStatus(row).type">{{ woStatus(row).text }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="260" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'pending'" size="small" type="primary" @click="startWo(row.id)">开始</el-button>
            <el-button v-if="row.status === 'running' || row.status === 'pending'" size="small" type="success" @click="openProgressDialog(row)">录入进度</el-button>
            <el-button v-if="row.status === 'running'" size="small" @click="finishWo(row)">完成</el-button>
            <el-button size="small" :icon="Warning" @click="raiseWoException(row)">异常</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无工单，请先在订单管理中排产" />
        </template>
      </el-table>
    </template>

    <!-- 异常管理 -->
    <!-- 产能负荷 -->
    <template v-else-if="tab === 'load'">
      <LoadAnalysis :lines="store.lines" :work-orders="store.workOrders" :days="7" />
    </template>

    <template v-else-if="tab === 'exceptions'">
      <div class="toolbar">
        <el-button type="primary" :icon="Plus" @click="openExDialog()">上报异常</el-button>
      </div>
      <el-table :data="store.exceptions" border>
        <el-table-column prop="id" label="编号" width="100" />
        <el-table-column prop="orderId" label="关联订单" width="110" />
        <el-table-column prop="type" label="类型" width="110" />
        <el-table-column prop="desc" label="描述" min-width="240" />
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ new Date(row.time).toLocaleString("zh-CN") }}</template>
        </el-table-column>
        <el-table-column prop="handler" label="处理人" width="110" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'open' ? 'danger' : 'success'">{{ row.status === "open" ? "未处理" : "已处理" }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button v-if="row.status === 'open'" size="small" type="success" @click="resolveEx(row.id)">处理</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <!-- 工序与产能 -->
    <template v-else>
      <div class="proc-grid">
        <div class="proc-card">
          <div class="proc-head">
            <span>工序工艺（标准工时）</span>
            <el-button size="small" type="primary" :icon="Plus" @click="prDialog = true">新增工序</el-button>
          </div>
          <el-table :data="store.processes" size="small" border>
            <el-table-column prop="name" label="工序" min-width="100" />
            <el-table-column label="产能(件/时)" width="120">
              <template #default="{ row }">
                <el-input-number
                  :model-value="row.ratePerHour ?? row.hours"
                  :min="1"
                  :step="10"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                  @change="(v: number) => store.updateProcess(row.id, { ratePerHour: v })"
                />
              </template>
            </el-table-column>
            <el-table-column label="换线(h)" width="90">
              <template #default="{ row }">
                <el-input-number
                  :model-value="row.setupHours ?? 0"
                  :min="0"
                  :step="0.5"
                  :precision="1"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                  @change="(v: number) => store.updateProcess(row.id, { setupHours: v })"
                />
              </template>
            </el-table-column>
            <el-table-column prop="deviceType" label="设备类型" width="100" />
            <el-table-column label="" width="50">
              <template #default="{ row }">
                <el-button size="small" text type="danger" @click="store.removeProcess(row.id)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="proc-tip">
            加工时长 = 订单数量 ÷ 产能 + 换线时间。未填写产能时回退为固定工时。
          </p>
        </div>
        <div class="proc-card">
          <div class="proc-head">
            <span>产能线（日可用工时）</span>
            <el-button size="small" type="primary" :icon="Plus" @click="lnDialog = true">新增产线</el-button>
          </div>
          <el-table :data="store.lines" size="small" border>
            <el-table-column prop="name" label="产线" min-width="100" />
            <el-table-column prop="type" label="类型" width="90" />
            <el-table-column label="班次" width="180">
              <template #default="{ row }">
                <el-time-select
                  :model-value="String(row.shiftStart ?? 8).padStart(2, '0') + ':00'"
                  start="00:00"
                  step="01:00"
                  end="23:00"
                  size="small"
                  style="width: 78px"
                  @change="(v: string) => store.updateLine(row.id, { shiftStart: Number(String(v).slice(0, 2)) })"
                />
                <span class="dash">-</span>
                <el-time-select
                  :model-value="String(row.shiftEnd ?? 24).padStart(2, '0') + ':00'"
                  start="01:00"
                  step="01:00"
                  end="24:00"
                  size="small"
                  style="width: 78px"
                  @change="(v: string) => store.updateLine(row.id, { shiftEnd: Number(String(v).slice(0, 2)) })"
                />
              </template>
            </el-table-column>
            <el-table-column label="日产能(h)" width="110">
              <template #default="{ row }">
                <el-input-number
                  :model-value="row.hoursPerDay"
                  :min="1"
                  :max="24"
                  :step="1"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                  @change="(v: number) => store.updateLine(row.id, { hoursPerDay: v })"
                />
              </template>
            </el-table-column>
            <el-table-column label="休息(h)" width="90">
              <template #default="{ row }">
                <el-input-number
                  :model-value="row.breakHours ?? 0"
                  :min="0"
                  :max="4"
                  :step="0.5"
                  :precision="1"
                  size="small"
                  controls-position="right"
                  style="width: 100%"
                  @change="(v: number) => store.updateLine(row.id, { breakHours: v })"
                />
              </template>
            </el-table-column>
            <el-table-column label="" width="50">
              <template #default="{ row }">
                <el-button size="small" text type="danger" @click="store.removeLine(row.id)">删</el-button>
              </template>
            </el-table-column>
          </el-table>
          <p class="proc-tip">
            排产只在班次时间内进行：例如装配线 08:00-17:00、休息 1h，则每天实际排 8 小时，跨天自动续接。
          </p>
        </div>
      </div>
    </template>

    <!-- 排产预览对话框 -->
    <el-dialog v-model="previewDialog" title="排产预览（确认后才会写入）" width="720px" top="6vh">
      <template v-if="previewData">
        <div class="preview-head">
          <b>{{ previewData.order.id }}</b> · {{ previewData.order.product }} ·
          数量 {{ previewData.order.qty }} · 交期 {{ previewData.order.due || "未定" }}
        </div>
        <el-table :data="previewData.planned" size="small" border>
          <el-table-column label="#" width="50" type="index" />
          <el-table-column prop="processName" label="工序" width="120" />
          <el-table-column prop="lineName" label="产线" width="130" />
          <el-table-column label="开始" width="160">
            <template #default="{ row }">{{ new Date(row.start).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }}</template>
          </el-table-column>
          <el-table-column label="结束" width="160">
            <template #default="{ row }">{{ new Date(row.end).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }) }}</template>
          </el-table-column>
          <el-table-column prop="hours" label="工时(h)" width="90" />
        </el-table>
        <el-alert
          class="mt12"
          :type="previewData.late ? 'warning' : 'success'"
          :closable="false"
          show-icon
          :title="previewData.late
            ? `⚠️ 预计 ${new Date(previewData.plannedEnd).toLocaleString('zh-CN', { hour12: false })} 完成，将逾期 ${previewData.lateDays} 天`
            : `✅ 预计 ${new Date(previewData.plannedEnd).toLocaleString('zh-CN', { hour12: false })} 完成，在交期内`"
        />
        <p class="dialog-tip">
          本方案基于当前工序产能、产线班次与已有排产计算。确认后将生成 {{ previewData.planned.length }} 个工单。
        </p>
      </template>
      <template #footer>
        <el-button @click="previewDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmSchedule">确认排产</el-button>
      </template>
    </el-dialog>

    <!-- 进度录入对话框 -->
    <el-dialog v-model="progressDialog" :title="`录入进度 · ${progressWo?.id || ''}（${progressWo?.processName || ''}）`" width="460px">
      <div class="form-field">
        <label>完成进度（%）</label>
        <el-slider v-model="progressForm.progress" :step="5" show-input :show-input-controls="false" />
      </div>
      <div class="form-field">
        <label>实际产量</label>
        <el-input-number v-model="progressForm.actualQty" :min="0" style="width: 100%" />
      </div>
      <div class="form-field">
        <label>操作人</label>
        <el-input v-model="progressForm.operator" placeholder="如：张工" />
      </div>
      <div class="form-field">
        <label>备注</label>
        <el-input v-model="progressForm.note" type="textarea" :rows="2" placeholder="可选" />
      </div>
      <p class="dialog-tip">进度填 100% 即视为该工单完成。</p>
      <template #footer>
        <el-button @click="progressDialog = false">取消</el-button>
        <el-button type="primary" @click="saveProgress">保存</el-button>
      </template>
    </el-dialog>

    <!-- 订单对话框 -->
    <el-dialog v-model="orderDialog" title="新增订单" width="480px">
      <div class="form-field"><label>产品名称</label><el-input v-model="orderForm.product" placeholder="如：电源模块 PSU-200" /></div>
      <div class="form-field"><label>数量</label><el-input-number v-model="orderForm.qty" :min="1" :step="100" style="width: 100%" /></div>
      <div class="form-field"><label>交期</label><el-date-picker v-model="orderForm.due" type="date" value-format="YYYY-MM-DD" style="width: 100%" /></div>
      <div class="form-field">
        <label>优先级</label>
        <el-radio-group v-model="orderForm.priority">
          <el-radio-button value="high">高</el-radio-button>
          <el-radio-button value="normal">中</el-radio-button>
          <el-radio-button value="low">低</el-radio-button>
        </el-radio-group>
      </div>
      <template #footer>
        <el-button @click="orderDialog = false">取消</el-button>
        <el-button type="primary" @click="saveOrder">创建</el-button>
      </template>
    </el-dialog>

    <!-- 异常对话框 -->
    <el-dialog v-model="exDialog" title="上报异常" width="480px">
      <div class="form-field">
        <label>异常类型</label>
        <el-select v-model="exForm.type">
          <el-option v-for="t in exTypes" :key="t" :label="t" :value="t" />
        </el-select>
      </div>
      <div class="form-field">
        <label>关联订单</label>
        <el-select v-model="exForm.orderId">
          <el-option v-for="o in store.orders" :key="o.id" :label="o.id" :value="o.id" />
        </el-select>
      </div>
      <div class="form-field"><label>异常描述</label><el-input v-model="exForm.desc" type="textarea" :rows="3" /></div>
      <template #footer>
        <el-button @click="exDialog = false">取消</el-button>
        <el-button type="primary" @click="saveEx">上报</el-button>
      </template>
    </el-dialog>

    <!-- 工序对话框 -->
    <el-dialog v-model="prDialog" title="新增工序" width="420px">
      <div class="form-field"><label>工序名称</label><el-input v-model="prForm.name" placeholder="如：SMT 贴片" /></div>
      <div class="form-field"><label>标准工时(h)</label><el-input-number v-model="prForm.hours" :min="1" :max="48" style="width: 100%" /></div>
      <div class="form-field"><label>设备类型</label><el-input v-model="prForm.deviceType" placeholder="如：SMT" /></div>
      <template #footer>
        <el-button @click="prDialog = false">取消</el-button>
        <el-button type="primary" @click="saveProcess">添加</el-button>
      </template>
    </el-dialog>

    <!-- 产线对话框 -->
    <el-dialog v-model="lnDialog" title="新增产能线" width="420px">
      <div class="form-field"><label>产线名称</label><el-input v-model="lnForm.name" placeholder="如：SMT 生产线" /></div>
      <div class="form-field"><label>类型</label><el-input v-model="lnForm.type" placeholder="如：SMT" /></div>
      <div class="form-field"><label>日可用工时</label><el-input-number v-model="lnForm.hoursPerDay" :min="1" :max="24" style="width: 100%" /></div>
      <template #footer>
        <el-button @click="lnDialog = false">取消</el-button>
        <el-button type="primary" @click="saveLine">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
.wo-summary {
  font-size: 13px;
  color: #606266;
}
.actual-hours b.overrun {
  color: #f56c6c;
}
.preview-head {
  margin-bottom: 12px;
  font-size: 14px;
  color: #303133;
}
.mt12 {
  margin-top: 12px;
}
.dialog-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
}
.sync-badge {
  display: flex;
  justify-content: flex-end;
  margin-bottom: -8px;
}
.proc-tip {
  margin: 8px 0 0;
  font-size: 12px;
  color: #909399;
}
.dash {
  margin: 0 4px;
  color: #909399;
}
.late {
  color: #f56c6c;
  font-weight: 600;
}
.muted {
  color: #c0c4cc;
}
.production {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.prod-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: #fff;
  border-radius: 8px;
  padding: 0 16px;
}
.prod-tabs {
  flex: 1;
}
.prod-tabs :deep(.el-tabs__header) {
  margin: 0;
}
.iot-badge {
  font-size: 12px;
  color: #e6a23c;
  background: #fdf6ec;
  border-radius: 4px;
  padding: 6px 10px;
  white-space: nowrap;
}
.iot-badge.on {
  color: #67c23a;
  background: #f0f9eb;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.proc-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
@media (max-width: 900px) {
  .proc-grid {
    grid-template-columns: 1fr;
  }
}
.proc-card {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
}
.proc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 600;
  color: #1f2d3d;
}
.form-field {
  margin-bottom: 14px;
}
.form-field label {
  display: block;
  margin-bottom: 6px;
  color: #606266;
}
</style>
