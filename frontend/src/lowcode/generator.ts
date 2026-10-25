// AI 页面生成 / 连续追问引擎
// 前端只调用同源代理接口 `/api/ai/generate`，密钥由后端持有，绝不进入前端代码。
//
// 本轮改造（方案 C）：
//   1) 接地(grounding)：把平台里真实存在的 CRUD 资源与字段喂给模型，
//      让它生成/追问时优先用 crudTable 绑定真实数据，而不是写死假数据的静态 table。
//   2) 连续追问(refine)：把当前页面的完整 JSON + 一句新指令交给模型，默认要求模型回传
//      修改后的完整页面 JSON（位置/字段一次到位，避免增量 ops 加错位置或“假成功”）；仍兼容 ops 兜底。

import type { NodeType, PageSchema, SchemaNode } from "./types";
import type { FormField, FormSchema } from "./formTypes";
import { fetchCrudResources, type CrudField } from "../api/crud";
import { uid } from "./schemaOps";
import { getPageComponent } from "./registry";

// ============ API 配置 ============
const AI_ENDPOINT = "/api/ai/generate";

// 组件类型速查（生成与追问共用，尽量精简以适配本地小模型的上下文预算）
const COMPONENT_DOC = `## 组件类型（节点的 type 取值）
- page：根节点，必有；children 子节点数组；style { padding, background, minHeight }
- container：div 容器；children；style { display, flexDirection, justifyContent, alignItems, gap, padding, margin, textAlign, background, borderRadius, width, height, minHeight }
- row / col：栅格；row.props.gutter 数字；col.props.span 1~24（同行合计 24）
- card：卡片；props.shadow "always"|"hover"|"never"；children
- title：标题；text 文字；props.level 1~6；style { textAlign, color, fontSize, margin }
- text：段落；text 文字；style { color, fontSize, fontWeight, textAlign, margin }
- button：按钮；text 文字；props.type primary|success|warning|danger|default；props.size large|default|small
- image：图片；props.src URL；props.fit cover|contain|fill
- divider：分割线
- tag：标签；text 文字；props.type primary|success|warning|danger|info
- space：水平间距容器；children
- form / formItem：表单；formItem.props.label 标签；formItem.children 常放一个输入控件
- input：props.placeholder, props.type text|password|textarea, props.clearable, props.showPassword
- number：props.min/max/step；date：props.placeholder；switch；radio/checkbox/select：props.options:["项1","项2"]
- table：静态表格（写死数据，仅用于展示固定内容）；props.columns:[{prop,label,width}], props.data:[{列prop:值}]
- crudTable：数据表格（★自动对接平台真实后端资源，含 搜索/分页/新建/编辑/删除★）
  props: {
    resource: "<真实资源名>",           // 必须来自下方“可用真实数据资源”
    pageSize: 20,
    searchable: true, searchPlaceholder: "搜索",
    allowCreate: true, allowEdit: true, allowDelete: true,
    columns: [{ prop:"<字段prop>", label:"<中文列名>", width:160 }, ...],
    formFields:[ { prop:"<字段prop>", label:"<中文列名>", type:"text|number|switch|date|select", required:true }, ... ]
  }`;

// 真实资源接地块（运行时按平台数据动态生成）
export interface ResourceInfo {
  name: string;
  count: number;
  fields: CrudField[];
}

function buildGroundingBlock(resources: ResourceInfo[], maxRes = 12, maxFields = 20): string {
  if (!resources.length) {
    return `## 可用真实数据资源\n（当前平台没有已注册的 CRUD 资源。若需要表格，用静态 table。）`;
  }
  const shown = resources.slice(0, maxRes);
  const lines = shown.map((r) => {
    const all = r.fields || [];
    const fields = all
      .slice(0, maxFields)
      .map((f) => `${f.prop}(${f.label || f.prop}${f.type && f.type !== "text" ? "," + f.type : ""})`)
      .join(", ");
    const more = all.length > maxFields ? ` …等 ${all.length} 字段` : "";
    return `- 资源 "${r.name}"（${r.count} 条数据）可用字段: ${fields || "（暂无数据，字段未知）"}${more}`;
  });
  const moreRes = resources.length > shown.length ? `\n（另有 ${resources.length - shown.length} 个资源未列出）` : "";
  return `## 可用真实数据资源（用于 crudTable，务必使用真实资源名与真实字段 prop）
${lines.join("\n")}${moreRes}

★ 重要规则：只要用户提到“管理 / 列表 / 增删改查 / 数据表格 / 订单/商品/设备…”，
就优先用 crudTable 绑定上面的真实资源（columns 用该资源的真实字段 prop，label 用中文），
不要用写死假数据的静态 table。formFields 也按真实字段生成。`;
}

// ---------------------------------------------------------------------------
// 上下文预算：本地小模型 num_ctx 有限（约 8192 token）。整段提示词按字符近似控制，
// 超出预算时逐级压缩「接地资源」与「页面大纲」，保证指令与组件文档不被截断。
// ---------------------------------------------------------------------------
const MAX_PROMPT_CHARS = 6000;

/** 递归补全 / 去重节点 id（模型可能漏给 id，或复用同一 id 导致后续定位混乱） */
function ensureNodeIds(root: SchemaNode): void {
  const seen = new Set<string>();
  const walk = (n: SchemaNode) => {
    if (!n.id || seen.has(n.id)) n.id = uid(n.type || "node");
    seen.add(n.id);
    (n.children || []).forEach(walk);
  };
  walk(root);
}

/** 模型常吐出的“近似但未注册”的组件名 → 已注册 type 的映射表 */
const TYPE_ALIASES: Record<string, NodeType> = {
  heading: "title", h1: "title", h2: "title", h3: "title",
  paragraph: "text", label: "text", desc: "text", description: "text", textblock: "text",
  btn: "button", link: "button", submit: "button",
  textbox: "input", textarea: "input", password: "input",
  combobox: "select", dropdown: "select", picker: "select",
  datepicker: "date", calendar: "date",
  radiogroup: "radio", checkboxgroup: "checkbox", slider: "number",
  datatable: "crudTable", grid: "table", list: "table", tablelist: "table",
  statistic: "card", stat: "card", kpi: "card", chart: "card", metric: "card", panel: "card",
  badge: "tag", chip: "tag", icon: "tag", status: "tag",
  separator: "divider", hr: "divider", line: "divider",
  box: "container", section: "container", div: "container", wrapper: "container", stack: "space",
  header: "container", footer: "container", sidebar: "container", main: "container", article: "container",
  alert: "card", banner: "card", progress: "card", progressbar: "card", timeline: "card",
  h4: "title", h5: "title", h6: "title", blockquote: "text", span: "text", strong: "text", em: "text", li: "text", paragraph2: "text",
  avatar: "tag", ul: "table", ol: "table", table2: "table",
};

/** 把未注册的 type 归一到合法类型，避免画布出现「未知组件」占位 */
function normalizeNodeTypes(root: SchemaNode): number {
  let remapped = 0;
  const walk = (n: SchemaNode) => {
    if (n.type !== "page" && !getPageComponent(n.type)) {
      const alias = TYPE_ALIASES[(n.type || "").toLowerCase()];
      const hasKids = Array.isArray(n.children) && n.children.length > 0;
      if (alias) n.type = alias;
      else if (hasKids) n.type = "container";
      else n.type = "text";
      remapped += 1;
    }
    (n.children || []).forEach(walk);
  };
  walk(root);
  return remapped;
}

/** crudTable 绑了拼错/臆造/不存在的资源名时，先模糊匹配纠正；无匹配则退绑首个真实资源，杜绝运行期 404 */
function rebindCrudResources(root: SchemaNode, resources: ResourceInfo[]): void {
  if (!resources.length) return;
  const lower = (s: unknown) => String(s || "").toLowerCase();
  const walk = (n: SchemaNode) => {
    if (n.type === "crudTable") {
      if (!n.props) n.props = {};
      const cur = lower(n.props.resource);
      const exact = resources.some((r) => lower(r.name) === cur);
      if (!exact) {
        const hit = cur
          ? resources.find((r) => lower(r.name).includes(cur) || cur.includes(lower(r.name)))
          : undefined;
        const target = hit || resources[0];
        if (target && lower(target.name) !== cur) {
          n.props.resource = target.name;
          // 列/formFields 是按臆造资源生成的，清空让 repairCrudTables 用真实字段重建，保证列头与数据自洽
          if (cur) {
            delete n.props.columns;
            delete n.props.formFields;
          }
        }
      }
    }
    (n.children || []).forEach(walk);
  };
  walk(root);
}

/** 生成/追问产物的统一收尾：归一 type → 补 id → 纠正资源绑定 → 补全表格列 */
function finalizePage(root: SchemaNode, resources: ResourceInfo[]): void {
  normalizeNodeTypes(root);
  ensureNodeIds(root);
  rebindCrudResources(root, resources);
  repairCrudTables(root, resources);
}

/** 安全解析：模型输出是否为合法整页 JSON */
function tryParsePage(text: string): PageSchema | null {
  try {
    const p = JSON.parse(extractJSON(text));
    if (p && p.type === "page") return p as PageSchema;
  } catch {
    /* ignore */
  }
  return null;
}

/** 结构指纹：忽略 id（会被 uid 重排），仅比对 type/text/props/style/children 深层内容，用于判断“是否真的改动了” */
function structuralSignature(root: SchemaNode): string {
  const strip = (n: SchemaNode): unknown => ({
    t: n.type,
    x: n.text ?? null,
    p: n.props ?? null,
    s: n.style ?? null,
    c: (n.children || []).map(strip),
  });
  return JSON.stringify(strip(root));
}

/** 表单结构指纹：忽略每个字段 id，比对表单元信息与字段内容 */
function formSignature(form: FormSchema): string {
  return JSON.stringify({
    n: form.name ?? null,
    st: form.showTitle ?? null,
    lw: form.labelWidth ?? null,
    fs: form.fieldSpan ?? null,
    sb: form.submitText ?? null,
    sa: form.submitApi ?? null,
    f: (form.fields || []).map((field) => {
      const clone: Record<string, unknown> = { ...(field as unknown as Record<string, unknown>) };
      delete clone.id;
      return clone;
    }),
  });
}

/**
 * 在字符预算内组装「接地块 + 大纲」：优先保留大纲（追问靠它定位节点 id），
 * 空间不足时先把接地资源逐档收窄，再压缩大纲规模。
 */
function fitGroundingAndOutline(
  resources: ResourceInfo[],
  makeOutline: (maxNodes: number) => string,
  reserveChars: number,
): { grounding: string; outline: string } {
  const budget = Math.max(600, MAX_PROMPT_CHARS - reserveChars);
  const resSteps: Array<[number, number]> = [
    [12, 20],
    [6, 12],
    [3, 10],
    [1, 8],
  ];
  const nodeSteps = [160, 80, 40, 24];
  for (const cap of nodeSteps) {
    const outline = makeOutline(cap);
    for (const [mr, mf] of resSteps) {
      const grounding = buildGroundingBlock(resources, mr, mf);
      if (grounding.length + outline.length <= budget) return { grounding, outline };
    }
  }
  return {
    grounding: buildGroundingBlock(resources, 1, 6),
    outline: makeOutline(nodeSteps[nodeSteps.length - 1]),
  };
}

const STRICT_RULES = `## 严格规则
1. 只输出一个 JSON 对象，不要任何其他文字、不要 markdown 代码块
2. 根节点 type 必须是 "page"
3. 每个节点必须有唯一 "id"（如 "page_1","title_1","tbl_1"）
4. style 的值必须是字符串（如 "20px"、"#fff"），不能是数字
5. 内容要丰富完整、有真实中文文案；数据表格要绑真实资源（见下）
6. 布局美观：善用 container/row/col/card 排版
7. 只能使用上面「组件类型」列出的 type；需要统计卡片/图表/列表等没有的组件时，用 card + title + text 或 table 近似表达，绝不要自造 type（如 chart/statistic/list/dropdown/avatar/progress）`;

/** 供 UI 快捷使用的示例提示词 */
export const EXAMPLE_PROMPTS = [
  "一个用户登录页面，包含用户名和密码",
  "生成商品管理页面，用真实 products 数据，带搜索和新增",
  "一个数据仪表盘，顶部统计卡片，下方最近动态表格",
  "做一张信息登记表单，含姓名、邮箱、城市和备注",
  "商品展示页，三列卡片，每张有图片、价格和购买按钮",
];

/** 拉取平台真实资源用于接地 */
export async function loadGrounding(): Promise<ResourceInfo[]> {
  try {
    const res = await fetchCrudResources();
    return res.data?.resources ?? [];
  } catch {
    return [];
  }
}

/** 调用后端 AI 代理，返回原始文本 */
async function callAI(prompt: string, system: string): Promise<string> {
  const response = await fetch(AI_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, system }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({} as Record<string, string>));
    const hint =
      response.status === 503
        ? "AI 服务未配置（检查 AI_BASE_URL / AI_MODEL / AI_API_KEY）"
        : body.error || response.statusText;
    throw new Error(`AI 请求失败：${response.status} ${hint}`);
  }
  const data = await response.json();
  if (!data?.content) throw new Error(data?.error || "AI 未返回内容");
  return String(data.content);
}

/** 剥离思考/推理段：兼容 Qwen3 的 （无斜杠）与旧式 <think>，并兵清孤立开标签 */
function stripThinking(text: string): string {
  return text
    .replace(/[\s\S]*?<\/(?:think|redacted_thinking)>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/<\/(?:think|redacted_thinking)[^>]*>/g, "")
    .replace(/<think>/g, "");
}

/** 从 AI 返回文本中提取 JSON */
function extractJSON(text: string): string {
  text = stripThinking(text).trim();
  const md = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
  if (md) return md[1];
  const brace = text.match(/(\{[\s\S]*\})/);
  if (brace) return brace[1];
  return text;
}

// ---------- 输入优化（提示词改写） ----------
// 把用户一句口语描述改写得"更结构化、更适合交给生成器"。单独一次轻量调用，
// 只回一段中文需求、不吐 JSON、不碰 schema；供输入框旁的"✨优化描述"按钮使用。
const OPTIMIZE_DOC = `你是需求梳理助手。用户会用一句口语描述想要的前端页面/功能。
请把它改写得更明确、更适合交给"低代码页面生成器"，要求：
1. 只输出一段中文需求描述，不要 JSON、不要代码、不要解释、不要分点标题
2. 补全可合理推断的意图：页面用途、需要哪些区域、是否要数据表格/表单、大致布局
3. 若明显涉及"管理/列表/增删改查"，明确写出"用数据表格绑定真实数据资源"，但不要编造用户没提的资源名
4. 保持简洁，控制在 120 字以内，不要堆砌用户没暗示的花哨内容`;

function cleanOptimize(out: string): string {
  return stripThinking(out)
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function optimizeInput(text: string, resources?: ResourceInfo[]): Promise<string> {
  const raw = (text || "").trim();
  if (!raw) return raw;
  let hint = "";
  if (resources && resources.length) {
    const names = resources.slice(0, 8).map((r) => r.name).join("、");
    hint = `\n\n平台现有数据资源（可在描述中指向它们）：${names}`;
  }
  // 本地模型偶发返回空 → 重试一次；两次皆空则抛错，交由 UI 提示，不再静默退回原文（否则像“点了没反应”）。
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const cleaned = cleanOptimize(await callAI(raw, OPTIMIZE_DOC + hint));
    if (cleaned) return cleaned;
  }
  throw new Error("优化服务暂无响应，可直接发送");
}

// ---------- 生成（首轮） ----------
export interface GenerateResult {
  schema: PageSchema;
  matched: string;
}

export async function generateSchema(prompt: string, resources?: ResourceInfo[]): Promise<GenerateResult> {
  const grounded = resources ?? (await loadGrounding());
  const reserve = STRICT_RULES.length + COMPONENT_DOC.length + prompt.length + 200;
  const { grounding } = fitGroundingAndOutline(grounded, () => "", reserve);
  const system = `你是一个 AI 低代码页面生成器。根据用户描述，输出一个 JSON 对象描述页面结构。\n\n${STRICT_RULES}\n\n${COMPONENT_DOC}\n\n${grounding}\n\n记住：只输出 JSON。`;
  // 首轮也带一次自愈重试：本地小模型偶发吐非法 JSON / 非 page 根
  let schema = tryParsePage(await callAI(prompt, system));
  if (!schema) {
    schema = tryParsePage(
      await callAI(
        prompt,
        system + "\n\n（上次输出不是合法 JSON。请只输出一个以 {\"type\":\"page\",...} 开头的完整 JSON 对象，不要任何多余文字或 markdown 代码块。）",
      ),
    );
  }
  if (!schema) throw new Error("模型未能返回合法的页面结构，请简化需求或换个说法后重试");
  finalizePage(schema, grounded);
  return { schema, matched: "AI 生成" };
}

// ---------- 追问（整页回传） ----------
export interface RefineResult {
  schema: PageSchema;
  kind: "ops" | "full";
  applied: number;
  note?: string;
}

export type PageOp =
  | { op: "replaceText"; id: string; text: string }
  | { op: "replaceProps"; id: string; props: Record<string, any> }
  | { op: "replaceStyle"; id: string; style: Record<string, string> }
  | { op: "removeNode"; id: string }
  | { op: "addNode"; parentId: string; index?: number; node: SchemaNode }
  | { op: "moveNode"; id: string; parentId?: string; index?: number };

function findNode(root: SchemaNode, id: string): SchemaNode | null {
  if (root.id === id) return root;
  for (const c of root.children || []) {
    const r = findNode(c, id);
    if (r) return r;
  }
  return null;
}

function findParentList(root: SchemaNode, id: string): SchemaNode[] | null {
  const kids = root.children || [];
  if (kids.some((k) => k.id === id)) return kids;
  for (const c of kids) {
    const r = findParentList(c, id);
    if (r) return r;
  }
  return null;
}

/** 应用增量操作；返回应用的条数与未命中的 id */
function applyOps(schema: PageSchema, ops: PageOp[]): { applied: number; missing: string[] } {
  const missing: string[] = [];
  let applied = 0;
  for (const o of ops) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "addNode") {
      const parent = findNode(schema, o.parentId);
      if (!parent) {
        missing.push(o.parentId);
        continue;
      }
      parent.children = parent.children || [];
      const node = o.node;
      if (!node || !node.type) {
        missing.push("bad-node");
        continue;
      }
      ensureNodeIds(node);
      const idx = typeof o.index === "number" ? Math.max(0, Math.min(o.index, parent.children.length)) : parent.children.length;
      parent.children.splice(idx, 0, node);
      applied++;
      continue;
    }
    if (o.op === "moveNode") {
      // 确定性移动：从原父节点摘出，插入目标父节点指定下标（绝不复制节点）
      if (!o.id || o.id === schema.id) {
        missing.push(o.id || "bad-move");
        continue;
      }
      const srcList = findParentList(schema, o.id);
      if (!srcList) {
        missing.push(o.id);
        continue;
      }
      const parent = o.parentId ? findNode(schema, o.parentId) : schema;
      if (!parent) {
        missing.push(o.parentId || "bad-parent");
        continue;
      }
      const from = srcList.findIndex((n) => n.id === o.id);
      const node = srcList[from];
      // 禁止把节点移入自身或自己的子孙（会丢子树）
      if (parent.id === node.id || findNode(node, parent.id)) {
        missing.push("move-into-descendant:" + o.id);
        continue;
      }
      srcList.splice(from, 1);
      parent.children = parent.children || [];
      const idx = typeof o.index === "number" ? Math.max(0, Math.min(o.index, parent.children.length)) : parent.children.length;
      parent.children.splice(idx, 0, node);
      applied++;
      continue;
    }
    const target = findNode(schema, (o as any).id);
    if (!target) {
      missing.push((o as any).id);
      continue;
    }
    if (o.op === "replaceText") {
      target.text = o.text;
      applied++;
    } else if (o.op === "replaceProps") {
      target.props = { ...(target.props || {}), ...o.props };
      applied++;
    } else if (o.op === "replaceStyle") {
      target.style = { ...(target.style || {}), ...o.style };
      applied++;
    } else if (o.op === "removeNode") {
      const list = findParentList(schema, o.id);
      if (list) {
        const i = list.findIndex((n) => n.id === o.id);
        if (i >= 0) list.splice(i, 1);
        applied++;
      }
    }
  }
  return { applied, missing };
}

/** crudTable 若缺列/字段，按真实资源字段自动补全 */
function repairCrudTables(root: SchemaNode, resources: ResourceInfo[]) {
  const walk = (n: SchemaNode) => {
    if (n.type === "crudTable") {
      if (!n.props) n.props = {};
      const info = resources.find((r) => r.name === n.props?.resource);
      if (info && info.fields?.length) {
        if (!Array.isArray(n.props.columns) || !n.props.columns.length) {
          n.props.columns = info.fields.slice(0, 6).map((f) => ({ prop: f.prop, label: f.label || f.prop }));
        }
        if (!Array.isArray(n.props.formFields)) {
          n.props.formFields = info.fields
            .filter((f) => f.prop !== "id")
            .map((f) => ({ prop: f.prop, label: f.label || f.prop, type: f.type || "text" }));
        }
      }
    }
    (n.children || []).forEach(walk);
  };
  walk(root);
}

const REFINE_DOC = `你是页面结构“编辑助手”。用户会给出现有页面的【完整 JSON】（每个节点带唯一 id）和一句修改指令。
请在现有页面基础上，输出修改后的【完整页面 JSON】，规则：
1. 未被指令涉及的节点必须原样保留（连 props/style/children/text 一个字段都别丢）
2. 按指令做增/删/改；新增节点要放在指令描述的位置——例如“在搜索框旁边/下方加 X”，就把 X 放进搜索框所在的那个容器（父节点）里、紧挨着搜索框，而不是丢到页面最外层末尾
3. 【移动/换位置/放到最前·最后·某元素前后】是把那个已有节点改到新位置，绝对不要再新建一个同名节点；整页回传时只调整它在父节点 children 里的顺序，不要复制
4. 根节点必须 type="page"；每个节点 id 唯一；style 的值必须是字符串（如 "20px"）
5. 只输出这一个完整 JSON 对象，不要解释、不要 markdown、不要只给局部片段
若只需微调属性或【移动节点】，可返回非空的 {"ops":[...]}：replaceText/replaceProps/replaceStyle/removeNode/addNode，移动用 {"op":"moveNode","id":"要移动的节点id","parentId":"目标父节点id","index":目标下标}；禁止返回空 {"ops":[]}。
默认整页回传；但纯移动/改顺序优先用 moveNode，避免复制。`;

/** 整页回传的适用上限：超过此长度（约 20~30 个组件）就降级为“大纲+ops”，
 *  既避免撞后端 413，也避免本地小模型 8192 token 上下文被整页 JSON 占满 */
const FULL_PAGE_JSON_LIMIT = 5000;

/** 把整页压成“节点大纲”（每行 id/type/文字，缩进表层级），供大页面追问定位节点并回 ops */
function buildPageOutline(root: SchemaNode, maxNodes = 200): string {
  const lines: string[] = [];
  let count = 0;
  const walk = (n: SchemaNode, depth: number) => {
    if (count >= maxNodes) return;
    count++;
    const hint = String(n.text || n.props?.label || n.props?.resource || n.props?.placeholder || n.props?.title || "").replace(/\s+/g, "");
    lines.push(`${"  ".repeat(depth)}- id=${n.id} type=${n.type}${hint ? ` 「${hint.slice(0, 16)}」` : ""}`);
    (n.children || []).forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  if (count >= maxNodes) lines.push("…（节点过多已截断，未列出项请用精确 id）");
  return lines.join("\n");
}

const REFINE_OPS_DOC = `你是页面结构“编辑助手”。页面较大，这里只给出【节点大纲】(每行: id=节点ID type=类型 「文字/资源」，缩进表示层级)。
请根据修改指令，只返回一个 JSON：{"ops":[...]}（不要回传整页）。可用操作：
- {"op":"replaceText","id":"...","text":"新文字"}
- {"op":"replaceProps","id":"...","props":{...}}   // 改属性：列 columns、选项 options、placeholder、pageSize 等
- {"op":"replaceStyle","id":"...","style":{...}}   // 改样式，值必须是字符串(如 "14px"、"#f5f7fa")
- {"op":"removeNode","id":"..."}
- {"op":"addNode","parentId":"...","index":0,"node":{"type":"...","text":"..."}}  // 新增放进指定父容器
- {"op":"moveNode","id":"...","parentId":"...","index":0}   // 移动/换位置，绝不新建同名节点
必须使用大纲里出现过的真实 id；新增节点不用写 id。禁止返回空 {"ops":[]}。`;

/** 大页面追问：用“节点大纲 + ops”增量修改，prompt 体积可控，任意规模页面都能改 */
async function refineByOps(current: PageSchema, instruction: string, grounded: ResourceInfo[], outline: string): Promise<RefineResult> {
  const reserve = REFINE_OPS_DOC.length + COMPONENT_DOC.length + instruction.length + outline.length + 260;
  const { grounding } = fitGroundingAndOutline(grounded, () => "", reserve);
  const base = `${REFINE_OPS_DOC}\n\n${COMPONENT_DOC}\n\n${grounding}\n\n## 节点大纲\n${outline}\n\n## 修改指令\n`;

  const runOps = (payload: any): RefineResult | null => {
    if (payload && Array.isArray(payload.ops)) {
      const { applied, missing } = applyOps(current, payload.ops);
      if (applied > 0) {
        finalizePage(current, grounded);
        return { schema: current, kind: "ops", applied, note: missing.length ? `已应用 ${applied} 处（忽略 ${missing.length} 处无效目标）` : `已应用 ${applied} 处修改` };
      }
    }
    return null;
  };

  const text1 = await callAI(base + instruction, '只输出 {"ops":[...]} JSON。');
  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text1));
  } catch {
    parsed = undefined;
  }
  const first = runOps(parsed);
  if (first) return first;

  // 重试一次：把问题反馈给模型（applied===0 时 current 未被改动，可安全重跑）
  const text2 = await callAI(
    base + instruction + "\n\n（上次没有产生有效改动。请严格使用上面【节点大纲】里出现过的真实 id，返回一个非空的 {\"ops\":[...]}。）",
    '只输出 {"ops":[...]} JSON。',
  );
  try {
    parsed = JSON.parse(extractJSON(text2));
  } catch {
    throw new Error("模型未能生成可应用的修改，请换个说法再试");
  }
  const second = runOps(parsed);
  if (second) return second;
  throw new Error("没检测到有效改动。请指到具体元素，例如：把表格每页条数改为 10、标题居中、隐藏搜索框");
}

export async function refineSchema(current: PageSchema, instruction: string, resources?: ResourceInfo[]): Promise<RefineResult> {
  const grounded = resources ?? (await loadGrounding());
  const currentJson = JSON.stringify(current);
  // 大页面降级：整页 JSON 回传会撑爆小模型上下文、也可能被后端判超长(413)；超阈改用“大纲+ops”增量。
  if (currentJson.length > FULL_PAGE_JSON_LIMIT) {
    return refineByOps(current, instruction, grounded, buildPageOutline(current));
  }
  const reserve = REFINE_DOC.length + COMPONENT_DOC.length + instruction.length + currentJson.length + 260;
  const { grounding } = fitGroundingAndOutline(grounded, () => "", reserve);
  const base = `${REFINE_DOC}\n\n${COMPONENT_DOC}\n\n${grounding}\n\n## 现有页面完整 JSON（请在此基础上修改并回传完整页面）\n${currentJson}\n\n## 修改指令\n`;

  // 第一次尝试
  let text = await callAI(base + instruction, "只输出 JSON。");
  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(text));
  } catch {
    parsed = undefined;
  }

  // 自愈：解析失败或 ops 有未命中 id → 带错误重试一次
  const attempt = async (payload: any): Promise<RefineResult | null> => {
    // 整页回传优先（位置/字段一次到位）；模型若仍给 ops 则作为兜底按增量应用。
    if (payload && payload.type === "page") {
      finalizePage(payload, grounded);
      // 模型原样回传（结构无变化）不算成功，转重试或诚实报错，避免“已按整页更新”却毫无改动
      if (structuralSignature(current) === structuralSignature(payload)) return null;
      return { schema: payload as PageSchema, kind: "full", applied: 1, note: "已按整页更新" };
    }
    if (payload && Array.isArray(payload.ops)) {
      const { applied, missing } = applyOps(current, payload.ops);
      // 空 ops / 未命中 id / 没产生任何实际改动 → 不算成功，交给重试
      if (missing.length || applied === 0) {
        return null;
      }
      finalizePage(current, grounded);
      return { schema: current, kind: "ops", applied, note: `已应用 ${applied} 处修改` };
    }
    return null;
  };

  const first = await attempt(parsed);
  if (first) return first;

  // 重试：把上次的问题反馈给模型
  const retryPrompt =
    base +
    instruction +
    `\n\n（上次输出无法应用：可能 JSON 不合法，或不是完整页面。请直接输出以 {"type":"page",...} 开头、包含全部节点的【完整页面 JSON】。现有合法节点 id：` +
    collectIds(current).join(", ") +
    `。只输出 JSON。）`;
  text = await callAI(retryPrompt, "只输出 JSON。");
  let parsed2: any;
  try {
    parsed2 = JSON.parse(extractJSON(text));
  } catch {
    throw new Error("模型未能生成可应用的修改，请换个说法再试");
  }
  const second = await attempt(parsed2);
  if (second) return second;
  // 重试后仍只拿到 ops：能应用就应用，一处都改不动则诚实报错（不再谎报“已应用 0 处”）
  if (parsed2 && Array.isArray(parsed2.ops)) {
    const { applied, missing } = applyOps(current, parsed2.ops);
    finalizePage(current, grounded);
    if (applied > 0) {
      return { schema: current, kind: "ops", applied, note: `已应用 ${applied} 处（忽略 ${missing.length} 处无效目标）` };
    }
  }
  throw new Error("没检测到有效改动。请把要求说具体些，例如：顶部那行加卡片背景、按钮右对齐、字段改为一行两列");
}

function collectIds(node: SchemaNode, acc: string[] = []): string[] {
  acc.push(node.id);
  (node.children || []).forEach((c) => collectIds(c, acc));
  return acc;
}

// ============================================================================
// 表单设计：接地生成 + 增量追问（与页面同构，作用于扁平 fields[]）
// ============================================================================

const FORM_TYPES = "input|textarea|number|select|radio|checkbox|date|switch|rating|slider|upload|text";

function formUid(prefix: string): string {
  return uid(prefix);
}

/** 资源接地块（表单版：用于建议 submitApi 绑定与字段对齐） */
function buildFormGroundingBlock(resources: ResourceInfo[]): string {
  if (!resources.length) return "";
  const lines = resources.map((r) => {
    const fields = (r.fields || []).map((f) => `${f.prop}(${f.label || f.prop})`).join(", ");
    return `- "${r.name}"（${r.count} 条）字段: ${fields || "未知"}`;
  });
  return `## 可用真实数据资源
若用户要“新增/登记/编辑”某个已存在资源，把 submitApi 设为 "/api/crud/<资源名>"，并让字段 name 尽量对齐该资源的字段 prop：
${lines.join("\n")}`;
}

function buildFormGenSystem(resources: ResourceInfo[]): string {
  return `你是 AI 低代码表单生成器。根据用户描述，输出一个表单 JSON。

## 严格规则
1. 只输出一个 JSON 对象，不要任何其他文字、不要 markdown
2. 表单结构: {"id":"form_1","name":"表单标题","showTitle":true,"labelWidth":100,"fieldSpan":24,"submitText":"提交","submitApi":"","fields":[ ...字段 ]}
3. 每个字段: {"id":"f_1","type":"input","label":"中文标签","name":"english_key","placeholder":"","required":true,"message":"必填提示","span":24,"options":[{"label":"是","value":true}],"defaultValue":null,"props":{}}
4. 字段 type 取值: ${FORM_TYPES}
5. select/radio/checkbox 必须给 options；name 用英文小写且唯一；label 用中文；span 1~24（整行为 24）
6. 字段要丰富、贴合需求，含合理必填校验

${buildFormGroundingBlock(resources)}

记住：只输出 JSON。`;
}

/** 补全表单/字段缺失的 id/name/type，并对重复 id 重新分配 */
function ensureFormShape(schema: FormSchema): void {
  const seenIds = new Set<string>();
  if (!schema.id || seenIds.has(schema.id)) schema.id = formUid("form");
  seenIds.add(schema.id);
  if (!Array.isArray(schema.fields)) schema.fields = [];
  const usedNames = new Set<string>();
  schema.fields.forEach((f, i) => {
    if (!f.id || seenIds.has(f.id)) f.id = formUid("f");
    seenIds.add(f.id);
    if (!f.type) f.type = "input";
    if (!f.name) {
      let idx = i + 1;
      let base = `field_${idx}`;
      while (usedNames.has(base)) base = `field_${(idx += 1)}`;
      f.name = base;
    }
    usedNames.add(f.name);
    if (f.span == null) f.span = 24;
  });
}

export interface FormGenerateResult {
  schema: FormSchema;
  matched: string;
}

/** 安全解析：模型输出是否为含 fields 的合法表单 JSON */
function tryParseForm(text: string): FormSchema | null {
  try {
    const p = JSON.parse(extractJSON(text));
    if (p && Array.isArray(p.fields)) return p as FormSchema;
  } catch {
    /* ignore */
  }
  return null;
}

export async function generateFormSchema(prompt: string, resources?: ResourceInfo[]): Promise<FormGenerateResult> {
  const grounded = resources ?? (await loadGrounding());
  const system = buildFormGenSystem(grounded);
  // 首轮带一次自愈重试，避免小模型吐非法 JSON 直接崩
  let schema = tryParseForm(await callAI(prompt, system));
  if (!schema) {
    schema = tryParseForm(
      await callAI(prompt, system + "\n\n（上次输出不是合法 JSON。请只输出一个含 fields 数组的表单 JSON 对象，不要任何多余文字。）"),
    );
  }
  if (!schema) throw new Error("模型未能返回合法的表单结构，请换个说法后重试");
  ensureFormShape(schema);
  return { schema, matched: "AI 生成" };
}

export type FormOp =
  | { op: "addField"; index?: number; field: FormField }
  | { op: "removeField"; id: string }
  | { op: "updateField"; id: string; patch: Partial<FormField> }
  | { op: "setMeta"; patch: Partial<FormSchema> };

export interface FormRefineResult {
  schema: FormSchema;
  kind: "ops" | "full";
  applied: number;
  note?: string;
}

function buildFormOutline(form: FormSchema): string {
  const meta = `表单: name="${form.name ?? ""}" submitApi="${form.submitApi ?? ""}" submitText="${form.submitText ?? "提交"}" 共 ${form.fields.length} 个字段`;
  const lines = form.fields.map(
    (f) => `- [${f.id}] ${f.type} name=${f.name} label="${f.label}"${f.required ? " 必填" : ""}`
  );
  return `${meta}\n${lines.join("\n")}`;
}

function applyFormOps(form: FormSchema, ops: FormOp[]): { applied: number; missing: string[] } {
  const missing: string[] = [];
  let applied = 0;
  for (const o of ops) {
    if (!o || typeof o !== "object") continue;
    if (o.op === "setMeta") {
      Object.assign(form, o.patch || {});
      applied++;
      continue;
    }
    if (o.op === "addField") {
      const field = o.field;
      if (!field || !field.type) {
        missing.push("bad-field");
        continue;
      }
      if (!field.id) field.id = formUid("f");
      if (field.span == null) field.span = 24;
      const idx = typeof o.index === "number" ? Math.max(0, Math.min(o.index, form.fields.length)) : form.fields.length;
      form.fields.splice(idx, 0, field);
      applied++;
      continue;
    }
    const i = form.fields.findIndex((f) => f.id === (o as any).id);
    if (i < 0) {
      missing.push((o as any).id);
      continue;
    }
    if (o.op === "removeField") {
      form.fields.splice(i, 1);
      applied++;
    } else if (o.op === "updateField") {
      form.fields[i] = { ...form.fields[i], ...(o.patch || {}) };
      applied++;
    }
  }
  return { applied, missing };
}

function buildFormRefineSystem(form: FormSchema, resources: ResourceInfo[]): string {
  return `你是表单“编辑助手”。用户给出现有表单字段（带 id）和一句修改指令，你只输出要做的修改，尽量小步。
默认返回 JSON: {"ops":[...]}，可用操作：
- {"op":"addField","index":可选数字位置,"field":{完整字段}}
- {"op":"removeField","id":"字段id"}
- {"op":"updateField","id":"字段id","patch":{要改的属性，如 label/type/required/message/placeholder/span/options/defaultValue/name}}
- {"op":"setMeta","patch":{"name":"新标题","submitText":"保存","submitApi":"/api/crud/products","labelWidth":100,"fieldSpan":12}}
字段 type 取值: ${FORM_TYPES}；select/radio/checkbox 需 options。
若指令是大改版（ops 难以表达），改为直接输出完整表单 JSON（含 fields 数组）。
只输出 JSON（ops 对象或完整表单），不要任何解释文字。

${buildFormGroundingBlock(resources)}

## 现有表单
${buildFormOutline(form)}`;
}

export async function refineFormSchema(current: FormSchema, instruction: string, resources?: ResourceInfo[]): Promise<FormRefineResult> {
  const grounded = resources ?? (await loadGrounding());
  const base = buildFormRefineSystem(current, grounded) + "\n\n## 修改指令\n";
  const validIds = current.fields.map((f) => f.id).join(", ");

  const attempt = (payload: any): FormRefineResult | null => {
    if (payload && Array.isArray(payload.ops)) {
      const { applied, missing } = applyFormOps(current, payload.ops);
      if (missing.length || applied === 0) return null;
      ensureFormShape(current);
      return { schema: current, kind: "ops", applied, note: `已应用 ${applied} 处修改` };
    }
    if (payload && Array.isArray(payload.fields)) {
      ensureFormShape(payload);
      if (formSignature(current) === formSignature(payload)) return null;
      return { schema: payload as FormSchema, kind: "full", applied: 1, note: "已按整表更新" };
    }
    return null;
  };

  let parsed: any;
  try {
    parsed = JSON.parse(extractJSON(await callAI(base + instruction, "只输出 JSON。")));
  } catch {
    parsed = undefined;
  }
  const first = attempt(parsed);
  if (first) return first;

  // 自愈重试
  const retry =
    base +
    instruction +
    `\n\n（上次输出无法应用：可能 JSON 不合法或引用了不存在的字段 id。现有合法 id：${validIds || "（无）"}。请重新只输出 JSON。）`;
  let parsed2: any;
  try {
    parsed2 = JSON.parse(extractJSON(await callAI(retry, "只输出 JSON。")));
  } catch {
    throw new Error("模型未能生成可应用的修改，请换个说法再试");
  }
  const second = attempt(parsed2);
  if (second) return second;
  if (parsed2 && Array.isArray(parsed2.ops)) {
    const { applied, missing } = applyFormOps(current, parsed2.ops);
    ensureFormShape(current);
    if (applied > 0) {
      return { schema: current, kind: "ops", applied, note: `已应用 ${applied} 处（忽略 ${missing.length} 处无效目标）` };
    }
  }
  throw new Error("没检测到有效改动。请把要求说具体些，例如：新增一个邮箱字段、把姓名字段设为必填");
}

// ============================================================================
// AI 自由页面（kind: "html"）：整页 HTML 直出 + 追问，页面靠 __ailab 桥接调后端
// ----------------------------------------------------------------------------
// 运行期页面在严格 sandbox（不透明源）的 iframe 里执行，直接 fetch 不带会话 Cookie，
// 因此约定取数只能用注入的 window.__ailab.*，由父页面代跑同源 /api/* 请求。
// 这套约定必须与 HtmlRunView.vue 注入的桥接客户端保持一致。
// ============================================================================

/** 资源接地块（HTML 版：给出真实资源名与其 REST 端点） */
function buildHtmlGroundingBlock(resources: ResourceInfo[], maxRes = 20, maxFields = 16): string {
  const fixed = `## 平台可用的后端接口（均为同源相对路径，用 window.__ailab 调用）
- GET  /api/crud/resources           返回 { resources:[{name,count,fields:[{prop,label,type}]}] }（所有数据资源清单）
- GET  /api/crud/<资源名>?page=1&pageSize=20&keyword=  列表（返回 { rows, total } 结构，字段以实际返回为准）
- POST /api/crud/<资源名>            新建（body 为对象）
- PUT  /api/crud/<资源名>/<id>       更新   DELETE /api/crud/<资源名>/<id> 删除
- GET  /api/iot/overview             物联网概览（在线/告警/能耗）
- GET  /api/iot/devices              设备列表
- GET  /api/auth/me                  当前登录用户（{ username, role } 等）`;
  if (!resources.length) {
    return `${fixed}\n\n（当前平台还没有已注册的 CRUD 资源；可先展示其它接口数据或静态内容。）`;
  }
  const shown = resources.slice(0, maxRes);
  const lines = shown.map((r) => {
    const all = r.fields || [];
    const fields = all
      .slice(0, maxFields)
      .map((f) => `${f.prop}(${f.label || f.prop})`)
      .join(", ");
    const more = all.length > maxFields ? ` …等 ${all.length} 字段` : "";
    return `- 资源 "${r.name}"（${r.count} 条）端点 /api/crud/${r.name}，字段: ${fields || "（暂无数据，字段未知）"}${more}`;
  });
  const moreRes = resources.length > shown.length ? `\n（另有 ${resources.length - shown.length} 个资源未列出）` : "";
  return `${fixed}\n\n## 平台现有的真实数据资源（务必使用真实资源名与真实字段 prop）\n${lines.join("\n")}${moreRes}`;
}

const HTML_API_DOC = `## 与后端交互的唯一方式（务必遵守）
你生成的页面会在一个隔离的沙箱 iframe 中运行，**不能**直接使用 fetch / XMLHttpRequest / WebSocket（它们不带登录会话，会 401）。
运行环境会注入一个全局对象 window.__ailab，用它发起所有后端请求（返回 Promise，成功解析为后端 JSON，失败抛错）：
- window.__ailab.get(path)                → Promise<any>
- window.__ailab.post(path, bodyObject)   → Promise<any>
- window.__ailab.put(path, bodyObject)    → Promise<any>
- window.__ailab.del(path)                → Promise<any>
其中 path 必须是同源相对路径且以 /api/ 开头，例如 "/api/crud/products"。
示例：
  const box = document.getElementById('list');
  window.__ailab.get('/api/crud/products?page=1&pageSize=20')
    .then((data) => { box.innerHTML = (data.rows || []).map(r => '<tr><td>'+r.name+'</td></tr>').join(''); })
    .catch((e) => { box.textContent = '加载失败：' + e.message; });`;

const HTML_STRICT_RULES = `## 输出要求（严格）
1. 只输出一个完整的、可独立运行的 HTML 文档（从 <!DOCTYPE html> 到 </html>），不要任何解释文字
2. 允许把内容放在 \`\`\`html 代码块里，但代码块内必须是完整页面
3. CSS 用 <style> 内联、JS 用 <script> 内联；页面要美观、响应式、有真实中文文案
4. 需要外部库（如图表）时，只能引用 https CDN，不要用 http；不要把任何密钥写进页面
5. 所有后端数据都通过 window.__ailab.* 获取；加载时给占位/骨架，出错时要 catch 并在页面上显示原因，不要白屏
6. 不要臆造资源名/字段，按下方“真实数据资源”里的名称与 prop 来写`;

/** 从模型输出中提取 HTML 源码（剥离思考段与 ``` 围栏） */
function extractHtml(text: string): string {
  const t = stripThinking(text || "").trim();
  const md = t.match(/```(?:html|HTML)?\s*([\s\S]*?)\s*```/);
  const body = (md ? md[1] : t).trim();
  return body;
}

/** 粗略校验：像一份 HTML（含标签），过滤掉模型偶尔的纯文字答复 */
function looksLikeHtml(s: string): boolean {
  return s.length > 40 && /<(html|body|div|h[1-6]|p|table|section|script|style|ul|form|button|main|header)\b/i.test(s);
}

/** 调用后端 AI 代理，带一次“上次不是 HTML”的自愈重试，返回 HTML 源码 */
async function callForHtml(prompt: string, system: string): Promise<string> {
  let html = extractHtml(await callAI(prompt, system));
  if (!looksLikeHtml(html)) {
    html = extractHtml(
      await callAI(prompt, system + "\n\n（上一次输出不是合法 HTML。请只输出一个从 <!DOCTYPE html> 到 </html> 的完整页面，可放在 ```html 代码块内。）"),
    );
  }
  if (!looksLikeHtml(html)) throw new Error("模型未能返回可用的 HTML 页面，请换个说法后重试");
  return html;
}

export interface HtmlGenerateResult {
  html: string;
}

export async function generateHtml(prompt: string, resources?: ResourceInfo[]): Promise<HtmlGenerateResult> {
  const grounded = resources ?? (await loadGrounding());
  const reserve = HTML_STRICT_RULES.length + HTML_API_DOC.length + prompt.length + 300;
  const budget = Math.max(600, MAX_PROMPT_CHARS - reserve);
  let grounding = buildHtmlGroundingBlock(grounded);
  if (grounding.length > budget) grounding = buildHtmlGroundingBlock(grounded, 6, 10);
  const system = `你是一个 AI 全栈页面生成器。根据用户描述，直出一整个 HTML 页面，并让它真正调用平台后端拿数据。\n\n${HTML_STRICT_RULES}\n\n${HTML_API_DOC}\n\n${grounding}`;
  const html = await callForHtml(prompt, system);
  return { html };
}

const HTML_REFINE_RULES = `## 修改要求（严格）
1. 在现有页面基础上按指令修改，输出【修改后的完整 HTML 文档】（从 <!DOCTYPE html> 到 </html>）
2. 未被指令涉及的部分原样保留，不要丢失已有的取数逻辑与样式
3. 仍然只能用 window.__ailab.* 访问后端；不要把任何密钥写进页面；外部库仅 https CDN
4. 只输出这一个完整页面（可放在 \`\`\`html 代码块内），不要解释、不要只给局部片段`;

export async function refineHtml(currentHtml: string, instruction: string, resources?: ResourceInfo[]): Promise<HtmlGenerateResult> {
  const grounded = resources ?? (await loadGrounding());
  const src = String(currentHtml || "").trim();
  if (!src) throw new Error("当前还没有页面，请先生成再追问修改");
  // 后端对 system 有长度上限（约 32000），整页源码放这里；超限则诚实提示改用左侧源码框手改
  const system = `${HTML_REFINE_RULES}\n\n${HTML_API_DOC}\n\n${buildHtmlGroundingBlock(grounded, 8, 10)}\n\n## 现有页面源码（请在此基础上修改并回传完整页面）\n${src}`;
  if (system.length > 30000) {
    throw new Error("页面较大，AI 整页改写会超出上下文；请直接在左侧源码框手动编辑，或简化后再生成");
  }
  const html = await callForHtml(instruction, system);
  return { html };
}
