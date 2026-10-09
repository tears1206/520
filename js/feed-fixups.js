/* 朋友圈评论条修正（本工程 markup 与新版错位导致的两处问题）
 *
 * ① 可见性：本工程把「评论输入条 #feed-comment-bar + 输入框 + 发送 + 表情/图片入口」都放在
 *    #feed-comment-panel 里面；而 feed.js 的 showCommentBar() 是新版结构：只把
 *    #feed-comment-bar 取消隐藏，并把 #feed-comment-panel 藏起来（新版 panel 只装表情选择器）
 *    → 点了【评论】看不到输入框。这里按「评论条可见 ⇔ 面板可见」严格跟随：
 *      点【评论】才出现，收起/发送后一起收起。
 * ② 关闭：面板头右上角的 × (#feed-comment-close) 在 feed.js 里没有任何绑定，点了没反应；
 *    这里补上「关掉评论条」的行为（等于应用自己的 hideCommentBar：收起评论条、清空输入与预览）。
 *
 * 表情 / 贴纸面板是独立节点（#feed-sticker-panel），不受本文件影响。
 */
(function () {
  'use strict';
  function barEl() { return document.getElementById('feed-comment-bar'); }
  function panelEl() { return document.getElementById('feed-comment-panel'); }

  function sync() {
    try {
      var b = barEl(), p = panelEl();
      if (!b || !p) return false;
      var open = !b.hidden;
      if (open) {
        if (p.hidden) p.hidden = false;
        if (!p.classList.contains('feed-comment-open')) p.classList.add('feed-comment-open');
      } else {
        if (p.classList.contains('feed-comment-open')) p.classList.remove('feed-comment-open');
        if (!p.hidden) p.hidden = true;
      }
      return open;
    } catch (e) { return false; }
  }

  // 点右上角 × → 收起评论条（等价 hideCommentBar：条收起、输入清空、预览清空、面板收起）
  function closeComment() {
    try {
      var b = barEl();
      if (b) b.hidden = true;
      var inp = document.getElementById('feed-comment-input');
      if (inp) inp.value = '';
      var pv = document.getElementById('feed-comment-pv');
      if (pv) { pv.innerHTML = ''; pv.hidden = true; }
      return sync();
    } catch (e) { return false; }
  }
  window.__feedCommentClose = closeComment;

  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('#feed-comment-close')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        closeComment();
        return;
      }
      if (t.closest('.feed-act[data-comment]') || t.closest('.feed-comment') || t.closest('.feed-reply') || t.closest('.feed-c-line')) {
        setTimeout(sync, 0);
        setTimeout(sync, 120);
      }
    } catch (err) {}
  }, true);

  try {
    var mo = new MutationObserver(function () { sync(); });
    var attach = function () {
      var b = barEl();
      if (!b || b.__feedComFixObs) return;
      b.__feedComFixObs = 1;
      try { mo.observe(b, { attributes: true, attributeFilter: ['hidden'] }); } catch (e) {}
      sync();
    };
    attach();
    setTimeout(attach, 1200);
    setInterval(attach, 3000);
  } catch (e) {}

  setInterval(sync, 1000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(sync, 200); });
  else setTimeout(sync, 200);

  window.__feedCommentFix = sync;

  /* ================= 朋友圈「贴纸」功能已删除（用户要求 2026-10-05） =================
     删掉的入口与产物：
       · 动态卡片上的贴纸按钮   .feed-act[data-sticker]
       · 评论条上的贴纸入口     #feed-comment-sticker
       · 贴纸选择卡（动态创建） #feed-sticker-card
       · 已经贴在配图上的贴纸   .feed-sticker（仅隐藏显示，数据仍在 feed-posts 里，未破坏）
     可见性交给 CSS 兜底（重渲染也不会露头），这里再拦点击 + 收掉可能已弹出的选择卡。 */
  window.__feedStickerDisabled = true;
  function killStickerUi() {
    try {
      var card = document.getElementById('feed-sticker-card');
      if (card && !card.hidden) card.hidden = true;
      var panel = document.getElementById('feed-sticker-panel');
      if (panel && !panel.hidden) panel.hidden = true;
    } catch (e) {}
  }
  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.feed-act[data-sticker]') || t.closest('#feed-comment-sticker') || t.closest('#feed-sticker-card') || t.closest('.feed-sticker')) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        killStickerUi();
      }
    } catch (err) {}
  }, true);
  setInterval(function () { if (!document.hidden) killStickerUi(); }, 1000);
  setTimeout(killStickerUi, 400);

  /* ================= TA 给朋友圈点赞：概率固定补成 60%（用户要求 2026-10-05） =================
     feed.js 的 feedCfgFor() 从「该桌面」的 reply-fd-like-prob 读 TA 点赞概率（默认 60），
     但本工程没有这个键的设置界面 —— 存档里若是 0 / 空 / 非法值，TA 就永远不点赞且用户无从修改。
     这里按桌面做一次性补种：缺失、空、非数字、或 ≤0 时写成 60（已有合法非零值则完全不动）。
     用一次性标记，避免以后真有界面时把用户设的 0 反复覆盖。 */
  function seedLikeProbOnce() {
    try {
      var KEY = 'dsh-fd-like-prob-seeded';
      var root = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (root && root.get(KEY) === '1') return;
      var desks = ['default'];
      try {
        (window.getContacts ? window.getContacts() : []).forEach(function (c) { if (c && c.id && desks.indexOf(c.id) < 0) desks.push(c.id); });
      } catch (e0) {}
      desks.forEach(function (cid) {
        try {
          var s = (typeof window.storeFor === 'function') ? window.storeFor(cid) : null;
          if (!s) return;
          var raw = s.get('reply-fd-like-prob');
          var n = (raw === null || raw === undefined || raw === '') ? NaN : Number(raw);
          if (isNaN(n) || n <= 0) s.set('reply-fd-like-prob', '60');
        } catch (e) {}
      });
      if (root) root.set(KEY, '1');
    } catch (e) {}
  }
  try { window.__seedLikeProbOnce = seedLikeProbOnce; } catch (e) {}
  try { seedLikeProbOnce(); setTimeout(seedLikeProbOnce, 1500); } catch (e) {}
})();
