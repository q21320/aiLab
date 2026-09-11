<script setup lang="ts">
// ============================================================================
// 侧边栏递归菜单（支持任意层级）
// ============================================================================
import { computed } from "vue";
import { filterMenus, type MenuItem } from "../stores/menu";
import type { UserRole } from "../stores/user";

const props = defineProps<{
  items: MenuItem[];
  role: UserRole;
}>();

const visible = computed(() => filterMenus(props.items, props.role));
</script>

<template>
  <template v-for="item in visible" :key="item.id">
    <!-- 分组：渲染为可折叠子菜单，递归嵌套 -->
    <el-sub-menu v-if="item.children && item.children.length" :index="item.id">
      <template #title>
        <el-icon><component :is="item.icon || 'Menu'" /></el-icon>
        <span>{{ item.title }}</span>
      </template>
      <SideMenu :items="item.children" :role="role" />
    </el-sub-menu>

    <!-- 叶子：可点击跳转（支持 /path?query=xx） -->
    <el-menu-item v-else :index="item.path">
      <el-icon><component :is="item.icon || 'Document'" /></el-icon>
      <template #title>{{ item.title }}</template>
    </el-menu-item>
  </template>
</template>
