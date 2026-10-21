// ============================================================================
// 操作日志（4.9）：全平台行为审计
//
// 存储策略：
//   · 后端可用 → 日志写入服务端并按月归档（backend/data/audit/*.jsonl），
//     不限条数、支持分页查询与按时间留存（默认 36 个月），满足 4.8「存储≥3年」；
//   · 后端不可用 → 暂存本地缓冲（localStorage，最多 500 条），恢复连接后自动补传。
//     本地 500 条只是离线兜底，不再是日志总量的上限。
// ============================================================================

import { defineStore } from "pinia";
import { useUserStore } from "./user";
import { fetchLogs, pushLogs, clearLogs, type AuditLog, type AuditQuery } from "../api/audit";

export type AuditEntry = AuditLog;

const LS_KEY = "ailab.audit.v1";
/** 离线本地缓冲上限（不是日志总量上限） */
const LOCAL_BUFFER_MAX = 500;
const FLUSHED_FLAG = "ailab.audit.flushed.v1";

function loadLocal(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

export const useAuditStore = defineStore("audit", {
  state: () => ({
    /** 离线缓冲（后端可用时仅作展示兜底） */
    entries: loadLocal(),
    /** 后端是否可用 */
    backendOnline: null as null | boolean,
    /** 服务端日志总数 */
    serverTotal: 0,
    flushing: false,
    /** 进行中的冲刷 Promise（并发调用复用同一个请求） */
    pendingFlush: null as Promise<void> | null,
  }),
  getters: {
    /** 兼容旧用法：当前可见条数（服务端模式下为服务端总数） */
    count(state): number {
      return state.backendOnline ? state.serverTotal : state.entries.length;
    },
  },
  actions: {
    persistLocal() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.entries));
      } catch {
        /* ignore */
      }
    },

    /** 记录一条操作日志：本地兜底 + 异步提交后端 */
    log(module: string, action: string, detail: string) {
      const userStore = useUserStore();
      const entry: AuditEntry = {
        time: Date.now(),
        user: userStore.name || "系统",
        role: userStore.role || "viewer",
        module,
        action,
        detail,
      };
      this.entries.unshift(entry);
      if (this.entries.length > LOCAL_BUFFER_MAX) this.entries.length = LOCAL_BUFFER_MAX;
      this.persistLocal();
      void this.flush();
    },

    /**
     * 把本地缓冲批量提交到后端。
     * 修复：原实现成功后 `this.entries = []` 会把「等待网络期间新写入的日志」一并清掉；
     * 这里先快照本批要发的条目，成功后只移除这些条目（按对象引用比对），
     * 并保证并发调用复用同一个进行中的请求，避免同时发出两份重复日志。
     */
    async flush() {
      if (this.flushing) return this.pendingFlush;
      if (!this.entries.length) return;
      this.flushing = true;
      this.pendingFlush = (async () => {
        try {
          // 本批快照：只发送发起时刻已存在的条目
          const batch = [...this.entries].reverse();
          const ok = await pushLogs(batch);
          this.backendOnline = ok;
          if (ok) {
            // 只移除已成功提交的条目，期间新 log() 写入的会保留在缓冲中
            const sent = new Set(batch);
            this.entries = this.entries.filter((e) => !sent.has(e));
            this.persistLocal();
            localStorage.setItem(FLUSHED_FLAG, "1");
          }
        } finally {
          this.flushing = false;
        }
      })();
      const p = this.pendingFlush;
      await p;
      // 发送期间若又有新日志写入，继续冲刷
      if (!this.flushing && this.entries.length && this.backendOnline) await this.flush();
    },

    /** 初始化：检测后端并补传离线日志 */
    async init() {
      await this.flush();
      const res = await fetchLogs({ page: 1, pageSize: 1 });
      this.backendOnline = res.ok;
      if (res.ok) this.serverTotal = res.total;
    },

    /** 分页查询（后端优先，失败回退本地缓冲） */
    async queryPage(q: AuditQuery): Promise<{ logs: AuditEntry[]; total: number; offline: boolean }> {
      const res = await fetchLogs(q);
      if (res.ok) {
        this.backendOnline = true;
        this.serverTotal = res.total;
        return { logs: res.logs, total: res.total, offline: false };
      }
      this.backendOnline = false;
      const keyword = (q.keyword || "").trim();
      const filtered = this.entries.filter(
        (e) =>
          (!q.module || e.module === q.module) &&
          (!q.role || e.role === q.role) &&
          (!q.user || e.user.includes(q.user)) &&
          (!keyword || e.action.includes(keyword) || e.detail.includes(keyword) || e.user.includes(keyword))
      );
      const page = q.page || 1;
      const pageSize = q.pageSize || 20;
      const start = (page - 1) * pageSize;
      return { logs: filtered.slice(start, start + pageSize), total: filtered.length, offline: true };
    },

    /** 清空日志（后端优先） */
    async clearAll() {
      const res = await clearLogs(true);
      this.entries = [];
      this.persistLocal();
      this.serverTotal = 0;
      return res;
    },
  },
});
