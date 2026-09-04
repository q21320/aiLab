<script setup lang="ts">
import { ref, reactive, computed } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import type { FormInstance, FormRules } from "element-plus";
import { Search, Plus, Refresh } from "@element-plus/icons-vue";

interface UserRow {
  id: number;
  name: string;
  email: string;
  role: string;
  status: "启用" | "禁用";
  createdAt: string;
}

// 模拟数据源
const allUsers = ref<UserRow[]>([
  { id: 1, name: "张三", email: "zhangsan@example.com", role: "管理员", status: "启用", createdAt: "2026-01-12" },
  { id: 2, name: "李四", email: "lisi@example.com", role: "普通用户", status: "启用", createdAt: "2026-02-03" },
  { id: 3, name: "王五", email: "wangwu@example.com", role: "普通用户", status: "禁用", createdAt: "2026-03-18" },
  { id: 4, name: "赵六", email: "zhaoliu@example.com", role: "运营", status: "启用", createdAt: "2026-04-25" },
  { id: 5, name: "孙七", email: "sunqi@example.com", role: "普通用户", status: "启用", createdAt: "2026-05-09" },
  { id: 6, name: "周八", email: "zhouba@example.com", role: "运营", status: "禁用", createdAt: "2026-06-14" },
  { id: 7, name: "吴九", email: "wujiu@example.com", role: "普通用户", status: "启用", createdAt: "2026-07-21" },
]);

// 搜索与筛选
const keyword = ref("");
const statusFilter = ref("");

// 分页
const currentPage = ref(1);
const pageSize = ref(5);

// 过滤后的数据
const filteredUsers = computed(() =>
  allUsers.value.filter((u) => {
    const matchKeyword =
      !keyword.value ||
      u.name.includes(keyword.value) ||
      u.email.includes(keyword.value);
    const matchStatus = !statusFilter.value || u.status === statusFilter.value;
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
  id: 0,
  name: "",
  email: "",
  role: "普通用户",
  status: "启用" as "启用" | "禁用",
});

const rules: FormRules = {
  name: [{ required: true, message: "请输入用户名", trigger: "blur" }],
  email: [
    { required: true, message: "请输入邮箱", trigger: "blur" },
    { type: "email", message: "邮箱格式不正确", trigger: "blur" },
  ],
};

function openAdd() {
  dialogTitle.value = "新增用户";
  Object.assign(form, { id: 0, name: "", email: "", role: "普通用户", status: "启用" });
  dialogVisible.value = true;
}

function openEdit(row: UserRow) {
  dialogTitle.value = "编辑用户";
  Object.assign(form, { ...row });
  dialogVisible.value = true;
}

function submitForm() {
  formRef.value?.validate((valid) => {
    if (!valid) return;
    if (form.id === 0) {
      const newId = Math.max(0, ...allUsers.value.map((u) => u.id)) + 1;
      allUsers.value.unshift({
        id: newId,
        name: form.name,
        email: form.email,
        role: form.role,
        status: form.status,
        createdAt: new Date().toISOString().slice(0, 10),
      });
      ElMessage.success("新增成功");
    } else {
      const idx = allUsers.value.findIndex((u) => u.id === form.id);
      if (idx !== -1) {
        allUsers.value[idx] = { ...allUsers.value[idx], ...form };
      }
      ElMessage.success("修改成功");
    }
    dialogVisible.value = false;
  });
}

function handleDelete(row: UserRow) {
  ElMessageBox.confirm(`确定要删除用户「${row.name}」吗？`, "提示", {
    type: "warning",
    confirmButtonText: "确定",
    cancelButtonText: "取消",
  })
    .then(() => {
      allUsers.value = allUsers.value.filter((u) => u.id !== row.id);
      ElMessage.success("删除成功");
    })
    .catch(() => {});
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
      <el-table :data="pagedUsers" style="width: 100%" class="mt16">
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="name" label="用户名" width="120" />
        <el-table-column prop="email" label="邮箱" min-width="200" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            <el-tag size="small" effect="plain">{{ row.role }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.status === '启用' ? 'success' : 'info'" size="small">
              {{ row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="createdAt" label="创建时间" width="130" />
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
        <el-form-item label="用户名" prop="name">
          <el-input v-model="form.name" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" placeholder="请输入邮箱" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" style="width: 100%">
            <el-option label="管理员" value="管理员" />
            <el-option label="运营" value="运营" />
            <el-option label="普通用户" value="普通用户" />
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
        <el-button type="primary" @click="submitForm">确定</el-button>
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
