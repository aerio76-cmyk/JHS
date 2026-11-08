// 三頁共用的導覽小工具（index.html、entry.html、materials.html）：
// 1. 頁首高度寫進 CSS 變數 --header-h：sticky 頁首換行變高時，家長端左側選單與 scroll-padding 跟著調整，不會被蓋住。
// 2. 未儲存提醒：表單有未儲存的內容時，點連結離開本頁或關閉分頁前先確認。
(() => {
  const root = document.documentElement;
  const setHeaderHeight = () => {
    const header = document.querySelector('.site-header');
    if (header) root.style.setProperty('--header-h', `${Math.ceil(header.getBoundingClientRect().height)}px`);
  };

  let dirty = false;
  window.siteNav = {
    markDirty() { dirty = true; },
    markClean() { dirty = false; },
    isDirty: () => dirty,
  };

  document.addEventListener('DOMContentLoaded', () => {
    setHeaderHeight();
    const header = document.querySelector('.site-header');
    if (header && 'ResizeObserver' in window) new ResizeObserver(setHeaderHeight).observe(header);
    else window.addEventListener('resize', setHeaderHeight);

    // 連到其他頁面的連結（同頁的 #/… 換頁不算離開）
    document.addEventListener('click', (e) => {
      const a = e.target.closest?.('a[href]');
      if (!a || !dirty || e.defaultPrevented) return;
      const url = new URL(a.getAttribute('href'), location.href);
      if (url.pathname === location.pathname) return;
      if (!window.confirm('有尚未儲存的內容，確定要離開這一頁嗎？')) e.preventDefault();
      else dirty = false; // 已確認，不要再被 beforeunload 問第二次
    }, true);
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
})();
