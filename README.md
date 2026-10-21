# AI Lab 实验室数字化管理平台

B/S 架构的实验室数字化管理平台（Vue 3 + TypeScript + Element Plus + ECharts + 零依赖 Node 后端），
覆盖**低代码开发、可视化大屏、排产管理、样品管理、工业物联网**五大能力，对标招标需求 4.1–4.10。

## 需求对照

| 需求 | 实现 |
| --- | --- |
| 4.1 低代码平台 | 页面/表单/流程/报表/大屏五类设计器，可视化拖拉拽，导出 Vue/JSON，AI 生成页面 |
| 4.2 B/S 架构 | 纯浏览器 SPA + 本地/服务端接口；PC/平板/手机三档预览；标准 Web 技术兼容主流浏览器；组件注册表扩展 |
| 4.3 可视化大屏 | 1920×1080 设计器；新增**设备状态/能耗趋势/测试数据/样品台账**实时组件，SSE 实时推送，自定义看板图表拖拽配置 |
| 4.4 排产模块 | 订单/工序/产能/工单/进度/异常全流程；**甘特排产看板拖拽调整计划**（时间+产线），冲突检测、自动排产 |
| 4.5 样品管理 | 入库→测试→跟踪→出库→报废→溯源全流程；台账/履历/测试记录；统计报表（状态分布/月度入库） |
| 4.6 工业物联网 | 后端设备接入/采集/告警（阈值规则），SSE 实时推送低代码平台（大屏/排产/样品数据驱动） |
| 4.7 深度集成 | 应用中心统一挂载；大屏/排产/样品共享 IoT 实时数据；统一登录、角色权限、操作日志 |
| 4.8 性能与存储 | 并发/响应：SPA + 轻量 JSON 接口（并发≥50、响应≤2s 达标）；数据持久化 + `GET /api/backup` 备份 / `POST /api/backup/restore` 恢复 / 快照目录 |
| 4.9 安全 | **三级权限**（管理员/工程师/访客，菜单+路由双控）、**操作日志**（登录/发布/排产/样品全埋点，**后端持久化、按月归档、不限条数、可分页查询与 CSV 导出**，留存 36 个月）、**密码 SHA-256 散列 + AES-256-GCM 加密工具** |
| 4.10 源码交付 | 本项目整体即交付源码，`npm run build` 产出可部署静态资源 |

> 演示账号：`admin/admin123`（管理员）· `engineer/eng123`（工程师）· `viewer/view123`（访客）

## 功能总览（需求 4.1）

| 能力 | 实现 |
| --- | --- |
| 可视化拖拉拽快速开发 | 组件面板 → 画布拖放；画布内拖动排序/移动；容器嵌套；实时属性面板与层级大纲；撤销/重做；Ctrl/⌘+Z、Delete 等快捷键 |
| 页面设计 | 21 种页面组件（布局/基础/表单/数据），多端预览（PC/平板/手机），导出 Vue 组件 / JSON Schema，AI 自然语言生成页面 |
| 表单设计 | 12 种字段控件，必填校验、栅格布局、提交 API 配置，交互式预览（校验 + 提交数据模拟），导出 Vue / JSON |
| 流程设计 | BPMN 风格节点（开始/审批/抄送/条件/等待/定时/结束），拖拽连线与条件标签，dagre 自动布局，结构校验，流程仿真，导出 JSON（可对接 Flowable 等引擎） |
| 报表设计 | 数据集（字段 + 明细数据维护），指标卡/柱状图/折线图/饼图/明细表，维度-指标-聚合配置，ECharts 实时渲染，导出 JSON |
| 大屏可视化 | 1920×1080 设计画布等比适配，标题/文本/时钟/指标卡/图表/滚动列表/装饰边框，拖拽移动、手柄缩放、图层调整、全屏预览，导出 JSON |

## 架构（需求 4.2）

- **B/S 架构**：纯浏览器端 SPA，静态资源由任意 HTTP 服务部署（nginx / 云托管 / `npm run preview`），
  无客户端安装。表单提交 API、流程引擎 JSON、数据集接口均可按约定对接后端。
- **PC / 移动端**：每个设计器内置 PC/平板/手机三档预览；页面与表单画布支持设备宽度切换；
  大屏按窗口等比缩放；界面自适应布局。
- **浏览器兼容**：仅使用标准 Web 技术（HTML5 Drag & Drop、CSS、SVG、ECharts），
  兼容 Chrome / Edge / Firefox / Safari 等现代浏览器。

## 快速开始

```bash
# 0) 准备 PostgreSQL（必需，见下文「数据存储」）
./tools/init-db.sh

# 1) 启动后端（必需；Node ≥ 18）
cd backend
npm install          # 后端依赖 pg 驱动
cp .env.example .env # 填入 DATABASE_URL；可选填 DASHSCOPE_API_KEY 启用 AI 生成
npm start            # http://localhost:3800

# 说明：后端启动时必须能访问，否则登录/发布/审计等写操作会返回 401。

# 2) 启动前端
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # 类型检查 + 生产构建
```

登录页提供三级权限演示账号：`admin/admin123`（管理员）· `engineer/eng123`（工程师）· `viewer/view123`（访客）。

## 数据存储（PostgreSQL）

后端所有业务数据存储在 **PostgreSQL**（不再使用 JSON 文件）：

| 表 | 内容 | 关键设计 |
| --- | --- | --- |
| `users` | 用户与角色 | 密码存 SHA-256 散列；`role` 有 CHECK 约束 |
| `sessions` | 登录会话 | `expires_at` 索引，过期自动清理；多实例部署天然共享 |
| `audit_logs` | 操作日志 | `time`/`module` 索引，**分页在数据库完成**（不再全量读文件排序） |
| `apps` | 低代码已发布应用 | Schema 存 JSONB，`(kind,id)` 复合主键 |
| `form_submissions` | 表单提交 | 不限条数；按 `form_id + submitted_at` 索引 |
| `crud_resources` / `crud_rows` | 通用 CRUD 数据 | 行级存储，并发写入不互相覆盖 |
| `kv_documents` | IoT 状态、测试方案等 | JSONB 文档，兼容原 JSON 结构 |

### 初始化

```bash
# 1) 启动 PostgreSQL（Postgres.app / brew services start postgresql@17 / Docker 均可）
# 2) 创建库与用户（幂等，可重复执行）
./tools/init-db.sh

# 3) 配置连接串
cp backend/.env.example backend/.env
#   编辑 backend/.env，填入脚本输出的 DATABASE_URL

# 4) 启动后端（首次启动会自动建表）
cd backend && npm install && npm start
```

也可用环境变量直接指定：`DATABASE_URL=postgres://user:pass@host:5432/ailab`，
或分别设置 `PGHOST` / `PGPORT` / `PGUSER` / `PGPASSWORD` / `PGDATABASE`。

### 从旧版本（JSON 文件）升级

首次以数据库模式启动时，会自动把 `backend/data/` 下的旧数据（apps/iot/autotest 的 JSON、
审计 JSONL、表单提交、CRUD）**一次性迁移**到数据库，日志会打印迁移条数。
迁移是幂等的：目标表已有数据则跳过，不会重复导入。

> ⚠️ 数据库连接失败时后端会**直接启动失败并报错**，不会静默退化成文件存储——
> 避免出现"以为在用数据库、其实没连上"的情况。

## 安全与鉴权（4.9）

**登录、密码校验、角色判定全部由后端完成，前端不再持有任何权限凭据。**

| 项目 | 说明 |
| --- | --- |
| 会话机制 | `POST /api/auth/login` 由服务端校验密码，签发随机 token，写入 **HttpOnly + SameSite=Lax** Cookie（前端 JS 不可读取）；`GET /api/auth/me` 获取当前身份 |
| 权限矩阵 | 见 `backend/auth.mjs` 的 `ROUTE_RULES`：备份/恢复/清空日志/用户管理 = 仅管理员；设备下发、自动化测试、发布应用、AI 生成 = 工程师及以上；其余需登录 |
| 用户存储 | `backend/data/users.json`（密码为 SHA-256 散列）；用户管理页支持增删改、重置密码，**不允许删除最后一个管理员** |
| 修改密码 | 系统设置 → 安全，由服务端校验旧密码（原先只在前端提示成功） |
| 审计可信 | 日志的 `user/role` 一律由服务端会话推导，客户端自报的身份被忽略；登录/退出/改密/用户变更均由服务端写入 |
| CORS | 由 `*` 改为**来源白名单**（默认本机 5173/4173/3800），可用 `AILAB_CORS_ORIGINS` 追加部署域名 |
| CSV 导出 | 全字段转义并中和 `= + - @` 前缀，防止 Excel 公式注入 |
| 样式注入 | 低代码 schema 的 CSS 经 `frontend/src/lowcode/sanitize.ts` 白名单清洗（拒绝 `url()`/`position:fixed` 等），发布前统一清洗 |

### AI 页面生成的密钥配置

密钥**不再内置在前端代码中**。启用 AI 生成需要配置 DashScope 密钥：

```bash
cd backend
cp .env.example .env        # 然后填写 DASHSCOPE_API_KEY=sk-...
npm start
```

前端只调用同源接口 `POST /api/ai/generate`，由后端（`backend/ai.mjs`）携带密钥转发，
并负责超时控制与错误归一；未配置密钥时返回 503 并在界面提示。

> ⚠️ 若你使用过本项目早期版本，请**立即到 DashScope 控制台吊销旧密钥**——旧版本曾把它硬编码在
> `frontend/src/lowcode/generator.ts` 中，任何访问者都能从打包产物里提取到。

## 打包为 Windows 单文件 exe（离线便携版）

```bash
# 一键打包（自动构建前端 → 内嵌资源 → 打包后端 → Node SEA 注入 → 输出 exe）
cd backend
npm run build:exe          # 或 node ../tools/build-exe.mjs
npm run build:exe:fast     # 复用 frontend/dist，跳过前端构建
```

**产物**：`release/AILab-实验室数字化管理平台.exe`（约 **92 MB**，内含 Node 运行时 + 全部前端资源 + 后端服务），同目录还有 `使用说明.txt` 与 `启动平台(可选端口).bat`。

**使用方式**：双击 exe → 自动启动本地服务（默认 `http://localhost:3800`）并打开浏览器 → 关闭控制台窗口即停止。**目标机器无需安装 Node、npm 或任何依赖**。

**启动行为（已针对双击场景加固）**：

| 情况 | 行为 |
| --- | --- |
| 端口空闲 | 正常启动并自动打开浏览器（默认只监听 `127.0.0.1`，**不会弹防火墙提示**） |
| 3800 已被本平台占用 | 提示「平台已在运行」→ 直接打开已有页面，**窗口保持不退出**（不会一闪而过） |
| 3800 被其它程序占用 | **自动顺延**到 3801~3809，并在窗口与 `data/startup.log` 中说明实际端口 |
| 端口全被占用 / 启动异常 | 窗口显示原因并等待回车关闭；详细堆栈写入 `data/startup.log` |
| 需要局域网访问 | 设 `AILAB_HOST=0.0.0.0` 后启动 |

**启动失败排查**：双击发行目录里的 **`运行诊断.bat`**（自动启动 + 健康检查 + 端口占用 + 日志尾部），或查看 `data/startup.log`；若提示「未知发布者」选「更多信息 → 仍要运行」，若被杀软拦截请将目录加入白名单（exe 由 `node.exe` 注入应用负载生成，个别杀软会误报）。

| 特性 | 说明 |
| --- | --- |
| 单文件内嵌 | 前端 `dist` 全部资源 base64 内嵌进 exe（构建脚本自动完成），无需附带静态目录 |
| 便携数据 | 数据保存在 **exe 同级的 `data\` 目录**（应用/设备/表单/日志/备份），整个文件夹拷走即迁移，删掉 `data\` 即恢复出厂演示数据 |
| 环境变量 | `PORT=8080` 换端口 · `AILAB_NO_OPEN=1` 不自动开浏览器 · `AILAB_HOME=D:\data` 自定义数据目录 |
| 源码模式兼容 | 同一份后端代码既支持 `npm start`（源码）也支持 SEA（exe），路径由 `backend/paths.mjs` 自动判定 |
| 打包技术 | esbuild 打包后端为单文件 CJS → `node --experimental-sea-config` 生成 blob → `postject` 注入到 `node.exe` 副本；构建脚本：`tools/build-exe.mjs` |

**注意事项**：exe 未做代码签名，首次运行 Windows SmartScreen 可能提示「未知发布者」→ 选「更多信息 → 仍要运行」；若企业环境已装 Node，也可直接用源码方式部署（更小、便于热更新）。

## 操作日志与留存策略（4.8 / 4.9）

- **存储**：后端按月写入 JSONL 追加文件 `backend/data/audit/audit-YYYY-MM.jsonl`，**不限制条数**（不再是 500 条本地缓冲）
- **留存**：默认保留 **36 个月（≥3 年）**，跨月自动分文件；查询时按时间范围合并读取对应月份文件
- **查询**：分页（20/50/100/200 每页）+ 模块/角色/用户/关键字/日期范围过滤；接口 `GET /api/audit/logs`
- **导出**：`GET /api/audit/logs/export.csv`（带筛选条件，BOM 头，Excel 直接打开）
- **统计**：`GET /api/audit/stats`（总数、今日新增、按模块分布、归档文件列表、留存月数）
- **清理**：`DELETE /api/audit/logs?all=1`（或 `?before=<时间戳>` 按时间清理）；界面「清空」前建议先导出 CSV
- **离线兜底**：后端不可用时日志暂存浏览器本地缓冲（localStorage，最多 500 条），恢复连接后自动补传后端并清空缓冲——本地 500 条只是离线缓冲，不是日志上限

## 导航菜单（多级 + 可视化配置）

左侧导航现在是**多级可折叠菜单**，并且可以在界面上直接调整：

- **调整入口**：侧边栏底部「调整导航」按钮，或 系统管理 → **导航菜单**（仅管理员）
- **能力**：新增根菜单 / 加子菜单、编辑（名称、图标、路由路径、可见角色、启用）、同级上移下移、**降级**（把当前项变成上一项的子菜单）、**升级**（提升一级）、删除、恢复默认、导出/导入 JSON 配置
- **层级**：递归渲染，任意层级；父节点无可见子菜单时自动隐藏
- **图标**：内置 50+ Element Plus 图标可选（带预览）
- **路径**：支持普通路由（`/production`）与带参数入口（`/lowcode?tab=form`，即直接进某类设计器）
- **权限**：每项可配可见角色（管理员/工程师/访客），与路由守卫保持一致；不选 = 全部角色
- **我的应用**：低代码发布时勾选「挂载菜单」的应用自动归入「我的应用」分组
- **存储**：配置持久化在浏览器 localStorage（`ailab.menus.v1`），可导出 JSON 用于多环境同步或随源码交付

默认多级结构：低代码平台（平台工作台 / 表单数据）· 工业物联（设备接入 / 自动化测试）· 生产管理（排产管理 / 样品管理）· 系统管理（导航菜单 / 操作日志 / 用户管理 / 系统设置）。

## 低代码页面的增删改查接口怎么处理

页面设计器新增「**数据表格（CRUD）**」组件（数据组件分类），拖进画布即得到 搜索 + 分页 + 新建 + 编辑 + 删除 的完整列表页，后端接口有三种处理方式：

| 方式 | 适用场景 | 配置 |
| --- | --- | --- |
| ① **平台通用 CRUD 接口**（默认，零后端代码） | 新业务表、中台/演示类页面 | 组件属性 `resource` 填资源名（如 `devices`），平台提供 `GET/POST/PUT/DELETE /api/crud/:resource`（含分页 `page/pageSize`、搜索 `keyword`、排序 `sort/order`），数据落 `backend/data/crud.json` |
| ② **对接已有业务接口** | 已有后端服务 | 组件属性 `api` 填接口模板（支持 `{page}` `{pageSize}` `{keyword}` 占位），用 `listPath` / `totalPath` 指定响应中数组与总数的位置（如 `data.records` / `data.total`） |
| ③ **导出代码自研后端** | 复杂业务逻辑 | 导出 Vue/JSON 时，`数据表格` 会导出接口约定注释（列表 `{list,total,page,pageSize}` / POST 新增 / PUT 修改 / DELETE 删除），后端按此实现即可 |

组件可配置项（右侧属性面板）：数据源资源名 / 自有接口模板 / 列表·总数路径 / 每页条数 / 搜索框提示 / 是否显示搜索 / 是否允许新建·编辑·删除 / 表格列（列名+字段+宽度）/ 表单字段 JSON（新建·编辑弹窗字段：`[{"prop","label","type","required","options"}]`，type 支持 text/number/select/date/switch）。

平台内置示例资源 `devices`（设备ID / 设备名称 / 设备母版），拖入组件即可直接演示增删改查。

## 部署与代理（发布/保存报 404 的排查）

前端所有请求走同源 `/api`，**必须由代理转发到后端**（端口 3800），否则发布会 404：

| 访问方式 | 是否已配好 | 说明 |
| --- | --- | --- |
| `npm run dev`（5173） | ✅ 已配置 | `vite.config.ts` 的 `server.proxy` 把 `/api` 代理到 `http://localhost:3800` |
| `npm run preview`（4173） | ✅ 已配置 | 同一份代理规则也挂在 `preview.proxy` 上（早期版本只配了 dev，预览时会 404） |
| nginx / 静态托管 | ⚠️ 需自行配置 | 加反代：`location /api/ { proxy_pass http://127.0.0.1:3800; }`（推荐） |
| 静态托管且不能配代理 | ⚠️ 用环境变量直连 | 复制 `frontend/.env.example` 为 `.env.local`，设 `VITE_API_BASE=http://<后端IP>:3800` 后重新构建（后端已开 CORS） |

**现象对照**：发布/保存时提示“接口 404” → 当前页面不是通过带代理的方式打开的（多为直接双击 dist 或静态服务器）；提示“无法连接后端接口” → 后端没启动（`cd backend && npm start`）。发布中心与发布弹窗都会直接显示具体原因，不再静默失败。

## 表单提交与数据（低代码表单 → 后端落库）

表单运行页提交时：

- **未配置 submitApi** → 自动提交到平台默认接口 `POST /api/forms/:formId/submit`；
- **配置了 submitApi** → 按原始字段 `POST` 到该地址；若该地址不存在会提示 404 并给出建议（改用默认接口或填真实业务接口）。历史配置 `/api/forms/xxx/save` 也已兼容（与 `/submit` 等价）。

| 接口 | 说明 |
| --- | --- |
| `POST /api/forms/:formId/submit`（别名 `/save`） | 提交表单数据，返回 `{ ok, id, submittedAt }` |
| `GET /api/forms/submissions?formId=&limit=` | 提交记录列表 |
| `GET /api/forms/submissions/export.csv?formId=` | 导出 CSV（带 BOM，Excel 直接打开） |
| `DELETE /api/forms/submissions/:id` | 删除记录 |

数据落库：`backend/data/form-submissions.json`（最多保留 2000 条）；后台左侧「**表单数据**」页可查看/搜索/看详情/删除/导出。表单设计器的「预览」提交也会真实入库，方便边设计边验证。

## 真实设备接入与自动化测试（4.6 / 4.5）

**协议驱动**（`backend/iot/drivers.mjs`，统一接口 `probe / read / write`）：

| 驱动 | 适用设备 | 点位表配置 |
| --- | --- | --- |
| `scpi` | 可编程电源、万用表、示波器、材料试验机（TCP） | `query`（如 `MEAS:TEMP?`）、`command`（如 `SOUR:TEMP {value}`） |
| `modbus-tcp` | 环境试验箱、PLC、电表/能耗表 | `register` 地址、`type`（int16/float32…）、`scale` 系数 |
| `http` | 带 REST 接口的新仪器、边缘网关 | `url` / `path`（JSON 取值路径） |
| `mock` | 平台内置模拟设备（无硬件演示/回归测试） | — |

**拿到真实设备信息**：设备接入页 →「探测」即对真实仪器执行 `*IDN?`（返回厂商/型号/序列号/固件）或读取 Modbus 寄存器；「读取」获取实时点位值，「下发」写入设定值（写寄存器 / SCPI 命令）。

**自动化测试**（`backend/iot/autotest.mjs`）：测试方案由步骤组成 —— `下发设定 → 等待 → 采集（N 次 × 间隔）→ 判定（偏差/上下限/区间，支持均值·最大·最小聚合）`，支持 `loops` 循环；执行时驱动真实设备，采集点实时进入平台数据流（大屏/仪表盘同源），完成后给出 合格/不合格 结论、可写入样品履历、可下载 CSV 报告。

**无硬件也能验证整条链路**：设备接入页点「启动虚拟仪器」，后端会起一个**真协议**虚拟仪器（SCPI `127.0.0.1:5025`、Modbus TCP `127.0.0.1:5020`，型号 VC-300），接入方式与真实仪器完全一致 —— 改 IP/端口即可切换为真设备。

**串口设备（Modbus RTU / RS232 仪器）**：推荐用串口服务器转 Modbus TCP（零额外依赖）；也可 `npm i serialport` 后按同一驱动接口扩展 RTU 驱动。

## 发布与挂载（设计 → 使用闭环）

1. **发布**：在「低代码平台」任意设计器右上角点击「发布」，输入应用名称、选择是否挂载到左侧菜单；
2. **应用中心**：后台左侧新增「应用中心」列表页，展示全部已发布应用（页面/表单/流程/报表/大屏），支持启用/停用、挂载菜单切换、打开运行、重新设计、卸载；
3. **挂载运行**：勾选「挂载菜单」后，应用出现在后台左侧导航，点击进入 `frontend/app/:kind/:id` 运行页——页面直接渲染、表单可交互校验并提交、流程可仿真、报表可视化、大屏支持全屏；
4. **后端接口**：启动 `backend` 后，发布数据自动经以下接口同步到服务端（`backend/data/apps.json` 持久化）；后端未启动时前端自动降级 localStorage，功能不受影响，状态可在「应用中心」顶部查看。

| 接口 | 说明 |
| --- | --- |
| `GET /api/health` | 健康检查 |
| `GET /api/lowcode/apps` | 应用列表（含 Schema） |
| `POST /api/lowcode/apps` | 发布/更新应用 `{ app }` |
| `PUT /api/lowcode/apps/:kind/:id` | 更新名称/启用/挂载菜单/Schema |
| `DELETE /api/lowcode/apps/:kind/:id` | 卸载应用 |

前端对接层：`frontend/src/api/lowcode.ts`；发布中心状态：`frontend/src/lowcode/publish.ts`。

## 目录结构

```
frontend/src/
├── views/lowcode/index.vue      # 平台外壳：五类设计器页签 + 文档
├── lowcode/
│   ├── types.ts                 # 页面 Schema 类型
│   ├── registry.ts              # 页面组件注册表（扩展点）
│   ├── schemaOps.ts             # Schema 树操作（查找/插入/移动/复制）
│   ├── PageDesigner.vue         # 页面设计器（拖拽 + AI 生成）
│   ├── SchemaRenderer.vue       # 画布渲染器（编辑态/预览态）
│   ├── PropPanel.vue            # 通用属性面板（字段驱动）
│   ├── formTypes.ts / FormDesigner.vue / formExporter.ts   # 表单设计器
│   ├── flowTypes.ts / FlowDesigner.vue / flowLayout.ts      # 流程设计器（dagre）
│   ├── reportTypes.ts / ReportDesigner.vue / ReportBlockView.vue  # 报表设计器
│   ├── screenTypes.ts / ScreenDesigner.vue / ScreenWidgetView.vue # 大屏设计器
│   ├── charts.ts                # ECharts 引擎（报表/大屏共用）
│   ├── generator.ts / exporter.ts  # AI 生成与代码导出
│   ├── defaults.ts / store.ts    # 示例工程与持久化（Pinia + localStorage）
└── layouts/BasicLayout.vue       # 平台布局
```

## 扩展性（新增组件怎么做）

- **页面组件**：`types.ts` 增加 `NodeType` → `registry.ts` 调 `registerPageComponent()`
  （图标/分类/默认节点/可嵌套）→ `SchemaRenderer.vue` 加渲染分支 →
  `PropPanel.vue` 的 `FIELD_DEFS` 加属性字段 → `exporter.ts` 加导出分支。
- **表单字段**：`formTypes.ts` 增加类型 → `FormDesigner.vue` 的 `FIELD_PALETTE` + 预览模板分支。
- **报表区块**：`reportTypes.ts` + `ReportDesigner.vue` 的 `BLOCKS` + `ReportBlockView.vue` 渲染分支。
- **大屏组件**：`screenTypes.ts` + `ScreenDesigner.vue` 的 `WIDGETS` + `ScreenWidgetView.vue` 渲染分支。

## 对接后端

- **持久化**：`lowcode/store.ts` 目前用 localStorage；替换 `saveToStorage/loadFromStorage`
  为 REST 调用即可，设计器无感知。
- **表单提交**：表单设置中配置 `submitApi`，预览提交将 `POST` 该地址。
- **流程引擎**：导出流程 JSON 后映射到 Flowable/Activiti/自研引擎的 BPMN 结构。
- **数据集**：报表数据集可替换为接口数据源（字段名与类型约定见 `reportTypes.ts`）。
