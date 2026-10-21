// ============================================================================
// 样式与资源清洗（需求 4.2/4.9 安全）
//
// 低代码 schema 的 style 由用户在属性面板「支持任意 CSS 键」直接编辑，
// 也可能来自 AI 生成（不可信输入）。若原样绑定到运行页，攻击者可用
//   position: fixed; z-index: 99999; inset: 0;   覆盖全站做钓鱼
//   background: url(https://evil/x.png)          外联追踪 / 隐私泄露
// 本模块以**白名单 + 值校验**的方式收敛这些风险：
//   · 只保留布局/盒模型/排版/颜色类属性；
//   · 拒绝任何含 url()、expression()、@import 或控制字符的值；
//   · 尺寸类只接受合法长度/百分比/单位。
// ============================================================================

/** 允许的 CSS 属性（白名单）。未列出的一律丢弃。 */
const ALLOWED_PROPS = new Set([
  // 布局
  "display", "flex-direction", "flex-wrap", "justify-content", "align-items", "align-content",
  "gap", "row-gap", "column-gap", "flex", "flex-grow", "flex-shrink", "flex-basis",
  "grid-template-columns", "grid-template-rows", "grid-column", "grid-row",
  "position", "top", "right", "bottom", "left", "float", "clear",
  // 盒模型
  "width", "height", "min-width", "min-height", "max-width", "max-height",
  "margin", "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "box-sizing", "box-shadow", "border", "border-radius", "border-width", "border-style",
  "border-color", "border-top", "border-right", "border-bottom", "border-left",
  "overflow", "overflow-x", "overflow-y", "opacity",
  // 排版
  "font-size", "font-weight", "font-style", "font-family", "line-height", "letter-spacing",
  "text-align", "text-decoration", "text-transform", "white-space", "word-break", "word-wrap",
  "vertical-align", "cursor", "color",
  // 背景（仅颜色/渐变，不含 url）
  "background", "background-color",
  // 其它
  "transform", "transition", "z-index",
]);

/**
 * 高风险的「定位/层级」属性：允许，但限制取值范围，
 * 防止 position:fixed + 全屏 + 超高 z-index 覆盖控制台。
 */
const POSITION_VALUES = new Set(["relative", "absolute", "static", "sticky", "fixed"]);
const MAX_Z_INDEX = 100;

/** 破坏性检测：任何 url()/expression/@import/控制字符都视为危险 */
const DANGEROUS_VALUE = /url\s*\(|expression\s*\(|@import|javascript:|vbscript:|data:text\/html|\\|[\u0000-\u001f]/i;

/** 合法 CSS 长度：数字 + 单位，或百分比 / 关键字 */
const LENGTH_RE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|pt|ex|ch)?$/;

function isSafeValue(prop: string, raw: unknown): boolean {
  if (typeof raw === "number") return Number.isFinite(raw);
  if (typeof raw !== "string") return false;
  const v = raw.trim();
  if (!v || v.length > 200) return false;
  if (DANGEROUS_VALUE.test(v)) return false;

  if (prop === "position") return POSITION_VALUES.has(v);
  if (prop === "z-index") {
    const n = Number(v);
    return Number.isFinite(n) && Math.abs(n) <= MAX_Z_INDEX;
  }
  if (prop === "transform" || prop === "transition") {
    // 变换类属性本身可用 CSS 变量绕开，这里只做宽度/位移的白名单形校验
    return /^[\w\s().,%#+-]+$/.test(v);
  }
  if (/^(width|height|max-|min-|top|right|bottom|left|margin|padding|gap|font-size|line-height|border-radius|border-width|letter-spacing)/.test(prop)) {
    // 允许单个值、多值（如 padding: 8px 16px）与 auto / 0
    if (v === "auto" || v === "0") return true;
    return v.split(/\s+/).every((part) => LENGTH_RE.test(part) || part === "auto");
  }
  return true;
}

/** camelCase 或 kebab 统一为 CSS 属性名 */
function normalizeProp(key: string): string {
  return key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase()).trim().toLowerCase();
}

/**
 * 清洗样式对象：返回只含白名单属性的新对象。
 * @param style 原始样式（可能来自用户或 AI）
 */
export function sanitizeStyle(style: unknown): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (!style || typeof style !== "object" || Array.isArray(style)) return out;
  for (const [rawKey, rawValue] of Object.entries(style as Record<string, unknown>)) {
    const prop = normalizeProp(rawKey);
    if (!ALLOWED_PROPS.has(prop)) continue;
    if (!isSafeValue(prop, rawValue)) continue;
    out[prop] = typeof rawValue === "number" ? rawValue : String(rawValue).trim();
  }
  return out;
}

/** 清洗图片地址：只允许 https/http/相对路径/内联图片，禁止 javascript: 等协议 */
export function sanitizeImageSrc(src: unknown): string {
  const s = typeof src === "string" ? src.trim() : "";
  if (!s) return "";
  if (DANGEROUS_VALUE.test(s)) return "";
  if (/^(https?:\/\/|\/|\.\/|\.\.\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i.test(s)) return s;
  return "";
}

/** 递归清洗整棵 schema（发布前使用，保证落库的运行数据安全） */
export function sanitizeSchemaTree<T extends { style?: unknown; children?: T[]; props?: Record<string, unknown> }>(node: T): T {
  if (!node || typeof node !== "object") return node;
  const next = { ...node };
  next.style = sanitizeStyle(node.style);
  if (next.props && typeof next.props === "object") {
    const props = { ...next.props };
    if (typeof props.src === "string") props.src = sanitizeImageSrc(props.src);
    next.props = props;
  }
  if (Array.isArray(node.children)) next.children = node.children.map((c) => sanitizeSchemaTree(c));
  return next;
}
