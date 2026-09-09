// ============================================================================
// 操作日志（4.9）：全平台行为审计（登录/发布/排产/样品/权限操作）
// ============================================================================

import { defineStore } from "pinia";
import { useUserStore } from "./user";

export interface AuditEntry {
  time: number;
  user: string;
  role: string;
  module: string;
  action: string;
  detail: string;
}

const LS_KEY = "ailab.audit.v1";
const MAX = 500;

function load(): AuditEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as AuditEntry[]) : [];
  } catch {
    return [];
  }
}

export const useAuditStore = defineStore("audit", {
  state: () => ({
    entries: load(),
  }),
  getters: {
    count(state): number {
      return state.entries.length;
    },
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.entries));
      } catch {
        /* ignore */
      }
    },
    /** 记录一条操作日志（模块：权限/应用/排产/样品/大屏/表单/流程/报表/页面） */
    log(module: string, action: string, detail: string) {
      const userStore = useUserStore();
      this.entries.unshift({
        time: Date.now(),
        user: userStore.name || "系统",
        role: userStore.role || "viewer",
        module,
        action,
        detail,
      });
      if (this.entries.length > MAX) this.entries.length = MAX;
      this.persist();
    },
    clear() {
      this.entries = [];
      this.persist();
    },
  },
});
