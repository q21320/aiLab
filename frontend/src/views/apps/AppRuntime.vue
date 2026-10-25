<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { ArrowLeft, FullScreen, VideoPlay } from "@element-plus/icons-vue";
import {
  usePublishStore,
  type PublishedApp,
  type PublishKind,
} from "../../lowcode/publish";
import SchemaRenderer from "../../lowcode/SchemaRenderer.vue";
import ReportBlockView from "../../lowcode/ReportBlockView.vue";
import ScreenWidgetView from "../../lowcode/ScreenWidgetView.vue";
import HtmlRunView from "../../lowcode/HtmlRunView.vue";
import { submitToCustomApi, submitToPlatform } from "../../api/forms";
import type { FormSchema } from "../../lowcode/formTypes";
import type { FlowSchema, FlowEdge, FlowNode } from "../../lowcode/flowTypes";
import { FLOW_NODE_SIZE } from "../../lowcode/flowTypes";
import type { ScreenSchema } from "../../lowcode/screenTypes";
import type { PageSchema } from "../../lowcode/types";

const store = usePublishStore();
const route = useRoute();
const router = useRouter();

onMounted(() => store.init());

const ROUTE_KIND: Record<string, PublishKind> = {
  pages: "page",
  forms: "form",
  flows: "flow",
  reports: "report",
  screens: "screen",
  html: "html",
};

const app = computed<PublishedApp | undefined>(() => {
  const kind = ROUTE_KIND[String(route.params.kind || "")];
  if (!kind) return undefined;
  return store.apps.find((a) => a.kind === kind && a.id === String(route.params.id));
});

watch(
  app,
  (a) => {
    document.title = a ? `${a.name} · 应用运行` : "应用不存在";
  },
  { immediate: true }
);

const notFound = computed(
  () => store.loaded && (!app.value || !app.value.enable)
);

function goBack() {
  router.push("/apps");
}

// ---------------------------------------------------------------------------
// 表单运行
// ---------------------------------------------------------------------------
const formSchema = computed<FormSchema | null>(() =>
  app.value?.kind === "form" ? (app.value.schema as FormSchema) : null
);
const formRef = ref<FormInstance>();
const formData = ref<Record<string, any>>({});
const formRules = computed<FormRules>(() => {
  const rules: FormRules = {};
  for (const f of formSchema.value?.fields || []) {
    if (f.required) {
      rules[f.name] = [{ required: true, message: f.message || `请填写${f.label}`, trigger: "blur" }];
    }
  }
  return rules;
});
const submitted = ref("");
const submittedId = ref("");
const submitting = ref(false);
function resetForm() {
  formData.value = {};
  for (const f of formSchema.value?.fields || []) {
    formData.value[f.name] =
      f.defaultValue ?? (f.type === "checkbox" ? [] : f.type === "switch" ? false : "");
  }
  submitted.value = "";
  submittedId.value = "";
}
watch(app, () => resetForm(), { immediate: true });

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) {
    ElMessage.warning("请检查必填项");
    return;
  }
  submitting.value = true;
  try {
    const custom = (formSchema.value?.submitApi || "").trim();
    const res = custom
      ? await submitToCustomApi(custom, formData.value)
      : await submitToPlatform(
          app.value?.id || "form",
          app.value?.name || formSchema.value?.name || "",
          formData.value
        );
    if (res.ok) {
      submittedId.value = res.id || "";
      ElMessage.success(res.id ? `提交成功，提交编号 ${res.id}` : "提交成功");
    } else {
      ElMessage.error(`提交失败：${res.error || "未知错误"}`);
    }
  } finally {
    submitting.value = false;
    submitted.value = JSON.stringify(formData.value, null, 2);
  }
}

// ---------------------------------------------------------------------------
// 流程运行
// ---------------------------------------------------------------------------
const flowSchema = computed<FlowSchema | null>(() =>
  app.value?.kind === "flow" ? (app.value.schema as FlowSchema) : null
);

function nodeCenter(n: FlowNode) {
  const s = FLOW_NODE_SIZE[n.type];
  return { x: n.x + s.width / 2, y: n.y + s.height / 2 };
}
function edgeSource(e: FlowEdge): FlowNode | null {
  return flowSchema.value?.nodes.find((n) => n.id === e.source) || null;
}
function edgeTarget(e: FlowEdge): FlowNode | null {
  return flowSchema.value?.nodes.find((n) => n.id === e.target) || null;
}
function edgePath(source: FlowNode, target: FlowNode): string {
  const a = nodeCenter(source);
  const b = nodeCenter(target);
  const dx = Math.max(60, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

const NODE_STYLE: Record<string, { fill: string; stroke: string; text: string }> = {
  start: { fill: "#f0f9eb", stroke: "#67c23a", text: "#529b2e" },
  end: { fill: "#fef0f0", stroke: "#f56c6c", text: "#c45656" },
  approval: { fill: "#ecf5ff", stroke: "#409eff", text: "#337ecc" },
  cc: { fill: "#f9f0ff", stroke: "#9254de", text: "#722ed1" },
  condition: { fill: "#fdf6ec", stroke: "#e6a23c", text: "#b88230" },
  wait: { fill: "#fdf6ec", stroke: "#e6a23c", text: "#b88230" },
  timer: { fill: "#f0f9eb", stroke: "#67c23a", text: "#529b2e" },
};
function nodeStyle(type: string) {
  return NODE_STYLE[type] || NODE_STYLE.approval;
}

const simulateOrder = ref<string[]>([]);
const simulateStatus = ref("就绪");
let simulateTimer: number | undefined;
function findPath(): string[] {
  const flow = flowSchema.value;
  if (!flow) return [];
  const start = flow.nodes.find((n) => n.type === "start");
  if (!start) return [];
  const prev = new Map<string, string>();
  const queue = [start.id];
  const visited = new Set([start.id]);
  while (queue.length) {
    const cur = queue.shift()!;
    const outs = flow.edges.filter((e) => e.source === cur);
    for (const e of outs) {
      if (visited.has(e.target)) continue;
      visited.add(e.target);
      prev.set(e.target, cur);
      queue.push(e.target);
      const tn = flow.nodes.find((n) => n.id === e.target);
      if (tn?.type === "end") {
        const path = [e.target];
        let c = e.target;
        while (prev.get(c)) {
          c = prev.get(c)!;
          path.unshift(c);
        }
        return path;
      }
    }
  }
  return [];
}
function simulate() {
  clearInterval(simulateTimer);
  const flow = flowSchema.value;
  if (!flow) return;
  const path = findPath();
  if (!path.length) {
    ElMessage.warning("未找到开始→结束的完整路径");
    return;
  }
  simulateOrder.value = [];
  simulateStatus.value = "仿真运行中...";
  let i = 0;
  simulateTimer = window.setInterval(() => {
    if (i >= path.length) {
      clearInterval(simulateTimer);
      simulateStatus.value = "仿真完成 ✓";
      return;
    }
    simulateOrder.value = path.slice(0, i + 1);
    const n = flow.nodes.find((x) => x.id === path[i]);
    simulateStatus.value = `当前步骤：${n?.name || ""}（${i + 1}/${path.length}）`;
    i += 1;
  }, 650);
}
onBeforeUnmount(() => clearInterval(simulateTimer));

const startFormName = computed(() => {
  const start = flowSchema.value?.nodes.find((n) => n.type === "start");
  return start?.config?.form || "发起表单";
});

// ---------------------------------------------------------------------------
// 报表运行
// ---------------------------------------------------------------------------
const reportSchema = computed(() =>
  app.value?.kind === "report" ? app.value.schema : null
);

// ---------------------------------------------------------------------------
// 大屏运行
// ---------------------------------------------------------------------------
const screenSchema = computed<ScreenSchema | null>(() =>
  app.value?.kind === "screen" ? (app.value.schema as ScreenSchema) : null
);
const screenScale = computed(() => {
  const s = screenSchema.value;
  if (!s) return 1;
  return Math.min((window.innerWidth - 48) / s.width, (window.innerHeight - 130) / s.height);
});

function pageSchema(): PageSchema | null {
  return app.value?.kind === "page" ? (app.value.schema as PageSchema) : null;
}

// ---------------------------------------------------------------------------
// AI 自由页面（kind:"html"）运行：整页源码交给沙箱桥接容器渲染
// ---------------------------------------------------------------------------
const htmlSchema = computed<{ html?: string } | null>(() =>
  app.value?.kind === "html" ? (app.value.schema as { html?: string }) : null
);

async function fullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
    else await document.exitFullscreen();
  } catch {
    ElMessage.warning("浏览器未授权全屏");
  }
}
</script>

<template>
  <div class="app-runtime">
    <!-- 应用不存在 / 停用 -->
    <el-result v-if="notFound" icon="warning" title="应用不可用">
      <template #sub-title>
        应用不存在或已停用，请到「应用中心」检查。
      </template>
      <template #extra>
        <el-button type="primary" @click="goBack">返回应用中心</el-button>
      </template>
    </el-result>

    <template v-else-if="app">
      <!-- ======================= 页面 ======================= -->
      <div v-if="app.kind === 'page'" class="runtime-page">
        <div class="runtime-bar">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-tag size="small" effect="plain">页面</el-tag>
        </div>
        <SchemaRenderer v-if="pageSchema()" :node="pageSchema()!" />
      </div>

      <!-- ======================= 表单 ======================= -->
      <div v-else-if="app.kind === 'form' && formSchema" class="runtime-form-wrap">
        <div class="runtime-bar">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-tag size="small" effect="plain">表单</el-tag>
        </div>
        <div class="runtime-card">
          <el-form ref="formRef" :model="formData" :rules="formRules" :label-width="(formSchema.labelWidth || 100) + 'px'">
            <h3 v-if="formSchema.showTitle" class="form-title">{{ formSchema.name }}</h3>
            <el-row :gutter="16">
              <el-col v-for="f in formSchema.fields" :key="f.id" :xs="24" :sm="f.span ?? formSchema.fieldSpan ?? 24" :md="f.span ?? formSchema.fieldSpan ?? 24">
                <el-form-item :label="f.label" :prop="f.name">
                  <el-input v-if="f.type === 'input'" v-model="formData[f.name]" :placeholder="f.placeholder" :disabled="f.disabled" />
                  <el-input v-else-if="f.type === 'textarea'" v-model="formData[f.name]" type="textarea" :rows="f.props?.rows || 3" :placeholder="f.placeholder" :disabled="f.disabled" />
                  <el-input-number v-else-if="f.type === 'number'" v-model="formData[f.name]" :min="f.props?.min ?? 0" :max="f.props?.max ?? 9999" :disabled="f.disabled" />
                  <el-select v-else-if="f.type === 'select'" v-model="formData[f.name]" :placeholder="f.placeholder" :disabled="f.disabled" style="width: 100%">
                    <el-option v-for="o in f.options" :key="String(o.value)" :label="o.label" :value="o.value" />
                  </el-select>
                  <el-radio-group v-else-if="f.type === 'radio'" v-model="formData[f.name]" :disabled="f.disabled">
                    <el-radio v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-radio>
                  </el-radio-group>
                  <el-checkbox-group v-else-if="f.type === 'checkbox'" v-model="formData[f.name]" :disabled="f.disabled">
                    <el-checkbox v-for="o in f.options" :key="String(o.value)" :label="String(o.value)">{{ o.label }}</el-checkbox>
                  </el-checkbox-group>
                  <el-date-picker v-else-if="f.type === 'date'" v-model="formData[f.name]" type="date" :placeholder="f.placeholder || '选择日期'" :disabled="f.disabled" />
                  <el-switch v-else-if="f.type === 'switch'" v-model="formData[f.name]" :disabled="f.disabled" />
                  <el-rate v-else-if="f.type === 'rating'" v-model="formData[f.name]" :max="f.props?.max || 5" :disabled="f.disabled" />
                  <el-slider v-else-if="f.type === 'slider'" v-model="formData[f.name]" :min="f.props?.min ?? 0" :max="f.props?.max ?? 100" :disabled="f.disabled" />
                  <el-button v-else-if="f.type === 'upload'" :disabled="f.disabled">上传文件</el-button>
                  <span v-else-if="f.type === 'text'">{{ formData[f.name] || f.placeholder || f.label }}</span>
                  <el-input v-else v-model="formData[f.name]" :placeholder="f.placeholder" />
                </el-form-item>
              </el-col>
              <el-col :span="24">
                <el-button type="primary" class="submit-btn" :loading="submitting" @click="submitForm">{{ formSchema.submitText || "提交" }}</el-button>
              </el-col>
            </el-row>
          </el-form>
          <template v-if="submitted">
            <el-divider>
              提交结果
              <el-tag v-if="submittedId" size="small" type="success" effect="plain" style="margin-left: 8px">
                提交编号 {{ submittedId }}
              </el-tag>
            </el-divider>
            <pre class="code-block">{{ submitted }}</pre>
          </template>
        </div>
      </div>

      <!-- ======================= 流程 ======================= -->
      <div v-else-if="app.kind === 'flow' && flowSchema" class="runtime-flow-wrap">
        <div class="runtime-bar">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-button size="small" type="primary" :icon="VideoPlay" @click="simulate">流程仿真</el-button>
          <span class="sim-status">{{ simulateStatus }}</span>
        </div>
        <div class="flow-card">
          <div class="flow-info">
            <el-tag size="small" effect="plain">发起表单：{{ startFormName }}</el-tag>
            <el-tag size="small" type="success" effect="plain">{{ flowSchema.nodes.length }} 个节点</el-tag>
            <el-tag size="small" type="info" effect="plain">{{ flowSchema.edges.length }} 条连线</el-tag>
          </div>
          <svg class="flow-svg" :viewBox="`0 0 1280 720`">
            <defs>
              <marker id="arrow-r" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="#909399" />
              </marker>
            </defs>
            <g v-for="e in flowSchema.edges" :key="e.id">
              <path
                v-if="edgeSource(e) && edgeTarget(e)"
                :d="edgePath(edgeSource(e)!, edgeTarget(e)!)"
                fill="none"
                stroke="#909399"
                stroke-width="2"
                marker-end="url(#arrow-r)"
              />
            </g>
            <g v-for="n in flowSchema.nodes" :key="n.id" :transform="`translate(${n.x}, ${n.y})`" class="node-g" :class="{ simulated: simulateOrder.includes(n.id) }">
              <rect
                :width="FLOW_NODE_SIZE[n.type].width"
                :height="FLOW_NODE_SIZE[n.type].height"
                rx="8"
                :fill="nodeStyle(n.type).fill"
                :stroke="nodeStyle(n.type).stroke"
                stroke-width="2"
              />
              <text
                :x="FLOW_NODE_SIZE[n.type].width / 2"
                :y="FLOW_NODE_SIZE[n.type].height / 2 + 4"
                text-anchor="middle"
                font-size="13"
                font-weight="600"
                :fill="nodeStyle(n.type).text"
              >
                {{ n.name }}
              </text>
            </g>
          </svg>
        </div>
      </div>

      <!-- ======================= 报表 ======================= -->
      <div v-else-if="app.kind === 'report' && reportSchema" class="runtime-report-wrap">
        <div class="runtime-bar">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-tag size="small" effect="plain">报表</el-tag>
        </div>
        <div class="report-grid">
          <div v-for="b in reportSchema.blocks" :key="b.id" class="report-block-cell">
            <div class="report-block-title">{{ b.title }}</div>
            <div class="report-block-body" :style="{ height: b.kind === 'metric' ? '110px' : b.kind === 'table' ? 'auto' : '300px' }">
              <ReportBlockView
                :block="b"
                :rows="reportSchema.dataset.rows"
                :fields="reportSchema.dataset.fields"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- ======================= 大屏 ======================= -->
      <div v-else-if="app.kind === 'screen' && screenSchema" class="runtime-screen-wrap" :style="{ background: screenSchema.background }">
        <div class="runtime-bar dark">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-button size="small" :icon="FullScreen" @click="fullscreen">全屏</el-button>
        </div>
        <div class="screen-stage">
          <div
            class="screen-canvas"
            :style="{
              width: screenSchema.width * screenScale + 'px',
              height: screenSchema.height * screenScale + 'px',
            }"
          >
            <div
              class="screen-inner"
              :style="{
                width: screenSchema.width + 'px',
                height: screenSchema.height + 'px',
                background: screenSchema.background,
                transform: `scale(${screenScale})`,
              }"
            >
              <div
                v-for="w in screenSchema.widgets"
                :key="w.id"
                class="sw-frame"
                :style="{ left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px', zIndex: w.z }"
              >
                <ScreenWidgetView :widget="w" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- ======================= AI 自由页面（HTML） ======================= -->
      <div v-else-if="app.kind === 'html' && htmlSchema" class="runtime-html-wrap">
        <div class="runtime-bar">
          <el-button size="small" :icon="ArrowLeft" @click="goBack">返回应用中心</el-button>
          <span class="runtime-title">{{ app.name }}</span>
          <el-tag size="small" effect="plain">AI 页面</el-tag>
        </div>
        <div class="runtime-html-body">
          <HtmlRunView :html="htmlSchema.html || ''" />
        </div>
      </div>
    </template>

    <el-skeleton v-else :rows="6" animated />
  </div>
</template>

<style scoped>
.app-runtime {
  min-height: 360px;
}
.runtime-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.runtime-bar.dark {
  color: #eaf6ff;
}
.runtime-title {
  font-size: 15px;
  font-weight: 600;
  color: #1f2d3d;
}
.runtime-bar.dark .runtime-title {
  color: #eaf6ff;
}
.runtime-page {
  margin: -20px;
  padding: 0;
  background: #f0f2f5;
}
.runtime-page .runtime-bar {
  padding: 8px 20px;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
  margin: 0;
}
.runtime-form-wrap .runtime-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 20px 24px;
  max-width: 860px;
  margin: 0 auto;
}
.form-title {
  text-align: center;
  margin: 0 0 18px;
  color: #1f2d3d;
}
.submit-btn {
  width: 160px;
}
.code-block {
  margin: 0;
  padding: 12px;
  background: #282c34;
  color: #abb2bf;
  border-radius: 6px;
  overflow: auto;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}
.flow-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px;
}
.flow-info {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.flow-svg {
  width: 100%;
  background: #fafafa;
  border: 1px solid #f0f2f5;
  border-radius: 6px;
}
.node-g.simulated rect {
  filter: drop-shadow(0 0 8px rgba(64, 158, 255, 0.9));
  stroke: #409eff !important;
  stroke-width: 3 !important;
}
.sim-status {
  font-size: 13px;
  color: #606266;
}
.report-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(420px, 1fr));
  gap: 14px;
}
.report-block-cell {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 16px;
}
.report-block-title {
  font-size: 14px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 8px;
}
.runtime-screen-wrap {
  margin: -20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px);
  border-radius: 8px;
  overflow: hidden;
}
.runtime-screen-wrap .runtime-bar {
  padding: 8px 20px;
  margin: 0;
  background: rgba(6, 22, 48, 0.6);
}
.screen-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}
.screen-canvas {
  position: relative;
  flex-shrink: 0;
}
.screen-inner {
  position: absolute;
  left: 0;
  top: 0;
  transform-origin: 0 0;
  overflow: hidden;
  border: 1px solid rgba(0, 229, 255, 0.2);
  border-radius: 4px;
}
.sw-frame {
  position: absolute;
  overflow: hidden;
}
.runtime-html-wrap {
  margin: -20px;
  padding: 0;
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px);
}
.runtime-html-wrap .runtime-bar {
  padding: 8px 20px;
  margin: 0;
  background: #fff;
  border-bottom: 1px solid #ebeef5;
}
.runtime-html-body {
  flex: 1;
  min-height: 0;
  padding: 12px;
  background: #f0f2f5;
}
</style>
