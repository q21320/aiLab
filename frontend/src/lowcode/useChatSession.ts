// ============================================================================
// AI 聊天会话 · 模块级内存 + 后端数据库持久化
//
// 1) 模块级 ref：SPA 路由切换不丢（即时可用）
// 2) 后端 chats 字段：刷新/换浏览器不丢（设计器加载时 hydrate）
// 3) 保存时机：发送/接收消息后 debounce 写入，搭现有“自动保存工程”便车
// ============================================================================

import { ref, watch, type Ref } from "vue";
import type { ResourceInfo } from "./generator";
import { apiUrl } from "../api/base";

export interface ChatMsg {
  role: "user" | "ai";
  text: string;
}

/** 会话槽 key：有 appId 用 "<appId>"（如 page_mvjikjnc_1），没有用 "default:page" / "default:form" */
export type ChatScope = string;

interface ChatSession {
  msgs: Ref<ChatMsg[]>;
  grounding: Ref<ResourceInfo[]>;
  visible: Ref<boolean>;
  hydrated: boolean;
}

const sessions = new Map<ChatScope, ChatSession>();

function ensureSession(scope: ChatScope): ChatSession {
  let s = sessions.get(scope);
  if (!s) {
    s = {
      msgs: ref<ChatMsg[]>([]),
      grounding: ref<ResourceInfo[]>([]),
      visible: ref(false),
      hydrated: false,
    };
    sessions.set(scope, s);
  }
  return s;
}

// ---------------------------------------------------------------------------
// 后端 API
// ---------------------------------------------------------------------------

/** 从服务端读取聊天历史（设计器 mounted 时调用） */
export async function hydrateChats(scope: ChatScope) {
  const s = ensureSession(scope);
  if (s.hydrated && s.msgs.value.length) return; // 已有数据，不重复拉
  try {
    const res = await fetch(apiUrl("/api/lowcode/projects"), { credentials: "include" });
    if (!res.ok) return;
    const body = await res.json();
    const chats = body?.chats?.[scope];
    if (Array.isArray(chats) && chats.length) {
      s.msgs.value = chats;
    }
    s.hydrated = true;
  } catch {
    /* 网络失败不阻塞设计器加载 */
  }
}

/** 每个 scope 落库保留的最近消息条数上限（防止会话无限增长撞上下文/存储） */
const MAX_PERSIST_MSGS = 60;

/** 收集当前所有 scope 的聊天数据（给 PUT /api/lowcode/projects 用），每槽只留最近若干条 */
export function collectChatsPayload(): Record<string, ChatMsg[]> {
  const out: Record<string, ChatMsg[]> = {};
  for (const [scope, s] of sessions) {
    out[scope] = s.msgs.value.slice(-MAX_PERSIST_MSGS);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 组件内使用
// ---------------------------------------------------------------------------

let _saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleChatSave() {
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    // 搭“自动保存工程”便车：发送一个自定义事件让 store 层把 chats 带进去
    window.dispatchEvent(new CustomEvent("ailab:chats-dirty"));
  }, 800);
}

/**
 * 在 <script setup> 中使用：
 *   const { chatMsgs, grounding, chatVisible, resetChat } = useChatSession(scope);
 */
export function useChatSession(scope: ChatScope) {
  const s = ensureSession(scope);

  // 消息变化时自动触发保存
  watch(
    () => s.msgs.value.length,
    () => scheduleChatSave(),
  );

  function resetChat() {
    s.msgs.value = [];
    scheduleChatSave();
  }

  return {
    chatMsgs: s.msgs,
    grounding: s.grounding,
    chatVisible: s.visible,
    resetChat,
  };
}
