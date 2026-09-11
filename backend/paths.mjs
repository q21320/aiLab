// ============================================================================
// 运行时路径与参数（同时支持源码运行 / 打包 exe 运行 / 环境变量覆盖）
//
// 注意：这里刻意导出「单个对象 paths」而不是多个顶层常量 —— 打包（esbuild → CJS）
// 时顶层常量名可能被重命名，而对象属性访问不受影响，避免打包后出现
// "XXX is not defined" 之类的问题。
//
// 目录规则：
//   1) 源码运行（npm start）：基准目录 = 本文件所在目录
//   2) 打包 exe（Node SEA）：基准目录 = exe 所在目录（便携模式，数据在 exe 旁边）
//   3) 环境变量 AILAB_HOME / AILAB_DATA_DIR / AILAB_PUBLIC_DIR 可分别覆盖
// ============================================================================

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

/** 是否运行在 Node SEA 单文件可执行程序内（Node 21+ 提供 node:sea） */
const isSea = (() => {
  try {
    const nodeRequire = createRequire(process.execPath);
    const sea = nodeRequire("node:sea");
    return typeof sea?.isSea === "function" ? sea.isSea() : false;
  } catch {
    return false;
  }
})();

/** 源码模式下的模块目录（CJS 打包产物里用 __dirname） */
const moduleDir = (() => {
  try {
    if (typeof __dirname === "string" && __dirname) return __dirname;
  } catch {
    /* ESM 环境无 __dirname */
  }
  try {
    return dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
})();

const baseDir = process.env.AILAB_HOME || (isSea ? dirname(process.execPath) : moduleDir);

export const paths = {
  isSea,
  baseDir,
  dataDir: process.env.AILAB_DATA_DIR || join(baseDir, "data"),
  publicDir: process.env.AILAB_PUBLIC_DIR || join(baseDir, "public"),
  port: Number(process.env.PORT || 3800),
  /** 默认只监听本机（不触发 Windows 防火墙弹窗）；设 AILAB_HOST=0.0.0.0 可局域网访问 */
  host: process.env.AILAB_HOST || "127.0.0.1",
  autoOpen: process.env.AILAB_NO_OPEN !== "1",
};
