<script setup lang="ts">
import {
  UserFilled,
  Wallet,
  TrendCharts,
  DataLine,
} from "@element-plus/icons-vue";

// 顶部统计卡片
const stats = [
  { title: "用户总数", value: "12,480", icon: UserFilled, color: "#409eff", growth: "+12%" },
  { title: "付费订阅", value: "3,265", icon: Wallet, color: "#67c23a", growth: "+8%" },
  { title: "本月收入", value: "¥89,300", icon: TrendCharts, color: "#e6a23c", growth: "+15%" },
  { title: "活跃用户", value: "7,842", icon: DataLine, color: "#f56c6c", growth: "+5%" },
];

// 套餐订阅占比
const plans = [
  { name: "基础版", percent: 45, color: "#409eff" },
  { name: "专业版", percent: 30, color: "#67c23a" },
  { name: "企业版", percent: 25, color: "#e6a23c" },
];

// 最近订单
const recentOrders = [
  { id: "#20260901", user: "张三", plan: "专业版", amount: "¥299", status: "已完成" },
  { id: "#20260902", user: "李四", plan: "企业版", amount: "¥999", status: "已完成" },
  { id: "#20260903", user: "王五", plan: "基础版", amount: "¥99", status: "待支付" },
  { id: "#20260904", user: "赵六", plan: "专业版", amount: "¥299", status: "已完成" },
  { id: "#20260905", user: "孙七", plan: "基础版", amount: "¥99", status: "已退款" },
];

function statusType(status: string) {
  if (status === "已完成") return "success";
  if (status === "待支付") return "warning";
  return "info";
}
</script>

<template>
  <div class="dashboard">
    <!-- 统计卡片 -->
    <el-row :gutter="20">
      <el-col v-for="s in stats" :key="s.title" :xs="24" :sm="12" :md="6">
        <el-card shadow="hover" class="stat-card">
          <div class="stat-content">
            <div class="stat-icon" :style="{ background: s.color }">
              <el-icon :size="24"><component :is="s.icon" /></el-icon>
            </div>
            <div class="stat-info">
              <div class="stat-title">{{ s.title }}</div>
              <div class="stat-value">{{ s.value }}</div>
              <div class="stat-growth">较上月 {{ s.growth }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" class="mt20">
      <!-- 套餐占比 -->
      <el-col :xs="24" :md="8">
        <el-card shadow="never" class="panel">
          <template #header>
            <span class="panel-title">套餐订阅占比</span>
          </template>
          <div v-for="p in plans" :key="p.name" class="plan-item">
            <div class="plan-label">
              <span>{{ p.name }}</span>
              <span>{{ p.percent }}%</span>
            </div>
            <el-progress
              :percentage="p.percent"
              :color="p.color"
              :show-text="false"
              :stroke-width="10"
            />
          </div>
        </el-card>
      </el-col>

      <!-- 最近订单 -->
      <el-col :xs="24" :md="16">
        <el-card shadow="never" class="panel">
          <template #header>
            <span class="panel-title">最近订单</span>
          </template>
          <el-table :data="recentOrders" style="width: 100%">
            <el-table-column prop="id" label="订单号" width="120" />
            <el-table-column prop="user" label="用户" width="90" />
            <el-table-column prop="plan" label="套餐" width="90" />
            <el-table-column prop="amount" label="金额" width="90" />
            <el-table-column prop="status" label="状态">
              <template #default="{ row }">
                <el-tag :type="statusType(row.status)" size="small">
                  {{ row.status }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
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
.plan-item {
  margin-bottom: 20px;
}
.plan-label {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 14px;
  color: #606266;
}
</style>
