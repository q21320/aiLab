<script setup lang="ts">
// ============================================================================
// 低代码「数据表格（CRUD）」组件
//
// 设计态：展示结构示意（不可操作），可在右侧配置资源/列/表单字段/动作开关。
// 运行态：自动对接数据源，提供 搜索 + 分页 + 新建 + 编辑 + 删除 完整闭环。
//
// 数据源两种模式（在右侧「数据源」中配置）：
//   1) resource：平台通用 CRUD 接口 /api/crud/:resource（零后端代码）
//   2) api     ：自有业务接口模板，支持 {page} {pageSize} {keyword} 占位，
//                并用 listPath / totalPath 指定响应里的数组与总数位置
// ============================================================================

import { computed, onMounted, reactive, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Plus, Search, Refresh, Delete, EditPen } from "@element-plus/icons-vue";
import type { SchemaNode } from "./types";
import { createCrud, deleteCrud, getByPath, listCrud, updateCrud, type CrudField } from "../api/crud";
import { apiUrl } from "../api/base";

const props = defineProps<{ node: SchemaNode; editable?: boolean }>();

const cfg = computed(() => props.node.props || {});
const columns = computed<{ prop: string; label: string; width?: number }[]>(
  () => cfg.value.columns || []
);
const pageSizeOptions = [10, 20, 50, 100];

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------
const rows = ref<Record<string, any>[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(Number(cfg.value.pageSize) || 20);
const keyword = ref("");
const loading = ref(false);
const serverFields = ref<CrudField[]>([]);

/** 设计态示意数据：按列生成两行占位 */
const designRows = computed(() =>
  [1, 2].map((i) => {
    const row: Record<string, any> = {};
    for (const c of columns.value) row[c.prop] = c.prop === "id" ? `DEMO-${i}` : `${c.label}${i}`;
    return row;
  })
);
const displayRows = computed(() => (props.editable ? designRows.value : rows.value));
const displayTotal = computed(() => (props.editable ? designRows.value.length : total.value));

/** 表单字段：优先用配置，其次用后端字段元数据 */
const formFields = computed<CrudField[]>(() => cfg.value.formFields?.length ? cfg.value.formFields : serverFields.value);

/** 列渲染时，select 类字段把 value 映射回 label */
function displayCell(row: Record<string, any>, colProp: string): string {
  const raw = row[colProp];
  if (raw === null || raw === undefined || raw === "") return "";
  const field = formFields.value.find((f) => f.prop === colProp);
  if (field?.type === "select" && Array.isArray(field.options) && field.options.length) {
    const hit = field.options.find((o) => String(o.value) === String(raw));
    if (hit) return hit.label || String(hit.value);
  }
  return String(raw);
}

// ---------------------------------------------------------------------------
// 数据加载
// ---------------------------------------------------------------------------
async function load() {
  if (props.editable) return;
  const resource = cfg.value.resource;
  const api = cfg.value.api;
  loading.value = true;
  try {
    if (resource) {
      const res = await listCrud(resource, { page: page.value, pageSize: pageSize.value, keyword: keyword.value });
      if (res.ok) {
        rows.value = res.list;
        total.value = res.total;
        if (res.fields?.length) serverFields.value = res.fields;
      } else {
        rows.value = [];
        total.value = 0;
        ElMessage.error(`加载数据失败：${res.error || "未知错误"}`);
      }
    } else if (api) {
      const url = String(api)
        .replace("{page}", String(page.value))
        .replace("{pageSize}", String(pageSize.value))
        .replace("{keyword}", encodeURIComponent(keyword.value));
      const res = await fetch(apiUrl(url));
      const body = await res.json().catch(() => ({}));
      const list = getByPath(body, cfg.value.listPath || "list") || getByPath(body, "data.list") || body.data || body;
      rows.value = Array.isArray(list) ? list : [];
      total.value = Number(getByPath(body, cfg.value.totalPath || "total") ?? rows.value.length);
    }
  } catch (e) {
    ElMessage.error(`加载数据失败：${(e as Error).message}`);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(
  () => [cfg.value.resource, cfg.value.api, pageSize.value, props.editable],
  () => {
    page.value = 1;
    load();
  }
);

function doSearch() {
  page.value = 1;
  load();
}
function doReset() {
  keyword.value = "";
  doSearch();
}
function onPageChange(p: number) {
  page.value = p;
  load();
}
function onSizeChange(s: number) {
  pageSize.value = s;
  page.value = 1;
  load();
}

// ---------------------------------------------------------------------------
// 新建 / 编辑 / 删除
// ---------------------------------------------------------------------------
const dialog = reactive({ visible: false, mode: "create" as "create" | "edit", row: {} as Record<string, any> });

function openCreate() {
  const row: Record<string, any> = {};
  for (const f of formFields.value) row[f.prop] = f.type === "number" ? 0 : "";
  dialog.mode = "create";
  dialog.row = row;
  dialog.visible = true;
}
function openEdit(row: Record<string, any>) {
  dialog.mode = "edit";
  dialog.row = { ...row };
  dialog.visible = true;
}

async function saveDialog() {
  const resource = cfg.value.resource;
  if (props.editable) return;
  if (!resource) {
    ElMessage.warning("该表格未配置数据源（resource 或 api）");
    return;
  }
  const requiredMiss = formFields.value.find(
    (f) => f.required && (dialog.row[f.prop] === undefined || dialog.row[f.prop] === "")
  );
  if (requiredMiss) {
    ElMessage.warning(`请填写「${requiredMiss.label || requiredMiss.prop}」`);
    return;
  }
  const res =
    dialog.mode === "create"
      ? await createCrud(resource, dialog.row)
      : await updateCrud(resource, dialog.row.id, dialog.row);
  if (res.ok) {
    ElMessage.success(dialog.mode === "create" ? "新增成功" : "保存成功");
    dialog.visible = false;
    load();
  } else {
    ElMessage.error(`保存失败：${res.error || "未知错误"}`);
  }
}

async function removeRow(row: Record<string, any>) {
  const resource = cfg.value.resource;
  if (!resource) return;
  try {
    await ElMessageBox.confirm(`确定删除记录「${row.id}」？`, "删除确认", { type: "warning" });
  } catch {
    return;
  }
  const res = await deleteCrud(resource, row.id);
  if (res.ok) {
    ElMessage.success("已删除");
    load();
  } else {
    ElMessage.error(`删除失败：${res.error || "未知错误"}`);
  }
}

const canCreate = computed(() => cfg.value.allowCreate !== false);
const canEdit = computed(() => cfg.value.allowEdit !== false);
const canDelete = computed(() => cfg.value.allowDelete !== false);
const searchable = computed(() => cfg.value.searchable !== false);
</script>

<template>
  <div class="crud-table" :class="{ 'is-design': editable }">
    <!-- 工具栏：搜索 + 新建 -->
    <div class="crud-toolbar">
      <div v-if="searchable" class="crud-search">
        <el-input
          v-model="keyword"
          :placeholder="cfg.searchPlaceholder || '搜索'"
          :prefix-icon="Search"
          clearable
          style="width: 260px"
          @keyup.enter="doSearch"
          @clear="doSearch"
        />
        <el-button type="primary" @click="doSearch">搜索</el-button>
        <el-button :icon="Refresh" @click="doReset">重置</el-button>
      </div>
      <div class="crud-actions">
        <el-button v-if="canCreate" type="primary" :icon="Plus" @click="openCreate">创建</el-button>
      </div>
    </div>

    <!-- 表格 -->
    <el-table :data="displayRows" border v-loading="loading" style="width: 100%">
      <el-table-column
        v-for="c in columns"
        :key="c.prop"
        :prop="c.prop"
        :label="c.label"
        :width="c.width"
        min-width="120"
        show-overflow-tooltip
      >
        <template #default="{ row }">{{ displayCell(row, c.prop) }}</template>
      </el-table-column>
      <el-table-column v-if="canEdit || canDelete" label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button v-if="canEdit" size="small" text type="primary" :icon="EditPen" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="canDelete" size="small" text type="danger" :icon="Delete" @click="removeRow(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty :description="editable ? '设计态示意数据' : '暂无数据'" :image-size="70" />
      </template>
    </el-table>

    <!-- 分页 -->
    <div class="crud-pagination">
      <span class="total-text">总数据量: {{ displayTotal }}</span>
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="displayTotal"
        :page-sizes="pageSizeOptions"
        layout="prev, pager, next, sizes"
        background
        @current-change="onPageChange"
        @size-change="onSizeChange"
      />
    </div>

    <!-- 设计态提示 -->
    <div v-if="editable" class="design-hint">
      数据表格（CRUD）· 数据源：{{ cfg.resource ? `平台通用接口 /api/crud/${cfg.resource}` : cfg.api || "未配置" }}
      —— 运行时自动提供 搜索 / 分页 / 新建 / 编辑 / 删除
    </div>

    <!-- 新建 / 编辑弹窗 -->
    <el-dialog
      v-model="dialog.visible"
      :title="dialog.mode === 'create' ? '新建' : '编辑'"
      width="520px"
      append-to-body
      :close-on-click-modal="false"
    >
      <el-form label-width="110px">
        <el-form-item v-for="f in formFields" :key="f.prop" :label="f.label || f.prop" :required="f.required">
          <el-input v-if="f.type === 'number'" v-model.number="dialog.row[f.prop]" type="number" />
          <el-switch v-else-if="f.type === 'switch'" v-model="dialog.row[f.prop]" />
          <el-select v-else-if="f.type === 'select'" v-model="dialog.row[f.prop]" style="width: 100%">
            <el-option v-for="o in f.options || []" :key="String(o.value)" :label="o.label" :value="o.value" />
          </el-select>
          <el-date-picker v-else-if="f.type === 'date'" v-model="dialog.row[f.prop]" type="date" style="width: 100%" />
          <el-input v-else v-model="dialog.row[f.prop]" :disabled="dialog.mode === 'edit' && f.prop === 'id'" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" @click="saveDialog">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.crud-table {
  width: 100%;
}
.crud-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.crud-search {
  display: flex;
  gap: 8px;
}
.crud-actions {
  display: flex;
  gap: 8px;
}
.crud-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}
.total-text {
  font-size: 13px;
  color: #606266;
}
.design-hint {
  margin-top: 8px;
  font-size: 12px;
  color: #909399;
}
/* 设计态：整体只用于选中，不响应内部交互 */
.crud-table.is-design {
  pointer-events: none;
}
</style>
