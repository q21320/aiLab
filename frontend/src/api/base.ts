// ============================================================================
// API 基地址解析
//
// 默认：同源 /api，由 Vite dev/preview 代理转发到后端（见 vite.config.ts）。
// 静态托管（nginx / 对象存储 / 纯 dist）时没有代理，可两种方式二选一：
//   1) 构建时指定后端地址：VITE_API_BASE=http://192.168.1.10:3800 npm run build
//   2) 用 nginx 把 /api 反向代理到后端（推荐，见 README「部署与代理」）
// 后端已开启 CORS，直连跨域可用。
// ============================================================================

export const API_BASE = String((import.meta.env.VITE_API_BASE as string | undefined) || "").replace(/\/+$/, "");

/** 拼接完整接口地址 */
export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE}${path}`;
}

/** 是否配置了独立后端地址（用于界面提示） */
export const HAS_REMOTE_API = API_BASE.length > 0;
