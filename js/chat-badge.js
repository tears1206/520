/* 桌面上「传讯」图标的新消息角标（用户要求 2026-10-05：有新消息时主页对应图标要显示）
   规则：
     · 不在传讯页时，聊天里新增的**对方/系统**消息会让角标 +1（我自己发的不算）；
     · 一进传讯页就清零（视为已读）；
     · 角标上限显示 99+。
   实现：600ms 巡检消息尾部（不侵入聊天渲染），并用 body 的 view-chat 类变化即时清角标。
   顺便补上 window.setDeskBadge —— 工程里 feed.js 会优先调它，但一直没人定义（缺失门面）；
   这里给一个通用实现（按 data-app 找图标，创建/更新 <app>-app-badge）。 */
(function () {
  'use strict';
  var lastTailId = null, unread = 0, inited = false;

  function isChatView() {
    try { return document.body.classList.contains('view-chat'); } catch (e) { return false; }
  }
  function msgs() {
    try { return (window.getChatMsgs ? window.getChatMsgs() : []) || []; } catch (e) { return []; }
  }
  function paint() {
    try {
      if (window.setDeskBadge) { window.setDeskBadge('chat', unread); return; }
    } catch (e) {}
    try {
      var b = document.getElementById('chat-app-badge');
      if (b) { b.hidden = unread === 0; b.textContent = unread > 99 ? '99+' : String(unread); }
    } catch (e2) {}
  }

  // 通用桌面角标：setDeskBadge('feed'|'chat'|…, n)
  if (typeof window.setDeskBadge !== 'function') {
    window.setDeskBadge = function (app, n) {
      try {
        var box = document.querySelector('.app[data-app="' + app + '"] .app-badge-box')
          || document.querySelector('.app[data-app="' + app + '"]');
        if (!box) return false;
        var el = document.getElementById(app + '-app-badge');
        if (!el) {
          el = document.createElement('span');
          el.className = 'app-badge';
          el.id = app + '-app-badge';
          box.appendChild(el);
        }
        var v = Number(n) || 0;
        el.hidden = v <= 0;
        el.textContent = v > 99 ? '99+' : String(v);
        return true;
      } catch (e) { return false; }
    };
  }

  function tailId(list) {
    var t = list.length ? list[list.length - 1] : null;
    if (!t) return null;
    return String(t.id != null ? t.id : (t.timestamp || '')) + '|' + String(t.sender || '');
  }

  /* ===== 信封投递的新信件角标（用户要求 2026-10-05） =====
     数据源与信封自己的未读判定一致：envelopeData.inbox 里 isNew 的信；
     读完一封时 envelope.js 会把它置为非 new，于是下一拍角标自动减少/清零。 */
  function envelopeUnread() {
    try {
      var d = (typeof window.envelopeDataRef === 'function') ? window.envelopeDataRef() : null;
      if (!d || !Array.isArray(d.inbox)) return 0;
      var n = 0;
      for (var i = 0; i < d.inbox.length; i++) { if (d.inbox[i] && d.inbox[i].isNew) n++; }
      return n;
    } catch (e) { return 0; }
  }
  function paintEnvelope() {
    try {
      var b = document.getElementById('envelope-app-badge');
      if (!b) return;
      var n = envelopeUnread();
      b.hidden = n === 0;
      b.textContent = n > 99 ? '99+' : String(n);
    } catch (e) {}
  }
  function tick() {
    try {
      var list = msgs();
      var t = list.length ? list[list.length - 1] : null;
      var id = tailId(list);
      if (!inited) { inited = true; lastTailId = id; unread = 0; paint(); return; }
      if (isChatView()) {                       // 在传讯页里 = 已读
        lastTailId = id;
        if (unread !== 0) { unread = 0; paint(); }
        return;
      }
      if (id && id !== lastTailId) {
        lastTailId = id;
        var sender = String((t && t.sender) || '');
        if (sender !== 'user') { unread++; paint(); }   // 对方/系统消息才算新消息
      }
    } catch (e) {}
    paintEnvelope();
  }

  setInterval(tick, 600);
  setTimeout(tick, 400);
  try {
    new MutationObserver(function () {
      if (isChatView() && unread !== 0) { unread = 0; paint(); }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  } catch (e) {}

  window.__chatUnread = function () { return unread; };
})();
