<script setup lang="ts">
// 实验室管理 · 模块入口
// 7 个台账模块共用同一套页面，靠路由 meta.labResource 指向字段定义（resources.ts）
import { computed } from "vue";
import { useRoute } from "vue-router";
import LabCrudPage from "./LabCrudPage.vue";
import { getLabResource } from "./resources";

const route = useRoute();
const def = computed(() => getLabResource(route.meta.labResource));
</script>

<template>
  <LabCrudPage v-if="def" :key="def.resource" :def="def" />
  <el-card v-else shadow="never">
    <el-empty description="该模块尚未配置字段定义" />
  </el-card>
</template>
