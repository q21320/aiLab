// ============================================================================
// 低代码平台 · 流程设计 Schema 类型定义（BPMN 风格）
// ============================================================================

/** 流程节点类型 */
export type FlowNodeType =
  | "start"
  | "end"
  | "approval"
  | "cc"
  | "condition"
  | "wait"
  | "timer";

/** 流程节点 */
export interface FlowNode {
  id: string;
  type: FlowNodeType;
  /** 画布坐标 */
  x: number;
  y: number;
  /** 节点名称 */
  name: string;
  /** 节点配置 */
  config: Record<string, any>;
}

/** 流程连线 */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** 连线标签（如 是/否/提交/驳回） */
  label?: string;
}

/** 流程设计 Schema */
export interface FlowSchema {
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/** 节点类型中文名 */
export const FLOW_NODE_LABELS: Record<FlowNodeType, string> = {
  start: "开始",
  end: "结束",
  approval: "审批",
  cc: "抄送",
  condition: "条件",
  wait: "等待",
  timer: "定时",
};

/** 节点默认尺寸 */
export const FLOW_NODE_SIZE: Record<FlowNodeType, { width: number; height: number }> = {
  start: { width: 96, height: 48 },
  end: { width: 96, height: 48 },
  approval: { width: 128, height: 64 },
  cc: { width: 128, height: 64 },
  condition: { width: 128, height: 64 },
  wait: { width: 128, height: 64 },
  timer: { width: 128, height: 64 },
};

/** 节点默认配置 */
export const FLOW_NODE_DEFAULT_CONFIG: Record<FlowNodeType, Record<string, any>> = {
  start: { form: "发起表单" },
  end: {},
  approval: { approver: "部门经理", multiple: "or" },
  cc: { targets: "发起人" },
  condition: { expression: "金额 > 10000", trueLabel: "是", falseLabel: "否" },
  wait: { desc: "等待 1 天" },
  timer: { cron: "0 9 * * *" },
};
