<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import {
  MagicStick,
  Download,
  Delete,
  RefreshLeft,
  RefreshRight,
  CopyDocument,
  View,
  Rank,
  FolderOpened,
  Promotion,
} from "@element-plus/icons-vue";
import SchemaRenderer from "./SchemaRenderer.vue";
import PropPanel from "./PropPanel.vue";
import PublishDialog from "./PublishDialog.vue";
import type { PublishedApp } from "./publish";
import { LC_DRAG_KEY, LC_ACTIONS_KEY } from "./lcCore";
import type { LcDragState, LcActions } from "./lcCore";
import { groupPageComponents, createPageNode, getPageComponent } from "./registry";
import { generateSchema, refineSchema, loadGrounding, optimizeInput, EXAMPLE_PROMPTS } from "./generator";
import { useChatSession, hydrateChats } from "./useChatSession";
import { schemaToVue, schemaToJson } from "./exporter";
import {
  clone,
  createEmptyPage,
  findNode,
  insertAt,
  removeNode,
  duplicateNode,
  moveNode,
  walk,
} from "./schemaOps";
import { useLowcodeStore } from "./store";
import { defaultPageSchema } from "./defaults";
import type { PageSchema, SchemaNode, NodeType } from "./types";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
const store = useLowcodeStore();

// 从「应用中心 · 重新设计」进入时，父级传入该应用的真实 Schema（修复：原先永远加载内置示例）
const props = defineProps<{ schema?: PageSchema | null; appId?: string }>();
/** 是否处于“重新设计已发布应用”模式（此时不应污染设计工程 store） */
const isRedesignMode = computed(() => !!props.schema);
/** 聊天会话按 appId 隔离：有 appId 用 "page_mvjikjnc_1"，没有用 "default:page" */
const chatScope = computed(() => props.appId || "default:page");
const schema = ref<PageSchema>(clone(props.schema || store.projects.page || createEmptyPage()));
const selectedId = ref("");

// 后端异步 loadFromServer 完成后，把最新工程 hydrate 到画布一次。
// 关键：一次性 —— 应用后立即 stop，避免与「800ms 自动保存写回 store」形成 store↔schema 无限回环（会疯狂 PUT）。
const stopStoreHydrate = watch(
  () => store.projects.page,
  (newPage) => {
    if (newPage && !isRedesignMode.value) schema.value = clone(newPage);
    stopStoreHydrate();
  },
);

const selectedNode = computed<SchemaNode | null>(() =>
  selectedId.value ? findNode(schema.value, selectedId.value) : null
);

// 设备模式：桌面 / 平板 / 手机（移动端适配预演）
type DeviceMode = "pc" | "tablet" | "phone";
const deviceMode = ref<DeviceMode>("pc");
const deviceWidth = computed(() =>
  deviceMode.value === "pc" ? "100%" : deviceMode.value === "tablet" ? "768px" : "375px"
);

// 拖拽上下文（注入到 SchemaRenderer）
const dragState = reactive<LcDragState>({ active: false, parentId: "", index: -1 });
provide(LC_DRAG_KEY, dragState);

// ---------------------------------------------------------------------------
// 历史记录（撤销/重做）
// ---------------------------------------------------------------------------
const history = ref<PageSchema[]>([]);
const historyIndex = ref(-1);

function snapshot() {
  history.value = history.value.slice(0, historyIndex.value + 1);
  history.value.push(clone(schema.value));
  if (history.value.length > 60) history.value.shift();
  historyIndex.value = history.value.length - 1;
}
function undo() {
  if (historyIndex.value > 0) {
    historyIndex.value -= 1;
    schema.value = clone(history.value[historyIndex.value]);
    clearSelection();
  }
}
function redo() {
  if (historyIndex.value < history.value.length - 1) {
    historyIndex.value += 1;
    schema.value = clone(history.value[historyIndex.value]);
    clearSelection();
  }
}
const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < history.value.length - 1);

// ---------------------------------------------------------------------------
// 节点操作
// ---------------------------------------------------------------------------
function select(node: SchemaNode) {
  selectedId.value = node.id;
}
function clearSelection() {
  selectedId.value = "";
}

function remove(id: string) {
  if (id === schema.value.id) {
    ElMessage.warning("页面根节点不能删除");
    return;
  }
  snapshot();
  removeNode(schema.value, id);
  if (selectedId.value === id) clearSelection();
}

function duplicate(id: string) {
  const found = findNode(schema.value, id);
  if (!found) return;
  const copy = duplicateNode(schema.value, id);
  if (!copy) return;
  const parent = parentOf(id);
  if (!parent) return;
  snapshot();
  const kids = parent.children || [];
  const idx = kids.findIndex((c) => c.id === id);
  insertAt(parent, copy, idx + 1);
  selectedId.value = copy.id;
}

function parentOf(id: string): SchemaNode | null {
  let result: SchemaNode | null = null;
  walk(schema.value, (n) => {
    if ((n.children || []).some((c) => c.id === id)) result = n;
  });
  return result;
}

function drop(parentId: string, index: number, payload: string) {
  try {
    if (payload.startsWith("move:")) {
      const id = payload.slice(5);
      if (id === parentId || id === schema.value.id) return;
      snapshot();
      if (!moveNode(schema.value, id, parentId, index)) {
        if (historyIndex.value > 0) historyIndex.value -= 1;
        ElMessage.warning("无法移动：不能移动到自身或其子级内部");
      }
      selectedId.value = id;
      return;
    }
    const type = payload as NodeType;
    if (!getPageComponent(type)) {
      ElMessage.error(`未注册的组件类型：${payload}`);
      return;
    }
    const parent = findNode(schema.value, parentId);
    if (!parent) return;
    snapshot();
    const node = createPageNode(type);
    insertAt(parent, node, index);
    selectedId.value = node.id;
  } catch (e) {
    ElMessage.error((e as Error).message || "添加组件失败");
  }
}

const actions: LcActions = { select, remove, duplicate, drop };
provide(LC_ACTIONS_KEY, actions);

// ---------------------------------------------------------------------------
// 键盘快捷键
// ---------------------------------------------------------------------------
function isTypingTarget(e: KeyboardEvent) {
  const t = e.target as HTMLElement;
  return (
    t &&
    (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)
  );
}
function onKeydown(e: KeyboardEvent) {
  if (isTypingTarget(e)) return;
  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedId.value) {
      e.preventDefault();
      remove(selectedId.value);
    }
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    redo();
  }
}
onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  hydrateChats(chatScope.value);
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));

// ---------------------------------------------------------------------------
// 自动保存
// ---------------------------------------------------------------------------
const savedAt = ref("");
let saveTimer: number | undefined;
watch(
  schema,
  () => {
    // “重新设计已发布应用”时不写回设计工程（避免污染默认进入时的状态）
    if (isRedesignMode.value) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      store.saveProject("page", clone(schema.value));
      savedAt.value = new Date().toLocaleTimeString();
    }, 800);
  },
  { deep: true }
);

// ---------------------------------------------------------------------------
// 属性面板 / 大纲
// ---------------------------------------------------------------------------
const outlineTabs = ref<"props" | "tree">("props");
const outlineItems = computed(() => {
  const items: { node: SchemaNode; depth: number }[] = [];
  walk(schema.value, (n, d) => items.push({ node: n, depth: d }));
  return items;
});
function outlineLabel(n: SchemaNode): string {
  const def = getPageComponent(n.type);
  return (n.text || def?.label || n.type) as string;
}

// ---------------------------------------------------------------------------
// 预览 / 导出 / AI 生成对话框
// ---------------------------------------------------------------------------
const previewVisible = ref(false);
const previewDevice = ref<DeviceMode>("pc");
const openPreview = () => {
  store.saveProject("page", clone(schema.value));
  previewVisible.value = true;
};

const exportVisible = ref(false);
const exportType = ref<"vue" | "json">("json");
const exportCode = ref("");
function openExport(type: "vue" | "json") {
  exportType.value = type;
  regenerateCode();
  exportVisible.value = true;
}
function regenerateCode() {
  exportCode.value =
    exportType.value === "vue" ? schemaToVue(schema.value) : schemaToJson(schema.value);
}
watch(exportType, regenerateCode);
async function copyCode() {
  try {
    await navigator.clipboard.writeText(exportCode.value);
    ElMessage.success("已复制到剪贴板");
  } catch {
    ElMessage.error("复制失败，请手动选择复制");
  }
}
function downloadCode() {
  const filename = exportType.value === "vue" ? "GeneratedPage.vue" : "page-schema.json";
  const blob = new Blob([exportCode.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已开始下载");
}

// AI 连续生成 / 追问（常驻侧栏，会话按 appId 隔离并持久化到数据库）
const { chatMsgs, grounding, chatVisible } = useChatSession(chatScope.value);
const chatBusy = ref(false);
const chatInput = ref("");
const chatListEl = ref<HTMLElement | null>(null);
const optimizing = ref(false);
/** 是否处于首轮（尚未生成过）——只有首轮才展示“优化描述” */
const isFirstRound = computed(() => !chatMsgs.value.some((m) => m.role === "ai"));

function countNodes(n: SchemaNode): number {
  return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
}
function scrollChat() {
  nextTick(() => {
    const el = chatListEl.value;
    if (el) el.scrollTop = el.scrollHeight;
  });
}
async function openChat() {
  chatVisible.value = true;
  if (!grounding.value.length) grounding.value = await loadGrounding();
}
function useSample(text: string) {
  chatInput.value = text;
}
async function sendChat() {
  const text = chatInput.value.trim();
  if (!text || chatBusy.value) return;
  chatMsgs.value.push({ role: "user", text });
  chatInput.value = "";
  chatBusy.value = true;
  scrollChat();
  try {
    if (!grounding.value.length) grounding.value = await loadGrounding();
    const first = !chatMsgs.value.some((m) => m.role === "ai");
    if (first) {
      const res = await generateSchema(text, grounding.value);
      snapshot();
      schema.value = res.schema;
      clearSelection();
      const bound = grounding.value.length ? "（表格已接真实数据源）" : "";
      chatMsgs.value.push({ role: "ai", text: `已生成页面骨架，含 ${countNodes(res.schema) - 1} 个组件${bound}。你可以继续用一句话追问微调。` });
    } else {
      const draft = clone(schema.value);
      const res = await refineSchema(draft, text, grounding.value);
      snapshot();
      schema.value = res.schema;
      clearSelection();
      chatMsgs.value.push({ role: "ai", text: res.note || "已更新页面。" });
    }
  } catch (e) {
    chatMsgs.value.push({ role: "ai", text: `⚠️ ${(e as Error).message || "生成失败，请重试"}` });
  } finally {
    chatBusy.value = false;
    scrollChat();
  }
}

// 输入优化：把口语描述改写得更结构化（仅首轮，优化动作不写入会话记录）
async function handleOptimize() {
  const text = chatInput.value.trim();
  if (!text || optimizing.value || chatBusy.value) return;
  optimizing.value = true;
  try {
    if (!grounding.value.length) grounding.value = await loadGrounding();
    const improved = await optimizeInput(text, grounding.value);
    if (improved && improved !== text) {
      chatInput.value = improved;
      ElMessage.success("描述已优化，可继续编辑后点“生成页面”");
    } else {
      ElMessage.info("描述已足够清晰，无需优化");
    }
  } catch (e) {
    ElMessage.warning((e as Error).message || "优化失败，可直接发送");
  } finally {
    optimizing.value = false;
  }
}

// 空白页面 / 恢复示例
function createNew() {
  snapshot();
  schema.value = createEmptyPage();
  clearSelection();
}
function restoreExample() {
  snapshot();
  schema.value = clone(defaultPageSchema());
  clearSelection();
  ElMessage.success("已恢复示例页面");
}

// 组件面板
const groups = groupPageComponents();
function onPaletteDragStart(ev: DragEvent, type: NodeType) {
  ev.dataTransfer?.setData("text/plain", type);
  if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "copy";
}
function addToRoot(type: NodeType) {
  try {
    const node = createPageNode(type);
    snapshot();
    insertAt(schema.value, node, -1);
    selectedId.value = node.id;
  } catch (e) {
    ElMessage.error((e as Error).message || "添加组件失败");
  }
}

function onDragEnd() {
  dragState.active = false;
  dragState.parentId = "";
  dragState.index = -1;
}

// 发布（生成应用 → 应用中心 → 可挂载菜单运行）
const publishVisible = ref(false);
function onPublished(app: PublishedApp) {
  ElMessage.success(`已发布「${app.name}」，可在「应用中心」打开运行${app.menu ? "并已挂载到左侧菜单" : ""}`);
}

snapshot();
</script>

<template>
  <div class="page-designer">
    <!-- 左栏：组件面板 -->
    <aside class="side side-left">
      <div class="side-title">
        <el-icon><Rank /></el-icon>
        <span>组件库</span>
      </div>
      <p class="side-desc">拖拽组件到画布，或点击组件追加到页面末尾。</p>

      <el-button type="primary" :icon="MagicStick" style="width: 100%; margin-bottom: 12px" @click="openChat">
        AI 生成 / 追问
      </el-button>

      <div v-for="g in groups" :key="g.category" class="palette-group">
        <div class="palette-group-title">{{ g.label }}</div>
        <div
          v-for="item in g.items"
          :key="item.type"
          class="palette-item"
          draggable="true"
          @dragstart="onPaletteDragStart($event, item.type)"
          @dragend="onDragEnd"
          @click="addToRoot(item.type)"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </div>
      </div>
    </aside>

    <!-- 中栏：画布 -->
    <section class="side side-center">
      <div class="center-toolbar">
        <div class="toolbar-group">
          <el-tooltip content="撤销 (Ctrl+Z)">
            <el-button size="small" :icon="RefreshLeft" :disabled="!canUndo" @click="undo" />
          </el-tooltip>
          <el-tooltip content="重做 (Ctrl+Y)">
            <el-button size="small" :icon="RefreshRight" :disabled="!canRedo" @click="redo" />
          </el-tooltip>
          <el-tooltip content="复制选中组件">
            <el-button size="small" :icon="CopyDocument" :disabled="!selectedNode" @click="selectedNode && duplicate(selectedNode.id)" />
          </el-tooltip>
          <el-tooltip content="删除选中组件 (Delete)">
            <el-button size="small" :icon="Delete" :disabled="!selectedNode" @click="selectedNode && remove(selectedNode.id)" />
          </el-tooltip>
        </div>

        <el-radio-group v-model="deviceMode" size="small">
          <el-radio-button value="pc">PC</el-radio-button>
          <el-radio-button value="tablet">平板</el-radio-button>
          <el-radio-button value="phone">手机</el-radio-button>
        </el-radio-group>

        <div class="toolbar-group">
          <el-button size="small" type="primary" :icon="Promotion" @click="publishVisible = true">发布</el-button>
          <el-button size="small" :icon="View" @click="openPreview">预览</el-button>
          <el-button size="small" :icon="Download" @click="openExport('vue')">导出</el-button>
          <el-button size="small" @click="createNew">新建</el-button>
          <el-button size="small" @click="restoreExample">示例</el-button>
        </div>
      </div>

      <div class="canvas-scroll">
        <div class="canvas-frame" :style="{ maxWidth: deviceWidth }">
          <SchemaRenderer
            v-if="schema"
            :node="schema"
            :selected-id="selectedId"
            :editable="true"
            @select="select"
          />
        </div>
      </div>

      <div class="center-footer">
        <span>页面组件 {{ outlineItems.length }} 个</span>
        <span v-if="savedAt">已自动保存 {{ savedAt }}</span>
      </div>
    </section>

    <!-- 右栏：属性 / 大纲 -->
    <aside class="side side-right">
      <el-tabs v-model="outlineTabs" class="right-tabs">
        <el-tab-pane label="属性" name="props">
          <PropPanel :node="selectedNode" />
        </el-tab-pane>
        <el-tab-pane label="大纲" name="tree">
          <div class="outline">
            <div
              v-for="item in outlineItems"
              :key="item.node.id"
              class="outline-item"
              :class="{ active: item.node.id === selectedId }"
              :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
              @click="select(item.node)"
            >
              <el-icon><FolderOpened v-if="item.node.children && item.node.children.length" /><component :is="getPageComponent(item.node.type)?.icon || 'Grid'" v-else /></el-icon>
              <span class="outline-label">{{ outlineLabel(item.node) }}</span>
            </div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </aside>

    <!-- 预览对话框 -->
    <el-dialog v-model="previewVisible" title="页面预览（可切换多端尺寸）" width="96%" top="3vh">
      <div style="text-align: center; margin-bottom: 12px">
        <el-radio-group v-model="previewDevice" size="small">
          <el-radio-button value="pc">PC</el-radio-button>
          <el-radio-button value="tablet">平板</el-radio-button>
          <el-radio-button value="phone">手机</el-radio-button>
        </el-radio-group>
      </div>
      <div class="preview-frame" :style="{ maxWidth: previewDevice === 'pc' ? '100%' : previewDevice === 'tablet' ? '768px' : '375px' }">
        <SchemaRenderer :node="schema" />
      </div>
    </el-dialog>

    <!-- 导出对话框 -->
    <el-dialog v-model="exportVisible" title="导出代码" width="720px" top="6vh">
      <div class="export-tabs">
        <el-radio-group v-model="exportType" size="small">
          <el-radio-button value="vue">Vue 组件</el-radio-button>
          <el-radio-button value="json">JSON Schema</el-radio-button>
        </el-radio-group>
        <div>
          <el-button size="small" @click="copyCode">复制</el-button>
          <el-button size="small" type="primary" :icon="Download" @click="downloadCode">下载</el-button>
        </div>
      </div>
      <pre class="code-block"><code>{{ exportCode }}</code></pre>
    </el-dialog>

    <!-- AI 连续生成 / 追问侧栏（非模态，画布实时预览） -->
    <el-drawer v-model="chatVisible" title="AI 页面助手" direction="rtl" size="440px" :modal="false">
      <div style="display: flex; flex-direction: column; height: 100%">
        <div style="font-size: 12px; color: #909399; margin-bottom: 8px; line-height: 1.5">
          先用大白话描述需求→“生成页面”；再逐条提修改→“追问修改”。页面会实时更新，满意后点右上角“发布”。
        </div>
        <div ref="chatListEl" style="flex: 1; overflow-y: auto; background: #f7f8fa; border-radius: 8px; padding: 10px; margin-bottom: 10px">
          <div v-if="!chatMsgs.length" style="color: #b0b3b8; font-size: 13px; text-align: center; padding: 24px 8px">
            还没有对话。试着说：“生成一个订单管理页，用真实数据”
          </div>
          <div
            v-for="(m, i) in chatMsgs"
            :key="i"
            :style="{
              display: 'flex',
              justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
              marginBottom: '8px',
            }"
          >
            <div
              :style="{
                maxWidth: '85%',
                padding: '8px 10px',
                borderRadius: '8px',
                fontSize: '13px',
                lineHeight: '1.5',
                whiteSpace: 'pre-wrap',
                background: m.role === 'user' ? '#409eff' : '#fff',
                color: m.role === 'user' ? '#fff' : '#303133',
                border: m.role === 'user' ? 'none' : '1px solid #ebeef5',
              }"
            >
              {{ m.role === "user" ? "🧑 " + m.text : "🤖 " + m.text }}
            </div>
          </div>
          <div v-if="chatBusy" style="color: #909399; font-size: 13px; padding: 4px 2px">🤖 思考中…（本地模型生成整页较慢，请稍候）</div>
        </div>
        <div style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px">
          <el-tag
            v-for="ex in EXAMPLE_PROMPTS"
            :key="ex"
            size="small"
            effect="plain"
            style="cursor: pointer"
            @click="useSample(ex)"
          >
            {{ ex }}
          </el-tag>
        </div>
        <el-input
          v-model="chatInput"
          type="textarea"
          :rows="3"
          resize="none"
          :disabled="chatBusy || optimizing"
          placeholder="描述页面或提出修改要求（回车发送）"
          @keydown.enter.exact.prevent="sendChat"
        />
        <div v-if="isFirstRound" style="display: flex; align-items: center; justify-content: space-between; margin-top: 6px">
          <el-button
            size="small"
            type="primary"
            plain
            :icon="MagicStick"
            :loading="optimizing"
            :disabled="chatBusy || !chatInput.trim()"
            @click="handleOptimize"
          >
            {{ optimizing ? "优化中…" : "✨ 优化描述" }}
          </el-button>
          <span v-if="optimizing" style="font-size: 12px; color: #e6a23c">⏳ 本地模型优化中，约需 10~30 秒…</span>
          <span v-else style="font-size: 12px; color: #909399">描述太笼统？先优化再生成</span>
        </div>
        <el-button
          type="primary"
          :icon="MagicStick"
          :loading="chatBusy"
          :disabled="optimizing"
          style="margin-top: 8px; width: 100%"
          @click="sendChat"
        >
          {{ chatBusy ? "生成中…" : isFirstRound ? "生成页面" : "追问修改" }}
        </el-button>
      </div>
    </el-drawer>

    <!-- 发布对话框 -->
    <PublishDialog
      v-model="publishVisible"
      kind="page"
      :schema="schema"
      :default-name="schema.text || schema.props?.title || '页面应用'"
      @published="onPublished"
    />
  </div>
</template>

<style scoped>
.page-designer {
  display: flex;
  gap: 12px;
  height: calc(100vh - 132px);
  min-height: 480px;
}
.side {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.side-left {
  width: 250px;
  padding: 14px;
  overflow-y: auto;
  flex-shrink: 0;
}
.side-right {
  width: 300px;
  flex-shrink: 0;
}
.side-center {
  flex: 1;
  min-width: 320px;
}
.side-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1f2d3d;
  margin-bottom: 8px;
}
.side-desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.5;
  margin: 0 0 12px;
}
.palette-group {
  margin-bottom: 12px;
}
.palette-group-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 6px;
  border-bottom: 1px solid #f0f2f5;
  padding-bottom: 4px;
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  margin-bottom: 6px;
  border: 1px solid #e4e7ed;
  border-radius: 6px;
  font-size: 13px;
  color: #303133;
  cursor: grab;
  transition: all 0.15s;
  user-select: none;
}
.palette-item:hover {
  border-color: #409eff;
  color: #409eff;
  background: #ecf5ff;
}
.palette-item:active {
  cursor: grabbing;
}
.center-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
  flex-wrap: wrap;
}
.toolbar-group {
  display: flex;
  gap: 6px;
}
.canvas-scroll {
  flex: 1;
  overflow: auto;
  background: #e8ebf0;
  padding: 20px;
}
.canvas-frame {
  margin: 0 auto;
  background: #fff;
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
  min-height: 80%;
}
.center-footer {
  display: flex;
  justify-content: space-between;
  padding: 6px 12px;
  font-size: 12px;
  color: #909399;
  border-top: 1px solid #ebeef5;
}
.right-tabs {
  height: 100%;
  display: flex;
  flex-direction: column;
}
.right-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 10px;
}
.right-tabs :deep(.el-tabs__content) {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
}
.outline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  color: #606266;
}
.outline-item:hover {
  background: #f5f7fa;
}
.outline-item.active {
  background: #ecf5ff;
  color: #409eff;
}
.outline-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.preview-frame {
  margin: 0 auto;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #f5f7fa;
  padding: 12px;
  max-height: 68vh;
  overflow: auto;
}
.export-tabs {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.code-block {
  margin: 0;
  padding: 16px;
  background: #282c34;
  color: #abb2bf;
  border-radius: 6px;
  max-height: 60vh;
  overflow: auto;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.ai-desc {
  font-size: 13px;
  color: #606266;
  margin: 0 0 12px;
}
.examples {
  margin: 10px 0;
}
.examples-label {
  font-size: 12px;
  color: #909399;
  margin-right: 6px;
}
.example-tag {
  cursor: pointer;
  margin: 2px 4px 2px 0;
}
.ai-upload :deep(.el-upload--picture-card) {
  width: 72px;
  height: 72px;
}
.ai-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
}
.matched {
  color: #67c23a;
  font-size: 12px;
  margin-right: auto;
}
</style>
