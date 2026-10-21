// ============================================================================
// 打包为 Windows 单文件 exe（Node SEA：前端资源内嵌 + 后端打包注入 node.exe）
//
// 用法：
//   node tools/build-exe.mjs                # 完整构建（前端 → 内嵌 → 打包 exe）
//   node tools/build-exe.mjs --skip-frontend # 复用 frontend/dist，快速重打包
//   node tools/build-exe.mjs --name=MyApp    # 自定义产物名
//
// 产物：release/AILab-实验室数字化管理平台.exe（约 100MB，含 Node 运行时）
//       双击即启动本地服务并自动打开浏览器；数据保存在 exe 同级的 data 目录
// ============================================================================

import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FRONTEND = join(ROOT, "frontend");
const BACKEND = join(ROOT, "backend");
const DIST = join(FRONTEND, "dist");
const BUILD = join(BACKEND, "build");
const RELEASE = join(ROOT, "release");

/**
 * 平台断言：SEA 注入的是「当前运行的这个 node 可执行文件」的副本。
 * 在 macOS/Linux 上构建只会得到一个名叫 .exe 却无法在 Windows 运行的二进制，
 * 与其产出一个"看似成功"的坏包，不如直接失败并给出明确提示。
 * 如需非 Windows 交叉构建，请用 Windows 机器或 CI（windows-latest runner）。
 */
if (process.platform !== "win32") {
  console.error(
    `\n[build-exe] 当前平台是 ${process.platform}，无法生成可运行的 Windows exe。\n` +
      `  Node SEA 的做法是把应用负载注入到「本机 node.exe」副本中，\n` +
      `  因此 exe 必须在 Windows 上构建（或使用 windows-latest 的 CI runner）。\n` +
      `  若只想验证前端构建流程，请直接运行：cd frontend && npm run build\n`,
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const skipFrontend = args.includes("--skip-frontend");
const nameArg = args.find((a) => a.startsWith("--name="));
const APP_NAME = nameArg ? nameArg.split("=")[1] : "AILab-实验室数字化管理平台";
const EXE_PATH = join(RELEASE, `${APP_NAME}.exe`);
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function log(step, msg) {
  console.log(`\n[${step}] ${msg}`);
}
function run(cmd, cmdArgs, cwd) {
  // 不经过 shell：参数（含中文名、空格、括号、&）不会被二次解析或截断，
  // 也杜绝了命令行注入。Windows 下的 .cmd/npm 需要 shell，仅在必要时启用。
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(cmd);
  const safeCmd = needsShell && /\s/.test(cmd) ? `"${cmd}"` : cmd;
  console.log(`  $ ${safeCmd} ${cmdArgs.join(" ")}`);
  const res = spawnSync(safeCmd, cmdArgs, { cwd, stdio: "inherit", shell: needsShell });
  if (res.status !== 0) throw new Error(`${cmd} 执行失败（exit ${res.status}）`);
}

// ---------------------------------------------------------------------------
// 1) 构建前端
// ---------------------------------------------------------------------------
if (!skipFrontend) {
  log("1/6", "构建前端（npm run build）");
  run("npm", ["run", "build"], FRONTEND);
} else {
  log("1/6", "跳过前端构建（--skip-frontend）");
}
if (!existsSync(join(DIST, "index.html"))) {
  throw new Error(`未找到前端构建产物：${DIST}，请先执行 npm run build（frontend）`);
}

// ---------------------------------------------------------------------------
// 2) 把 dist 资源转成 base64 内嵌模块
// ---------------------------------------------------------------------------
log("2/6", "内嵌前端资源（base64）");
mkdirSync(BUILD, { recursive: true });
const assetMap = {};
let total = 0;
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) {
      const rel = relative(DIST, full).split(sep).join("/");
      const buf = readFileSync(full);
      assetMap[rel] = buf.toString("base64");
      total += buf.length;
    }
  }
}
walk(DIST);
const generatedAssets = join(BUILD, "embedded-assets.generated.mjs");
writeFileSync(
  generatedAssets,
  `// 由 tools/build-exe.mjs 生成，请勿手工修改\nexport const assets = { embedded: ${JSON.stringify(assetMap)} };\n`,
  "utf-8"
);
console.log(`  内嵌 ${Object.keys(assetMap).length} 个文件，原始大小 ${(total / 1024 / 1024).toFixed(2)} MB`);

// ---------------------------------------------------------------------------
// 3) esbuild 打包后端为单文件 CJS（含内嵌资源）
// ---------------------------------------------------------------------------
log("3/6", "打包后端代码（esbuild → 单文件 CJS）");
const esbuildEntry = pathToFileURL(join(BACKEND, "node_modules", "esbuild", "lib", "main.js")).href;
const esbuild = await import(esbuildEntry).then((m) => m.default || m);
const outBundle = join(BUILD, "server.bundle.cjs");
await esbuild.build({
  entryPoints: [join(BACKEND, "server.mjs")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: outBundle,
  // 把 assets.mjs 替换为内嵌资源版本
  plugins: [
    {
      name: "embed-assets",
      setup(build) {
        build.onResolve({ filter: /assets\.mjs$/ }, (a) => ({ path: generatedAssets }));
      },
    },
  ],
  logOverride: { "empty-import-meta": "silent" },
  banner: { js: "// AI Lab 实验室数字化管理平台 · 打包产物" },
});
console.log(`  产物：${relative(ROOT, outBundle)}（${(statSync(outBundle).size / 1024 / 1024).toFixed(2)} MB）`);

// ---------------------------------------------------------------------------
// 4) 生成 SEA blob
// ---------------------------------------------------------------------------
log("4/6", "生成 SEA blob（node --experimental-sea-config）");
const seaConfig = join(BUILD, "sea-config.json");
const blobPath = join(BUILD, "sea-prep.blob");
writeFileSync(
  seaConfig,
  JSON.stringify(
    {
      main: relative(BUILD, outBundle).split(sep).join("/"),
      output: relative(BUILD, blobPath).split(sep).join("/"),
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
    },
    null,
    2
  ),
  "utf-8"
);
run(process.execPath, ["--experimental-sea-config", "sea-config.json"], BUILD);
if (!existsSync(blobPath)) throw new Error("SEA blob 生成失败");

// ---------------------------------------------------------------------------
// 5) 复制 node.exe 并注入 blob
// ---------------------------------------------------------------------------
log("5/6", "生成 exe 并注入应用代码");
mkdirSync(RELEASE, { recursive: true });
copyFileSync(process.execPath, EXE_PATH);
console.log(`  已复制运行时：${process.execPath} → ${relative(ROOT, EXE_PATH)}`);

const postjectBin = join(BACKEND, "node_modules", ".bin", process.platform === "win32" ? "postject.cmd" : "postject");
// postject 用法：postject <exe> NODE_SEA_BLOB <blob> --sentinel-fuse <fuse>
const postjectArgs = [EXE_PATH, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE];
if (process.platform === "darwin") postjectArgs.push("--macho-segment-name", "NODE_SEA");
if (!existsSync(postjectBin)) {
  throw new Error(`未找到 postject：${postjectBin}\n请先在 backend 目录执行 npm install（不再回退到 npx，保证构建可复现）`);
}
const inject = spawnSync(postjectBin, postjectArgs, { cwd: BACKEND, stdio: "inherit", shell: false });
if (inject.status !== 0) throw new Error("postject 注入失败");

// ---------------------------------------------------------------------------
// 6) 生成发行目录配套文件
// ---------------------------------------------------------------------------
log("6/6", "生成发行目录说明");
const readme = `AI Lab 实验室数字化管理平台 · 便携版
========================================

【启动】
双击 ${APP_NAME}.exe 即可：
  1. 自动启动本地服务（默认 http://localhost:3800，只监听本机，不触发防火墙弹窗）
  2. 自动打开浏览器；若 3800 已被占用会自动改用 3801~3809
  3. 若检测到平台已经在运行，会直接打开已有页面，不会重复启动
  4. 关闭控制台窗口即停止服务

【数据】
所有数据保存在本目录下的 data\\ 文件夹（应用、设备、表单、日志、备份、启动日志），
拷走整个文件夹即完成迁移；删除 data\\ 即恢复初始演示数据。

【登录账号】
管理员   admin / admin123
工程师   engineer / eng123
访客     viewer / view123

【环境变量（可选）】
PORT=8080            指定端口
AILAB_NO_OPEN=1      启动时不自动打开浏览器
AILAB_HOST=0.0.0.0   允许局域网访问（默认仅本机）
AILAB_HOME=D:\\data   自定义数据目录

【启动失败怎么办】
1. 双击「运行诊断.bat」，它会启动平台并输出健康检查、端口占用与启动日志
2. 查看 data\\startup.log（记录了每次启动的端口、目录与错误原因）
3. 若提示"未知发布者"（SmartScreen）：点「更多信息 → 仍要运行」
4. 若被杀毒软件拦截/删除：将本目录加入白名单后重新解压/复制
5. 若被防火墙拦截：本平台默认只监听 127.0.0.1，无需放行

【接口自检】
浏览器访问 http://localhost:3800/api/health
`;
writeFileSync(join(RELEASE, "使用说明.txt"), readme, "utf-8");
writeFileSync(
  join(RELEASE, "启动平台(可选端口).bat"),
  `@echo off\r\nchcp 65001 >nul\r\nset PORT=8080\r\nstart "" "%~dp0${APP_NAME}.exe"\r\n`,
  "utf-8"
);
writeFileSync(
  join(RELEASE, "运行诊断.bat"),
  `@echo off\r\nchcp 65001 >nul\r\ncd /d "%~dp0"\r\necho ============================================\r\necho   AI Lab 平台运行诊断\r\necho ============================================\r\necho.\r\necho [1/4] 启动平台（不自动打开浏览器）...\r\nset AILAB_NO_OPEN=1\r\nstart "" "${APP_NAME}.exe"\r\ntimeout /t 5 >nul\r\necho.\r\necho [2/4] 健康检查（预期返回 ok:true）...\r\ncurl -s http://localhost:3800/api/health\r\necho.\r\necho.\r\necho [3/4] 端口占用情况（预期能看到本进程监听 3800）...\r\nnetstat -ano | findstr :3800\r\necho.\r\necho [4/4] 启动日志（data\\startup.log 最后 20 行）...\r\nif exist data\\startup.log (powershell -NoProfile -Command "Get-Content -Tail 20 data\\startup.log") else (echo   暂无日志文件)\r\necho.\r\necho 若健康检查未通过，请把本窗口内容截图反馈。\r\npause\r\n`,
  "utf-8"
);

console.log(`
==============================================================================
  打包完成 ✅
  可执行文件：${relative(ROOT, EXE_PATH)}
  文件大小：${(statSync(EXE_PATH).size / 1024 / 1024).toFixed(1)} MB
  发行目录：${relative(ROOT, RELEASE)}（含 使用说明.txt 与 启动平台(可选端口).bat）
  试运行：直接双击该 exe，或执行 "${relative(ROOT, EXE_PATH)}"
==============================================================================
`);
