#!/bin/bash
# ============================================================================
# AI Lab 平台 · PostgreSQL 初始化脚本
#
# 作用：创建数据库与用户（幂等），供后端连接使用。
# 用法：
#   ./tools/init-db.sh                     # 使用默认值
#   DB_NAME=ailab DB_USER=ailab ./tools/init-db.sh
#
# 前置：PostgreSQL 已启动，且当前用户能以超级用户身份连接（或设置 PGPASSWORD）。
# ============================================================================
set -euo pipefail

DB_NAME="${DB_NAME:-ailab}"
DB_USER="${DB_USER:-ailab}"
DB_PASS="${DB_PASS:-ailab_dev_pwd}"
PG_SUPER="${PG_SUPER:-postgres}"
PG_HOST="${PGHOST:-127.0.0.1}"
PG_PORT="${PGPORT:-5432}"

# 查找 psql：优先 PATH，其次 Postgres.app 的常见位置
find_psql() {
  if command -v psql >/dev/null 2>&1; then
    command -v psql
    return
  fi
  for p in \
    "/Applications/Postgres.app/Contents/Versions/latest/bin/psql" \
    "/Applications/Postgres.app/Contents/Versions/17/bin/psql" \
    "/opt/homebrew/bin/psql" \
    "/usr/local/bin/psql"; do
    if [ -x "$p" ]; then
      echo "$p"
      return
    fi
  done
  return 1
}

if ! PSQL="$(find_psql)"; then
  echo "❌ 未找到 psql。请先安装 PostgreSQL：" >&2
  echo "   · 下载 Postgres.app：https://postgresapp.com" >&2
  echo "   · 或 brew install postgresql@17" >&2
  exit 1
fi

echo "使用 psql: $PSQL"
echo "目标：$PG_HOST:$PG_PORT  数据库=$DB_NAME  用户=$DB_USER"

# 检查连通性（超级用户连接 maintenance 库）
if ! "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
  echo "❌ 无法以 '$PG_SUPER' 连接 $PG_HOST:$PG_PORT" >&2
  echo "   请确认 PostgreSQL 已启动，必要时设置 PGPASSWORD 或 PG_SUPER。" >&2
  exit 1
fi

# 创建角色（已存在则跳过）
"$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${DB_USER}') THEN
    CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASS}';
    RAISE NOTICE '已创建角色 ${DB_USER}';
  ELSE
    RAISE NOTICE '角色 ${DB_USER} 已存在，跳过';
  END IF;
END
\$\$;
SQL

# 创建数据库（已存在则跳过）
if ! "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER" -d postgres -tAc \
  "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  "$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER" -d postgres -v ON_ERROR_STOP=1 \
    -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}"
  echo "✅ 已创建数据库 ${DB_NAME}"
else
  echo "ℹ️  数据库 ${DB_NAME} 已存在，跳过"
fi

# 授权（确保属主与 schema 权限）
"$PSQL" -h "$PG_HOST" -p "$PG_PORT" -U "$PG_SUPER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
GRANT ALL ON SCHEMA public TO ${DB_USER};
ALTER DATABASE ${DB_NAME} OWNER TO ${DB_USER};
SQL

echo
echo "✅ 初始化完成，请把以下内容写入 backend/.env："
echo "DATABASE_URL=postgres://${DB_USER}:${DB_PASS}@${PG_HOST}:${PG_PORT}/${DB_NAME}"
echo
echo "然后启动后端：cd backend && npm start"
