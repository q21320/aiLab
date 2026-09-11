// ============================================================================
// 构建后同步：把 frontend/dist 复制到 backend/public
//
// 目的：让「源码模式单机运行」也能直接出页面（npm start → http://localhost:3800），
//       与打包 exe 的行为一致；开发联调仍用 npm run dev（5173，带 /api 代理）。
// 由 frontend/package.json 的 postbuild 自动触发。
// ============================================================================

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "frontend", "dist");
const publicDir = join(root, "backend", "public");

if (!existsSync(dist)) {
  console.error("[copy-dist] 未找到 frontend/dist，请先执行前端构建");
  process.exit(1);
}
rmSync(publicDir, { recursive: true, force: true });
mkdirSync(publicDir, { recursive: true });
cpSync(dist, publicDir, { recursive: true });
console.log(`[copy-dist] 已同步前端构建产物 → backend/public（${publicDir}）`);
console.log("[copy-dist] 现在可直接: cd backend && npm start  然后访问 http://localhost:3800");
