// ============================================================================
// PostgreSQL 数据层（全量迁移：用户 / 会话 / 审计 / 应用 / 设备 / 表单 / CRUD）
//
// 设计要点：
//   1) **行为兼容**：上层模块（server.mjs、audit.mjs、crud.mjs…）原本面向
//      「整份 JSON 读入读出」的内存模型。为了不改动它们的业务逻辑，
//      这里提供 document 语义的 KV 表（key TEXT PRIMARY KEY, doc JSONB），
//      读写接口与原来的 readJson/writeJson 一一对应，但底层是事务化的数据库；
//   2) **强一致**：writeJson 走 UPSERT + JSONB，不再有"写一半断电"的问题，
//      并发写入也不会互相覆盖整份文件；
//   3) **结构化表**：用户、会话、审计日志、CRUD 数据行另有独立表，
//      支持索引、分页与并发（这是换数据库最核心的收益）；
//   4) **保留 JSON 兜底**：db.mjs 内部若数据库不可用会在启动期直接失败，
//      不会静默退化成文件存储（避免"以为在用数据库其实没连上"）。
//
// 连接配置（环境变量，或 backend/.env）：
//   DATABASE_URL=postgres://user:pass@127.0.0.1:5432/ailab
//   或分别指定 PGHOST / PGPORT / PGUSER / PGPASSWORD / PGDATABASE
// ============================================================================

import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const { Pool } = pg;

/** 读取一个 dotenv 文件，返回键值（环境变量优先，不被覆盖） */
function readEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  try {
    for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i < 0) continue;
      const k = t.slice(0, i).trim();
      let v = t.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k && process.env[k] === undefined) out[k] = v;
    }
  } catch {
    /* 读取失败按未配置处理 */
  }
  return out;
}

/**
 * 解析数据库连接配置。
 * dataDir 是数据目录（backend/data），dotenv 依次查找 backend/data/.env 与 backend/.env。
 */
export function resolveDbConfig(dataDir) {
  const dotenv = {
    ...readEnvFile(join(dataDir, "..", ".env")),
    ...readEnvFile(join(dataDir, ".env")),
  };
  const pick = (k, fallback) => process.env[k] ?? dotenv[k] ?? fallback;

  const url = pick("DATABASE_URL", "");
  if (url) {
    return { connectionString: url, ssl: pick("PGSSL", "") === "1" ? { rejectUnauthorized: false } : undefined };
  }
  return {
    host: pick("PGHOST", "127.0.0.1"),
    port: Number(pick("PGPORT", "5432")),
    user: pick("PGUSER", "postgres"),
    password: pick("PGPASSWORD", "postgres"),
    database: pick("PGDATABASE", "ailab"),
    ssl: pick("PGSSL", "") === "1" ? { rejectUnauthorized: false } : undefined,
  };
}

/** 建表语句（幂等，可重复执行） */
const SCHEMA_SQL = `
-- 文档型存储：承载 iot.json / crud 元数据 / autotest.json / apps 等原有 JSON 结构
CREATE TABLE IF NOT EXISTS kv_documents (
  key         TEXT PRIMARY KEY,
  doc         JSONB NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 用户（原 users.json）
CREATE TABLE IF NOT EXISTS users (
  username    TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  pass_hash   TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 会话（原 sessions.json）：按 expires_at 建索引，便于清理过期会话
CREATE TABLE IF NOT EXISTS sessions (
  token       TEXT PRIMARY KEY,
  username    TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  expires_at  BIGINT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(username);

-- 低代码应用（原 apps.json）
CREATE TABLE IF NOT EXISTS apps (
  kind         TEXT NOT NULL,
  id           TEXT NOT NULL,
  name         TEXT NOT NULL,
  schema       JSONB NOT NULL,
  enable       BOOLEAN NOT NULL DEFAULT true,
  menu         BOOLEAN NOT NULL DEFAULT false,
  published_at BIGINT,
  updated_at   BIGINT,
  PRIMARY KEY (kind, id)
);

-- 表单提交（原 form-submissions.json）
CREATE TABLE IF NOT EXISTS form_submissions (
  id           TEXT PRIMARY KEY,
  form_id      TEXT NOT NULL,
  form_name    TEXT,
  data         JSONB NOT NULL,
  submitted_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_form_sub_form ON form_submissions(form_id, submitted_at DESC);

-- 通用 CRUD 数据行（原 crud.json 的 rows）
CREATE TABLE IF NOT EXISTS crud_resources (
  resource    TEXT PRIMARY KEY,
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS crud_rows (
  resource    TEXT NOT NULL REFERENCES crud_resources(resource) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  data        JSONB NOT NULL,
  updated_at  BIGINT NOT NULL,
  -- 行在台账中的显示顺序（内存模型 rows 的下标）；不存位置则重启前后顺序会不一致
  seq         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (resource, id)
);
CREATE INDEX IF NOT EXISTS idx_crud_rows_res ON crud_rows(resource, updated_at DESC);
-- 注：(resource, seq) 索引建在 MIGRATION_SQL 里——老表补齐 seq 列后才能建，否则 SCHEMA 阶段报列不存在

-- 物联网告警（原 iotState.alerts 内存数组，上限 100 条且静默丢弃）
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

-- 采集点位数据（原 histories 内存环形缓冲，200 点上限、重启即丢失）
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

-- 审计日志（原 audit-YYYY-MM.jsonl）：按月分区思想用 time 索引 + 分页查询
CREATE TABLE IF NOT EXISTS audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  time        BIGINT NOT NULL,
  username    TEXT,
  role        TEXT,
  module      TEXT,
  action      TEXT,
  detail      TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_logs(time DESC);
CREATE INDEX IF NOT EXISTS idx_audit_module ON audit_logs(module);

-- 台账附件（项目「委外测试」「测试结果」等 file 字段上传的文件）
-- 二进制存库而不是落磁盘：容器重建/镜像升级不会丢附件，且随 pgdata 卷一起备份，
-- 与「业务数据都在 PostgreSQL 里」的既有约定保持一致。
CREATE TABLE IF NOT EXISTS attachments (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL DEFAULT 'application/octet-stream',
  size        BIGINT NOT NULL,
  resource    TEXT,
  data        BYTEA NOT NULL,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attachments_resource ON attachments(resource);

-- 角色（RBAC）：名称 + 页面权限映射；内置三角色同样落表，用户可自由新增角色
CREATE TABLE IF NOT EXISTS roles (
  key         TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  builtin     BOOLEAN NOT NULL DEFAULT false,
  pages       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** 启动迁移（幂等）：处理老库的结构变更 */
const MIGRATION_SQL = [
  // 角色改为可扩展：放开早期写死的三值 CHECK，允许自定义角色 key
  "ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check",
  // 老库补行顺序列：存量行 seq 均为 0，读取时按 updated_at 倒序兜底（新→旧），
  // 下一次写入即由 persist() 按内存顺序回写真实 seq
  "ALTER TABLE crud_rows ADD COLUMN IF NOT EXISTS seq INTEGER NOT NULL DEFAULT 0",
  "CREATE INDEX IF NOT EXISTS idx_crud_rows_res_seq ON crud_rows(resource, seq)",
];

/**
 * 创建数据库门面。返回对象的方法签名与原 readJson/writeJson 兼容，
 * 便于 server.mjs 等模块以最小改动切换。
 */
export async function createDatabase({ dataDir, log = console.log }) {
  const config = resolveDbConfig(dataDir);
  const pool = new Pool({ ...config, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 8_000 });

  // 连接池错误不应让进程崩溃（空闲连接断开会触发 'error'）
  pool.on("error", (err) => console.error("[db] 连接池错误：", err.message));

  // 启动自检：连不上直接抛错，绝不静默降级为文件存储
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    await client.query(SCHEMA_SQL);
    for (const sql of MIGRATION_SQL) await client.query(sql);
  } finally {
    client.release();
  }
  const target = config.connectionString
    ? config.connectionString.replace(/:\/\/([^:]+):[^@]*@/, "://$1:***@")
    : `${config.host}:${config.port}/${config.database}`;
  log(`[db] 已连接 PostgreSQL：${target}`);

  /** 单条语句查询 */
  const query = (text, params) => pool.query(text, params);

  /** 事务：fn 收到 client，抛错自动回滚 */
  async function transaction(fn) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const result = await fn(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      try {
        await c.query("ROLLBACK");
      } catch {
        /* 回滚失败忽略 */
      }
      throw e;
    } finally {
      c.release();
    }
  }

  // -------------------------------------------------------------------------
  // 文档存储：与原 readJson/writeJson 语义一致
  // -------------------------------------------------------------------------
  async function readDoc(key, fallback) {
    try {
      const r = await query("SELECT doc FROM kv_documents WHERE key = $1", [key]);
      if (r.rowCount === 0) return fallback;
      return r.rows[0].doc ?? fallback;
    } catch (e) {
      console.error(`[db] 读取 ${key} 失败：`, e.message);
      return fallback;
    }
  }

  /** 原子 UPSERT；失败抛错（与原 writeJson 行为一致，由调用方决定是否吞掉） */
  async function writeDoc(key, doc) {
    await query(
      `INSERT INTO kv_documents (key, doc, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`,
      [key, JSON.stringify(doc)],
    );
  }

  async function writeDocQuiet(key, doc) {
    try {
      await writeDoc(key, doc);
    } catch (e) {
      console.error(`[db] 写入 ${key} 失败：`, e.message);
    }
  }

  /** 列出所有文档的 key（迁移/备份用） */
  async function listDocKeys(prefix = "") {
    const r = await query("SELECT key FROM kv_documents WHERE key LIKE $1 ORDER BY key", [`${prefix}%`]);
    return r.rows.map((x) => x.key);
  }

  async function close() {
    await pool.end();
  }

  return {
    pool,
    query,
    transaction,
    readDoc,
    writeDoc,
    writeDocQuiet,
    listDocKeys,
    close,
    config,
  };
}
