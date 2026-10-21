<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { FormInstance } from "element-plus";
import { Download, Upload, FolderOpened, Plus } from "@element-plus/icons-vue";
import { useUserStore } from "../../stores/user";
import { useAuditStore } from "../../stores/audit";
import {
  fetchNotifyConfig,
  saveNotifyConfig,
  testNotifyChannel,
  type NotifyConfig,
  type NotifyChannel,
} from "../../api/iot";


const userStore = useUserStore();
const auditStore = useAuditStore();
const pwdSaving = ref(false);

// 基本设置
const basicForm = reactive({
  siteName: "SaaS 管理后台",
  description: "一个基于 Vue 3 + Element Plus 的 SaaS 后台管理系统",
  language: "zh-cn",
  theme: "light",
});

// 通知设置
// ---------------------------------------------------------------------------
// 告警通知配置（真实生效，替换原先只能弹提示的占位开关）
// ---------------------------------------------------------------------------
const notify = reactive<NotifyConfig>({
  enabled: false,
  minLevel: "error",
  ratePerMinute: 20,
  channels: [],
});
const channelTypes = ref<any[]>([]);
const notifySaving = ref(false);
const testingId = ref("");

function channelTypeLabel(t: string): string {
  return channelTypes.value.find((x) => x.id === t)?.label || t;
}

function newChannelId(): string {
  return `ch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function addChannel() {
  notify.channels.push({
    id: newChannelId(),
    type: "wecom",
    name: "",
    enabled: true,
    webhook: "",
  } as NotifyChannel);
}

function removeChannel(i: number) {
  notify.channels.splice(i, 1);
}

function onChannelTypeChange(ch: NotifyChannel) {
  // 切换类型时清空不相关字段，避免残留（例如 SMTP 密码被带到 Webhook 配置）
  ch.webhook = "";
  ch.secret = "";
  ch.host = "";
  ch.port = "";
  ch.user = "";
  ch.pass = "";
  ch.from = "";
  ch.to = "";
  ch.lastError = "";
}

async function loadNotifyConfig() {
  const res = await fetchNotifyConfig();
  if (res?.config) {
    // 脱敏的值（***）不应回写：清空让用户重新输入
    const cfg = res.config;
    notify.enabled = cfg.enabled;
    notify.minLevel = cfg.minLevel;
    notify.ratePerMinute = cfg.ratePerMinute;
    notify.channels = (cfg.channels || []).map((c) => ({
      ...c,
      webhook: c.webhook && c.webhook.includes("***") ? "" : c.webhook,
      secret: c.secret === "***" ? "" : c.secret,
      pass: c.pass === "***" ? "" : c.pass,
    }));
  }
  if (res?.channelTypes) channelTypes.value = res.channelTypes;
}

async function saveNotifyConfigHandler() {
  notifySaving.value = true;
  try {
    const res = await saveNotifyConfig({
      enabled: notify.enabled,
      minLevel: notify.minLevel,
      ratePerMinute: notify.ratePerMinute,
      channels: notify.channels,
    });
    if (res?.ok) {
      ElMessage.success("通知配置已保存");
      await loadNotifyConfig();
    } else {
      ElMessage.error((res as any)?.error || "保存失败，需管理员权限");
    }
  } finally {
    notifySaving.value = false;
  }
}

async function testChannel(ch: NotifyChannel) {
  testingId.value = ch.id;
  try {
    const res = await testNotifyChannel(ch.id);
    if (res?.ok) ElMessage.success("测试消息已发送，请检查通道是否收到");
    else ElMessage.error(res?.error || "测试失败");
  } finally {
    testingId.value = "";
  }
}

onMounted(() => {
  void loadNotifyConfig();
});

// 修改密码
const pwdRef = ref<FormInstance>();
const pwdForm = reactive({
  oldPassword: "",
  newPassword: "",
  confirmPassword: "",
});

const pwdRules = {
  oldPassword: [{ required: true, message: "请输入当前密码", trigger: "blur" }],
  newPassword: [
    { required: true, message: "请输入新密码", trigger: "blur" },
    { min: 6, message: "密码至少 6 位", trigger: "blur" },
  ],
  confirmPassword: [
    { required: true, message: "请再次输入新密码", trigger: "blur" },
    {
      validator: (_rule: unknown, value: string, callback: (e?: Error) => void) => {
        if (value !== pwdForm.newPassword) {
          callback(new Error("两次输入的密码不一致"));
        } else {
          callback();
        }
      },
      trigger: "blur",
    },
  ],
};

function saveBasic() {
  ElMessage.success("基本设置已保存");
}



async function changePassword() {
  const valid = await pwdRef.value?.validate().catch(() => false);
  if (!valid || pwdSaving.value) return;
  pwdSaving.value = true;
  try {
    // 由服务端校验原密码并更新散列（原实现只在前端提示成功，密码实际未变）
    const res = await userStore.changePassword(pwdForm.oldPassword, pwdForm.newPassword);
    if (!res.ok) {
      ElMessage.error(res.error || "密码修改失败");
      return;
    }
    ElMessage.success("密码修改成功");
    pwdRef.value?.resetFields();
  } finally {
    pwdSaving.value = false;
  }
}

// ---------------------------------------------------------------------------
// 数据备份与恢复（4.8：存储≥3年，支持备份恢复）
// ---------------------------------------------------------------------------
const backupOnline = ref(false);
const snapshots = ref<string[]>([]);
const restoreInput = ref("");
const fileInput = ref<HTMLInputElement | null>(null);

async function refreshBackup() {
  try {
    const r = await fetch("/api/backup/snapshots");
    if (r.ok) {
      const d = await r.json();
      snapshots.value = d.files || [];
      backupOnline.value = true;
    } else {
      backupOnline.value = false;
    }
  } catch {
    backupOnline.value = false;
  }
}
refreshBackup();

async function doSnapshot() {
  try {
    const r = await fetch("/api/backup/snapshot", { method: "POST" });
    const d = await r.json();
    if (d.ok) {
      ElMessage.success(`备份快照已生成：${d.file}`);
      auditStore.log("存储", "备份", `生成备份快照 ${d.file}`);
      refreshBackup();
    } else {
      ElMessage.error("备份失败：" + (d.error || ""));
    }
  } catch {
    ElMessage.error("无法连接后端，请先启动 npm start（backend）");
  }
}

async function doExport() {
  try {
    const r = await fetch("/api/backup");
    const d = await r.json();
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ailab-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ElMessage.success("备份已导出下载");
  } catch {
    ElMessage.error("无法连接后端");
  }
}

async function doRestore() {
  if (!restoreInput.value.trim()) {
    ElMessage.warning("请粘贴备份 JSON 或选择备份文件");
    return;
  }
  try {
    const data = JSON.parse(restoreInput.value);
    const r = await fetch("/api/backup/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data }),
    });
    const d = await r.json();
    if (d.ok) {
      ElMessage.success("恢复成功，刷新页面后生效");
      auditStore.log("存储", "恢复备份", "从备份 JSON 恢复数据");
    } else {
      ElMessage.error("恢复失败：" + (d.error || ""));
    }
  } catch {
    ElMessage.error("备份 JSON 解析失败，请粘贴完整备份内容");
  }
}

function pickBackupFile(e: Event) {
  const file = (e.target as HTMLInputElement)?.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    restoreInput.value = String(reader.result || "");
    ElMessage.success(`已载入备份文件：${file.name}`);
  };
  reader.readAsText(file);
}
</script>

<template>
  <div class="setting-page">
    <el-card shadow="never">
      <el-tabs>
        <!-- 基本设置 -->
        <el-tab-pane label="基本设置">
          <el-form :model="basicForm" label-width="100px" class="form">
            <el-form-item label="系统名称">
              <el-input v-model="basicForm.siteName" />
            </el-form-item>
            <el-form-item label="系统描述">
              <el-input v-model="basicForm.description" type="textarea" :rows="3" />
            </el-form-item>
            <el-form-item label="默认语言">
              <el-select v-model="basicForm.language" style="width: 200px">
                <el-option label="简体中文" value="zh-cn" />
                <el-option label="English" value="en" />
              </el-select>
            </el-form-item>
            <el-form-item label="主题模式">
              <el-radio-group v-model="basicForm.theme">
                <el-radio value="light">浅色</el-radio>
                <el-radio value="dark">深色</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveBasic">保存设置</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>

        <!-- 通知设置 -->
        <el-tab-pane label="告警通知">
          <el-form label-width="140px" class="form">
            <el-form-item label="启用告警通知">
              <el-switch v-model="notify.enabled" />
              <span class="hint">开启后，新产生的告警会推送到下方配置的通道</span>
            </el-form-item>
            <el-form-item label="通知级别">
              <el-radio-group v-model="notify.minLevel">
                <el-radio value="error">仅严重告警</el-radio>
                <el-radio value="warn">预警及以上</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item label="限流（条/分钟）">
              <el-input-number v-model="notify.ratePerMinute" :min="1" :max="600" />
              <span class="hint">单通道每分钟最多发送条数，防止设备抖动刷屏</span>
            </el-form-item>
          </el-form>

          <el-divider content-position="left">通知通道</el-divider>

          <div v-for="(ch, idx) in notify.channels" :key="ch.id" class="channel-card">
            <div class="channel-head">
              <b>{{ idx + 1 }}. {{ ch.name || channelTypeLabel(ch.type) }}</b>
              <el-select v-model="ch.type" size="small" style="width: 200px" @change="onChannelTypeChange(ch)">
                <el-option v-for="t in channelTypes" :key="t.id" :label="t.label" :value="t.id" />
              </el-select>
              <el-switch v-model="ch.enabled" size="small" active-text="启用" />
              <el-button size="small" @click="testChannel(ch)" :loading="testingId === ch.id">测试</el-button>
              <el-button size="small" type="danger" text @click="removeChannel(idx)">删除</el-button>
            </div>

            <!-- 群机器人 / Webhook -->
            <template v-if="ch.type !== 'smtp'">
              <div class="form-field">
                <label>Webhook 地址</label>
                <el-input v-model="ch.webhook" placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx" />
              </div>
              <div v-if="ch.type === 'dingtalk'" class="form-field">
                <label>加签密钥（可选）</label>
                <el-input v-model="ch.secret" placeholder="SEC 开头的加签密钥，用于绕过关键词校验" />
              </div>
            </template>

            <!-- SMTP -->
            <template v-else>
              <div class="form-grid">
                <div class="form-field"><label>SMTP 服务器</label><el-input v-model="ch.host" placeholder="smtp.example.com" /></div>
                <div class="form-field"><label>端口</label><el-input v-model="ch.port" placeholder="465" /></div>
                <div class="form-field"><label>SSL/TLS</label><el-switch v-model="ch.secure" /></div>
                <div class="form-field"><label>用户名</label><el-input v-model="ch.user" placeholder="可选" /></div>
                <div class="form-field"><label>密码/授权码</label><el-input v-model="ch.pass" type="password" show-password placeholder="留空则不认证" /></div>
                <div class="form-field"><label>发件人</label><el-input v-model="ch.from" placeholder="alert@example.com" /></div>
                <div class="form-field"><label>收件人</label><el-input v-model="ch.to" placeholder="ops@example.com" /></div>
              </div>
            </template>

            <div class="form-field">
              <label>通道名称</label>
              <el-input v-model="ch.name" placeholder="如：运维群、质量部邮箱" />
            </div>

            <el-tag v-if="ch.lastError" type="danger" size="small" class="ch-err">上次失败：{{ ch.lastError }}</el-tag>
            <el-tag v-else-if="ch.lastSentAt" type="success" size="small" class="ch-err">
              上次成功：{{ new Date(ch.lastSentAt).toLocaleString("zh-CN", { hour12: false }) }}
            </el-tag>
          </div>

          <el-button :icon="Plus" @click="addChannel" style="margin-top: 8px">添加通道</el-button>

          <div class="notify-actions">
            <el-button type="primary" :loading="notifySaving" @click="saveNotifyConfigHandler">保存通知配置</el-button>
          </div>

          <el-alert type="info" :closable="false" show-icon class="mt12">
            企业微信/钉钉机器人：在群设置中「添加机器人」获取 Webhook 地址。告警消息包含设备、级别、内容、时间与编号。
            配置仅管理员可见，Webhook 地址与密码在接口返回时已脱敏。
          </el-alert>
        </el-tab-pane>

        <!-- 账号安全 -->
        <el-tab-pane label="账号安全">
          <el-alert
            :title="`当前登录账号：${userStore.name || 'admin'}`"
            type="info"
            :closable="false"
            show-icon
            class="mb16"
          />
          <el-form
            ref="pwdRef"
            :model="pwdForm"
            :rules="pwdRules"
            label-width="100px"
            class="form"
          >
            <el-form-item label="当前密码" prop="oldPassword">
              <el-input v-model="pwdForm.oldPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="新密码" prop="newPassword">
              <el-input v-model="pwdForm.newPassword" type="password" show-password />
            </el-form-item>
            <el-form-item label="确认新密码" prop="confirmPassword">
              <el-input v-model="pwdForm.confirmPassword" type="password" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="changePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <!-- 数据备份 -->
        <el-tab-pane label="数据备份">
          <el-alert
            :title="backupOnline ? '后端已连接，支持快照 / 导出 / 恢复（数据文件位于 backend/data）' : '后端未连接，请先启动：cd backend && npm start'"
            :type="backupOnline ? 'success' : 'warning'"
            :closable="false"
            show-icon
            class="mb16"
          />
          <div class="backup-actions">
            <el-button type="primary" :icon="FolderOpened" @click="doSnapshot">生成快照</el-button>
            <el-button :icon="Download" @click="doExport">导出备份文件</el-button>
            <el-button :icon="Upload" @click="fileInput?.click()">载入备份文件</el-button>
            <el-button type="success" :icon="Upload" @click="doRestore">恢复数据</el-button>
            <input ref="fileInput" type="file" accept="application/json" class="hidden-input" @change="pickBackupFile" />
          </div>
          <div v-if="snapshots.length" class="snap-list">
            <div class="snap-title">服务端快照列表（backend/data/backups，自动保留最近 20 份）</div>
            <div v-for="f in snapshots" :key="f" class="snap-item">
              <el-icon><FolderOpened /></el-icon>
              <span>{{ f }}</span>
            </div>
          </div>
          <p class="hint">
            说明：数据持久化在服务端（apps.json / iot.json），快照与备份 JSON 可长期归档（≥3 年要求），
            恢复时全量覆盖当前数据；前端设计稿另存于浏览器 localStorage（可导出 JSON 后随备份归档）。
          </p>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.hint {
  margin-left: 10px;
  font-size: 12px;
  color: #909399;
}
.channel-card {
  border: 1px solid #ebeef5;
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  background: #fafcff;
}
.channel-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.ch-err {
  margin-top: 6px;
}
.notify-actions {
  margin-top: 16px;
}
.form {
  max-width: 560px;
  margin-top: 8px;
}
.mb16 {
  margin-bottom: 16px;
  max-width: 640px;
}
.backup-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.hidden-input {
  display: none;
}
.snap-list {
  max-width: 640px;
  border: 1px solid #ebeef5;
  border-radius: 6px;
  padding: 10px 12px;
}
.snap-title {
  font-weight: 600;
  color: #1f2d3d;
  margin-bottom: 8px;
}
.snap-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #606266;
  padding: 4px 0;
  font-family: monospace;
}
.hint {
  max-width: 640px;
  font-size: 12px;
  color: #909399;
  line-height: 1.8;
  margin-top: 12px;
}
</style>
