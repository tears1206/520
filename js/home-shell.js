/* ===== home-shell.js：主页（情侣空间桌面）外壳路由 =====
   设计原则：零侵入 —— 不改任何既有模块。
   ① 桌面图标两种接法：data-app（内置动作，如「传讯」）、data-entry（转发点击既有入口元素，
      如 #mood-function / #envelope-function / #settings-btn），复用现逻辑，不动现代码；
   ② 轻状态只用 localStorage（视图记忆 / 打卡日期），绝不碰 localforage + getStorageKey
      —— getStorageKey() 在 initializeSession() 之前会抛异常（core.js:2245），
         而本文件是页面最后一个脚本，那时会话还没初始化；
   ③ 只切换 body 的 view-home / view-chat 两个类：聊天页 DOM 一个字节都不动。
      原因见 css/home-shell.css 顶部铁律：.main-chat-area 从未闭合，全部弹窗都是它的后代，
      给它 opacity/visibility/pointer-events 会让桌面上的弹窗一起失效。 */
(function () {
  'use strict';

  var LS_VIEW = 'deskLastView';
  var LS_CHECKIN = 'deskCheckinDate';
  var clockTimer = null;
  var rafId = null;
  var avatarTries = 0;

  /* ================= 视图切换 ================= */
  /* ================= 视图切换：JS 直接写内联样式（不依赖 DOM 结构与选择器） =================
     背景：index.html 未闭合导致聊天页嵌套层级不确定，CSS 选择器在部分环境会漏匹配，
     表现为"切到传讯一片空白"。这里改为切换时直接给元素写内联样式，最稳。 */
  // 排查缓存用：控制台会打印一行 build 标记（页面左上角那行小字已按用户要求删除）
  try { console.log('[milk] build 20261010O'); } catch (eBL) {}
  /* 可见版本标记（排查"加载的是新代码还是旧缓存"）：桌面左下角一行小字 */
  function showVersionTag() {
    try {
      if (document.getElementById('hs-ver-tag')) return;
      var d = document.createElement('div');
      d.id = 'hs-ver-tag';
      d.textContent = '外壳版本 v-z1';
      d.style.cssText = 'position:fixed;left:4px;bottom:2px;z-index:99999;font-size:10px;line-height:1.2;' +
        'color:var(--text-secondary,#888);opacity:.65;pointer-events:none;font-family:monospace;';
      document.body.appendChild(d);
    } catch (e) {}
  }
  /* 切到传讯后自动体检：聊天区异常（没高度/没子节点/不可见）就在屏幕底部显示诊断条 */
  function chatSanityCheck() {
    try {
      var chat = document.querySelector('.main-chat-area');
      var head = document.querySelector('.header');
      if (!chat) return;
      var vh = window.innerHeight || 0;
      var r = chat.getBoundingClientRect();
      var cs = getComputedStyle(chat);
      var bad = (r.height < vh * 0.4) || chat.children.length === 0 || cs.display === 'none' || cs.visibility === 'hidden';
      if (!bad || document.getElementById('chat-sanity-banner')) return;
      var box = document.createElement('div');
      box.id = 'chat-sanity-banner';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7a1f1f;color:#fff;' +
        'font:11px/1.45 Consolas,monospace;padding:8px 10px;white-space:pre-wrap;word-break:break-all;';
      var lines = [
        '【传讯空白体检】视口高=' + vh,
        '.main-chat-area: ' + cs.display + '/' + cs.visibility + ' 高=' + Math.round(r.height) + ' top=' + Math.round(r.top) +
          ' 子节点=' + chat.children.length + ' 文本长=' + (chat.textContent || '').trim().length,
        '.header: ' + (head ? (getComputedStyle(head).display + '/' + getComputedStyle(head).visibility + ' 高=' + Math.round(head.getBoundingClientRect().height)) : 'NO_EL'),
        'body=' + document.body.className + '  UA=' + navigator.userAgent.slice(0, 80)
      ];
      var sub = chat.children;
      for (var i = 0; i < Math.min(sub.length, 5); i++) {
        var c = sub[i], cc = getComputedStyle(c), cr = c.getBoundingClientRect();
        lines.push('  子[' + i + '] ' + (c.id || c.className || c.tagName) + ' ' + cc.display + '/' + cc.visibility + ' 高=' + Math.round(cr.height));
      }
      box.textContent = lines.join('\n');
      box.onclick = function () { box.remove(); };
      document.body.appendChild(box);
    } catch (e) {}
  }
  function applyViewLayout(view) {
    try {
      var toChat = (view === 'chat');
      // 硬保护：找不到聊天容器时，绝不隐藏任何东西（否则会出现"两边都空"的空白页）
      var _chatEl = document.querySelector('.main-chat-area');
      if (toChat && !_chatEl) { return; }
      var chat = document.querySelector('.main-chat-area');
      var head = document.querySelector('.header');
      if (chat) {
        chat.style.display = 'flex';
        chat.style.visibility = toChat ? 'visible' : 'hidden';
        chat.style.opacity = toChat ? '1' : '';
        if (toChat) {
          // 关键：聊天页提升为固定层并压到桌面层（z=70）之上，
          // 否则会被桌面层自身那不透明的白色背景盖住 → 表现为"一片空白"
          chat.style.position = 'fixed';
          chat.style.top = '0'; chat.style.left = '0'; chat.style.right = '0'; chat.style.bottom = '0';
          chat.style.zIndex = '200';
          chat.style.background = 'var(--primary-bg, #f9f9f9)';
          chat.style.flex = '';
        } else {
          chat.style.position = 'static';
          chat.style.top = ''; chat.style.left = ''; chat.style.right = ''; chat.style.bottom = '';
          chat.style.zIndex = '';
          chat.style.background = '';
          chat.style.flex = '1 1 auto';
          chat.style.minHeight = '0';
        }
      }
      if (head) {
        head.style.display = 'flex';
        head.style.visibility = toChat ? 'visible' : 'hidden';
        if (toChat) {
          head.style.position = 'fixed';
          head.style.top = '0'; head.style.left = '0'; head.style.right = '0';
          head.style.zIndex = '201';
          head.style.background = 'var(--primary-bg, #f9f9f9)';
          // 给固定头部让出高度
          // 用户要求 2026-10-06：这里原来直接用「头部高度」当上边距，但头部有时候仍在文档流里
          // （聊天区本来就在它下面），于是多让了一次，聊天顶部就空出一条像「遮盖」的带子。
          // 正确算法是「头部底边 − 聊天区顶边」，两者都为 0 时就不设内边距。
          var syncChatPad = function () {
            try {
              var hr = head.getBoundingClientRect();
              var ar = chat.getBoundingClientRect();
              var need = Math.round(hr.bottom - ar.top);
              if (need > 0 && need < 400) chat.style.paddingTop = need + 'px';
              else chat.style.paddingTop = '';
            } catch (e) {}
          };
          syncChatPad();
          [120, 400, 900, 1600, 2600].forEach(function (ms) { setTimeout(syncChatPad, ms); });
          try {
            if (window.ResizeObserver && !head.__padRO) {
              head.__padRO = new ResizeObserver(function () { syncChatPad(); });
              head.__padRO.observe(head);
            }
          } catch (eRO) {}
        } else {
          head.style.position = 'static';
          head.style.top = ''; head.style.left = ''; head.style.right = '';
          head.style.zIndex = '';
          head.style.background = '';
          chat && (chat.style.paddingTop = '');
        }
      }
      ['.desk-body', '.tabbar', '.dots', '#phone-bg-layer', '#phone-bg-mask'].forEach(function (sel) {
        var el = document.querySelector(sel);
        if (!el) return;
        el.style.display = toChat ? 'none' : '';
      });
      Array.prototype.forEach.call(document.querySelectorAll('.main-chat-area .modal, .main-chat-area [id^="page-"]'), function (el) {
        el.style.visibility = 'visible';
      });
    } catch (e) {}
  }
  function setView(view, push) {
    try { applyViewLayout(view); } catch (e) {}
    var isHome = (view !== 'chat');
    document.body.classList.toggle('view-home', isHome);
    document.body.classList.toggle('view-chat', !isHome);
    // 只记录当前视图、不再用于开机恢复（见 init()：进入时固定落主页）；留作日后需要时一行改回
    try { localStorage.setItem(LS_VIEW, isHome ? 'home' : 'chat'); } catch (e) {}

    // 进聊天页时压一条历史：安卓返回键 / 手势返回先「回桌面」，而不是直接退出应用
    if (!isHome && push !== false) {
      try { history.pushState({ view: 'chat' }, ''); } catch (e) {}
    }
    if (isHome) startClock(); else stopClock();

    // 用户要求 2026-10-05：每次进传讯界面都**回到最新消息**（滚到底部）。
    // 之前只切视图，浏览器会保留上次的 scrollTop，于是重新进入时可能停在旧位置。
    // 注意：#chat-container 是 scroll-behavior:smooth —— 直接赋 scrollTop 会走动画，
    // 刚切进视图时常常滚不到位（实测赋值后 scrollTop 仍是 0）。这里临时改成 auto 做瞬时跳转。
    if (!isHome) {
      var scrollChatToEnd = function () {
        try {
          var c = document.getElementById('chat-container') || document.querySelector('.main-chat-area');
          if (!c) return;
          var prev = c.style.scrollBehavior;
          c.style.scrollBehavior = 'auto';
          c.scrollTop = c.scrollHeight;
          if (prev) c.style.scrollBehavior = prev; else c.style.removeProperty('scroll-behavior');
        } catch (e) {}
      };
      setTimeout(scrollChatToEnd, 0);
      setTimeout(scrollChatToEnd, 160);
    }
  }
  function showHome() { setView('home', false); }

  /* ================= 状态栏时钟：只在桌面可见时跑 ================= */
  function tick() {
    var el = document.querySelector('#page-phone .statusbar-time');
    if (!el) return;
    var d = new Date();
    el.textContent = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function startClock() { tick(); if (!clockTimer) clockTimer = setInterval(tick, 30000); }
  function stopClock() { if (clockTimer) { clearInterval(clockTimer); clockTimer = null; } }

  /* ================= 桌面图标 ================= */

  /* ================= 收藏页分页：我的收藏 / 他的收藏 ================= */
  function showFavPane(key) {
    var k = (key === 'ta') ? 'ta' : 'mine';
    var box = document.getElementById('fav-tabs');
    if (box) {
      Array.prototype.forEach.call(box.querySelectorAll('.fav-tab'), function (b) {
        b.classList.toggle('active', (b.dataset.favPane || 'mine') === k);
      });
    }
    var mine = document.getElementById('fav-pane-mine');
    var ta = document.getElementById('fav-pane-ta');
    if (mine) mine.hidden = (k !== 'mine');
    if (ta) ta.hidden = (k !== 'ta');
  }
  function bindFavTabs() {
    var box = document.getElementById('fav-tabs');
    if (!box || box.__bound) return;
    box.__bound = true;
    box.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.fav-tab') : null;
      if (!b) return;
      showFavPane(b.dataset.favPane);
      try { if (typeof window.renderFavorites === 'function') window.renderFavorites(); } catch (err) {}
    });
  }
  var APPS = {
    chat: function () { setView('chat'); },       // 「传讯」= 现在这个聊天页
    home: function () {                           // 「主页」= 最近动态页（模块自身也绑了，这里兜底）
      var p = document.getElementById('page-home');
      if (p) { document.querySelectorAll('.page').forEach(function (x) { x.hidden = true; }); p.hidden = false; }
    },
    'group-chat': function () {                          // 「群聊」= 全部桌面成员一个窗口
      var g = document.getElementById('page-group-chat');
      if (g) { document.querySelectorAll('.page').forEach(function (x) { x.hidden = true; }); g.hidden = false; }
    },    favorites: function () {                             // 「收藏」= 独立收藏页（我的收藏 / 他的收藏 两个分页）
      var fp = document.getElementById('page-fav');
      if (fp) { document.querySelectorAll('.page').forEach(function (x) { x.hidden = true; }); fp.hidden = false; }
      showFavPane('mine'); try { fitFullPages(); } catch (e) {}
      try { if (typeof window.renderFavorites === 'function') window.renderFavorites(); } catch (e) {}
    }
  };

  function onDeskClick(e) {
    var app = e.target && e.target.closest ? e.target.closest('.app') : null;
    if (!app) return;
    if (document.body.classList.contains('decor-on') ||
        document.body.classList.contains('desk-move-mode')) return;   // 装修/移动模式不触发打开

    var id = app.dataset.app;
    if (id && typeof APPS[id] === 'function') { APPS[id](); setTimeout(function(){ fitFullPages(); autoDiagIfHalfScreen(); }, 900); return; }

    var entry = app.dataset.entry;
    if (entry) { openEntry(entry); setTimeout(function(){ fitFullPages(); autoDiagIfHalfScreen(); }, 900); }
  }

  /* 桌面图标 → 打开既有面板（两段式，保证「在主页就能打开」）
     ① 先「转发点击」传讯页里的原入口，复用它的完整逻辑；
     ② 若约半秒后面板仍未显示（原入口的监听没绑上、或它依赖的模块没加载完），
        就按下面的映射表直接 showModal —— 不再需要先切到传讯页。 */
  var ENTRY_MODAL = {
    '#settings-btn': 'settings-modal',
    '#envelope-function': 'envelope-modal',
    '#mood-function': 'mood-modal',
    '#anniversary-function': 'anniversary-modal',
    '#stats-function': 'stats-modal',
    '#fortune-lenormand-function': 'fortune-lenormand-modal'
  };

  function modalVisible(el) {
    if (!el) return false;
    var cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  function openEntry(sel) {
    var el = document.querySelector(sel);
    if (el) { try { el.click(); } catch (e) {} }        // ① 复用原入口逻辑

    var modalId = ENTRY_MODAL[sel];
    if (!modalId) {
      if (!el && typeof showNotification === 'function') showNotification('这个功能还没接上', 'warning');
      return;
    }
    var modal = document.getElementById(modalId);
    if (!modal) return;

    setTimeout(function () {                             // ② 兜底：没开就直接开
      if (modalVisible(modal)) return;
      if (sel === '#envelope-function') {                // 信封要先备好数据再开，否则列表是空的
        try { if (typeof loadEnvelopeData === 'function') loadEnvelopeData(); } catch (e) {}
        try { if (typeof switchEnvTab === 'function') switchEnvTab('outbox'); } catch (e) {}
        try { if (typeof renderEnvelopeLists === 'function') renderEnvelopeLists(); } catch (e) {}
      }
      if (typeof showModal === 'function') showModal(modal);
    }, 500);
  }

  /* ================= 分页圆点与滚动同步（rAF 节流，不依赖外部控制器） ================= */
  function syncDots(i) {
    var dots = document.querySelectorAll('#desktop-dots .dot');
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle('active', k === i);
  }
  function currentIndex(pages) {
    var slides = pages.querySelectorAll('.page-slide');
    var best = 0, bestD = Infinity;
    for (var k = 0; k < slides.length; k++) {
      var d = Math.abs(slides[k].offsetLeft - pages.scrollLeft);
      if (d < bestD) { bestD = d; best = k; }
    }
    return best;
  }
  function bindPages() {
    var pages = document.getElementById('desktop-pages');
    var dots = document.getElementById('desktop-dots');
    if (!pages) return;

    pages.addEventListener('scroll', function () {
      if (rafId) return;
      rafId = requestAnimationFrame(function () { rafId = null; syncDots(currentIndex(pages)); });
    }, { passive: true });

    if (!dots) return;
    dots.addEventListener('click', function (e) {
      var dot = e.target && e.target.closest ? e.target.closest('.dot') : null;
      if (!dot) return;
      var list = Array.prototype.slice.call(dots.querySelectorAll('.dot'));
      var i = list.indexOf(dot);
      var slide = pages.querySelectorAll('.page-slide')[i];
      // offsetLeft 与 scrollLeft 同源（.desk-body 是 position:relative），不必自己算 gap
      if (slide) pages.scrollTo({ left: slide.offsetLeft, behavior: 'smooth' });
      syncDots(i);
    });
  }

  /* ================= 打卡（localStorage 轻状态，home.css 的 .ck-btn.done 已备好样式） =================
     用户要求 2026-10-05：打卡下方那张小卡片由「纪念日」改为「**打卡天数**」。
     原实现只存「今天有没有打卡」（LS_CHECKIN = 今天的日期串），没有天数可言 → 这里额外维护一份
     已打卡日期集合（去重），卡片显示集合大小；取消打卡会把今天移出集合，天数随之回落。 */
  var LS_CHECKIN_DATES = 'desk-checkin-dates';
  function checkinDates() {
    try {
      var raw = localStorage.getItem(LS_CHECKIN_DATES);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (x) { return typeof x === 'string' && x; }) : [];
    } catch (e) { return []; }
  }
  function checkinDatesSave(arr) {
    try { localStorage.setItem(LS_CHECKIN_DATES, JSON.stringify(arr.slice(-400))); } catch (e) {}
  }
  function checkinCount() { return checkinDates().length; }
  function renderCheckinDays() {
    var el = document.getElementById('desk-checkin-days');
    if (el) el.textContent = String(checkinCount());
  }
  function initCheckin() {
    var btn = document.getElementById('desk-checkin-btn');
    if (!btn) return;
    // 用户要求 2026-10-06：打卡按钮**每日 0 点自动刷新**。
    // 原来 done 只在初始化时算一次，App 挂着过零点仍显示「已打卡」、点也没反应；
    // 现在状态一律按「今天」实时判定（todayStr()），并定时到下一个 0 点自动刷新。
    function todayStr() { return new Date().toDateString(); }
    function isDone() { try { return localStorage.getItem(LS_CHECKIN) === todayStr(); } catch (e) { return false; } }
    // 老存档兼容：今天已打卡但日期集合为空 → 先把今天补进集合，免得天数显示 0
    try {
      var seed = checkinDates();
      if (isDone() && seed.indexOf(todayStr()) < 0) { seed.push(todayStr()); checkinDatesSave(seed); }
    } catch (e2) {}

    function apply() {
      var done = isDone();
      btn.classList.toggle('done', done);
      btn.textContent = done ? '已打卡' : '打卡';
      try { btn.disabled = !!done; } catch (e) {}   // 已打卡 → 按钮直接禁用
      renderCheckinDays();
      return done;
    }
    apply();

    btn.addEventListener('click', function () {
      // 用户要求 2026-10-05：**打卡不可取消** —— 今天已打卡后再点无效（既不撤销状态，也不从天数里扣）。
      if (isDone()) {
        if (typeof showNotification === 'function') showNotification('今天已经打过卡啦 ✦', 'info');
        return;
      }
      var today = todayStr();
      try { localStorage.setItem(LS_CHECKIN, today); } catch (e) {}
      try {
        var arr = checkinDates();
        if (arr.indexOf(today) < 0) arr.push(today);
        checkinDatesSave(arr);
      } catch (e3) {}
      apply();
      if (typeof playSound === 'function') playSound('message');
      if (typeof showNotification === 'function') showNotification('今天也元气满满 ✦', 'success');
    });

    // 每日 0 点刷新：一个定时器精确等到下一个 0 点，再排下一次；
    // 另加 30 秒兜底巡检（设备休眠/时间跳变错过定时器时也能纠正回「打卡」）。
    (function scheduleMidnight() {
      try {
        var now = new Date();
        var next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2, 0);
        var ms = next.getTime() - now.getTime();
        setTimeout(function () { apply(); scheduleMidnight(); }, Math.max(1000, ms));
      } catch (e) {}
    })();
    try { setInterval(apply, 30 * 1000); } catch (e) {}
    try { window.__checkinRefresh = apply; } catch (e) {}
    renderCheckinDays();
  }

  /* ================= 纪念日天数（与 onboarding.js:748-758 的口径完全一致） ================= */
  function renderLove() {
    var daysEl = document.getElementById('love-days');
    var dateEl = document.getElementById('love-date');
    var annEl = document.getElementById('desk-anniv-days');

    var list = null;
    try { if (typeof anniversaries !== 'undefined' && Array.isArray(anniversaries)) list = anniversaries; } catch (e) {}
    if (!list || !list.length) return;                       // 未设置 → 保留占位文案

    var ann = null;
    for (var i = 0; i < list.length; i++) { if (list[i].type === 'anniversary') { ann = list[i]; break; } }
    if (!ann) ann = list[0];

    var target = new Date(ann.date);
    if (isNaN(target.getTime())) return;

    var now = new Date();
    var diff;
    if (ann.type === 'countdown') {
      diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
      if (diff < 0) diff = 0;
      if (dateEl) dateEl.textContent = (ann.name || '倒计时') + ' · 还有 ' + diff + ' 天';
    } else {
      diff = Math.floor((now - target) / (1000 * 60 * 60 * 24));
      if (dateEl) dateEl.textContent = (ann.name || '纪念日') + ' · 已过 ' + diff + ' 天';
    }
    var txt = diff.toLocaleString('zh-CN');
    if (daysEl) daysEl.textContent = txt;
    if (annEl) annEl.textContent = txt;
  }

  /* ================= 今日情话：从主字卡库（自定义回复）随机抽一句，每 24 小时换一次 =================
     用户要求 2026-10-06：
       · 百分百从**主字卡库**（customReplies）里抽一条；
       · 每 **24 小时**更换一次（原来按日历日期取，跨零点就换、同一天固定同一句）。
     实现：把「上次抽取时间戳 + 抽到的句子」存在本桌面命名空间下（desk-quote-v1）；
     距上次超过 24 小时就重新随机抽一条（池子里多于一条时尽量不与上次重复），否则沿用。 */
  var QUOTE_KEY = 'desk-quote-v1';
  var QUOTE_TTL = 24 * 60 * 60 * 1000;
  function quotePool() {
    try {
      if (typeof customReplies !== 'undefined' && customReplies && customReplies.length) {
        return customReplies.filter(function (s) { return String(s == null ? '' : s).trim(); });
      }
    } catch (e) {}
    return [];
  }
  function quoteState() {
    try { return JSON.parse(store.get(QUOTE_KEY) || 'null'); } catch (e) { return null; }
  }
  function renderQuote() {
    var el = document.getElementById('love-quote');
    var pool = quotePool();
    if (!pool.length) return;                                 // 没字卡 → 保留占位文案
    var st = quoteState();
    var now = Date.now();
    var text = st && st.text ? String(st.text).trim() : '';
    var fresh = text && pool.indexOf(text) >= 0 && st && st.ts && (now - Number(st.ts) < QUOTE_TTL);
    if (!fresh) {
      // 100% 从池子里抽；池子 >1 条时避免与上次重复
      var pick = pool[Math.floor(Math.random() * pool.length)];
      if (pool.length > 1 && text && pick === text) {
        pick = pool[(pool.indexOf(pick) + 1) % pool.length];
      }
      text = String(pick).trim();
      try { store.set(QUOTE_KEY, JSON.stringify({ ts: now, text: text })); } catch (e) {}
    }
    if (!el) return;
    var show = text;
    if (show.length > 60) show = show.slice(0, 60) + '…';
    el.textContent = show;
  }
  // 跨过 24 小时那一刻（或字卡库变了）自动刷新：每分钟轻量检查一次，回到前台也补一次
  try { setInterval(renderQuote, 60 * 1000); } catch (e) {}
  try { document.addEventListener('visibilitychange', function () { if (!document.hidden) renderQuote(); }); } catch (e2) {}
  try { window.__deskQuoteRefresh = renderQuote; } catch (e3) {}


  /* ================= 桌面头像：等 loadData() 把头部头像填好后同步过来 ================= */
  function putImg(box, src) {
    if (!box || !src) return;
    var img = document.createElement('img');
    img.src = src;
    img.alt = '';
    box.innerHTML = '';
    box.appendChild(img);
  }
  function syncAvatars() {
    var p = document.querySelector('#partner-avatar img');
    var m = document.querySelector('#my-avatar img');
    putImg(document.getElementById('love-av-partner'), p && p.src);
    putImg(document.getElementById('love-av-me'), m && m.src);
    // 头像是异步加载的，最多再等 10 秒（20 × 500ms）
    if ((!p || !m) && avatarTries++ < 20) setTimeout(syncAvatars, 500);
  }

  /* ================= 初始化 ================= */
  function init() {
    if (window.__homeShellInited) return;                    // 防重复初始化
    if (!document.getElementById('page-phone')) return;      // 页面里没有桌面层 → 整体跳过，零副作用
    window.__homeShellInited = true;

    // 需求：每次进入都直接落在主页（而不是上次停留的传讯页）。
    // 原来这里读 localStorage(LS_VIEW) 恢复上次视图，导致「一进来就是聊天页」；现固定为 home。
    // 以后若想恢复「记住上次页面」，把这行换成：
    //   setView(localStorage.getItem(LS_VIEW) === 'chat' ? 'chat' : 'home', false);
    setView('home', false);

    // 自动诊断：主页半屏时在屏幕底部显示关键数据（1.5s / 5s / resize 各查一次，便于截图反馈）
    syncDeskDots();
    // 用户要求 2026-10-06：删掉左下角「外壳版本」那行小字（原来这里会创建 #hs-ver-tag）
    // showVersionTag(); setTimeout(showVersionTag, 1500);
    // 传讯视图下持续体检（异常时在屏幕底部显示诊断条，不依赖 DevTools）
    setInterval(function () {
      try { if (document.body.classList.contains('view-chat')) chatSanityCheck(); } catch (e) {}
    }, 2000);                                   // 第2页删除后按实际页数校正圆点
    [600, 1500, 3000].forEach(function (t) { setTimeout(syncDeskDots, t); });
    fitFullPages(); setTimeout(autoDiagIfHalfScreen, 1500);
    setTimeout(function(){ fitFullPages(); autoDiagIfHalfScreen(); }, 5000);
    window.addEventListener('resize', function(){ fitFullPages(); autoDiagIfHalfScreen(); });

    var pages = document.getElementById('desktop-pages');
    if (pages) pages.addEventListener('click', onDeskClick);  // 事件委托：以后动态增删图标也不用重绑
    // 分页圆点/滚动同步优先交给 js/features/desk-slider.js（新版控制器：含页码持久化、滑动期暂停模糊等）；
    // 该模块没加载时才回落到本文件的简易实现，避免双重绑定。
    if (typeof window.deskRebuild !== 'function') bindPages();

    // 聊天页顶部「回到主页」→ 回桌面（index.html 第 319 行那个按钮，标签已是正常的 <button>）
    var back = document.getElementById('back-home-btn');
    if (back) back.addEventListener('click', showHome);

    // 底部 tab（只接了 桌面 / 传讯；「我的」先给个提示）
    var tabbar = document.querySelector('#page-phone .tabbar');
    if (tabbar) tabbar.addEventListener('click', function (e) {
      var item = e.target && e.target.closest ? e.target.closest('.tab-item') : null;
      if (!item) return;
      var tab = item.dataset.tab;
      if (tab === 'cards') {                                  // 需求：底部中间＝自定义字卡库
        var q = document.getElementById('custom-replies-function');
        if (q) q.click();                                     // 复用现成入口，内部逻辑不动
        return;
      }
      if (tab === 'chat') { setView('chat'); return; }
      if (tab === 'desk') { showHome(); return; }
      if (tab === 'me') {                                   // 闇€姹傦細搴曢儴銆屾垜鐨勩€嶉〉锛堟斁 鏄剧ず璇婃柇淇℃伅 / 瀵规柟涓诲姩鏉ヤ俊 / 鏀惰棌璁剧疆锛塦r
        try {
          var pages = document.querySelectorAll('.page');
          for (var pi = 0; pi < pages.length; pi++) pages[pi].hidden = true;
          var mePage = document.getElementById('page-me');
          if (mePage) mePage.hidden = false;
        } catch (e) {}
        return;
      }
      if (typeof showNotification === 'function') showNotification('「我的」页面还没接上', 'info');
    });

    /* 用户要求 2026-10-05：「我的」页里的工具（消息统计 / 设置）要**原地打开**，不回弹桌面。
       做法：不动 #page-me 的显隐；先把承载弹窗的聊天层抬到 #page-me 之上（桌面视图下聊天层
       内容是 visibility:hidden 的，只有弹窗被放行），再触发原来那两个入口。 */
    window.__meOpenTool = function (srcId) {
      try {
        var me = document.getElementById('page-me');
        if (me) me.hidden = false;
        var layer = document.querySelector('.main-chat-area');
        var prevZ = layer ? layer.style.zIndex : '';
        if (layer) layer.style.zIndex = '2100';
        var src = document.getElementById(srcId);
        if (src) src.click();
        // 弹窗关掉后把层号还原，避免影响其它页面
        var tries = 0;
        var iv = setInterval(function () {
          tries++;
          var open = false;
          try {
            var mods = document.querySelectorAll('.modal');
            for (var i = 0; i < mods.length; i++) { if (!mods[i].hidden && getComputedStyle(mods[i]).display !== 'none') { open = true; break; } }
          } catch (e) {}
          if (!open || tries > 600) {
            clearInterval(iv);
            if (layer) layer.style.zIndex = prevZ;
          }
        }, 250);
      } catch (e) {}
    };

    /* 用户要求 2026-10-05：昵称编辑框（#edit-modal）**只在点它自己那颗按钮时出现**。
       它在聊天设置里被抬到了设置弹窗之上（否则看不见），所以打开后会一直浮在上面；
       这里在点到聊天设置 / 全局设置里的其它页签、设置行、其它弹窗时把它关掉。 */
    document.addEventListener('click', function (ev) {
      try {
        var em = document.getElementById('edit-modal');
        if (!em || em.hidden || getComputedStyle(em).display === 'none') return;
        var t = ev.target;
        if (!t || (em.contains && em.contains(t))) return;          // 点在自己框里 → 不动
        var hitSettings = t.closest ? t.closest('#chat-modal, #settings-modal') : null;
        if (!hitSettings) return;                                   // 只处理「切到别的设置」
        // 用 display 关掉即可（那颗按钮再次点击时会自己设回 display:flex）；
        // 不动 hidden 属性，免得下次打开留下「display:flex 但 hidden=true」的别扭状态。
        em.style.display = 'none';
      } catch (e) {}
    }, true);

    // 安卓物理返回键 / 浏览器后退：从聊天页回桌面，而不是退出
    window.addEventListener('popstate', function () {
      if (document.body.classList.contains('view-chat')) showHome();
    });

    // 后台停表、前台恢复（对齐 home.css 的省电口径）
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stopClock();
      else if (document.body.classList.contains('view-home')) startClock();
    });

    initCheckin();
    renderLove();
    renderQuote();
    syncAvatars();
    bindFavTabs();
    // 聊天数据是异步 loadData() 出来的，几秒后补一次
    setTimeout(function () { renderLove(); renderQuote(); syncAvatars(); }, 4000);
  }

  /* 可视诊断（用 alert，不依赖 Console）：排查「主页只显示半屏」 */
  function diagHome() {
    try {
      var el = document.getElementById('page-home');
      if (!el) return alert('没有 #page-home');
      var r = el.getBoundingClientRect(), cs = getComputedStyle(el);
      var lines = [];
      lines.push('视口: ' + window.innerWidth + ' × ' + window.innerHeight);
      lines.push('#page-home: top=' + Math.round(r.top) + ' 高=' + Math.round(r.height) + ' 宽=' + Math.round(r.width));
      lines.push('计算样式: position=' + cs.position + ' top=' + cs.top + ' bottom=' + cs.bottom + ' height=' + cs.height + ' display=' + cs.display);
      lines.push('内联: ' + (el.getAttribute('style') || '(无)'));
      var ph = document.getElementById('page-phone');
      if (ph) {
        var pcs = getComputedStyle(ph), pr = ph.getBoundingClientRect();
        lines.push('桌面层 #page-phone: top=' + Math.round(pr.top) + ' 高=' + Math.round(pr.height) + ' 宽=' + Math.round(pr.width) +
          ' 背景=' + pcs.backgroundColor + ' bg=' + String(pcs.backgroundImage).slice(0, 24) + ' z=' + pcs.zIndex + ' overflow=' + pcs.overflowY);
      }
      var homeEl = document.getElementById('page-home');
      if (homeEl) lines.push('#page-home 背景=' + getComputedStyle(homeEl).backgroundColor + ' hidden=' + homeEl.hidden);
      lines.push('inset 支持: ' + ((window.CSS && CSS.supports) ? CSS.supports('inset', '0px') : '未知') + '  UA=' + navigator.userAgent.slice(0, 90));
      lines.push('UA: ' + navigator.userAgent);
      lines.push('--- 祖先链 ---');
      var p = el.parentElement, i = 0;
      while (p && i++ < 6) {
        var c = getComputedStyle(p);
        lines.push((p.id || p.tagName) + ': pos=' + c.position + ' h=' + Math.round(p.getBoundingClientRect().height) +
          ' tr=' + (c.transform === 'none' ? '-' : c.transform.slice(0, 16)) +
          ' bf=' + (c.backdropFilter === 'none' ? '-' : c.backdropFilter.slice(0, 16)) +
          ' inset=' + (c.inset === undefined ? 'N/A' : c.inset));
        p = p.parentElement;
      }
      alert(lines.join('\n'));
    } catch (e) { alert('诊断出错: ' + e.message); }
  }

  /* ================= 自动诊断条（无需 DevTools：异常时直接在屏幕底部显示数据） =================
     触发条件：主页高度明显小于视口（<80%）——即「只显示半屏」的情况。
     内容：视口高度、主页矩形与关键计算样式、祖先链（position/高度/transform/backdrop-filter/inset）、
           UA、是否支持 inset、以及本页捕获到的 JS 错误。可直接截图反馈。 */
  function autoDiagIfHalfScreen() {
    try {
      var el = document.getElementById('page-home');
      if (!el || el.hidden) return;
      var vh = window.innerHeight || 0;
      var r = el.getBoundingClientRect();
      if (!vh || r.height >= vh * 0.8) return;            // 正常就不打扰
      if (document.getElementById('auto-diag-banner')) return;
      var cs = getComputedStyle(el);
      var lines = [];
      lines.push('【主页半屏诊断】视口高=' + vh + '  主页: top=' + Math.round(r.top) + ' 高=' + Math.round(r.height) + ' 宽=' + Math.round(r.width));
      lines.push('样式: position=' + cs.position + ' top=' + cs.top + ' bottom=' + cs.bottom + ' height=' + cs.height + ' display=' + cs.display);
      lines.push('内联: ' + (el.getAttribute('style') || '(无)'));
      lines.push('inset 支持=' + ((window.CSS && CSS.supports) ? CSS.supports('inset', '0px') : '未知') + '  UA=' + navigator.userAgent.slice(0, 90));
      var p = el.parentElement, i = 0;
      while (p && i++ < 5) {
        var c = getComputedStyle(p);
        lines.push('↑ ' + (p.id || p.tagName) + ' pos=' + c.position + ' h=' + Math.round(p.getBoundingClientRect().height) +
          ' tr=' + (c.transform === 'none' ? '-' : c.transform.slice(0, 14)) +
          ' bf=' + (c.backdropFilter === 'none' ? '-' : c.backdropFilter.slice(0, 14)));
        p = p.parentElement;
      }
      try { if (window.__errs && window.__errs.length) lines.push('JS错误: ' + window.__errs.slice(0, 3).join(' | ').slice(0, 220)); } catch (e) {}
      var box = document.createElement('div');
      box.id = 'auto-diag-banner';
      box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#b3261e;color:#fff;' +
        'font:11px/1.45 Consolas,monospace;padding:8px 10px;white-space:pre-wrap;word-break:break-all;box-shadow:0 -4px 14px rgba(0,0,0,.35);';
      box.textContent = lines.join('\n');
      box.onclick = function () { box.remove(); };
      document.body.appendChild(box);
    } catch (e) {}
  }

  /* ================= 全屏页尺寸钉死（JS 内联，任何 CSS 都改不动） =================
     用途：主页/朋友圈/收藏等全屏层若因任何原因（旧内核不认 inset、某条规则覆盖、
     祖先带 transform 等）没有铺满视口，这里直接按视口高度写内联样式。 */
  /* ================= 把聊天页/弹窗搬出桌面层（修「上下分屏、传讯出现在下方」的结构性根因） =================
     index.html 的 div 未闭合，导致 #page-phone（桌面层）在 DOM 里把 .header / .main-chat-area /
     各 .modal / 我的页面全都包在自己内部：于是聊天页参与桌面层的 flex 布局，底部条被排进桌面底部，
     剩下的占位就成了一条空白。这里把非桌面自身的子节点统一移到 body（桌面只保留自己的图层），
     桌面层恢复为纯覆盖层，聊天页回到正常的整屏文档流。 */
  function unnestChatFromPhone() {
    try {
      var phone = document.getElementById('page-phone');
      if (!phone) return;
      var KEEP_SEL = '.desk-body, .tabbar, .dots, .statusbar, #phone-bg-layer, #phone-bg-mask';
      var movers = [];
      Array.prototype.slice.call(phone.children).forEach(function (c) {
        if (c.tagName === 'SCRIPT') return;                    // 脚本留在原处
        if (c.matches && c.matches(KEEP_SEL)) return;          // 桌面自己的图层不动
        movers.push(c);
      });
      movers.forEach(function (c) { document.body.appendChild(c); });
    } catch (e) {}
  }

  /* 桌面圆点校正：第 2 页删除后，滑块模块可能仍按缓存页数画 2 个点；这里按实际页数裁掉多余的 */
  function syncDeskDots() {
    try {
      var dots = document.querySelector('#page-phone .dots');
      if (!dots) return;
      var pages = document.querySelectorAll('#page-phone .desk-page').length || 1;
      while (dots.children.length > pages) dots.removeChild(dots.lastElementChild);
      while (dots.children.length < pages) {
        var s = document.createElement('span');
        dots.appendChild(s);
      }
      Array.prototype.forEach.call(dots.children, function (d, i) { d.classList.toggle('active', i === 0); });
    } catch (e) {}
  }

  function fitFullPages() {
    var h = (window.innerHeight || document.documentElement.clientHeight || 0);
    if (!h) return;
    ['page-home', 'page-feed', 'page-feed-all', 'page-feed-friends', 'page-fav'].forEach(function (id) {
      try {
        var el = document.getElementById(id);
        if (!el) return;
        el.style.position = 'fixed';
        el.style.top = '0px';
        el.style.left = '0px';
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        el.style.width = '100%';
        el.style.height = h + 'px';
        el.style.minHeight = h + 'px';
        el.style.zIndex = el.style.zIndex || '80';
      } catch (e) {}
    });
  }

  window.HomeShell = {
    fitFullPages: fitFullPages,
    unnestChatFromPhone: unnestChatFromPhone,
    autoDiagIfHalfScreen: autoDiagIfHalfScreen,
    diagHome: diagHome,
    showFavPane: showFavPane,
    bindFavTabs: bindFavTabs,
    setView: setView,
    showHome: showHome,
    openChat: function () { setView('chat'); },
    openApp: function (id) { if (APPS[id]) APPS[id](); },
    refresh: function () { renderLove(); renderQuote(); syncAvatars(); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
