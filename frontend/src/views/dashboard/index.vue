<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import { Monitor, Warning, Operation, Box, ArrowRight, Lock } from "@element-plus/icons-vue";
import { iotLive, startIotLive } from "../../lowcode/iotLive";
import { useProductionStore } from "../../stores/production";
import { useSampleStore } from "../../stores/samples";
import { useUserStore, ROLE_LABELS, type UserRole } from "../../stores/user";

startIotLive();
const prodStore = useProductionStore();
const sampleStore = useSampleStore();
const userStore = useUserStore();
const router = useRouter();

/** 模块所需的角色（空数组 = 全部角色可用） */
const ROLES_BY_PATH: Record<string, UserRole[]> = {
  "/lowcode": ["admin"],
  "/production": ["admin", "operator"],
  "/samples": ["admin", "operator"],
  "/apps": [],
};

function canOpen(path: string): boolean {
  const roles = ROLES_BY_PATH[path] || [];
  return roles.length === 0 || roles.includes(userStore.role);
}

/** 跳转前校验角色，无权限给出明确提示（避免“点了没反应”） */
function goto(path: string) {
  if (!canOpen(path)) {
    const roles = ROLES_BY_PATH[path] || [];
    ElMessage.warning(
      `当前身份为「${ROLE_LABELS[userStore.role] || userStore.role}」，该模块需要 ${roles
        .map((r) => ROLE_LABELS[r])
        .join(" / ")} 权限，请使用对应账号登录`
    );
    return;
  }
  router.push(path);
}

function moduleRolesText(path: string): string {
  const roles = ROLES_BY_PATH[path] || [];
  return roles.length ? `需 ${roles.map((r) => ROLE_LABELS[r]).join(" / ")}` : "";
}

const stats = computed(() => [
  {
    title: "物联网在线设备",
    value: `${iotLive.overview?.online ?? 0} / ${iotLive.overview?.total ?? 0}`,
    icon: Monitor,
    color: "#409eff",
    link: "/production",
    note: "实时采集 · SSE 推送",
  },
  {
    title: "未处理告警",
    value: `${iotLive.overview?.openAlerts ?? 0}`,
    icon: Warning,
    color: "#f56c6c",
    link: "/production",
    note: "阈值自动触发",
  },
  {
    title: "在制工单",
    value: `${prodStore.runningWos}`,
    icon: Operation,
    color: "#e6a23c",
    link: "/production",
    note: `未完成订单 ${prodStore.openOrders}`,
  },
  {
    title: "在库样品",
    value: `${sampleStore.counts.in + sampleStore.counts.testing}`,
    icon: Box,
    color: "#67c23a",
    link: "/samples",
    note: `测试中 ${sampleStore.counts.testing} · 待测 ${sampleStore.counts.in}`,
  },
]);

const recentAlerts = computed(() => iotLive.alerts.slice(0, 5));

function alertType(level: string) {
  return level === "error" ? "danger" : "warning";
}
function fmtTime(t: number): string {
  return new Date(t).toLocaleString("zh-CN", { hour12: false });
}
</script>

<template>
  <div class="dashboard">
    <!-- 平台概览统计卡 -->
    <el-row :gutter="20">
      <el-col v-for="s in stats" :key="s.title" :xs="24" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card" @click="goto(s.link)">
          <div class="stat-content">
            <div class="stat-icon" :style="{ background: s.color }">
              <el-icon :size="24"><component :is="s.icon" /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-title">{{ s.title }}</div>
              <div class="stat-value">{{ s.value }}</div>
              <div class="stat-growth">{{ s.note }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mt20">
      <!-- 模块入口 -->
      <el-col :xs="24" :md="16">
        <el-card shadow="never" class="panel">
          <template #header><span class="panel-title">功能模块（低代码驱动的实验室数字化管理）</span></template>
          <div class="module-grid">
            <div
              v-for="m in [
                { path: '/lowcode', name: '低代码平台', desc: '页面/表单/流程/报表/大屏 拖拉拽开发' },
                { path: '/production', name: '排产管理', desc: '订单·工单·产能·甘特看板拖拽调整' },
                { path: '/samples', name: '样品管理', desc: '入库·测试·跟踪·出库·报废·溯源' },
                { path: '/apps', name: '应用中心', desc: '低代码应用发布/挂载/运行' },
              ]"
              :key="m.path"
              class="module-item"
              :class="{ locked: !canOpen(m.path) }"
              @click="goto(m.path)"
            >
              <div class="module-head">
                <b>{{ m.name }}</b>
                <el-tag v-if="!canOpen(m.path)" size="small" type="info" effect="plain">
                  <el-icon><Lock /></el-icon> {{ moduleRolesText(m.path) }}
                </el-tag>
              </div>
              <p>{{ m.desc }}</p>
            </div>
          </div>
        </el-card>
      </el-col>

      <!-- 实时告警 -->
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="panel">
          <template #header>
            <span class="panel-title">实时告警（物联网）</span>
            <el-tag size="small" :type="iotLive.connected ? 'success' : 'info'" effect="plain" class="live-tag">
              {{ iotLive.connected ? "实时连接" : "离线演示" }}
            </el-tag>
          </template>
          <el-table :data="recentAlerts" size="small" max-height="260">
            <el-table-column label="级别" width="70">
              <template #default="{ row }">
                <el-tag size="small" :type="alertType(row.level)">{{ row.level === "error" ? "严重" : "预警" }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="message" label="内容" show-overflow-tooltip />
            <el-table-column label="时间" width="150">
              <template #default="{ row }">{{ fmtTime(row.time) }}</template>
            </el-table-column>
          </el-table>
          <div v-if="recentAlerts.length === 0" class="empty-alert">暂无告警，运行状态正常</div>
          <div class="more" @click="goto('/apps')">
            低代码应用运行页可自定义告警看板 <el-icon><ArrowRight /></el-icon>
          </div>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<style scoped>
.mt20 {
  margin-top: 20px;
}
.stat-card {
  border-radius: 8px;
  cursor: pointer;
}
.stat-content {
  display: flex;
  align-items: center;
  gap: 16px;
}
.stat-icon {
  width: 52px;
  height: 52px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.stat-title {
  font-size: 14px;
  color: #909399;
}
.stat-value {
  font-size: 24px;
  font-weight: 600;
  color: #1f2d3d;
  margin: 2px 0;
}
.stat-growth {
  font-size: 12px;
  color: #67c23a;
}
.panel {
  border-radius: 8px;
  height: 100%;
}
.panel-title {
  font-weight: 600;
  color: #1f2d3d;
}
.live-tag {
  float: right;
}
.module-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}
.module-item {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.module-item:hover {
  border-color: #409eff;
  background: #ecf5ff;
}
.module-item.locked {
  cursor: not-allowed;
  opacity: 0.72;
}
.module-item.locked:hover {
  border-color: #dcdfe6;
  background: #fafafa;
}
.module-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.module-item b {
  color: #1f2d3d;
}
.module-item p {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
}
.empty-alert {
  text-align: center;
  color: #c0c4cc;
  font-size: 13px;
  padding: 30px 0;
}
.more {
  margin-top: 8px;
  font-size: 12px;
  color: #409eff;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
}
</style>
