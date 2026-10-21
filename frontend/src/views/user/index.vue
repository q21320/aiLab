<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { Search, Plus, Refresh } from "@element-plus/icons-vue";
import { apiUrl } from "../../api/base";
import { ROLE_LABELS } from "../../stores/user";

type RoleKey = "admin" | "operator" | "viewer";

interface UserRow {
  username: string;
  name: string;
  role: RoleKey;
  enabled?: boolean;
}

/** 真实数据源：服务端用户表（backend/auth.mjs），不再是页面内假数据 */
const allUsers = ref<UserRow[]>([]);
const loading = ref(false);
const saving = ref(false);

/** 状态字段：服务端只有 enabled，这里映射成中文标签便于展示 */
function statusOf(u: UserRow): "启用" | "禁用" {
  return u.enabled === false ? "禁用" : "启用";
}

async function loadUsers() {
  loading.value = true;
  try {
    const res = await fetch(apiUrl("/api/users"), { credentials: "include" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      ElMessage.error(body?.error || `加载用户失败（${res.status}）`);
      return;
    }
    allUsers.value = (body.users || []).map((u: UserRow) => ({ ...u, enabled: u.enabled !== false }));
  } catch {
    ElMessage.error("无法连接后端服务，用户列表不可用");
  } finally {
    loading.value = false;
  }
}
onMounted(loadUsers);

// 搜索与筛选
const keyword = ref("");
const statusFilter = ref("");

// 分页
const currentPage = ref(1);
const pageSize = ref(5);

// 过滤后的数据
const filteredUsers = computed(() =>
  allUsers.value.filter((u) => {
    const k = keyword.value.trim();
    const matchKeyword = !k || u.name.includes(k) || u.username.includes(k) || ROLE_LABELS[u.role].includes(k);
    const matchStatus = !statusFilter.value || statusOf(u) === statusFilter.value;
    return matchKeyword && matchStatus;
  })
);

// 当前页数据
const pagedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return filteredUsers.value.slice(start, start + pageSize.value);
});

// 新增 / 编辑对话框
const dialogVisible = ref(false);
const dialogTitle = ref("新增用户");
const formRef = ref<FormInstance>();
const form = reactive({
  username: "",
  name: "",
  role: "viewer" as RoleKey,
  password: "",
  status: "启用" as "启用" | "禁用",
});

const rules: FormRules = {
  username: [
    { required: true, message: "请输入用户名", trigger: "blur" },
    { pattern: /^[A-Za-z][A-Za-z0-9_]{2,31}$/, message: "3-32 位字母/数字/下划线，以字母开头", trigger: "blur" },
  ],
  name: [{ required: true, message: "请输入显示名称", trigger: "blur" }],
  password: [{ min: 6, message: "密码至少 6 位", trigger: "blur" }],
};

function openAdd() {
  isEdit.value = false;
  dialogTitle.value = "新增用户";
  Object.assign(form, { username: "", name: "", role: "viewer", password: "", status: "启用" });
  dialogVisible.value = true;
}

const isEdit = ref(false);

function openEdit(row: UserRow) {
  isEdit.value = true;
  dialogTitle.value = "编辑用户";
  Object.assign(form, { ...row, password: "", status: statusOf(row) });
  dialogVisible.value = true;
}

async function submitForm() {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid || saving.value) return;
  saving.value = true;
  try {
    let res: Response;
    if (!isEdit.value) {
      // 新增：服务端校验用户名唯一/角色合法/密码长度
      res = await fetch(apiUrl("/api/users"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: form.username, name: form.name, role: form.role, password: form.password }),
      });
    } else {
      const patch: Record<string, unknown> = { name: form.name, role: form.role, enabled: form.status === "启用" };
      if (form.password) patch.password = form.password;
      res = await fetch(apiUrl(`/api/users/${encodeURIComponent(form.username)}`), {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      ElMessage.error(body?.error || `保存失败（${res.status}）`);
      return;
    }
    ElMessage.success(isEdit.value ? "修改成功" : "新增成功");
    dialogVisible.value = false;
    await loadUsers();
  } catch {
    ElMessage.error("无法连接后端服务");
  } finally {
    saving.value = false;
  }
}

async function handleDelete(row: UserRow) {
  try {
    await ElMessageBox.confirm(`确定要删除用户「${row.name}」吗？`, "提示", {
      type: "warning",
      confirmButtonText: "确定",
      cancelButtonText: "取消",
    });
  } catch {
    return;
  }
  try {
    const res = await fetch(apiUrl(`/api/users/${encodeURIComponent(row.username)}`), {
      method: "DELETE",
      credentials: "include",
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      ElMessage.error(body?.error || `删除失败（${res.status}）`);
      return;
    }
    ElMessage.success("删除成功");
    await loadUsers();
  } catch {
    ElMessage.error("无法连接后端服务");
  }
}

function resetSearch() {
  keyword.value = "";
  statusFilter.value = "";
  currentPage.value = 1;
}
</script>

<template>
  <div class="user-page">
    <el-card shadow="never">
      <!-- 搜索栏 -->
      <div class="toolbar">
        <el-input
          v-model="keyword"
          placeholder="搜索用户名 / 邮箱"
          :prefix-icon="Search"
          clearable
          style="width: 240px"
          @input="currentPage = 1"
        />
        <el-select
          v-model="statusFilter"
          placeholder="状态筛选"
          clearable
          style="width: 140px"
          @change="currentPage = 1"
        >
          <el-option label="启用" value="启用" />
          <el-option label="禁用" value="禁用" />
        </el-select>
        <el-button :icon="Refresh" @click="resetSearch">重置</el-button>
        <div class="spacer" />
        <el-button type="primary" :icon="Plus" @click="openAdd">新增用户</el-button>
      </div>

      <!-- 用户表格 -->
      <el-table v-loading="loading" :data="pagedUsers" style="width: 100%" class="mt16">
        <el-table-column prop="username" label="登录名" width="140" />
        <el-table-column prop="name" label="显示名称" min-width="160" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ ROLE_LABELS[row.role as RoleKey] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusOf(row) === '启用' ? 'success' : 'info'" size="small">
              {{ statusOf(row) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">
              编辑
            </el-button>
            <el-button link type="danger" size="small" @click="handleDelete(row)">
              删除
            </el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="暂无数据" />
        </template>
      </el-table>

      <!-- 分页 -->
      <div class="pagination">
        <el-pagination
          v-model:current-page="currentPage"
          v-model:page-size="pageSize"
          :page-sizes="[5, 10, 20]"
          :total="filteredUsers.length"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </el-card>

    <!-- 新增 / 编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="dialogTitle" width="440px">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="80px">
        <el-form-item label="登录名" prop="username">
          <el-input v-model="form.username" placeholder="用于登录，创建后不可修改" :disabled="isEdit" />
        </el-form-item>
        <el-form-item label="显示名称" prop="name">
          <el-input v-model="form.name" placeholder="如：王工程师" />
        </el-form-item>
        <el-form-item :label="isEdit ? '重置密码' : '密码'" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            show-password
            :placeholder="isEdit ? '留空则不修改' : '至少 6 位'"
          />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="管理员" value="admin" />
            <el-option label="工程师" value="operator" />
            <el-option label="访客" value="viewer" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status">
            <el-radio value="启用">启用</el-radio>
            <el-radio value="禁用">禁用</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.spacer {
  flex: 1;
}
.mt16 {
  margin-top: 16px;
}
.pagination {
  display: flex;
  justify-content: flex-end;
  margin-top: 16px;
}
</style>
