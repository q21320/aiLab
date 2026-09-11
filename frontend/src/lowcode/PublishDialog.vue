<script setup lang="ts">
import { ref, watch } from "vue";
import { ElMessage } from "element-plus";
import { Promotion } from "@element-plus/icons-vue";
import { usePublishStore, type PublishedApp, type PublishKind } from "./publish";

const props = defineProps<{
  modelValue: boolean;
  kind: PublishKind;
  schema: Record<string, any>;
  defaultName: string;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "published", app: PublishedApp): void;
}>();

const store = usePublishStore();
const name = ref("");
const menu = ref(false);
const saving = ref(false);

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      name.value = props.defaultName || "未命名应用";
      menu.value = false;
      saving.value = false;
    }
  }
);

async function confirm() {
  saving.value = true;
  try {
    const { app, synced, error } = await store.publish(props.kind, props.schema, {
      name: name.value.trim() || "未命名应用",
      menu: menu.value,
    });
    emit("update:modelValue", false);
    emit("published", app);
    if (synced) {
      ElMessage.success(`已发布「${app.name}」并同步到后端`);
    } else {
      ElMessage({
        type: "warning",
        duration: 8000,
        showClose: true,
        message: `已发布「${app.name}」（保存在浏览器本地），但同步后端失败：${error}`,
      });
    }
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    title="发布应用"
    width="480px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p class="hint">
      发布后进入后台「应用中心」，可在该页面打开运行、重新设计；
      勾选「挂载到菜单」后应用将出现在后台左侧导航。
      后端服务启动时同步到接口，否则保存在浏览器本地。
    </p>
    <div class="field">
      <label>应用名称</label>
      <el-input v-model="name" maxlength="32" show-word-limit />
    </div>
    <div class="field">
      <el-checkbox v-model="menu">发布后挂载到左侧菜单</el-checkbox>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :icon="Promotion" :loading="saving" @click="confirm">发布</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.hint {
  font-size: 12px;
  color: #909399;
  line-height: 1.8;
  margin: 0 0 14px;
}
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  margin-bottom: 6px;
  color: #606266;
}
</style>
