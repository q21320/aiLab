<script setup lang="ts">
// ============================================================================
// 导航菜单管理（系统管理 → 导航菜单）
// 支持多级：新增根/子菜单、编辑（名称/图标/路径/角色/启用）、排序、
// 升级/降级层级、删除、重置默认、导出/导入 JSON 配置。
// ============================================================================
import { computed, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import {
  Plus,
  Delete,
  EditPen,
  Top,
  Bottom,
  Download,
  Upload,
  Refresh,
  Rank,
} from "@element-plus/icons-vue";
import { useMenuStore, MENU_ICONS, type MenuItem } from "../../stores/menu";
import { ROLE_LABELS, type UserRole } from "../../stores/user";

const store = useMenuStore();

const ROLES: UserRole[] = ["admin", "operator", "viewer"];

// ---------------------------------------------------------------------------
// 编辑弹窗
// ---------------------------------------------------------------------------
const dialog = ref(false);
const editing = ref<MenuItem | null>(null);
const form = ref<{ title: string; icon: string; path: string; roles: UserRole[]; enable: boolean }>({
  title: "",
  icon: "Document",
  path: "",
  roles: [],
  enable: true,
});

function openCreate(parentId: string | null) {
  const item = store.addItem(parentId);
  if (!item) return;
  editing.value = item;
  form.value = { title: item.title, icon: item.icon, path: item.path, roles: [...item.roles], enable: item.enable };
  dialog.value = true;
}
function openEdit(item: MenuItem) {
  editing.value = item;
  form.value = { title: item.title, icon: item.icon, path: item.path, roles: [...item.roles], enable: item.enable };
  dialog.value = true;
}
function saveForm() {
  if (!editing.value) return;
  if (!form.value.title.trim()) {
    ElMessage.warning("请输入菜单名称");
    return;
  }
  store.updateItem(editing.value.id, {
    title: form.value.title.trim(),
    icon: form.value.icon,
    path: form.value.path.trim(),
    roles: [...form.value.roles],
    enable: form.value.enable,
  });
  dialog.value = false;
  ElMessage.success("已保存，左侧导航即时生效");
}
function removeItem(item: MenuItem) {
  ElMessageBox.confirm(
    `删除「${item.title}」${item.children?.length ? `（含 ${item.children.length} 个子菜单）` : ""}？`,
    "删除菜单",
    { type: "warning" }
  )
    .then(() => {
      store.removeItem(item.id);
      ElMessage.success("已删除");
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// 导入 / 导出 / 重置
// ---------------------------------------------------------------------------
const importVisible = ref(false);
const importText = ref("");

function exportJson() {
  const blob = new Blob([store.exportJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "navigation-menus.json";
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success("已导出导航配置");
}
function doImport() {
  if (store.importJson(importText.value)) {
    importVisible.value = false;
    importText.value = "";
    ElMessage.success("导入成功");
  } else {
    ElMessage.error("导入失败：请粘贴合法的菜单 JSON 数组");
  }
}
function resetMenus() {
  ElMessageBox.confirm("恢复为平台默认导航结构？当前自定义配置将被覆盖。", "重置导航", { type: "warning" })
    .then(() => {
      store.reset();
      ElMessage.success("已恢复默认导航");
    })
    .catch(() => undefined);
}

// ---------------------------------------------------------------------------
// 展示
// ---------------------------------------------------------------------------
const previewRows = computed(() => store.items);

function roleText(item: MenuItem): string {
  return item.roles.length ? item.roles.map((r) => ROLE_LABELS[r]).join(" / ") : "全部角色";
}
function pathHint(item: MenuItem): string {
  return item.path || "分组节点（不跳转）";
}
</script>

<template>
  <div class="menu-page">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>
        左侧导航支持<strong>多级菜单</strong>：新增分组后在其下添加子菜单即可；也可用「降级」把已有项变成上一项的子菜单。
        角色用于按权限显示（与路由守卫一致），路径支持 <code>/lowcode?tab=page</code> 这类带参数入口。
      </template>
    </el-alert>

    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="openCreate(null)">新增根菜单</el-button>
      <el-button :icon="Download" @click="exportJson">导出配置</el-button>
      <el-button :icon="Upload" @click="importVisible = true">导入配置</el-button>
      <el-button :icon="Refresh" @click="resetMenus">恢复默认</el-button>
      <span class="hint">共 {{ store.total }} 个菜单项（含子菜单）</span>
    </div>

    <el-table :data="previewRows" row-key="id" :tree-props="{ children: 'children' }" default-expand-all border>
      <el-table-column label="菜单名称" min-width="220">
        <template #default="{ row }">
          <el-icon class="row-icon"><component :is="row.icon || 'Document'" /></el-icon>
          <span>{{ row.title }}</span>
          <el-tag v-if="!row.enable" size="small" type="info" effect="plain" style="margin-left: 8px">已停用</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="路径" min-width="200">
        <template #default="{ row }">
          <span :class="{ muted: !row.path }">{{ pathHint(row) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="可见角色" width="150">
        <template #default="{ row }">{{ roleText(row) }}</template>
      </el-table-column>
      <el-table-column label="启用" width="80" align="center">
        <template #default="{ row }">
          <el-switch :model-value="row.enable" size="small" @change="store.updateItem(row.id, { enable: !row.enable })" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="330" fixed="right">
        <template #default="{ row }">
          <el-button size="small" text type="primary" :icon="Plus" @click="openCreate(row.id)">加子菜单</el-button>
          <el-button size="small" text :icon="EditPen" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text :icon="Top" @click="store.moveItem(row.id, -1)">上移</el-button>
          <el-button size="small" text :icon="Bottom" @click="store.moveItem(row.id, 1)">下移</el-button>
          <el-button size="small" text :icon="Rank" @click="store.indentItem(row.id)">降级</el-button>
          <el-button size="small" text type="warning" @click="store.outdentItem(row.id)">升级</el-button>
          <el-button size="small" text type="danger" :icon="Delete" @click="removeItem(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="dialog" title="菜单配置" width="560px">
      <el-form label-width="90px">
        <el-form-item label="菜单名称" required>
          <el-input v-model="form.title" placeholder="如：工业物联" />
        </el-form-item>
        <el-form-item label="图标">
          <el-select v-model="form.icon" filterable style="width: 100%">
            <el-option v-for="ic in MENU_ICONS" :key="ic" :label="ic" :value="ic">
              <el-icon style="margin-right: 8px"><component :is="ic" /></el-icon>
              {{ ic }}
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="路由路径">
          <el-input v-model="form.path" placeholder="留空 = 分组节点（不跳转）；如 /production 或 /lowcode?tab=form" />
        </el-form-item>
        <el-form-item label="可见角色">
          <el-select v-model="form.roles" multiple placeholder="不选 = 全部角色可见" style="width: 100%">
            <el-option v-for="r in ROLES" :key="r" :label="ROLE_LABELS[r]" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enable" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" @click="saveForm">保存</el-button>
      </template>
    </el-dialog>

    <!-- 导入弹窗 -->
    <el-dialog v-model="importVisible" title="导入导航配置" width="640px">
      <el-input v-model="importText" type="textarea" :rows="14" placeholder="粘贴导出的 JSON 配置" />
      <template #footer>
        <el-button @click="importVisible = false">取消</el-button>
        <el-button type="primary" @click="doImport">导入</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.menu-page {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.row-icon {
  margin-right: 6px;
  color: #409eff;
}
.muted {
  color: #c0c4cc;
}
code {
  background: #f5f7fa;
  padding: 1px 5px;
  border-radius: 3px;
}
</style>
