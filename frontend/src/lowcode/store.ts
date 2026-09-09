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

function saveToStorage(projects: LowcodeProjects): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // 存储超限等场景静默失败，不影响编辑
  }
}

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

    /** 持久化到 localStorage */
    persist() {
      saveToStorage(this.projects);
      this.savedAt = Date.now();
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
