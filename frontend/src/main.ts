import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import zhCn from "element-plus/es/locale/lang/zh-cn";
import "element-plus/dist/index.css";
import * as ElementPlusIconsVue from "@element-plus/icons-vue";

import App from "./App.vue";
import router from "./router";
import { guardIOSScaleOnFocus } from "./utils/iosFocusZoom";
import "./style.css";
// 放在 element-plus 之后：靠加载顺序覆盖组件默认内边距/宽度，不需要到处 !important
import "./styles/responsive.css";

guardIOSScaleOnFocus();

const app = createApp(App);

// 全局注册 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component);
}

app.use(createPinia());
app.use(router);
// 组件内置文案固定中文（日期面板、分页、空表格提示等）
app.use(ElementPlus, { locale: zhCn });

app.mount("#app");
