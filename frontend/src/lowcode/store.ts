// ============================================================================
// 低代码平台 · 工程存储（Pinia + localStorage 自动保存）
//
// 当前使用浏览器 localStorage 作为 B/S 前端的本地持久层；
// 对接后端时可把 persistence 中的 load/save 替换为 REST 接口，
// 调用方无需改动（详见 README「扩展性」章节）。
// ============================================================================

import { defineStore } from "pinia";
import type { PageSchema } from "./types";
import type { FormSchema } from "./formTypes";
import type { FlowSchema } from "./flowTypes";
import type { ReportSchema } from "./reportTypes";
import type { ScreenSchema } from "./screenTypes";
import {
  defaultPageSchema,
  defaultFormSchema,
  defaultFlowSchema,
  defaultReportSchema,
  defaultScreenSchema,
} from "./defaults";
import { clone } from "./schemaOps";
import { apiUrl } from "../api/base";
import { collectChatsPayload } from "./useChatSession";

const STORAGE_KEY = "ailab.lowcode.projects.v1";

export interface LowcodeProjects {
  page: PageSchema | null;
  form: FormSchema | null;
  flow: FlowSchema | null;
  report: ReportSchema | null;
  screen: ScreenSchema | null;
}

/** 从 localStorage 读取（兼容旧数据缺失/损坏） */
function loadFromStorage(): Partial<LowcodeProjects> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<LowcodeProjects>) : {};
  } catch {
    return {};
  }
}

/**
 * 保存到 localStorage。
 * 返回 { ok, error }：存储超限时**不再静默**——大屏/报表工程容易超 5MB，
 * 用户看不到提示就会以为已保存，关闭页面即丢。
 */
function saveToStorage(projects: LowcodeProjects): { ok: boolean; error?: string } {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    return { ok: true };
  } catch (e: any) {
    const quota = e?.name === "QuotaExceededError" || /quota/i.test(String(e?.message || ""));
    return { ok: false, error: quota ? "本地存储空间已满（约 5MB 上限）" : String(e?.message || "本地保存失败") };
  }
}

/** 后端同步防抖定时器 */
let syncTimer: ReturnType<typeof setTimeout> | undefined;

export const useLowcodeStore = defineStore("lowcode", {
  state: () => ({
    projects: {
      page: null,
      form: null,
      flow: null,
      report: null,
      screen: null,
    } as LowcodeProjects,
    savedAt: 0,
    /** 后端是否可用 */
    backendOnline: null as null | boolean,
    /** 最近同步错误 */
    lastSyncError: "",
    /** 本地存储告警（空间不足等） */
    storageWarning: "",
  }),
  getters: {
    hasData(): boolean {
      return Object.values(this.projects).some((p) => p !== null);
    },
  },
  actions: {
    /** 保证示例工程可用：缺失的工程载入默认示例 */
    ensureDefaults() {
      let changed = false;
      if (!this.projects.page) {
        this.projects.page = defaultPageSchema();
        changed = true;
      }
      if (!this.projects.form) {
        this.projects.form = defaultFormSchema();
        changed = true;
      }
      if (!this.projects.flow) {
        this.projects.flow = defaultFlowSchema();
        changed = true;
      }
      if (!this.projects.report) {
        this.projects.report = defaultReportSchema();
        changed = true;
      }
      if (!this.projects.screen) {
        this.projects.screen = defaultScreenSchema();
        changed = true;
      }
      if (changed) this.persist();
    },

    /** 初始化：读取本地存储 + 补默认示例 */
    init() {
      const saved = loadFromStorage();
      this.projects = {
        page: saved.page ?? null,
        form: saved.form ?? null,
        flow: saved.flow ?? null,
        report: saved.report ?? null,
        screen: saved.screen ?? null,
      };
      this.ensureDefaults();
    },

    /** 保存单个工程 */
    saveProject<K extends keyof LowcodeProjects>(key: K, schema: LowcodeProjects[K]) {
      this.projects[key] = schema;
      this.persist();
    },

    /**
     * 持久化：localStorage + 后端 PostgreSQL 双写。
     *
     * 此前只写 localStorage：换设备/清缓存设计稿全丢，
     * 而「已发布应用」在数据库中，设计与发布两份数据割裂。
     */
    persist() {
      const r = saveToStorage(this.projects);
      this.storageWarning = r.ok ? "" : r.error || "本地保存失败";
      this.savedAt = Date.now();
      // 后端异步同步（防抖 500ms，设计器高频保存不至于打爆接口）
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => {
        void this.pushToServer();
      }, 500);
    },

    /** 推送全部工程 + 聊天会话到后端 */
    async pushToServer() {
      try {
        const res = await fetch(apiUrl("/api/lowcode/projects"), {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projects: this.projects, chats: collectChatsPayload() }),
        });
        this.backendOnline = res.ok;
        this.lastSyncError = res.ok ? "" : `同步失败（${res.status}）`;
      } catch {
        this.backendOnline = false;
        this.lastSyncError = "无法连接后端，工程暂存在本地";
      }
    },

    /**
     * 从后端加载工程。
     * · 后端有数据 → 覆盖本地
     * · 后端为空 → 上传本地（含内置示例）完成初始化
     * · 后端不可达 → 保持本地数据
     */
    async loadFromServer() {
      try {
        const res = await fetch(apiUrl("/api/lowcode/projects"), { credentials: "include" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          this.backendOnline = false;
          this.lastSyncError = body?.error || `加载失败（${res.status}）`;
          return false;
        }
        this.backendOnline = true;
        const p = body?.projects;
        if (p && typeof p === "object" && Object.values(p).some((v) => v !== null)) {
          this.projects = {
            page: p.page ?? null,
            form: p.form ?? null,
            flow: p.flow ?? null,
            report: p.report ?? null,
            screen: p.screen ?? null,
          };
          this.ensureDefaults();
          const r = saveToStorage(this.projects);
          this.storageWarning = r.ok ? "" : r.error || "";
        } else {
          await this.pushToServer();
        }
        return true;
      } catch {
        this.backendOnline = false;
        this.lastSyncError = "无法连接后端，使用本地数据";
        return false;
      }
    },

    /** 重置为默认示例 */
    resetAll() {
      this.projects = {
        page: clone(defaultPageSchema()),
        form: clone(defaultFormSchema()),
        flow: clone(defaultFlowSchema()),
        report: clone(defaultReportSchema()),
        screen: clone(defaultScreenSchema()),
      };
      this.persist();
    },

    /** 清空所有工程 */
    clearAll() {
      this.projects = { page: null, form: null, flow: null, report: null, screen: null };
      this.persist();
    },
  },
});
