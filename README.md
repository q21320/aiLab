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
| 4.9 安全 | **三级权限**（管理员/工程师/访客，菜单+路由双控）、**操作日志**（登录/发布/排产/样品全埋点，CSV 导出）、**密码 SHA-256 散列 + AES-256-GCM 加密工具** |
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
# 1) 启动低代码后端（可选，但推荐；Node ≥ 18，零依赖）
cd backend
npm start            # http://localhost:3800

# 2) 启动前端
cd frontend
npm install
npm run dev          # http://localhost:5173
npm run build        # 类型检查 + 生产构建
```

登录页为演示账号（`stores/user.ts` 内 Mock），输入任意账号即可进入。

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
