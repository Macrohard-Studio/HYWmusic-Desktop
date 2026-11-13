/* ============================================================
   启动动画配色
   在首帧绘制前同步应用已保存的主题，避免先闪一下默认色。
   必须独立成文件：CSP 为 script-src 'self'，禁止内联脚本。
   ============================================================ */
(function () {
  try {
    var pref = localStorage.getItem('hyw-theme') || 'auto';
    if (window.Theme) window.Theme.apply(pref);
  } catch (e) {}
})();
