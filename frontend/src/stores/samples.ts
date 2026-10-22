// ============================================================================
// 样品管理（4.5）：入库 / 测试 / 跟踪 / 出库 / 报废 / 溯源 全流程
// ============================================================================

import { defineStore } from "pinia";
import { useAuditStore } from "./audit";
import { apiUrl } from "../api/base";

export type SampleStatus = "in" | "testing" | "done" | "out" | "scrapped";
/** 允许的状态迁移表（终态 out / scrapped 不可再变） */
export const ALLOWED_TRANSITIONS: Record<SampleStatus, SampleStatus[]> = {
  in: ["testing", "scrapped"],
  testing: ["testing", "done", "scrapped"],
  done: ["out", "scrapped"],
  out: [],
  scrapped: [],
};

export interface SampleTest {
  time: number;
  item: string;
  /** 自由文本描述（保留兼容，如 "合格 (86MPa)"） */
  result: string;
  /** 结构化判定：合格/不合格/待复检。未填时从 result 文本推断 */
  verdict?: "pass" | "fail" | "pending";
  /** 实测数值 */
  value?: number;
  /** 单位 */
  unit?: string;
  /** 关联的 IoT 设备（测试数据可追溯到设备） */
  deviceId?: string;
  /** 关联的自动化测试运行记录 */
  runId?: string;
  tester: string;
}

export interface SampleLog {
  time: number;
  action: string;
  by: string;
  desc: string;
}

export interface Sample {
  id: string;
  name: string;
  type: string;
  batch: string;
  inDate: number;
  status: SampleStatus;
  location: string;
  owner: string;
  tests: SampleTest[];
  logs: SampleLog[];
  /** 出库去向/领用人（结构化） */
  outboundTo?: string;
  outboundAt?: number;
  /** 报废原因 */
  scrapReason?: string;
  /** 备注 */
  note?: string;
}

export const SAMPLE_STATUS_LABELS: Record<SampleStatus, { text: string; type: string }> = {
  in: { text: "在库待测", type: "info" },
  testing: { text: "测试中", type: "primary" },
  done: { text: "测试完成", type: "success" },
  out: { text: "已出库", type: "warning" },
  scrapped: { text: "已报废", type: "danger" },
};

const LS_KEY = "ailab.samples.v1";
/** 后端同步防抖定时器 */
let sampleSyncTimer: ReturnType<typeof setTimeout> | undefined;

function day(offset: number): number {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  return d.getTime() + offset * 86400000;
}
function fmt(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

/**
 * 从「已有样品编号」推导下一个可用序号（纯函数）。
 *
 * 修复历史：
 *   1) 原实现用模块级 `let seq = 100`，刷新页面后重新计数 → 样品编号重复、履历串样；
 *   2) 上一版改为在 nextId() 内调用 useSampleStore()，但 seed() 是在 store 的
 *      state() 初始化期间被调用的，此刻 store 实例尚未注册，useSampleStore() 返回
 *      undefined → 白屏 "Cannot read properties of undefined (reading 'reduce')"。
 * 现在改为纯函数，由调用方显式传入现有列表：
 *   · 初始化种子数据时传空数组（种子编号由 makeSamples 自己递增）；
 *   · 运行时新增样品时传 this.samples。
 */
/**
 * 从测试结果文本推断判定。
 * 历史数据只有自由文本（如 "合格 (86MPa)"），无法统计合格率，
 * 这里提供兼容推断；新数据应直接写入 verdict 字段。
 */
function inferVerdict(text: string, explicit?: "pass" | "fail" | "pending"): "pass" | "fail" | "pending" {
  if (explicit) return explicit;
  const t = String(text || "");
  if (/不合格|失败|超差|NG/i.test(t)) return "fail";
  if (/待复检|待定|复核|pending/i.test(t)) return "pending";
  if (/合格|通过|OK/i.test(t)) return "pass";
  return "pending";
}

function nextSampleId(existing: Array<{ id?: string }>): string {
  const max = existing.reduce((m, s) => {
    const hit = /^SMP-(\d+)$/.exec(String(s.id || ""));
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 1000);
  return `SMP-${max + 1}`;
}

function seed(): Sample[] {
  // 种子数据在 store 初始化期间生成，不能用 useSampleStore()，这里使用局部计数器
  let seedSeq = 1100;
  const nextId = () => `SMP-${++seedSeq}`;
  const mk = (
    name: string,
    type: string,
    batch: string,
    inOffset: number,
    status: SampleStatus,
    location: string,
    owner: string,
    tests: SampleTest[] = []
  ): Sample => {
    const logs: SampleLog[] = [
      { time: day(inOffset), action: "入库", by: "样品管理员-李工", desc: `样品入库，存放于 ${location}` },
    ];
    if (tests.length) logs.push({ time: day(inOffset + 1), action: "测试", by: tests[0].tester, desc: `${tests[0].item}：${tests[0].result}` });
    if (status === "out") logs.push({ time: day(inOffset + 2), action: "出库", by: "库管-王工", desc: "领用出库，去向：项目组A" });
    if (status === "scrapped") logs.push({ time: day(inOffset + 1), action: "报废", by: "质量部-陈工", desc: "复测不合格，按规程报废" });
    return { id: nextId(), name, type, batch, inDate: day(inOffset), status, location, owner, tests, logs };
  };
  return [
    mk("铝合金拉伸试样", "金属", "B-26-01", -3, "testing", "A区-1号柜", "张工", [
      { time: day(-2), item: "抗拉强度", result: "合格 (86MPa)", tester: "检测员-赵工" },
    ]),
    mk("不锈钢焊接试板", "金属", "B-26-02", -2, "done", "A区-2号柜", "李工", [
      { time: day(-1), item: "焊缝探伤", result: "合格 (Ⅱ级)", tester: "检测员-赵工" },
    ]),
    mk("PCB 可靠性板", "电子", "B-26-03", -1, "in", "B区-5号柜", "刘工"),
    mk("高分子材料片", "高分子", "B-26-01", -4, "out", "B区-3号柜", "周工"),
    mk("电子元器件样本", "电子", "B-26-02", -5, "scrapped", "B区-6号柜", "孙工"),
    mk("涂层试片", "涂层", "B-26-04", 0, "in", "C区-1号柜", "钱工"),
    mk("碳纤维复材板", "复合材料", "B-26-03", -2, "testing", "C区-2号柜", "吴工", [
      { time: day(-1), item: "层间剪切", result: "待复核 (42MPa)", tester: "检测员-郑工" },
    ]),
    mk("润滑油样", "化工", "B-26-05", 0, "in", "C区-4号柜", "冯工"),
  ];
}

export const useSampleStore = defineStore("samples", {
  state: () => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) return { samples: JSON.parse(raw) as Sample[], backendOnline: null as null | boolean, loaded: false, lastSyncError: "" };
    } catch {
      /* ignore */
    }
    return { samples: seed(), backendOnline: null as null | boolean, loaded: false, lastSyncError: "" };
  },
  getters: {
    counts(state): Record<SampleStatus, number> {
      const c = { in: 0, testing: 0, done: 0, out: 0, scrapped: 0 };
      for (const s of state.samples) c[s.status] += 1;
      return c;
    },
  },
  actions: {
    /**
     * 持久化：本地 localStorage + 后端 PostgreSQL 双写。
     * 此前只写 localStorage，换设备/清缓存即丢，且无法多人协同。
     */
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.samples));
      } catch {
        /* 本地存储满等情况忽略 */
      }
      // 后端异步同步（防抖）
      clearTimeout(sampleSyncTimer);
      sampleSyncTimer = setTimeout(() => {
        void this.pushToServer();
      }, 300);
    },

    /** 推送全部样品到后端 */
    async pushToServer() {
      try {
        const res = await fetch(apiUrl("/api/samples"), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ samples: this.samples }),
        });
        this.backendOnline = res.ok;
        this.lastSyncError = res.ok ? "" : `同步失败（${res.status}）`;
      } catch {
        this.backendOnline = false;
        this.lastSyncError = "无法连接后端，数据暂存在本地";
      }
    },

    /** 从后端加载；后端为空时上传本地种子数据完成初始化 */
    async loadFromServer() {
      try {
        const res = await fetch(apiUrl("/api/samples"), { credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.backendOnline = false;
          this.lastSyncError = body?.error || `加载失败（${res.status}）`;
          return false;
        }
        this.backendOnline = true;
        const list = body?.samples;
        if (Array.isArray(list) && list.length) {
          this.samples = list;
          try {
            localStorage.setItem(LS_KEY, JSON.stringify(list));
          } catch {
            /* ignore */
          }
        } else {
          await this.pushToServer();
        }
        return true;
      } catch {
        this.backendOnline = false;
        this.lastSyncError = "无法连接后端，使用本地数据";
        return false;
      } finally {
        this.loaded = true;
      }
    },
    /**
     * 状态机守卫：样品的合法迁移
     *   in → testing → done → out
     *   任意非终态 → scrapped（终态不可再变）
     * 修复：原实现没有任何前置校验，已出库/已报废样品会被自动测试改回「测试中」并写入合格结论。
     */
    canTransition(id: string, to: SampleStatus): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      return ALLOWED_TRANSITIONS[s.status]?.includes(to) ?? false;
    },
    addSample(s: { name: string; type: string; batch: string; location: string; owner: string }) {
      this.samples.unshift({
        id: nextSampleId(this.samples),
        name: s.name,
        type: s.type,
        batch: s.batch,
        inDate: Date.now(),
        status: "in",
        location: s.location,
        owner: s.owner,
        tests: [],
        logs: [{ time: Date.now(), action: "入库", by: s.owner, desc: `样品入库，存放于 ${s.location}` }],
      });
      this.persist();
      useAuditStore().log("样品", "入库", `样品 ${this.samples[0].id}「${s.name}」登记入库`);
    },
    recordTest(id: string, test: { item: string; result: string; tester: string }): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      // 只有 in/testing 状态可以记录测试；已出库/已报废样品直接拒绝
      if (s.status !== "in" && s.status !== "testing" && s.status !== "done") return false;
      const verdict = inferVerdict(test.result, (test as any).verdict);
      s.tests.push({ ...test, time: Date.now(), verdict });
      s.status = s.status === "done" ? "done" : "testing";
      s.logs.push({ time: Date.now(), action: "测试", by: test.tester, desc: `${test.item}：${test.result}` });
      this.persist();
      useAuditStore().log("样品", "测试", `样品 ${id} 测试 ${test.item}：${test.result}`);
      return true;
    },
    finishTest(id: string): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      if (!this.canTransition(id, "done")) return false;
      s.status = "done";
      s.logs.push({ time: Date.now(), action: "测试完成", by: s.owner, desc: "全部测试项完成，判定合格" });
      this.persist();
      return true;
    },
    outbound(id: string, by: string, to?: string): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      if (!this.canTransition(id, "out")) return false;
      s.status = "out";
      // 结构化记录去向与时间，便于追溯（原实现只写自由文本）
      s.outboundTo = to || by;
      s.outboundAt = Date.now();
      s.logs.push({ time: Date.now(), action: "出库", by, desc: to ? `领用出库 → ${to}` : "领用出库" });
      this.persist();
      useAuditStore().log("样品", "出库", `样品 ${id} 由 ${by} 领用出库`);
      return true;
    },
    scrap(id: string, reason: string): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      if (!this.canTransition(id, "scrapped")) return false;
      s.status = "scrapped";
      s.scrapReason = reason;
      s.logs.push({ time: Date.now(), action: "报废", by: "质量部-陈工", desc: reason });
      this.persist();
      useAuditStore().log("样品", "报废", `样品 ${id} 报废：${reason}`);
      return true;
    },
    /** 编辑样品基础信息（名称/类型/批次/库位/负责人/备注） */
    updateSample(id: string, patch: Partial<Pick<Sample, "name" | "type" | "batch" | "location" | "owner" | "note">>): boolean {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return false;
      const changed: string[] = [];
      for (const k of ["name", "type", "batch", "location", "owner", "note"] as const) {
        if (patch[k] !== undefined && patch[k] !== s[k]) {
          s[k] = patch[k] as any;
          changed.push(k);
        }
      }
      if (!changed.length) return true;
      s.logs.push({ time: Date.now(), action: "修改信息", by: s.owner, desc: `更新字段：${changed.join("、")}` });
      this.persist();
      useAuditStore().log("样品", "修改信息", `样品 ${id} 更新 ${changed.join("、")}`);
      return true;
    },

    /**
     * 删除样品。
     * 仅允许删除「在库待测」状态且无测试记录的样品——
     * 已有测试数据或已出库/报废的样品属于质量记录，不应删除。
     */
    removeSample(id: string): { ok: boolean; reason?: string } {
      const idx = this.samples.findIndex((x) => x.id === id);
      if (idx < 0) return { ok: false, reason: "样品不存在" };
      const s = this.samples[idx];
      if (s.tests.length > 0) return { ok: false, reason: "该样品已有测试记录，属于质量档案，不允许删除" };
      if (s.status !== "in") return { ok: false, reason: `当前状态（${SAMPLE_STATUS_LABELS[s.status]?.text || s.status}）不允许删除` };
      this.samples.splice(idx, 1);
      this.persist();
      useAuditStore().log("样品", "删除", `删除样品 ${id}「${s.name}」`);
      return { ok: true };
    },

    /** 批量出库（返回成功条数） */
    outboundBatch(ids: string[], by: string, to?: string): number {
      let n = 0;
      for (const id of ids) if (this.outbound(id, by, to)) n += 1;
      return n;
    },

    /** 合格率统计（基于结构化判定） */
    passRate(): { total: number; pass: number; fail: number; pending: number; rate: number } {
      let pass = 0, fail = 0, pending = 0;
      for (const s of this.samples) {
        for (const t of s.tests) {
          const v = inferVerdict(t.result, t.verdict);
          if (v === "pass") pass += 1;
          else if (v === "fail") fail += 1;
          else pending += 1;
        }
      }
      const total = pass + fail + pending;
      // 合格率只按已判定的计算（待复检不计入分母）
      const judged = pass + fail;
      return { total, pass, fail, pending, rate: judged > 0 ? Math.round((pass / judged) * 1000) / 10 : 0 };
    },

    trace(id: string): Sample | null {
      return this.samples.find((x) => x.id.toLowerCase() === String(id).trim().toLowerCase()) || null;
    },
  },
});

export { fmt };
