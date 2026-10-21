// ============================================================================
// CSV 导出工具（统一转义 + 防公式注入）
//
// Excel/WPS 会把以 = + - @ 开头的单元格当公式执行（CSV 注入），
// 表单数据由外部用户提交，因此必须先中和这些前缀，再做引号转义。
// ============================================================================

/** 中和公式前缀：前置单引号，Excel 会按纯文本显示 */
function neutralize(s) {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** 转义单个 CSV 字段（始终包裹引号，最稳） */
export function csvCell(v) {
  const raw = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = neutralize(raw);
  return /[",\r\n]/.test(safe) || /^\s|\s$/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** 转义整行 */
export function csvRow(values) {
  return values.map(csvCell).join(",");
}

/** 拼装完整 CSV 文本（带 BOM，Excel 直接打开不乱码） */
export function csvText(header, rows) {
  return "\uFEFF" + [csvRow(header), ...rows.map(csvRow)].join("\r\n");
}
