// ============================================================================
// 低代码平台 · 画布注入上下文（拖拽状态 / 设计器动作）
// ============================================================================

import type { InjectionKey } from "vue";
import type { SchemaNode } from "./types";

/** 设计器拖拽状态（由 PageDesigner 提供，SchemaRenderer 消费） */
export interface LcDragState {
  active: boolean;
  parentId: string;
  index: number;
}

/** 设计器动作回调（由 PageDesigner 提供） */
export interface LcActions {
  select: (node: SchemaNode) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  drop: (parentId: string, index: number, payload: string) => void;
}

export const LC_DRAG_KEY: InjectionKey<LcDragState> = Symbol("lc-drag");
export const LC_ACTIONS_KEY: InjectionKey<LcActions> = Symbol("lc-actions");
