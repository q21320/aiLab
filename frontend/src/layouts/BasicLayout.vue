<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user";
import { useAclStore } from "../stores/acl";
import {
  Fold,
  Expand,
  ArrowDown,
  Document,
  Tickets,
  Connection,
  DataAnalysis,
  Monitor,
  Files,
  Menu as MenuIcon,
} from "@element-plus/icons-vue";
import {
  usePublishStore,
  PUBLISH_KIND_ROUTE,
  type PublishKind,
} from "../lowcode/publish";
import { ROLE_LABELS } from "../stores/user";
import { useMenuStore, filterMenus, flattenMenus, type MenuItem } from "../stores/menu";
import SideMenu from "./SideMenu.vue";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const acl = useAclStore();
const publishStore = usePublishStore();
const menuStore = useMenuStore();

onMounted(() => publishStore.init());

const isCollapse = ref(false);
const menuRef = ref<any>(null);

/** 当前身份可见的导航（可见性由服务端角色权限决定，菜单页只管名称/图标/排序/启用） */
const navMenus = computed(() => filterMenus(menuStore.items, (path) => acl.canView(path)));

// 已发布且「挂载菜单+启用」的应用，动态出现在左侧导航（分组：我的应用）
const menuApps = computed(() =>
  acl.canView("/apps") ? publishStore.apps.filter((a) => a.menu && a.enable) : [],
);
const KIND_MENU_ICONS: Record<PublishKind, any> = {
  page: Document,
  form: Tickets,
  flow: Connection,
  report: DataAnalysis,
  screen: Monitor,
  html: Files,
};
function appMenuIcon(kind: PublishKind) {
  return KIND_MENU_ICONS[kind];
}
function appMenuIndex(kind: PublishKind, id: string): string {
  return `/app/${PUBLISH_KIND_ROUTE[kind]}/${id}`;
}

/** 可跳转的叶子（含挂载应用）：用于高亮匹配 */
const navLeaves = computed<{ path: string; title: string }[]>(() => [
  ...flattenMenus(navMenus.value).filter((i) => i.path),
  ...menuApps.value.map((a) => ({ path: appMenuIndex(a.kind, a.id), title: a.name })),
]);

/** 当前高亮：优先匹配 fullPath（支持 /lowcode?tab=form 这类带参数的入口），其次匹配路径前缀 */
const activeMenu = computed(() => {
  const flat = navLeaves.value;
  const exact = flat.find((i) => i.path === route.fullPath) || flat.find((i) => i.path === route.path);
  if (exact) return exact.path;
  const prefix = flat
    .filter((i) => i.path !== "/" && route.path.startsWith(i.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return prefix?.path || route.path;
});

/**
 * 从菜单树取定位到当前项的完整链路（各级分组 + 当前页）。
 * Element Plus 只在菜单项注册变化时自动展开父级，路由跳转导致 default-active 变化时并不会展开，
 * 于是当前页藏在收起的分组里、左侧完全看不出在哪个页面——这里显式把父链打开。
 */
function findTrail(items: MenuItem[], path: string, trail: MenuItem[] = []): MenuItem[] | null {
  for (const it of items) {
    const next = [...trail, it];
    if (it.path && it.path === path) return next;
    if (it.children?.length) {
      const hit = findTrail(it.children, path, next);
      if (hit) return hit;
    }
  }
  return null;
}
const activeTrail = computed(() => findTrail(navMenus.value, activeMenu.value) || []);

/** 需要展开的父分组 id（挂载应用分组固定为 mounted-apps） */
function openGroups() {
  const ids = activeTrail.value.slice(0, -1).map((i) => i.id);
  if (route.path.startsWith("/app/")) ids.push("mounted-apps");
  ids.forEach((id) => {
    try {
      menuRef.value?.open(id);
    } catch {
      /* 分组本次未渲染（无可见子项）时忽略 */
    }
  });
}
watch([activeMenu, navMenus, isCollapse], () => nextTick(openGroups), { immediate: true });

/** 面包屑链路：分组 / … / 当前页，让人一眼看出自己在哪 */
const crumbs = computed<string[]>(() => {
  const trail = activeTrail.value;
  const groups = trail.slice(0, -1).map((i) => i.title);
  const current =
    trail[trail.length - 1]?.title ||
    menuApps.value.find((a) => appMenuIndex(a.kind, a.id) === activeMenu.value)?.name ||
    (route.meta.title as string) ||
    "";
  if (!groups.length && (!current || current === "仪表盘")) return [];
  return [...groups, current];
});

function roleLabel(): string {
  // 角色显示名以服务端为准（内置角色也可改名）
  return acl.roleName || ROLE_LABELS[userStore.role] || userStore.role;
}
function gotoMenuSetting() {
  router.push("/menus");
}

// 顶部用户下拉菜单
function handleCommand(command: string) {
  if (command === "logout") {
    userStore.logout();
    acl.reset();
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
        ref="menuRef"
        :default-active="activeMenu"
        :collapse="isCollapse"
        :collapse-transition="false"
        router
        background-color="#001529"
        text-color="#b7c0cd"
        active-text-color="#ffffff"
        class="menu"
      >
        <!-- 多级导航（由「系统管理 → 导航菜单」配置，支持任意层级） -->
        <SideMenu :items="navMenus" />

        <!-- 已发布并挂载菜单的低代码应用 -->
        <el-sub-menu v-if="menuApps.length" index="mounted-apps">
          <template #title>
            <el-icon><MenuIcon /></el-icon>
            <span>我的应用</span>
          </template>
          <el-menu-item
            v-for="a in menuApps"
            :key="a.kind + a.id"
            :index="appMenuIndex(a.kind, a.id)"
          >
            <el-icon><component :is="appMenuIcon(a.kind)" /></el-icon>
            <template #title>{{ a.name }}</template>
          </el-menu-item>
        </el-sub-menu>
      </el-menu>
      <!-- 调整导航入口（管理员） -->
      <div v-if="acl.admin && !isCollapse" class="menu-config-entry" @click="gotoMenuSetting">
        <el-icon><MenuIcon /></el-icon> 调整导航
      </div>
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
            <el-breadcrumb-item v-for="(c, i) in crumbs" :key="`${c}-${i}`">{{ c }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar :size="30" class="avatar">
                {{ userStore.name?.charAt(0) || "U" }}
              </el-avatar>
              <span class="username">{{ userStore.name || "用户" }}</span>
              <el-tag size="small" effect="dark" type="warning" class="role-tag">{{ roleLabel() }}</el-tag>
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
  display: flex;
  flex-direction: column;
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
  flex-shrink: 0;
}
.menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
/* 当前页：色块 + 左侧蓝条 + 加粗（深色导航里仅变文字色根本看不出来） */
.menu :deep(.el-menu-item.is-active) {
  background-image: linear-gradient(90deg, rgba(64, 158, 255, 0.42) 0%, rgba(64, 158, 255, 0.12) 100%);
  color: #fff;
  font-weight: 600;
  position: relative;
}
.menu :deep(.el-menu-item.is-active::before) {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: #409eff;
}
/* 当前页所在分组（包多层时逐级都亮）：折叠/收起状态也能定位 */
.menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: #fff;
  font-weight: 600;
}
/* 深色主题下子菜单标题与弹出层配色 */
.menu :deep(.el-sub-menu__title) {
  color: #b7c0cd;
}
.menu :deep(.el-sub-menu__title:hover) {
  background-color: #000c17;
  color: #fff;
}
.menu :deep(.el-menu) {
  background-color: #000c17;
}
.menu-config-entry {
  flex-shrink: 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13px;
  color: #b7c0cd;
  background: #002140;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
}
.menu-config-entry:hover {
  color: #fff;
  background: #003366;
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
