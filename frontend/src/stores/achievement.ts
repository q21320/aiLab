// ============================================================================
// 生产达成率分析
//
// 目的：回答「排得好不好、做得准不准」，这是排产之后的闭环评估。
//
// 三个核心指标：
//   1) 工时达成率   = 计划工时 / 实际工时   （>100% 表示比计划更省时）
//   2) 数量达成率   = 实际产量 / 计划数量   （<100% 表示欠产）
//   3) 交期达成率   = 按期完成的订单数 / 已完成订单数
//
// 附加：
//   · 按产线、按工序的对比，找出效率短板
//   · 超期工单清单（实际完成时间晚于计划完成时间）
// ============================================================================

const HOUR = 3600000;

interface WorkOrderLike {
  id: string;
  orderId: string;
  processId?: string;
  processName: string;
  lineId: string;
  lineName: string;
  start: number;
  hours: number;
  progress: number;
  status: string;
  actualStart?: number;
  actualEnd?: number;
  actualHours?: number;
  actualQty?: number;
}

interface OrderLike {
  id: string;
  product: string;
  qty: number;
  due: string;
  status: string;
}

export interface Achievement {
  /** 计划工时合计 */
  planHours: number;
  /** 实际工时合计 */
  actualHours: number;
  /** 工时达成率（%）= 计划/实际 */
  hoursRate: number;
  /** 计划数量 */
  planQty: number;
  /** 实际产量 */
  actualQty: number;
  /** 数量达成率（%）= 实际/计划 */
  qtyRate: number;
  /** 已完成工单数 */
  doneCount: number;
  /** 总工单数 */
  totalCount: number;
  /** 其中超期完成的工单数 */
  overdueCount: number;
}

export interface GroupAchievement extends Achievement {
  key: string;
  label: string;
}

export interface AchievementReport {
  overall: Achievement;
  byLine: GroupAchievement[];
  byProcess: GroupAchievement[];
  /** 超期工单明细 */
  overdueOrders: Array<{
    woId: string;
    orderId: string;
    processName: string;
    lineName: string;
    planEnd: number;
    actualEnd: number;
    lateHours: number;
  }>;
  /** 交期达成率 */
  dueRate: number;
  /** 已完成的订单数 */
  doneOrders: number;
  /** 其中按期完成的订单数 */
  onTimeOrders: number;
}

/** 计算一个工单群的达成率 */
function aggregate(wos: WorkOrderLike[], orders: OrderLike[]): Achievement {
  const done = wos.filter((w) => w.status === "done");
  const planHours = round1(wos.reduce((a, w) => a + (w.hours || 0), 0));
  // 实际工时只统计已完成的（未完成没有实际值）
  const actualHours = round1(done.reduce((a, w) => a + (w.actualHours ?? w.hours), 0));
  const donePlan = round1(done.reduce((a, w) => a + (w.hours || 0), 0));

  // 数量：按工单所属订单的数量统计（同一订单的多个工序不重复计数）
  const orderIds = new Set(wos.map((w) => w.orderId));
  const relatedOrders = orders.filter((o) => orderIds.has(o.id));
  const planQty = relatedOrders.reduce((a, o) => a + (Number(o.qty) || 0), 0);
  // 实际产量：取每个订单最后一个工序的 actualQty（避免多工序重复累加）
  let actualQty = 0;
  for (const o of relatedOrders) {
    const orderWos = wos.filter((w) => w.orderId === o.id).sort((a, b) => a.start - b.start);
    const last = orderWos[orderWos.length - 1];
    if (last?.actualQty != null) actualQty += Number(last.actualQty) || 0;
  }

  // 超期判定带容差：实际完成时间晚于计划 > 1 小时才算超期。
  // 原实现只要晚 1 分钟就算超期，现实中几乎每个工单都会"超期"，
  // 指标失去参考意义。
  const OVERDUE_TOLERANCE_MS = HOUR;
  const overdue = done.filter((w) => {
    if (w.actualEnd == null) return false;
    return w.actualEnd > w.start + w.hours * HOUR + OVERDUE_TOLERANCE_MS;
  });

  return {
    planHours,
    actualHours,
    // 工时达成率 = 计划/实际（越大越省时）
    hoursRate: actualHours > 0 && donePlan > 0 ? Math.round((donePlan / actualHours) * 1000) / 10 : 0,
    planQty,
    actualQty,
    qtyRate: planQty > 0 ? Math.round((actualQty / planQty) * 1000) / 10 : 0,
    doneCount: done.length,
    totalCount: wos.length,
    overdueCount: overdue.length,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** 按某个维度分组后再计算 */
function groupBy(
  wos: WorkOrderLike[],
  orders: OrderLike[],
  keyOf: (w: WorkOrderLike) => string,
  labelOf: (w: WorkOrderLike) => string,
): GroupAchievement[] {
  const map = new Map<string, { label: string; items: WorkOrderLike[] }>();
  for (const w of wos) {
    const k = keyOf(w);
    if (!map.has(k)) map.set(k, { label: labelOf(w), items: [] });
    map.get(k)!.items.push(w);
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, label: v.label, ...aggregate(v.items, orders) }))
    .sort((a, b) => b.planHours - a.planHours);
}

/**
 * 生成达成率报告。
 * @param workOrders 工单列表
 * @param orders     订单列表
 */
export function buildAchievementReport(workOrders: WorkOrderLike[], orders: OrderLike[]): AchievementReport {
  const overall = aggregate(workOrders, orders);

  // 超期工单明细
  const overdueOrders = workOrders
    .filter((w) => w.status === "done" && w.actualEnd != null)
    .map((w) => {
      const planEnd = w.start + w.hours * HOUR;
      return {
        woId: w.id,
        orderId: w.orderId,
        processName: w.processName,
        lineName: w.lineName,
        planEnd,
        actualEnd: w.actualEnd!,
        lateHours: round1((w.actualEnd! - planEnd) / HOUR),
      };
    })
    // 与统计口径一致：超过 1 小时才算超期
    .filter((x) => x.lateHours > 1)
    .sort((a, b) => b.lateHours - a.lateHours);

  // 交期达成率：只看已完成的订单
  const doneOrders = orders.filter((o) => o.status === "done");
  let onTimeOrders = 0;
  for (const o of doneOrders) {
    const wos = workOrders.filter((w) => w.orderId === o.id);
    if (!wos.length) continue;
    const finishedAt = Math.max(...wos.map((w) => w.actualEnd ?? w.start + w.hours * HOUR));
    const dueTs = o.due ? new Date(`${o.due}T23:59:59`).getTime() : Infinity;
    if (finishedAt <= dueTs) onTimeOrders += 1;
  }

  return {
    overall,
    byLine: groupBy(workOrders, orders, (w) => w.lineId, (w) => w.lineName),
    byProcess: groupBy(workOrders, orders, (w) => w.processId || w.processName, (w) => w.processName),
    overdueOrders,
    doneOrders: doneOrders.length,
    onTimeOrders,
    dueRate: doneOrders.length > 0 ? Math.round((onTimeOrders / doneOrders.length) * 1000) / 10 : 0,
  };
}

/** 达成率等级（用于配色） */
export function rateLevel(rate: number): "excellent" | "good" | "warn" | "bad" {
  if (rate >= 100) return "excellent";
  if (rate >= 90) return "good";
  if (rate >= 75) return "warn";
  return "bad";
}

export const RATE_META: Record<string, { label: string; color: string; type: "success" | "warning" | "danger" | "info" }> = {
  excellent: { label: "优秀", color: "#67c23a", type: "success" },
  good: { label: "良好", color: "#95d475", type: "success" },
  warn: { label: "偏低", color: "#e6a23c", type: "warning" },
  bad: { label: "较差", color: "#f56c6c", type: "danger" },
};
