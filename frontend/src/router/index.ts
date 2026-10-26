import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import BasicLayout from "../layouts/BasicLayout.vue";
import { useUserStore } from "../stores/user";
import { useAclStore } from "../stores/acl";

// ============================================================================
// 路由表
//
// 权限不再写在这里：meta 只描述标题/图标与业务参数，
// 谁能进哪个页面由服务端「角色权限」（stores/acl.ts → /api/auth/acl）统一决定，
// 菜单渲染、路由守卫、接口拦截三处共用同一份配置。
// ============================================================================
const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    component: () => import("../views/login/index.vue"),
    meta: { title: "登录", public: true },
  },
  {
    path: "/",
    component: BasicLayout,
    redirect: "/dashboard",
    children: [
      {
        path: "dashboard",
        name: "Dashboard",
        component: () => import("../views/dashboard/index.vue"),
        meta: { title: "仪表盘", icon: "Odometer" },
      },
      {
        path: "lowcode",
        name: "LowCode",
        component: () => import("../views/lowcode/index.vue"),
        meta: { title: "低代码开发平台", icon: "MagicStick" },
      },
      {
        path: "apps",
        name: "Apps",
        component: () => import("../views/apps/index.vue"),
        meta: { title: "应用中心", icon: "Star" },
      },
      {
        path: "app/:kind/:id",
        name: "AppRuntime",
        component: () => import("../views/apps/AppRuntime.vue"),
        meta: { title: "应用运行" },
      },
      {
        path: "formdata",
        name: "FormData",
        component: () => import("../views/formdata/index.vue"),
        meta: { title: "表单数据", icon: "Document" },
      },
      {
        path: "iot",
        name: "IotDevices",
        component: () => import("../views/iot/index.vue"),
        meta: { title: "设备接入", icon: "Monitor" },
      },
      {
        path: "alerts",
        name: "IotAlerts",
        component: () => import("../views/alerts/index.vue"),
        meta: { title: "告警管理", icon: "Warning" },
      },
      {
        path: "autotest",
        name: "AutoTest",
        component: () => import("../views/autotest/index.vue"),
        meta: { title: "自动化测试", icon: "Cpu" },
      },
      {
        path: "production",
        name: "Production",
        component: () => import("../views/production/index.vue"),
        meta: { title: "排产管理", icon: "Operation" },
      },
      {
        path: "samples",
        name: "Samples",
        component: () => import("../views/samples/index.vue"),
        meta: { title: "样品管理", icon: "Box" },
      },
      // ---- 实验室管理·台账模块（字段见 views/lab/resources.ts，数据走通用 CRUD）----
      {
        path: "lab/projects",
        name: "LabProjects",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "测试项目", icon: "Tickets", labResource: "projects" },
      },
      {
        path: "lab/outsource-projects",
        name: "LabOutsourceProjects",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "委外项目", icon: "Van", labResource: "outsourceProjects" },
      },
      {
        path: "lab/reimbursements",
        name: "LabReimbursements",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "日常报销", icon: "Coin", labResource: "reimbursements" },
      },
      {
        path: "lab/finance/income",
        name: "LabFinIncome",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "收入项目", icon: "TrendCharts", labResource: "income" },
      },
      {
        path: "lab/finance/expense",
        name: "LabFinExpense",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "支出项目", icon: "Histogram", labResource: "expense" },
      },
      {
        path: "lab/customers",
        name: "LabCustomers",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "客户信息", icon: "Service", labResource: "customers" },
      },
      {
        path: "lab/equipment",
        name: "LabEquipment",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "设备信息", icon: "Monitor", labResource: "equipment" },
      },
      {
        path: "lab/consumables",
        name: "LabConsumables",
        component: () => import("../views/lab/index.vue"),
        meta: { title: "耗材信息", icon: "Box", labResource: "consumables" },
      },
      // ---- 系统管理 ----
      {
        path: "menus",
        name: "Menus",
        component: () => import("../views/menu/index.vue"),
        meta: { title: "导航菜单", icon: "Menu" },
      },
      {
        path: "roles",
        name: "Roles",
        component: () => import("../views/roles/index.vue"),
        meta: { title: "角色权限", icon: "Lock" },
      },
      {
        path: "logs",
        name: "Logs",
        component: () => import("../views/logs/index.vue"),
        meta: { title: "操作日志", icon: "Notebook" },
      },
      {
        path: "user",
        name: "User",
        component: () => import("../views/user/index.vue"),
        meta: { title: "用户管理", icon: "UserFilled" },
      },
      {
        path: "setting",
        name: "Setting",
        component: () => import("../views/setting/index.vue"),
        meta: { title: "系统设置", icon: "Setting" },
      },
    ],
  },
  {
    path: "/:pathMatch(.*)*",
    redirect: "/dashboard",
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 全局前置守卫：未登录跳登录页；无页面权限落到第一个可见页
// 安全：身份与权限均来自服务端（/api/auth/me、/api/auth/acl），本地缓存不作为依据
router.beforeEach(async (to, _from, next) => {
  const userStore = useUserStore();
  const acl = useAclStore();
  // 标签页统一「页面名 · 平台名」：只设页面名的话，平台名在浏览器标签上永远不出现
  const pageTitle = (to.meta.title as string) || "";
  document.title = pageTitle ? `${pageTitle} · 实验室数字化管理平台` : "实验室数字化管理平台";

  // 首次进入（或刷新）时向服务端确认会话，并同步拉取该身份的页面权限
  // 两个 store 各自带节流/就绪标记，登出与登录由调用方重置，无需额外全局开关
  if (!userStore.ready) await userStore.refresh();
  if (userStore.token && !acl.ready) await acl.load();

  if (to.meta.public) {
    // 已登录用户访问登录页 → 回到自己有权访问的首屏
    if (to.path === "/login" && userStore.token) return next(acl.firstViewable());
    return next();
  }

  if (!userStore.token) {
    return next({ path: "/login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } });
  }

  if (!acl.canView(to.path)) {
    const target = acl.firstViewable();
    // 连一个可见页都没有时停在原处，由页面内的接口 403 兜底提示
    if (target === to.path) return next();
    return next(target);
  }
  next();
});

export default router;
