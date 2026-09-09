import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  server: {
    // 对象形式按 key 顺序匹配：/api/dashscope 走阿里云（AI 生成），其余 /api 走本机后端
    proxy: {
      "/api/dashscope": {
        target: "https://dashscope.aliyuncs.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/dashscope/, ""),
      },
      "/api": {
        target: "http://localhost:3800",
        changeOrigin: true,
      },
    },
  },
});
