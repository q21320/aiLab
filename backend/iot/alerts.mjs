// ============================================================================
// 物联网告警存储（PostgreSQL）
//
// 解决此前的问题：
//   · 告警只存在 iotState.alerts 内存数组里，上限 100 条；
//   · 未处理告警会被静默丢弃（实测 425 条未处理但只保留 100 条）；
//   · 重启后只剩最后一次落盘的快照，告警历史无法追溯。
//
// 现在：
//   · 全量写入 iot_alerts 表，**不丢弃**任何一条；
//   · 支持分页查询、按状态/级别/设备/时间范围筛选；
//   · 内存数组仅作为「最近 N 条」的实时缓存，供 SSE 推送与概览统计使用；
//   · 提供留存期清理（默认 12 个月）。
// ============================================================================

/** 内存缓存条数（只影响 SSE 推送与首页概览，不影响数据库完整历史） */
const MEMORY_LIMIT = 200;
/** 默认留存月数 */
const RETENTION_MONTHS = 12;

export const ALERTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS iot_alerts (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  device_name TEXT,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  time        BIGINT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'open',
  acked_at    BIGINT,
  acked_by    TEXT
);
CREATE INDEX IF NOT EXISTS idx_iot_alerts_time ON iot_alerts(time DESC);
CREATE INDEX IF NOT EXISTS idx_iot_alerts_status ON iot_alerts(status, time DESC);
CREATE INDEX IF NOT EXISTS idx_iot_alerts_device ON iot_alerts(device_id, time DESC);
`;

export function createAlertStore({ db }) {
  const { query } = db;

  /** 序列号：从数据库取当前最大值，避免重启后重号 */
  let serial = null;
  async function ensureSerial() {
    if (serial !== null) return serial;
    const r = await query(
      "SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::bigint), 0) AS n FROM iot_alerts",
    );
    serial = Number(r.rows[0].n) || 0;
    return serial;
  }

  function nextId() {
    serial = (serial || 0) + 1;
    return `AL-${String(serial).padStart(4, "0")}`;
  }

  const toRow = (r) => ({
    id: r.id,
    deviceId: r.device_id,
    deviceName: r.device_name || "",
    level: r.level,
    message: r.message,
    time: Number(r.time),
    status: r.status,
    ackedAt: r.acked_at ? Number(r.acked_at) : undefined,
    ackedBy: r.acked_by || undefined,
  });

  /** 启动时把已有告警恢复进内存缓存（只取最近 MEMORY_LIMIT 条） */
  async function loadRecent(limit = MEMORY_LIMIT) {
    await ensureSerial();
    const r = await query("SELECT * FROM iot_alerts ORDER BY time DESC LIMIT $1", [limit]);
    return r.rows.map(toRow);
  }

  /** 写入新告警 */
  async function insert(device, level, message, time = Date.now()) {
    const id = nextId();
    await query(
      `INSERT INTO iot_alerts (id, device_id, device_name, level, message, time, status)
       VALUES ($1,$2,$3,$4,$5,$6,'open') ON CONFLICT DO NOTHING`,
      [id, device.id, device.name || "", level, message, time],
    );
    return { id, deviceId: device.id, deviceName: device.name || "", level, message, time, status: "open" };
  }

  /** 判断「同设备 + 同内容」是否已有未处理告警（用于去重） */
  async function hasOpen(deviceId, message) {
    const r = await query(
      "SELECT 1 FROM iot_alerts WHERE device_id = $1 AND message = $2 AND status = 'open' LIMIT 1",
      [deviceId, message],
    );
    return r.rowCount > 0;
  }

  /** 分页查询 */
  async function list({ status, level, deviceId, from, to, keyword, page = 1, pageSize = 20 } = {}) {
    const conds = [];
    const params = [];
    const add = (sql, val) => {
      params.push(val);
      conds.push(sql.replace("?", `$${params.length}`));
    };
    if (status && status !== "all") add("status = ?", status);
    if (level && level !== "all") add("level = ?", level);
    if (deviceId) add("device_id = ?", deviceId);
    if (from) add("time >= ?", from);
    if (to) add("time <= ?", to);
    if (keyword) {
      // 关键词同时匹配告警内容与设备ID，需要两个占位符
      const like = `%${keyword}%`;
      params.push(like, like);
      const n = params.length;
      conds.push(`(message ILIKE $${n - 1} OR device_id ILIKE $${n})`);
    }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const size = Math.min(Math.max(Number(pageSize) || 20, 1), 200);
    const pg = Math.max(Number(page) || 1, 1);

    const totalRes = await query(`SELECT COUNT(*)::int AS n FROM iot_alerts ${where}`, params);
    const listRes = await query(
      `SELECT * FROM iot_alerts ${where} ORDER BY time DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, size, (pg - 1) * size],
    );
    return { alerts: listRes.rows.map(toRow), total: totalRes.rows[0].n, page: pg, pageSize: size };
  }

  /** 统计 */
  async function stats() {
    const r = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'open')::int AS open,
        COUNT(*) FILTER (WHERE status = 'open' AND level = 'error')::int AS open_error,
        COUNT(*) FILTER (WHERE status = 'open' AND level = 'warn')::int AS open_warn,
        COUNT(*) FILTER (WHERE status <> 'open')::int AS acked
      FROM iot_alerts
    `);
    return r.rows[0];
  }

  /** 确认告警 */
  async function ack(id, by = "") {
    const r = await query(
      "UPDATE iot_alerts SET status = 'acked', acked_at = $1, acked_by = $2 WHERE id = $3 AND status = 'open' RETURNING *",
      [Date.now(), by, id],
    );
    if (r.rowCount === 0) {
      const cur = await query("SELECT * FROM iot_alerts WHERE id = $1", [id]);
      return cur.rowCount ? { ok: true, alert: toRow(cur.rows[0]), already: true } : { ok: false };
    }
    return { ok: true, alert: toRow(r.rows[0]) };
  }

  /** 批量确认（一次更新多条，避免前端逐条请求） */
  async function ackBatch(ids, by = "") {
    if (!Array.isArray(ids) || !ids.length) return { ok: true, acked: 0 };
    const r = await query(
      `UPDATE iot_alerts SET status = 'acked', acked_at = $1, acked_by = $2
       WHERE id = ANY($3::text[]) AND status = 'open' RETURNING id`,
      [Date.now(), by, ids],
    );
    return { ok: true, acked: r.rowCount, ids: r.rows.map((x) => x.id) };
  }

  /** 按状态批量确认（确认当前所有未处理告警，可带筛选） */
  async function ackAllOpen(by = "") {
    const r = await query(
      "UPDATE iot_alerts SET status = 'acked', acked_at = $1, acked_by = $2 WHERE status = 'open' RETURNING id",
      [Date.now(), by],
    );
    return { ok: true, acked: r.rowCount };
  }

  /** 留存清理：删除 N 个月前的已确认告警（未处理的不删） */
  async function prune(months = RETENTION_MONTHS) {
    const cutoff = Date.now() - months * 30 * 86400000;
    const r = await query("DELETE FROM iot_alerts WHERE time < $1 AND status <> 'open'", [cutoff]);
    return r.rowCount;
  }

  /** 未处理数量（概览用） */
  async function countOpen() {
    const r = await query("SELECT COUNT(*)::int AS n FROM iot_alerts WHERE status = 'open'");
    return r.rows[0].n;
  }

  return { loadRecent, insert, hasOpen, list, stats, ack, ackBatch, ackAllOpen, prune, countOpen };
}

export { MEMORY_LIMIT, RETENTION_MONTHS };
