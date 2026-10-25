<script setup lang="ts">
// ============================================================================
// AI 自由页面设计器（低代码工作台第 6 个 tab，kind:"html"）
//
// 一句话需求 → AI 直出一整页 HTML → 右侧实时预览（沙箱桥接）→ 发布成应用。
// 与 store.ts 的 5 类结构化工程解耦：本设计器草稿单独存 localStorage，
// 发布后的正式数据进 apps 表（数据库、重启不丢）。
// ============================================================================
import { onMounted, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { MagicStick, Edit, Promotion, Refresh } from "@element-plus/icons-vue";
import HtmlRunView from "./HtmlRunView.vue";
import PublishDialog from "./PublishDialog.vue";
import { generateHtml, refineHtml, loadGrounding, type ResourceInfo } from "./generator";
import { uid } from "./schemaOps";
import { usePublishStore, type PublishedApp } from "./publish";

const props = defineProps<{ schema?: unknown; appId?: string }>();
const publishStore = usePublishStore();

const DRAFT_KEY = "ailab.lowcode.html.draft";

interface HtmlDraft {
  id: string;
  name: string;
  html: string;
  prompt: string;
}

function newId(): string {
  return uid("html");
}

function loadDraft(): HtmlDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && typeof d === "object" ? (d as HtmlDraft) : null;
  } catch {
    return null;
  }
}

const state = reactive<HtmlDraft>({ id: newId(), name: "", html: "", prompt: "" });
const instruction = ref("");
const generating = ref(false);
const refining = ref(false);
const resourceCount = ref(-1);
const dlgVisible = ref(false);

const busy = () => generating.value || refining.value;

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
  } catch {
    /* 存储超限静默：草稿仅防刷新丢，发布数据在数据库 */
  }
}

/** 载入待重新设计的应用（来自 ?tab=html&appId=xxx，index.vue 传入已发布 schema） */
function applyIncoming() {
  const s = props.schema as { id?: string; name?: string; html?: string } | undefined;
  if (s && typeof s.html === "string" && s.html) {
    state.id = props.appId || s.id || newId();
    state.name = s.name || "";
    state.html = s.html;
    return true;
  }
  if (props.appId) {
    const app = publishStore.apps.find((a) => a.kind === "html" && a.id === props.appId);
    if (app && typeof app.schema?.html === "string") {
      state.id = app.id;
      state.name = app.name;
      state.html = app.schema.html;
      return true;
    }
  }
  return false;
}

onMounted(() => {
  if (!applyIncoming()) {
    const d = loadDraft();
    if (d) Object.assign(state, d);
  }
  // 探测平台真实资源数量，用于提示“会用到哪些后端数据”
  void loadGrounding()
    .then((rs: ResourceInfo[]) => (resourceCount.value = rs.length))
    .catch(() => (resourceCount.value = 0));
});

watch(
  () => [props.schema, props.appId],
  () => applyIncoming(),
);

async function onGenerate() {
  if (!state.prompt.trim()) {
    ElMessage.warning("先描述你想要的页面，例如：一个展示设备在线情况的看板");
    return;
  }
  generating.value = true;
  try {
    const { html } = await generateHtml(state.prompt.trim());
    state.html = html;
    if (!state.name) state.name = state.prompt.trim().slice(0, 16);
    saveDraft();
    ElMessage.success("已生成页面，右侧可预览；如需微调可继续追问或直接改源码");
  } catch (e: any) {
    ElMessage.error(e?.message || "生成失败");
  } finally {
    generating.value = false;
  }
}

async function onRefine() {
  if (!state.html) {
    ElMessage.warning("还没有页面，请先生成");
    return;
  }
  if (!instruction.value.trim()) {
    ElMessage.warning("写一句修改要求，例如：把标题改成红色并加一个刷新按钮");
    return;
  }
  refining.value = true;
  try {
    const { html } = await refineHtml(state.html, instruction.value.trim());
    state.html = html;
    instruction.value = "";
    saveDraft();
    ElMessage.success("已按追问更新页面");
  } catch (e: any) {
    ElMessage.error(e?.message || "修改失败");
  } finally {
    refining.value = false;
  }
}

function openPublish() {
  if (!state.html.trim()) {
    ElMessage.warning("还没有页面内容，无法发布");
    return;
  }
  dlgVisible.value = true;
}

/** 传给发布对话框的应用快照（id 稳定，重新发布即覆盖） */
const publishSchema = ref<Record<string, any>>({});
watch(dlgVisible, (v) => {
  if (v) publishSchema.value = { type: "html", id: state.id, name: state.name || "未命名页面", html: state.html };
});

function onPublished(app: PublishedApp) {
  state.name = app.name;
  saveDraft();
}
</script>

<template>
  <div class="html-designer">
    <!-- 左：需求 / 源码 -->
    <div class="left-pane">
      <div class="card">
        <div class="card-title"><el-icon><MagicStick /></el-icon> 用一句话描述页面</div>
        <el-input
          v-model="state.prompt"
          type="textarea"
          :rows="3"
          :disabled="busy()"
          placeholder="例如：一个展示所有设备在线状态的看板，顶部统计卡片，下方设备列表"
        />
        <div class="row">
          <el-button type="primary" :icon="MagicStick" :loading="generating" @click="onGenerate">
            {{ state.html ? "重新生成" : "生成页面" }}
          </el-button>
          <span v-if="resourceCount >= 0" class="hint">
            已接入平台 {{ resourceCount }} 个数据资源，页面可调用 /api/* 真实数据
          </span>
        </div>
        <div class="row refine-row">
          <el-input
            v-model="instruction"
            :disabled="busy()"
            placeholder="对当前页面追加一句修改要求（追问整页重生）"
            @keyup.enter="onRefine"
          />
          <el-button :icon="Edit" :loading="refining" :disabled="!state.html" @click="onRefine">追问</el-button>
        </div>
      </div>

      <div class="card grow">
        <div class="card-title">
          <el-icon><Refresh /></el-icon> 页面源码（可直接编辑，改动即时反映到右侧预览）
        </div>
        <el-input v-model="state.html" type="textarea" resize="none" class="src" placeholder="页面 HTML 会出现在这里" @blur="saveDraft" />
      </div>
    </div>

    <!-- 右：实时预览 + 发布 -->
    <div class="right-pane">
      <div class="preview-bar">
        <el-input v-model="state.name" size="small" maxlength="32" placeholder="应用名称" style="width: 200px" @blur="saveDraft" />
        <el-button type="primary" size="small" :icon="Promotion" @click="openPublish">发布</el-button>
      </div>
      <div class="preview-body">
        <HtmlRunView :html="state.html" />
      </div>
    </div>

    <PublishDialog
      v-model="dlgVisible"
      kind="html"
      :schema="publishSchema"
      :default-name="state.name || 'AI 页面'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.html-designer {
  display: flex;
  gap: 12px;
  height: 100%;
  min-height: 0;
}
.left-pane {
  flex: 0 0 46%;
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-height: 0;
}
.right-pane {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
}
.card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 14px;
}
.card.grow {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.card-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 10px;
}
.row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 10px;
}
.refine-row {
  margin-top: 8px;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.src {
  flex: 1;
  min-height: 0;
}
.src :deep(.el-textarea__inner) {
  height: 100%;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
}
.preview-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #ebeef5;
  background: #fafcff;
}
.preview-body {
  flex: 1;
  min-height: 0;
  padding: 10px;
}
</style>
