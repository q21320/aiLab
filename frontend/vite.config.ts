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
  // 开发服务器：host: true = 监听 0.0.0.0，局域网（手机/其他电脑）可用本机 IP 访问 5173；
  // 只监听 127.0.0.1 时 http://10.x.x.x:5173 会直接连不上。
  // API 仍走下方 /api 代理（同源请求），不需要改后端 CORS 白名单。
  server: { host: true, proxy },
  // 生产构建本地预览（npm run preview）同样代理 /api，
  // 否则发布会请求 /api/lowcode/apps 落到静态服务器返回 404
  preview: { host: true, proxy },
});
