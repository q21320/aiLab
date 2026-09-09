<script setup lang="ts">
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, Delete, Search } from "@element-plus/icons-vue";
import { useAuditStore } from "../../stores/audit";
import { ROLE_LABELS, type UserRole } from "../../stores/user";

const store = useAuditStore();
const moduleFilter = ref("all");
const keyword = ref("");

const modules = computed(() => Array.from(new Set(store.entries.map((e) => e.module))));

const filtered = computed(() =>
  store.entries.filter(
    (e) =>
      (moduleFilter.value === "all" || e.module === moduleFilter.value) &&
      (!keyword.value.trim() ||
        e.user.includes(keyword.value.trim()) ||
        e.action.includes(keyword.value.trim()) ||
        e.detail.includes(keyword.value.trim()))
  )
);

function roleType(role: string) {
  if (role === "admin") return "danger";
  if (role === "operator") return "warning";
  return "info";
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

function exportCsv() {
  const header = "时间,用户,角色,模块,操作,详情";
  const rows = store.entries.map(
    (e) => `${fmtTime(e.time)},${e.user},${ROLE_LABELS[e.role as UserRole] || e.role},${e.module},${e.action},${(e.detail || "").replace(/,/g, "，")}`
  );
  const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "操作日志.csv";
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("日志已导出");
}

async function clearLogs() {
  try {
    await ElMessageBox.confirm("清空全部操作日志？该操作不可恢复。", "清空日志", { type: "warning" });
    store.clear();
    ElMessage.success("已清空");
  } catch {
    /* 取消 */
  }
}
</script>

<template>
  <div class="logs-page">
    <el-alert
      title="安全审计（4.9）：登录、发布、排产拖拽、样品流转、权限操作等行为自动写入日志，支持导出归档，满足教学科研安全要求。"
      type="info"
      :closable="false"
      show-icon
    />

    <div class="toolbar">
      <el-select v-model="moduleFilter" style="width: 160px">
        <el-option label="全部模块" value="all" />
        <el-option v-for="m in modules" :key="m" :label="m" :value="m" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜索用户/操作/详情" :prefix-icon="Search" style="width: 260px" clearable />
      <div class="spacer"></div>
      <el-button :icon="Download" @click="exportCsv">导出 CSV</el-button>
      <el-button type="danger" plain :icon="Delete" @click="clearLogs">清空</el-button>
    </div>

    <el-table :data="filtered" border style="width: 100%" max-height="calc(100vh - 320px)">
      <el-table-column label="时间" width="170">
        <template #default="{ row }">{{ fmtTime(row.time) }}</template>
      </el-table-column>
      <el-table-column prop="user" label="用户" width="120" />
      <el-table-column label="角色" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="roleType(row.role)">{{ ROLE_LABELS[row.role as UserRole] || row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="module" label="模块" width="90" />
      <el-table-column prop="action" label="操作" width="120" />
      <el-table-column prop="detail" label="详情" min-width="320" show-overflow-tooltip />
    </el-table>
    <p class="footer-hint">共 {{ store.count }} 条记录（上限 500 条，自动滚动保留最新）</p>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.spacer {
  flex: 1;
}
.footer-hint {
  font-size: 12px;
  color: #909399;
  margin: 0;
}
</style>
