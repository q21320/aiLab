<script setup lang="ts">
import { onMounted, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Refresh, Search, Check } from "@element-plus/icons-vue";
import { useRouter } from "vue-router";
import { queryAlerts, ackAlert, ackAlertsBatch, fetchAlertStats } from "../../api/iot";
import type { IotAlert, AlertStats } from "../../api/iot";
import { useViewport } from "../../utils/viewport";

const { isMobile } = useViewport();

const loading = ref(false);
const alerts = ref<IotAlert[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keyword = ref("");
const levelFilter = ref<"all" | "error" | "warn">("all");
const statusFilter = ref<"all" | "open" | "acked">("open");

const stats = ref<AlertStats>({ total: 0, open: 0, open_error: 0, open_warn: 0, acked: 0 });

async function load() {
  loading.value = true;
  try {
    const [res, st] = await Promise.all([
      queryAlerts({
        status: statusFilter.value,
        level: levelFilter.value,
        keyword: keyword.value.trim() || undefined,
        page: page.value,
        pageSize: pageSize.value,
      }),
      fetchAlertStats(),
    ]);
    if (res) {
      alerts.value = res.alerts;
      total.value = res.total;
    }
    if (st?.stats) stats.value = st.stats;
  } catch {
    ElMessage.error("加载告警失败，请检查后端服务");
  } finally {
    loading.value = false;
  }
}
onMounted(load);

function search() {
  page.value = 1;
  void load();
}

function onFilterChange() {
  page.value = 1;
  void load();
}

const acking = ref<string>("");
async function ackOne(a: IotAlert) {
  if (acking.value) return;
  acking.value = a.id;
  try {
    const res = await ackAlert(a.id);
    if (res?.alert) {
      ElMessage.success(`已确认告警 ${a.id}`);
      await load();
    } else {
      ElMessage.error("确认失败");
    }
  } finally {
    acking.value = "";
  }
}

/** 批量确认：当前页未处理的告警 */
const batchAcking = ref(false);
async function ackPage() {
  const ids = alerts.value.filter((a) => a.status === "open").map((a) => a.id);
  if (!ids.length) {
    ElMessage.info("当前页没有待确认的告警");
    return;
  }
  batchAcking.value = true;
  try {
    const res = await ackAlertsBatch(ids);
    ElMessage.success(`已确认 ${res?.acked ?? 0} 条告警`);
    await load();
  } finally {
    batchAcking.value = false;
  }
}

/** 一键确认全部未处理告警 */
async function ackAll() {
  if (!stats.value.open) {
    ElMessage.info("没有待确认的告警");
    return;
  }
  try {
    await ElMessageBox.confirm(`将确认全部 ${stats.value.open} 条未处理告警，是否继续？`, "批量确认", {
      type: "warning",
      confirmButtonText: "确认全部",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  batchAcking.value = true;
  try {
    const res = await ackAlertsBatch(null);
    ElMessage.success(`已确认 ${res?.acked ?? 0} 条告警`);
    await load();
  } finally {
    batchAcking.value = false;
  }
}

const router = useRouter();

/** 跳转到设备曲线并定位到告警时刻 */
function viewCurve(a: IotAlert) {
  router.push({ path: "/iot", query: { device: a.deviceId, time: String(a.time) } });
}

function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="alerts-page">
    <!-- 统计 -->
    <el-row :gutter="12">
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">未处理</div>
          <div class="v danger">{{ stats.open }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">严重</div>
          <div class="v danger">{{ stats.open_error }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">预警</div>
          <div class="v warn">{{ stats.open_warn }}</div>
        </el-card>
      </el-col>
      <el-col :xs="12" :sm="6">
        <el-card shadow="never" class="stat">
          <div class="k">已确认</div>
          <div class="v ok">{{ stats.acked }}</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt12">
      <div class="toolbar">
        <el-input v-model="keyword" placeholder="搜索告警内容 / 设备ID" :prefix-icon="Search" clearable style="width: 240px" @keyup.enter="search" @clear="search" />
        <el-select v-model="levelFilter" style="width: 120px" @change="onFilterChange">
          <el-option label="全部级别" value="all" />
          <el-option label="严重" value="error" />
          <el-option label="预警" value="warn" />
        </el-select>
        <el-select v-model="statusFilter" style="width: 120px" @change="onFilterChange">
          <el-option label="未处理" value="open" />
          <el-option label="已确认" value="acked" />
          <el-option label="全部状态" value="all" />
        </el-select>
        <el-button :icon="Refresh" @click="load">刷新</el-button>
        <div class="spacer" />
        <el-button :icon="Check" :loading="batchAcking" @click="ackPage">确认本页</el-button>
        <el-button type="primary" :icon="Check" :loading="batchAcking" @click="ackAll">全部确认</el-button>
      </div>

      <el-table v-if="!isMobile" v-loading="loading" :data="alerts" size="small" class="mt12" max-height="560">
        <el-table-column label="级别" width="80">
          <template #default="{ row }">
            <el-tag size="small" :type="row.level === 'error' ? 'danger' : 'warning'">
              {{ row.level === "error" ? "严重" : "预警" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="设备" width="160">
          <template #default="{ row }">
            <div>{{ row.deviceName || row.deviceId }}</div>
            <div class="muted small">{{ row.deviceId }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="message" label="告警内容" min-width="280" show-overflow-tooltip />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.time) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag size="small" :type="row.status === 'open' ? 'danger' : 'success'" effect="plain">
              {{ row.status === "open" ? "未处理" : "已确认" }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="viewCurve(row)">曲线</el-button>
            <el-button v-if="row.status === 'open'" link type="warning" size="small" :loading="acking === row.id" @click="ackOne(row)">
              确认
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty :description="statusFilter === 'open' ? '没有未处理的告警' : '暂无数据'" />
        </template>
      </el-table>

      <!-- 手机端：告警内容在表格里是最长的一列，提到卡片标题位单独成行，不被截断 -->
      <div v-else v-loading="loading" class="m-cards mt12">
        <div v-for="row in alerts" :key="row.id" class="m-card">
          <div class="m-card-head">
            <el-tag size="small" :type="row.level === 'error' ? 'danger' : 'warning'">
              {{ row.level === "error" ? "严重" : "预警" }}
            </el-tag>
            <span class="m-card-title">{{ row.message }}</span>
            <el-tag size="small" :type="row.status === 'open' ? 'danger' : 'success'" effect="plain">
              {{ row.status === "open" ? "未处理" : "已确认" }}
            </el-tag>
          </div>
          <div class="m-card-body">
            <div class="m-card-row"><span class="m-k">设备</span><span class="m-v">{{ row.deviceName || row.deviceId }}</span></div>
            <div class="m-card-row"><span class="m-k">时间</span><span class="m-v">{{ fmtTime(row.time) }}</span></div>
          </div>
          <div class="m-card-actions">
            <el-button link type="primary" size="small" @click="viewCurve(row)">曲线</el-button>
            <el-button v-if="row.status === 'open'" link type="warning" size="small" :loading="acking === row.id" @click="ackOne(row)">确认</el-button>
          </div>
        </div>
        <el-empty v-if="!loading && !alerts.length" :description="statusFilter === 'open' ? '没有未处理的告警' : '暂无数据'" :image-size="60" />
      </div>

      <div class="pager">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="total"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="search"
        />
      </div>

      <p class="tip">
        告警已持久化到数据库（PostgreSQL <code>iot_alerts</code> 表），完整保留历史，不再因条数上限被丢弃。
        确认后标记为「已确认」并记录确认人。
      </p>
    </el-card>
  </div>
</template>

<style scoped>
.alerts-page {
  display: flex;
  flex-direction: column;
}
.mt12 {
  margin-top: 12px;
}
.stat {
  border-radius: 8px;
}
.stat .k {
  font-size: 12px;
  color: #909399;
}
.stat .v {
  font-size: 26px;
  font-weight: 600;
  margin-top: 4px;
}
.stat .v.danger {
  color: #f56c6c;
}
.stat .v.warn {
  color: #e6a23c;
}
.stat .v.ok {
  color: #67c23a;
}
.toolbar {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.spacer {
  flex: 1;
}
.muted {
  color: #c0c4cc;
}
.muted.small {
  font-size: 11px;
  line-height: 1.2;
}
.pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.tip {
  margin: 10px 0 0;
  font-size: 12px;
  color: #909399;
}
</style>
