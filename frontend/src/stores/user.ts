import { defineStore } from "pinia";
import { ref } from "vue";

export const useUserStore = defineStore("user", () => {
  const token = ref<string>(localStorage.getItem("token") || "");
  const name = ref<string>(localStorage.getItem("username") || "");
  const role = ref<string>("管理员");
  const avatar = ref<string>("");

  /** 模拟登录：任意非空账号密码即可通过 */
  function login(username: string, password: string): boolean {
    if (username.trim() && password.trim()) {
      token.value = "mock-token-" + Date.now();
      name.value = username;
      localStorage.setItem("token", token.value);
      localStorage.setItem("username", username);
      return true;
    }
    return false;
  }

  /** 退出登录，清空状态 */
  function logout() {
    token.value = "";
    name.value = "";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
  }

  return { token, name, role, avatar, login, logout };
});
