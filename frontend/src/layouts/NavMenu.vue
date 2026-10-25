<script setup lang="ts">
// ============================================================================
// 导航内容（桌面侧栏 与 手机抽屉 共用同一份）
//
// 抽出来的原因：抽屉不是「把 aside 搬进去」——两处各有一个 el-menu 实例，
// 展开状态必须各自维护，所以把「按当前路由反查父链并展开」的逻辑一起搬进来，
// 宿主只负责提供菜单数据与外壳样式。
// ============================================================================
import { computed, nextTick, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { Menu as MenuIcon } from "@element-plus/icons-vue";
import { findMenuTrail, type MenuItem } from "../stores/menu";
import SideMenu from "./SideMenu.vue";

const props = withDefaults(
  defineProps<{
    items: MenuItem[];
    /** 已挂载到低代码应用：[{ index, name, icon }] */
    apps: Array<{ index: string; name: string; icon: any }>;
    /** 当前高亮的 index（路由 fullPath 或 path） */
    active: string;
    collapsed?: boolean;
    showConfig?: boolean;
  }>(),
  { collapsed: false, showConfig: false },
);

const emit = defineEmits<{ (e: "config"): void }>();

const route = useRoute();
const menuRef = ref<any>(null);

/** 当前页所在链路的父分组 id（挂载应用分组固定为 mounted-apps） */
const openGroupIds = computed(() => {
  const trail = findMenuTrail(props.items, props.active);
  const ids = (trail || []).slice(0, -1).map((i) => i.id);
  if (route.path.startsWith("/app/")) ids.push("mounted-apps");
  return ids;
});

/** Element Plus 只在菜单项注册变化时自动展开父级，路由变化不会，需显式打开 */
function openGroups() {
  openGroupIds.value.forEach((id) => {
    try {
      menuRef.value?.open(id);
    } catch {
      /* 分组本次未渲染（无可见子项）时忽略 */
    }
  });
}
watch([() => props.active, () => props.items, openGroupIds], () => nextTick(openGroups), {
  immediate: true,
});
</script>

<template>
  <div class="nav-menu">
    <el-menu
      ref="menuRef"
      :default-active="active"
      :collapse="collapsed"
      :collapse-transition="false"
      router
      background-color="#001529"
      text-color="#b7c0cd"
      active-text-color="#ffffff"
      class="menu"
    >
      <!-- 多级导航（由「系统管理 → 导航菜单」配置，支持任意层级） -->
      <SideMenu :items="items" />

      <!-- 已发布并挂载菜单的低代码应用 -->
      <el-sub-menu v-if="apps.length" index="mounted-apps">
        <template #title>
          <el-icon><MenuIcon /></el-icon>
          <span>我的应用</span>
        </template>
        <el-menu-item v-for="a in apps" :key="a.index" :index="a.index">
          <el-icon><component :is="a.icon" /></el-icon>
          <template #title>{{ a.name }}</template>
        </el-menu-item>
      </el-sub-menu>
    </el-menu>

    <!-- 调整导航入口（管理员） -->
    <div v-if="showConfig && !collapsed" class="menu-config-entry" @click="emit('config')">
      <el-icon><MenuIcon /></el-icon> 调整导航
    </div>
  </div>
</template>

<style scoped>
.nav-menu {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
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
</style>
