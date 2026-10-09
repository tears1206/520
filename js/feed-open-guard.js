/* 朋友圈「点图标没反应」的保险层（用户反馈 2026-10-06，选 A：点图标完全没反应）
 *
 * 现象：点桌面「朋友圈」图标后仍停在桌面 —— 说明应用自己的打开流程在显示页面**之前**抛了异常
 * （我这几轮改动加了若干渲染期的过滤/清理，某些存量数据形状可能让它抛错，页面于是没被显示出来）。
 *
 * 本文件做两件事（都不改变原有逻辑，只在出错时兜住）：
 *   ① 捕获并记录错误：window.onerror / unhandledrejection 里把与 feed 有关的错误记到
 *      window.__feedOpenError，并在控制台打印 [milk] feed error: …
 *   ② 保险打开：点桌面「朋友圈」图标后 400ms 检查页面是否真的显示；没显示就强制显示
 *      并重试渲染（渲染本身也包一层 try/catch，保证至少能看到顶部按钮与列表容器）。
 */
(function () {
  'use strict';

  window.__feedOpenLog = window.__feedOpenLog || [];

  function logErr(where, err) {
    try {
      var msg = String((err && (err.stack || err.message)) || err || 'unknown');
      window.__feedOpenError = { where: where, msg: msg, ts: Date.now() };
      window.__feedOpenLog.push({ where: where, msg: msg, ts: Date.now() });
      if (window.__feedOpenLog.length > 20) window.__feedOpenLog.shift();
      try { console.warn('[milk] feed error @' + where + ': ' + msg); } catch (e) {}
    } catch (e2) {}
  }
  try { window.__feedLogError = logErr; } catch (e0) {}

  try {
    window.addEventListener('error', function (ev) {
      try { logErr('window', ev && (ev.error || ev.message)); } catch (e) {}
    });
  } catch (e1) {}
  try {
    window.addEventListener('unhandledrejection', function (ev) {
      try { logErr('promise', ev && ev.reason); } catch (e) {}
    });
  } catch (e2) {}

  function feedVisible() {
    try {
      var pf = document.getElementById('page-feed');
      if (!pf) return false;
      var cs = getComputedStyle(pf);
      return !pf.hidden && cs.display !== 'none' && cs.visibility !== 'hidden';
    } catch (e) { return false; }
  }

  function forceOpenFeed() {
    try {
      var pages = document.querySelectorAll('.page');
      for (var i = 0; i < pages.length; i++) pages[i].hidden = true;
      var pf = document.getElementById('page-feed');
      if (!pf) return false;
      pf.hidden = false;
      try { pf.style.display = 'flex'; } catch (e0) {}
      ['renderCover', 'renderNotices', 'render'].forEach(function (fn) {
        try { if (typeof window[fn] === 'function') window[fn](); } catch (e1) { logErr(fn, e1); }
      });
      try { if (typeof window.renderFeed === 'function') window.renderFeed(); } catch (e2) { logErr('renderFeed', e2); }
      return true;
    } catch (e) { logErr('forceOpen', e); return false; }
  }
  try { window.__feedForceOpen = forceOpenFeed; } catch (e3) {}

  // 点桌面「朋友圈」图标：400ms 后若页面没显示，就保险打开
  try {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var app = (t && t.closest) ? t.closest('.app[data-app="feed"]') : null;
      if (!app) return;
      setTimeout(function () {
        if (feedVisible()) return;
        logErr('open', 'feed page not visible 400ms after click -> force open');
        forceOpenFeed();
      }, 400);
    }, true);
  } catch (e4) {}

  // 也兜住「打开时抛错导致整页白」的情况：若 body 下没有任何可见页面，尝试恢复桌面
  try {
    setTimeout(function () {
      try {
        var anyVisible = false;
        document.querySelectorAll('.page').forEach(function (p) {
          if (!p.hidden && getComputedStyle(p).display !== 'none') anyVisible = true;
        });
        if (!anyVisible) logErr('boot', 'no visible page after boot');
      } catch (e) {}
    }, 3000);
  } catch (e5) {}
})();
