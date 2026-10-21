// ============================================================================
// 采集点位数据存储（PostgreSQL）
//
// 解决此前的问题：
//   · histories 是每设备 200 点的**内存环形缓冲**，重启即丢失；
//   · 真实设备开启自动采集后很快填满，历史曲线实际只能看约 33 分钟；
//   · 无法做长周期趋势分析（周/月报表）。
//
// 现在：
//   · 每次采集写入 iot_points 表，支持任意时间跨度查询；
//   · 内存缓冲保留（供 SSE 与实时曲线），但**不再是唯一数据源**；
//   · 按天分区思路用 time 索引 + 分页；提供聚合查询（分钟/小时粒度降采样）；
//   · 留存期默认 90 天，可配置。
//
// 数据量估算：10 台设备 × 10 秒周期 × 24 小时 = 86,400 行/天，90 天约 780 万行。
// 因此写入采用**批量插入**（每次采集一行），并为高频场景准备好聚合与清理。
// ============================================================================

/** 默认留存天数（可在运行时通过 setRetentionDays 调整） */
let RETENTION_DAYS = Number(process.env.IOT_POINT_RETENTION_DAYS || 90);
if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS < 1) RETENTION_DAYS = 90;
/** 单次查询返回的最大点数（防止一次拉爆内存） */
const MAX_QUERY_POINTS = 5000;

export const POINTS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS iot_points (
  id          BIGSERIAL PRIMARY KEY,
  device_id   TEXT NOT NULL,
  time        BIGINT NOT NULL,
  temperature DOUBLE PRECISION,
  humidity    DOUBLE PRECISION,
  power       DOUBLE PRECISION,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_iot_points_dev_time ON iot_points(device_id, time DESC);
CREATE INDEX IF NOT EXISTS idx_iot_points_time ON iot_points(time DESC);
`;

export function createPointStore({ db }) {
  const { query } = db;

  /** 写入一批点位（一次采集的多条合并为一条 INSERT） */
  async function insertMany(points) {
    if (!Array.isArray(points) || !points.length) return 0;
    const params = [];
    const tuples = points.map((p, i) => {
      const b = i * 6;
      params.push(
        p.deviceId,
        Number(p.time) || Date.now(),
        typeof p.temperature === "number" ? p.temperature : null,
        typeof p.humidity === "number" ? p.humidity : null,
        typeof p.power === "number" ? p.power : null,
        // 完整点位（含自定义 key），便于后续扩展
        JSON.stringify(p),
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6}::jsonb)`;
    });
    const r = await query(
      `INSERT INTO iot_points (device_id, time, temperature, humidity, power, values)
       VALUES ${tuples.join(",")}`,
      params,
    );
    return r.rowCount;
  }

  const toPoint = (r) => {
    const v = r.values || {};
    return {
      deviceId: r.device_id,
      time: Number(r.time),
      temperature: r.temperature ?? undefined,
      humidity: r.humidity ?? undefined,
      power: r.power ?? undefined,
      ...v,
    };
  };

  /**
   * 查询历史点位。
   * @param {object} opts
   *  - deviceId 必填
   *  - from/to 时间范围（毫秒）；不传默认最近 1 小时
   *  - limit 最大点数（默认 500，上限 MAX_QUERY_POINTS）
   *  - bucketMs 可选：按时间桶降采样（例如 60000 = 每分钟取一个代表值），
   *    用于长时间跨度查询时避免返回过多点
   */
  async function queryHistory({ deviceId, from, to, limit = 500, bucketMs } = {}) {
    if (!deviceId) return [];
    const end = Number(to) || Date.now();
    const start = Number(from) || end - 60 * 60 * 1000;
    const max = Math.min(Math.max(Number(limit) || 500, 1), MAX_QUERY_POINTS);

    if (bucketMs && Number(bucketMs) > 0) {
      // 时间桶降采样：每桶取平均值
      const r = await query(
        `SELECT
           (time / $4) * $4 AS bucket,
           AVG(temperature) AS temperature,
           AVG(humidity) AS humidity,
           AVG(power) AS power,
           MIN(time) AS time
         FROM iot_points
         WHERE device_id = $1 AND time >= $2 AND time <= $3
         GROUP BY bucket
         ORDER BY bucket ASC
         LIMIT $5`,
        [deviceId, start, end, Number(bucketMs), max],
      );
      return r.rows.map((x) => ({
        deviceId,
        time: Number(x.time),
        temperature: x.temperature != null ? Number(x.temperature) : undefined,
        humidity: x.humidity != null ? Number(x.humidity) : undefined,
        power: x.power != null ? Number(x.power) : undefined,
      }));
    }

    const r = await query(
      `SELECT device_id, time, temperature, humidity, power, values
         FROM iot_points
        WHERE device_id = $1 AND time >= $2 AND time <= $3
        ORDER BY time DESC
        LIMIT $4`,
      [deviceId, start, end, max],
    );
    return r.rows.map(toPoint).reverse(); // 按时间正序返回
  }

  /** 最近 N 个点（用于启动时恢复内存缓存/实时曲线） */
  async function latest(deviceId, n = 60) {
    const r = await query(
      `SELECT device_id, time, temperature, humidity, power, values
         FROM iot_points WHERE device_id = $1 ORDER BY time DESC LIMIT $2`,
      [deviceId, Math.min(Math.max(Number(n) || 60, 1), 2000)],
    );
    return r.rows.map(toPoint).reverse();
  }

  /**
   * 导出查询：用于 CSV 导出，返回最多 maxRows 条（默认 5 万，防内存爆）。
   * 与 queryHistory 的区别：不降采样、按时间正序、上限更高。
   */
  async function exportRows({ deviceId, from, to, maxRows = 50000 } = {}) {
    const params = [];
    const conds = [];
    if (deviceId) {
      params.push(deviceId);
      conds.push(`device_id = $${params.length}`);
    }
    if (from) {
      params.push(Number(from));
      conds.push(`time >= $${params.length}`);
    }
    if (to) {
      params.push(Number(to));
      conds.push(`time <= $${params.length}`);
    }
    if (!from && !to) {
      // 未指定范围时默认最近 24 小时，避免误导出全部历史
      params.push(Date.now() - 86400000);
      conds.push(`time >= $${params.length}`);
    }
    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    params.push(Math.min(Math.max(Number(maxRows) || 50000, 1), 200000));
    const r = await query(
      `SELECT device_id, time, temperature, humidity, power, values
         FROM iot_points ${where}
        ORDER BY time ASC LIMIT $${params.length}`,
      params,
    );
    return r.rows.map(toPoint);
  }

  /** 数据量统计（运维用） */
  async function stats() {
    const r = await query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(DISTINCT device_id)::int AS devices,
        MIN(time) AS oldest,
        MAX(time) AS newest,
        pg_size_pretty(pg_total_relation_size('iot_points')) AS size
      FROM iot_points
    `);
    const row = r.rows[0];
    return {
      total: row.total,
      devices: row.devices,
      oldest: row.oldest ? Number(row.oldest) : null,
      newest: row.newest ? Number(row.newest) : null,
      size: row.size,
      retentionDays: RETENTION_DAYS,
    };
  }

  function getRetentionDays() {
    return RETENTION_DAYS;
}

  function setRetentionDays(days) {
    const n = Number(days);
    if (!Number.isFinite(n) || n < 1 || n > 3650) return { ok: false, error: "留存天数需在 1-3650 之间" };
    RETENTION_DAYS = Math.floor(n);
    return { ok: true, retentionDays: RETENTION_DAYS };
  }

  /** 删除超过留存期的点位 */
  async function prune(days = RETENTION_DAYS) {
    const cutoff = Date.now() - days * 86400000;
    const r = await query("DELETE FROM iot_points WHERE time < $1", [cutoff]);
    return r.rowCount;
  }

  return { insertMany, queryHistory, latest, exportRows, stats, prune, getRetentionDays, setRetentionDays };
}

export { RETENTION_DAYS, MAX_QUERY_POINTS };
