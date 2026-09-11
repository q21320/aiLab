<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, Delete, Refresh, Search } from "@element-plus/icons-vue";
import {
  deleteSubmission,
  fetchSubmissions,
  submissionsExportUrl,
  type FormSubmission,
} from "../../api/forms";

const submissions = ref<FormSubmission[]>([]);
const loading = ref(false);
const keyword = ref("");
const formFilter = ref("");

onMounted(load);

async function load() {
  loading.value = true;
  const list = await fetchSubmissions(formFilter.value || undefined);
  loading.value = false;
  if (list) {
    submissions.value = list;
  } else {
    submissions.value = [];
    ElMessage.warning("无法读取提交数据：请确认后端已启动（cd backend && npm start）");
  }
}

const filtered = computed(() =>
  submissions.value.filter((s) => {
    if (!keyword.value.trim()) return true;
    const k = keyword.value.trim();
    return s.id.includes(k) || s.formId.includes(k) || JSON.stringify(s.data).includes(k);
  })
);

const formIds = computed(() => Array.from(new Set(submissions.value.map((s) => s.formId))));

const columns = computed(() => {
  const keys = new Set<string>();
  for (const s of submissions.value.slice(0, 50)) {
    for (const k of Object.keys(s.data || {})) keys.add(k);
  }
  return Array.from(keys);
});

const detailVisible = ref(false);
const detail = ref<FormSubmission | null>(null);
const detailText = computed(() => (detail.value ? JSON.stringify(detail.value.data, null, 2) : ""));

function openDetail(row: FormSubmission) {
  detail.value = row;
  detailVisible.value = true;
}

async function removeRow(row: FormSubmission) {
  try {
    await ElMessageBox.confirm(`删除提交记录 ${row.id}？`, "删除记录", { type: "warning" });
    const ok = await deleteSubmission(row.id);
    if (ok) {
      submissions.value = submissions.value.filter((s) => s.id !== row.id);
      ElMessage.success("已删除");
    } else {
      ElMessage.error("删除失败");
    }
  } catch {
    /* 取消 */
  }
}

function exportCsv() {
  window.open(submissionsExportUrl(formFilter.value || undefined), "_blank");
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
function cell(row: FormSubmission, key: string): string {
  const v = row.data?.[key];
  if (v === null || v === undefined) return "-";
  if (typeof v === "object") return JSON.stringify(v);
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}
</script>

<template>
  <div class="formdata-page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="低代码表单提交的数据均落库在此（backend/data/form-submissions.json）。表单运行时未配置 submitApi 时，默认提交到 /api/forms/:formId/submit。"
    />

    <div class="toolbar">
      <el-input v-model="keyword" placeholder="搜索提交编号 / 字段内容" :prefix-icon="Search" style="width: 260px" clearable />
      <el-select v-model="formFilter" placeholder="按表单过滤" clearable style="width: 220px" @change="load">
        <el-option v-for="f in formIds" :key="f" :label="f" :value="f" />
      </el-select>
      <el-button :icon="Refresh" @click="load">刷新</el-button>
      <el-button :icon="Download" @click="exportCsv">导出 CSV</el-button>
      <span class="hint">共 {{ filtered.length }} 条（最多保留 2000 条）</span>
    </div>

    <el-table :data="filtered" v-loading="loading" border style="width: 100%">
      <el-table-column prop="id" label="提交编号" width="200" />
      <el-table-column label="表单" min-width="140">
        <template #default="{ row }">{{ row.formName || row.formId }}</template>
      </el-table-column>
      <el-table-column v-for="c in columns.slice(0, 6)" :key="c" :label="c" min-width="120">
        <template #default="{ row }">{{ cell(row, c) }}</template>
      </el-table-column>
      <el-table-column label="提交时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.submittedAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right">
        <template #default="{ row }">
          <el-button size="small" @click="openDetail(row)">详情</el-button>
          <el-button size="small" text type="danger" :icon="Delete" @click="removeRow(row)">删除</el-button>
        </template>
      </el-table-column>
      <template #empty>
        <el-empty description="暂无表单提交数据：在应用中心打开已发布的表单并提交一次即可" :image-size="90" />
      </template>
    </el-table>

    <el-drawer v-model="detailVisible" title="提交详情" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="提交编号">{{ detail.id }}</el-descriptions-item>
          <el-descriptions-item label="表单">{{ detail.formName || detail.formId }}</el-descriptions-item>
          <el-descriptions-item label="表单 ID">{{ detail.formId }}</el-descriptions-item>
          <el-descriptions-item label="提交时间">{{ fmtTime(detail.submittedAt) }}</el-descriptions-item>
        </el-descriptions>
        <h4 class="detail-title">提交数据（JSON）</h4>
        <pre class="code-block">{{ detailText }}</pre>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.formdata-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.detail-title {
  margin: 14px 0 8px;
  color: #1f2d3d;
}
.code-block {
  margin: 0;
  padding: 12px;
  background: #282c34;
  color: #abb2bf;
  border-radius: 6px;
  max-height: 60vh;
  overflow: auto;
  font-family: "SFMono-Regular", Consolas, monospace;
  font-size: 12px;
  line-height: 1.7;
}
</style>
