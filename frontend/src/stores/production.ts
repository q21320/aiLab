// ============================================================================
// 排产模块（4.4）：订单 / 工序 / 产能 / 工单 / 进度 / 异常
// 本地持久化（localStorage），后续可替换为后端接口。
// ============================================================================

import { defineStore } from "pinia";
import { useAuditStore } from "./audit";

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
  hours: number; // 标准工时（单批）
  deviceType: string;
}

export interface CapacityLine {
  id: string;
  name: string;
  type: string;
  hoursPerDay: number;
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

let seq = 100;
function nextId(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
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
  return [
    { id: "PR-1", name: "SMT 贴片", hours: 8, deviceType: "SMT" },
    { id: "PR-2", name: "波峰焊", hours: 4, deviceType: "WAVE" },
    { id: "PR-3", name: "装配联调", hours: 6, deviceType: "ASSEMBLY" },
    { id: "PR-4", name: "老化测试", hours: 12, deviceType: "AGING" },
  ];
}
function seedLines(): CapacityLine[] {
  return [
    { id: "LN-1", name: "SMT 生产线", type: "SMT", hoursPerDay: 16 },
    { id: "LN-2", name: "焊接线", type: "WAVE", hoursPerDay: 12 },
    { id: "LN-3", name: "装配线", type: "ASSEMBLY", hoursPerDay: 8 },
    { id: "LN-4", name: "老化试验台", type: "AGING", hoursPerDay: 24 },
  ];
}

const firstDay = dayStart(0);

function seedWorkOrders(lines: CapacityLine[], processes: ProcessDef[]): WorkOrder[] {
  const mk = (orderId: string, p: ProcessDef, line: CapacityLine, startOffsetH: number, progress: number, status: WorkOrder["status"]): WorkOrder => ({
    id: nextId("WO"),
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
      id: nextId("EX"),
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
        id: nextId("PO"),
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
    scheduleOrder(orderId: string) {
      const order = this.orders.find((o) => o.id === orderId);
      if (!order) return false;
      if (this.workOrders.some((w) => w.orderId === orderId)) {
        return false; // 已排产
      }
      // 排产窗口：今日 9:00 起 7 天
      const windowStart = dayStart(0);
      const windowEnd = dayStart(7);
      let cursor = windowStart;
      for (const p of this.processes) {
        const line = this.lines.find((l) => l.type === p.deviceType) || this.lines[0];
        if (!line) return false;
        // 避开该产线已有工单占用（找最早空闲起点）
        const usages = this.workOrders.filter((w) => w.lineId === line.id);
        while (usages.find((u) => cursor < u.start + u.hours * 3600000 && cursor + p.hours * 3600000 > u.start) && cursor < windowEnd) {
          cursor = Math.max(...usages.map((u) => u.start + u.hours * 3600000), cursor);
        }
        if (cursor + p.hours * 3600000 > windowEnd) {
          return false; // 排产窗口不足
        }
        this.workOrders.push({
          id: nextId("WO"),
          orderId,
          processId: p.id,
          processName: p.name,
          lineId: line.id,
          lineName: line.name,
          start: cursor,
          hours: p.hours,
          progress: 0,
          status: "pending",
        });
        cursor += p.hours * 3600000;
      }
      order.status = "scheduled";
      this.persist();
      useAuditStore().log("排产", "自动排产", `订单 ${orderId} 已生成 ${this.processes.length} 个工单`);
      return true;
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
        id: nextId("EX"),
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
    addProcess(p: { name: string; hours: number; deviceType: string }) {
      this.processes.push({ id: nextId("PR"), ...p });
      this.persist();
    },
    removeProcess(id: string) {
      this.processes = this.processes.filter((p) => p.id !== id);
      this.persist();
    },
    addLine(l: { name: string; type: string; hoursPerDay: number }) {
      this.lines.push({ id: nextId("LN"), ...l });
      this.persist();
    },
    removeLine(id: string) {
      this.lines = this.lines.filter((l) => l.id !== id);
      this.persist();
    },
  },
});
