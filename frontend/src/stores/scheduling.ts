// ============================================================================
// 排产算法核心：基于班次的工作时间推进器
//
// 解决的问题（原实现）：
//   · 订单数量 qty 完全不参与加工时长计算
//   · 产线 hoursPerDay（日产能）与班次从未被使用，等于假设 7×24 全天可用
//   · 交期 due 不参与排产，也不做逾期提示
//   · 优先级 priority 不影响排产顺序
// ============================================================================

const HOUR = 3600000;

/** 产线班次（无配置时按 24 小时算） */
export interface Shift {
  shiftStart: number; // 0-23
  shiftEnd: number; // 1-24
  breakHours?: number;
  offDays?: number[]; // 0=周日 … 6=周六
}

/** 归一化班次配置 */
export function normalizeShift(s?: Partial<Shift>): Shift {
  return {
    shiftStart: s?.shiftStart ?? 0,
    shiftEnd: s?.shiftEnd ?? 24,
    breakHours: s?.breakHours ?? 0,
    offDays: s?.offDays ?? [],
  };
}

/** 一天中该班次的有效工作区间（小时，开闭区间） */
function shiftSpan(shift: Shift): number {
  const start = shift.shiftStart;
  const end = shift.shiftEnd;
  const span = start < end ? end - start : 24 - start + end;
  return Math.max(0, span);
}

/** 该产线每日有效工时（班次时长 - 休息） */
export function dailyCapacity(s?: Partial<Shift>): number {
  const shift = normalizeShift(s);
  return Math.max(0, shiftSpan(shift) - (shift.breakHours ?? 0));
}

/** 某天是否停产 */
function isOffDay(d: Date, shift: Shift): boolean {
  return (shift.offDays || []).includes(d.getDay());
}

/**
 * 把时刻推进到「下一个可工作时刻」。
 * 若当前已在工作时间内则原样返回。
 */
export function nextWorkingTime(ts: number, shiftRaw?: Partial<Shift>, maxDays = 60): number {
  const shift = normalizeShift(shiftRaw);
  if (shiftSpan(shift) === 0) return ts; // 产线不工作
  let t = ts;
  for (let i = 0; i < maxDays * 24; i++) {
    const d = new Date(t);
    if (!isOffDay(d, shift)) {
      const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
      const { shiftStart: start, shiftEnd: end } = shift;
      if (start < end) {
        if (h >= start && h < end) return t;
        // 当天未开始 → 推到当天开始；已结束 → 次日开始
        const target = new Date(d);
        if (h < start) target.setHours(start, 0, 0, 0);
        else {
          target.setDate(target.getDate() + 1);
          target.setHours(start, 0, 0, 0);
        }
        t = target.getTime();
      } else {
        // 跨零点班次
        if (h >= start || h < end) return t;
        const target = new Date(d);
        target.setHours(start, 0, 0, 0);
        t = target.getTime();
      }
    } else {
      // 休息日 → 次日班次开始
      const target = new Date(d);
      target.setDate(target.getDate() + 1);
      target.setHours(shift.shiftStart, 0, 0, 0);
      t = target.getTime();
    }
  }
  return ts + maxDays * 24 * HOUR;
}

/**
 * 在产线上从 startAt 开始推进 needHours 个「有效工时」。
 *
 * 实现思路（最直白、无边界陷阱）：
 *   以 1 小时为步长沿时间轴行走，只有落在「班次内且当日已排时长未超 dayCap」的时间才计工时。
 *   虽然比按天切片慢一点（最多几百次循环），但逻辑简单、不易出错，
 *   对排产这种非高频操作完全够用。
 *
 * @returns 工作完成时刻（时间戳）
 */
export function advanceHours(startAt: number, needHours: number, shiftRaw?: Partial<Shift>, maxDays = 120): number {
  const shift = normalizeShift(shiftRaw);
  if (needHours <= 0) return startAt;
  if (shiftSpan(shift) === 0) return startAt + maxDays * 24 * HOUR;

  const dayCap = dailyCapacity(shift);
  if (dayCap <= 0) return startAt + maxDays * 24 * HOUR;

  // 起点对齐到下一个班次开始（若当前不在班次内）
  let t = nextWorkingTime(startAt, shift, maxDays);
  const HOUR_MS = 3600000;
  let remaining = needHours;
  const limitTs = startAt + maxDays * 24 * HOUR_MS;

  // 记录每个「工作日」已排的工时，key = 该班次日零点时间戳
  const usedByDay = new Map<number, number>();

  while (remaining > 1e-9 && t < limitTs) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    const { shiftStart: start, shiftEnd: end } = shift;
    const inShift = start < end ? h >= start && h < end : h >= start || h < end;

    if (inShift) {
      // 计算该时刻所属「班次日」的零点
      const base = new Date(d);
      base.setHours(0, 0, 0, 0);
      if (start >= end && h < end) base.setDate(base.getDate() - 1); // 跨零点凌晨段归属前一天
      const key = base.getTime();
      const used = usedByDay.get(key) ?? 0;
      if (used < dayCap - 1e-9) {
        const step = Math.min(1, remaining, dayCap - used);
        t += step * HOUR_MS;
        remaining -= step;
        usedByDay.set(key, used + step);
        continue;
      }
    }
    // 不在班次内 或 当日产能已满 → 前进到下个整点，继续找
    t += HOUR_MS;
  }
  return t;
}

/** 加工时长估算：优先用产能（件/小时），否则回退到固定工时 */
export function estimateDurationHours(qty: number, process: { hours?: number; ratePerHour?: number; setupHours?: number }): number {
  const setup = Number(process.setupHours) || 0;
  const rate = Number(process.ratePerHour);
  if (Number.isFinite(rate) && rate > 0) {
    return Math.max(0.5, Math.ceil(((Number(qty) || 0) / rate) * 2) / 2) + setup; // 向上取整到 0.5 小时
  }
  return (Number(process.hours) || 1) + setup;
}

/** 交期评估 */
export function evaluateDue(plannedEnd: number, dueYmd: string): { late: boolean; lateDays: number } {
  if (!dueYmd) return { late: false, lateDays: 0 };
  const due = new Date(`${dueYmd}T23:59:59`).getTime();
  if (!Number.isFinite(due)) return { late: false, lateDays: 0 };
  if (plannedEnd <= due) return { late: false, lateDays: 0 };
  return { late: true, lateDays: Math.ceil((plannedEnd - due) / (24 * HOUR)) };
}

/** 工单占用区间（用于冲突检测） */
export function overlaps(aStart: number, aHours: number, bStart: number, bHours: number): boolean {
  return aStart < bStart + bHours * HOUR && aStart + aHours * HOUR > bStart;
}
