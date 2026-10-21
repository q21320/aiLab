# ============================================================================
# AI Lab 平台 · 单容器镜像（前端静态资源 + 零依赖 Node 后端 + PostgreSQL 驱动）
#
# 说明：后端只连外部数据库，不内嵌 PostgreSQL 进程。
# 数据库由 docker-compose.yml 中的 postgres 服务提供。
# ============================================================================
FROM node:22-alpine AS base
WORKDIR /app

# ---------------------------------------------------------------------------
# 1) 构建前端（Vue + Vite）
# ---------------------------------------------------------------------------
FROM base AS frontend-build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci --no-audit --no-fund
COPY frontend/ ./frontend/
# --ignore-scripts：跳过 postbuild 的 copy-dist.mjs（它面向源码目录布局，
# 容器内产物由下方 COPY --from 直接取 dist，不走该脚本）
RUN cd frontend && npm run build --ignore-scripts

# ---------------------------------------------------------------------------
# 2) 运行镜像
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production \
    PORT=3800 \
    AILAB_HOST=0.0.0.0 \
    AILAB_NO_OPEN=1

# 后端依赖（pg 驱动）
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev --no-audit --no-fund

# 后端源码（不带 data/ 与 .env：数据在数据库里，密钥走环境变量）
COPY backend/*.mjs ./backend/
COPY backend/iot/ ./backend/iot/
COPY backend/public/ ./backend/public/

# 前端构建产物
COPY --from=frontend-build /app/frontend/dist/ ./backend/public/

# 非 root 运行
RUN addgroup -S ailab && adduser -S ailab -G ailab && chown -R ailab:ailab /app
USER ailab

EXPOSE 3800

# 健康检查：/api/health 是公开接口
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3800)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/server.mjs"]
