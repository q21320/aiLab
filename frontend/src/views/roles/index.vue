<script setup lang="ts">
// ============================================================================
// 系统管理 · 角色权限
//
// 模型：角色 = 名称 + 页面权限（不可见 / 只读 / 可写）
//   · 用户只引用角色，改一次角色 → 该角色下所有用户即时生效；
//   · 这份配置同时被左侧菜单、路由守卫与后端接口使用（同一真相源）；
//   · 管理员角色恒有全部权限且不可修改，避免把自己锁死；
//   · 系统管理类页面（导航菜单/角色权限/操作日志/用户管理/系统设置）不开放配置，恒仅管理员。
// ============================================================================
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { Check, Delete, Plus, RefreshLeft } from "@element-plus/icons-vue";
import { createRole, deleteRole, fetchRoles, updateRole, type PageGroup, type PermLevel, type RoleInfo } from "../../api/roles";
import { useAclStore } from "../../stores/acl";
import { useViewport } from "../../utils/viewport";

const acl = useAclStore();
const { isMobile } = useViewport();

const loading = ref(false);
const saving = ref(false);
const roles = ref<RoleInfo[]>([]);
const groups = ref<PageGroup[]>([]);
const currentKey = ref("");

/** 当前角色的可编辑草稿 */
const draft = reactive<{ name: string; pages: Record<string, PermLevel> }>({ name: "", pages: {} });
/** 进入角色时的快照，用于判断是否有未保存修改 */
const original = ref<{ name: string; pages: Record<string, PermLevel> }>({ name: "", pages: {} });

const current = computed(() => roles.value.find((r) => r.key === currentKey.value) || null);
const isAdminRole = computed(() => currentKey.value === "admin");
const lockedPaths = computed(() => {
  const set = new Set<string>();
  for (const g of groups.value) if (g.locked) g.pages.forEach((p) => set.add(p.path));
  return set;
});
const dirty = computed(
  () => !!current.value && (draft.name !== original.value.name || JSON.stringify(draft.pages) !== JSON.stringify(original.value.pages)),
);

/** 可配置的分组（管理员角色整块只读） */
const editableGroups = computed(() => groups.value.filter((g) => g.pages.some((p) => !lockedPaths.value.has(p.path))));

function levelOf(path: string): PermLevel | "" {
  return draft.pages[path] || "";
}
function setLevel(path: string, level: PermLevel | "") {
  if (isAdminRole.value || lockedPaths.value.has(path)) return;
  if (!level) delete draft.pages[path];
  else draft.pages[path] = level;
}

/** 批量：整组设为某级别（快速给"实验室管理"全部只读） */
function setGroupLevel(group: PageGroup, level: PermLevel | "") {
  for (const p of group.pages) {
    if (lockedPaths.value.has(p.path)) continue;
    setLevel(p.path, level);
  }
}

function selectRole(key: string) {
  const role = roles.value.find((r) => r.key === key);
  if (!role) return;
  currentKey.value = key;
  draft.name = role.name;
  draft.pages = { ...role.pages };
  original.value = { name: role.name, pages: { ...role.pages } };
}

async function load(keepSelection = true) {
  loading.value = true;
  try {
    const res = await fetchRoles();
    if (!res.ok) {
      ElMessage.error(res.error || "加载角色失败");
      return;
    }
    roles.value = res.roles;
    groups.value = res.groups;
    const target = keepSelection && roles.value.some((r) => r.key === currentKey.value) ? currentKey.value : res.roles[0]?.key || "";
    if (target) selectRole(target);
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (!acl.admin) {
    ElMessage.warning("仅管理员可配置角色权限");
    return;
  }
  load(false);
});

// ---------------------------------------------------------------- 保存
async function saveName() {
  if (!current.value) return;
  const name = draft.name.trim();
  if (!name) return ElMessage.warning("角色名称不能为空");
  saving.value = true;
  try {
    const r = await updateRole(current.value.key, { name });
    if (!r.ok) return ElMessage.error(r.error || "保存失败");
    ElMessage.success("角色名称已更新");
    await load();
  } finally {
    saving.value = false;
  }
}

async function savePages() {
  if (!current.value || isAdminRole.value) return;
  saving.value = true;
  try {
    const r = await updateRole(current.value.key, { pages: draft.pages });
    if (!r.ok) return ElMessage.error(r.error || "保存失败");
    ElMessage.success(`已保存，${current.value.userCount} 个用户的权限同步生效`);
    await load();
  } finally {
    saving.value = false;
  }
}

function resetDraft() {
  if (!current.value) return;
  selectRole(current.value.key);
  ElMessage.info("已放弃未保存的修改");
}

// ---------------------------------------------------------------- 新增 / 删除
const createVisible = ref(false);
const createForm = reactive({ name: "", copyFrom: "" });

async function submitCreate() {
  const name = createForm.name.trim();
  if (!name) return ElMessage.warning("请输入角色名称");
  const source = roles.value.find((r) => r.key === createForm.copyFrom);
  const pages = source ? { ...source.pages } : { "/dashboard": "view" as PermLevel };
  const r = await createRole(name, pages);
  if (!r.ok || !r.data?.key) return ElMessage.error(r.error || "创建失败");
  ElMessage.success(`角色「${name}」已创建，请勾选可访问的页面`);
  createVisible.value = false;
  createForm.name = "";
  createForm.copyFrom = "";
  await load(false);
  selectRole(r.data.key);
}

async function removeRole(role: RoleInfo) {
  try {
    await ElMessageBox.confirm(
      `确定删除角色「${role.name}」？该操作不可恢复。`,
      "删除角色",
      { type: "warning", confirmButtonText: "删除", cancelButtonText: "取消" },
    );
  } catch {
    return;
  }
  const r = await deleteRole(role.key);
  if (!r.ok) return ElMessage.error(r.error || "删除失败");
  ElMessage.success("角色已删除");
  if (currentKey.value === role.key) currentKey.value = "";
  await load(false);
}

const LEVEL_OPTIONS: { value: PermLevel | ""; label: string }[] = [
  { value: "", label: "不可见" },
  { value: "view", label: "只读" },
  { value: "edit", label: "可写" },
];

function grantedCount(role: RoleInfo): number {
  return Object.keys(role.pages || {}).length;
}
</script>

<template>
  <div class="roles-page" :class="{ 'is-mobile': isMobile }">
    <el-alert type="info" :closable="false" show-icon class="tip">
      角色 = 名称 + 可访问页面。用户在「用户管理」里引用角色，这里改一次，该角色下的用户全部同步生效。
      菜单、页面与后端接口共用同一份配置，隐藏即不可访问（直接调接口也会被拦截）。
    </el-alert>

    <el-row :gutter="16" v-loading="loading">
      <!-- 角色列表 -->
      <el-col :xs="24" :sm="8" :md="6">
        <el-card shadow="never" class="panel">
          <template #header>
            <div class="card-head">
              <span class="panel-title">角色</span>
              <el-button type="primary" link :icon="Plus" @click="createVisible = true">新增</el-button>
            </div>
          </template>
          <div
            v-for="r in roles"
            :key="r.key"
            class="role-item"
            :class="{ active: r.key === currentKey }"
            @click="selectRole(r.key)"
          >
            <div class="role-main">
              <div class="role-name">
                {{ r.name }}
                <el-tag v-if="r.key === 'admin'" size="small" type="danger" effect="plain">内置</el-tag>
                <el-tag v-else-if="r.builtin" size="small" type="info" effect="plain">内置</el-tag>
              </div>
              <div class="role-meta">{{ r.userCount }} 个用户 · {{ grantedCount(r) }} 个页面</div>
            </div>
            <el-button
              v-if="r.key !== 'admin'"
              link
              :icon="Delete"
              class="role-del"
              @click.stop="removeRole(r)"
            />
          </div>
          <el-empty v-if="!roles.length" description="暂无角色" :image-size="60" />
        </el-card>
      </el-col>

      <!-- 权限矩阵 -->
      <el-col :xs="24" :sm="16" :md="18">
        <el-card v-if="current" shadow="never" class="panel">
          <template #header>
            <div class="card-head">
              <span class="panel-title">{{ current.name }} · 页面权限</span>
              <div class="head-actions">
                <el-button :icon="RefreshLeft" :disabled="!dirty" @click="resetDraft">放弃修改</el-button>
                <el-button type="primary" :icon="Check" :loading="saving" :disabled="!dirty || isAdminRole" @click="savePages">
                  保存权限
                </el-button>
              </div>
            </div>
          </template>

          <el-form inline class="name-form" @submit.prevent>
            <el-form-item label="角色名称">
              <el-input v-model="draft.name" maxlength="20" style="width: 180px" :disabled="isAdminRole" />
            </el-form-item>
            <el-form-item>
              <el-button :icon="Check" :loading="saving" :disabled="draft.name === original.name" @click="saveName">
                更新名称
              </el-button>
            </el-form-item>
            <el-form-item>
              <span class="hint">
                {{ isAdminRole ? "管理员恒有全部权限，不可修改" : `当前有 ${current.userCount} 个用户引用该角色` }}
              </span>
            </el-form-item>
          </el-form>

          <div v-for="g in editableGroups" :key="g.title" class="group">
            <div class="group-head">
              <span class="group-title">{{ g.title }}</span>
              <template v-if="!isAdminRole">
                <span class="group-bulk">整组设为：</span>
                <el-button size="small" link :disabled="isAdminRole" @click="setGroupLevel(g, 'view')">只读</el-button>
                <el-button size="small" link :disabled="isAdminRole" @click="setGroupLevel(g, 'edit')">可写</el-button>
                <el-button size="small" link :disabled="isAdminRole" @click="setGroupLevel(g, '')">不可见</el-button>
              </template>
            </div>
            <div v-for="p in g.pages" :key="p.path" class="page-row">
              <div class="page-info">
                <span class="page-title">{{ p.title }}</span>
                <span class="page-path">{{ p.path }}</span>
              </div>
              <el-tag v-if="lockedPaths.has(p.path)" size="small" type="info" effect="plain">仅管理员</el-tag>
              <el-radio-group v-else :model-value="levelOf(p.path)" :disabled="isAdminRole" @change="(v: any) => setLevel(p.path, v)">
                <el-radio-button v-for="o in LEVEL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-radio-button>
              </el-radio-group>
            </div>
          </div>
        </el-card>

        <el-card v-else shadow="never" class="panel">
          <el-empty description="选择左侧角色开始配置" :image-size="80" />
        </el-card>
      </el-col>
    </el-row>

    <!-- 新增角色 -->
    <el-dialog v-model="createVisible" title="新增角色" width="420px">
      <el-form label-width="88px" @submit.prevent>
        <el-form-item label="角色名称">
          <el-input v-model="createForm.name" placeholder="如：财务专员、外部专家" maxlength="20" show-word-limit />
        </el-form-item>
        <el-form-item label="初始权限">
          <el-select v-model="createForm.copyFrom" placeholder="留空 = 仅可见仪表盘" clearable style="width: 100%">
            <el-option v-for="r in roles" :key="r.key" :label="`复制自 ${r.name}`" :value="r.key" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.roles-page {
  padding: 4px;
}
.tip {
  margin-bottom: 16px;
}
.panel {
  border-radius: 8px;
  min-height: 420px;
}
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-weight: 600;
  color: #1f2d3d;
}
.head-actions {
  display: flex;
  gap: 8px;
}
.role-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}
.role-item + .role-item {
  margin-top: 8px;
}
.role-item:hover {
  border-color: #c6e2ff;
  background: #f5faff;
}
.role-item.active {
  border-color: #409eff;
  background: #ecf5ff;
}
.role-main {
  flex: 1;
  min-width: 0;
}
.role-name {
  font-size: 14px;
  color: #1f2d3d;
  display: flex;
  align-items: center;
  gap: 6px;
}
.role-meta {
  font-size: 12px;
  color: #a0a6ad;
  margin-top: 2px;
}
.role-del {
  color: #c0c4cc;
}
.role-del:hover {
  color: #f56c6c;
}
.name-form {
  margin-bottom: 4px;
}
.hint {
  font-size: 12px;
  color: #909399;
}
.group {
  margin-top: 14px;
}
.group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  background: #f7f9fc;
  border-radius: 6px;
}
.group-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  flex: 1;
}
.group-bulk {
  font-size: 12px;
  color: #a0a6ad;
}
.page-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px;
  border-bottom: 1px dashed #f0f2f5;
}
.page-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.page-title {
  font-size: 14px;
  color: #1f2d3d;
}
.page-path {
  font-size: 12px;
  color: #b6bcc4;
}

/* ---------- 手机端 ----------
   桌面端的「名称+路径 | 三个按钮」是一条横向行，375px 下路径会挤得按钮折行
   （不可见/只读 一行、可写 掉下一行），整页看起来像张散架的表。
   改成卡片：标题/路径各占一行，三个级别做成等宽分段胶囊占满整行。 */
.roles-page.is-mobile .panel {
  min-height: 0;
}
.roles-page.is-mobile .card-head {
  flex-wrap: wrap;
  gap: 8px;
}
.roles-page.is-mobile .head-actions {
  width: 100%;
}
.roles-page.is-mobile .head-actions .el-button {
  flex: 1;
}
.roles-page.is-mobile .group {
  margin-top: 12px;
}
.roles-page.is-mobile .group-head {
  flex-wrap: wrap;
  row-gap: 4px;
}
.roles-page.is-mobile .page-row {
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  margin-top: 8px;
  padding: 10px 12px;
  border: 1px solid #f0f2f5;
  border-radius: 8px;
  background: #fafbfc;
}
.roles-page.is-mobile .page-info {
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}
/* EP 的 radio-button 内部是 inline-block，等宽必须整链 flex 化，否则最后一项被挤半截 */
.roles-page.is-mobile .page-row :deep(.el-radio-group) {
  display: flex;
  width: 100%;
}
.roles-page.is-mobile .page-row :deep(.el-radio-button) {
  flex: 1;
}
.roles-page.is-mobile .page-row :deep(.el-radio-button__inner) {
  width: 100%;
  padding: 8px 0;
  text-align: center;
}
/* 名称配置区：输入框与按钮各占一行，靠 hint 分开 */
.roles-page.is-mobile .name-form :deep(.el-form-item) {
  width: 100%;
  margin-right: 0;
}
.roles-page.is-mobile .name-form :deep(.el-input) {
  width: 100% !important;
}
</style>
