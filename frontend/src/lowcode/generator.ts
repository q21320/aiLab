// AI 页面生成引擎
// 调用阿里云 qwen-max API 生成页面 Schema

import type { PageSchema } from "./types";

// ============ API 配置 ============
const API_BASE = "/api/dashscope/compatible-mode";
const MODEL_NAME = "qwen-max";
const API_KEY = "sk-ws-H.ERLDRYH.nJdG.MEUCIHqWZeG7jsSsfrGnCy5F_GPw2Pl8KrLDugrsPWypUEZSAiEA6RBWD_p3y1ErgEY8ybLgHG9DOi1p0Q-DIL2PhV6veP0";

// 系统提示词：指导模型返回符合我们 Schema 规范的 JSON
const SYSTEM_PROMPT = `你是一个 AI 低代码页面生成器。根据用户描述，输出一个 JSON 对象来描述页面结构。

## 严格规则
1. 只输出一个 JSON 对象，不要输出任何其他文字、不要 markdown 代码块
2. 根节点 type 必须是 "page"
3. 每个节点必须有唯一 "id"（如 "page_1", "title_1", "btn_1"）
4. style 的值必须是字符串（如 "20px", "flex", "#fff"），不能是数字
5. 页面内容要丰富完整，不要只有空壳——要有真实的中文文案、示例数据
6. 布局要美观合理，善用 container + style 做排版

## 17 种组件类型及属性

### page（页面根）
- children: 子节点数组
- style: { padding, background, minHeight }

### container（容器，div）
- children: 子节点数组
- style: { display, flexDirection, justifyContent, alignItems, gap, padding, margin, textAlign, background, borderRadius, width, height, minHeight, maxWidth }

### title（标题，渲染为 h1~h6）
- text: 标题文字
- props: { level: 1~6 }
- style: { textAlign, color, margin, marginBottom, marginTop, fontSize }

### text（段落文本，渲染为 p）
- text: 文字内容
- style: { color, fontSize, fontWeight, textAlign, margin, lineHeight, cursor }

### button（按钮）
- text: 按钮文字
- props: { type: "primary"|"success"|"warning"|"danger"|"default", size: "large"|"default"|"small", plain: true, round: true }
- style: { width, margin, marginRight }

### input（输入框）
- props: { placeholder, type: "text"|"password"|"textarea", clearable: true, showPassword: true, rows: 数字 }
- style: { width, marginBottom }

### select（下拉选择）
- props: { placeholder, options: ["选项1", "选项2", ...] }
- style: { width }

### form（表单容器）
- props: { labelWidth: "80px" 等 }
- children: 通常是 formItem 节点

### formItem（表单项）
- props: { label: "标签名" }
- children: 通常包含一个 input 或 select

### table（表格）
- props: { border: true, columns: [{prop, label, width}], data: [{prop: value, ...}, ...] }
- columns 的 prop 要和 data 里的 key 对应
- style: { width }

### card（卡片）
- props: { shadow: "always"|"hover"|"never" }
- children: 卡片内容
- style: { width, maxWidth, margin, padding }

### image（图片）
- props: { src: "图片URL", fit: "cover"|"contain"|"fill" }
- style: { width, height, borderRadius }

### divider（分割线）
- 无特殊属性

### row（栅格行）
- props: { gutter: 数字，如 20 }
- children: 通常是 col 节点

### col（栅格列）
- props: { span: 1~24，总和24 }
- children: 列内内容

### tag（标签）
- text: 标签文字
- props: { type: "primary"|"success"|"warning"|"danger"|"info" }

### space（间距容器）
- children: 子节点，自动水平排列并留间距

## 完整示例

### 示例1：登录页
{"id":"page_1","type":"page","style":{"padding":"20px","background":"#f5f7fa","minHeight":"100%"},"children":[{"id":"c_1","type":"container","style":{"display":"flex","justifyContent":"center","alignItems":"center","padding":"60px 0"},"children":[{"id":"card_1","type":"card","props":{"shadow":"always"},"style":{"width":"400px"},"children":[{"id":"t_1","type":"title","text":"用户登录","props":{"level":2},"style":{"textAlign":"center","marginBottom":"8px"}},{"id":"desc_1","type":"text","text":"欢迎回来，请输入您的账号信息","style":{"textAlign":"center","color":"#909399","marginBottom":"24px"}},{"id":"form_1","type":"form","props":{"labelWidth":"0px"},"children":[{"id":"fi_1","type":"formItem","children":[{"id":"inp_1","type":"input","props":{"placeholder":"请输入用户名","size":"large","clearable":true}}]},{"id":"fi_2","type":"formItem","children":[{"id":"inp_2","type":"input","props":{"placeholder":"请输入密码","type":"password","size":"large","showPassword":true}}]},{"id":"btn_1","type":"button","text":"登 录","props":{"type":"primary","size":"large"},"style":{"width":"100%","marginTop":"8px"}}]},{"id":"link_1","type":"text","text":"还没有账号？立即注册","style":{"textAlign":"center","color":"#409eff","marginTop":"16px","cursor":"pointer"}}]}]}]}

### 示例2：数据表格页
{"id":"page_1","type":"page","style":{"padding":"20px","background":"#fff"},"children":[{"id":"header","type":"container","style":{"display":"flex","justifyContent":"space-between","alignItems":"center","marginBottom":"16px"},"children":[{"id":"t_1","type":"title","text":"用户管理","props":{"level":3},"style":{"margin":"0"}},{"id":"btn_add","type":"button","text":"+ 新增用户","props":{"type":"primary"}}]},{"id":"toolbar","type":"container","style":{"display":"flex","gap":"12px","marginBottom":"16px"},"children":[{"id":"search","type":"input","props":{"placeholder":"搜索用户名或邮箱","clearable":true},"style":{"width":"260px"}},{"id":"btn_search","type":"button","text":"查询","props":{"type":"primary"}},{"id":"btn_reset","type":"button","text":"重置"}]},{"id":"tbl","type":"table","props":{"border":true,"columns":[{"prop":"name","label":"姓名","width":120},{"prop":"email","label":"邮箱"},{"prop":"role","label":"角色","width":120},{"prop":"status","label":"状态","width":100}],"data":[{"name":"张三","email":"zhangsan@example.com","role":"管理员","status":"启用"},{"name":"李四","email":"lisi@example.com","role":"普通用户","status":"启用"},{"name":"王五","email":"wangwu@example.com","role":"运营","status":"禁用"}]}}]}

### 示例3：仪表盘
{"id":"page_1","type":"page","style":{"padding":"20px","background":"#f5f7fa"},"children":[{"id":"t_1","type":"title","text":"数据概览","props":{"level":3},"style":{"marginTop":"0","marginBottom":"20px"}},{"id":"stats","type":"row","props":{"gutter":20},"style":{"marginBottom":"20px"},"children":[{"id":"c1","type":"col","props":{"span":6},"children":[{"id":"card1","type":"card","props":{"shadow":"hover"},"children":[{"id":"v1","type":"title","text":"12,480","props":{"level":3},"style":{"margin":"0","color":"#409eff","fontSize":"26px"}},{"id":"l1","type":"text","text":"总用户数","style":{"color":"#909399"}}]}]},{"id":"c2","type":"col","props":{"span":6},"children":[{"id":"card2","type":"card","props":{"shadow":"hover"},"children":[{"id":"v2","type":"title","text":"3,265","props":{"level":3},"style":{"margin":"0","color":"#67c23a","fontSize":"26px"}},{"id":"l2","type":"text","text":"今日访问","style":{"color":"#909399"}}]}]},{"id":"c3","type":"col","props":{"span":6},"children":[{"id":"card3","type":"card","props":{"shadow":"hover"},"children":[{"id":"v3","type":"title","text":"8,910","props":{"level":3},"style":{"margin":"0","color":"#e6a23c","fontSize":"26px"}},{"id":"l3","type":"text","text":"订单总量","style":{"color":"#909399"}}]}]},{"id":"c4","type":"col","props":{"span":6},"children":[{"id":"card4","type":"card","props":{"shadow":"hover"},"children":[{"id":"v4","type":"title","text":"24.8%","props":{"level":3},"style":{"margin":"0","color":"#f56c6c","fontSize":"26px"}},{"id":"l4","type":"text","text":"转化率","style":{"color":"#909399"}}]}]}]},{"id":"detail_card","type":"card","children":[{"id":"t2","type":"title","text":"最近动态","props":{"level":4},"style":{"marginTop":"0","marginBottom":"12px"}},{"id":"tbl","type":"table","props":{"columns":[{"prop":"time","label":"时间","width":180},{"prop":"user","label":"用户","width":120},{"prop":"action","label":"操作"}],"data":[{"time":"2026-09-02 10:24","user":"张三","action":"创建了新订单"},{"time":"2026-09-02 09:15","user":"李四","action":"更新了个人资料"},{"time":"2026-09-01 18:42","user":"王五","action":"提交了工单"}]}}]}]}

记住：只输出 JSON，不要任何其他内容。根据用户描述灵活组合以上组件，生成丰富、美观、完整的页面。`;

/** 供 UI 快捷使用的示例提示词 */
export const EXAMPLE_PROMPTS = [
  "一个用户登录页面，包含用户名和密码",
  "生成用户管理的数据表格页面，带搜索和新增按钮",
  "一个数据仪表盘，顶部统计卡片，下方最近动态表格",
  "做一张信息登记表单，含姓名、邮箱、城市和备注",
  "商品展示页，三列卡片，每张有图片、价格和购买按钮",
];

export interface GenerateResult {
  schema: PageSchema;
  matched: string;
}

/** 调用 Qwen3 API */
async function callAI(prompt: string): Promise<string> {
  const url = `${API_BASE}/v1/chat/completions`;
  console.log("[AI] 请求 URL:", url);
  console.log("[AI] 请求内容:", prompt);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_KEY}`
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.7,
      enable_thinking: false
    })
  });
  
  console.log("[AI] 响应状态:", response.status);
  if (!response.ok) throw new Error(`API 请求失败：${response.status} ${response.statusText}`);
  
  const data = await response.json();
  console.log("[AI] 完整响应:", data);
  
  const content = data.choices?.[0]?.message?.content || "";
  console.log("[AI] 模型返回内容:", content);
  return content;
}

/** 从 AI 返回的文本中提取 JSON */
function extractJSON(text: string): string {
  console.log("[AI] 原始文本:", text);
  // 移除可能存在的 <think>...</think> 思考过程
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // 尝试提取 ```json ... ``` 块
  const mdMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
  if (mdMatch) {
    console.log("[AI] 提取到 markdown 代码块");
    return mdMatch[1];
  }
  // 尝试提取第一个 {...} 块
  const braceMatch = text.match(/(\{[\s\S]*\})/);
  if (braceMatch) {
    console.log("[AI] 提取到 JSON 对象");
    return braceMatch[1];
  }
  console.log("[AI] 未提取到 JSON，返回原文本");
  return text;
}

/**
 * AI 生成页面 Schema（纯 API 调用，无本地 fallback）。
 */
export async function generateSchema(prompt: string): Promise<GenerateResult> {
  const jsonStr = await callAI(prompt);
  const json = extractJSON(jsonStr);
  console.log("[AI] 提取的 JSON:", json);
  const schema = JSON.parse(json) as PageSchema;
  // 简单校验
  if (!schema.type || schema.type !== "page") throw new Error("根节点 type 不是 page");
  console.log("[AI] 生成成功");
  return { schema, matched: "AI 生成" };
}
