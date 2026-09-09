// ============================================================================
// 低代码平台 · 流程自动布局（dagre）
// ============================================================================

import * as dagre from "dagre";
import type { FlowSchema } from "./flowTypes";
import { FLOW_NODE_SIZE } from "./flowTypes";

/** 基于 dagre 重新计算所有节点坐标（左→右布局） */
export function autoLayout(flow: FlowSchema): void {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 36, ranksep: 80, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of flow.nodes) {
    const size = FLOW_NODE_SIZE[n.type];
    g.setNode(n.id, { width: size.width, height: size.height });
  }
  for (const e of flow.edges) {
    if (flow.nodes.some((n) => n.id === e.source) && flow.nodes.some((n) => n.id === e.target)) {
      g.setEdge(e.source, e.target);
    }
  }

  dagre.layout(g);

  for (const n of flow.nodes) {
    const pos = g.node(n.id);
    const size = FLOW_NODE_SIZE[n.type];
    if (pos) {
      n.x = Math.max(0, Math.round(pos.x - size.width / 2));
      n.y = Math.max(0, Math.round(pos.y - size.height / 2));
    }
  }
}
