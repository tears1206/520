/* 传讯页「跟随头像与昵称库」的薄胶水层（用户要求 2026-10-06）
 *
 * ① 头像：库换了头像后，传讯页顶部两个头像、以及消息气泡旁的头像都要跟着换；
 * ② 系统消息里的名字：像「他 发布了一条朋友圈动态」「他 给你打来了语音通话」
 *    「他 同意了 我的昵称 的换头像邀请」这类提示，**他的名字跟传讯昵称**、
 *    我的名字跟我的传讯昵称（库/聊天域 cs-lbl-* 为准）。
 *
 * 做法：每 1.6 秒轻量巡检，只在和当前 DOM 不一致时才改写；只在传讯视图工作。
 * 写头像优先用应用自己的 window.updateAvatar(...)（头像框/形状逻辑保持一致）。
 */
(function () {
  'use strict';

  var TICK = 1600;

  function store() {
    try { return (typeof window.activeStore === 'function') ? window.activeStore() : null; } catch (e) { return null; }
  }
  function readKey(a, b) {
    var st = store();
    try {
      if (st) {
        var v = String(st.get(a) || '');
        if (v) return v;
        var w = String(st.get(b) || '');
        if (w) return w;
      }
    } catch (e) {}
    return '';
  }
  function pickAv(who) {
    var v = readKey(who === 'me' ? 'cs-avatar-user' : 'cs-avatar-partner', who === 'me' ? 'avatar-user' : 'avatar-partner');
    if (v) return v;
    try {
      if (typeof settings !== 'undefined' && settings) {
        return String((who === 'me' ? settings.myAvatar : settings.partnerAvatar) || '');
      }
    } catch (e2) {}
    return '';
  }
  function partnerName() {
    return readKey('cs-lbl-partner', 'lbl-partner') ||
      (window.taWord ? window.taWord() : 'TA');
  }
  function myName() {
    return readKey('cs-lbl-user', 'lbl-user') ||
      (typeof settings !== 'undefined' && settings && settings.myName) || '我';
  }

  function current(el) {
    try {
      var img = el.querySelector('img');
      if (img && img.getAttribute('src')) return String(img.getAttribute('src'));
      var m = /url\(["']?(.+?)["']?\)/.exec(String(getComputedStyle(el).backgroundImage || ''));
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  function apply(el, src) {
    if (!el || !src) return false;
    if (current(el) === src) return false;
    try {
      if (typeof window.updateAvatar === 'function') { window.updateAvatar(el, src); return true; }
    } catch (e) {}
    try {
      var img = el.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        img.alt = '';
        el.innerHTML = '';
        el.appendChild(img);
      }
      img.setAttribute('src', src);
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      el.style.backgroundImage = 'none';
      return true;
    } catch (e2) { return false; }
  }
  function sideOf(el) {
    var n = el, depth = 0;
    while (n && depth < 6) {
      var c = ' ' + String(n.className || '') + ' ';
      if (/\s(sent|user|me|mine|outgoing)\s/.test(c) || /-sent\b|-user\b/.test(c)) return 'me';
      if (/\s(received|ta|partner|incoming|them)\s/.test(c) || /-received\b|-partner\b|-ta\b/.test(c)) return 'partner';
      n = n.parentElement; depth++;
    }
    return '';
  }

  function fixAvatars(p, m) {
    if (p) apply(document.getElementById('partner-avatar'), p);
    if (m) apply(document.getElementById('my-avatar'), m);
    var box = document.getElementById('chat-container');
    if (!box) return;
    var cand = box.querySelectorAll('[class*="avatar"]');
    for (var i = 0; i < cand.length; i++) {
      var el = cand[i];
      var who = sideOf(el) || 'partner';
      var src = (who === 'me') ? m : p;
      if (src) apply(el, src);
    }
  }

  // 系统消息里带名字的句式：名字在句首，后面跟这些词
  var PARTNER_ACTS = [
    '发布了一条朋友圈动态', '给你打来了语音通话', '发来了一条消息', '发了一条动态',
    '更换了头像', '同意了', '拒绝了', '收下了', '送出了', '发来了', '打来了',
    '\u6765\u7535', '\u53bb\u7535'
  ];
  var INVITE_TAIL = '的换头像邀请';

  function textNodes(root) {
    var out = [];
    try {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) { if (n.nodeValue && n.nodeValue.trim()) out.push(n); }
    } catch (e) {}
    return out;
  }

  function fixSystemNames(p, m) {
    var box = document.getElementById('chat-container');
    if (!box) return 0;
    var msgs = box.querySelectorAll('.system-message');
    var changed = 0;
    for (var i = 0; i < msgs.length; i++) {
      var nodes = textNodes(msgs[i]);
      if (!nodes.length) continue;
      var node = nodes[0];
      var val = String(node.nodeValue || '');
      var trimmed = val.replace(/^\s+/, '');
      // 句首名字片段 = 到第一个动作词之前
      // 「我拨打 <他的名字> · 通话已挂断 · 时长 xx」：名字在动作词后面，也要跟随传讯昵称
      try {
        var mDial = /^(\s*\u6211\u62e8\u6253\s*)([^\s\u00b7|]+)([\s\S]*)$/.exec(trimmed);
        if (mDial && mDial[2] && mDial[2] !== p && mDial[2].length <= 20) {
          var fixedDial = mDial[1] + p + mDial[3];
          if (fixedDial !== trimmed) {
            node.nodeValue = val.replace(trimmed, fixedDial);
            changed++;
          }
          continue;
        }
      } catch (eD) {}
      var actHit = '';
      for (var k = 0; k < PARTNER_ACTS.length; k++) {
        var idx = trimmed.indexOf(PARTNER_ACTS[k]);
        if (idx > 0 && (actHit === '' || idx < trimmed.indexOf(actHit))) actHit = PARTNER_ACTS[k];
      }
      if (!actHit) continue;
      var idx2 = trimmed.indexOf(actHit);
      var lead = trimmed.slice(0, idx2).trim();
      if (!lead || lead.length > 20) continue;
      if (lead.charAt(0) === '我') continue;                 // 「我把…」这类以我开头的句式不动
      if (/昵称|换成了|设置/.test(lead)) continue;
      var rest = trimmed.slice(idx2);
      // 我的名字：形如「…同意了<我的名字>的换头像邀请」
      var restFixed = rest;
      var ti = rest.indexOf(INVITE_TAIL);
      if (ti > 0) {
        var mid = rest.slice(0, ti);
        var actWord = '';
        for (var q = 0; q < PARTNER_ACTS.length; q++) {
          if (mid.indexOf(PARTNER_ACTS[q]) === 0) { actWord = PARTNER_ACTS[q]; break; }
        }
        var mineNow = mid.slice(actWord.length).trim();
        if (actWord && mineNow && mineNow !== m && mineNow.length <= 20) {
          restFixed = actWord + m + INVITE_TAIL;
        }
      }
      if (lead === p && restFixed === rest) continue;
      var newVal = val.replace(trimmed, p + restFixed.length && (restFixed.charAt(0) === ' ' ? '' : ' ') + restFixed);
      // 保底：若上面拼装异常，退回最简单的「名字 + 原动作段」
      if (!newVal || newVal.indexOf(p) < 0) newVal = val.replace(trimmed, p + ' ' + restFixed);
      if (newVal !== val) { try { node.nodeValue = newVal; changed++; } catch (e) {} }
    }
    return changed;
  }

  /* 用户要求 2026-10-06：聊天头部下方多出一层「遮盖」——实测是空状态层 #empty-state 在
     已经有消息时仍被显示（它是 position:absolute 的幽灵层）。这里做一道保险：
     只要聊天里有消息，就把它收起来。 */
  function emptyStateGuard() {
    try {
      var box = document.getElementById('chat-container');
      var empty = document.getElementById('empty-state');
      if (!box || !empty) return;
      if (box.children.length > 0) {
        if (getComputedStyle(empty).display !== 'none') empty.style.display = 'none';
      }
    } catch (e) {}
  }

  function tick() {
    try {
      if (!document.body || !document.body.classList.contains('view-chat')) return;
      var p = pickAv('partner'), m = pickAv('me');
      if (p || m) fixAvatars(p, m);
      emptyStateGuard();
      fixSystemNames(partnerName(), myName());
    } catch (e) {}
  }

  try { setInterval(tick, TICK); } catch (e) {}
  try { setTimeout(tick, 900); } catch (e2) {}
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); }); } catch (e3) {}
  window.MochiChatAvatarFollow = { tick: tick, fixSystemNames: fixSystemNames };
})();
