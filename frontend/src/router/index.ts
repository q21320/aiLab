import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import BasicLayout from "../layouts/BasicLayout.vue";
import { useUserStore } from "../stores/user";

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
        meta: { title: "AI 低代码", icon: "MagicStick" },
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

// 全局前置守卫：未登录跳转到登录页
router.beforeEach((to, _from, next) => {
  const userStore = useUserStore();
  document.title = (to.meta.title as string) || "SaaS 管理后台";

  if (to.meta.public) {
    next();
  } else if (userStore.token) {
    next();
  } else {
    next("/login");
  }
});

export default router;
