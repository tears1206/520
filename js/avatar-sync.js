/* 全站头像同步（milk-main 专用胶水层，不属于新版 14 模块）
 *
 * 需求：所有头像跟随「传讯」内的头像，大小也是。
 *
 * 背景（为什么会不一致）：
 *   - 传讯页头部头像的来源是 settings.partnerAvatar / settings.myAvatar
 *     （core.js：localforage 读 CHAT_APP_V3_<会话>_partnerAvatar → updateAvatar(#partner-avatar)）
 *   - 新版模块（通话 / 朋友圈 / 群聊 / 主页记录 / 联系人管理 / 头像库）读的是
 *     cs-avatar-partner / cs-avatar-user（以及 avatar-partner / avatar-user）
 *   → 两套键互不相通，于是「传讯里是一个头，别处是另一个/空的」。
 *
 * 做法：
 *   1) 图：以传讯为准。用「双向变更检测」把两侧对齐——哪边刚变，就以哪边为准同步给对方
 *      （这样既满足「跟随传讯」，又不会把头像库的定时自动换头像吃掉）。
 *   2) 尺寸：所有同步位套用传讯头像的同一尺寸与圆角（SIZE_MODE 可切换取哪一处为准）。
 *   3) 覆盖：桌面挂件 / 通话全屏 / 通话小框 / 朋友圈两页 / 以及任何标了
 *      data-sync-avatar="partner|me" 的元素。
 */
(function () {
  // 'header' = 传讯页头部头像的尺寸；'inchat' = 传讯里「消息旁头像」的尺寸（--in-chat-avatar-size，24-48px 可调）
  // 用户选择：尺寸以「传讯里消息旁的头像」为准（设置里 24-48px 那个滑杆）
  // （另一可选值 'header' = 传讯页顶部头像尺寸；可用 MochiAvatarSync.setSizeMode() 切换）
  var SIZE_MODE = 'header';   // 尺寸基准＝传讯页顶部头像（#partner-avatar）
  var TICK_MS = 3000;          // 轻量巡检（有差异才动 DOM）
  var SLOTS = [
    { sel: '#love-av-partner', who: 'partner' },
    { sel: '#love-av-me', who: 'me' },
    { sel: '#call-av', who: 'partner' },
    { sel: '#call-mini-av', who: 'partner' },
    { sel: '#feed-my-av', who: 'me' },
    /* 注意：#feed-all-av（「TA 的全部朋友圈」页的封面头像）**不能**放进来 —— 它属于被打开的那个
       联系人（feed.js 的 renderFeedAllCover 用该桌面的 feed-ta-avatar / avatar-partner 渲染），
       放进「我」的槽位会让那一页顶上显示我的头像（用户实报：朋友圈上层头像是我的、不是他的）。 */
    { sel: '#fav-av', who: 'partner' },
    { sel: '#cf-av', who: 'partner' },
    { sel: '[data-sync-avatar="partner"]', who: 'partner' },
    { sel: '[data-sync-avatar="me"]', who: 'me' }
  ];
  var last = { p: null, m: null, sp: null, sm: null };

  function settingsAv(who) {
    try {
      if (typeof settings === 'undefined' || !settings) return '';
      return String((who === 'me' ? settings.myAvatar : settings.partnerAvatar) || '');
    } catch (e) { return ''; }
  }
  function domAv(who) {
    try {
      var img = document.querySelector(who === 'me' ? '#my-avatar img' : '#partner-avatar img');
      if (img && img.src) return img.src;
    } catch (e) {}
    return '';
  }
  function chatSrc(who) { return domAv(who) || settingsAv(who); }

  function storeAv(who) {
    try {
      var st = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!st) return '';
      return String(st.get(who === 'me' ? 'cs-avatar-user' : 'cs-avatar-partner') || '') ||
             String(st.get(who === 'me' ? 'avatar-user' : 'avatar-partner') || '');
    } catch (e) { return ''; }
  }
  function pushStore(who, src) {
    if (!src) return;
    try {
      var st = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!st) return;
      var k1 = who === 'me' ? 'cs-avatar-user' : 'cs-avatar-partner';
      var k2 = who === 'me' ? 'avatar-user' : 'avatar-partner';
      if (st.get(k1) !== src) st.set(k1, src);
      if (st.get(k2) !== src) st.set(k2, src);
    } catch (e) {}
  }
  // 把某个头像写回传讯（模块那边换了头时用）
  function adoptToChat(who, src) {
    if (!src) return;
    try {
      if (typeof settings !== 'undefined' && settings) {
        if (who === 'me') settings.myAvatar = src; else settings.partnerAvatar = src;
      }
      var box = document.getElementById(who === 'me' ? 'my-avatar' : 'partner-avatar');
      if (box && typeof updateAvatar === 'function') updateAvatar(box, src);
      try {
        var k = 'CHAT_APP_V3_' + SESSION_ID + '_' + (who === 'me' ? 'myAvatar' : 'partnerAvatar');
        if (typeof localforage !== 'undefined' && localforage.setItem) localforage.setItem(k, src);
      } catch (e) {}
    } catch (e) {}
  }

  function chatSize() {
    if (SIZE_MODE === 'inchat') {
      var v = 0;
      try { v = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--in-chat-avatar-size'), 10); } catch (e) {}
      if (!v) { try { v = parseInt(String(settings.inChatAvatarSize || settings.chatAvatarSize || ''), 10); } catch (e) {} }
      if (!v) { try { v = parseInt(String((document.getElementById('in-chat-avatar-size-value-2') || {}).textContent || ''), 10); } catch (e) {} }
      return (v && v > 8) ? v : 36;
    }
    var el = document.getElementById('partner-avatar');
    var w = 0;
    try { var r = el.getBoundingClientRect(); w = Math.round(r.width); } catch (e) {}
    if (!w && el) { try { w = Math.round(parseFloat(getComputedStyle(el).width) || 0); } catch (e) {} }
    return (w && w > 8) ? w : 40;
  }
  function chatRadius() {
    try {
      var el = document.getElementById('partner-avatar');
      var r = getComputedStyle(el).borderRadius;
      return (r && r !== '0px') ? r : '50%';
    } catch (e) { return '50%'; }
  }

  // 往槽位里放图：容器里已有 img 就改 src，否则建一个并藏掉占位图标
  function put(slot, src, size, radius) {
    if (!slot) return;
    try {
      if (src) {
        var img = slot.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.alt = '';
          slot.appendChild(img);
        }
        if (img.getAttribute('src') !== src) img.setAttribute('src', src);
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        img.style.display = 'block';
        var icon = slot.querySelector('i');
        if (icon) icon.style.display = 'none';
      }
      // 尺寸一律交给 CSS（home-shell.css 里 #love-av-partner / #love-av-me 固定 48px，
      // 与传讯页顶部头像 .avatar 的 48px 基准一致；其它同步位保持各自原有大小，不受影响）。
      if (slot.style.width) slot.style.width = '';
      if (slot.style.height) slot.style.height = '';
      slot.setAttribute('data-sync-avatar-done', src ? '1' : '0');
    } catch (e) {}
  }

  function applySlots(srcP, srcM, size, radius) {
    for (var i = 0; i < SLOTS.length; i++) {
      var s = SLOTS[i];
      var src = (s.who === 'me') ? srcM : srcP;
      var nodes;
      try { nodes = document.querySelectorAll(s.sel); } catch (e) { nodes = []; }
      for (var j = 0; j < nodes.length; j++) put(nodes[j], src, size, radius);
    }
  }

  function sync() {
    var cp = chatSrc('partner'), cm = chatSrc('me');
    var sp = storeAv('partner'), sm = storeAv('me');
    // 双向变更检测：模块那边刚换 → 传讯跟随；传讯刚换 → 写回模块键
    if (sp && sp !== last.sp && sp !== cp) { adoptToChat('partner', sp); cp = sp; }
    else if (cp && cp !== last.p) { pushStore('partner', cp); }
    if (sm && sm !== last.sm && sm !== cm) { adoptToChat('me', sm); cm = sm; }
    else if (cm && cm !== last.m) { pushStore('me', cm); }
    last.p = cp; last.m = cm; last.sp = sp; last.sm = sm;

    var size = chatSize(), radius = chatRadius();
    try { document.documentElement.style.setProperty('--chat-avatar-size', size + 'px'); } catch (e) {}
    applySlots(cp, cm, size, radius);
  }

  function boot() {
    sync();
    // 头像异步加载 + 模块后渲染，多打几拍
    var n = 0;
    var t = setInterval(function () { sync(); if (++n >= 8) clearInterval(t); }, 500);
    setInterval(sync, TICK_MS);
    try { document.addEventListener('mochi-restore-done', function () { setTimeout(sync, 60); }); } catch (e) {}
    try { document.addEventListener('contact-switched', function () { setTimeout(sync, 120); }); } catch (e) {}
    try {
      var mo = new MutationObserver(function () { sync(); });
      ['partner-avatar-container', 'my-avatar-container'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) mo.observe(el, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'style', 'class'] });
      });
    } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  window.MochiAvatarSync = { sync: sync, setSizeMode: function (m) { SIZE_MODE = (m === 'inchat' ? 'inchat' : 'header'); sync(); } };
  /* ================= 桌面名称绑定传讯内的名称 =================
     需求：主页上方「梦角 / 我」的名称与传讯内的名称更改绑定。
     做法：把传讯里的 #partner-name / #my-name 文本同步到桌面两个头像旁的 .lbl，
     每 3 秒巡检一次（与头像同步同频），任何改名路径（设置里改、聊天页改、切换联系人）都会跟上。 */
  /* ================= 动态头像打标：朋友圈 / 群聊 新渲染出来的头像也跟随传讯头像 =================
     做法：每次巡检时把这两处的头像元素打上 data-sync-avatar="partner|me"，
     复用上面已有的槽位机制（SLOTS 里已含 [data-sync-avatar="partner"|"me"]），
     所以无论模块何时重新渲染列表，最多 3 秒后都会跟上。 */
  function tagDynamicAvatars() {
    try {
      function tag(sel, who) {
        var list = document.querySelectorAll(sel);
        for (var i = 0; i < list.length; i++) {
          if (list[i].getAttribute('data-sync-avatar') !== who) list[i].setAttribute('data-sync-avatar', who);
        }
      }
      // 群聊：按成员区分 —— 只有「对方（传讯对象）」那一处用传讯头像，其余成员保留各自图片。
      // 规则：所在行/气泡里出现对方名称 → 打 partner 标（跟随传讯）；否则移除标记（不参与同步）。
      var pname = '';
      try { pname = String((document.getElementById('partner-name') || {}).textContent || '').trim(); } catch (e) {}
      var gav = document.querySelectorAll('.msg-av, .gc-mp-av, .gc-set-av, .gc-gp-av, .gc-av, .gc-avatar');
      for (var k = 0; k < gav.length; k++) {
        var el2 = gav[k];
        var host = el2.closest ? el2.closest('.msg, .gc-mp-row, .gc-member-row, .gc-set-row, .gc-panel-body > *') : null;
        var nm = host ? String(host.textContent || '').trim() : (pname ? 'x' : '');
        if (pname && nm && nm.indexOf(pname) >= 0) {
          if (el2.getAttribute('data-sync-avatar') !== 'partner') el2.setAttribute('data-sync-avatar', 'partner');
        } else {
          if (el2.hasAttribute('data-sync-avatar')) el2.removeAttribute('data-sync-avatar');
        }
      }
      // 朋友圈：按 data-owner / data-role / 类名判断是不是「我」，其余按对方
      var feed = document.querySelectorAll('.feed-head-av, .ff-desktop-av, .feed-av, .fn-av, .feed-me-av');
      for (var j = 0; j < feed.length; j++) {
        var e = feed[j];
        /* 这两个元素不参与「按类名猜身份」：#feed-my-av 由显式槽位管（我），
           #feed-all-av 属于被打开的那个联系人（feed.js 自己渲染），猜错就会顶掉别人的头像。 */
        if (e.id === 'feed-all-av' || e.id === 'feed-my-av') {
          if (e.hasAttribute('data-sync-avatar')) e.removeAttribute('data-sync-avatar');
          continue;
        }
        var meta = String(e.getAttribute('data-owner') || '') + ' ' + String(e.getAttribute('data-role') || '') + ' ' + String(e.className || '');
        var who = /(\bme\b|\bmine\b|self|我)/i.test(meta) ? 'me' : 'partner';
        if (e.getAttribute('data-sync-avatar') !== who) e.setAttribute('data-sync-avatar', who);
      }
    } catch (e) {}
  }
  function syncNames() {
    try {
      var pn = document.getElementById('partner-name');
      var mn = document.getElementById('my-name');
      var pa = document.querySelector('#love-av-partner');
      var ma = document.querySelector('#love-av-me');
      var pl = pa && pa.parentElement ? pa.parentElement.querySelector('.lbl') : null;
      var ml = ma && ma.parentElement ? ma.parentElement.querySelector('.lbl') : null;
      if (pl && pn) {
        var a = String(pn.textContent || '').trim();
        if (a && pl.textContent.trim() !== a) pl.textContent = a;
      }
      if (ml && mn) {
        var b = String(mn.textContent || '').trim();
        if (b && ml.textContent.trim() !== b) ml.textContent = b;
      }
    } catch (e) {}
  }
  try {
    syncNames();
    setTimeout(syncNames, 1200);
    setTimeout(syncNames, 3000);
    // 加固：切到后台就暂停，回前台再继续 —— 避免后台空转拖慢页面
    (function loopNames() {
      setTimeout(function () {
        try { if (!document.hidden) { tagDynamicAvatars(); syncNames(); } } catch (e) {}
        loopNames();
      }, TICK_MS);
    })();
  } catch (e) {}
  try { window.MochiAvatarSync = window.MochiAvatarSync || {}; window.MochiAvatarSync.syncNames = syncNames; } catch (e) {}

  /* ================= 身份总线：全站头像 & 昵称「跟随头像与昵称库的随机更换」 =================
     背景（为什么库里换完，别处还是旧的）：
       · 头像：avlib.js 换完写 cs-avatar-partner / cs-avatar-user，然后调用
         window.refreshChatAvatars() —— 本工程**从未定义**这个钩子；而它自己那套 DOM 目标
         （#chat-partner-av / #avatar-partner .ring）在本工程也不存在。
       · 昵称：avlib.js 换完写 cs-lbl-partner / cs-lbl-user，然后调用
         window.renderChatHeader() —— 同样从未定义；本工程顶栏名字的真正来源是
         settings.partnerName / settings.myName（core.js 渲染），所以库里换昵称＝哪儿都不变。
     这里把两个钩子补齐，并把昵称做成与头像同款的「双源变更检测」桥：
         cs-lbl-*（库 / 聊天域权威）  ⇄  settings.partnerName / settings.myName（顶栏来源）
     再广播到所有显式名字位：桌面挂件两个 .lbl / 通话卡片 / 通话小窗 / 红包面板 / 朋友圈。
     —— 哪边刚变就以哪边为准，所以「库里随机换」与「聊天设置里手动改」两边都不会互相顶掉。 */
  var NAME_SLOTS = [
    { sel: '#rp-partner-name', who: 'partner' },
    { sel: '#call-name', who: 'partner' },
    { sel: '#call-mini-name', who: 'partner' },
    { sel: '#feed-my-name', who: 'me' },
    /* #feed-all-name 同理：那是「TA 的全部朋友圈」页的名字，属于被打开的联系人，由 feed.js 渲染。 */
    { sel: '[data-sync-name="partner"]', who: 'partner' },
    { sel: '[data-sync-name="me"]', who: 'me' }
  ];
  var lastN = { p: null, m: null, sp: null, sm: null, ready: false };

  function stLbl(who) {
    try {
      var st = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!st) return '';
      return String(st.get(who === 'me' ? 'cs-lbl-user' : 'cs-lbl-partner') || '') ||
             String(st.get(who === 'me' ? 'lbl-user' : 'lbl-partner') || '');
    } catch (e) { return ''; }
  }
  function setStLbl(who, val) {
    if (!val) return;
    try {
      var st = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!st) return;
      var k1 = who === 'me' ? 'cs-lbl-user' : 'cs-lbl-partner';
      var k2 = who === 'me' ? 'lbl-user' : 'lbl-partner';
      if (st.get(k1) !== val) st.set(k1, val);
      if (st.get(k2) !== val) st.set(k2, val);
    } catch (e) {}
  }
  function stName(who) {
    try {
      if (typeof settings === 'undefined' || !settings) return '';
      return String((who === 'me' ? settings.myName : settings.partnerName) || '').trim();
    } catch (e) { return ''; }
  }
  function setStName(who, val) {
    if (!val) return;
    try {
      if (typeof settings === 'undefined' || !settings) return;
      if (who === 'me') settings.myName = val; else settings.partnerName = val;
    } catch (e) {}
  }

  // 把名字写进所有显式位置（含顶栏两个名字本体）
  function applyNameToDom(who, name) {
    if (!name) return;
    try {
      var head = document.getElementById(who === 'me' ? 'my-name' : 'partner-name');
      if (head && String(head.textContent || '').trim() !== name) head.textContent = name;
      // 桌面挂件的两个 .lbl（结构：.deco-avatar > .ring#love-av-* + .lbl）
      var ring = document.getElementById(who === 'me' ? 'love-av-me' : 'love-av-partner');
      var lbl = ring && ring.parentElement ? ring.parentElement.querySelector('.lbl') : null;
      if (lbl && String(lbl.textContent || '').trim() !== name) lbl.textContent = name;
    } catch (e) {}
    for (var i = 0; i < NAME_SLOTS.length; i++) {
      var s = NAME_SLOTS[i];
      if (s.who !== who) continue;
      var nodes;
      try { nodes = document.querySelectorAll(s.sel); } catch (e) { nodes = []; }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (String(el.textContent || '').trim() !== name) el.textContent = name;
      }
    }
  }

  // 昵称双向桥：库那边换（cs-lbl-* 变）→ 写进 settings + 顶栏 + 全部名字位；
  //             设置那边改（settings 变）→ 写回 cs-lbl-* 并广播。两边都不打架。
  function nameSync(force) {
    try {
      var sp = stLbl('partner'), sm = stLbl('me');
      var dp = stName('partner'), dm = stName('me');
      var p = dp, m = dm;
      if (force) { p = sp || dp; m = sm || dm; }
      else {
        if (sp && sp !== lastN.sp && sp !== dp) p = sp;            // 库刚换 → 以库为准
        else if (dp && lastN.ready && dp !== lastN.p) p = dp;      // 设置刚改 → 以设置为准
        else p = sp || dp;
        if (sm && sm !== lastN.sm && sm !== dm) m = sm;
        else if (dm && lastN.ready && dm !== lastN.m) m = dm;
        else m = sm || dm;
      }
      if (p) { if (sp !== p) setStLbl('partner', p); if (dp !== p) setStName('partner', p); }
      if (m) { if (sm !== m) setStLbl('me', m); if (dm !== m) setStName('me', m); }
      var changed = lastN.ready && ((p && p !== lastN.p) || (m && m !== lastN.m));
      lastN.sp = sp; lastN.sm = sm;
      if (p) lastN.p = p;
      if (m) lastN.m = m;
      lastN.ready = true;
      if (p) applyNameToDom('partner', p);
      if (m) applyNameToDom('me', m);
      if (changed) {
        // 顶栏以外的动态文案（拍一拍 / 状态库等）与聊天记录里的名字
        try { if (typeof window.updateDynamicNames === 'function') window.updateDynamicNames(); } catch (e) {}
        try {
          if (document.body && document.body.classList.contains('view-chat') && typeof window.renderMessages === 'function') {
            window.renderMessages();
          }
        } catch (e) {}
      }
    } catch (e) {}
  }

  // 气泡头像跟随（不重排整表，只改已渲染 img 的 src；sent=我，received=对方）
  function refreshBubbles() {
    try {
      var cp = chatSrc('partner'), cm = chatSrc('me');
      if (!cp && !cm) return;
      var wraps = document.querySelectorAll('.message-wrapper');
      for (var i = 0; i < wraps.length; i++) {
        var w = wraps[i];
        var want = /\bsent\b/.test(String(w.className || '')) ? cm : cp;
        if (!want) continue;
        var img = w.querySelector('.message-avatar img');
        if (img && img.getAttribute('src') !== want) img.setAttribute('src', want);
      }
    } catch (e) {}
  }
  // 新版 avlib.js 换完头像会调它：立刻收敛（顶栏 + 桌面挂件 + 通话/朋友圈/群聊 + 气泡）
  function refreshChatAvatars() {
    try { sync(); } catch (e) {}
    refreshBubbles();
  }
  try { window.refreshChatAvatars = window.refreshChatAvatars || refreshChatAvatars; } catch (e) {}
  // 新版 avlib.js 换完昵称会调它
  try { window.renderChatHeader = window.renderChatHeader || function () { try { nameSync(true); } catch (e) {} }; } catch (e) {}

  // 正在输入指示器 / 设置里的预览 也跟随对方头像
  try {
    SLOTS.push({ sel: '#typing-indicator-avatar', who: 'partner' });
    SLOTS.push({ sel: '#ti-preview-avatar', who: 'partner' });
  } catch (e) {}

  try {
    nameSync();
    setTimeout(function () { nameSync(); }, 900);
    setTimeout(function () { nameSync(); }, 2600);
    setInterval(function () { if (!document.hidden) nameSync(); }, TICK_MS);
    document.addEventListener('contact-switched', function () { setTimeout(function () { nameSync(); refreshBubbles(); }, 150); });
    document.addEventListener('mochi-restore-done', function () { setTimeout(function () { nameSync(); refreshBubbles(); }, 80); });
    window.addEventListener('storage', function (e) {
      try { if (e.key && /:?(cs-lbl-(partner|user)|cs-avatar-(partner|user))$/.test(e.key)) { nameSync(); refreshChatAvatars(); } } catch (err) {}
    });
  } catch (e) {}

  /* ================= 朋友圈：头像与昵称「全部跟随传讯」（用户要求 2026-10-05） =================
     feed.js 自带一套「朋友圈独立身份」：
       · 四把键  feed-user-name / feed-user-avatar / feed-ta-name / feed-ta-avatar（按桌面）
       · 每条动态/评论/贴纸写入时把作者钉成快照：authorName / authorAv / taName / taAv
     它的渲染口径是「快照优先，缺快照才回落实时身份」，而实时身份又能逐级回落到传讯键
     （lbl-user / avatar-user / cs-avatar-partner / lbl-partner）。所以「全部跟随传讯」= 两件事：
       ① 把传讯身份**镜像**进那四把朋友圈键（按桌面各自对齐，不串桌面）→ 之后渲染/新动态/评论
          一律用传讯身份；
       ② 实时把屏幕上已经画出来的旧名字改掉（动态作者名 / 评论与回复里的名字 / 点赞名单），
          因为那些是写进 DOM 的快照，不该等下一次整页重渲染。
     头像侧不用另做：postCardHtml 的头像位都带 data-role，本文件已有的 tagDynamicAvatars()
     会给它们打上 data-sync-avatar，再由头像槽位机制换成传讯头像（含 .feed-head-av/.fn-av 等）。 */
  function feedDeskIds() {
    var out = ['default'];
    try {
      var cs = (typeof window.getContacts === 'function') ? window.getContacts() : null;
      (cs || []).forEach(function (c) { if (c && c.id && out.indexOf(c.id) < 0) out.push(c.id); });
    } catch (e) {}
    return out;
  }
  function chatIdentOf(cid) {
    try {
      var s = (typeof window.storeFor === 'function') ? window.storeFor(cid) : window.activeStore();
      if (!s) return null;
      return {
        myName: String(s.get('cs-lbl-user') || s.get('lbl-user') || '').trim(),
        taName: String(s.get('cs-lbl-partner') || s.get('lbl-partner') || '').trim(),
        myAv: String(s.get('cs-avatar-user') || s.get('avatar-user') || ''),
        taAv: String(s.get('cs-avatar-partner') || s.get('avatar-partner') || '')
      };
    } catch (e) { return null; }
  }
  var lastFeedSig = {};
  var feedNamePairs = [];   // [{from,to}] 旧朋友圈名 → 传讯名
  // ① 镜像：把传讯身份写进朋友圈自己的四把键（只在变化时写）
  function feedMirrorIdent() {
    try {
      var desks = feedDeskIds();
      var changed = false;
      for (var i = 0; i < desks.length; i++) {
        var cid = desks[i];
        var s = (typeof window.storeFor === 'function') ? window.storeFor(cid) : null;
        if (!s) continue;
        var id = chatIdentOf(cid);
        if (!id || (!id.myName && !id.taName && !id.myAv && !id.taAv)) continue;
        var curU = String(s.get('feed-user-name') || '');
        var curT = String(s.get('feed-ta-name') || '');
        var sig = cid + '\u0001' + id.myName + '\u0001' + id.taName + '\u0001' + (id.myAv ? 1 : 0) + '\u0001' + (id.taAv ? 1 : 0) + '\u0001' + curU + '\u0001' + curT;
        if (lastFeedSig[cid] === sig) continue;
        lastFeedSig[cid] = sig;
        changed = true;
        // 旧名（朋友圈那套）留给 ② 做「旧名→传讯名」替换
        if (curU && id.myName && curU !== id.myName) feedNamePairs.push({ from: curU, to: id.myName });
        if (curT && id.taName && curT !== id.taName) feedNamePairs.push({ from: curT, to: id.taName });
        if (id.myName && curU !== id.myName) s.set('feed-user-name', id.myName);
        if (id.taName && curT !== id.taName) s.set('feed-ta-name', id.taName);
        if (id.myAv && s.get('feed-user-avatar') !== id.myAv) s.set('feed-user-avatar', id.myAv);
        if (id.taAv && s.get('feed-ta-avatar') !== id.taAv) s.set('feed-ta-avatar', id.taAv);
        // 顺带把本文件 lastN 里的旧名也算进来（聊天侧改名时屏幕上还是旧名）
        try {
          if (lastN && lastN.p && id.taName && lastN.p !== id.taName) feedNamePairs.push({ from: lastN.p, to: id.taName });
          if (lastN && lastN.m && id.myName && lastN.m !== id.myName) feedNamePairs.push({ from: lastN.m, to: id.myName });
        } catch (e2) {}
      }
      return changed;
    } catch (e) { return false; }
  }
  // ② 把屏幕上已经画出来的旧名字换成传讯名（动态名 / 评论回复 / 点赞名单）
  function feedAlignNames() {
    try {
      if (!feedNamePairs.length) return;
      var seen = {};
      var pairs = [];
      feedNamePairs.forEach(function (p) {
        if (!p || !p.from || !p.to || p.from === p.to) return;
        var k = p.from + '\u0001' + p.to;
        if (seen[k]) return;
        seen[k] = 1;
        pairs.push(p);
      });
      feedNamePairs = [];
      if (!pairs.length) return;
      function mapText(t) {
        var s = String(t == null ? '' : t);
        for (var i = 0; i < pairs.length; i++) {
          if (s === pairs[i].from) return pairs[i].to;              // 纯名字（作者名/评论名）
          if (s.indexOf(pairs[i].from) >= 0) s = s.split(pairs[i].from).join(pairs[i].to); // 点赞名单等
        }
        return s;
      }
      // 动态作者名、评论/回复里的名字、点赞名单
      var sel = '.feed-name, .feed-comment .feed-c-line b, .feed-reply b, .feed-likes, .ff-desktop-name, .feed-me-name';
      var nodes = document.querySelectorAll(sel);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        var txt = String(el.textContent || '');
        var next = mapText(txt);
        if (next !== txt) el.textContent = next;
      }
    } catch (e) {}
  }
  // 头像位打标：朋友圈动态头像（.feed-head-av 已带 data-role）＋ 通知/头像位
  function feedTagNames() {
    try {
      var heads = document.querySelectorAll('.feed-head-av[data-role]');
      for (var i = 0; i < heads.length; i++) {
        var role = heads[i].getAttribute('data-role') === 'me' ? 'me' : 'partner';
        var card = heads[i].closest ? heads[i].closest('.feed-post') : null;
        if (!card) continue;
        var nm = card.querySelector('.feed-name');
        if (nm && nm.getAttribute('data-sync-name') !== role) nm.setAttribute('data-sync-name', role);
      }
    } catch (e) {}
  }
  try {
    feedMirrorIdent();
    feedAlignNames();
    feedTagNames();
    setTimeout(function () { try { feedMirrorIdent(); feedAlignNames(); feedTagNames(); } catch (e) {} }, 1500);
    setInterval(function () {
      if (document.hidden) return;
      try { feedMirrorIdent(); feedAlignNames(); feedTagNames(); } catch (e) {}
    }, TICK_MS);
    document.addEventListener('contact-switched', function () { setTimeout(function () { try { feedMirrorIdent(); feedAlignNames(); } catch (e) {} }, 200); });
    document.addEventListener('mochi-restore-done', function () { setTimeout(function () { try { feedMirrorIdent(); feedAlignNames(); } catch (e) {} }, 150); });
  } catch (e) {}

  /* ================= 朋友圈「改我昵称 / 改我头像」两个入口：锁死（用户要求 2026-10-05） =================
     这两个入口就是封面上的 #feed-my-av / #feed-my-name 本体：点头像＝换朋友圈头像、点昵称＝
     「修改朋友圈昵称」（feed.js 里 coverAvEl / coverNameEl 的 click 绑定）。
     朋友圈身份现在全部跟随传讯，这两个入口就算改了也会被拉回，留着只会让人白改 + 误以为没生效。
     这里在**捕获阶段**拦掉它们身上的点击：
       · 阻止 feeding.js 自己的编辑弹窗/选图；
       · 同时 stopPropagation —— 否则这点按会冒泡到封面容器，变成「换背景」（原来是靠头像自己吃掉事件）；
       · 显示部分完全不动：头像与昵称照旧显示传讯身份。 */
  function lockFeedEditEntries() {
    try {
      if (window.__feedEditLocked) return;
      window.__feedEditLocked = true;
      document.addEventListener('click', function (e) {
        try {
          var t = e.target;
          if (!t || !t.closest) return;
          if (t.closest('#feed-my-av') || t.closest('#feed-my-name')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
          }
        } catch (err) {}
      }, true);
      // 一并拦掉 pointerdown/mousedown：feed.js 绑在元素上的有些入口走按下即触发
      ['pointerdown', 'mousedown'].forEach(function (type) {
        document.addEventListener(type, function (e) {
          try {
            var t = e.target;
            if (!t || !t.closest) return;
            if (t.closest('#feed-my-av') || t.closest('#feed-my-name')) {
              e.stopImmediatePropagation();
              e.stopPropagation();
            }
          } catch (err) {}
        }, true);
      });
    } catch (e) {}
  }
  try {
    lockFeedEditEntries();
    setTimeout(lockFeedEditEntries, 1200);
  } catch (e) {}

  /* ================= 朋友圈：禁止点动态作者头像进入「XX 的全部朋友圈」（用户要求 2026-10-05） =================
     动态卡片上的作者头像（.feed-head-av）在 feed.js 里绑了「点头像 → openFeedAll(owner, role)」，
     会跳到「XX 的全部朋友圈」页。用户要求禁掉这个跳转：头像照旧显示，但点它不再跳页。
     做法与锁朋友圈编辑入口一致：
       · 捕获阶段拦掉 .feed-head-av 上的 click / pointerdown / mousedown（阻止冒泡，避免落到卡片其它动作）；
       · 顺手清掉它的 title="查看XX的全部朋友圈"（否则鼠标悬停还在广告这个入口）；
       · 巡检里持续清理（feed.js 每次重渲染都会把 title 写回来）。 */
  function lockFeedAvatarJump() {
    try {
      if (!window.__feedAvatarJumpLocked) {
        window.__feedAvatarJumpLocked = true;
        var block = function (e) {
          try {
            var t = e.target;
            if (!t || !t.closest) return;
            var av = t.closest('.feed-head-av');
            if (!av) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            e.stopPropagation();
          } catch (err) {}
        };
        document.addEventListener('click', block, true);
        document.addEventListener('pointerdown', block, true);
        document.addEventListener('mousedown', block, true);
      }
      // 清掉「查看XX的全部朋友圈」提示（feed.js 渲染时会写回，所以放在每轮巡检里）
      var avs = document.querySelectorAll('.feed-head-av[title]');
      for (var i = 0; i < avs.length; i++) {
        try { avs[i].removeAttribute('title'); } catch (e2) {}
      }
    } catch (e) {}
  }
  try {
    lockFeedAvatarJump();
    setTimeout(lockFeedAvatarJump, 1500);
    setInterval(function () { if (!document.hidden) { try { lockFeedAvatarJump(); } catch (e) {} } }, TICK_MS);
  } catch (e) {}
})();