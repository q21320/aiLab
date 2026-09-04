<script setup lang="ts">
import { ref, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user";
import {
  Fold,
  Expand,
  Odometer,
  MagicStick,
  UserFilled,
  Setting,
  ArrowDown,
} from "@element-plus/icons-vue";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();

const isCollapse = ref(false);

// 当前高亮菜单跟随路由
const activeMenu = computed(() => route.path);

// 侧边栏菜单项
const menus = [
  { path: "/dashboard", title: "仪表盘", icon: Odometer },
  { path: "/lowcode", title: "AI 低代码", icon: MagicStick },
  { path: "/user", title: "用户管理", icon: UserFilled },
  { path: "/setting", title: "系统设置", icon: Setting },
];

// 顶部用户下拉菜单
function handleCommand(command: string) {
  if (command === "logout") {
    userStore.logout();
    router.push("/login");
  }
}
</script>

<template>
  <el-container class="layout">
    <!-- 侧边栏 -->
    <el-aside :width="isCollapse ? '64px' : '210px'" class="aside">
      <div class="logo">
        <span v-if="!isCollapse">SaaS 后台</span>
        <span v-else>S</span>
      </div>
      <el-menu
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        router
        background-color="#001529"
        text-color="#b7c0cd"
        active-text-color="#ffffff"
        class="menu"
      >
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>{{ m.title }}</template>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <!-- 顶部栏 -->
      <el-header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="isCollapse = !isCollapse">
            <component :is="isCollapse ? Expand : Fold" />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <el-breadcrumb-item>{{ route.meta.title }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar :size="30" class="avatar">
                {{ userStore.name?.charAt(0) || "U" }}
              </el-avatar>
              <span class="username">{{ userStore.name || "用户" }}</span>
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="logout">退出登录</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <!-- 主内容区 -->
      <el-main class="main">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}
.aside {
  background-color: #001529;
  transition: width 0.28s;
  overflow-x: hidden;
}
.logo {
  height: 60px;
  line-height: 60px;
  text-align: center;
  color: #fff;
  font-size: 18px;
  font-weight: 600;
  background-color: #002140;
  white-space: nowrap;
  overflow: hidden;
}
.menu {
  border-right: none;
}
.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  box-shadow: 0 1px 4px rgba(0, 21, 41, 0.08);
}
.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}
.collapse-btn {
  font-size: 20px;
  cursor: pointer;
  color: #333;
}
.header-right .user-info {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  outline: none;
}
.avatar {
  background: #409eff;
}
.username {
  font-size: 14px;
  color: #333;
}
.main {
  background-color: #f0f2f5;
  padding: 20px;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
