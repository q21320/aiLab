<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user";
import {
  Fold,
  Expand,
  Odometer,
  Grid,
  Star,
  UserFilled,
  Setting,
  ArrowDown,
  Document,
  Tickets,
  Connection,
  DataAnalysis,
  Monitor,
  Operation,
  Box,
  Notebook,
} from "@element-plus/icons-vue";
import {
  usePublishStore,
  PUBLISH_KIND_ROUTE,
  type PublishKind,
} from "../lowcode/publish";
import { ROLE_LABELS, type UserRole } from "../stores/user";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const publishStore = usePublishStore();

onMounted(() => publishStore.init());

const isCollapse = ref(false);

// 当前高亮菜单跟随路由
const activeMenu = computed(() => route.path);

// 侧边栏菜单项（按角色过滤，4.9 三级权限）
const menus = [
  { path: "/dashboard", title: "仪表盘", icon: Odometer, roles: [] as UserRole[] },
  { path: "/lowcode", title: "低代码平台", icon: Grid, roles: ["admin"] as UserRole[] },
  { path: "/apps", title: "应用中心", icon: Star, roles: [] as UserRole[] },
  { path: "/production", title: "排产管理", icon: Operation, roles: ["admin", "operator"] as UserRole[] },
  { path: "/samples", title: "样品管理", icon: Box, roles: ["admin", "operator"] as UserRole[] },
  { path: "/logs", title: "操作日志", icon: Notebook, roles: ["admin"] as UserRole[] },
  { path: "/user", title: "用户管理", icon: UserFilled, roles: ["admin"] as UserRole[] },
  { path: "/setting", title: "系统设置", icon: Setting, roles: ["admin"] as UserRole[] },
];
const visibleMenus = computed(() => menus.filter((m) => (m.roles.length ? m.roles.includes(userStore.role) : true)));

// 已发布且「挂载菜单+启用」的应用，动态出现在左侧导航
const menuApps = computed(() =>
  publishStore.apps.filter((a) => a.menu && a.enable)
);
const KIND_MENU_ICONS: Record<PublishKind, any> = {
  page: Document,
  form: Tickets,
  flow: Connection,
  report: DataAnalysis,
  screen: Monitor,
};
function appMenuIcon(kind: PublishKind) {
  return KIND_MENU_ICONS[kind];
}
function appMenuIndex(kind: PublishKind, id: string): string {
  return `/app/${PUBLISH_KIND_ROUTE[kind]}/${id}`;
}
function roleLabel(role: string): string {
  return ROLE_LABELS[role as UserRole] || role;
}

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
        <el-menu-item v-for="m in visibleMenus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <template #title>{{ m.title }}</template>
        </el-menu-item>
        <!-- 已挂载的低代码应用（应用中心开启「挂载菜单」后出现） -->
        <el-menu-item
          v-for="a in menuApps"
          :key="a.kind + a.id"
          :index="appMenuIndex(a.kind, a.id)"
        >
          <el-icon><component :is="appMenuIcon(a.kind)" /></el-icon>
          <template #title>{{ a.name }}</template>
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
              <el-tag size="small" effect="dark" type="warning" class="role-tag">{{ roleLabel(userStore.role) }}</el-tag>
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
