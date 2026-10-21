# AI Lab 平台 — 全模块代码复查报告

复查范围：`frontend/src` + `backend` + `tools` 全部 18k 行代码（99 个源文件），按 11 个模块分组独立审查，
并对标 README 中的 4.1–4.10 招标需求逐项核对。**本报告为只读复查，未修改任何源码。**

> 说明：严重度 P0 = 功能错误 / 安全漏洞 / 数据丢失风险；P1 = 正确性隐患 / 维护性 / 性能；
> P2 = 风格与体验优化。「已核实」表示已直接读源码确认；「待验证」表示静态分析得出、需运行验证。

## 一、总体结论

**架构与可演示性很好，但「对标招标要求」的安全、持久化、真实设备联动三块存在实质性缺口。**

| 维度 | 评价 |
| --- | --- |
| 架构分层 | ★★★★☆ 后端工厂函数 + 依赖注入（crud/forms/audit/iot 各自导出 handler），前端 schema 驱动 + 渲染/导出分支三件套，扩展点清晰 |
| 功能覆盖度 | ★★★★☆ 五大能力（低代码/大屏/排产/样品/IoT）全部可跑通，设计器功能丰富 |
| 代码质量 | ★★★☆☆ 无 lint / 无测试 / 无 CI；`server.mjs` 774 行职责过多；多处重复实现 |
| 安全（4.9） | ★★☆☆☆ **后端零鉴权** + 前端自造 token；API Key 硬编码进前端包；任意 CSS 注入 |
| 数据可靠性（4.8） | ★★☆☆☆ 非原子写盘、内存序号刷新即重号、导出截断静默丢数据、备份清理逻辑反向 |
| 真实设备（4.6） | ★★☆☆☆ 驱动层写得不错，但真实读数不回写设备状态、不触发告警 |
| 工程化 | ★☆☆☆☆ 构建产物入库、无测试、无 ESLint、无 CI |

**一句话**：作为招标演示 Demo 完全够用；作为可交付、可运维、可审计的生产系统，**必须先修「安全 + 数据一致性」两类问题**，其余按优先级排期。

---

## 二、P0 问题（上线前必须修，共 16 项）

### A. 安全（4.9「三级权限、密码散列」目前不构成安全边界）

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| A1 | **后端无任何鉴权** | `backend/*.mjs`（grep `auth/session/token` 全无命中） | 登录只在前端跑 SHA-256 比对，后端所有接口（包括 `/api/iot/write` 下发设备控制量、`DELETE /api/audit/logs?all=1` 清空 3 年审计、`/api/backup/restore` 全量覆盖数据）对任何能访问端口的人敞开 |
| A2 | **前端自造 token，角色存 localStorage** | `frontend/src/stores/user.ts:42-47` | `token = "token-" + Date.now() + random`，控制台改 `localStorage.role` 即变管理员；CORS 为 `*`（`server.mjs:346-349`），任意网页可跨域调用 |
| A3 | **阿里云 DashScope API Key 硬编码在前端源码** | `frontend/src/lowcode/generator.ts:9` | `sk-ws-H.ERLDRYH...` 会打进生产 bundle，任何人可提取盗用并产生费用。**建议立即在控制台吊销并轮换**，改为后端代理 + 环境变量 |
| A4 | **用户/AI 生成的任意 CSS 直通运行页** | `SchemaRenderer.vue:123`、`PropPanel.vue:394` | `style: props.node.style \|\| {}` 无过滤，`background:url(...)` / `position:fixed` / `z-index` 可用于钓鱼与覆盖全站；AI 生成的 schema 属不可信输入。需白名单清洗 |

### B. 数据丢失 / 数据一致性

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| B1 | **排产/样品 ID 序号是内存变量，刷新后必重号** | `production.ts:87`、`samples.ts:56`（`let seq = 100`） | 刷新页面后新建订单仍是 `PO-101`，与历史订单主键冲突；`workOrders.filter(orderId)` 混单，`removeOrder` 误删他人工单。**不是概率问题，是必现** |
| B2 | **审计日志跨月查询漏掉整月** | `backend/audit.mjs:34-44` + `:73` | `monthsInRange` 把 `to` 对齐到**月初**，`to` 所在月份的文件永远不被读取 → 查询/导出/统计全部少数据 |
| B3 | **备份保留策略写反了** | `server.mjs:575-576` | `files[0]` 按字典序取（非最旧），`writeFileSync(files[0], "")` 把**既有快照清空**而不是删除新快照；且"最多 20 个"实际从不生效 |
| B4 | **所有 JSON 落盘非原子** | `backend/*.mjs` 的 `writeFileSync` | 断电/崩溃留下截断文件，下次启动 `readJson` 回退演示数据，`iot.json` 全部告警被种子覆盖。应改 `tmp + renameSync` |
| B5 | **表单提交上限 2000 条静默截断** | `backend/forms.mjs:81-83` | `submissions.length = 2000` 直接丢弃最旧记录，无归档无提示，与「数据持久化」要求冲突 |
| B6 | **大屏设计器「示例」按固定 id 覆盖已发布应用** | `ScreenDesigner.vue:167-170`、`:310`、`:318` | `mousedown` 即置顶并触发 deep watch 保存；`resetExample` 整份替换 schema 但 id 相同 → 800ms 后自动存入 store → 发布按 id 幂等覆盖 → 线上应用被示例覆盖 |
| B7 | **「重新设计」不带 id，编辑的是内置示例** | `views/apps/index.vue:49-51`、`store.ts:111-120` | 点报表/大屏应用的「重新设计」永远打开示例稿，改完发布会覆盖线上应用 |

### C. 功能正确性

| # | 问题 | 位置 | 说明 |
| --- | --- | --- | --- |
| C1 | **甘特排产拖拽位置偏移**（约 1.5 倍，非固定 9 小时） | `GanttBoard.vue:79`、`:116` | `toCanvas()` 已换算到 viewBox 坐标（`x = px × TOTAL_W/rect.width`），`onBarMouseUp` 又把它当像素除以 `PPH`，单位混用；纵向缩放、横向未缩放。<br>**修正子代理结论**：「偏移 9 小时」不准确，实际是缩放倍数误差（容器宽 ≈1000 时约 1.5 倍）。另 `production.ts:263` 按 30 分钟吸附，与整点渲染粒度不一致 |
| C2 | **真实设备读数从不回写，告警链路断开** | `backend/iot/api.mjs:100-104`、`server.mjs:278`、`:248` | SCPI/Modbus/HTTP 设备读到的值只进 `lastRead`，大屏/历史曲线永远是 `baseTemp` 静态值；`checkAlerts` 只被模拟 tick 调用，真实设备超限永不告警 |
| C3 | **样品状态机无守卫** | `samples.ts:144/152/159/167`、`autotest/index.vue:88` | 已出库/已报废样品可被自动测试改回「测试中」并写入合格结论；出库、报废可重复执行 |
| C4 | **`handle` 无 try/catch，畸形 URL 打崩/挂死请求** | `server.mjs:409` 等 8 处 `decodeURIComponent` | `GET /api/crud/x/%E0%A4%A` 抛 `URIError` → 未处理拒绝 |
| C5 | **登录页默认填错密码** | `views/login/index.vue:15-18` | 预填 `admin / 123456`，实际口令 `admin123` → 开箱即报「用户名或密码错误」 |

---

## 三、P1 问题（按模块，共 40+ 项，摘要）

### 后端（`server.mjs` 774 行）
- 设备 PUT 白名单缺 `protocol/address/points/baseTemp`，无法编辑真实设备参数；写入失败仍返回 200
- `writeJson` 失败被吞掉，路由无 500
- 告警去重按 `deviceId + status=open`，同类告警会永久压制同设备后续**更高级别**告警；前端无 ack 入口
- 删除设备不停止其采集任务，SSE 继续推送已删设备数据
- 任意 `GET /api/crud/:resource` 会凭空创建资源并落盘（含 `__proto__` 原型键）
- CSV 导出未防公式注入（`=HYPERLINK(...)`），`audit` 只转义了 `detail` 一个字段
- 静态文件服务 `join(publicDir, rel)` 无 `..` 过滤，存在路径穿越隐患
- 审计查询每次全量同步读取 36 个月 JSONL 并全量排序，几十万条时阻塞事件循环（SSE/IoT 一并卡顿）
- `RETENTION_MONTHS=36` 只在 stats 展示，**没有任何代码真正执行留存清理**
- 虚拟仪器 `listen` 无 `error` 监听，端口被占时请求永久挂起；停止后 `tickTimer` 不清除
- Modbus float32 写入忽略 `order`（CD 字节序设备写错值）；判定阈值 `null` 时 `actual <= null` 判为合格

### 前端核心
- 审计离线缓冲 `flush` 清空整批，等待期间新日志被一并清掉（丢日志）
- 路由守卫不带 `redirect`，登录后永远回仪表盘
- 菜单 `roles` 与路由 `meta.roles` 是两份独立数据，可配置出「可见但被踢回」
- `index.html` 标题仍是 `Vue 3 + TypeScript`，与平台名不一致
- `main.ts` 全量注册 Element Plus 图标（约 1MB+ 未压缩）

### 低代码设计器
- 页面设计器历史栈语义错位（快照在操作前采集，撤销落后一步）
- 拖拽 drop 读取全局 `dragState.parentId`，经过子容器时落错父级
- `insertAt`/`moveNode` 不校验 `canChildren`（`registry.canChildren` 是死配置）
- 表单预览「提交模拟」实际真实入库，可连点重复提交污染数据
- 表单字段名可空/重名/含 `-` `.`，导致必填校验失效、导出 Vue 编译报错
- 流程仿真只走第一条出边，分支语义不参与；`end` 允许多条出边
- 报表数字列用 `el-input` 写入字符串，`Number("12,000")` → 0 静默归零
- 导出 Vue 的 `esc` 只转义双引号，`<` `&` 会破坏模板
- 自动保存 `clearTimeout(saveTimer)` 缺失，KeepAlive 下旧实例回写全局工程

### 业务页面
- 排名/样品 store 之外，`schemaOps.ts:7` 与 `registry.ts:31` 各维护一份 `uid` 计数器
- 自动测试结论取当前 UI 绑定值而非服务端 run 快照，可能写到另一个样品上
- 表单数据页只加载前 200 条却显示「共 N 条」，无「已加载/总数」提示
- 应用中心「停用」与运行页「不可用」判定不一致；乐观更新失败不回滚
- 菜单「新增」立即落盘，取消后留脏数据
- 低代码 `saveAll` 不管存储超限（`QuotaExceededError` 被静默吞掉）都提示「已保存全部工程」

### 工程化（最薄弱环节）
- **`.gitignore` 未忽略 `backend/public/`，41 个哈希构建产物已入库**，每次构建产生大量 diff
- **无测试、无 ESLint、无 CI**，唯一质量门禁是 `vue-tsc --noEmit`
- `tools/build-exe.mjs` 无平台断言，在 macOS 上会生成名叫 `.exe` 却跑不起来的 Mach-O
- `postject` 锁的是 `1.0.0-alpha.6`，且失败时静默回退 `npx --yes`（绕过 lockfile，供应链风险）
- `spawnSync(..., { shell: true })` 拼接含中文/空格/括号的参数会二次解析
- `vite.config.ts` 代理目标硬编码 `localhost:3800`（可能解析为 `::1`，而后端只监听 `127.0.0.1`）

---

## 四、遗留/次要问题（P2 摘要）

`crypto.ts` 的 AES 工具全项目无调用（似「安全摆件」）；`AppRuntime` 在大屏 `screenScale` 直接读 `window.innerWidth` 无 resize 监听；
大屏组件面板的 `icon` 用字符串但未全局注册对应图标；图表 deep watch 每次 IoT 推送（2s）全量 `setOption(..., true)` 重建；
`CrudTable` 不检查 `res.ok`、无请求序号防竞态；`el-input`/`min-width="120"` 静态属性传字符串等细节。

---

## 五、与招标需求对照的差距

| 需求 | 当前状态 | 差距 |
| --- | --- | --- |
| 4.9 安全（三级权限） | 前端路由 + 菜单双控，**后端无校验** | 必须补后端会话鉴权，否则「权限」只是 UI 装饰 |
| 4.9 安全（密码散列） | SHA-256 在前端执行，散列常量硬编码 | 需迁至后端；`utils/crypto.ts` 未使用 |
| 4.9 操作日志（留存 36 个月） | 按月 JSONL ✓、分页 ✓、CSV ✓ | 跨月查询漏月、留存清理未实现、可无鉴权清空 |
| 4.8 数据持久化与备份 | 快照 + 恢复接口 ✓ | 非原子写、备份清理反向、上限失效 |
| 4.6 工业物联网实时推送 | SSE + 四类驱动 + 虚拟仪器 ✓ | 真实设备读数不驱动大屏/告警 |

---

## 六、建议改进路线（按投入产出排序）

### 第 1 批 — 安全止血（1–2 天，必须）
1. **立即吊销并轮换 DashScope Key**（A3），改后端代理 + `DASHSCOPE_API_KEY` 环境变量
2. 后端加最小可用鉴权：登录接口签发 HttpOnly Cookie/JWT → `/api/me` → 中间件校验所有写接口；`/api/audit`、`/api/backup`、`/api/iot/write` 限 admin/operator
3. CORS 从 `*` 改同源白名单
4. Schema 样式白名单清洗（A4），发布前统一校验

### 第 2 批 — 数据一致性（2–3 天）
5. 抽 `store.mjs`：原子写（tmp+rename）、失败抛错、白名单更新、资源名校验，一并消掉 B4/C4/设备 PUT 的白名单问题
6. ID 序号改为从既有数据推导或 `crypto.randomUUID()`（B1）
7. 修审计 `monthsInRange` 跨月（B2）、备份清理排序（B3）
8. 设计器与已发布应用的绑定：`redesign` 带 `appId`，示例/新建用新 `uid`（B6/B7）
9. 表单提交超限改为按 `audit.mjs` 模式按月归档（B5）

### 第 3 批 — 功能正确性（3–5 天）
10. 甘特拖拽统一坐标系（C1）+ 补 Playwright 交互用例锁住
11. IoT 读数回写 + 复用 `checkAlerts`/`computeOverview`（C2）
12. 样品状态机迁移表 + UI 入口守卫（C3）
13. `handle` 全局 try/catch + `safeDecode`（C4）；登录页默认密码（C5，1 行）

### 第 4 批 — 工程化（1 周，长期收益最大）
14. `.gitignore` 加 `backend/public/` + `git rm -r --cached backend/public`
15. 引入 ESLint + Vitest（先覆盖 `schemaOps`/`charts.ts`/`audit.mjs`/`production.ts` 等纯逻辑）+ GitHub Actions CI
16. `build-exe.mjs` 加 `process.platform === "win32"` 断言，去掉 `npx --yes` 回退
17. `server.mjs` 拆分为 `routes/*.mjs` + 显式 `store` 对象

---

## 七、复查方法与可信度

- 11 个模块并行独立审查（后端 2 + 前端核心 1 + 低代码 3 + 业务 1 + 管理 1 + 工具链 1），每条结论要求附行号与代码片段
- 关键 P0 已**直接读源码二次核实**：A1–A4、B1、B2、B3、B7、C1、C2、C3、C5、`backend/public` 入库、无测试/无 lint/无 CI
- 对两条子代理结论做了修正：甘特「偏移 9 小时」实为缩放倍数误差（C1）；
  `SchemaRenderer` 的 CSS 注入点不只是 `:161`，主要是 `:123` 的 `style` 直通
- 标注「待验证」的项目（如 `mouseleave` 取消连线、`AppRuntime` 竞态、`el-table-column` 宽度行为）需运行浏览器确认
