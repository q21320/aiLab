// ============================================================================
// iOS 聚焦防放大（微信内置浏览器 / WKWebView）
//
// iOS 的机制：点输入框时若判定「控件字号 <16px」就强制放大整页，且失焦后不缩回。
// 把输入框都抬到 16px 是正规解法（responsive.css 已做），但部分 webview 版本
// （尤其微信内置浏览器）仍会触发放大，判定口径和 Safari 有出入。
//
// 这里两件事：
// 1) 兜底防放大——聚焦可输入控件的瞬间给 viewport meta 加 maximum-scale=1 锁死
//    缩放，失焦后还原。注意 user-scalable=no 在 iOS10+ 已被无视（无障碍政策），
//    但「动态改 maximum-scale」仍然拦得住聚焦自动放大，且平时不限制用户双指缩放。
// 2) 键盘可视高度——iOS 布局视口（100vh/100%）不随键盘收缩，全屏弹窗的底部按钮
//    会被键盘盖住。监听 visualViewport 把真实可视高度写进 --app-vh，
//    responsive.css 里弹窗高度改挂这个变量，键盘一弹弹窗就缩到键盘上方。
// ============================================================================

const FOCUSABLE = "input, textarea, select, [contenteditable='true']";

function publishVisibleHeight() {
  const vv = window.visualViewport;
  if (!vv) return;
  const h = Math.round(vv.height);
  // 只在可视高明显小于布局视口（≈键盘弹起）时才收缩；
  // 否则常驻写 vv.height 会让安卓 webview 底部工具条也扣掉一截，全屏弹窗底下露缝
  if (h < window.innerHeight - 100) {
    document.documentElement.style.setProperty("--app-vh", `${Math.max(300, h)}px`);
  } else {
    document.documentElement.style.removeProperty("--app-vh");
  }
}

export function guardIOSScaleOnFocus() {
  // 只给触控设备挂（桌面端没有这个行为，别白折腾）
  if (!window.matchMedia("(hover: none) and (pointer: coarse)").matches) return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return;
  const normal = meta.content;
  const locked = `${normal.replace(/,\s*maximum-scale=[^,]+/, "")}, maximum-scale=1`;

  publishVisibleHeight();
  window.visualViewport?.addEventListener("resize", publishVisibleHeight);
  window.addEventListener("resize", publishVisibleHeight);

  document.addEventListener(
    "focusin",
    (e) => {
      const t = e.target as HTMLElement | null;
      const input = t?.closest?.(FOCUSABLE) as HTMLElement | null;
      if (!input) return;
      meta.content = locked;
      // iOS webview 的布局视口不随键盘收缩，靠底的输入框/按钮会被键盘盖住：
      // 等键盘弹起动画完成后把聚焦项滚到可视区中部（visualViewport 高度变化才可靠）
      setTimeout(() => input.scrollIntoView({ block: "center", behavior: "smooth" }), 300);
    },
    { capture: true },
  );
  document.addEventListener(
    "focusout",
    (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.(FOCUSABLE)) meta.content = normal;
    },
    { capture: true },
  );
}
