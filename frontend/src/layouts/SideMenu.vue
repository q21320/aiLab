<script setup lang="ts">
// ============================================================================
// 侧边栏递归菜单（支持任意层级）
// 可见性已由父级按页面权限过滤，本组件只负责渲染
// ============================================================================
import type { MenuItem } from "../stores/menu";

defineProps<{
  items: MenuItem[];
}>();
</script>

<template>
  <template v-for="item in items" :key="item.id">
    <!-- 分组：渲染为可折叠子菜单，递归嵌套 -->
    <el-sub-menu v-if="item.children && item.children.length" :index="item.id">
      <template #title>
        <el-icon><component :is="item.icon || 'Menu'" /></el-icon>
        <span>{{ item.title }}</span>
      </template>
      <SideMenu :items="item.children" />
    </el-sub-menu>

    <!-- 叶子：可点击跳转（支持 /path?query=xx） -->
    <el-menu-item v-else :index="item.path">
      <el-icon><component :is="item.icon || 'Document'" /></el-icon>
      <template #title>{{ item.title }}</template>
    </el-menu-item>
  </template>
</template>
