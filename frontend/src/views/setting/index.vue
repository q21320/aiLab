<script setup lang="ts">
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { FormInstance } from "element-plus";
import { Download, Upload, FolderOpened } from "@element-plus/icons-vue";
import { useUserStore } from "../../stores/user";
import { useAuditStore } from "../../stores/audit";


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
const notifyForm = reactive({
  emailNotify: true,
  smsNotify: false,
  systemNotify: true,
  weeklyReport: false,
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

function saveNotify() {
  ElMessage.success("通知设置已保存");
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
        <el-tab-pane label="通知设置">
          <el-form :model="notifyForm" label-width="120px" class="form">
            <el-form-item label="邮件通知">
              <el-switch v-model="notifyForm.emailNotify" />
            </el-form-item>
            <el-form-item label="短信通知">
              <el-switch v-model="notifyForm.smsNotify" />
            </el-form-item>
            <el-form-item label="系统通知">
              <el-switch v-model="notifyForm.systemNotify" />
            </el-form-item>
            <el-form-item label="每周数据报告">
              <el-switch v-model="notifyForm.weeklyReport" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="saveNotify">保存设置</el-button>
            </el-form-item>
          </el-form>
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
