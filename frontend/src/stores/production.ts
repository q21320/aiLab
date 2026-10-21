// ============================================================================
// 排产模块（4.4）：订单 / 工序 / 产能 / 工单 / 进度 / 异常
// 本地持久化（localStorage），后续可替换为后端接口。
// ============================================================================

import { defineStore } from "pinia";
import { useAuditStore } from "./audit";
import { advanceHours, estimateDurationHours, evaluateDue, nextWorkingTime } from "./scheduling";

export type OrderStatus = "draft" | "scheduled" | "producing" | "done";

export interface ProductionOrder {
  id: string;
  product: string;
  qty: number;
  due: string; // 交期 yyyy-MM-dd
  priority: "high" | "normal" | "low";
  status: OrderStatus;
  createdAt: number;
}

export interface ProcessDef {
  id: string;
  name: string;
  hours: number; // 标准工时（旧字段，保留兼容）
  deviceType: string;
  /** 每小时产量（件/小时）。有值时优先用它计算加工时长 = 数量 / ratePerHour */
  ratePerHour?: number;
  /** 换线准备时间（小时），每次开始该工序前占用 */
  setupHours?: number;
}

export interface CapacityLine {
  id: string;
  name: string;
  type: string;
  /** 每天可用工时（1~24），排产时不会超出该产能 */
  hoursPerDay: number;
  /** 班次开始时间（小时，0-23），默认 8 点 */
  shiftStart: number;
  /** 班次结束时间（小时，0-24），默认 = shiftStart + hoursPerDay */
  shiftEnd: number;
  /** 每天固定停机/休息小时数（如午休 1 小时），会从可用工时中扣除 */
  breakHours?: number;
  /** 一周中不工作的日期（0=周日 … 6=周六），默认仅周末不排产可选 */
  offDays?: number[];
}

export interface WorkOrder {
  id: string;
  orderId: string;
  processId: string;
  processName: string;
  lineId: string;
  lineName: string;
  start: number; // 计划开始时间戳
  hours: number;
  progress: number; // 0-100
  status: "pending" | "running" | "done" | "exception";
}

export interface ExceptionRecord {
  id: string;
  orderId: string;
  woId?: string;
  type: string;
  desc: string;
  time: number;
  handler: string;
  status: "open" | "closed";
}

const LS_KEY = "ailab.production.v1";

function load<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback;
}
function save<T>(v: T) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

function dayStart(offset: number): number {
  const d = new Date();
  d.setHours(9, 0, 0, 0);
  return d.getTime() + offset * 86400000;
}
function dateStr(offset: number): string {
  return new Date(dayStart(offset)).toISOString().slice(0, 10);
}

/**
 * ID 生成（修复历史）：
 *   1) 原实现用模块级 `let seq = 100`，刷新页面后重新计数，
 *      新建订单与历史订单主键重复 → 工单串单、删除误伤；
 *   2) 改为在 nextId() 内调用 useProductionStore() 后，seedWorkOrders() 等
 *      种子函数是在 store 的 state() 初始化期间调用的，此刻 store 实例尚未注册，
 *      useProductionStore() 返回 undefined → 白屏。
 * 现在改为纯函数，由调用方显式传入「现有数据源」：
 *   · 种子数据在 state() 期间生成：用独立计数器，不读取 store；
 *   · 运行时新增：传入当前 store 的全部状态，从已存在的 ID 推导。
 */
function scanMaxId(prefix: string, data: unknown): number {
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  const walk = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const item of v) walk(item);
      return;
    }
    const obj = v as Record<string, unknown>;
    if (typeof obj.id === "string") {
      const m = re.exec(obj.id);
      if (m) max = Math.max(max, Number(m[1]));
    }
    for (const val of Object.values(obj)) if (val && typeof val === "object") walk(val);
  };
  walk(data);
  return max;
}

function nextId(prefix: string, data?: unknown): string {
  return `${prefix}-${scanMaxId(prefix, data) + 1}`;
}

// ---------------------------------------------------------------------------
// 初始演示数据
// ---------------------------------------------------------------------------
function seedOrders(): ProductionOrder[] {
  return [
    { id: "PO-24001", product: "电源模块 PSU-200", qty: 1200, due: dateStr(5), priority: "high", status: "scheduled", createdAt: dayStart(-3) },
    { id: "PO-24002", product: "传感器模组 SN-88", qty: 3000, due: dateStr(6), priority: "normal", status: "scheduled", createdAt: dayStart(-2) },
    { id: "PO-24003", product: "电机控制器 MC-12", qty: 800, due: dateStr(4), priority: "low", status: "draft", createdAt: dayStart(-1) },
  ];
}
function seedProcesses(): ProcessDef[] {
  // ratePerHour = 每小时产量（件/小时）；加工时长 = 订单数量 / 产能 + 换线时间
  return [
    { id: "PR-1", name: "SMT 贴片", hours: 8, deviceType: "SMT", ratePerHour: 200, setupHours: 1 },
    { id: "PR-2", name: "波峰焊", hours: 4, deviceType: "WAVE", ratePerHour: 150, setupHours: 0.5 },
    { id: "PR-3", name: "装配联调", hours: 6, deviceType: "ASSEMBLY", ratePerHour: 100, setupHours: 0.5 },
    { id: "PR-4", name: "老化测试", hours: 12, deviceType: "AGING", ratePerHour: 50, setupHours: 0 },
  ];
}
function seedLines(): CapacityLine[] {
  // shiftStart/shiftEnd = 每天工作时段；hoursPerDay 为该时段内可用工时
  return [
    { id: "LN-1", name: "SMT 生产线", type: "SMT", hoursPerDay: 16, shiftStart: 8, shiftEnd: 24, breakHours: 0 },
    { id: "LN-2", name: "焊接线", type: "WAVE", hoursPerDay: 12, shiftStart: 8, shiftEnd: 20, breakHours: 1 },
    { id: "LN-3", name: "装配线", type: "ASSEMBLY", hoursPerDay: 8, shiftStart: 8, shiftEnd: 17, breakHours: 1 },
    { id: "LN-4", name: "老化试验台", type: "AGING", hoursPerDay: 24, shiftStart: 0, shiftEnd: 24, breakHours: 0 },
  ];
}

const firstDay = dayStart(0);

/** 种子数据在 state() 初始化期间生成，不能访问 store，用局部计数器 */
let seedWoSeq = 200;
let seedExSeq = 0;

function seedWorkOrders(lines: CapacityLine[], processes: ProcessDef[]): WorkOrder[] {
  const mk = (orderId: string, p: ProcessDef, line: CapacityLine, startOffsetH: number, progress: number, status: WorkOrder["status"]): WorkOrder => ({
    id: `WO-${++seedWoSeq}`,
    orderId,
    processId: p.id,
    processName: p.name,
    lineId: line.id,
    lineName: line.name,
    start: firstDay + startOffsetH * 3600000,
    hours: p.hours,
    progress,
    status,
  });
  return [
    mk("PO-24001", processes[0], lines[0], 0, 100, "done"),
    mk("PO-24001", processes[1], lines[1], 9, 60, "running"),
    mk("PO-24001", processes[2], lines[2], 14, 0, "pending"),
    mk("PO-24002", processes[0], lines[0], 10, 30, "running"),
    mk("PO-24002", processes[3], lines[3], 26, 0, "pending"),
    mk("PO-24002", processes[2], lines[2], 30, 0, "pending"),
  ];
}

function seedExceptions(orderIds: string[]): ExceptionRecord[] {
  return [
    {
      id: `EX-${++seedExSeq}`,
      orderId: orderIds[0] || "PO-24001",
      woId: "",
      type: "设备故障",
      desc: "焊接线加热管故障，预计停机 2 小时，已报修",
      time: Date.now() - 3600000,
      handler: "设备科-王工",
      status: "open",
    },
  ];
}

export const useProductionStore = defineStore("production", {
  state: () => {
    const saved = load<Partial<{ orders: ProductionOrder[]; processes: ProcessDef[]; lines: CapacityLine[]; workOrders: WorkOrder[]; exceptions: ExceptionRecord[] }> | null>(null);
    return {
      orders: saved?.orders ?? seedOrders(),
      processes: saved?.processes ?? seedProcesses(),
      lines: saved?.lines ?? seedLines(),
      workOrders: saved?.workOrders ?? seedWorkOrders(seedLines(), seedProcesses()),
      exceptions: saved?.exceptions ?? seedExceptions(seedOrders().map((o) => o.id)),
    };
  },
  getters: {
    openOrders(state): number {
      return state.orders.filter((o) => o.status !== "done").length;
    },
    runningWos(state): number {
      return state.workOrders.filter((w) => w.status === "running" || w.status === "exception").length;
    },
    openExceptions(state): number {
      return state.exceptions.filter((e) => e.status === "open").length;
    },
  },
  actions: {
    persist() {
      save({
        orders: this.orders,
        processes: this.processes,
        lines: this.lines,
        workOrders: this.workOrders,
        exceptions: this.exceptions,
      });
    },

    // ---------- 订单 ----------
    addOrder(o: { product: string; qty: number; due: string; priority: ProductionOrder["priority"] }) {
      this.orders.push({
        id: nextId("PO", this.$state),
        product: o.product,
        qty: o.qty,
        due: o.due,
        priority: o.priority,
        status: "draft",
        createdAt: Date.now(),
      });
      this.persist();
    },
    removeOrder(id: string) {
      this.orders = this.orders.filter((o) => o.id !== id);
      this.workOrders = this.workOrders.filter((w) => w.orderId !== id);
      this.persist();
    },

    /** 依据工序+产能为订单生成工单（顺序排产，round-robin 分配产线） */
    /**
     * 为订单自动排产（考虑产能、班次、换线时间）。
     *
     * 相比旧实现的改进：
     *   1) 加工时长 = 数量 / 每小时产能 + 换线时间（旧：固定工时，与数量无关）
     *   2) 只在产线班次内排产，跨班次自动续接（旧：假设 7×24 可用）
     *   3) 排完后评估是否超交期，超期给出提示
     *   4) 返回失败原因，而不是只返回 false
     */
    scheduleOrder(orderId: string): { ok: boolean; reason?: string; late?: boolean; lateDays?: number } {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return { ok: false, reason: "订单不存在" };
      if (this.workOrders.some((w) => w.orderId === orderId)) {
        return { ok: false, reason: "该订单已排产" };
      }
      if (!this.processes.length) return { ok: false, reason: "尚未配置工序" };

      const windowStart = dayStart(0);
      const windowEnd = dayStart(30); // 窗口放宽到 30 天，避免 7 天排不下
      // 每个工序的「可用起点」：串行依赖，前一个工序结束才能开始下一个
      let cursor = windowStart;
      const created: WorkOrder[] = [];

      for (const p of this.processes) {
        const line = this.lines.find((l) => l.type === p.deviceType) || this.lines[0];
        if (!line) return { ok: false, reason: `工序「${p.name}」没有可用产线` };

        // 加工时长：数量/产能 + 换线
        const durationH = estimateDurationHours(order.qty, p);
        // 从 cursor 开始找工作时段
        let start = nextWorkingTime(Math.max(cursor, windowStart), line);

        // 避开该产线已有工单：逐个检查重叠，向后顺延
        const usages = this.workOrders.filter((w) => w.lineId === line.id);
        let placed = false;
        for (let attempt = 0; attempt < 200; attempt++) {
          const end = advanceHours(start, durationH, line);
          const clash = usages.find((u) => start < u.start + u.hours * 3600000 && end > u.start);
          if (!clash) {
            placed = true;
            break;
          }
          // 顺延到冲突工单结束后的下一个工作时刻
          start = nextWorkingTime(clash.start + clash.hours * 3600000 + 1000, line);
        }
        if (!placed) {
          return { ok: false, reason: `产线「${line.name}」排不下工序「${p.name}」` };
        }

        const end = advanceHours(start, durationH, line);
        if (end > windowEnd) {
          return { ok: false, reason: `订单需排到 ${new Date(end).toLocaleDateString("zh-CN")}，超出 30 天排产窗口` };
        }

        created.push({
          id: nextId("WO", this.$state),
          orderId,
          processId: p.id,
          processName: p.name,
          lineId: line.id,
          lineName: line.name,
          start,
          hours: Math.round(durationH * 10) / 10,
          progress: 0,
          status: "pending",
        });
        cursor = end;
      }

      this.workOrders.push(...created);
      order.status = "scheduled";

      // 交期评估
      const plannedEnd = cursor;
      const dueCheck = evaluateDue(plannedEnd, order.due);
      this.persist();

      const detail = dueCheck.late
        ? `订单 ${orderId} 已排产 ${created.length} 个工单，预计逾期 ${dueCheck.lateDays} 天`
        : `订单 ${orderId} 已排产 ${created.length} 个工单，预计 ${new Date(plannedEnd).toLocaleDateString("zh-CN")} 完成`;
      useAuditStore().log("排产", "自动排产", detail);

      return { ok: true, late: dueCheck.late, lateDays: dueCheck.lateDays };
    },

    /** 看板拖拽：调整工单产线与开始时间 */
    moveWorkOrder(woId: string, lineId: string, start: number) {
      const wo = this.workOrders.find((w) => w.id === woId);
      const line = this.lines.find((l) => l.id === lineId);
      if (!wo || !line) return;
      const winStart = dayStart(0) - 4 * 3600000;
      const winEnd = dayStart(7);
      wo.lineId = line.id;
      wo.lineName = line.name;
      wo.start = Math.max(winStart, Math.min(winEnd - wo.hours * 3600000, Math.round(start / 1800000) * 1800000));
      this.persist();
      useAuditStore().log("排产", "拖拽调整计划", `工单 ${woId} → ${line.name}，开始 ${new Date(wo.start).toLocaleString("zh-CN")}`);
    },

    setProgress(woId: string, progress: number, status: WorkOrder["status"]) {
      const wo = this.workOrders.find((w) => w.id === woId);
      if (!wo) return;
      wo.progress = Math.max(0, Math.min(100, progress));
      wo.status = status;
      if (status === "done") {
        const order = this.orders.find((o) => o.id === wo.orderId);
        if (order && this.workOrders.filter((w) => w.orderId === order.id).every((x) => x.status === "done")) {
          order.status = "done";
        }
      }
      this.persist();
    },

    // ---------- 异常 ----------
    raiseException(e: { orderId: string; woId?: string; type: string; desc: string }) {
      this.exceptions.unshift({
        id: nextId("EX", this.$state),
        orderId: e.orderId,
        woId: e.woId,
        type: e.type,
        desc: e.desc,
        time: Date.now(),
        handler: "待指派",
        status: "open",
      });
      if (e.woId) {
        const wo = this.workOrders.find((w) => w.id === e.woId);
        if (wo) wo.status = "exception";
      }
      this.persist();
      useAuditStore().log("排产", "异常上报", `订单 ${e.orderId}：${e.type} - ${e.desc}`);
    },
    closeException(id: string, handler: string) {
      const ex = this.exceptions.find((e) => e.id === id);
      if (!ex) return;
      ex.status = "closed";
      ex.handler = handler || ex.handler;
      this.persist();
    },

    // ---------- 工艺档案 ----------
    addProcess(p: { name: string; hours: number; deviceType: string; ratePerHour?: number; setupHours?: number }) {
      this.processes.push({
        id: nextId("PR", this.$state),
        name: p.name,
        hours: p.hours,
        deviceType: p.deviceType,
        ratePerHour: p.ratePerHour,
        setupHours: p.setupHours,
      });
      this.persist();
    },
    removeProcess(id: string) {
      this.processes = this.processes.filter((p) => p.id !== id);
      this.persist();
    },
    addLine(l: {
      name: string;
      type: string;
      hoursPerDay: number;
      shiftStart?: number;
      shiftEnd?: number;
      breakHours?: number;
    }) {
      const shiftStart = l.shiftStart ?? 8;
      this.lines.push({
        id: nextId("LN", this.$state),
        name: l.name,
        type: l.type,
        hoursPerDay: l.hoursPerDay,
        shiftStart,
        shiftEnd: l.shiftEnd ?? Math.min(24, shiftStart + l.hoursPerDay),
        breakHours: l.breakHours ?? 0,
      });
      this.persist();
    },

    /** 更新产线班次配置 */
    updateLine(id: string, patch: Partial<CapacityLine>) {
      const l = this.lines.find((x) => x.id === id);
      if (!l) return;
      Object.assign(l, patch);
      this.persist();
      useAuditStore().log("排产", "修改产线", `产线 ${l.name} 班次 ${l.shiftStart}:00-${l.shiftEnd}:00，日产能 ${l.hoursPerDay}h`);
    },

    /** 更新工序产能 */
    updateProcess(id: string, patch: Partial<ProcessDef>) {
      const p = this.processes.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, patch);
      this.persist();
    },
    removeLine(id: string) {
      this.lines = this.lines.filter((l) => l.id !== id);
      this.persist();
    },
  },
});
