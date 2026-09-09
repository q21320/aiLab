<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  MagicStick,
  DocumentChecked,
  Connection,
  DataAnalysis,
  Monitor,
  CircleCheck,
  Refresh,
  QuestionFilled,
} from "@element-plus/icons-vue";
import PageDesigner from "../../lowcode/PageDesigner.vue";
import FormDesigner from "../../lowcode/FormDesigner.vue";
import FlowDesigner from "../../lowcode/FlowDesigner.vue";
import ReportDesigner from "../../lowcode/ReportDesigner.vue";
import ScreenDesigner from "../../lowcode/ScreenDesigner.vue";
import { useLowcodeStore } from "../../lowcode/store";

const store = useLowcodeStore();
store.init();

// 当前设计器页签
const active = ref<"page" | "form" | "flow" | "report" | "screen">("page");

// 支持从「应用中心 · 重新设计」跳转：/lowcode?tab=form
const route = useRoute();
watch(
  () => route.query.tab,
  (t) => {
    const key = String(t || "");
    if (["page", "form", "flow", "report", "screen"].includes(key)) {
      active.value = key as typeof active.value;
    }
  },
  { immediate: true }
);

const TABS = [
  { key: "page" as const, label: "页面设计", icon: MagicStick, desc: "拖拉拽 + AI 生成" },
  { key: "form" as const, label: "表单设计", icon: DocumentChecked, desc: "字段组件 · 校验" },
  { key: "flow" as const, label: "流程设计", icon: Connection, desc: "审批流 · 条件分支" },
  { key: "report" as const, label: "报表设计", icon: DataAnalysis, desc: "数据集 · 图表" },
  { key: "screen" as const, label: "大屏设计", icon: Monitor, desc: "可视化 · 数据大屏" },
];

const docVisible = ref(false);

/** 保存全部工程到本地（B/S 前端本地持久层，可切换后端接口） */
function saveAll() {
  store.persist();
  ElMessage.success("已保存全部工程");
}

async function resetAll() {
  try {
    await ElMessageBox.confirm(
      "将把页面/表单/流程/报表/大屏重置为内置示例工程，当前设计内容将被覆盖，是否继续？",
      "重置示例工程",
      { type: "warning", confirmButtonText: "重置", cancelButtonText: "取消" }
    );
    store.resetAll();
    ElMessage.success("已恢复为示例工程");
  } catch {
    /* 取消 */
  }
}

function designerFor(key: string) {
  if (key === "form") return FormDesigner;
  if (key === "flow") return FlowDesigner;
  if (key === "report") return ReportDesigner;
  if (key === "screen") return ScreenDesigner;
  return PageDesigner;
}
</script>

<template>
  <div class="lowcode-platform">
    <!-- 平台头部 -->
    <div class="platform-header">
      <div class="brand">
        <div class="tabs">
          <div
            v-for="t in TABS"
            :key="t.key"
            class="tab-item"
            :class="{ active: active === t.key }"
            @click="active = t.key"
          >
            <el-icon><component :is="t.icon" /></el-icon>
            <span class="tab-label">{{ t.label }}</span>
            <span class="tab-desc">{{ t.desc }}</span>
          </div>
        </div>
        <div class="actions">
          <el-dropdown @command="(c: string) => (docVisible = c === 'doc')">
            <el-button size="small" :icon="QuestionFilled">平台文档</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="doc">能力说明 / 扩展指南</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-button size="small" :icon="Refresh" @click="resetAll">重置示例</el-button>
          <el-button size="small" type="primary" :icon="CircleCheck" @click="saveAll">保存全部</el-button>
        </div>
      </div>
    </div>

    <!-- 设计器主体（KeepAlive 保持各设计器状态） -->
    <div class="platform-body">
      <KeepAlive>
        <component :is="designerFor(active)" />
      </KeepAlive>
    </div>

    <!-- 使用文档 -->
    <el-dialog v-model="docVisible" title="低代码开发平台 · 能力说明与扩展指南" width="860px" top="4vh">
      <div class="doc">
        <h3>一、能力总览（对标需求 4.1）</h3>
        <ul>
          <li>可视化拖拉拽：组件面板 → 画布拖放，画布内拖动排序，支持嵌套容器（容器/卡片/栅格/表单），实时属性编辑。</li>
          <li>页面设计：21 种页面组件（布局/基础/表单/数据），多端预览（PC/平板/手机），层级大纲，撤销重做，导出 Vue 组件与 JSON Schema，支持 AI 自然语言生成。</li>
          <li>表单设计：12 种字段控件，必填校验、栅格布局、提交 API 配置、交互式预览（校验 + 提交数据模拟）、导出 Vue 组件。</li>
          <li>流程设计：BPMN 风格节点（开始/审批/抄送/条件/等待/定时/结束），拖拽连线、条件标签、dagre 一键自动布局、结构校验、流程仿真、导出 JSON（可对接 Flowable 等流程引擎）。</li>
          <li>报表设计：数据集（字段 + 明细数据维护），指标卡/柱状图/折线图/饼图/明细表，维度-指标-聚合配置，ECharts 实时渲染，导出 JSON。</li>
          <li>大屏可视化：1920×1080 设计画布等比适配，标题/文本/时钟/指标卡/图表/滚动列表/装饰边框，拖拽移动、手柄缩放、图层调整、全屏预览，导出 JSON。</li>
        </ul>

        <h3>二、架构（对标需求 4.2）</h3>
        <ul>
          <li>B/S 架构：纯浏览器端 SPA（Vue 3 + TypeScript + Element Plus + ECharts），Vite 构建静态资源，可由任意 HTTP 服务部署（nginx/云托管），无需安装客户端。</li>
          <li>PC / 移动端：所有设计器提供 PC/平板/手机三档预览；页面与表单画布支持设备宽度切换；大屏按窗口等比缩放；界面自适应布局。</li>
          <li>浏览器兼容：仅使用标准 Web 技术（HTML5 拖拽 API、CSS、SVG、ECharts），兼容 Chrome / Edge / Firefox / Safari 等现代浏览器。</li>
        </ul>

        <h3>三、扩展机制（良好扩展性）</h3>
        <ul>
          <li>页面组件注册表：<code>src/lowcode/registry.ts</code> 中 <code>registerPageComponent()</code> 注册组件（图标/默认节点/分类/可嵌套），并在 <code>SchemaRenderer.vue</code> 增加渲染分支、<code>PropPanel.vue</code> 的 <code>FIELD_DEFS</code> 增加属性字段即可引入新组件。</li>
          <li>表单字段：<code>FormDesigner.vue</code> 的 <code>FIELD_PALETTE</code> + 预览模板分支。</li>
          <li>报表区块：<code>reportTypes.ts</code> 增加类型 + <code>ReportDesigner.vue</code> 的 <code>BLOCKS</code> + <code>ReportBlockView.vue</code> 渲染分支。</li>
          <li>大屏组件：<code>screenTypes.ts</code> + <code>ScreenDesigner.vue</code> 的 <code>WIDGETS</code> + <code>ScreenWidgetView.vue</code> 渲染分支。</li>
          <li>存储层：<code>src/lowcode/store.ts</code> 当前使用 localStorage 持久化；改为后端存储时，仅需将 <code>saveToStorage/loadFromStorage</code> 替换为 REST 调用，设计器无需改动。</li>
          <li>对接后端：表单提交 API、流程引擎（Flowable/Activiti）JSON、数据集服务接口均可按 <code>submitApi/flow-schema/report-schema</code> 约定接入。</li>
        </ul>

        <h3>四、发布与挂载（如何用到后台页面上）</h3>
        <ul>
          <li>发布：在每个设计器右上角点击「发布」，填写应用名称并选择是否挂载到左侧菜单，设计稿即生成一个应用（Schema 快照按版本保存）。</li>
          <li>应用中心：后台左侧「应用中心」为统一列表，可启停、切换挂载菜单、打开运行、重新设计（跳回对应设计器）、卸载。</li>
          <li>挂载运行：勾选「挂载菜单」后应用出现在左侧导航，点击即进入 <code>/app/:kind/:id</code> 运行页（页面/表单交互校验、流程仿真、报表、大屏全屏）。</li>
          <li>后端接口：启动 <code>cd backend && npm start</code>（Node 零依赖，端口 3800）后，发布数据自动经 <code>/api/lowcode/apps</code> 同步到服务端并持久化；后端未启动时自动降级 localStorage，互不影响。接口清单见 <code>backend/server.mjs</code>。</li>
        </ul>
      </div>
    </el-dialog>
  </div>
</template>

<style scoped>
.lowcode-platform {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 100px);
}
.platform-header {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 10px 14px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.tabs {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid #e4e7ed;
  cursor: pointer;
  transition: all 0.15s;
  color: #606266;
  user-select: none;
}
.tab-item:hover {
  border-color: #409eff;
  color: #409eff;
}
.tab-item.active {
  background: #409eff;
  border-color: #409eff;
  color: #fff;
}
.tab-item.active .tab-desc {
  color: rgba(255, 255, 255, 0.75);
}
.tab-label {
  font-size: 14px;
  font-weight: 600;
}
.tab-desc {
  font-size: 11px;
  color: #909399;
}
.actions {
  display: flex;
  gap: 8px;
}
.platform-body {
  flex: 1;
  min-height: 0;
}
.doc {
  font-size: 13px;
  color: #303133;
  line-height: 1.9;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 6px;
}
.doc h3 {
  margin: 14px 0 6px;
  color: #1f2d3d;
}
.doc ul {
  margin: 0;
  padding-left: 20px;
}
.doc code {
  background: #f5f7fa;
  padding: 1px 5px;
  border-radius: 3px;
  color: #476582;
  font-size: 12px;
}
</style>
