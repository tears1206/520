/* 浮层层级守护（用户要求 2026-10-05：设置页 / 弹窗要压在顶部卡片之上，不能被它盖住）
 *
 * 背景：进聊天页时 home-shell.js 会把 .main-chat-area 设成 position:fixed; z-index:200，
 *       把顶部卡片/头部 .header 设成 position:fixed; z-index:201。
 *       于是聊天层里的**所有** .modal 与 [id^="page-"] 都被关在 200 这个层叠上下文里，
 *       无论自身 z-index 写多大（.modal 是 2000），顶边一定会被头部盖住。
 *
 * 做法：只要聊天层里存在「铺满视口的浮层」，就把聊天层的 z-index 抬到 205（高于头部 201）；
 *       浮层全部关掉后还原成 200。不动头部、也不改各弹窗自身样式，一次性修好所有浮层。
 * 只扫描聊天层内部的浮层（避免把桌面层 #page-phone 误判为打开中）。
 */
(function () {
  'use strict';
  var RAISE_Z = '205';
  var BASE_Z = '200';
  var dbg = { open: null, seen: 0, names: [], layerZ: null, applied: 0 };
  try { window.__layerGuard = dbg; } catch (e) {}
  try { document.documentElement.setAttribute('data-layer-guard', '1'); } catch (e) {}

  function chatLayer() { return document.querySelector('.main-chat-area'); }

  function overlayOpen() {
    try {
      var layer = chatLayer();
      if (!layer) return false;
      var list = layer.querySelectorAll('.modal, [id^="page-"]');
      dbg.seen = list.length;
      dbg.names = [];
      for (var i = 0; i < list.length; i++) {
        var el = list[i];
        var cs = getComputedStyle(el);
        var r = el.getBoundingClientRect();
        var big = r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.5;
        var shown = !el.hidden && cs.display !== 'none';
        if (shown && big) {
          dbg.names.push((el.id || el.className || el.tagName) + ':' + Math.round(r.width) + 'x' + Math.round(r.height));
        }
        if (shown && big && cs.visibility !== 'hidden') return true;
      }
    } catch (e) { dbg.err = String(e && e.message); }
    return false;
  }

  function apply() {
    try {
      var layer = chatLayer();
      if (!layer) return;
      if (!layer.style || !layer.style.zIndex) return; // 只在聊天视图（固定整屏）时处理
      var open = overlayOpen();
      dbg.open = open;
      var want = open ? RAISE_Z : BASE_Z;
      if (layer.style.zIndex !== want) { layer.style.zIndex = want; dbg.applied++; }
      dbg.layerZ = layer.style.zIndex;
    } catch (e) { dbg.err2 = String(e && e.message); }
  }

  setInterval(apply, 250);
  document.addEventListener('click', function () { setTimeout(apply, 30); }, true);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setTimeout(apply, 60); }, true);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(apply, 300); });
  else setTimeout(apply, 300);
})();
