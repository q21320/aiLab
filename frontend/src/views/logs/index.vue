<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Download, Delete, Search, Refresh } from "@element-plus/icons-vue";
import { useAuditStore, type AuditEntry } from "../../stores/audit";
import { fetchAuditStats, logsExportUrl, type AuditQuery } from "../../api/audit";
import { ROLE_LABELS, type UserRole } from "../../stores/user";

const store = useAuditStore();

const filters = ref<{ module: string; role: string; keyword: string; range: [string, string] | null }>({
  module: "",
  role: "",
  keyword: "",
  range: null,
});
const page = ref(1);
const pageSize = ref(20);
const rows = ref<AuditEntry[]>([]);
const total = ref(0);
const loading = ref(false);
const offline = ref(false);
const stats = ref<any>(null);

const MODULES = ["权限", "应用", "排产", "样品", "安全", "存储", "其他"];
const ROLES: UserRole[] = ["admin", "operator", "viewer"];

function buildQuery(): AuditQuery {
  const q: AuditQuery = { page: page.value, pageSize: pageSize.value };
  if (filters.value.module) q.module = filters.value.module;
  if (filters.value.role) q.role = filters.value.role;
  if (filters.value.keyword.trim()) q.keyword = filters.value.keyword.trim();
  if (filters.value.range && filters.value.range.length === 2) {
    q.from = new Date(filters.value.range[0]).getTime();
    q.to = new Date(filters.value.range[1]).getTime() + 86399999;
  }
  return q;
}

async function load() {
  loading.value = true;
  const res = await store.queryPage(buildQuery());
  loading.value = false;
  rows.value = res.logs;
  total.value = res.total;
  offline.value = res.offline;
}

async function loadStats() {
  stats.value = await fetchAuditStats();
}

onMounted(async () => {
  await store.init();
  await load();
  await loadStats();
});

watch([() => filters.value.module, () => filters.value.role, () => filters.value.range], () => {
  page.value = 1;
  load();
});

function doSearch() {
  page.value = 1;
  load();
}
function doReset() {
  filters.value = { module: "", role: "", keyword: "", range: null };
  page.value = 1;
  load();
}
function onPage(p: number) {
  page.value = p;
  load();
}
function onSize(s: number) {
  pageSize.value = s;
  page.value = 1;
  load();
}

function exportCsv() {
  window.open(logsExportUrl(buildQuery()), "_blank");
}

async function clearAll() {
  try {
    await ElMessageBox.confirm(
      "清空全部操作日志？该操作不可恢复（建议先导出 CSV 归档）。",
      "清空日志",
      { type: "warning" }
    );
  } catch {
    return;
  }
  const res = await store.clearAll();
  if (res.ok) {
    ElMessage.success(`已清空${res.removed ? `（${res.removed} 条）` : ""}`);
    page.value = 1;
    await load();
    await loadStats();
  } else {
    ElMessage.error(`清空失败：${res.error || "后端不可用"}`);
  }
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
function roleType(role: string) {
  if (role === "admin") return "danger";
  if (role === "operator") return "warning";
  return "info";
}

const storageText = computed(() => {
  if (store.backendOnline === null) return { type: "info" as const, text: "正在连接日志服务..." };
  if (store.backendOnline) {
    const files = stats.value?.files?.length || 0;
    return {
      type: "success" as const,
      text: `后端持久化已连接：按月归档 ${files} 个文件，保留 ${stats.value?.retentionMonths ?? 36} 个月（≥3 年），不限条数`,
    };
  }
  return {
    type: "warning" as const,
    text: "后端未连接：日志暂存浏览器本地缓冲（最多 500 条），恢复连接后自动补传后端",
  };
});
</script>

<template>
  <div class="logs-page">
    <el-alert :type="storageText.type" :closable="false" show-icon :title="storageText.text" />

    <div class="stats-line">
      <span>日志总数：<b>{{ total }}</b></span>
      <span v-if="stats">今日新增：<b>{{ stats.today }}</b></span>
      <span v-if="stats?.byModule" class="mods">
        模块分布：
        <el-tag v-for="(v, k) in stats.byModule" :key="k" size="small" effect="plain" class="mod-tag">{{ k }} {{ v }}</el-tag>
      </span>
    </div>

    <div class="toolbar">
      <el-select v-model="filters.module" placeholder="全部模块" clearable style="width: 140px">
        <el-option v-for="m in MODULES" :key="m" :label="m" :value="m" />
      </el-select>
      <el-select v-model="filters.role" placeholder="全部角色" clearable style="width: 140px">
        <el-option v-for="r in ROLES" :key="r" :label="ROLE_LABELS[r]" :value="r" />
      </el-select>
      <el-date-picker
        v-model="filters.range"
        type="daterange"
        unlink-panels
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        value-format="YYYY-MM-DD"
        style="width: 260px"
      />
      <el-input
        v-model="filters.keyword"
        placeholder="搜索用户/操作/详情"
        :prefix-icon="Search"
        style="width: 240px"
        clearable
        @keyup.enter="doSearch"
        @clear="doSearch"
      />
      <el-button type="primary" @click="doSearch">查询</el-button>
      <el-button :icon="Refresh" @click="doReset">重置</el-button>
      <div class="spacer"></div>
      <el-button :icon="Download" @click="exportCsv">导出 CSV</el-button>
      <el-button type="danger" plain :icon="Delete" @click="clearAll">清空</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" border style="width: 100%">
      <el-table-column label="时间" width="180">
        <template #default="{ row }">{{ fmtTime(row.time) }}</template>
      </el-table-column>
      <el-table-column prop="user" label="用户" width="120" />
      <el-table-column label="角色" width="90">
        <template #default="{ row }">
          <el-tag size="small" :type="roleType(row.role)">{{ ROLE_LABELS[row.role as UserRole] || row.role }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="module" label="模块" width="90" />
      <el-table-column prop="action" label="操作" width="130" />
      <el-table-column prop="detail" label="详情" min-width="320" show-overflow-tooltip />
      <template #empty>
        <el-empty :description="offline ? '本地缓冲暂无日志（后端未连接）' : '暂无日志'" :image-size="80" />
      </template>
    </el-table>

    <div class="pager">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100, 200]"
        layout="total, prev, pager, next, sizes"
        background
        @current-change="onPage"
        @size-change="onSize"
      />
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.stats-line {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 13px;
  color: #606266;
}
.mods {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.mod-tag {
  margin-right: 2px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.pager {
  display: flex;
  justify-content: flex-end;
}
</style>
