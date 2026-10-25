// ============================================================================
// 生成实验室台账「导入模板」CSV 文件（8 个模块一份）
//
// 用法：
//   node tools/gen-templates.mjs
//   node tools/gen-templates.mjs --out=docs/导入模板
//
// 为什么要脚本生成：模板的唯一真相源是 frontend/src/views/lab/resources.ts 的字段定义，
// 手抄一份 CSV 到仓库里，改字段时必然忘记同步。本脚本用 esbuild 把 TS 定义打包后
// 直接调用页面同一个 buildTemplateCsv()，两边规则永远一致。
// 页面上的「下载模板」按钮是同一函数现生成，本产物仅供分发/留档，重新生成即可。
// ============================================================================

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BACKEND = join(ROOT, "backend");
const LAB_DIR = join(ROOT, "frontend", "src", "views", "lab");

const outArg = process.argv.slice(2).find((a) => a.startsWith("--out="));
const OUT_DIR = outArg ? join(ROOT, outArg.split("=")[1]) : join(ROOT, "docs", "导入模板");

// esbuild 装在 backend/devDependencies，脚本本身不在依赖目录 → 显式指定解析起点
const esbuild = createRequire(join(BACKEND, "package.json"))("esbuild");

const GLUE = `
import { LAB_RESOURCES } from "./resources";
import { buildTemplateCsv, templateFileName } from "./labImport";
export function templates() {
  return Object.values(LAB_RESOURCES).map((def) => ({
    title: def.title,
    file: templateFileName(def),
    text: buildTemplateCsv(def),
  }));
}
`;

const result = await esbuild.build({
  stdin: { contents: GLUE, resolveDir: LAB_DIR, loader: "ts", sourcefile: "gen-glue.ts" },
  bundle: true,
  format: "esm",
  platform: "neutral",
  // 前端源码里的 import.meta.env 只在 Vite 下存在；这里只为加载模块，不会发请求
  define: { "import.meta.env": "{}" },
  write: false,
  logLevel: "warning",
});

const bundlePath = join(tmpdir(), `ailab-gen-templates-${process.pid}.mjs`);
writeFileSync(bundlePath, result.outputFiles[0].text);
const mod = await import(pathToFileURL(bundlePath).href);

const items = mod.templates();
if (!items.length) {
  console.error("没有生成任何模板，请检查 resources.ts 的 LAB_RESOURCES");
  process.exit(1);
}
mkdirSync(OUT_DIR, { recursive: true });
for (const it of items) {
  writeFileSync(join(OUT_DIR, it.file), it.text, "utf8");
  console.log(`  ✓ ${it.file}（${it.text.split("\r\n").length - 1} 行）`);
}
console.log(`\n已输出 ${items.length} 份模板到 ${OUT_DIR}`);
