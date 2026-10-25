<script setup lang="ts">
// ============================================================================
// 导航菜单管理（系统管理 → 导航菜单）
// 支持多级：新增根/子菜单、编辑（名称/图标/路径/启用）、排序、
// 升级/降级层级、删除、重置默认、导出/导入 JSON 配置。
// 注：这里只管「导航长什么样」，谁能看到哪个页面由「角色权限」统一决定。
// ============================================================================
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
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
  Lock,
} from "@element-plus/icons-vue";
import { useMenuStore, MENU_ICONS, flattenMenus, type MenuItem } from "../../stores/menu";
import { pageKeyOf } from "../../stores/acl";
import { useViewport } from "../../utils/viewport";
import { fetchRoles, type RoleInfo } from "../../api/roles";

const store = useMenuStore();
const router = useRouter();
const { isMobile } = useViewport();

// ---------------------------------------------------------------------------
// 角色派生展示（只读）：菜单路径 → 哪些角色能看到它
// ---------------------------------------------------------------------------
const roles = ref<RoleInfo[]>([]);
/** 系统管理类的锁定页：恒仅管理员，不参与角色配置 */
const LOCKED_PAGES = ["/menus", "/roles", "/logs", "/user", "/setting"];

async function loadRoles() {
  const r = await fetchRoles();
  if (r.ok) roles.value = r.roles;
}
onMounted(loadRoles);

function rolesForPath(path: string): string[] {
  const key = pageKeyOf(path);
  if (!key) return [];
  if (LOCKED_PAGES.includes(key)) return ["仅管理员"];
  return roles.value.filter((r) => r.pages[key] === "view" || r.pages[key] === "edit").map((r) => r.name);
}

/** 分组节点没有路径：合并展示其下子菜单的可见角色，避免这一列看起来空白 */
const roleTextCache = computed(() => {
  const cache = new Map<string, string[]>();
  for (const item of flattenMenus(store.items)) {
    const names = item.path
      ? rolesForPath(item.path)
      : [...new Set((item.children || []).flatMap((c) => rolesForPath(c.path)))];
    cache.set(item.id, names);
  }
  return cache;
});
function roleText(item: MenuItem): string {
  const names = roleTextCache.value.get(item.id) || [];
  return names.length ? names.join(" / ") : "无人可见";
}

// ---------------------------------------------------------------------------
// 编辑弹窗
// ---------------------------------------------------------------------------
const dialog = ref(false);
const editing = ref<MenuItem | null>(null);
const form = ref<{ title: string; icon: string; path: string; enable: boolean }>({
  title: "",
  icon: "Document",
  path: "",
  enable: true,
});

function openCreate(parentId: string | null) {
  const item = store.addItem(parentId);
  if (!item) return;
  editing.value = item;
  form.value = { title: item.title, icon: item.icon, path: item.path, enable: item.enable };
  dialog.value = true;
}
function openEdit(item: MenuItem) {
  editing.value = item;
  form.value = { title: item.title, icon: item.icon, path: item.path, enable: item.enable };
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

/** 手机端卡片列表：树拍平成带层级的行，靠缩进体现父子关系（卡片没法用表格的树形展开） */
const cardRows = computed(() => {
  const out: (MenuItem & { depth: number })[] = [];
  const walk = (items: MenuItem[], depth: number) => {
    for (const it of items) {
      out.push({ ...it, depth });
      if (it.children?.length) walk(it.children, depth + 1);
    }
  };
  walk(store.items, 0);
  return out;
});

function pathHint(item: MenuItem): string {
  return item.path || "分组节点（不跳转）";
}
</script>

<template>
  <div class="menu-page">
    <el-alert type="info" :closable="false" show-icon>
      <template #title>
        左侧导航支持<strong>多级菜单</strong>：新增分组后在其下添加子菜单即可；也可用「降级」把已有项变成上一项的子菜单。
        路径支持 <code>/lowcode?tab=page</code> 这类带参数入口。
        <strong>页面给哪个角色看，请到「系统管理 → 角色权限」配置</strong>；本页的「可见角色」为权限结果实时汇总，不可在此编辑。
      </template>
    </el-alert>

    <div class="toolbar">
      <el-button type="primary" :icon="Plus" @click="openCreate(null)">新增根菜单</el-button>
      <el-button :icon="Download" @click="exportJson">导出配置</el-button>
      <el-button :icon="Upload" @click="importVisible = true">导入配置</el-button>
      <el-button :icon="Refresh" @click="resetMenus">恢复默认</el-button>
      <el-button :icon="Lock" @click="router.push('/roles')">角色权限</el-button>
      <span class="hint">共 {{ store.total }} 个菜单项（含子菜单）</span>
    </div>

    <el-table v-if="!isMobile" :data="previewRows" row-key="id" :tree-props="{ children: 'children' }" default-expand-all border>
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
      <el-table-column label="可见角色（按权限配置）" min-width="220">
        <template #default="{ row }">
          <span :class="{ muted: roleText(row) === '无人可见' }">{{ roleText(row) }}</span>
        </template>
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

    <!-- 手机端：一行一卡，七个操作按钮换行排布（表格里它们有 330px 固定列宽） -->
    <div v-else class="m-cards mt16">
      <div
        v-for="row in cardRows"
        :key="row.id"
        class="m-card"
        :style="{ marginLeft: `${Math.min(row.depth, 3) * 14}px` }"
      >
        <div class="m-card-head">
          <el-icon class="row-icon"><component :is="row.icon || 'Document'" /></el-icon>
          <span class="m-card-title">{{ row.title }}</span>
          <el-tag v-if="!row.enable" size="small" type="info" effect="plain">已停用</el-tag>
          <el-switch :model-value="row.enable" size="small" @change="store.updateItem(row.id, { enable: !row.enable })" />
        </div>
        <div class="m-card-body">
          <div class="m-card-row"><span class="m-k">路径</span><span class="m-v" :class="{ muted: !row.path }">{{ pathHint(row) }}</span></div>
          <div class="m-card-row"><span class="m-k">可见角色</span><span class="m-v" :class="{ muted: roleText(row) === '无人可见' }">{{ roleText(row) }}</span></div>
        </div>
        <div class="m-card-actions wrap">
          <el-button size="small" text type="primary" :icon="Plus" @click="openCreate(row.id)">加子菜单</el-button>
          <el-button size="small" text :icon="EditPen" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text :icon="Top" @click="store.moveItem(row.id, -1)">上移</el-button>
          <el-button size="small" text :icon="Bottom" @click="store.moveItem(row.id, 1)">下移</el-button>
          <el-button size="small" text :icon="Rank" @click="store.indentItem(row.id)">降级</el-button>
          <el-button size="small" text type="warning" @click="store.outdentItem(row.id)">升级</el-button>
          <el-button size="small" text type="danger" :icon="Delete" @click="removeItem(row)">删除</el-button>
        </div>
      </div>
    </div>

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
