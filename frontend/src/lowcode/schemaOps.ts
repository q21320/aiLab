// ============================================================================
// 低代码平台 · Schema 树操作工具（查找/插入/删除/移动/复制）
// ============================================================================

import type { PageSchema, SchemaNode } from "./types";

let seq = 0;
export function uid(prefix: string): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq}`;
}

/** 深拷贝（页面 Schema 为纯 JSON 数据，可安全克隆） */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

/** 按 id 查找节点 */
export function findNode(root: PageSchema, id: string): SchemaNode | null {
  if (root.id === id) return root;
  for (const child of root.children || []) {
    const found = findNode(child as PageSchema, id);
    if (found) return found;
  }
  return null;
}

/** 查找父节点与子索引 */
export function findParent(
  root: PageSchema,
  id: string
): { parent: SchemaNode; index: number } | null {
  const children = root.children || [];
  for (let i = 0; i < children.length; i++) {
    if (children[i].id === id) return { parent: root, index: i };
    const inner = findParent(children[i] as PageSchema, id);
    if (inner) return inner;
  }
  return null;
}

/** 获取容器的子节点列表 */
export function childrenOf(node: SchemaNode): SchemaNode[] {
  if (!node.children) node.children = [];
  return node.children;
}

/** 在指定容器的 index 处插入（index 为 -1 表示插入末尾） */
export function insertAt(parent: SchemaNode, node: SchemaNode, index: number = -1): void {
  const kids = childrenOf(parent);
  const i = index < 0 ? kids.length : Math.min(index, kids.length);
  kids.splice(i, 0, node);
}

/** 删除节点（根节点不可删除） */
export function removeNode(root: PageSchema, id: string): boolean {
  const found = findParent(root, id);
  if (!found) return false;
  found.parent.children!.splice(found.index, 1);
  return true;
}

/** 复制节点（生成新 id 与子树新 id） */
export function duplicateNode(root: PageSchema, id: string): SchemaNode | null {
  const src = findNode(root, id);
  if (!src) return null;
  const copy = clone(src);
  reAssignIds(copy);
  return copy;
}

/** 递归重分配 id */
export function reAssignIds(node: SchemaNode): void {
  node.id = uid(node.type);
  for (const child of node.children || []) reAssignIds(child);
}

/** 在容器间/容器内移动节点 */
export function moveNode(root: PageSchema, id: string, targetParentId: string, targetIndex: number = -1): boolean {
  const source = findParent(root, id);
  if (!source) return false;
  const node = source.parent.children![source.index];
  // 目标容器是节点自身或其后代时禁止移动（避免成环）
  if (id === targetParentId) return false;
  if (findNode(node as PageSchema, targetParentId)) return false;
  source.parent.children!.splice(source.index, 1);
  const target = findNode(root, targetParentId);
  if (!target) return false;
  // 若移动后索引超出，插到末尾
  const kids = childrenOf(target);
  const i = targetIndex >= 0 ? Math.min(targetIndex, kids.length) : kids.length;
  kids.splice(i, 0, node);
  return true;
}

/** 深度优先遍历（用于大纲树） */
export function walk(root: SchemaNode, fn: (node: SchemaNode, depth: number) => void, depth = 0): void {
  fn(root, depth);
  for (const child of root.children || []) walk(child, fn, depth + 1);
}

/** 统计节点数量 */
export function countNodes(root: SchemaNode): number {
  let n = 0;
  walk(root, () => n++);
  return n;
}

/** 生成页面根节点 */
export function createEmptyPage(): PageSchema {
  return {
    id: uid("page"),
    type: "page",
    text: "新页面",
    props: { title: "未命名页面" },
    style: { padding: "16px", background: "#f5f7fa", minHeight: "100%" },
    children: [],
  };
}
