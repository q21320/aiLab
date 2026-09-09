declare module "dagre" {
  export interface GraphNode {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  export interface GraphInstance {
    setGraph(g: Record<string, any>): void;
    setDefaultEdgeLabel(fn: () => Record<string, any>): void;
    setNode(id: string, attrs?: Record<string, any>): void;
    setEdge(source: string, target: string, attrs?: Record<string, any>): void;
    node(id: string): GraphNode;
  }
  export const graphlib: {
    Graph: new () => GraphInstance;
  };
  export function layout(g: GraphInstance): void;
}
