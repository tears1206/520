/* 红包消息：除「领取 / 退回」外不留任何交互按键（用户要求 2026-10-05）
 *
 * 现状（为什么上一版没生效）：core.js 把每条消息的「回复（引用）/ 收藏 / 删除」按钮画在
 *   .message-content-wrapper > .message-meta-actions 里 —— 那是**气泡 .message 的兄弟节点**，
 *   不在气泡内部；所以按 .message.rp-card 选择器既删不掉它们，也会被后续 renderMessages() 重建。
 *   而 redpacket.js 的 decorate() 会给**外壳**打上 data-rp-card="1"（同时气泡加 .rp-card），
 *   卡片本身只有「点＝领取 / 长按＝退回」两个手势，没有按钮。
 *
 * 本文件按外壳处理，红包外壳里的消息级按钮全部清掉（回复/收藏/删除…），只保留卡片自己的
 *   领取 / 退回 手势；顺带：批量收藏里红包不可勾选、收藏记账里红包不被计入。
 * 判定口径：外壳 [data-rp-card="1"]，或气泡带 .rp-card，兜底看文本以「🧧红包」开头。
 */
(function () {
  'use strict';
  function isRpText(t) { return /^\s*🧧红包/.test(String(t == null ? '' : t)); }
  try { window.isRedpacketText = window.isRedpacketText || isRpText; } catch (e) {}

  function rpWrappers() {
    var out = [], seen = {};
    try {
      var a = document.querySelectorAll('.message-wrapper[data-rp-card="1"]');
      for (var i = 0; i < a.length; i++) { out.push(a[i]); seen[i] = 1; }
    } catch (e) {}
    try {
      var b = document.querySelectorAll('.message.rp-card');
      for (var j = 0; j < b.length; j++) {
        var w = b[j].closest ? b[j].closest('.message-wrapper') : null;
        if (w && out.indexOf(w) < 0) out.push(w);
      }
    } catch (e2) {}
    return out;
  }
  function isRpWrapper(el) {
    try {
      if (!el || !el.closest) return false;
      var w = el.closest('.message-wrapper');
      if (w && w.getAttribute('data-rp-card') === '1') return true;
      var b = el.closest('.message.rp-card');
      if (b) return true;
      var m = el.closest('.message');
      if (m && m.classList && m.classList.contains('rp-card')) return true;
      return m ? isRpText(String(m.textContent || '')) : false;
    } catch (e) { return false; }
  }
  try { window.isRedpacketBubble = window.isRedpacketBubble || isRpWrapper; } catch (e) {}

  // 清掉红包外壳里所有消息级按钮（回复/收藏/删除），只留卡片自己的点按手势
  function strip() {
    try {
      var ws = rpWrappers();
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        var btns = w.querySelectorAll('.meta-action-btn, .reply-btn, .favorite-action-btn, .delete-btn');
        for (var j = 0; j < btns.length; j++) { try { btns[j].remove(); } catch (e) {} }
        var boxes = w.querySelectorAll('.message-meta-actions');
        for (var k = 0; k < boxes.length; k++) { try { boxes[k].style.display = 'none'; } catch (e2) {} }
        w.setAttribute('data-rp-nofav', '1');
        if (w.classList && w.classList.contains('selected')) w.classList.remove('selected');
        var cb = w.querySelectorAll('.batch-favorite-checkbox');
        for (var m = 0; m < cb.length; m++) { try { cb[m].style.display = 'none'; } catch (e3) {} }
      }
    } catch (e) {}
  }

  // 兜底拦截：万一按钮又被别处重建，点它们也不生效
  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      var hit = t.closest('.meta-action-btn, .reply-btn, .favorite-action-btn, .batch-favorite-checkbox');
      if (hit && isRpWrapper(hit)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        e.stopPropagation();
        return;
      }
      if (document.body && document.body.classList && document.body.classList.contains('batch-favorite-mode')) {
        var wrap = t.closest('.message-wrapper');
        if (wrap && isRpWrapper(wrap)) {
          e.preventDefault();
          e.stopImmediatePropagation();
          e.stopPropagation();
        }
      }
    } catch (err) {}
  }, true);

  // 收藏记账过滤（TA 自动收藏 / 朋友圈 / 信箱共用这两个门面）
  ['addMyFavItem', 'addTaFavItem'].forEach(function (name) {
    try {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__rpNoFavGuard) return;
      var wrapped = function (item) {
        try {
          var txt = (item && typeof item === 'object') ? item.text : item;
          if (isRpText(txt)) return false;
          if (item && typeof item === 'object' && String(item.kind || '') === 'rp') return false;
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      wrapped.__rpNoFavGuard = 1;
      window[name] = wrapped;
    } catch (e) {}
  });

  // 消息是渲染/定时美化出来的，按钮也会被 renderMessages 重建 → 巡检兜底
  setInterval(function () { if (!document.hidden) strip(); }, 800);
  try { document.addEventListener('mochi-restore-done', function () { setTimeout(strip, 200); }); } catch (e) {}
  try { document.addEventListener('contact-switched', function () { setTimeout(strip, 200); }); } catch (e) {}
  setTimeout(strip, 300);
  setTimeout(strip, 1200);
  strip();
  window.__rpNoQuoteFav = strip;
})();
