<script setup lang="ts">
import { computed, ref } from "vue";
import type { ProductionOrder, WorkOrder } from "../../stores/production";
import { buildAchievementReport, rateLevel, RATE_META } from "../../stores/achievement";

const props = defineProps<{
  orders: ProductionOrder[];
  workOrders: WorkOrder[];
}>();

const report = computed(() => buildAchievementReport(props.workOrders as any, props.orders as any));
const overall = computed(() => report.value.overall);

/** 只有已完成的工单才有实际数据，提示用户 */
const hasData = computed(() => overall.value.doneCount > 0);

const tab = ref<"line" | "process">("line");
const groupData = computed(() => (tab.value === "line" ? report.value.byLine : report.value.byProcess));

function rateColor(rate: number): string {
  return RATE_META[rateLevel(rate)].color;
}
function rateType(rate: number): "success" | "warning" | "danger" | "info" {
  return RATE_META[rateLevel(rate)].type;
}

function fmt(ts: number): string {
  return new Date(ts).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
</script>

<template>
  <div class="ach-panel">
    <el-alert
      v-if="!hasData"
      type="info"
      :closable="false"
      show-icon
      title="暂无已完成工单"
      description="达成率需要工单完成后才有实际工时与产量数据。请到「工单与进度」录入进度并在完成后填写实际耗时。"
    />

    <template v-else>
      <!-- 核心指标 -->
      <el-row :gutter="12">
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="stat">
            <div class="k">工时达成率</div>
            <div class="v" :style="{ color: rateColor(overall.hoursRate) }">{{ overall.hoursRate }}%</div>
            <div class="sub">计划 {{ overall.planHours }}h / 实际 {{ overall.actualHours }}h</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="stat">
            <div class="k">数量达成率</div>
            <div class="v" :style="{ color: rateColor(overall.qtyRate) }">{{ overall.qtyRate }}%</div>
            <div class="sub">实际 {{ overall.actualQty }} / 计划 {{ overall.planQty }}</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="stat">
            <div class="k">交期达成率</div>
            <div class="v" :style="{ color: rateColor(report.dueRate || 0) }">{{ report.dueRate }}%</div>
            <div class="sub">按期 {{ report.onTimeOrders }} / 完成 {{ report.doneOrders }} 单</div>
          </el-card>
        </el-col>
        <el-col :xs="12" :sm="6">
          <el-card shadow="never" class="stat">
            <div class="k">工单完成情况</div>
            <div class="v">{{ overall.doneCount }}<span class="of">/{{ overall.totalCount }}</span></div>
            <div class="sub">
              超期 <b class="danger">{{ overall.overdueCount }}</b> 个
            </div>
          </el-card>
        </el-col>
      </el-row>

      <!-- 说明 -->
      <el-alert type="info" :closable="false" class="mt12">
        <template #title>指标口径</template>
        <div class="metric-help">
          <div><b>工时达成率</b> = 计划工时 ÷ 实际工时。&gt;100% 表示比计划更省时；&lt;100% 表示实际耗费超出计划。</div>
          <div><b>数量达成率</b> = 实际产量 ÷ 计划数量。同一订单的多道工序只计一次，不重复累加。</div>
          <div><b>交期达成率</b> = 按期完成的订单数 ÷ 已完成订单数。以订单全部工单完成时间为准。</div>
        </div>
      </el-alert>

      <!-- 分组对比 -->
      <el-card shadow="never" class="mt12">
        <template #header>
          <div class="card-head">
            <b>按{{ tab === "line" ? "产线" : "工序" }}对比</b>
            <el-radio-group v-model="tab" size="small">
              <el-radio-button value="line">按产线</el-radio-button>
              <el-radio-button value="process">按工序</el-radio-button>
            </el-radio-group>
          </div>
        </template>
        <el-table :data="groupData" size="small" border show-summary :summary-method="() => ['合计', overall.planHours + 'h', overall.actualHours + 'h', overall.hoursRate + '%', overall.qtyRate + '%', overall.doneCount + '/' + overall.totalCount, overall.overdueCount]">
          <el-table-column prop="label" :label="tab === 'line' ? '产线' : '工序'" min-width="140" />
          <el-table-column prop="planHours" label="计划工时" width="100">
            <template #default="{ row }">{{ row.planHours }}h</template>
          </el-table-column>
          <el-table-column prop="actualHours" label="实际工时" width="100">
            <template #default="{ row }">{{ row.actualHours }}h</template>
          </el-table-column>
          <el-table-column label="工时达成率" width="150">
            <template #default="{ row }">
              <span :style="{ color: rateColor(row.hoursRate || 0), fontWeight: 600 }">{{ row.hoursRate || 0 }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="数量达成率" width="150">
            <template #default="{ row }">
              <span :style="{ color: rateColor(row.qtyRate || 0), fontWeight: 600 }">{{ row.qtyRate || 0 }}%</span>
            </template>
          </el-table-column>
          <el-table-column label="完成" width="100">
            <template #default="{ row }">{{ row.doneCount }}/{{ row.totalCount }}</template>
          </el-table-column>
          <el-table-column label="超期" width="80">
            <template #default="{ row }">
              <span :class="{ danger: row.overdueCount > 0 }">{{ row.overdueCount }}</span>
            </template>
          </el-table-column>
          <el-table-column label="评价" width="90">
            <template #default="{ row }">
              <el-tag size="small" :type="rateType(row.hoursRate || 0)">
                {{ RATE_META[rateLevel(row.hoursRate || 0)].label }}
              </el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>

      <!-- 超期工单 -->
      <el-card v-if="report.overdueOrders.length" shadow="never" class="mt12">
        <template #header>
          <b>超期工单（{{ report.overdueOrders.length }}）</b>
          <span class="sub-hint">实际完成时间晚于计划完成时间</span>
        </template>
        <el-table :data="report.overdueOrders" size="small" border max-height="300">
          <el-table-column prop="woId" label="工单号" width="110" />
          <el-table-column prop="orderId" label="订单" width="110" />
          <el-table-column prop="processName" label="工序" width="120" />
          <el-table-column prop="lineName" label="产线" width="130" />
          <el-table-column label="计划完成" width="150">
            <template #default="{ row }">{{ fmt(row.planEnd) }}</template>
          </el-table-column>
          <el-table-column label="实际完成" width="150">
            <template #default="{ row }">{{ fmt(row.actualEnd) }}</template>
          </el-table-column>
          <el-table-column label="超期" width="100">
            <template #default="{ row }">
              <el-tag type="danger" size="small">+{{ row.lateHours }}h</el-tag>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </template>
  </div>
</template>

<style scoped>
.ach-panel {
  display: flex;
  flex-direction: column;
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
.stat .v .of {
  font-size: 16px;
  color: #c0c4cc;
  font-weight: 400;
}
.stat .sub {
  font-size: 12px;
  color: #909399;
  margin-top: 2px;
}
.danger {
  color: #f56c6c;
  font-weight: 600;
}
.mt12 {
  margin-top: 12px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.metric-help {
  font-size: 12px;
  line-height: 1.9;
  color: #606266;
}
.sub-hint {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}
</style>
