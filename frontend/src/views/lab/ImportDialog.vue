<script setup lang="ts">
// ============================================================================
// 实验室台账 · 批量导入对话框
//
// 流程：下载模板 → 在 Excel/WPS 里填 → 选中或拖入文件 → 本地按字段定义校验并预览
//       → 一次提交给后端（POST /api/crud/:resource/import，服务端一次落库）。
//
// 为什么本地先校验一遍：用户改的是 Excel，等到接口报错才发现「设备编号写错」成本高；
//   预览里直接标出第几行、哪一列、为什么不行，改完再传。
// 服务端仍会复核必填/重号/编号（不能信客户端），这里只是把明显的问题提前拦住。
//
// 排版取向：未选文件时只有一句话说明 + 一条上传栏（不把对话框撑成半屏空白）；
//   填写规则默认收起，需要时再展开看，避免规则文字盖掉主操作区。
//
// 两种处理策略：跳过错误行（合法的先入库）/ 整批不导（有错就一行都不写，改完重传）。
// ============================================================================
import { computed, ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Document, Refresh, UploadFilled } from "@element-plus/icons-vue";
import { importCrud, listCrud, type ImportRowError } from "../../api/crud";
import type { LabResource } from "./resources";
import {
  MAX_IMPORT_ROWS,
  PREVIEW_LIMIT,
  buildTemplateCsv,
  downloadText,
  fieldHints,
  parseCsvAuto,
  parseImportTable,
  readCsvText,
  templateFileName,
  type ImportParseResult,
} from "./labImport";

const visible = defineModel<boolean>({ required: true });
const props = defineProps<{
  def: LabResource;
  /** 引用台账数据（来源资源名 → 行），由页面已加载的下拉源传入，用于校验关联编号是否存在 */
  refs: Record<string, Record<string, any>[]>;
}>();
const emit = defineEmits<{ (e: "imported", rows: Record<string, any>[]): void }>();

const parsed = ref<ImportParseResult | null>(null);
const fileName = ref("");
const parsing = ref(false);
const rulesOpen = ref(false);
/** 查重覆盖说明（只对定义了 unique 字段的台账拉现有记录） */
const dedupNote = ref("");
/** skip：跳过错误行只导合法行；strict：有错误行就整批不导 */
const mode = ref<"skip" | "strict">("skip");
const submitting = ref(false);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement>();
/** 服务端复核后拒绝的行（本地校验通过但服务端仍可能判错，如重号） */
const serverErrors = ref<ImportRowError[]>([]);

const rows = computed(() => parsed.value?.rows ?? []);
const badRows = computed(() => rows.value.filter((r) => r.errors.length));
const goodRows = computed(() => rows.value.filter((r) => !r.errors.length));
const previewRows = computed(() => rows.value.slice(0, PREVIEW_LIMIT));
const overLimit = computed(() => rows.value.length > MAX_IMPORT_ROWS);
/** 整批模式下有错误行时不允许提交（否则用户会以为已经导进去了） */
const blockedByErrors = computed(() => mode.value === "strict" && badRows.value.length > 0);
const canSubmit = computed(
  () => !!parsed.value && parsed.value.headerFound && goodRows.value.length > 0 && !overLimit.value && !blockedByErrors.value,
);
const hints = computed(() => fieldHints(props.def));

function reset() {
  parsed.value = null;
  fileName.value = "";
  serverErrors.value = [];
  dedupNote.value = "";
  if (fileInput.value) fileInput.value.value = "";
}

watch(visible, (v) => {
  if (v) reset();
});

/**
 * 拉本台账现有记录用于 unique 查重。
 * 只拉前几页：台账量级大时全量拉会卡住解析，拉不到的部分在提示里写明覆盖范围，
 * 不假装“已全部比对”。没有 unique 字段的台账不发这个请求。
 */
async function fetchExisting(): Promise<{ rows: Record<string, any>[]; note: string }> {
  const uniqLabels = props.def.fields.filter((f) => f.unique).map((f) => f.label);
  if (!uniqLabels.length) return { rows: [], note: "" };
  const all: Record<string, any>[] = [];
  let total = 0;
  for (let p = 1; p <= 5; p += 1) {
    const r = await listCrud(props.def.resource, { page: p, pageSize: 200 });
    if (!r.ok) break;
    all.push(...r.list);
    total = r.total;
    if (all.length >= total || !r.list.length) break;
  }
  const note =
    all.length >= total
      ? `已按现有 ${all.length} 条记录查重（${uniqLabels.join("、")}不可重复）`
      : `台账共 ${total} 条，本次查重只覆盖前 ${all.length} 条（${uniqLabels.join("、")}）`;
  return { rows: all, note };
}

async function handleFile(file: File | undefined | null) {
  if (!file) return;
  if (!/\.(csv|txt|tsv)$/i.test(file.name)) {
    ElMessage.error("请选择 CSV 文件（模板就是 CSV，Excel 里「另存为 CSV」也可以）");
    return;
  }
  fileName.value = file.name;
  serverErrors.value = [];
  parsed.value = null;
  parsing.value = true;
  try {
    const text = await readCsvText(file);
    const table = parseCsvAuto(text);
    const { rows: existing, note } = await fetchExisting();
    dedupNote.value = note;
    const result = parseImportTable(props.def, props.refs, table, existing);
    if (!result.headerFound) {
      parsed.value = result;
      ElMessage.error("没找到可识别的列名，请先下载模板并按模板第 1 行的列名填写");
      return;
    }
    parsed.value = result;
    if (!result.totalDataRows) ElMessage.warning("文件里只有表头和说明行，没有数据行");
  } finally {
    parsing.value = false;
  }
}

function pickFile() {
  fileInput.value?.click();
}

function onDrop(e: DragEvent) {
  dragging.value = false;
  void handleFile(e.dataTransfer?.files?.[0]);
}

function downloadTemplate() {
  // 模板由字段定义现场生成：字段/选项改了，模板跟着变，不会出现一份过期的静态文件
  downloadText(templateFileName(props.def), buildTemplateCsv(props.def));
  ElMessage.success(`已下载「${props.def.title}」导入模板`);
}

async function submit() {
  if (!canSubmit.value || submitting.value) return;
  const payload = goodRows.value.map((r) => r.data);
  // 字段定义随请求上去：台账的必填信息只存在前端，不带服务端只能推出“全部非必填”；
  // 自动编号由服务端赋值，不标必填（否则空编号行会被误拦）
  const fields = props.def.fields
    .filter((f) => f.type !== "file")
    .map((f) => ({ prop: f.prop, label: f.label, required: !!f.required && !f.autoNo }));
  submitting.value = true;
  try {
    const r = await importCrud(props.def.resource, payload, { skipErrors: mode.value === "skip", fields });
    if (!r.ok || !r.result) {
      ElMessage.error(r.error || "导入失败");
      return;
    }
    serverErrors.value = r.result.errors || [];
    const created = r.result.created;
    if (created > 0) {
      ElMessage.success(`已导入 ${created} 条${serverErrors.value.length ? `，${serverErrors.value.length} 行被服务端拒绝` : ""}`);
      emit("imported", payload.slice(0, created));
      visible.value = false;
      return;
    }
    if (serverErrors.value.length) {
      ElMessage.error(`服务端拒绝了 ${serverErrors.value.length} 行，一条都没写入，请照下方原因修正`);
    } else {
      ElMessage.warning("没有行被写入");
    }
  } finally {
    submitting.value = false;
  }
}

/** 行号 → 文件里的实际行（用户在 Excel 里定位要用） */
function lineOf(idx: number): number {
  return rows.value[idx]?.line ?? idx + 2;
}

function rowClass({ row }: { row: (typeof rows.value)[number] }) {
  return row.errors.length ? "row-bad" : "";
}
</script>

<template>
  <el-dialog v-model="visible" :title="`导入${def.title}`" width="880px" top="8vh" destroy-on-close>
    <div class="tip">
      <div class="tip-text">
        先在 Excel 里按模板填写：第 1 行是列名（勿改），<b>#</b> 开头的是说明行，导入时自动忽略、可留着。
        列名与「导出 CSV」一致，导出的存量数据改改也能导回来。
      </div>
      <div class="tip-actions">
        <el-button size="small" :icon="Document" @click="downloadTemplate">下载模板</el-button>
        <el-button size="small" text type="primary" @click="rulesOpen = !rulesOpen">
          {{ rulesOpen ? "收起规则" : "填写规则" }}
        </el-button>
      </div>
    </div>
    <div v-show="rulesOpen" class="rules">
      <div v-for="(h, i) in hints" :key="i" class="rule">{{ h }}</div>
    </div>

    <div
      class="drop"
      :class="{ dragging, has: !!fileName }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
      @click="pickFile"
    >
      <el-icon class="up"><UploadFilled /></el-icon>
      <div class="drop-text">
        <span v-if="!fileName">点击选择 CSV 文件，或把文件拖到这里</span>
        <span v-else-if="parsing">正在解析并校验…</span>
        <span v-else><b>{{ fileName }}</b><span class="dim">（点击或拖入可替换）</span></span>
      </div>
      <span class="drop-fmt">支持 .csv / .txt / .tsv，单次 ≤ {{ MAX_IMPORT_ROWS }} 行</span>
      <input
        ref="fileInput"
        type="file"
        accept=".csv,.txt,.tsv"
        class="hide"
        @change="handleFile(($event.target as HTMLInputElement).files?.[0])"
      />
    </div>

    <template v-if="parsed && parsed.headerFound">
      <div class="sum">
        <span>共 <b>{{ parsed.totalDataRows }}</b> 行</span>
        <el-divider direction="vertical" />
        <span class="ok">可导入 {{ goodRows.length }}</span>
        <span class="bad" v-if="badRows.length">异常 {{ badRows.length }}</span>
        <span v-if="overLimit" class="bad">超过单次上限 {{ MAX_IMPORT_ROWS }} 行，请拆分</span>
        <span v-if="dedupNote" class="dim">{{ dedupNote }}</span>
        <span v-if="parsed.ignoredColumns.length" class="dim">忽略未识别列：{{ parsed.ignoredColumns.join("、") }}</span>
      </div>

      <div v-if="badRows.length" class="errs">
        <div v-for="r in badRows.slice(0, 30)" :key="r.line" class="err">
          第 {{ r.line }} 行：{{ r.errors.map((e) => `${e.label}—${e.message}`).join("；") }}
        </div>
        <div v-if="badRows.length > 30" class="dim">……另有 {{ badRows.length - 30 }} 行异常，见下表红色行</div>
      </div>

      <div v-if="serverErrors.length" class="errs">
        <div class="err-t">服务端复核未通过（多为编号重号或必填缺失）：</div>
        <div v-for="(e, i) in serverErrors.slice(0, 20)" :key="i" class="err">提交第 {{ e.row }} 行：{{ e.error }}</div>
      </div>

      <div class="pv">
        <div class="pv-head">
          <span>数据预览</span>
          <span class="dim">最多显示 {{ PREVIEW_LIMIT }} 行，实际导入按文件全部行</span>
        </div>
        <el-table :data="previewRows" :row-class-name="rowClass" border size="small" max-height="280" style="width: 100%">
          <el-table-column label="行号" width="70" align="center" fixed>
            <template #default="{ $index }">{{ lineOf($index) }}</template>
          </el-table-column>
          <el-table-column label="校验" width="72" align="center" fixed>
            <template #default="{ row }">
              <el-tag :type="row.errors.length ? 'danger' : 'success'" size="small" effect="plain">
                {{ row.errors.length ? "异常" : "正常" }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column v-for="f in def.fields" :key="f.prop" :label="f.label" min-width="130" show-overflow-tooltip>
            <template #default="{ row }">
              <span v-if="f.type === 'file'" class="dim">（页面内上传）</span>
              <span v-else>{{ row.cells[f.prop] || "-" }}</span>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <el-radio-group v-model="mode" class="mode">
        <el-radio value="skip">跳过异常行，先导入 {{ goodRows.length }} 行</el-radio>
        <el-radio value="strict">异常行修正后整批导入（有异常则一行都不导）</el-radio>
      </el-radio-group>
    </template>

    <template #footer>
      <el-button v-if="fileName" :icon="Refresh" @click="reset">清空</el-button>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="submitting" :disabled="!canSubmit || parsing" @click="submit">
        导入 {{ goodRows.length }} 条
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
/* 说明条：一句话 + 两个动作，占位尽量矮 */
.tip {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 9px 12px;
  border-left: 3px solid var(--el-color-primary);
  background: var(--el-fill-color-light);
  border-radius: 4px;
}
.tip-text {
  flex: 1;
  min-width: 0;
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-text-color-secondary);
}
.tip-actions {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}
/* 填写规则：两栏排，避免一列拉到底读起来累 */
.rules {
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 4px;
  max-height: 220px;
  overflow: auto;
  column-count: 2;
  column-gap: 28px;
}
.rule {
  break-inside: avoid;
  font-size: 12px;
  line-height: 1.8;
  color: var(--el-text-color-regular);
}
/* 上传栏：单行高度，不再是一大块空白 */
.drop {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  padding: 11px 14px;
  border: 1px dashed var(--el-border-color);
  border-radius: 6px;
  cursor: pointer;
  background: var(--el-fill-color-blank);
  transition: border-color 0.2s, background 0.2s;
}
.drop:hover,
.drop.dragging {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}
.drop .up {
  font-size: 20px;
  color: var(--el-color-primary);
}
.drop-text {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  color: var(--el-text-color-regular);
}
.drop.has .drop-text {
  color: var(--el-text-color-primary);
}
.drop-fmt {
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-placeholder);
}
.hide {
  display: none;
}
.dim {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.sum {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 4px 10px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--el-text-color-regular);
}
.sum b {
  color: var(--el-color-primary);
}
.sum .ok {
  color: var(--el-color-success);
  font-weight: 600;
}
.sum .bad {
  color: var(--el-color-danger);
  font-weight: 600;
}
.errs {
  margin-top: 6px;
  padding: 8px 10px;
  background: var(--el-color-danger-light-9);
  border-radius: 4px;
  max-height: 104px;
  overflow: auto;
}
.err-t {
  font-size: 12px;
  font-weight: 600;
  color: var(--el-color-danger);
  margin-bottom: 2px;
}
.err {
  font-size: 12px;
  line-height: 1.7;
  color: var(--el-color-danger);
}
.pv {
  margin-top: 10px;
}
.pv-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}
.mode {
  margin-top: 10px;
  display: flex;
  align-items: center;
  gap: 20px;
}
:deep(.row-bad) {
  background: var(--el-color-danger-light-9);
}
</style>
