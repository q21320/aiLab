import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// 代理规则：/api/dashscope 走阿里云（AI 页面生成），其余 /api 走本地后端服务
const proxy = {
  "/api/dashscope": {
    target: "https://dashscope.aliyuncs.com",
    changeOrigin: true,
    rewrite: (path: string) => path.replace(/^\/api\/dashscope/, ""),
  },
  "/api": {
    target: "http://localhost:3800",
    changeOrigin: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  // 开发服务器代理
  server: { proxy },
  // 生产构建本地预览（npm run preview）同样代理 /api，
  // 否则发布会请求 /api/lowcode/apps 落到静态服务器返回 404
  preview: { proxy },
});
