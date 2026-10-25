<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRoute, useRouter } from "vue-router";
import { ElMessage } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { User, Lock } from "@element-plus/icons-vue";
import { useUserStore } from "../../stores/user";
import { useAclStore } from "../../stores/acl";

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const acl = useAclStore();

const formRef = ref<FormInstance>();
const loading = ref(false);

const form = reactive({
  username: "admin",
  // 修正：原默认值是 123456，与实际口令 admin123 不符，导致开箱即报「用户名或密码错误」
  password: "admin123",
});

const rules: FormRules = {
  username: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  password: [{ required: true, message: "请输入密码", trigger: "blur" }],
};

function handleLogin() {
  formRef.value?.validate(async (valid) => {
    if (!valid) return;
    if (loading.value) return;
    loading.value = true;
    const res = await userStore.login(form.username, form.password);
    loading.value = false;
    if (res.ok) {
      // 登录成功后立即拉取该身份的页面权限，菜单/首屏不用再等路由守卫
      await acl.load(true);
      ElMessage.success(`登录成功：${userStore.name}（${acl.roleName || userStore.roleLabel()}）`);
      // 登录后回跳到被拦截的目标页；目标页无权限则落到自己有权限的首屏
      const redirect = typeof route.query.redirect === "string" ? route.query.redirect : "";
      const target = redirect && redirect.startsWith("/") ? redirect : acl.firstViewable();
      router.replace(acl.canView(target) ? target : acl.firstViewable());
    } else {
      ElMessage.error(res.error || "用户名或密码错误");
    }
  });
}
</script>

<template>
  <div class="login-container">
    <div class="login-box">
      <div class="login-header">
        <h2>实验室数字化管理平台</h2>
        <p>欢迎回来，请登录你的账号</p>
      </div>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        size="large"
        @keyup.enter="handleLogin"
      >
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="密码"
            show-password
            :prefix-icon="Lock"
          />
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            class="login-btn"
            :loading="loading"
            @click="handleLogin"
          >
            登录
          </el-button>
        </el-form-item>
      </el-form>
      <div class="login-tip">
        演示账号：admin / admin123（管理员）· engineer / eng123（工程师）· viewer / view123（访客）；具体能看到哪些页面由「角色权限」配置决定
      </div>
      <div class="login-tip">密码由服务端校验（SHA-256 散列存储），操作均写入审计日志</div>
    </div>
  </div>
</template>

<style scoped>
.login-container {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: linear-gradient(135deg, #1e3c72 0%, #2a5298 100%);
}
.login-box {
  width: 400px;
  padding: 40px 36px;
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.2);
}
.login-header {
  text-align: center;
  margin-bottom: 28px;
}
.login-header h2 {
  margin: 0 0 8px;
  font-size: 24px;
  color: #1f2d3d;
}
.login-header p {
  margin: 0;
  font-size: 14px;
  color: #909399;
}
.login-btn {
  width: 100%;
}
.login-tip {
  margin-top: 12px;
  text-align: center;
  font-size: 12px;
  color: #c0c4cc;
}
</style>
