<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox } from "element-plus";
import { View, EditPen, Delete, Search } from "@element-plus/icons-vue";
import {
  usePublishStore,
  PUBLISH_KIND_LABELS,
  PUBLISH_KIND_ICONS,
  PUBLISH_KIND_ROUTE,
  type PublishKind,
  type PublishedApp,
} from "../../lowcode/publish";

const store = usePublishStore();
const router = useRouter();

onMounted(() => store.init());

const kindFilter = ref<PublishKind | "all">("all");
const keyword = ref("");

const filtered = computed(() =>
  store.apps.filter(
    (a) =>
      (kindFilter.value === "all" || a.kind === kindFilter.value) &&
      (!keyword.value.trim() || a.name.includes(keyword.value.trim()))
  )
);

const backendText = computed(() => {
  if (store.backendOnline === null) return { type: "info" as const, text: "正在连接后端接口..." };
  if (store.backendOnline) return { type: "success" as const, text: "后端接口已连接（/api/lowcode/apps）" };
  return { type: "warning" as const, text: "未连接后端（后端未启动），当前为本地存储模式，功能不受影响" };
});

function openApp(app: PublishedApp) {
  if (!app.enable) {
    ElMessage.warning("该应用已停用，请先在列表启用");
    return;
  }
  router.push(`/app/${PUBLISH_KIND_ROUTE[app.kind]}/${app.id}`);
}

function redesign(app: PublishedApp) {
  router.push({ path: "/lowcode", query: { tab: app.kind } });
}

async function unpublishApp(app: PublishedApp) {
  try {
    await ElMessageBox.confirm(
      `确定卸载「${app.name}」吗？卸载后运行页面与菜单入口将被移除，设计稿本身不会丢失。`,
      "卸载应用",
      { type: "warning", confirmButtonText: "卸载", cancelButtonText: "取消" }
    );
    store.unpublish(app.kind, app.id);
    ElMessage.success("已卸载");
  } catch {
    /* 取消 */
  }
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}

function counts(kind: PublishKind): number {
  return store.apps.filter((a) => a.kind === kind).length;
}

const KINDS: PublishKind[] = ["page", "form", "flow", "report", "screen"];
</script>

<template>
  <div class="apps-page">
    <!-- 后端状态提示 -->
    <el-alert :type="backendText.type" :closable="false" show-icon class="backend-alert">
      <template #title>
        {{ backendText.text }}
        <span class="backend-hint">启动后端：cd backend && npm start（接口见 backend/server.mjs）</span>
      </template>
    </el-alert>

    <!-- 统计卡片 -->
    <div class="stat-cards">
      <div
        v-for="k in KINDS"
        :key="k"
        class="stat-card"
        :class="{ active: kindFilter === k }"
        @click="kindFilter = kindFilter === k ? 'all' : k"
      >
        <el-icon><component :is="PUBLISH_KIND_ICONS[k]" /></el-icon>
        <div>
          <div class="stat-num">{{ counts(k) }}</div>
          <div class="stat-label">{{ PUBLISH_KIND_LABELS[k] }}应用</div>
        </div>
      </div>
    </div>

    <!-- 筛选 -->
    <div class="filter-bar">
      <el-radio-group v-model="kindFilter" size="small">
        <el-radio-button value="all">全部</el-radio-button>
        <el-radio-button v-for="k in KINDS" :key="k" :value="k">
          {{ PUBLISH_KIND_LABELS[k] }}
        </el-radio-button>
      </el-radio-group>
      <el-input v-model="keyword" size="small" placeholder="搜索应用名称" :prefix-icon="Search" style="width: 220px" clearable />
    </div>

    <!-- 应用列表 -->
    <div class="table-card">
      <el-table :data="filtered" v-loading="!store.loaded" style="width: 100%">
        <el-table-column label="应用" min-width="240">
          <template #default="{ row }">
            <div class="app-cell">
              <el-icon class="app-icon"><component :is="PUBLISH_KIND_ICONS[row.kind as PublishKind]" /></el-icon>
              <div>
                <div class="app-name">{{ row.name }}</div>
                <div class="app-meta">ID: {{ row.id }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ PUBLISH_KIND_LABELS[row.kind as PublishKind] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="挂载菜单" width="90" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.menu"
              size="small"
              @change="store.toggle(row.kind, row.id, 'menu')"
            />
          </template>
        </el-table-column>
        <el-table-column label="启用" width="80" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enable"
              size="small"
              @change="store.toggle(row.kind, row.id, 'enable')"
            />
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.updatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button size="small" :icon="View" @click="openApp(row)">打开</el-button>
            <el-button size="small" :icon="EditPen" @click="redesign(row)">重新设计</el-button>
            <el-button size="small" type="danger" text :icon="Delete" @click="unpublishApp(row)">卸载</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="还没有发布任何应用">
            <p class="empty-hint">在「低代码平台」各设计器中点击右上角「发布」即可生成应用，发布后可在此打开运行、挂载到菜单。</p>
          </el-empty>
        </template>
      </el-table>
    </div>
  </div>
</template>

<style scoped>
.apps-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.backend-alert .backend-hint {
  margin-left: 8px;
  color: #909399;
  font-size: 12px;
}
.stat-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 10px;
}
.stat-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.stat-card:hover,
.stat-card.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.stat-card .el-icon {
  font-size: 26px;
  color: #409eff;
}
.stat-num {
  font-size: 22px;
  font-weight: 700;
  color: #1f2d3d;
  line-height: 1.2;
}
.stat-label {
  font-size: 12px;
  color: #909399;
}
.filter-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.table-card {
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 8px 12px;
}
.app-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.app-icon {
  font-size: 22px;
  color: #409eff;
}
.app-name {
  font-size: 14px;
  color: #303133;
  font-weight: 600;
}
.app-meta {
  font-size: 11px;
  color: #c0c4cc;
  font-family: monospace;
}
.empty-hint {
  font-size: 12px;
  color: #909399;
  margin: 0 0 8px;
}
</style>
