import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import BasicLayout from "../layouts/BasicLayout.vue";
import { useUserStore, type UserRole } from "../stores/user";

/** 路由权限：roles 省略表示全部角色可见 */
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
        meta: { title: "低代码开发平台", icon: "MagicStick", roles: ["admin"] as UserRole[] },
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
        meta: { title: "表单数据", icon: "Document", roles: ["admin", "operator"] as UserRole[] },
      },
      {
        path: "iot",
        name: "IotDevices",
        component: () => import("../views/iot/index.vue"),
        meta: { title: "设备接入", icon: "Monitor", roles: ["admin", "operator"] as UserRole[] },
      },
      {
        path: "autotest",
        name: "AutoTest",
        component: () => import("../views/autotest/index.vue"),
        meta: { title: "自动化测试", icon: "Cpu", roles: ["admin", "operator"] as UserRole[] },
      },
      {
        path: "production",
        name: "Production",
        component: () => import("../views/production/index.vue"),
        meta: { title: "排产管理", icon: "Operation", roles: ["admin", "operator"] as UserRole[] },
      },
      {
        path: "samples",
        name: "Samples",
        component: () => import("../views/samples/index.vue"),
        meta: { title: "样品管理", icon: "Box", roles: ["admin", "operator"] as UserRole[] },
      },
      {
        path: "menus",
        name: "Menus",
        component: () => import("../views/menu/index.vue"),
        meta: { title: "导航菜单", icon: "Menu", roles: ["admin"] as UserRole[] },
      },
      {
        path: "logs",
        name: "Logs",
        component: () => import("../views/logs/index.vue"),
        meta: { title: "操作日志", icon: "Notebook", roles: ["admin"] as UserRole[] },
      },
      {
        path: "user",
        name: "User",
        component: () => import("../views/user/index.vue"),
        meta: { title: "用户管理", icon: "UserFilled", roles: ["admin"] as UserRole[] },
      },
      {
        path: "setting",
        name: "Setting",
        component: () => import("../views/setting/index.vue"),
        meta: { title: "系统设置", icon: "Setting", roles: ["admin"] as UserRole[] },
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

// 全局前置守卫：未登录跳转到登录页；角色不满足返回仪表盘
router.beforeEach((to, _from, next) => {
  const userStore = useUserStore();
  document.title = (to.meta.title as string) || "实验室数字化管理平台";

  if (to.meta.public) {
    next();
  } else if (!userStore.token) {
    next("/login");
  } else if ((to.meta.roles as UserRole[] | undefined) && !userStore.hasRole(to.meta.roles as UserRole[])) {
    next("/dashboard");
  } else {
    next();
  }
});

export default router;
