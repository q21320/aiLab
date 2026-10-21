// ============================================================================
// 低代码平台 · 发布中心（应用列表 + 后端接口同步 + 本地降级）
//
// 工作流：设计器「发布」→ 生成 PublishedApp（Schema 快照）
//        → 写入应用中心列表 → 可挂载到后台菜单 → 以 /app/:kind/:id 运行。
//
// 存储优先级：后端接口（/api/lowcode/apps）可用时以服务端为准；
// 请求失败自动降级 localStorage，保证演示可用。
// ============================================================================

import { defineStore } from "pinia";
import {
  fetchAppsFromServer,
  postAppToServer,
  putAppToServer,
  deleteAppFromServer,
} from "../api/lowcode";
import { clone } from "./schemaOps";
import { sanitizeSchemaTree } from "./sanitize";
import { useAuditStore } from "../stores/audit";

export type PublishKind = "page" | "form" | "flow" | "report" | "screen";

export interface PublishedApp {
  id: string;
  kind: PublishKind;
  name: string;
  /** 设计 Schema 快照（页面/表单/流程/报表/大屏） */
  schema: any;
  publishedAt: number;
  updatedAt: number;
  /** 启用/停用：停用后菜单不展示、运行页提示已停用 */
  enable: boolean;
  /** 是否挂载到后台左侧菜单 */
  menu: boolean;
}

export const PUBLISH_KIND_LABELS: Record<PublishKind, string> = {
  page: "页面",
  form: "表单",
  flow: "流程",
  report: "报表",
  screen: "大屏",
};

export const PUBLISH_KIND_ICONS: Record<PublishKind, string> = {
  page: "Document",
  form: "Tickets",
  flow: "Connection",
  report: "DataAnalysis",
  screen: "Monitor",
};

/** kind → 运行路由段 */
export const PUBLISH_KIND_ROUTE: Record<PublishKind, string> = {
  page: "pages",
  form: "forms",
  flow: "flows",
  report: "reports",
  screen: "screens",
};

const LS_KEY = "ailab.lowcode.published.v1";

function loadLocal(): PublishedApp[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const usePublishStore = defineStore("lowcode-publish", {
  state: () => ({
    apps: [] as PublishedApp[],
    loaded: false,
    /** null=未知；true=后端已连接；false=本地模式 */
    backendOnline: null as null | boolean,
    /** 最近一次同步失败原因（界面直接展示，便于定位 404/未启动等问题） */
    lastSyncError: "",
  }),
  getters: {
    count(state): number {
      return state.apps.length;
    },
  },
  actions: {
    /** 初始化：优先从后端加载，失败回退本地 */
    async init() {
      if (this.loaded) return;
      this.loaded = true;
      const res = await fetchAppsFromServer();
      if (res.ok && res.data) {
        this.apps = res.data.map((a) => ({ ...a, schema: a.schema }));
        this.backendOnline = true;
        this.lastSyncError = "";
        this.persistLocal();
      } else {
        this.apps = loadLocal();
        this.backendOnline = false;
        this.lastSyncError = res.error || "后端接口不可用";
      }
    },

    persistLocal() {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify(this.apps));
      } catch {
        // 存储超限等静默失败
      }
    },

    /** 发布（按 kind+id 幂等覆盖，重新设计发布即更新）；返回是否已同步到后端 */
    async publish(
      kind: PublishKind,
      schema: any,
      opts?: { name?: string; menu?: boolean }
    ): Promise<{ app: PublishedApp; synced: boolean; error?: string }> {
      // 发布前统一清洗：样式白名单 + 图片地址协议校验（运行页会直接渲染这份数据）
      const safeSchema = sanitizeSchemaTree(clone(schema));
      const id = (safeSchema && safeSchema.id) || `${kind}_${Date.now()}`;
      const exist = this.apps.find((a) => a.kind === kind && a.id === id);
      const now = Date.now();
      const app: PublishedApp = {
        id,
        kind,
        name: opts?.name || schema?.name || schema?.text || "未命名应用",
        schema: safeSchema,
        publishedAt: exist?.publishedAt || now,
        updatedAt: now,
        enable: true,
        menu: opts?.menu ?? exist?.menu ?? false,
      };
      if (exist) Object.assign(exist, app);
      else this.apps.push(app);
      this.persistLocal();
      useAuditStore().log("应用", exist ? "重新发布" : "发布", `发布「${app.name}」（${kind}）${app.menu ? "，挂载到菜单" : ""}`);
      const res = await postAppToServer(app);
      this.backendOnline = res.ok;
      this.lastSyncError = res.ok ? "" : res.error || "同步失败";
      return { app, synced: res.ok, error: res.ok ? undefined : this.lastSyncError };
    },

    /** 切换启用 / 挂载菜单 */
    async toggle(kind: PublishKind, id: string, key: "enable" | "menu") {
      const app = this.apps.find((a) => a.kind === kind && a.id === id);
      if (!app) return;
      app[key] = !app[key];
      this.persistLocal();
      useAuditStore().log("应用", key === "enable" ? (app.enable ? "启用" : "停用") : app.menu ? "挂载菜单" : "取消挂载", `「${app.name}」`);
      const res = await putAppToServer(kind, id, { [key]: app[key] });
      this.backendOnline = res.ok;
      if (!res.ok) this.lastSyncError = res.error || "同步失败";
    },

    /** 卸载 */
    async unpublish(kind: PublishKind, id: string) {
      const target = this.apps.find((a) => a.kind === kind && a.id === id);
      const before = this.apps.length;
      this.apps = this.apps.filter((a) => !(a.kind === kind && a.id === id));
      this.persistLocal();
      if (target) useAuditStore().log("应用", "卸载", `卸载「${target.name}」`);
      if (this.apps.length < before) {
        const res = await deleteAppFromServer(kind, id);
        this.backendOnline = res.ok;
        if (!res.ok) this.lastSyncError = res.error || "同步失败";
      }
    },
  },
});
