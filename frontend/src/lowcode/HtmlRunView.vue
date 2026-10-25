<script setup lang="ts">
// ============================================================================
// AI 自由页面运行容器（kind:"html" 的渲染器，设计器预览与应用运行页共用）
//
// 安全模型：严格 sandbox + postMessage 桥接
//   · iframe 只给 allow-scripts，**不给 allow-same-origin** → 处于不透明源，
//     生成的代码读不到 Cookie / token / 父页面 DOM。
//   · 页面取数只能用注入的 window.__ailab.*；请求经 postMessage 交给本组件，
//     由父页面带着当前会话执行同源 /api/* 请求，只把 JSON 结果回传给框架。
//   · 每次渲染生成随机 nonce 注入框架脚本；父端只接受
//     event.source===当前框架 contentWindow 且 nonce 匹配 的消息，
//     弥补不透明源下 event.origin 恒为 "null" 无法校验的问题。
// 与后端交互约定需与 generator.ts 里 HTML_API_DOC 描述保持一致。
// ============================================================================
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { apiUrl } from "../api/base";

const props = defineProps<{ html: string }>();

const frameRef = ref<HTMLIFrameElement | null>(null);
const srcdoc = ref("");
const ready = ref(false);
let nonce = "";
let renderTimer: ReturnType<typeof setTimeout> | undefined;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "DELETE"]);

/** 只放行同源 /api/ 相对路径，拒绝绝对地址与协议相对(//host) */
function isAllowedPath(path: unknown): path is string {
  if (typeof path !== "string") return false;
  if (!path.startsWith("/api/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("://")) return false;
  return true;
}

/** 生成注入到框架里的桥接客户端脚本（运行在 iframe 内，定义 window.__ailab） */
function buildBootstrap(n: string): string {
  return (
    "<script>(function(){var NONCE=" +
    JSON.stringify(n) +
    ";var seq=0,pending={};" +
    "window.addEventListener('message',function(e){var d=e.data;" +
    "if(!d||d.__ailabReply!==true||d.nonce!==NONCE)return;" +
    "var p=pending[d.id];if(!p)return;delete pending[d.id];" +
    "if(d.ok){p.resolve(d.data);}else{var err=new Error((d.data&&(d.data.error||d.data.message))||('请求失败 '+(d.status||'网络异常')));" +
    "err.status=d.status;err.data=d.data;p.reject(err);}});" +
    "function request(method,path,body){return new Promise(function(resolve,reject){" +
    "if(typeof path!=='string'||path.indexOf('/api/')!==0||path.indexOf('//')===0){reject(new Error('非法路径：只允许以 /api/ 开头的同源相对路径'));return;}" +
    "var id='r'+(++seq);pending[id]={resolve:resolve,reject:reject};" +
    "parent.postMessage({__ailab:true,nonce:NONCE,id:id,method:method,path:path,body:(body===undefined?null:body)},'*');});}" +
    "window.__ailab={get:function(path){return request('GET',path);}," +
    "post:function(path,body){return request('POST',path,body);}," +
    "put:function(path,body){return request('PUT',path,body);}," +
    "del:function(path){return request('DELETE',path);}};})();" +
    "<\/script>"
  );
}

/** 把桥接脚本注入到用户 HTML 的 <head>/<body>/文档最前，且尽量不破坏标准模式 */
function injectBootstrap(html: string, n: string): string {
  const boot = buildBootstrap(n);
  const doc = String(html || "");
  if (/<head[^>]*>/i.test(doc)) return doc.replace(/<head[^>]*>/i, (m) => m + boot);
  if (/<body[^>]*>/i.test(doc)) return doc.replace(/<body[^>]*>/i, (m) => m + boot);
  if (/<html[^>]*>/i.test(doc)) return doc.replace(/<html[^>]*>/i, (m) => m + boot);
  if (/^\s*<!DOCTYPE html>/i.test(doc)) return doc.replace(/(<!DOCTYPE html>)/i, (_m, d) => d + boot);
  return boot + doc;
}

/** 渲染/重渲染：生成新 nonce、拼装 srcdoc */
function render() {
  const content = String(props.html || "").trim();
  if (!content) {
    srcdoc.value = "";
    ready.value = false;
    return;
  }
  nonce = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  srcdoc.value = injectBootstrap(content, nonce);
  ready.value = true;
}

/** 父端：代框架执行同源请求并回传结果 */
async function handleRequest(source: Window | null, msg: any) {
  if (!source) return;
  const { id, method, path, body } = msg;
  const reply = (payload: Record<string, unknown>) => {
    try {
      source.postMessage({ __ailabReply: true, nonce, id, ...payload }, "*");
    } catch {
      /* 框架已销毁，忽略 */
    }
  };
  if (!ALLOWED_METHODS.has(String(method))) {
    reply({ ok: false, status: 405, data: { error: "不支持的方法：" + method } });
    return;
  }
  if (!isAllowedPath(path)) {
    reply({ ok: false, status: 400, data: { error: "非法路径：只允许以 /api/ 开头的同源相对路径" } });
    return;
  }
  try {
    const init: RequestInit = { method: String(method), credentials: "include", headers: { "Content-Type": "application/json" } };
    if (String(method) !== "GET" && String(method) !== "DELETE" && body != null) {
      init.body = JSON.stringify(body);
    }
    const res = await fetch(apiUrl(path as string), init);
    const data = await res.json().catch(() => ({ raw: "" }));
    reply({ ok: res.ok, status: res.status, data });
  } catch (e: any) {
    reply({ ok: false, status: 0, data: { error: e?.message || "网络异常" } });
  }
}

function onMessage(event: MessageEvent) {
  const frame = frameRef.value;
  const d = event.data;
  if (!frame || !d || d.__ailab !== true) return;
  // 双重绑定：消息必须来自当前框架，且带本轮 nonce
  if (event.source !== frame.contentWindow) return;
  if (d.nonce !== nonce) return;
  void handleRequest(event.source, d);
}

onMounted(() => {
  window.addEventListener("message", onMessage);
  render();
});
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  clearTimeout(renderTimer);
});
// html 变化防抖重渲染：设计器源码框逐字编辑时不至于每键重载 iframe
watch(
  () => props.html,
  () => {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 300);
  },
);
</script>

<template>
  <div class="html-run-view">
    <iframe
      v-if="ready"
      ref="frameRef"
      class="html-frame"
      :srcdoc="srcdoc"
      sandbox="allow-scripts"
      title="AI 自由页面"
    />
    <div v-else class="html-empty">
      <el-empty description="还没有页面内容：先让 AI 生成，或在源码框里编写" :image-size="80" />
    </div>
  </div>
</template>

<style scoped>
.html-run-view {
  width: 100%;
  height: 100%;
  min-height: 320px;
  background: #fff;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}
.html-frame {
  width: 100%;
  height: 100%;
  min-height: 320px;
  border: none;
  display: block;
  background: #fff;
}
.html-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 320px;
}
</style>
