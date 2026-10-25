<script setup lang="ts">
// ============================================================================
// 实验室管理 · 通用台账页
//
// 一个组件覆盖全部台账类模块（项目/报销/财务/客户/设备/耗材）：
//   字段由 resources.ts 定义驱动，数据走平台通用 CRUD（/api/crud/<resource>）
//   → 新增模块 = 加一份字段定义 + 一条路由，无需复制页面代码。
//
// 权限：当前角色对该页面只有 view 时自动进入只读模式（隐藏新增/编辑/删除）；
//       写操作后端同样按页面的 edit 权限拦截，前端收敛只是为了不报 403。
// 模块：项目分【测试项目】与【委外项目】两张台账；收入项目选测试、支出项目选委外，
//       选中后用 refFill 带出单位/联系人/对接人/金额，避免同一信息录两遍。
// 编号：标记 autoNo 的字段（如项目编号 Z-20261025-0001）由服务端按日期分配序号，
//       表单只读展示预估值，保存时服务端重新算号，两人同时录入不会重号。
// 附件：type=file 的字段可上传多个文件（值只存元数据，二进制在后端库里）。
// 导入：「下载模板」按字段定义现生成 CSV，「导入」走批量接口（一次落库），
//       字段规则与模板同源，不会出现模板写旧选项、校验按新规则的情况。
// 说明：资源首次使用时尚不存在（后端 GET 返回 404），此处按“暂无数据”处理，
//       用户新增第一条时后端会自动建资源，无需预置表结构。
// ============================================================================
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { Delete, Download, Edit, Plus, Refresh, Search, Upload } from "@element-plus/icons-vue";
import { createCrud, deleteCrud, listCrud, nextCrudNo, updateCrud } from "../../api/crud";
import { attachmentUrl, MAX_UPLOAD_MB, sizeText, toRefs, uploadAttachment, type AttachmentRef } from "../../api/attachments";
import { useAclStore } from "../../stores/acl";
import { useViewport } from "../../utils/viewport";
import type { LabField, LabResource } from "./resources";
import { refOptionsOf } from "./labImport";
import ImportDialog from "./ImportDialog.vue";

const props = defineProps<{ def: LabResource }>();
const def = computed(() => props.def);
const route = useRoute();
const acl = useAclStore();
/** 只读：没有本页面的可写权限（服务端「角色权限」配置，管理员恒可写） */
const readonly = computed(() => !acl.canEdit(route.path));

const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const keyword = ref("");
const loading = ref(false);

// ------------------------------------------------------- 关联字段（type=ref）
// 选项来自被引用的台账（如项目「使用设备」→ 设备信息）；缓存源数据，
// 选项在渲染时按字段定义派生，避免多字段共用同一资源时重复请求。
const refRows = reactive<Record<string, Record<string, any>[]>>({});
/** 源台账加载失败（多为没有该页面的查看权限）：下拉空提示要说清原因，不能只说“暂无数据” */
const refFailed = reactive<Record<string, boolean>>({});

async function loadRef(resource: string) {
  const r = await listCrud(resource, { page: 1, pageSize: 200 });
  refRows[resource] = r.ok ? r.list : [];
  refFailed[resource] = !r.ok;
}

async function loadRefs() {
  const targets = Array.from(
    new Set(
      def.value.fields
        .filter((f) => f.type === "ref" && f.refResource)
        .map((f) => f.refResource as string),
    ),
  );
  await Promise.all(targets.map(loadRef));
}

/** 关联字段的下拉选项（拼标签规则与导入模板共用 labImport.refOptionsOf） */
function refOptions(f: LabField) {
  const res = f.refResource;
  if (!res) return [];
  return refOptionsOf(f, refRows[res] || []);
}

/** 下拉无可选项时的提示：区分“没权限”与“台账本来就还没录” */
function refEmptyText(f: LabField): string {
  const res = f.refResource;
  if (res && refFailed[res]) return "无法加载列表（可能没有对应台账页面的查看权限，请联系管理员在「角色权限」配置）";
  return "暂无可选项，请先到对应台账录入";
}

/**
 * 选完关联台账后带出兄弟字段（refFill）。
 * 只在用户改动下拉时执行：编辑旧记录不会被动覆写已录数据；
 * 来源值为空的字段不覆盖（保留已手填内容），附件/日期范围类字段不参与带出。
 */
function applyRefFill(f: LabField) {
  const map = f.refFill;
  const res = f.refResource;
  if (!map || !res) return;
  const picked = String(model[f.prop] ?? "").trim();
  if (!picked) return;
  const vp = f.refValueProp || "id";
  const source = (refRows[res] || []).find((r) => String(r[vp] ?? "").trim() === picked);
  if (!source) return;
  for (const [targetProp, src] of Object.entries(map)) {
    // 来源与目标单位不同时写 [来源字段, 系数]（如元→万元：["price", 0.0001]）
    const [srcProp, scale] = Array.isArray(src) ? src : [src, 1];
    const target = def.value.fields.find((x) => x.prop === targetProp);
    if (!target || target.type === "file" || target.type === "daterange") continue;
    const raw = source[srcProp];
    if (raw === undefined || raw === null || String(raw).trim() === "") continue;
    if (target.type === "number") {
      const n = Number(raw);
      // 换算后取 2 位小数（万元下的 2 位 = 元精度），并避免浮点尾巴
      model[targetProp] = Number.isFinite(n) ? Math.round(n * scale * 100) / 100 : raw;
    } else {
      model[targetProp] = raw;
    }
  }
}

/** 关联字段在表格中的展示：存编号，显示名称（配了 refLabelProps 时按多字段显示） */
function refText(f: LabField, v: any): string {
  const codes = Array.isArray(v)
    ? v.map((x) => String(x ?? "").trim())
    : String(v ?? "")
        .split(/[,，、]/)
        .map((s) => s.trim());
  const list = codes.filter(Boolean);
  if (!list.length) return "-";
  const res = f.refResource;
  const source = res ? refRows[res] || [] : [];
  const vp = f.refValueProp || "id";
  const lp = f.refLabelProp || vp;
  return list
    .map((c) => {
      const hit = source.find((r) => String(r[vp] ?? "") === c);
      if (!hit) return c;
      if (f.refLabelProps?.length) {
        const text = f.refLabelProps.map((p) => String(hit[p] ?? "").trim()).filter(Boolean).join(" · ");
        return text || c;
      }
      return lp === vp ? c : String(hit[lp] ?? c);
    })
    .join("、");
}

// ------------------------------------------------------------ 附件（type=file）
// 字段值形状：[{ id, name, size, mime, url }]，只存元数据，二进制落在后端
// PostgreSQL attachments 表（容器重建不丢文件）。表单里点「删除」只是从本条记录
// 移除引用，不删服务端文件 —— 否则“上传完又取消编辑”会把已存于其他记录的同一附件带走。
const MAX_FILES_DEFAULT = 5;
/** 每个附件字段的上传中标记（多字段共存时互不干扰） */
const uploading = reactive<Record<string, number>>({});

function filesOf(v: unknown): AttachmentRef[] {
  return toRefs(v);
}

function maxFilesOf(f: LabField): number {
  return f.maxFiles ?? MAX_FILES_DEFAULT;
}

function uploadBusy(f: LabField): boolean {
  return (uploading[f.prop] || 0) > 0;
}

/** el-upload 自定义请求：走 /api/attachments（带来源资源名，服务端据此校页面可写权限） */
async function doUpload(f: LabField, options: any) {
  const file = options?.file as File | undefined;
  if (!file) return;
  const list = filesOf(model[f.prop]);
  if (list.length >= maxFilesOf(f)) {
    ElMessage.warning(`${f.label}最多 ${maxFilesOf(f)} 个附件`);
    return;
  }
  uploading[f.prop] = (uploading[f.prop] || 0) + 1;
  try {
    const r = await uploadAttachment(file, def.value.resource);
    if (!r.ok || !r.ref) {
      ElMessage.error(r.error || "上传失败");
      return;
    }
    model[f.prop] = [...filesOf(model[f.prop]), r.ref];
    ElMessage.success(`已上传「${r.ref.name}」`);
  } finally {
    uploading[f.prop] = Math.max(0, (uploading[f.prop] || 1) - 1);
  }
}

function removeFile(f: LabField, index: number) {
  const list = filesOf(model[f.prop]);
  list.splice(index, 1);
  model[f.prop] = list;
}

/** 表格列里的附件展示：最多两个名字 + 剩余个数 */
function cellFiles(v: unknown): AttachmentRef[] {
  return filesOf(v).slice(0, 2);
}

function moreFiles(v: unknown): string {
  const l = filesOf(v);
  return l.length > 2 ? l.slice(2).map((x) => x.name).join("、") : "";
}

/** 表格列（全部字段都可入列，长文本用 tooltip 收窄） */
const tableFields = computed(() => def.value.fields);

function labelOf(f: LabField, v: any): string {
  if (v === undefined || v === null || v === "") return "-";
  const hit = f.options?.find((o) => String(o.value) === String(v));
  return hit ? hit.label : String(v);
}

function money(v: any): string {
  if (v === undefined || v === null || v === "") return "-";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ------------------------------------------------------- 日期范围（type=daterange）
// 控件需要 [start, end] 数组，落库仍为「开始 ~ 结束」字符串，
// 历史数据（手录文本）也能回填与展示。
function toRange(v: any): string[] {
  if (Array.isArray(v)) return v.slice(0, 2).map((x) => String(x ?? "").trim());
  const parts = String(v ?? "")
    .split(/\s*(?:~|～|至|—|-->|\s-\s)\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.slice(0, 2);
}

function fromRange(v: any): string {
  const list = Array.isArray(v) ? v.filter(Boolean) : [];
  return list.length === 2 ? `${list[0]} ~ ${list[1]}` : "";
}

function rangeText(v: any): string {
  const list = toRange(v);
  return list.length ? list.join(" ~ ") : "-";
}

const seq = (i: number) => (page.value - 1) * pageSize.value + i + 1;

// ------------------------------------------------------- 手机卡片视图
// 台账十几列在手机上横滚体验差（操作列容易被划出屏幕），换成竖排卡片；
// 字段多寡由 resources.ts 定义驱动，这里不写死任何台账的字段名。
const { isMobile } = useViewport();

/** 卡片标题字段：第一个非自动编号的文本字段（通常是项目名/客户名），没有就取首列 */
const cardTitleField = computed<LabField | undefined>(
  () => tableFields.value.find((f) => f.type === "text" && !f.autoNo) || tableFields.value[0],
);
/** 卡片正文：标题以外的全部字段 */
const cardBodyFields = computed(() => {
  const t = cardTitleField.value;
  return tableFields.value.filter((f) => f.prop !== t?.prop);
});

/** 卡片里字段的展示文本（与表格渲染同一套规则）；空值返回 "" 让模板隐藏该行，卡片不膨胀 */
function cardValue(f: LabField, row: Record<string, any>): string {
  const v = row[f.prop];
  if (v === undefined || v === null || v === "") return "";
  switch (f.type) {
    case "select":
      return labelOf(f, v);
    case "switch":
      return v ? "是" : "否";
    case "ref":
      return refText(f, v);
    case "daterange":
      return rangeText(v);
    case "file": {
      const n = filesOf(v).length;
      return n ? `${n} 个附件` : "";
    }
    default:
      return f.money ? money(v) : String(v);
  }
}

async function load() {
  loading.value = true;
  try {
    const r = await listCrud(def.value.resource, {
      page: page.value,
      pageSize: pageSize.value,
      keyword: keyword.value.trim(),
    });
    if (!r.ok) {
      // 资源尚未创建（首次使用）→ 视为空台账，不打扰用户
      if (r.error && r.error.includes("资源不存在")) {
        rows.value = [];
        total.value = 0;
        return;
      }
      ElMessage.error(r.error || "加载失败");
      rows.value = [];
      total.value = 0;
      return;
    }
    rows.value = r.list;
    total.value = r.total;
  } finally {
    loading.value = false;
  }
}

function reload(p = 1) {
  page.value = p;
  void load();
}

function resetQuery() {
  keyword.value = "";
  reload(1);
}

onMounted(() => {
  void load();
  void loadRefs();
});

// ---------------------------------------------------------------- 新增 / 编辑
const dialogVisible = ref(false);
const dialogTitle = ref("");
const editingId = ref("");
/** 编辑前的原始行（业务联动需要对比变更前数据） */
const editingRow = ref<Record<string, any> | null>(null);
const formRef = ref<FormInstance>();
const model = reactive<Record<string, any>>({});

const rules = computed<FormRules>(() => {
  const out: FormRules = {};
  for (const f of def.value.fields) {
    // 自动编号由服务端赋值、附件不做录入强制，都不参与必填校验
    if (!f.required || f.autoNo || f.type === "file") continue;
    // 选择类控件（下拉 / 日期 / 日期范围）用 change 触发校验
    const pick = f.type === "select" || f.type === "date" || f.type === "daterange";
    out[f.prop] = [
      {
        required: true,
        message: `${pick ? "请选择" : "请输入"}${f.label}`,
        trigger: pick ? "change" : "blur",
      },
    ];
  }
  return out;
});

function fillModel(source: Record<string, any> = {}) {
  for (const f of def.value.fields) {
    const v = source[f.prop];
    if (f.type === "daterange") {
      model[f.prop] = toRange(v ?? f.defaultValue);
      continue;
    }
    if (f.type === "file") {
      model[f.prop] = filesOf(v);
      continue;
    }
    if (v !== undefined && v !== null) model[f.prop] = Array.isArray(v) ? [...v] : v;
    else if (f.type === "switch") model[f.prop] = f.defaultValue === true;
    else if (f.type === "number") model[f.prop] = f.defaultValue ?? undefined;
    else if (f.type === "ref") model[f.prop] = f.multiple ? [] : "";
    else model[f.prop] = f.defaultValue ?? "";
  }
}

// ---------------------------------------------------------- 自动编号（autoNo）
// 新增表单打开时先向服务端取一个预估值展示（让用户知道本次会用哪个号）；
// 保存时服务端会按当日最大序号重新算号，所以两人同时打开表单也能拿到连续且不重号的编号。
const autoNoFields = computed(() => def.value.fields.filter((f) => f.autoNo));

async function fillAutoNo() {
  for (const f of autoNoFields.value) {
    const dp = f.autoNoDateProp;
    const dv = dp ? model[dp] : "";
    const r = await nextCrudNo(def.value.resource, dp && dv ? { [dp]: String(dv) } : {});
    // 取号失败（如资源还未创建、没该页面权限）不阻断表单：留空则服务端自动补
    if (r.ok && r.value) model[f.prop] = r.value;
  }
}

/** 改了日期→编号换到那一天的序列；仅新增时刷新，编辑保持原编号 */
watch(
  () => autoNoFields.value.map((f) => String((f.autoNoDateProp ? model[f.autoNoDateProp] : "") ?? "")).join("|"),
  () => {
    if (dialogVisible.value && !editingId.value) void fillAutoNo();
  },
);

/** 本地日期 YYYY-MM-DD（不能用 toISOString：那是 UTC，午夜前后会差一天） */
function todayStr() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function openCreate() {
  editingId.value = "";
  editingRow.value = null;
  dialogTitle.value = `新增${def.value.title}`;
  fillModel();
  // 编号的“日期锚点”新增时默认今天：否则编号按今天序列分配、日期列却是空的，
  // 这条记录既看不懂归属哪天，也不会进仪表盘的“本月新增 / 近 6 个月”统计（按日期分组）。
  // 只影响新增（openEdit 不调用此处），用户仍可手动改成补录的实际日期。
  for (const f of autoNoFields.value) {
    const dp = f.autoNoDateProp;
    if (dp && !model[dp]) model[dp] = todayStr();
  }
  void fillAutoNo();
  dialogVisible.value = true;
  formRef.value?.clearValidate();
  void loadRefs();
}

function openEdit(row: Record<string, any>) {
  editingId.value = String(row.id ?? "");
  editingRow.value = row;
  dialogTitle.value = `编辑${def.value.title}`;
  fillModel(row);
  dialogVisible.value = true;
  formRef.value?.clearValidate();
  void loadRefs();
}

const saving = ref(false);

async function submit() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || saving.value) return;
  const data: Record<string, any> = {};
  for (const f of def.value.fields) {
    if (f.type === "file") data[f.prop] = filesOf(model[f.prop]);
    else data[f.prop] = f.type === "daterange" ? fromRange(model[f.prop]) : model[f.prop];
  }
  saving.value = true;
  try {
    const r = editingId.value
      ? await updateCrud(def.value.resource, editingId.value, data)
      : await createCrud(def.value.resource, data);
    if (!r.ok) {
      ElMessage.error(r.error || "保存失败");
      return;
    }
    ElMessage.success(editingId.value ? "修改成功" : "新增成功");
    dialogVisible.value = false;
    // 业务联动（如项目占用设备 → 设备状态变更）
    const effect = def.value.effects?.afterSave;
    if (effect) {
      try {
        const extra = await effect({ ...data }, editingRow.value ?? undefined);
        if (extra) ElMessage.info(String(extra));
      } catch {
        ElMessage.warning("记录已保存，但关联状态同步失败，请到「设备信息」核对");
      }
      await loadRefs();
    }
    await load();
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row: Record<string, any>) {
  // 用可读主标识（项目编号/名称）而非首列（可能是日期、金额）
  const title = row[def.value.labelProp] || row.id;
  try {
    await ElMessageBox.confirm(`确定删除「${title}」这条记录吗？`, "提示", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  const r = await deleteCrud(def.value.resource, String(row.id));
  if (!r.ok) {
    ElMessage.error(r.error || "删除失败");
    return;
  }
  ElMessage.success("删除成功");
  // 业务联动（如删除项目 → 释放其占用的设备）
  const effect = def.value.effects?.afterDelete;
  if (effect) {
    try {
      const extra = await effect(row);
      if (extra) ElMessage.info(String(extra));
    } catch {
      ElMessage.warning("删除已完成，但关联状态同步失败，请到「设备信息」核对");
    }
    await loadRefs();
  }
  // 删掉当前页最后一条时回到上一页，避免停在空页
  if (rows.value.length === 1 && page.value > 1) page.value -= 1;
  await load();
}

// ------------------------------------------------------------------ 导入
// 只留一个入口：模板下载放在导入对话框里（与“先按模板填”同一屏），
// 工具栏不再摆一排功能相近的按钮（导出与模板列名一致，但导出带存量数据、空台账时又拿不到表头）。
const importVisible = ref(false);

/** 导入写完后的收尾：业务联动整批算一次，然后刷新引用源与列表 */
async function afterImport(imported: Record<string, any>[]) {
  const effect = def.value.effects?.afterImport;
  if (effect) {
    try {
      const extra = await effect(imported);
      if (extra) ElMessage.info(String(extra));
    } catch {
      ElMessage.warning("记录已导入，但关联状态同步失败，请到「设备信息」核对");
    }
  }
  await loadRefs();
  await load();
}

// -------------------------------------------------------------------- 导出
function csvCell(v: any): string {
  const s = String(v ?? "").replace(/\r?\n/g, " ");
  return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const exporting = ref(false);

async function exportCsv() {
  exporting.value = true;
  try {
    const all: Record<string, any>[] = [];
    let p = 1;
    // 后端单页上限 200，按需分页拉全量
    for (;;) {
      const r = await listCrud(def.value.resource, { page: p, pageSize: 200, keyword: keyword.value.trim() });
      if (!r.ok) {
        if (all.length === 0 && r.error && r.error.includes("资源不存在")) {
          ElMessage.info("暂无数据可导出");
        } else if (!r.ok) {
          ElMessage.error(r.error || "导出失败");
        }
        break;
      }
      all.push(...r.list);
      if (all.length >= r.total || r.list.length === 0) break;
      p += 1;
    }
    if (!all.length) return;
    const header = def.value.fields.map((f) => csvCell(f.label)).join(",");
    const body = all
      .map((row) =>
        def.value.fields
          .map((f) =>
            f.type === "file"
              ? csvCell(filesOf(row[f.prop]).map((a) => a.name).join("、"))
              : csvCell(
                  f.type === "ref" ? refText(f, row[f.prop]) : f.type === "daterange" ? rangeText(row[f.prop]) : row[f.prop],
                ),
          )
          .join(","),
      )
      .join("\n");
    const blob = new Blob([`\ufeff${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${def.value.title}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success(`已导出 ${all.length} 条`);
  } finally {
    exporting.value = false;
  }
}
</script>

<template>
  <div class="lab-page">
    <el-card shadow="never">
      <div class="head">
        <div>
          <div class="title">{{ def.title }}</div>
          <div class="desc">{{ def.desc }}</div>
        </div>
        <el-tooltip
          v-if="readonly"
          content="当前角色对「本页面」只有只读权限，需要录入请管理员在「系统管理 → 角色权限」改为可写"
          placement="bottom"
        >
          <el-tag type="info" effect="plain" size="small">只读</el-tag>
        </el-tooltip>
      </div>

      <div class="toolbar">
        <el-input
          v-model="keyword"
          :placeholder="`搜索${def.title}（任意字段）`"
          :prefix-icon="Search"
          clearable
          style="width: 260px"
          @keyup.enter="reload(1)"
          @clear="reload(1)"
        />
        <el-button :icon="Search" @click="reload(1)">查询</el-button>
        <el-button :icon="Refresh" @click="resetQuery">重置</el-button>
        <div class="spacer" />
        <el-button :icon="Download" :loading="exporting" @click="exportCsv">导出 CSV</el-button>
        <el-button v-if="!readonly" :icon="Upload" @click="importVisible = true">导入</el-button>
        <el-button v-if="!readonly" type="primary" :icon="Plus" @click="openCreate">
          新增{{ def.title }}
        </el-button>
      </div>

      <el-table v-if="!isMobile" v-loading="loading" :data="rows" style="width: 100%" class="mt16" border>
        <el-table-column type="index" label="序号" width="64" :index="seq" align="center" />
        <el-table-column
          v-for="f in tableFields"
          :key="f.prop"
          :label="f.label"
          :width="f.width"
          :min-width="f.width ? undefined : 140"
          :align="f.money ? 'right' : 'left'"
          show-overflow-tooltip
        >
          <template #default="{ row }">
            <el-tag v-if="f.type === 'select'" size="small" effect="plain">{{ labelOf(f, row[f.prop]) }}</el-tag>
            <el-tag v-else-if="f.type === 'switch'" size="small" :type="row[f.prop] ? 'warning' : 'info'">
              {{ row[f.prop] ? "是" : "否" }}
            </el-tag>
            <span v-else-if="f.type === 'ref'">{{ refText(f, row[f.prop]) }}</span>
            <span v-else-if="f.type === 'daterange'">{{ rangeText(row[f.prop]) }}</span>
            <div v-else-if="f.type === 'file'" class="cell-files">
              <template v-if="filesOf(row[f.prop]).length">
                <el-link
                  v-for="a in cellFiles(row[f.prop])"
                  :key="a.id"
                  type="primary"
                  :href="attachmentUrl(a)"
                  target="_blank"
                  >{{ a.name }}</el-link
                >
                <el-tooltip v-if="moreFiles(row[f.prop])" :content="moreFiles(row[f.prop])" placement="top">
                  <span class="more">+{{ filesOf(row[f.prop]).length - 2 }}</span>
                </el-tooltip>
              </template>
              <span v-else>-</span>
            </div>
            <span v-else-if="f.money">{{ money(row[f.prop]) }}</span>
            <span v-else>{{ row[f.prop] ?? "-" }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="!readonly" label="操作" width="120" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="`暂无数据${readonly ? '' : `，点击右上角「新增${def.title}」开始录入`}`" />
        </template>
      </el-table>

      <!-- 手机端：行→卡片，点卡片打开编辑（只读身份仅浏览） -->
      <div v-else v-loading="loading" class="card-list mt16">
        <div
          v-for="(row, i) in rows"
          :key="row.id ?? i"
          class="rec-card"
          :class="{ tappable: !readonly }"
          @click="!readonly && openEdit(row)"
        >
          <div class="rec-head">
            <span class="rec-seq">{{ seq(i) }}</span>
            <span class="rec-title">{{ (cardTitleField && cardValue(cardTitleField, row)) || "（未命名）" }}</span>
          </div>
          <div class="rec-body">
            <template v-for="f in cardBodyFields" :key="f.prop">
              <div v-if="cardValue(f, row)" class="rec-row">
                <span class="k">{{ f.label }}</span>
                <span class="v" :class="{ money: f.money }">{{ cardValue(f, row) }}</span>
              </div>
            </template>
          </div>
          <div v-if="!readonly" class="rec-foot" @click.stop>
            <el-button link type="primary" size="small" :icon="Edit" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" :icon="Delete" @click="handleDelete(row)">删除</el-button>
          </div>
        </div>
        <el-empty
          v-if="!loading && !rows.length"
          :description="`暂无数据${readonly ? '' : `，点击右上角「新增${def.title}」开始录入`}`"
        />
      </div>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="total"
          :layout="isMobile ? 'prev, pager, next' : 'total, sizes, prev, pager, next, jumper'"
          background
          @current-change="load"
          @size-change="reload(1)"
        />
      </div>
    </el-card>

    <ImportDialog v-model="importVisible" :def="def" :refs="refRows" @imported="afterImport" />

    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="620px" top="6vh" :fullscreen="isMobile" destroy-on-close>
      <el-form ref="formRef" :model="model" :rules="rules" label-width="130px">
        <template v-for="(f, i) in def.fields" :key="f.prop">
          <div v-if="f.group && def.fields[i - 1]?.group !== f.group" class="form-group">{{ f.group }}</div>
          <el-form-item :label="f.label" :prop="f.prop">
            <el-input
              v-if="f.type === 'text'"
              v-model="model[f.prop]"
              :disabled="f.autoNo"
              :clearable="!f.autoNo"
              :placeholder="f.autoNo ? '保存时按当日日期自动生成' : f.placeholder || `请输入${f.label}`"
            />
            <el-input
              v-else-if="f.type === 'textarea'"
              v-model="model[f.prop]"
              type="textarea"
              :rows="3"
              :placeholder="f.placeholder || `请输入${f.label}`"
            />
            <el-input-number
              v-else-if="f.type === 'number'"
              v-model="model[f.prop]"
              :min="0"
              :precision="f.money ? 2 : 0"
              controls-position="right"
              style="width: 100%"
            />
            <el-select v-else-if="f.type === 'select'" v-model="model[f.prop]" clearable style="width: 100%">
              <el-option v-for="o in f.options" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <el-date-picker
              v-else-if="f.type === 'date'"
              v-model="model[f.prop]"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="选择日期"
              style="width: 100%"
            />
            <el-date-picker
              v-else-if="f.type === 'daterange'"
              v-model="model[f.prop]"
              type="daterange"
              range-separator="~"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
            <el-select
              v-else-if="f.type === 'ref'"
              v-model="model[f.prop]"
              :multiple="f.multiple"
              filterable
              clearable
              collapse-tags
              collapse-tags-tooltip
              :placeholder="f.placeholder || `请选择${f.label}`"
              :no-data-text="refEmptyText(f)"
              style="width: 100%"
              @change="applyRefFill(f)"
            >
              <el-option
                v-for="o in refOptions(f)"
                :key="o.value"
                :label="o.label"
                :value="o.value"
                :disabled="o.disabled"
              />
            </el-select>
            <el-switch v-else-if="f.type === 'switch'" v-model="model[f.prop]" />
            <div v-else-if="f.type === 'file'" class="files">
              <div v-for="(a, i) in filesOf(model[f.prop])" :key="a.id" class="file-row">
                <el-link type="primary" :href="attachmentUrl(a)" target="_blank" class="file-name">{{ a.name }}</el-link>
                <span class="file-size">{{ sizeText(a.size) }}</span>
                <el-button link type="danger" size="small" :icon="Delete" @click="removeFile(f, i)">移除</el-button>
              </div>
              <div v-if="!filesOf(model[f.prop]).length" class="file-empty">暂无附件</div>
              <el-upload
                :show-file-list="false"
                :accept="f.accept"
                multiple
                :http-request="(o: any) => doUpload(f, o)"
                :disabled="uploadBusy(f)"
              >
                <el-button size="small" :icon="Upload" :loading="uploadBusy(f)">选择文件</el-button>
              </el-upload>
              <div class="file-hint">
                单个不超过 {{ MAX_UPLOAD_MB }}MB，最多 {{ maxFilesOf(f) }} 个；选完即上传到服务器，“移除”只是从本条记录去掉引用。
              </div>
            </div>
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.title {
  font-size: 16px;
  font-weight: 600;
  color: var(--el-text-color-primary);
}
.desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.mt16 {
  margin-top: 16px;
}
.form-group {
  margin: 4px 0 14px;
  padding-left: 10px;
  border-left: 3px solid var(--el-color-primary);
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-regular);
}
.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
/* 附件：表格单元格里最多展示两个名字，其余收进 +N 的 tooltip */
.cell-files {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.cell-files .more {
  flex: none;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
/* 表单里的附件区：已传列表 + 上传按钮 + 规则提示 */
.files {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.file-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.file-row .file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.file-size,
.file-empty,
.file-hint {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.file-empty {
  color: var(--el-text-color-placeholder);
}

/* ---------- 手机端卡片列表（isMobile 时替代表格） ---------- */
.card-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 120px;
}
.rec-card {
  background: #fff;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
  padding: 10px 12px;
  box-shadow: 0 1px 3px rgba(0, 21, 41, 0.05);
}
.rec-card.tappable {
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.rec-card.tappable:active {
  background: var(--el-fill-color-light);
}
.rec-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding-bottom: 8px;
  border-bottom: 1px dashed var(--el-border-color-lighter);
}
.rec-seq {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.rec-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--el-text-color-primary);
  word-break: break-all;
}
.rec-body {
  padding-top: 6px;
}
.rec-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  line-height: 24px;
}
.rec-row .k {
  flex-shrink: 0;
  color: var(--el-text-color-secondary);
}
.rec-row .v {
  text-align: right;
  word-break: break-all;
  color: var(--el-text-color-primary);
}
.rec-row .v.money {
  font-weight: 600;
  color: var(--el-color-primary);
  font-variant-numeric: tabular-nums;
}
.rec-foot {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 4px;
  padding-top: 4px;
  border-top: 1px solid var(--el-border-color-lighter);
}
</style>
