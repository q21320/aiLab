// ============================================================================
// 视口断点（移动端适配的唯一判据）
//
// CSS 能解决的都在 styles/responsive.css 里用 @media 解决了；这里只服务
// 「必须改 DOM 结构」的场景：台账表格→卡片列表、侧栏→抽屉导航。
// 断点值必须与 responsive.css 保持一致，改一处就要改两处。
// ============================================================================

import { ref, readonly } from "vue";

/** 手机：与 responsive.css 的 767px 断点对应 */
const MOBILE_QUERY = "(max-width: 767px)";
/** 手机 + 平板竖屏：与 responsive.css 的 1099px 断点对应 */
const NARROW_QUERY = "(max-width: 1099px)";

const mobile = ref(false);
const narrow = ref(false);
let bound = false;

/** 触屏且物理屏窄（手机）：部分安卓 webview（尤其微信）会把布局视口报成 980/1024，
 *  只看 innerWidth 会把它当成桌面，导致卡片/抽屉整套手机端结构失效。
 *  screen.width 不受视口缩放影响；取长短边较小值以匹配竖屏实际宽度。 */
function coarseSmallScreen(): boolean {
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return false;
  return Math.min(window.screen.width, window.screen.height) < 768;
}

function sync() {
  mobile.value = window.matchMedia(MOBILE_QUERY).matches || coarseSmallScreen();
  narrow.value = window.matchMedia(NARROW_QUERY).matches || coarseSmallScreen();
}

export function useViewport() {
  // 全站共享一份状态，只在第一次调用时挂监听（resize + 转屏都要跟）
  if (!bound) {
    bound = true;
    sync();
    window.addEventListener("resize", sync, { passive: true });
    window.addEventListener("orientationchange", sync, { passive: true });
  }
  return {
    /** 手机（<768px）：表格换卡片、导航换抽屉 */
    isMobile: readonly(mobile),
    /** 手机或平板（<1100px）：布局收窄、图表单列 */
    isNarrow: readonly(narrow),
  };
}
