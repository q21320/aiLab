// ============================================================================
// 实验室台账 · 导入模板生成与 CSV 解析
//
// 为什么用 CSV 而不是 Excel：平台前端零额外依赖（不引 SheetJS），CSV 能用 Excel/WPS
// 直接打开编辑，且与页面已有的「导出 CSV」形成闭环——导出的文件改改就能再导回来。
//
// 模板里的说明行以 # 开头：Excel 里看得见、可留着不删，解析时整行忽略，
// 这样"列名 + 填写规则 + 示例"能放在同一个文件里，不用另附说明书。
//
// 字段规则全部来自 resources.ts 的字段定义（唯一真相源）：
//   字段改了 → 模板与校验同时跟着变，不会出现"模板还写着旧选项"的漂移。
// ============================================================================

import type { LabField, LabResource } from "./resources";

/** 预览表最多渲染多少行（大文件只校验不全画，避免页面卡顿） */
export const PREVIEW_LIMIT = 50;

/** 单次导入行数上限（与服务端 MAX_IMPORT_ROWS 一致） */
export const MAX_IMPORT_ROWS = 1000;

export interface ImportError {
  prop: string;
  label: string;
  message: string;
}

export interface ImportRow {
  /** 在原 CSV 文件中的行号（含表头与 # 说明行），便于用户回 Excel 定位 */
  line: number;
  /** 各字段的原始文本（key = 字段 prop）：预览用，按字段取值不受列顺序影响 */
  cells: Record<string, string>;
  /** 转换后可直接提交服务端的字段值 */
  data: Record<string, any>;
  errors: ImportError[];
}

export interface ImportParseResult {
  rows: ImportRow[];
  /** 表头里没匹配到字段、被忽略的列名 */
  ignoredColumns: string[];
  /** 解析到的数据行总数（不含 # 说明行与空行） */
  totalDataRows: number;
  /** 需要的列一个都没找到 → 多半是拿错了文件 */
  headerFound: boolean;
  /** 参与查重的现有记录数（台账过大时只拉了一部分，需告知用户查重覆盖范围） */
  checkedExisting: number;
}

// ------------------------------------------------------------------ 基础工具
const pad2 = (n: number | string) => String(n).padStart(2, "0");

export function todayStr(d = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function shiftDay(base: Date, days: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

/** CSV 单元格转义（与页面导出口径一致：内含逗号/引号/换行时加引号） */
function csvCell(v: any): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** 表头/列名归一：去 BOM、引号、首尾与中间空白 */
function normHead(s: string): string {
  return String(s ?? "").replace(/^\uFEFF/, "").replace(/^"|"$/g, "").replace(/\s+/g, "").trim();
}

// -------------------------------------------------------------- 关联字段选项
/**
 * 关联字段（type=ref）的下拉选项：由来源台账行派生。
 * 页面渲染与导入解析共用这一份规则，避免两处标签拼法不一致导致导入匹配不上。
 */
export function refOptionsOf(
  f: LabField,
  sourceRows: Record<string, any>[],
): { value: string; label: string; disabled: boolean; row: Record<string, any> }[] {
  const vp = f.refValueProp || "id";
  const lp = f.refLabelProp || vp;
  return sourceRows
    .map((r) => {
      const value = String(r[vp] ?? "").trim();
      const label = f.refLabelProps?.length
        ? f.refLabelProps.map((p) => String(r[p] ?? "").trim()).filter(Boolean).join(" · ")
        : lp === vp
          ? String(r[lp] ?? value)
          : `${String(r[lp] ?? value).trim() || value}（${value}）`;
      const disabled = !!f.refDisabled && f.refDisabled.values.includes(String(r[f.refDisabled.prop] ?? ""));
      return { value, label: label || value, disabled, row: r };
    })
    .filter((o) => o.value);
}

// ------------------------------------------------------------------ 模板生成
/** 单个字段的填写规则（模板说明行 + 导入对话框字段说明都用它） */
export function fieldHint(f: LabField, def: LabResource): string {
  const name = f.label;
  if (f.type === "file") return `${name}：附件不参与导入，请保存记录后在页面里上传`;
  if (f.autoNo) {
    const dp = f.autoNoDateProp ? def.fields.find((x) => x.prop === f.autoNoDateProp)?.label : "";
    return `${name}：留空由系统自动生成（按${dp || "录入日期"}重置序号）；沿用旧编号体系时才手填`;
  }
  const req = f.required ? "必填" : "选填";
  switch (f.type) {
    case "select":
      return `${name}：${req}，可选值：${(f.options || []).map((o) => o.label).join(" / ")}`;
    case "number":
      return f.unitWan
        ? `${name}：${req}，数字，单位万元（可含小数，如 3.5 或 12000.50）`
        : `${name}：${req}，数字${f.money ? "（可含小数，逗号可省，如 12000 或 12000.50）" : "（整数）"}`;
    case "switch":
      return `${name}：${req}，填 是 或 否`;
    case "date":
      return `${name}：${req}，日期格式 2026-01-31（也接受 2026/1/31）`;
    case "daterange":
      return `${name}：${req}，两个日期用 ~ 分隔，如 ${shiftDay(new Date(), -10)} ~ ${shiftDay(new Date(), 5)}`;
    case "ref": {
      const src = def.fields.find((x) => x.prop === f.prop);
      const srcTitle = resourceTitleOf(f, def);
      const multi = src?.multiple ? "，多个用「、」或英文逗号分隔" : "";
      const lock = src?.refDisabled ? `，且不能选状态为 ${src.refDisabled.values.join("/")} 的项` : "";
      return `${name}：${req}，填「${srcTitle}」台账里的编号${multi}${lock}（编号列可在该页面导出后复制）`;
    }
    case "textarea":
      return `${name}：${req}，长文本，可含换行`;
    default:
      return `${name}：${req}，文本${f.unique ? "（台账内不可重复）" : ""}`;
  }
}

/** ref 字段的来源台账名（只为拼提示文案，找不到就退回资源名） */
function resourceTitleOf(f: LabField, _def: LabResource): string {
  const map: Record<string, string> = {
    lab_equipment: "设备信息",
    lab_projects: "测试项目",
    lab_outsource_projects: "委外项目",
    lab_customers: "客户信息",
    lab_consumables: "耗材信息",
  };
  return (f.refResource && map[f.refResource]) || f.refResource || "对应台账";
}

/** 示例值：让模板里的示例行贴近真实形态，用户改一改就能用 */
function sampleOf(f: LabField): string {
  if (f.type === "file") return "";
  if (f.autoNo) return "";
  switch (f.type) {
    case "date":
      return todayStr();
    case "daterange":
      return `${shiftDay(new Date(), -10)} ~ ${shiftDay(new Date(), 5)}`;
    case "select":
      return f.options?.[0]?.label ?? "";
    case "switch":
      return "否";
    case "number":
      return f.unitWan ? "3.5" : f.money ? "12000" : "10";
    case "ref":
      return f.multiple ? "示例编号1、示例编号2" : "示例编号";
    case "textarea":
      return "示例说明";
    default:
      return `示例${f.label}`;
  }
}

/**
 * 生成导入模板 CSV：第 1 行表头 + 若干 # 说明行（含一行示例）。
 * 表头与「导出 CSV」完全一致，因此导出的存量数据改改也能当导入文件用。
 */
export function buildTemplateCsv(def: LabResource): string {
  const lines: string[] = [];
  lines.push(def.fields.map((f) => csvCell(f.label)).join(","));
  lines.push(csvCell(`# ${def.title}导入模板 · 填写说明（# 开头的行导入时会自动忽略，可保留）`));
  lines.push(csvCell("# 请勿修改第 1 行的列名；列的顺序可以调整，多余的列会被忽略"));
  lines.push(csvCell("# 没有内容的单元格直接留空，不要填「无」「-」这类占位符"));
  lines.push(csvCell(`# 单次最多导入 ${MAX_IMPORT_ROWS} 行，数据量大请拆成多个文件`));
  for (const f of def.fields) lines.push(csvCell(`# ${fieldHint(f, def)}`));
  lines.push(csvCell(`# 示例：${def.fields.map((f) => sampleOf(f)).join(",")}`));
  // 带 BOM：Excel 直接双击打开不乱码（与页面导出保持同一做法）
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

/** 触发浏览器下载（文本内容，UTF-8 + BOM） */
export function downloadText(name: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export function templateFileName(def: LabResource): string {
  return `${def.title}-导入模板.csv`;
}

// ------------------------------------------------------------------ CSV 解析
/**
 * 读文件文本：先按 UTF-8 解，出现替换符（\uFFFD）说明不是 UTF-8——
 * 中文 Windows 的 Excel「另存为 CSV」默认是 GBK，这里用 gb18030 重解一次。
 */
export async function readCsvText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("\uFFFD")) return utf8.replace(/^\uFEFF/, "");
  try {
    return new TextDecoder("gb18030").decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return utf8.replace(/^\uFEFF/, "");
  }
}

/** 采样首行猜分隔符：Excel/WPS 在不同区域设置下可能存成分号或制表符分隔 */
function detectDelimiter(sampleLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of [",", "\t", ";"]) {
    const n = sampleLine.split(d).length - 1;
    if (n > bestCount) {
      bestCount = n;
      best = d;
    }
  }
  return best;
}

/** 标准 CSV 状态机：支持引号包裹、双引号转义、字段内换行、CRLF */
export function parseCsv(text: string, delim = ","): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\r") {
      /* CRLF 的 \r 直接丢 */
    } else if (ch === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    out.push(row);
  }
  return out;
}

/** 按首行猜分隔符后解析（Excel/WPS 在不同区域设置下会存成分号或制表符分隔） */
export function parseCsvAuto(text: string): string[][] {
  return parseCsv(text, detectDelimiter(String(text).split(/\r?\n/)[0] ?? ""));
}

/** 说明行：首格以 # 开头 */
function isComment(cells: string[]): boolean {
  return String(cells[0] ?? "").trim().startsWith("#");
}

function isBlank(cells: string[]): boolean {
  return cells.every((c) => String(c ?? "").trim() === "");
}

// ---------------------------------------------------------------- 值转换校验
/** 日期归一为 YYYY-MM-DD；无法识别返回 null（空值返回 ""） */
function normDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** 切成多个值：中文顿号/全角逗号/分号/换行都算分隔（导出用「、」拼接，正好往返） */
function splitMulti(s: string): string[] {
  return String(s ?? "")
    .split(/[,，、;；\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const TRUTHY = ["是", "true", "1", "yes", "y", "有"];
const FALSY = ["否", "false", "0", "no", "n", "无", ""];

/** 关联字段取值：按编号精确匹配，再按显示标签匹配（让「导出→改→导入」的显示文本也能认） */
function resolveRef(f: LabField, token: string, refs: Record<string, Record<string, any>[]>) {
  const options = refOptionsOf(f, (f.refResource && refs[f.refResource]) || []);
  const t = token.trim();
  const lower = t.toLowerCase();
  return (
    options.find((o) => o.value === t) ||
    options.find((o) => o.label === t) ||
    options.find((o) => o.value.toLowerCase() === lower || o.label.toLowerCase() === lower) ||
    null
  );
}

/**
 * 单字段：文本 → 落库值。
 * 返回 value === undefined 表示该字段不写入（保持空），errors 非空表示该行有格式问题。
 */
function coerceField(
  f: LabField,
  rawText: string,
  def: LabResource,
  refs: Record<string, Record<string, any>[]>,
): { value: any; errors: ImportError[] } {
  const errors: ImportError[] = [];
  const push = (message: string) => errors.push({ prop: f.prop, label: f.label, message });
  const s = String(rawText ?? "").trim();

  if (f.type === "file") return { value: undefined, errors };
  if (!s) {
    if (f.required && !f.autoNo) push(`${f.label}为必填`);
    return { value: undefined, errors };
  }

  switch (f.type) {
    case "number": {
      // 万元口径字段允许写「1.5万 / 1.5万元」（数值本身就是万元，只去后缀不换算），其余同原清洗
      const cleaned = s
        .replace(/[,，\s¥￥$]/g, "")
        .replace(f.unitWan ? /万元?$/ : /元$/, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
        push(`${f.label}应为数字，当前「${s}」`);
        return { value: undefined, errors };
      }
      const n = Number(cleaned);
      if (!f.money && !Number.isInteger(n)) {
        push(`${f.label}应为整数，当前「${s}」`);
        return { value: undefined, errors };
      }
      return { value: f.money ? Math.round(n * 100) / 100 : Math.round(n), errors };
    }
    case "switch": {
      const low = s.toLowerCase();
      if (TRUTHY.includes(low) || TRUTHY.includes(s)) return { value: true, errors };
      if (FALSY.includes(low) || FALSY.includes(s)) return { value: false, errors };
      push(`${f.label}只能填 是 或 否，当前「${s}」`);
      return { value: undefined, errors };
    }
    case "date": {
      const v = normDate(s);
      if (v === null) push(`${f.label}日期格式应为 2026-01-31，当前「${s}」`);
      return { value: v ?? undefined, errors };
    }
    case "daterange": {
      // 与页面显示形态一致：先按 ~ / ～ / 至 / — / --> 拆两个日期，拆不出来再退回按顿号、分号拆
      const bySep = String(s)
        .split(/\s*(?:~|～|至|—|→|-->)\s*/)
        .map((x) => x.trim())
        .filter(Boolean);
      const list = (bySep.length >= 2 ? bySep : splitMulti(s)).slice(0, 2);
      if (list.length !== 2) {
        push(`${f.label}需要两个日期并用 ~ 分隔，当前「${s}」`);
        return { value: undefined, errors };
      }
      const a = normDate(list[0]);
      const b = normDate(list[1]);
      if (!a || !b) {
        push(`${f.label}日期格式应为 2026-01-31 ~ 2026-02-15，当前「${s}」`);
        return { value: undefined, errors };
      }
      return { value: `${a} ~ ${b}`, errors };
    }
    case "select": {
      const hit = (f.options || []).find((o) => o.value === s || o.label === s);
      if (!hit) {
        push(`${f.label}只能是：${(f.options || []).map((o) => o.label).join(" / ")}`);
        return { value: undefined, errors };
      }
      return { value: hit.value, errors };
    }
    case "ref": {
      const source = (f.refResource && refs[f.refResource]) || [];
      if (!source.length) {
        push(`${f.label}无法校验：「${resourceTitleOf(f, def)}」台账暂无数据或当前角色没有查看权限`);
        return { value: undefined, errors };
      }
      const tokens = f.multiple ? splitMulti(s) : [s];
      const values: string[] = [];
      for (const t of tokens) {
        const opt = resolveRef(f, t, refs);
        if (!opt) {
          push(`${f.label}「${t}」在「${resourceTitleOf(f, def)}」里找不到（该台账共 ${source.length} 条）`);
          continue;
        }
        if (opt.disabled && f.refDisabled) {
          push(`${f.label}「${t}」当前为「${String(opt.row[f.refDisabled.prop] ?? "")}」，不可选入`);
          continue;
        }
        values.push(opt.value);
      }
      if (errors.length) return { value: undefined, errors };
      return { value: f.multiple ? values : values[0], errors };
    }
    default:
      // 文本/长文本：原文入库；自动编号字段留空由服务端生成（这里透传用户填的值）
      return { value: s, errors };
  }
}

// ------------------------------------------------------------------ 整表解析
/**
 * 把 parseCsv 的二维表转成可提交的行：定位表头 → 列名映射字段 → 逐格按类型转换。
 * @param refs 引用台账数据（来源资源名 → 行数组），由页面已加载的 refRows 传入
 * @param existing 本台账现有记录（供 unique 字段查重）；量大的台账只能拉到部分，用 checkedExisting 告知覆盖范围
 */
export function parseImportTable(
  def: LabResource,
  refs: Record<string, Record<string, any>[]>,
  table: string[][],
  existing: Record<string, any>[] = [],
): ImportParseResult {
  const result: ImportParseResult = {
    rows: [],
    ignoredColumns: [],
    totalDataRows: 0,
    headerFound: false,
    checkedExisting: existing.length,
  };
  // 表头 = 第一行非说明行
  const headerIndex = table.findIndex((cells) => !isComment(cells) && !isBlank(cells));
  if (headerIndex < 0) return result;
  const header = table[headerIndex].map(normHead);

  // 列 → 字段：先按 label 精确匹配，兼容按 prop 匹配（有人改过表头英文名的场景）
  const columns: (LabField | null)[] = header.map((h) => {
    if (!h) return null;
    return def.fields.find((f) => f.label === h) || def.fields.find((f) => f.prop === h) || null;
  });
  result.ignoredColumns = header.filter((h, i) => h && !columns[i]);
  result.headerFound = columns.some(Boolean);
  if (!result.headerFound) return result;

  // 唯一字段查重表：现有值先装进去，再把本文件新出现的值累加进去（兼管批内重行）
  const uniqFields = def.fields.filter((f) => f.unique);
  const seen = new Map<string, Set<string>>(
    uniqFields.map((f) => [
      f.prop,
      new Set(existing.map((r) => String(r[f.prop] ?? "").trim().toLowerCase()).filter(Boolean)),
    ]),
  );

  for (let i = headerIndex + 1; i < table.length; i += 1) {
    const lineCells = table[i];
    if (isComment(lineCells) || isBlank(lineCells)) continue;
    result.totalDataRows += 1;
    const data: Record<string, any> = {};
    const cells: Record<string, string> = {};
    const errors: ImportError[] = [];
    columns.forEach((f, ci) => {
      if (!f) return;
      const text = String(lineCells[ci] ?? "").trim();
      cells[f.prop] = text;
      const { value, errors: fieldErrors } = coerceField(f, text, def, refs);
      errors.push(...fieldErrors);
      if (value !== undefined) data[f.prop] = value;
    });
    // 前端不做 id 校验：ID 由服务端生成，与单条新增一致
    for (const f of uniqFields) {
      const v = String(data[f.prop] ?? "").trim();
      if (!v) continue;
      const set = seen.get(f.prop)!;
      // 大小写不敏感：编号习惯全大写，但手填时 eq-001 / EQ-001 应当算同一个设备
      if (set.has(v.toLowerCase())) {
        errors.push({ prop: f.prop, label: f.label, message: `「${v}」与已有记录或本文件前面的行重复` });
      } else set.add(v.toLowerCase());
    }
    result.rows.push({ line: i + 1, cells, data, errors });
  }
  return result;
}

/** 供对话框展示的字段清单（列名 + 规则），与模板说明同源 */
export function fieldHints(def: LabResource): string[] {
  return def.fields.map((f) => fieldHint(f, def));
}
