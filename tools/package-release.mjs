// ============================================================================
// 生成「分发包」：把 exe 与说明打包成 zip，并输出校验值与分发说明
//
// 用法：node tools/package-release.mjs
// 产物（release/ 目录）：
//   AILab-实验室数字化管理平台-便携版.zip   ← 发给别人的文件（不含运行数据）
//   SHA256.txt                              ← 校验值，收件人可核对完整性
//   分发说明.txt                             ← 给发送者看的发送方式与注意事项
// ============================================================================

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { networkInterfaces } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = join(ROOT, "release");
const APP_NAME = process.argv.find((a) => a.startsWith("--name="))?.split("=")[1] || "AILab-实验室数字化管理平台";
const EXE = join(RELEASE, `${APP_NAME}.exe`);
const ZIP = join(RELEASE, `${APP_NAME}-便携版.zip`);
const STAGE = join(RELEASE, "_pack");

if (!existsSync(EXE)) {
  console.error(`未找到 ${relative(ROOT, EXE)}，请先执行：cd backend && npm run build:exe`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1) 暂存目录（只放必要文件，不含 data/ 运行数据）
// ---------------------------------------------------------------------------
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
const FILES = [`${APP_NAME}.exe`, "使用说明.txt", "运行诊断.bat", "启动平台(可选端口).bat"];
for (const f of FILES) {
  const src = join(RELEASE, f);
  if (existsSync(src)) copyFileSync(src, join(STAGE, f));
  else console.warn(`[package] 跳过缺失文件：${f}`);
}

// 首次运行自动创建的 data 目录说明（避免收件人以为少了东西）
writeFileSync(
  join(STAGE, "首次运行说明.txt"),
  [
    "本压缩包只包含程序本体，不含任何运行数据。",
    "首次双击 exe 后，会在同目录自动创建 data\\ 文件夹（应用、设备、表单、日志、备份）。",
    "如需带走自己环境的数据，把整个 data\\ 目录一起复制过去即可。",
    "",
  ].join("\r\n"),
  "utf-8"
);

// ---------------------------------------------------------------------------
// 2) 打 zip（Windows 用 PowerShell Compress-Archive，其它平台用 zip）
// ---------------------------------------------------------------------------
rmSync(ZIP, { force: true });
console.log("[package] 正在打包 zip…");
let packed = false;
if (process.platform === "win32") {
  const script = [
    "$ErrorActionPreference='Stop'",
    `Compress-Archive -Path '${join(STAGE, "*")}' -DestinationPath '${ZIP}' -Force`,
  ].join("; ");
  const res = spawnSync("powershell", ["-NoProfile", "-Command", script], { stdio: "inherit" });
  packed = res.status === 0 && existsSync(ZIP);
} else {
  const res = spawnSync("zip", ["-r", "-q", ZIP, "."], { cwd: STAGE, stdio: "inherit" });
  packed = res.status === 0 && existsSync(ZIP);
}
rmSync(STAGE, { recursive: true, force: true });

// ---------------------------------------------------------------------------
// 3) 校验值
// ---------------------------------------------------------------------------
function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
const exeHash = sha256(EXE);
const zipHash = packed ? sha256(ZIP) : "";
const sizeMB = (f) => (statSync(f).size / 1024 / 1024).toFixed(1);
writeFileSync(
  join(RELEASE, "SHA256.txt"),
  [
    `# AI Lab 实验室数字化管理平台 · 校验值（SHA256）`,
    `# 生成时间：${new Date().toLocaleString("zh-CN")}`,
    ``,
    `${exeHash}  ${APP_NAME}.exe  (${sizeMB(EXE)} MB)`,
    packed ? `${zipHash}  ${APP_NAME}-便携版.zip  (${sizeMB(ZIP)} MB)` : `（未生成 zip）`,
    ``,
    `# 收件人可在 PowerShell 中执行以下命令核对：`,
    `#   Get-FileHash .\\${APP_NAME}-便携版.zip -Algorithm SHA256`,
    ``,
  ].join("\r\n"),
  "utf-8"
);

// ---------------------------------------------------------------------------
// 4) 分发说明
// ---------------------------------------------------------------------------
const lanIPs = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === "IPv4" && !i.internal)
  .map((i) => i.address);

writeFileSync(
  join(RELEASE, "分发说明.txt"),
  [
    "AI Lab 实验室数字化管理平台 · 分发说明（给发送者看）",
    "==================================================",
    "",
    `【要发送的文件】${APP_NAME}-便携版.zip（${packed ? sizeMB(ZIP) + " MB" : "未生成"}）`,
    "  压缩包内含：exe 主程序 + 使用说明.txt + 运行诊断.bat + 启动平台(可选端口).bat",
    "  ⚠ 不要直接发送 data\\ 目录（那是你自己的运行数据/测试数据）",
    "",
    "【发送方式建议】",
    "  1) 企业微信 / 钉钉 / 飞书 直接发 zip（一般支持 100MB~1GB，推荐）",
    "  2) 微信发送 zip（单文件上限约 100MB；若提示风险文件，改用第 3、4 种）",
    "  3) 网盘分享链接（阿里云盘/百度网盘/OneDrive/企业微盘）—— 最稳妥",
    "  4) 同一局域网：在发送方执行 cd backend && npm run share",
    "     会输出形如 http://<本机IP>:8090 的下载地址，对方浏览器打开即可下载",
    "  5) U 盘 / 内网共享文件夹拷贝",
    "  邮箱附件通常放不下 90MB 级文件，请优先用上面方式",
    "",
    "【为什么要用 zip 而不是直接发 exe】",
    "  · 聊天工具/邮件网关常常直接拦截 .exe 单文件；zip 可正常传输",
    "  · 便于一次性带上「使用说明/诊断脚本」",
    "  · 附带 SHA256 校验值，对方可验证传输是否完整（见 SHA256.txt）",
    "",
    "【对方首次运行可能遇到的提示（属正常）】",
    "  · Windows SmartScreen「未知发布者」→ 点「更多信息 → 仍要运行」",
    "  · 个别杀毒软件对 Node SEA 生成的 exe 误报 → 将解压目录加入白名单",
    "  · 提示端口被占用不用管：程序会自动换端口（3801~3809）",
    "  · 打不开就双击「运行诊断.bat」，把窗口内容发回来即可定位",
    "",
    lanIPs.length ? `【本机局域网 IP】${lanIPs.join(" / ")}` : "【本机局域网 IP】未检测到",
    "",
  ].join("\r\n"),
  "utf-8"
);

console.log(`
==============================================================================
  分发包已生成 ✅
  发送文件：${relative(ROOT, ZIP)}${packed ? `（${sizeMB(ZIP)} MB）` : "（打包失败，可直接发 exe）"}
  校验文件：release\\SHA256.txt
  分发指引：release\\分发说明.txt
  SHASUMS
    exe : ${exeHash}${packed ? `
    zip : ${zipHash}` : ""}
==============================================================================
`);
