// ============================================================================
// 产能负荷分析
//
// 目的：回答「哪条产线排满了、哪条还闲着、哪天的负荷最重」。
// 排产算法只管把工单塞进产线，但不告诉人产线是否过载——
// 这是排产决策最需要的信息。
//
// 计算模型：
//   · 每条产线每天有固定可用工时 = dailyCapacity（班次 - 休息）
//   · 把落在该天的工作时长累加，得到「负荷工时」
//   · 负荷率 = 负荷工时 / 可用工时（>100% 即过载）
//   · 工单跨天时按时段切分，分别计入各自的天
// ============================================================================

import { dailyCapacity, normalizeShift } from "./scheduling";

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** 单条产线单日的负荷 */
export interface DayLoad {
  date: string; // yyyy-MM-dd
  dayStart: number;
  capacityHours: number;
  loadHours: number;
  /** 负荷率百分比（可超过 100） */
  utilization: number;
  workOrderCount: number;
}

/** 产线负荷汇总 */
export interface LineLoad {
  lineId: string;
  lineName: string;
  type: string;
  days: DayLoad[];
  totalCapacityHours: number;
  totalLoadHours: number;
  /** 期间整体负荷率 */
  utilization: number;
  /** 负荷率超过 100% 的天数 */
  overloadedDays: number;
  /** 最忙的一天 */
  peak: DayLoad | null;
}

/** 按本地日期取零点 */
function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** yyyy-MM-dd */
function ymd(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

interface WorkOrderLike {
  id: string;
  lineId: string;
  start: number;
  hours: number;
}

interface LineLike {
  id: string;
  name: string;
  type: string;
  hoursPerDay: number;
  shiftStart?: number;
  shiftEnd?: number;
  breakHours?: number;
  offDays?: number[];
}

/**
 * 计算产能负荷。
 *
 * @param lines   产线列表（含班次配置）
 * @param workOrders 工单列表（含计划开始与工时）
 * @param fromTs  统计起始时间（通常为今天 0 点）
 * @param days    统计天数（默认 7）
 */
export function computeLoad(
  lines: LineLike[],
  workOrders: WorkOrderLike[],
  fromTs: number,
  days = 7,
): LineLoad[] {
  const from = startOfDay(fromTs);
  // 预先建立日期桶
  const buckets: number[] = [];
  for (let i = 0; i < days; i++) buckets.push(from + i * DAY);

  return lines.map((line) => {
    const shift = normalizeShift(line);
    const capPerDay = dailyCapacity(shift);

    const dayLoads: DayLoad[] = buckets.map((dayTs) => ({
      date: ymd(dayTs),
      dayStart: dayTs,
      capacityHours: capPerDay,
      loadHours: 0,
      utilization: 0,
      workOrderCount: 0,
    }));

    const start = shift.shiftStart;
    const end = shift.shiftEnd;

    for (const wo of workOrders) {
      if (wo.lineId !== line.id) continue;
      const woStart = Number(wo.start);
      const woEnd = woStart + Number(wo.hours) * HOUR;
      if (!Number.isFinite(woStart) || !Number.isFinite(woEnd) || woEnd <= woStart) continue;

      for (let i = 0; i < dayLoads.length; i++) {
        const dayStart = buckets[i];
        const dayEnd = dayStart + DAY;

        // 当天的班次区间（跨零点班次会延到次日）
        let shiftBegin: number;
        let shiftFinish: number;
        if (start < end) {
          shiftBegin = dayStart + start * HOUR;
          shiftFinish = dayStart + end * HOUR;
        } else {
          // 跨零点班次：从当天 start 点到次日 end 点
          shiftBegin = dayStart + start * HOUR;
          shiftFinish = dayStart + DAY + end * HOUR;
        }
        // 仅统计落在**班次工作时间**内的部分（排产外的时间不计为负荷）
        const overlap =
          Math.min(woEnd, dayEnd, shiftFinish) - Math.max(woStart, dayStart, shiftBegin);
        if (overlap <= 0) continue;
        dayLoads[i].loadHours += overlap / HOUR;
        dayLoads[i].workOrderCount += 1;
      }
    }

    // 计算负荷率
    for (const d of dayLoads) {
      d.loadHours = Math.round(d.loadHours * 10) / 10;
      d.utilization = d.capacityHours > 0 ? Math.round((d.loadHours / d.capacityHours) * 100) : 0;
    }

    const totalCapacityHours = Math.round(dayLoads.reduce((a, d) => a + d.capacityHours, 0) * 10) / 10;
    const totalLoadHours = Math.round(dayLoads.reduce((a, d) => a + d.loadHours, 0) * 10) / 10;
    const peak = dayLoads.reduce<DayLoad | null>((best, d) => (!best || d.loadHours > best.loadHours ? d : best), null);

    return {
      lineId: line.id,
      lineName: line.name,
      type: line.type,
      days: dayLoads,
      totalCapacityHours,
      totalLoadHours,
      utilization: totalCapacityHours > 0 ? Math.round((totalLoadHours / totalCapacityHours) * 100) : 0,
      overloadedDays: dayLoads.filter((d) => d.utilization > 100).length,
      peak,
    };
  });
}

/** 负荷率对应的语义等级（用于配色） */
export function loadLevel(utilization: number): "idle" | "light" | "normal" | "busy" | "overload" {
  if (utilization <= 0) return "idle";
  if (utilization < 50) return "light";
  if (utilization <= 85) return "normal";
  if (utilization <= 100) return "busy";
  return "overload";
}

export const LOAD_LEVEL_META: Record<string, { label: string; color: string; type: "info" | "success" | "warning" | "danger" }> = {
  idle: { label: "空闲", color: "#dcdfe6", type: "info" },
  light: { label: "轻负载", color: "#95d475", type: "success" },
  normal: { label: "正常", color: "#67c23a", type: "success" },
  busy: { label: "较忙", color: "#e6a23c", type: "warning" },
  overload: { label: "过载", color: "#f56c6c", type: "danger" },
};

/** 统计期间的瓶颈产线（负荷率最高且过载天数最多） */
export function findBottleneck(lines: LineLoad[]): LineLoad | null {
  const sorted = [...lines].sort((a, b) => {
    if (b.overloadedDays !== a.overloadedDays) return b.overloadedDays - a.overloadedDays;
    return b.utilization - a.utilization;
  });
  return sorted[0] && sorted[0].totalLoadHours > 0 ? sorted[0] : null;
}
