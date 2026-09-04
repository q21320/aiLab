<script setup lang="ts">
import { reactive, ref } from "vue";
import { ElMessage } from "element-plus";
import type { FormInstance } from "element-plus";
import { useUserStore } from "../../stores/user";

const userStore = useUserStore();

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

function changePassword() {
  pwdRef.value?.validate((valid) => {
    if (!valid) return;
    ElMessage.success("密码修改成功");
    pwdRef.value?.resetFields();
  });
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
  max-width: 560px;
}
</style>
