<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useUserStore } from "../stores/user";
import { useAclStore } from "../stores/acl";
import {
  Fold,
  Expand,
  ArrowDown,
  Close,
  Document,
  Tickets,
  Connection,
  DataAnalysis,
  Monitor,
  Files,
} from "@element-plus/icons-vue";
import {
  usePublishStore,
  PUBLISH_KIND_ROUTE,
  type PublishKind,
} from "../lowcode/publish";
import { ROLE_LABELS } from "../stores/user";
import { useMenuStore, filterMenus, flattenMenus, findMenuTrail } from "../stores/menu";
import { useViewport } from "../utils/viewport";
import NavMenu from "./NavMenu.vue";

const route = useRoute();
const router = useRouter();
const userStore = useUserStore();
const acl = useAclStore();
const publishStore = usePublishStore();
const menuStore = useMenuStore();
const { isMobile } = useViewport();

onMounted(() => publishStore.init());

const isCollapse = ref(false);
/** 手机端的抽屉导航 */
const drawerVisible = ref(false);
// el-menu 是 router 模式，点项即跳转；不手动收起的话抽屉会一直挡着内容
watch(() => route.fullPath, () => (drawerVisible.value = false));

function toggleNav() {
  if (isMobile.value) drawerVisible.value = !drawerVisible.value;
  else isCollapse.value = !isCollapse.value;
}

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
/** NavMenu 需要的「我的应用」数据（图标组件与路由 index 在此组装好再传） */
const navApps = computed(() =>
  menuApps.value.map((a) => ({
    index: appMenuIndex(a.kind, a.id),
    name: a.name,
    icon: appMenuIcon(a.kind),
  })),
);

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

/** 面包屑链路：分组 / … / 当前页（导航自身的展开由 NavMenu 负责） */
const activeTrail = computed(() => findMenuTrail(navMenus.value, activeMenu.value) || []);

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

/** 面包屑展示项：手机端只留最后一级 */
const shownCrumbs = computed(() => (isMobile.value ? crumbs.value.slice(-1) : crumbs.value));

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
    <!-- 桌面侧栏（手机不用：210px 会占掉小屏一半宽度，改走抽屉） -->
    <el-aside v-if="!isMobile" :width="isCollapse ? '64px' : '210px'" class="aside">
      <div class="logo">
        <span v-if="!isCollapse">SaaS 后台</span>
        <span v-else>S</span>
      </div>
      <NavMenu
        :items="navMenus"
        :apps="navApps"
        :active="activeMenu"
        :collapsed="isCollapse"
        :show-config="acl.admin"
        @config="gotoMenuSetting"
      />
    </el-aside>

    <!-- 手机导航抽屉：菜单内容与侧栏同一组件，展开状态各自维护 -->
    <el-drawer
      v-model="drawerVisible"
      direction="ltr"
      size="242px"
      :with-header="false"
      class="nav-drawer"
    >
      <div class="drawer-inner">
        <div class="logo drawer-logo" @click="drawerVisible = false">
          <span>SaaS 后台</span>
          <el-icon><Close /></el-icon>
        </div>
        <NavMenu
          :items="navMenus"
          :apps="navApps"
          :active="activeMenu"
          :show-config="acl.admin"
          @config="gotoMenuSetting"
        />
      </div>
    </el-drawer>

    <el-container>
      <!-- 顶部栏 -->
      <el-header class="header">
        <div class="header-left">
          <!-- 手机端：真正的三横线汉堡 + 44px 触控区（EP 的 Menu 图标是九宫格，且 20px 图标按不准） -->
          <span v-if="isMobile" class="collapse-btn hamburger" @click="toggleNav">
            <i /><i /><i />
          </span>
          <el-icon v-else class="collapse-btn" @click="toggleNav">
            <component :is="isCollapse ? Expand : Fold" />
          </el-icon>
          <el-breadcrumb separator="/">
            <el-breadcrumb-item v-if="!isMobile" :to="{ path: '/dashboard' }">首页</el-breadcrumb-item>
            <!-- 窄屏只留当前页名，分组链在抽屉里能看到 -->
            <el-breadcrumb-item v-for="(c, i) in shownCrumbs" :key="`${c}-${i}`">{{ c }}</el-breadcrumb-item>
          </el-breadcrumb>
        </div>
        <div class="header-right">
          <el-dropdown @command="handleCommand">
            <span class="user-info">
              <el-avatar :size="30" class="avatar">
                {{ userStore.name?.charAt(0) || "U" }}
              </el-avatar>
              <span v-if="!isMobile" class="username">{{ userStore.name || "用户" }}</span>
              <el-tag v-if="!isMobile" size="small" effect="dark" type="warning" class="role-tag">{{ roleLabel() }}</el-tag>
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
.drawer-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.drawer-logo {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 14px;
  cursor: pointer;
  background-color: #002140;
}
.drawer-logo .el-icon {
  font-size: 18px;
  color: #b7c0cd;
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
.hamburger {
  display: inline-flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}
.hamburger i {
  width: 20px;
  height: 2px;
  border-radius: 1px;
  background: #333;
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

/* ---------- 手机端：头部收窄、内容区留白压到最小 ---------- */
@media (max-width: 767px) {
  .header {
    height: 52px;
    padding: 0 10px;
  }
  .header-left {
    gap: 10px;
    min-width: 0; /* 面包屑过长时允许收缩，不把右侧头像挤出去 */
  }
  .header-left :deep(.el-breadcrumb) {
    font-size: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .main {
    padding: 10px;
    /* 刘海屏底部横条不要压住分页与按钮 */
    padding-bottom: calc(10px + env(safe-area-inset-bottom));
  }
}
</style>
