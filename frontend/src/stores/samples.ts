// ============================================================================
// 样品管理（4.5）：入库 / 测试 / 跟踪 / 出库 / 报废 / 溯源 全流程
// ============================================================================

import { defineStore } from "pinia";
import { useAuditStore } from "./audit";

export type SampleStatus = "in" | "testing" | "done" | "out" | "scrapped";

export interface SampleTest {
  time: number;
  item: string;
  result: string;
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
}

export const SAMPLE_STATUS_LABELS: Record<SampleStatus, { text: string; type: string }> = {
  in: { text: "在库待测", type: "info" },
  testing: { text: "测试中", type: "primary" },
  done: { text: "测试完成", type: "success" },
  out: { text: "已出库", type: "warning" },
  scrapped: { text: "已报废", type: "danger" },
};

const LS_KEY = "ailab.samples.v1";

function day(offset: number): number {
  const d = new Date();
  d.setHours(10, 0, 0, 0);
  return d.getTime() + offset * 86400000;
}
function fmt(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

let seq = 100;
function nextId(): string {
  seq += 1;
  return `SMP-${String(1000 + seq)}`;
}

function seed(): Sample[] {
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
      if (raw) return { samples: JSON.parse(raw) as Sample[] };
    } catch {
      /* ignore */
    }
    return { samples: seed() };
  },
  getters: {
    counts(state): Record<SampleStatus, number> {
      const c = { in: 0, testing: 0, done: 0, out: 0, scrapped: 0 };
      for (const s of state.samples) c[s.status] += 1;
      return c;
    },
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.samples));
      } catch {
        /* ignore */
      }
    },
    addSample(s: { name: string; type: string; batch: string; location: string; owner: string }) {
      this.samples.unshift({
        id: nextId(),
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
    recordTest(id: string, test: { item: string; result: string; tester: string }) {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return;
      s.tests.push({ ...test, time: Date.now() });
      s.status = s.status === "done" ? "done" : "testing";
      s.logs.push({ time: Date.now(), action: "测试", by: test.tester, desc: `${test.item}：${test.result}` });
      this.persist();
      useAuditStore().log("样品", "测试", `样品 ${id} 测试 ${test.item}：${test.result}`);
    },
    finishTest(id: string) {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return;
      s.status = "done";
      s.logs.push({ time: Date.now(), action: "测试完成", by: s.owner, desc: "全部测试项完成，判定合格" });
      this.persist();
    },
    outbound(id: string, by: string) {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return;
      s.status = "out";
      s.logs.push({ time: Date.now(), action: "出库", by, desc: "领用出库" });
      this.persist();
      useAuditStore().log("样品", "出库", `样品 ${id} 由 ${by} 领用出库`);
    },
    scrap(id: string, reason: string) {
      const s = this.samples.find((x) => x.id === id);
      if (!s) return;
      s.status = "scrapped";
      s.logs.push({ time: Date.now(), action: "报废", by: "质量部-陈工", desc: reason });
      this.persist();
      useAuditStore().log("样品", "报废", `样品 ${id} 报废：${reason}`);
    },
    trace(id: string): Sample | null {
      return this.samples.find((x) => x.id.toLowerCase() === String(id).trim().toLowerCase()) || null;
    },
  },
});

export { fmt };
