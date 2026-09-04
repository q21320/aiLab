<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { ElMessage } from "element-plus";
import type { UploadFile } from "element-plus";
import {
  MagicStick,
  Download,
  Delete,
  Refresh,
  View,
  EditPen,
  Setting,
  Upload,
} from "@element-plus/icons-vue";
import SchemaRenderer from "../../lowcode/SchemaRenderer.vue";
import PropPanel from "../../lowcode/PropPanel.vue";
import { generateSchema, EXAMPLE_PROMPTS } from "../../lowcode/generator";
import { schemaToVue, schemaToJson } from "../../lowcode/exporter";
import type { PageSchema, SchemaNode } from "../../lowcode/types";

// AI 输入与生成状态
const prompt = ref("");
const generating = ref(false);
const matched = ref("");
const uploadFiles = ref<UploadFile[]>([]);

// 页面 Schema 与选中节点
const schema = ref<PageSchema | null>(null);
const selectedNode = ref<SchemaNode | null>(null);
const selectedId = ref("");

// 中间区视图模式：预览 / Schema
const viewMode = ref<string>("preview");
const schemaText = ref("");

// 导出对话框
const exportVisible = ref(false);
const exportType = ref<string>("vue");
const exportCode = ref("");

const hasSchema = computed(() => !!schema.value);

/** 调用 Mock AI 生成页面 */
async function handleGenerate() {
  if (!prompt.value.trim() && uploadFiles.value.length === 0) {
    ElMessage.warning("请输入描述或上传图片");
    return;
  }
  generating.value = true;
  matched.value = "";
  try {
    const res = await generateSchema(prompt.value);
    schema.value = res.schema;
    matched.value = res.matched;
    clearSelection();
    viewMode.value = "preview";
    ElMessage.success(`已生成「${res.matched}」`);
  } finally {
    generating.value = false;
  }
}

new Promise<void>(resolve => {
  setTimeout(resolve, 1000);
}).then(() => {
  useExample(EXAMPLE_PROMPTS[0]);
}).catch(console.error).finally(
  () => {
    console.log("Example loaded");
  }
);

/** 选中预览中的组件 */
function handleSelect(node: SchemaNode) {
  selectedNode.value = node;
  selectedId.value = node.id;
}

function clearSelection() {
  selectedNode.value = null;
  selectedId.value = "";
}

/** 切换到 Schema 视图时，序列化当前结构 */
watch(viewMode, (mode) => {
  if (mode === "schema" && schema.value) {
    schemaText.value = schemaToJson(schema.value);
  }
});

/** 从预览同步最新结构到 Schema 文本 */
function syncFromPreview() {
  if (schema.value) {
    schemaText.value = schemaToJson(schema.value);
    ElMessage.success("已同步最新结构");
  }
}

/** 将编辑后的 Schema 文本应用到预览 */
function applySchemaText() {
  try {
    const parsed = JSON.parse(schemaText.value);
    if (!parsed || parsed.type !== "page") {
      ElMessage.error('根节点 type 必须为 "page"');
      return;
    }
    schema.value = parsed as PageSchema;
    clearSelection();
    ElMessage.success("已应用到预览");
  } catch {
    ElMessage.error("JSON 解析失败，请检查格式");
  }
}

function handleClear() {
  schema.value = null;
  clearSelection();
  matched.value = "";
  schemaText.value = "";
  uploadFiles.value = [];
}

/** 生成导出代码 */
function regenerateCode() {
  if (!schema.value) return;
  exportCode.value =
    exportType.value === "vue"
      ? schemaToVue(schema.value)
      : schemaToJson(schema.value);
}

watch(exportType, regenerateCode);

function openExport(type: string) {
  if (!schema.value) {
    ElMessage.warning("请先生成页面");
    return;
  }
  exportType.value = type;
  regenerateCode();
  exportVisible.value = true;
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(exportCode.value);
    ElMessage.success("已复制到剪贴板");
  } catch {
    ElMessage.error("复制失败，请手动选择复制");
  }
}

function downloadCode() {
  const filename =
    exportType.value === "vue" ? "GeneratedPage.vue" : "schema.json";
  const blob = new Blob([exportCode.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已开始下载");
}

function useExample(text: string) {
  prompt.value = text;
}

/** 图片上传处理 */
function handleUploadChange(file: UploadFile) {
  if (file.raw && !file.raw.type.startsWith("image/")) {
    ElMessage.error("只能上传图片文件");
    return false;
  }
}

function handleUploadRemove() {
  // 文件移除时自动更新 uploadFiles
}
</script>

<template>
  <div class="lowcode">
    <!-- 左栏：AI 生成 -->
    <aside class="panel panel-left">
      <div class="panel-title">
        <el-icon><MagicStick /></el-icon>
        <span>AI 页面生成</span>
      </div>
      <p class="desc">
        用自然语言描述或上传参考图，AI 将生成可预览、可编辑的页面结构。
      </p>

      <!-- 文本输入 -->
      <el-input
        v-model="prompt"
        type="textarea"
        :rows="4"
        resize="none"
        placeholder="描述你想要的页面，例如：一个用户登录页面"
        class="prompt-input"
      />

      <!-- 图片上传 -->
      <div class="upload-section">
        <div class="upload-label">
          <el-icon><Upload /></el-icon>
          <span>上传参考图（可选）</span>
        </div>
        <el-upload
          v-model:file-list="uploadFiles"
          :auto-upload="false"
          :on-change="handleUploadChange"
          :on-remove="handleUploadRemove"
          list-type="picture-card"
          :limit="3"
          accept="image/*"
        >
          <el-icon><Plus /></el-icon>
        </el-upload>
      </div>

      <!-- 示例提示词 -->
      <div class="examples">
        <div class="examples-label">试试这些示例：</div>
        <div class="example-tags">
          <el-tag
            v-for="ex in EXAMPLE_PROMPTS"
            :key="ex"
            class="example-tag"
            effect="plain"
            size="small"
            @click="useExample(ex)"
          >
            {{ ex }}
          </el-tag>
        </div>
      </div>

      <!-- 生成按钮 -->
      <el-button
        type="primary"
        class="gen-btn"
        :icon="MagicStick"
        :loading="generating"
        @click="handleGenerate"
      >
        {{ generating ? "AI 生成中..." : "生成页面" }}
      </el-button>

      <!-- AI 识别结果 -->
      <div v-if="matched" class="matched">
        AI 识别为：<el-tag size="small" type="success">{{ matched }}</el-tag>
      </div>
    </aside>

    <!-- 中栏：预览 / Schema -->
    <section class="panel panel-center">
      <div class="center-toolbar">
        <el-radio-group v-model="viewMode" size="small">
          <el-radio-button value="preview">
            <el-icon><View /></el-icon> 预览
          </el-radio-button>
          <el-radio-button value="schema">
            <el-icon><EditPen /></el-icon> Schema
          </el-radio-button>
        </el-radio-group>
        <div class="toolbar-right">
          <template v-if="viewMode === 'schema'">
            <el-button size="small" :icon="Refresh" @click="syncFromPreview">
              同步预览
            </el-button>
            <el-button size="small" type="primary" @click="applySchemaText">
              应用到预览
            </el-button>
          </template>
          <el-button size="small" :icon="Download" @click="openExport('vue')">
            导出 Vue
          </el-button>
          <el-button size="small" :icon="Download" @click="openExport('json')">
            导出 JSON
          </el-button>
          <el-button
            size="small"
            :icon="Delete"
            :disabled="!hasSchema"
            @click="handleClear"
          >
            清空
          </el-button>
        </div>
      </div>

      <div class="center-body">
        <!-- 预览 -->
        <div
          v-if="viewMode === 'preview'"
          class="preview-wrap"
          @click="clearSelection"
        >
          <SchemaRenderer
            v-if="schema"
            :node="schema"
            :selected-id="selectedId"
            @select="handleSelect"
          />
          <el-empty
            v-else
            description="在左侧描述你的需求，点击「生成页面」开始"
          />
        </div>
        <!-- Schema 编辑 -->
        <div v-else class="schema-wrap">
          <el-input
            v-model="schemaText"
            type="textarea"
            resize="none"
            spellcheck="false"
            class="schema-editor"
            placeholder="生成页面后可在此查看和编辑 JSON Schema"
          />
        </div>
      </div>
    </section>

    <!-- 右栏：组件属性 -->
    <aside class="panel panel-right">
      <div class="panel-title">
        <el-icon><Setting /></el-icon>
        <span>组件属性</span>
      </div>
      <PropPanel :node="selectedNode" />
    </aside>

    <!-- 导出对话框 -->
    <el-dialog v-model="exportVisible" title="导出代码" width="720px" top="6vh">
      <div class="export-tabs">
        <el-radio-group v-model="exportType" size="small">
          <el-radio-button value="vue">Vue 组件</el-radio-button>
          <el-radio-button value="json">JSON Schema</el-radio-button>
        </el-radio-group>
        <div>
          <el-button size="small" @click="copyCode">复制</el-button>
          <el-button size="small" type="primary" :icon="Download" @click="downloadCode">
            下载
          </el-button>
        </div>
      </div>
      <pre class="code-block"><code>{{ exportCode }}</code></pre>
    </el-dialog>
  </div>
</template>

<style scoped>
.lowcode {
  display: flex;
  gap: 16px;
  height: calc(100vh - 100px);
}
.panel {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
}
.panel-left {
  width: 340px;
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}
.panel-right {
  width: 300px;
  padding: 16px;
  overflow-y: auto;
  flex-shrink: 0;
}
.panel-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}
.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  color: #1f2d3d;
  margin-bottom: 12px;
}
.desc {
  font-size: 12px;
  color: #909399;
  line-height: 1.6;
  margin: 0 0 12px;
}
.prompt-input {
  margin-bottom: 12px;
}
.prompt-input :deep(textarea) {
  font-size: 13px;
}
.upload-section {
  margin-bottom: 14px;
}
.upload-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #606266;
  margin-bottom: 8px;
}
.upload-section :deep(.el-upload--picture-card) {
  width: 72px;
  height: 72px;
}
.upload-section :deep(.el-upload-list--picture-card .el-upload-list__item) {
  width: 72px;
  height: 72px;
}
.examples {
  margin-bottom: 14px;
}
.examples-label {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
}
.example-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.example-tag {
  cursor: pointer;
  transition: all 0.2s;
}
.example-tag:hover {
  color: #409eff;
  border-color: #409eff;
}
.gen-btn {
  width: 100%;
  margin-bottom: 10px;
}
.matched {
  font-size: 13px;
  color: #606266;
}
.center-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid #ebeef5;
  flex-shrink: 0;
}
.toolbar-right {
  display: flex;
  gap: 8px;
}
.center-body {
  flex: 1;
  overflow: hidden;
}
.preview-wrap {
  height: 100%;
  overflow: auto;
  padding: 16px;
  background: #f5f7fa;
}
.schema-wrap {
  height: 100%;
}
.schema-editor {
  height: 100%;
}
.schema-editor :deep(textarea) {
  height: 100%;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 13px;
  line-height: 1.6;
  border: none;
  border-radius: 0;
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
  font-size: 13px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
