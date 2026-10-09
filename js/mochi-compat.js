/* ===== mochi-compat.js：新版功能模块的适配层（接入轮次 1）=====
   背景：Desktop\新功能\js 下的功能模块是为另一套（build.mjs 打包式）工程写的，
   它们依赖一批 milk-main 里没有的全局设施。本文件把这些设施「按需实现」出来，
   让那些模块可以原样加载运行（模块内部一行不用改）。

   ⚠️ 全部使用 `window.X = window.X || ...` 的写法：
      以后真正的那套实现（系统基座文件.js / chat（提取）.js / 回复设置…）接进来时，
      它们的定义会自动覆盖这里的垫片，不会打架。

   本层实现清单（按依赖来源分组）：
   1) 基础：__jsErrors / toast / activePrefix / activeStore / __mochiDataReady / __mochiPhase
   2) 大对象存储：idbGet / idbEnsureBigKey / idbHydrateKey / idbBigIdxSize（用 localforage 落地）
   3) 聊天引擎：getChatMsgs / chatAddSystem / chatAppendToDeskMsg / chatPartnerName
   4) 字卡引擎：DEFAULT_CARD_DATA 取用 / getDefaultCardGroups / defaultCardCat / isDefaultCardOff
                / getCustomCards / getPool / ccAppendCards
   5) 其他：mochiMediaIsToken / mochiFilePickFire / dcpEff / dictUse / dictOverall / replyCfg
*/
(function () {
  'use strict';

  /* ---------- 1. 基础 ---------- */

  // 启动错误收集（模块内部多处 if (window.__jsErrors) push 诊断）
  window.__jsErrors = window.__jsErrors || [];
  window.addEventListener('error', function (e) {
    try { window.__jsErrors.push('ERR: ' + e.message + ' @' + String(e.filename || '').split('/').pop() + ':' + e.lineno); } catch (x) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try { window.__jsErrors.push('REJ: ' + ((e.reason && e.reason.message) || e.reason)); } catch (x) {}
  });

  // 轻提示：直接落到 milk-main 已有的 showNotification
  window.toast = window.toast || function (msg) {
    try {
      if (typeof showNotification === 'function') showNotification(String(msg == null ? '' : msg), 'info', 2200);
      else console.log('[toast]', msg);
    } catch (e) {}
  };

  // 命名空间前缀：新版所有本地键都走 activePrefix()；这里映射到 milk-main 的会话命名空间
  window.activePrefix = window.activePrefix || function () {
    try {
      // SESSION_ID 是 state.js 里的顶层 let（全局词法绑定，不在 window 上），这里直接引用
      if (typeof SESSION_ID !== 'undefined' && SESSION_ID) return String(APP_PREFIX || 'CHAT_APP_V3_') + SESSION_ID;
    } catch (e) {}
    return 'CHAT_APP_V3_default';
  };

  /* 按联系人/会话分域的存储门面。
     实测（reply-settings.js:6）新版用法是 `const store = window.activeStore();` ——
     **activeStore 是工厂函数**，调用后才拿到 store；值按纯字符串存取（调用方会 parseFloat），
     另外数据层还会问 awaitingBigKey/requestBigKey/whenBigKeyBack（这里给出安全的缺省回答）。 */
  function _mochiNs() {
    var ns = 'default';
    try { if (typeof SESSION_ID !== 'undefined' && SESSION_ID) ns = String(SESSION_ID); } catch (e) {}
    return ns;
  }
  // 注意：nsOrGetter 支持传「取值函数」——模块通常在启动时就 activeStore() 一次并长期持有，
  // 而那时 SESSION_ID 可能还没初始化；用函数形式＝每次读写都按「当前会话」解析，多联系人时不串设置。
  function _makeMochiStore(nsOrGetter) {
    function prefix() {
      var ns = (typeof nsOrGetter === 'function') ? nsOrGetter() : (nsOrGetter || '');
      return 'mochiStore:' + ns + ':';
    }
    return {
      get: function (k, d) { try { var v = localStorage.getItem(prefix() + k); return v === null ? (d === undefined ? null : d) : v; } catch (e) { return d === undefined ? null : d; } },
      set: function (k, v) { try { localStorage.setItem(prefix() + k, v == null ? '' : String(v)); return true; } catch (e) { return false; } },
      remove: function (k) { try { localStorage.removeItem(prefix() + k); return true; } catch (e) { return false; } },
      keys: function () { var out = [], p = prefix(); try { for (var i = 0; i < localStorage.length; i++) { var kk = localStorage.key(i); if (kk && kk.indexOf(p) === 0) out.push(kk.slice(p.length)); } } catch (e) {} return out; },
      // 数据层问话（#1342/#1358）：本工程没有「大键延迟回填」机制，一律答「不欠、已就绪」
      awaitingBigKey: function () { return false; },
      requestBigKey: function () {},
      whenBigKeyBack: function () { return Promise.resolve(true); }
    };
  }
  window.activeStore = window.activeStore || function () { return _makeMochiStore(_mochiNs); };
  window.xyStore = window.xyStore || function (ns) { return _makeMochiStore(function () { return ns || 'xy'; }); };
  window.defaultStore = window.defaultStore || function () { return _makeMochiStore('default'); };

  /* 一次性迁移（接入第 9 轮多联系人基座时）：
     各功能模块改用真实 activeStore（命名空间 xy-home-v2:<联系人>）后，此前落在
     适配层临时域（mochiStore:<SESSION_ID>:）里的数据会「看起来消失」——这里把它搬到
     联系人域的 default 联系人下（已存在同名键则不覆盖）。标记键保证只跑一次。 */
  (function migrateMochiStoreToContacts() {
    try {
      var MK = 'mochiStore:migrated-to-contacts-v1';
      if (localStorage.getItem(MK) === '1') return;
      var sid = 'default';
      try { if (typeof SESSION_ID !== 'undefined' && SESSION_ID) sid = String(SESSION_ID); } catch (e) {}
      var srcPrefix = 'mochiStore:' + sid + ':';
      var dstPrefix = 'mochiStore:xy-home-v2:default:';
      if (srcPrefix === dstPrefix) { localStorage.setItem(MK, '1'); return; }
      var moved = 0, keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(srcPrefix) === 0) keys.push(k);
      }
      keys.forEach(function (k) {
        var short = k.slice(srcPrefix.length);
        if (localStorage.getItem(dstPrefix + short) === null) {
          try { localStorage.setItem(dstPrefix + short, localStorage.getItem(k)); moved++; } catch (e) {}
        }
      });
      localStorage.setItem(MK, '1');
      if (moved) console.log('[mochi-compat] 已迁移 ' + moved + ' 个键到联系人域 xy-home-v2:default');
    } catch (e) {}
  })();

  // 数据就绪标志：模块在启动早期会 if (window.__mochiDataReady) 决定是否立刻跑
  if (typeof window.__mochiDataReady === 'undefined') {
    var readyTimer = setInterval(function () {
      try {
        if (typeof messages !== 'undefined' && typeof settings !== 'undefined') {
          window.__mochiDataReady = true;
          clearInterval(readyTimer);
          try { window.dispatchEvent(new CustomEvent('mochi:dataready')); } catch (e) {}
        }
      } catch (e) {}
    }, 200);
    setTimeout(function () { window.__mochiDataReady = true; clearInterval(readyTimer); }, 15000);
  }
  window.__mochiPhase = window.__mochiPhase || '';
  window.__mochiPhaseLog = window.__mochiPhaseLog || [];
  window.__mochiDeskScene = window.__mochiDeskScene || {};

  /* ---------- 2. 大对象存储（localforage 落地） ----------
     ⚠ 关键：模块的 store 把值写在 localStorage 的 mochiStore:<命名空间>:<键>（见 _makeMochiStore），
     而模块做「读权威基线」时调的是 idbGet('<命名空间>:<键>') 或 idbGet('<键>')。两者键空间必须对齐，
     否则模块永远等不到基线 → 症状是「朋友圈发帖不落库」「群聊不渲染」。
     这里按候选顺序在同空间里找第一条真值；返回值保持与 store 一致（字符串，不预先 JSON.parse，
     因为模块普遍以 typeof v === 'string' 判断「权威那份读回来了」）。 */
  function lf() { return (typeof localforage !== 'undefined') ? localforage : null; }
  function _lfCandidates(key) {
    var k = String(key == null ? '' : key), out = [];
    var push = function (x) { if (x && out.indexOf(x) < 0) out.push(x); };
    push('mochiStore:' + k);                                  // 模块传全名：xy-home-v2:feed-posts
    try { if (typeof SESSION_ID !== 'undefined' && SESSION_ID) push('mochiStore:' + SESSION_ID + ':' + k); } catch (e) {}
    push('mochiStore:xy-home-v2:default:' + k);                // 联系人 default 域
    push('mochiStore:default:' + k);
    push('mochiStore:xy-home-v2:' + k);                        // 全局共享层
    push(k);                                                   // 兼容原本直连 localforage 的调用
    return out;
  }
  function _lfFindLocal(key) {
    var cands = _lfCandidates(key);
    for (var i = 0; i < cands.length; i++) {
      try { var v = localStorage.getItem(cands[i]); if (v !== null && v !== undefined) return v; } catch (e) {}
    }
    return null;
  }
  window.idbGet = window.idbGet || function (key) {
    var raw = _lfFindLocal(key);
    if (raw !== null) return Promise.resolve(raw);
    var L = lf(); if (!L) return Promise.resolve(null);
    var cands = _lfCandidates(key), i = 0;
    var step = function () {
      if (i >= cands.length) return Promise.resolve(null);
      var k = cands[i++];
      return L.getItem(k).then(function (v) { return (v === null || v === undefined) ? step() : v; }).catch(step);
    };
    return step();
  };
  window.idbSet = window.idbSet || function (key, val) {
    var canonical = 'mochiStore:' + String(key == null ? '' : key);
    try {
      if (typeof val === 'string' && val.length < 512 * 1024) localStorage.setItem(canonical, val);
    } catch (e) {}
    var L = lf(); if (!L) return Promise.resolve(false);
    return L.setItem(canonical, val).then(function () { return true; }).catch(function () { return false; });
  };
  window.idbRemove = window.idbRemove || function (key) {
    var canonical = 'mochiStore:' + String(key == null ? '' : key);
    try { localStorage.removeItem(canonical); } catch (e) {}
    var L = lf(); if (!L) return Promise.resolve(false);
    return L.removeItem(canonical).then(function () { return true; }).catch(function () { return false; });
  };
  // 新版用它确认「大键」已落盘；这里写入即视为就绪
  window.idbEnsureBigKey = window.idbEnsureBigKey || function () { return Promise.resolve(true); };
  window.idbHydrateKey = window.idbHydrateKey || function (key) {
    return window.idbGet(key).then(function (v) { return v !== null && v !== undefined; });
  };
  window.idbBigIdxSize = window.idbBigIdxSize || function () { return 0; };

  /* ---------- 3. 聊天引擎 ---------- */
  window.getChatMsgs = window.getChatMsgs || function () {
    try { return (typeof messages !== 'undefined' && Array.isArray(messages)) ? messages : []; } catch (e) { return []; }
  };
  window.chatPartnerName = window.chatPartnerName || function () {
    try { return (typeof settings !== 'undefined' && settings.partnerName) || '梦角'; } catch (e) { return '梦角'; }
  };
  // 往聊天里插一条系统消息（新版 chat.js 的 chatAddSystem）
  window.chatAddSystem = window.chatAddSystem || function (text, opts) {
    try {
      if (typeof addMessage !== 'function') return false;
      addMessage({
        id: Date.now() + Math.floor(Math.random() * 1000),
        sender: 'system',
        text: String(text == null ? '' : text),
        image: (opts && opts.img) || null,
        timestamp: new Date(),
        status: 'sent',
        type: 'system'
      });
      return true;
    } catch (e) { return false; }
  };
  // 桌面消息横幅（milk-main 目前只有 .desk-msg 样式、没有该 JS）：降级为轻提示
  window.chatAppendToDeskMsg = window.chatAppendToDeskMsg || function (cid, text) {
    try { if (typeof showNotification === 'function') showNotification(String(text == null ? '' : text), 'info', 3200); } catch (e) {}
    return true;
  };

  /* ---------- 4. 字卡引擎 ---------- */
  // ⛔ 用户要求：删除所有系统预设字卡，抽选全部从自定义回复中抽取。
  //    这里是全工程「系统预设字卡」的唯一闸门——造句/拼字/朋友圈/群聊/信箱都经它取系统卡，
  //    一律返回空数组即等于系统预设卡全部下线；自定义来源走 getCustomCards()/getPool()，不受影响。
  //    （内置数据 js/default-cards.js 也已停止加载；若将来要恢复系统卡，把 __mochiSystemCardsOff 关掉即可。）
  window.__mochiSystemCardsOff = (window.__mochiSystemCardsOff !== false);
  // ★ 但「梦角自由造句」需要词边界才能切句：这里用【用户的自定义回复】现造一份词库（2~3 字 n-gram）。
  //   取名以「词库」开头 → 该模块只用它做正向最大匹配切词，不作源句（源句按 ≥4 汉字过滤）；
  //   源句仍然只来自 getCustomCards()（你的自定义回复）。系统预设依旧为 0，别的分类一律空。
  var _mwCache = { n: -1, data: null };
  function _mochiCustomWordGroup() {
    try {
      var pool = (window.getCustomCards && window.getCustomCards()) || [];
      if (_mwCache.n === pool.length && _mwCache.data) return _mwCache.data;
      var words = [], seen = {};
      var push = function (w) {
        if (!w || w.length < 2 || w.length > 3) return;
        if (seen[w]) return; seen[w] = 1; words.push(w);
      };
      for (var i = 0; i < pool.length && words.length < 4000; i++) {
        var s = String(pool[i] == null ? '' : pool[i]);
        // 按标点/空白切段，再在每段里取 2~3 字滑窗
        s.split(/[\s，。！？、；：,.!?;:~～…—\-（）()「」“”"'’]+/).forEach(function (seg) {
          if (!seg) return;
          for (var L = 2; L <= 3; L++) {
            for (var k = 0; k + L <= seg.length; k++) push(seg.substr(k, L));
          }
        });
      }
      var out = [];
      if (words.length) out.push(['词库·自定义', words]);      // 只给「梦角自由造句」切词用
      var lines = pool.map(function (x) { return String(x == null ? '' : x); }).filter(function (x) { return x.trim().length >= 2; });
      if (lines.length) out.push(['语录·自定义', lines]);       // 给「词典拼字」当语录卡取材（就是你的自定义回复）
      _mwCache = { n: pool.length, data: out };
      return out;
    } catch (e) { return null; }
  }
  window.getDefaultCardGroups = window.getDefaultCardGroups || function () {
    if (window.__mochiSystemCardsOff) {
      // 唯一例外：dict 分类给一份「自定义回复造出来的词库」供造句切词（其它分类严格为空）
      if (arguments[0] === 'dict') { var g = _mochiCustomWordGroup(); return Array.isArray(g) ? g : []; }  // g 已经是「组数组」，不能再包一层
      return [];
    }
    try {
      var d = window.DEFAULT_CARD_DATA;
      if (!d) return [];
      var cat = arguments[0];
      if (cat && d[cat]) return d[cat];
      if (!cat) { var all = []; Object.keys(d).forEach(function (k) { if (Array.isArray(d[k])) all = all.concat(d[k]); }); return all; }
      return [];
    } catch (e) { return []; }
  };
  // 分类开关（缺省全开，值由以后的「字卡库」页维护）
  window.defaultCardCat = window.defaultCardCat || function () { return false; };  // 系统分类全关
  // 逐张关闭（缺省全开）
  window.isDefaultCardOff = window.isDefaultCardOff || function (cat, text) {
    try {
      // 2~3 字的是给「造句」切词用的碎片（词库·自定义），不算可拼的语录卡 → 拼字池里排除掉。
      // 造句的正向最大匹配直接读分组、不走这里，故不受影响。
      if (cat === 'dict' && typeof text === 'string' && text.length <= 3) return true;
      var off = JSON.parse(localStorage.getItem('mochiCardOff') || '{}');
      return !!off[cat + ':' + text];
    } catch (e) { return false; }
  };
  // 自定义字卡：milk-main 的自定义回复池就是一张张字卡
  window.getCustomCards = window.getCustomCards || function () {
    try { return (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) ? customReplies.slice() : []; } catch (e) { return []; }
  };
  window.getPool = window.getPool || function () { return { text: window.getCustomCards() }; };
  // 把造出来的句子存回字卡库（新版写 cc-groups 的具名分组；这里落到自定义回复池，写守卫/去重保留）
  window.ccAppendCards = window.ccAppendCards || function (cat, groupName, items, scope) {
    try {
      if (typeof customReplies === 'undefined' || !Array.isArray(customReplies)) return false;
      var added = 0;
      (items || []).forEach(function (t) {
        var v = String(t == null ? '' : t);
        if (!v || v.indexOf('data:') === 0 || v.indexOf('|||') >= 0) return;
        if (customReplies.indexOf(v) >= 0) return;
        customReplies.push(v);
        added++;
      });
      if (added > 0 && typeof throttledSaveData === 'function') throttledSaveData();
      return added > 0;
    } catch (e) { return false; }
  };

  /* ---------- 5. 其他小工具 ---------- */
  window.mochiMediaIsToken = window.mochiMediaIsToken || function (s) {
    if (typeof s !== 'string') return false;
    return s.indexOf('|||') >= 0 || s.indexOf('data:') === 0 || /^\[\[[a-z_]+\]\]$/i.test(s);
  };
  // 移动端相册选择：直接触发 input.click()（新版那层封装是为了兼容 WebView 的失败回调）
  window.mochiFilePickFire = window.mochiFilePickFire || function (input, opts) {
    try { if (input && typeof input.click === 'function') { input.click(); return true; } } catch (e) {}
    try { if (opts && typeof opts.onFail === 'function') opts.onFail(); } catch (e) {}
    return false;
  };
  // 概率总档：新版由「回复设置」的总档乘系数，这里原样返回
  window.dcpEff = window.dcpEff || function (n) { var v = Number(n); return isFinite(v) ? v : 0; };
  // 词典场景开关 / 概率（词典独立页维护；缺省开、聊天 100%、其它场景 30%）
  window.dictUse = window.dictUse || function () { return true; };
  window.dictOverall = window.dictOverall || function (scope) { return scope === 'feed' ? 30 : 100; };

  /* ---------- 6. 回复设置配置（replyCfg） ----------
     新版里由「回复设置（聊天触发概率）.js」提供（含完整设置页与成对收口逻辑）。
     这里先给一份可持久化的最小实现：模块读到的键与新版 DEFAULTS 对齐，
     以后真正的 replyCfg 接进来时（window.replyCfg = window.replyCfg || …）会自动接管。 */
  var CFG_KEY = 'mochiReplyCfg';
  var CFG_DEFAULTS = {
    // 梦角自由造句（#327 定稿；默认开、20%）
    'mjf-en': 1, 'mjf-prob': 20, 'mjf-style': 1, 'mjf-mix': 1, 'mjf-pub': 80, 'mjf-punct': 1,
    'mjf-src-cc': 1, 'mjf-src-def': 1, 'mjf-src-dict': 1,
    'mjf-w-cc': 50, 'mjf-w-def': 25, 'mjf-w-dict': 25,
    // 词典拼字（总闸 py-en 未开＝不触发，属安全默认）
    'qs-en': 0, 'qs-prob': 30, 'qs-cc': 1, 'qs-one': 1, 'qs-multi': 1, 'qs-min': 2, 'qs-max': 5, 'qs-noLimit': 1,
    'py-en': 0
  };
  window.replyCfg = window.replyCfg || function () {
    var out = {}, k;
    for (k in CFG_DEFAULTS) if (Object.prototype.hasOwnProperty.call(CFG_DEFAULTS, k)) out[k] = CFG_DEFAULTS[k];
    try {
      var saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      for (k in saved) if (Object.prototype.hasOwnProperty.call(saved, k)) out[k] = saved[k];
    } catch (e) {}
    return out;
  };
  window.mochiSetReplyCfg = function (key, val) {
    // 真「回复设置」模块接入后，配置由它自己的 store 管理（键会加 reply- 前缀，成对键还会互相收口）
    try { if (typeof window.saveReplyCfg === 'function') return window.saveReplyCfg(key, val); } catch (e) {}
    try {
      var saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}');
      saved[key] = val;
      localStorage.setItem(CFG_KEY, JSON.stringify(saved));
      return true;
    } catch (e) { return false; }
  };

  /* ---------- 7. 字卡功能出牌标签的样式（词典拼字 / 梦角自由造句）----------
     标签文本由 core.js 写进 .message-wrapper 的 data-card-tag，这里只补样式。
     放在适配层里注入 = 不必改 styles.css（那份 11000 行手写样式表改动风险高）。 */
  (function injectCardTagStyle() {
    try {
      if (document.getElementById('mochi-cardtag-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-cardtag-style';
      s.textContent =
        '.message-wrapper[data-card-tag]::after{content:attr(data-card-tag);display:inline-block;' +
        'margin:4px 0 0;padding:1px 7px;border-radius:9px;font-size:10px;line-height:15px;letter-spacing:.3px;' +
        'color:var(--accent-color);background:rgba(var(--accent-color-rgb),.10);' +
        'border:1px solid rgba(var(--accent-color-rgb),.22);align-self:flex-start;white-space:nowrap;}' +
        '.message-wrapper.sent[data-card-tag]::after{align-self:flex-end;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 8. 收藏设置页的宿主样式 + 收藏渲染别名（接入第 4 轮） ---------- */
  // 新版「收藏设置页.js」返回收藏夹时会调 window.renderFav()；本工程对应的是 games.js 的 renderFavorites。
  // 注意：compat 加载早于 games.js，所以这里包一层「调用时再解析」，不能直接取函数引用。
  window.renderFav = window.renderFav || function () {
    try { if (typeof window.renderFavorites === 'function') return window.renderFavorites(); } catch (e) {}
  };
  (function injectFavSettingsStyle() {
    try {
      if (document.getElementById('mochi-favstyle')) return;
      var s = document.createElement('style');
      s.id = 'mochi-favstyle';
      s.textContent =
        '.stepper{display:flex;align-items:center;gap:8px;margin:8px 0;}' +
        '.stepper .stp-label{flex:1;font-size:13px;color:var(--text-primary);}' +
        '.stepper .stp-val{width:58px;text-align:center;font-size:13px;padding:6px 4px;border:1px solid var(--border-color);' +
        'border-radius:8px;background:var(--primary-bg);color:var(--text-primary);font-family:inherit;}' +
        '.stepper .stp-min,.stepper .stp-max{min-width:34px;padding:6px 10px;font-size:14px;line-height:1;}' +
        '.fs-stats-body{margin:12px 0;padding:10px 12px;border:1px solid var(--border-color);border-radius:12px;background:var(--primary-bg);}' +
        '.fs-stat-head{font-size:12px;font-weight:700;color:var(--accent-color);margin:8px 0 6px;}' +
        '.fs-stat-row{display:flex;justify-content:space-between;font-size:12px;color:var(--text-secondary);padding:3px 0;}' +
        '.fs-stat-val{color:var(--text-primary);font-weight:600;}' +
        '.fs-stat-val em{font-style:normal;font-size:11px;color:var(--text-secondary);margin-left:6px;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 9. 字卡库（今日情话）所需门面与样式（接入第 5 轮） ---------- */
  // 数据层问话：本工程同步 localStorage 就是权威来源，没有「大键延迟回填」，
  // 因此回答「不是空读」（falsy）＝调用方可以当场落笔。
  window.xyPackageEmptyRead = window.xyPackageEmptyRead || function () { return false; };

  // 新版分组门面（来自 ta-ask.js / chatcard.js）：字卡库页用它做「新建/重命名/删除分组」与下拉选项。
  // 本工程用 prompt/confirm 实现同等交互，接口签名与返回值保持一致。
  window.cardGroups = window.cardGroups || {
    _newId: function () { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); },
    addFlow: function (groups, cb) {
      var name = '';
      try { name = String(window.prompt('新建分组名称') || '').trim(); } catch (e) {}
      if (!name) { if (cb) cb(null); return; }
      var g = { id: this._newId(), name: name };
      groups.push(g);
      if (cb) cb(g);
    },
    renameFlow: function (g, groups, cb) {
      var name = '';
      try { name = String(window.prompt('重命名分组', g.name) || '').trim(); } catch (e) {}
      if (!name) { if (cb) cb(null); return; }
      g.name = name;
      if (cb) cb(name);
    },
    removeFlow: function (name, cb) {
      var ok = false;
      try { ok = window.confirm('删除分组「' + name + '」？组内情话会回到未分组。'); } catch (e) {}
      if (cb) cb(ok);
    },
    grpOnlyOptsHtml: function (groups, cur) {
      var esc = function (s) { return String(s == null ? '' : s).replace(/[<>&"]/g, ''); };
      var h = '<option value="">未分组</option>';
      (groups || []).forEach(function (g) {
        h += '<option value="' + esc(g.id) + '"' + (String(cur) === String(g.id) ? ' selected' : '') + '>' + esc(g.name) + '</option>';
      });
      return h;
    },
    bindNewGrp: function () {},
    parseCatVal: function (v) { return { grp: v || '' }; }
  };

  (function injectQuoteCardsStyle() {
    try {
      if (document.getElementById('mochi-quotecards-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-quotecards-style';
      s.textContent =
        '.cc-toast{position:fixed;left:50%;bottom:calc(96px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);' +
        'max-width:80vw;padding:8px 16px;border-radius:99px;background:rgba(0,0,0,.82);color:#fff;font-size:12px;' +
        'z-index:99999;opacity:0;pointer-events:none;transition:opacity .2s ease;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}' +
        '.cc-toast.show{opacity:1;}' +
        '.cc-entry{display:flex;align-items:center;gap:8px;padding:12px 14px;margin-bottom:8px;border:1px solid var(--border-color);' +
        'border-radius:12px;background:var(--primary-bg);cursor:pointer;font-size:13px;color:var(--text-primary);}' +
        '.cc-entry-name{flex:1;}.cc-entry-cnt{font-size:12px;color:var(--text-secondary);}' +
        '.cc-entry-arrow{font-size:11px;color:var(--text-secondary);opacity:.7;}' +
        '.cc-tabs{display:flex;gap:6px;margin-bottom:10px;}' +
        '.cc-tab{flex:1;padding:7px 0;font-size:12px;border:1px solid var(--border-color);background:var(--primary-bg);' +
        'color:var(--text-secondary);border-radius:10px;cursor:pointer;font-family:inherit;}' +
        '.cc-tab.sel{background:var(--accent-color);color:#fff;border-color:var(--accent-color);}' +
        '.cq-batch-wrap{margin-bottom:10px;}.cq-batch-row{display:flex;gap:8px;margin-top:6px;}' +
        '.cq-sel{flex:1;padding:7px 10px;border:1px solid var(--border-color);border-radius:10px;background:var(--primary-bg);' +
        'color:var(--text-primary);font-size:12px;font-family:inherit;}' +
        '.cq-list{max-height:36vh;overflow-y:auto;}' +
        '.cq-def-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);padding:6px 2px 10px;}' +
        '.tc-qrow{display:flex;align-items:center;gap:10px;padding:9px 12px;margin-bottom:6px;border:1px solid var(--border-color);' +
        'border-radius:10px;background:var(--primary-bg);}.tc-qrow.off{opacity:.45;}' +
        '.tc-qmain{flex:1;min-width:0;}.tc-qtext{font-size:13px;color:var(--text-primary);word-break:break-word;}' +
        '.tc-known{font-size:10px;color:var(--text-secondary);border:1px solid var(--border-color);border-radius:6px;padding:0 4px;margin-left:4px;}' +
        '.ta-del{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:13px;padding:2px 6px;}' +
        '.ta-empty{font-size:12px;color:var(--text-secondary);padding:10px 2px;}' +
        '.toggle{position:relative;width:38px;height:22px;flex-shrink:0;display:inline-block;}' +
        '.toggle input{position:absolute;opacity:0;width:0;height:0;}' +
        '.toggle .tk{position:absolute;top:0;right:0;bottom:0;left:0;border-radius:22px;background:var(--border-color);transition:background .2s;}' +
        '.toggle .tk::after{content:"";position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;top:3px;left:3px;transition:left .2s;}' +
        '.toggle input:checked + .tk{background:var(--accent-color);}' +
        '.toggle input:checked + .tk::after{left:19px;}' +
        '.mg-grp-row{margin-bottom:8px;}' +
        '.cc-tool{font-size:12px;padding:5px 12px;border:1px dashed var(--border-color);border-radius:99px;background:transparent;' +
        'color:var(--accent-color);cursor:pointer;font-family:inherit;}' +
        '.cal-card{border:1px solid var(--border-color);border-radius:12px;padding:10px 12px;margin-bottom:8px;background:var(--primary-bg);}' +
        '.cal-card-title{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:6px;}' +
        '.mg-cnt{color:var(--text-secondary);font-weight:400;}.mg-ops{margin-left:auto;display:flex;gap:4px;}' +
        '.mg-op{background:none;border:none;color:var(--text-secondary);cursor:pointer;font-size:12px;padding:2px 5px;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 10. 主页「最近动态」所需门面与样式（接入第 6 轮） ---------- */
  // 数据层就绪回调（新版系统基座文件.js）：回填完成后回调一次
  window.mochiOnDataReady = window.mochiOnDataReady || function (fn) {
    try {
      if (typeof fn !== 'function') return;
      var fired = false;
      var once = function () { if (fired) return; fired = true; try { fn(); } catch (e) {} };
      if (window.__mochiDataReady) { setTimeout(once, 0); return; }
      window.addEventListener('mochi:dataready', once);
      setTimeout(function () { if (!window.__mochiDataReady) window.__mochiDataReady = true; once(); }, 16000);
    } catch (e) {}
  };
  // 联系人显示名（多联系人接入后由 多联系人多桌面.js 的 storeForCid 接管；当前单联系人取设置里的对方昵称）
  window.contactNameFor = window.contactNameFor || function () {
    try { return (typeof settings !== 'undefined' && settings.partnerName) || '梦角'; } catch (e) { return '梦角'; }
  };

  (function injectHomeFeedStyle() {
    try {
      if (document.getElementById('mochi-homefeed-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-homefeed-style';
      s.textContent =
        // 主页作为覆盖桌面(#page-phone z-index:70)的全屏页，仍在弹窗(2000)之下
        '#page-home{position:fixed;top:0;right:0;bottom:0;left:0;z-index:80;display:flex;flex-direction:column;background:var(--primary-bg);' +
        'overflow-y:auto;padding:calc(12px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));}' +
        '#page-home[hidden]{display:none !important;}' +
        '.home-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;flex-shrink:0;}' +
        '.home-title{font-size:15px;font-weight:700;color:var(--text-primary);letter-spacing:.5px;}' +
        '.fav-tabs{display:flex;gap:6px;overflow-x:auto;padding-bottom:8px;margin-bottom:10px;flex-shrink:0;scrollbar-width:none;}' +
        '.fav-tabs::-webkit-scrollbar{display:none;}' +
        '.fav-tab{flex-shrink:0;padding:6px 12px;font-size:12px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;font-family:inherit;white-space:nowrap;}' +
        '.fav-tab.sel{background:var(--accent-color);color:#fff;border-color:var(--accent-color);}' +
        '.home-cards{flex:1;min-height:0;}' +
        '.cal-card{border:1px solid var(--border-color);border-radius:12px;padding:10px 12px;margin-bottom:10px;background:var(--primary-bg);}' +
        '.cal-card[hidden]{display:none !important;}' +
        '.cal-card-title{font-size:12px;font-weight:700;color:var(--accent-color);margin-bottom:8px;letter-spacing:.4px;}' +
        '.tc-listitem{padding:9px 11px;margin-bottom:6px;border:1px solid var(--border-color);border-radius:10px;background:var(--secondary-bg);}' +
        '.tc-li-top{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text-primary);}' +
        '.tc-li-q{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.tc-li-time{font-size:10px;color:var(--text-secondary);flex-shrink:0;}' +
        '.tc-li-line{font-size:12px;color:var(--text-secondary);margin-top:4px;line-height:1.5;word-break:break-word;}' +
        '.tc-li-interrupt-tag{font-size:10px;color:#e0574a;border:1px solid rgba(224,87,74,.4);border-radius:6px;padding:0 4px;flex-shrink:0;}' +
        '.tc-call-interrupt{opacity:.75;}' +
        '.st-ico{width:13px;height:13px;vertical-align:-2px;margin-right:4px;color:var(--accent-color);}' +
        '.ta-empty{font-size:12px;color:var(--text-secondary);padding:10px 2px;}' +
        '.rec-empty{font-size:12px;color:var(--text-secondary);padding:10px 2px;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 11. 头像与昵称库所需门面与样式（接入第 7 轮） ---------- */
  // 昵称变更的系统消息（新版 chat.js 的 chatSysNickChanged）：兼容 1 参/2 参两种调用
  window.chatSysNickChanged = window.chatSysNickChanged || function (a, b) {
    try {
      var txt = (typeof a === 'string' && typeof b === 'string') ? (a + ' → ' + b) : String(a == null ? '' : a);
      if (!txt) return false;
      if (typeof window.chatAddSystem === 'function') return window.chatAddSystem(txt);
    } catch (e) {}
    return false;
  };
  // 后台通知检查（新版由 call.js/mail.js 提供）：本工程无后台调度，一律答「不需要通知」
  window.bgNotifyCheck = window.bgNotifyCheck || function () { return false; };

  (function injectAvlibStyle() {
    try {
      if (document.getElementById('mochi-avlib-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-avlib-style';
      s.textContent =
        '#avlib-card{position:fixed;top:0;right:0;bottom:0;left:0;z-index:85;display:flex;align-items:flex-end;justify-content:center;' +
        'background:rgba(0,0,0,.35);padding:0;}' +
        '#avlib-card[hidden]{display:none !important;}' +
        '.avlib-box{width:100%;max-width:520px;max-height:72vh;overflow-y:auto;background:var(--secondary-bg);' +
        'border:1px solid var(--border-color);border-radius:18px 18px 0 0;' +
        'padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -12px 40px rgba(0,0,0,.28);}' +
        '.avlib-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;}' +
        '.avlib-title{font-size:15px;font-weight:700;color:var(--text-primary);}' +
        '.avlib-x{background:none;border:none;font-size:20px;line-height:1;color:var(--text-secondary);cursor:pointer;padding:0 4px;}' +
        '.avlib-sub{font-size:11px;color:var(--text-secondary);margin-bottom:10px;}' +
        '.avlib-tabs,.avlib-kinds{display:flex;gap:6px;margin-bottom:8px;}' +
        '.avlib-tab,.avlib-kind{flex:1;padding:7px 0;font-size:12px;border:1px solid var(--border-color);border-radius:10px;' +
        'background:var(--primary-bg);color:var(--text-secondary);cursor:pointer;font-family:inherit;}' +
        '.avlib-tab.active,.avlib-kind.active{background:var(--accent-color);color:#fff;border-color:var(--accent-color);}' +
        '.avlib-pane[hidden]{display:none !important;}' +
        '.avlib-pane-title{font-size:12px;font-weight:600;color:var(--text-primary);margin-bottom:8px;}' +
        '.avlib-enable{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);margin:6px 0 10px;}' +
        '.avlib-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px;font-size:12px;color:var(--text-secondary);}' +
        '.avlib-bar span{flex:1;}' +
        '.avlib-btn{font-size:12px;padding:5px 12px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-primary);cursor:pointer;font-family:inherit;}' +
        '.avlib-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;}' +
        '.avlib-cell{position:relative;aspect-ratio:1/1;border-radius:12px;overflow:hidden;border:1px solid var(--border-color);' +
        'background:var(--primary-bg);cursor:pointer;}' +
        '.avlib-cell img{width:100%;height:100%;object-fit:cover;display:block;}' +
        '.avlib-nick-list{display:flex;flex-direction:column;gap:6px;}' +
        '.avlib-name-cell{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid var(--border-color);' +
        'border-radius:10px;background:var(--primary-bg);font-size:13px;color:var(--text-primary);}' +
        '.avlib-name-txt{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 12. 完整通话系统所需门面与样式（接入第 8 轮） ---------- */
  // 进聊天页（新版 chat.js 的导航）：映射到本工程的主页外壳
  window.enterChat = window.enterChat || function () {
    try {
      if (window.HomeShell && typeof window.HomeShell.openChat === 'function') { window.HomeShell.openChat(); return true; }
      if (typeof showModal === 'function') { var h = document.getElementById('page-phone'); if (h) h.hidden = true; }
      return true;
    } catch (e) { return false; }
  };
  // 打开聊天设置里的通话半框（新版 chat-settings 的面板）：本工程把通话面板放在聊天设置弹窗里
  window.openChatCallPanel = window.openChatCallPanel || function () {
    try {
      var m = document.getElementById('chat-modal');
      if (m && typeof showModal === 'function') { showModal(m); return true; }
      var s = document.getElementById('settings-modal');
      if (s && typeof showModal === 'function') { showModal(s); return true; }
    } catch (e) {}
    return false;
  };
  // 夜间模式判定（新版系统基座文件.js）：本工程无夜间静默机制，一律答否
  window.nightModeActive = window.nightModeActive || function () { return false; };

  (function injectCallStyle() {
    try {
      if (document.getElementById('mochi-call-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-call-style';
      s.textContent =
        '.call-mask{position:fixed;top:0;right:0;bottom:0;left:0;z-index:90;display:flex;align-items:center;justify-content:center;' +
        'background:transparent;pointer-events:none;align-items:flex-end;}' +
        '.call-mask[hidden]{display:none !important;}' +
        '.call-inner{pointer-events:auto;position:relative;display:flex;flex-direction:column;align-items:center;gap:8px;padding:16px 18px 18px;width:100%;max-width:336px;margin:0 12px calc(96px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,.98);color:#1a1a1a;border:1px solid rgba(0,0,0,.1);border-radius:22px;box-shadow:0 18px 44px rgba(0,0,0,.22);}' +
        '.call-av{width:78px;height:78px;border-radius:50%;overflow:hidden;background:rgba(0,0,0,.06);' +
        'display:flex;align-items:center;justify-content:center;font-size:30px;color:#8a8a8a;}' +
        '.call-av img{width:100%;height:100%;object-fit:cover;}' +
        '.call-name{font-size:18px;font-weight:700;}.call-status{font-size:13px;opacity:.8;}' +
        '.call-countdown{font-size:13px;opacity:.75;min-height:18px;}.call-duration{font-size:15px;font-variant-numeric:tabular-nums;opacity:.9;}' +
        '.call-actions{display:flex;gap:26px;margin-top:14px;}' +
        '.call-btn{display:flex;flex-direction:column;align-items:center;gap:6px;border:none;border-radius:50%;width:62px;height:62px;' +
        'justify-content:center;font-size:20px;color:#fff;cursor:pointer;font-family:inherit;}' +
        '.call-btn span{font-size:10px;font-weight:400;}' +
        '.call-answer{background:#34c759;}.call-reject{background:#ff3b30;}.call-hang{background:#ff3b30;}' +
        '.call-btn[hidden]{display:none !important;}' +
        '.call-min-btn{position:absolute;top:10px;right:10px;width:30px;height:30px;border-radius:50%;border:1px solid rgba(0,0,0,.12);background:rgba(0,0,0,.05);color:#666;' +
        'cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:12px;padding:0;}' +
        '.call-min-btn[hidden]{display:none !important;}' +
        '.call-mini{position:fixed;right:14px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:88;display:flex;' +
        'align-items:center;gap:9px;padding:8px 12px;border-radius:99px;background:rgba(28,30,36,.92);color:#fff;' +
        'box-shadow:0 8px 26px rgba(0,0,0,.32);}' +
        '.call-mini[hidden]{display:none !important;}' +
        '.call-mini-av{width:32px;height:32px;border-radius:50%;overflow:hidden;background:rgba(255,255,255,.14);' +
        'display:flex;align-items:center;justify-content:center;font-size:14px;}' +
        '.call-mini-av img{width:100%;height:100%;object-fit:cover;}' +
        '.call-mini-info{line-height:1.25;}.call-mini-name{font-size:12px;font-weight:600;}' +
        '.call-mini-time{font-size:11px;opacity:.75;font-variant-numeric:tabular-nums;}' +
        '.call-mini-hang{background:#ff3b30;border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:12px;}' +
        '.call-panel{margin-top:6px;}' +
        '.call-row{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text-secondary);padding:7px 2px;}' +
        '.call-row[hidden]{display:none !important;}' +
        '.call-row-val{flex:1;text-align:right;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
        '.call-mini-btn{font-size:11px;padding:3px 9px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-primary);cursor:pointer;font-family:inherit;}' +
        '.call-input{flex:1;min-width:0;font-size:11px;padding:4px 8px;border:1px solid var(--border-color);border-radius:8px;' +
        'background:var(--primary-bg);color:var(--text-primary);font-family:inherit;}' +
        '.img-view-mask{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9000;background:rgba(0,0,0,.9);display:flex;align-items:center;justify-content:center;}' +
        '.img-view-mask[hidden]{display:none !important;}' +
        '.img-view-mask img{max-width:94vw;max-height:88vh;object-fit:contain;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 13. 信箱所需门面与样式（接入第 10 轮） ---------- */
  // 收藏记账（新版 feed.js/mail.js 共用）：统一写进 fav-msgs，供「收藏设置」统计与收藏页读取
  function _mochiFavAdd(item, by) {
    try {
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!s) return false;
      var list = [];
      try { list = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      var rec = (item && typeof item === 'object') ? item : { text: String(item == null ? '' : item) };
      rec.ts = rec.ts || Date.now();
      rec.by = by;
      if (!rec.kind) rec.kind = 'msg';
      // 同一条内容只计一次：优先按 (kind,ts) 判同（朋友圈/信件用 ts 定位），否则按 (kind,text)
      var dup = list.some(function (r) {
        if (!r || r.kind !== rec.kind) return false;
        if (rec.ref && r.ref) return String(r.ref) === String(rec.ref);
        if (rec.kind === 'feed' || rec.kind === 'mail') return Number(r.ts) === Number(rec.ts) && (r.by || '') === by;
        return String(r.text || '') === String(rec.text || '') && (r.by || '') === by;
      });
      if (dup) return false;                       // 已收藏过 → 不重复计入
      list.push(rec);
      if (list.length > 500) list = list.slice(-500);
      s.set('fav-msgs', JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }
  window.addMyFavItem = window.addMyFavItem || function (item) { return _mochiFavAdd(item, 'me'); };
  window.addTaFavItem = window.addTaFavItem || function (item) { return _mochiFavAdd(item, 'ta'); };
  // 朋友圈收藏：点一次收藏、再点一次取消（feed.js 的收藏按钮会调它）
  window.mochiFeedFavToggle = function (item) {
    try {
      var it = (item && typeof item === 'object') ? item : {};
      var ts = Number(it.ts || 0);
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!s) return false;
      var list = [];
      try { list = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      var idx = -1;
      for (var i = list.length - 1; i >= 0; i--) {
        var r = list[i];
        if (!r) continue;
        if ((r.kind || '') === 'feed' && (r.by || '') !== 'ta' && Number(r.ts) === ts) { idx = i; break; }
      }
      if (idx >= 0) { list.splice(idx, 1); s.set('fav-msgs', JSON.stringify(list)); return false; }   // 取消收藏
      if (typeof window.addMyFavItem !== 'function') return false;
      return !!window.addMyFavItem({ kind: 'feed', text: it.text || '', imgs: it.imgs || [], ts: ts || Date.now(), side: it.side || 'out' });
    } catch (e) { return false; }
  };

  (function injectMailStyle() {
    try {
      if (document.getElementById('mochi-mail-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-mail-style';
      s.textContent =
        '#page-mail{position:fixed;top:0;right:0;bottom:0;left:0;z-index:82;display:flex;flex-direction:column;background:var(--primary-bg);' +
        'overflow-y:auto;padding:calc(12px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));}' +
        '#page-mail[hidden]{display:none !important;}' +
        '.mail-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-shrink:0;}' +
        '.mail-title{flex:1;font-size:15px;font-weight:700;color:var(--text-primary);text-align:center;}' +
        '.mail-badge{display:inline-block;min-width:16px;padding:0 5px;border-radius:99px;background:#ff3b30;color:#fff;' +
        'font-size:10px;line-height:16px;vertical-align:2px;}' +
        '.mail-badge[hidden]{display:none !important;}' +
        '.mail-toolbar{display:flex;gap:6px;overflow-x:auto;margin-bottom:10px;flex-shrink:0;scrollbar-width:none;}' +
        '.mail-toolbar::-webkit-scrollbar{display:none;}' +
        '.mail-tbtn{flex-shrink:0;font-size:12px;padding:5px 11px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-primary);cursor:pointer;font-family:inherit;white-space:nowrap;}' +
        '.mail-sec{font-size:12px;font-weight:700;color:var(--accent-color);margin:6px 0 8px;flex-shrink:0;}' +
        '.mail-list{display:flex;flex-direction:column;gap:8px;margin-bottom:12px;}' +
        '.mail-list > *{border:1px solid var(--border-color);border-radius:12px;padding:10px 12px;background:var(--secondary-bg);' +
        'font-size:13px;color:var(--text-primary);cursor:pointer;}' +
        '.mail-sub{margin-top:6px;}' +
        '.mail-sub[hidden]{display:none !important;}' +
        '.mail-head2{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-primary);margin-bottom:8px;}' +
        '.mail-field{font-size:12px;color:var(--text-secondary);margin-bottom:8px;}' +
        '.mail-textarea{width:100%;min-height:110px;box-sizing:border-box;font-size:13px;line-height:1.6;padding:10px 12px;' +
        'border:1px solid var(--border-color);border-radius:12px;background:var(--secondary-bg);color:var(--text-primary);' +
        'font-family:inherit;resize:vertical;margin-bottom:10px;}' +
        '.mail-original{font-size:12px;color:var(--text-secondary);border-left:3px solid var(--border-color);padding:6px 10px;' +
        'margin-bottom:10px;white-space:pre-wrap;max-height:120px;overflow-y:auto;}' +
        '.mail-send-btn{font-size:13px;padding:8px 16px;border:none;border-radius:99px;background:var(--accent-color);color:#fff;' +
        'cursor:pointer;font-family:inherit;}' +
        '.mail-row2{display:flex;gap:8px;align-items:center;}' +
        '.tc-mask{position:fixed;top:0;right:0;bottom:0;left:0;z-index:9100;background:rgba(0,0,0,.86);display:flex;align-items:center;justify-content:center;padding:18px;}' +
        '.tc-mask[hidden]{display:none !important;}' +
        '.tc-body{max-width:92vw;max-height:86vh;overflow:auto;background:var(--secondary-bg);border-radius:16px;padding:16px;' +
        'color:var(--text-primary);font-size:13px;line-height:1.7;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 14. 「大键写入闸门」家族门面（接入第 10 轮时暴露；朋友圈/群聊页也会用） ----------
     新版数据层（idb.js）里这三兄弟管的是「大键还没读全时先别整包写回」的退避闸门；
     本工程的存储后端是同步 localStorage（就是权威来源、不存在读不全），因此：
       xyBigWriteHold   → false（不用等，可以立刻写）
       xyBigWriteBlocked→ false（没被阻断）
       xyBigWriteRelease→ no-op
     这样各模块的「读不全先让路」保护逻辑自然走「当场落笔」分支。 */
  window.xyBigWriteHold = window.xyBigWriteHold || function () { return false; };
  window.xyBigWriteBlocked = window.xyBigWriteBlocked || function () { return false; };
  window.xyBigWriteRelease = window.xyBigWriteRelease || function () {};

  /* ---------- 15. 朋友圈所需门面与样式（接入第 11 轮） ---------- */
  // 朋友圈配置：新版由 feed-settings/回复设置提供；这里从 replyCfg 的 fd-* 键映射，
  // 并用 Proxy 兜底——模块读到的任何未显式映射字段，都回落到该字段在 replyCfg 里的 fd-<name>（或 undefined，走模块自带默认）。
  function _feedCfgBuild() {
    var c = {};
    try { c = (typeof window.replyCfg === 'function') ? (window.replyCfg() || {}) : {}; } catch (e) { c = {}; }
    var num = function (k, d) { var v = c['fd-' + k]; var n = Number(v); return isFinite(n) && v !== '' && v !== null && v !== undefined ? n : d; };
    var base = {
      like: num('like-prob', 80), likeSpeedMin: num('like-speed-min', 30), likeSpeedMax: num('like-speed-max', 180),
      comment: num('comment-prob', 40), commentSpeedMin: num('comment-speed-min', 40), commentSpeedMax: num('comment-speed-max', 240),
      reply: num('reply-prob', 60), replySpeedMin: num('reply-speed-min', 40), replySpeedMax: num('reply-speed-max', 240),
      likeback: num('likeback-prob', 30), card: num('card-prob', 20), maxCards: num('max-cards', 2),
      image: num('image-prob', 10), post: num('post-prob', 30), postDailyMax: num('post-daily-max', 3),
      postCool: num('post-cool', 0), postEn: (c['fd-post-en'] === 0 ? 0 : 1),
      minInterval: num('min-interval', 60), maxInterval: num('max-interval', 240),
      minCardsPost: num('min-cards-post', 1), maxCardsPost: num('max-cards-post', 3),
      kaomoji: num('post-kaomoji', 20), emoji: num('post-emoji', 20), sticker: num('post-sticker', 10), feedImage: num('post-image', 10),
      kaomojiEn: (c['fd-kaomoji-en'] === 0 ? 0 : 1), emojiEn: (c['fd-emoji-en'] === 0 ? 0 : 1),
      stickerEn: (c['fd-sticker-en'] === 0 ? 0 : 1), imageEn: (c['fd-image-en'] === 0 ? 0 : 1),
      punctEn: (c['fd-punct-en'] === 0 ? 0 : 1)
    };
    try {
      return new Proxy(base, {
        get: function (t, k) {
          if (k in t) return t[k];
          var v = c['fd-' + String(k)];
          return (v === undefined || v === null || v === '') ? undefined : (isFinite(Number(v)) ? Number(v) : v);
        }
      });
    } catch (e) { return base; }
  }
  window.feedCfg = window.feedCfg || function () { return _feedCfgBuild(); };
  window.feedCfgFor = window.feedCfgFor || function () { return _feedCfgBuild(); };

  // 默认字卡库门面（新版 chatcard/default-card 提供）：本工程以「全部可用」为默认
  window.defaultCardApiFor = window.defaultCardApiFor || function () {
    return {
      enabled: function () { return false; },
      use: function () { return false; },

      lines: function () { return []; },
      add: function () { return false; },
      remove: function () { return false; }
    };
  };
  window.defaultCardCfg = window.defaultCardCfg || function () { return { enabled: false }; };
  window.defaultCardUse = window.defaultCardUse || function () { return false; };
  // 媒体卡片身份：给同一张图一个稳定标识（用于去重）
  window.ccMediaCardIdent = window.ccMediaCardIdent || function (src) {
    var s = String(src == null ? '' : src);
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
    return 'mc' + h.toString(36) + '_' + s.length;
  };

  (function injectFeedStyle() {
    try {
      if (document.getElementById('mochi-feed-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-feed-style';
      s.textContent =
        '#page-feed,#page-feed-all,#page-feed-friends{position:fixed;top:0;right:0;bottom:0;left:0;z-index:82;display:flex;flex-direction:column;' +
        'background:var(--primary-bg);overflow-y:auto;padding:calc(12px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));}' +
        '.page[hidden]{display:none !important;}' +
        '.feed-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-shrink:0;}' +
        '.feed-title{flex:1;font-size:15px;font-weight:700;color:var(--text-primary);text-align:center;}' +
        '.feed-tbtn{flex-shrink:0;font-size:12px;padding:5px 11px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-primary);cursor:pointer;font-family:inherit;}' +
        '.feed-cover-wrap{position:relative;margin-bottom:14px;flex-shrink:0;}' +
        '.feed-cover{height:120px;border-radius:14px;background:linear-gradient(135deg,rgba(var(--accent-color-rgb),.35),rgba(var(--accent-color-rgb),.08));' +
        'background-size:cover;background-position:center;}' +
        '.feed-cover-mini{width:44px;height:44px;border-radius:10px;background:rgba(var(--accent-color-rgb),.15);background-size:cover;background-position:center;}' +
        '.feed-me{display:flex;align-items:center;gap:9px;margin-top:-18px;padding:0 6px;}' +
        '.feed-av{width:44px;height:44px;border-radius:50%;overflow:hidden;background:var(--secondary-bg);border:2px solid var(--primary-bg);' +
        'display:flex;align-items:center;justify-content:center;font-size:18px;color:var(--text-secondary);}' +
        '.feed-av img{width:100%;height:100%;object-fit:cover;}' +
        '.feed-me-name{font-size:13px;font-weight:600;color:var(--text-primary);}' +
        '.feed-publish{border:1px solid var(--border-color);border-radius:14px;padding:10px 12px;margin-bottom:12px;background:var(--secondary-bg);}' +
        '.feed-publish[hidden]{display:none !important;}' +
        '.feed-input{width:100%;min-height:64px;box-sizing:border-box;font-size:13px;line-height:1.6;padding:8px 10px;border:none;' +
        'background:transparent;color:var(--text-primary);font-family:inherit;resize:vertical;outline:none;}' +
        '.feed-pv{margin:6px 0;}' +
        '.feed-pv[hidden]{display:none !important;}' +
        '.feed-bar{display:flex;align-items:center;gap:8px;margin-top:6px;}' +
        '.feed-send{margin-left:auto;font-size:13px;padding:7px 16px;border:none;border-radius:99px;background:var(--accent-color);' +
        'color:#fff;cursor:pointer;font-family:inherit;}' +
        '.feed-list{display:flex;flex-direction:column;gap:10px;}' +
        '.feed-list > *{border:1px solid var(--border-color);border-radius:12px;padding:10px 12px;background:var(--secondary-bg);' +
        'font-size:13px;color:var(--text-primary);}' +
        '.feed-panel{position:fixed;left:0;right:0;bottom:0;z-index:84;background:var(--secondary-bg);border-top:1px solid var(--border-color);' +
        'border-radius:16px 16px 0 0;padding:12px 14px calc(14px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 30px rgba(0,0,0,.18);}' +
        '.feed-panel[hidden]{display:none !important;}' +
        '.feed-panel-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;' +
        'color:var(--text-primary);margin-bottom:8px;}' +
        '.feed-comment-bar{display:flex;gap:6px;overflow-x:auto;margin-bottom:6px;}' +
        '.feed-line{width:100%;box-sizing:border-box;font-size:13px;padding:8px 10px;border:1px solid var(--border-color);' +
        'border-radius:10px;background:var(--primary-bg);color:var(--text-primary);font-family:inherit;margin-bottom:6px;}' +
        '.feed-notice-list{max-height:40vh;overflow-y:auto;font-size:12px;color:var(--text-secondary);}' +
        '.feed-sticker-groups{display:flex;gap:6px;overflow-x:auto;margin-bottom:6px;}' +
        '.feed-sticker-list{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;max-height:34vh;overflow-y:auto;}' +
        '.feed-sticker-list img{width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;border:1px solid var(--border-color);}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 16. 群聊页所需门面与样式（接入第 12 轮，最后一个模块） ---------- */
  // 群聊配置：与 feedCfg 同思路——从 replyCfg 的 gc-* 键映射，Proxy 兜底任何未显式映射字段。
  function _gcCfgBuild() {
    var c = {};
    try { c = (typeof window.replyCfg === 'function') ? (window.replyCfg() || {}) : {}; } catch (e) { c = {}; }
    var num = function (k, d) { var v = c['gc-' + k]; var n = Number(v); return (v === '' || v === null || v === undefined || !isFinite(n)) ? d : n; };
    var base = {
      en: (c['gc-en'] === 0 ? 0 : 1), replyMin: num('reply-min', 1), replyMax: num('reply-max', 2),
      replyProb: num('reply-prob', 100), delayMin: num('delay-min', 1), delayMax: num('delay-max', 4),
      typing: (c['gc-typing'] === 0 ? 0 : 1), card: num('card-prob', 20), image: num('image-prob', 10),
      maxMsgs: num('max-msgs', 200), membersMax: num('members-max', 8), poke: (c['gc-poke'] === 0 ? 0 : 1)
    };
    try {
      return new Proxy(base, {
        get: function (t, k) {
          if (k in t) return t[k];
          var v = c['gc-' + String(k)];
          return (v === undefined || v === null || v === '') ? undefined : (isFinite(Number(v)) ? Number(v) : v);
        }
      });
    } catch (e) { return base; }
  }
  window.gcCfg = window.gcCfg || function () { return _gcCfgBuild(); };

  (function injectGroupChatStyle() {
    try {
      if (document.getElementById('mochi-gc-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-gc-style';
      s.textContent =
        '#page-group-chat{position:fixed;top:0;right:0;bottom:0;left:0;z-index:82;display:flex;flex-direction:column;background:var(--primary-bg);}' +
        '#page-group-chat[hidden]{display:none !important;}' +
        '.gc-head{display:flex;align-items:center;gap:8px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px;' +
        'border-bottom:1px solid var(--border-color);flex-shrink:0;}' +
        '.gc-name{flex:1;font-size:15px;font-weight:700;color:var(--text-primary);text-align:center;}' +
        '.gc-tbtn{flex-shrink:0;font-size:12px;padding:5px 10px;border:1px solid var(--border-color);border-radius:99px;' +
        'background:var(--primary-bg);color:var(--text-primary);cursor:pointer;font-family:inherit;}' +
        '.gc-tbtn[hidden]{display:none !important;}' +
        '.gc-body{flex:1;min-height:0;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px;}' +
        '.gc-body > *{max-width:82%;}' +
        '.gc-typing{font-size:11px;color:var(--text-secondary);padding:4px 14px;flex-shrink:0;}' +
        '.gc-typing[hidden]{display:none !important;}' +
        '.gc-loading{font-size:12px;color:var(--text-secondary);padding:8px 14px;text-align:center;}' +
        '.gc-loading[hidden]{display:none !important;}' +
        '.gc-quote-bar,.gc-msg-actions{font-size:12px;color:var(--text-secondary);padding:6px 14px;border-top:1px solid var(--border-color);}' +
        '.gc-quote-bar[hidden],.gc-msg-actions[hidden],.gc-draft[hidden],.gc-more[hidden],.gc-panel[hidden],.gc-pad[hidden]{display:none !important;}' +
        '.gc-draft{font-size:12px;color:var(--text-secondary);padding:6px 14px;}' +
        '.gc-draft-h{font-weight:600;margin-bottom:4px;color:var(--text-primary);}' +
        '.gc-input-bar{display:flex;align-items:flex-end;gap:6px;padding:8px 10px calc(10px + env(safe-area-inset-bottom,0px));' +
        'border-top:1px solid var(--border-color);flex-shrink:0;background:var(--secondary-bg);}' +
        '.gc-input{flex:1;min-width:0;max-height:96px;font-size:13px;line-height:1.5;padding:8px 10px;border:1px solid var(--border-color);' +
        'border-radius:12px;background:var(--primary-bg);color:var(--text-primary);font-family:inherit;resize:none;}' +
        '.gc-send{flex-shrink:0;width:38px;height:38px;border:none;border-radius:50%;background:var(--accent-color);color:#fff;' +
        'cursor:pointer;font-size:14px;}' +
        '.gc-more{display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;border-top:1px solid var(--border-color);background:var(--secondary-bg);}' +
        '.gc-panel{position:fixed;left:0;right:0;bottom:0;z-index:86;max-height:72vh;overflow-y:auto;background:var(--secondary-bg);' +
        'border-top:1px solid var(--border-color);border-radius:16px 16px 0 0;padding:12px 14px calc(16px + env(safe-area-inset-bottom,0px));' +
        'box-shadow:0 -10px 30px rgba(0,0,0,.2);}' +
        '.gc-panel-head{display:flex;align-items:center;justify-content:space-between;font-size:13px;font-weight:600;' +
        'color:var(--text-primary);margin-bottom:8px;}' +
        '.gc-panel-body{font-size:12px;color:var(--text-secondary);}' +
        '.gc-row{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--text-secondary);}' +
        '.gc-line{flex:1;min-width:0;font-size:12px;padding:6px 9px;border:1px solid var(--border-color);border-radius:9px;' +
        'background:var(--primary-bg);color:var(--text-primary);font-family:inherit;}' +
        '.gc-preview-bar{display:flex;gap:6px;overflow-x:auto;margin-top:6px;}' +
        '.gc-poke-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();

  /* ---------- 17. 广播「数据已就绪」 ----------
     各功能模块普遍监听 document 上的 mochi-restore-done（朋友圈的 feedDbReady、信箱的 mailDbReady、
     头像库、通话、收藏页等都以此为「权威那份回来了」的信号）。适配层此前只发了自己命名的事件，
     于是这些模块的 ready 标志一直是 false → 表现为「朋友圈发帖只进内存不落盘」等。这里补齐广播。 */
  (function announceRestoreDone() {
    try {
      var fired = false;
      var fire = function () {
        if (fired) return; fired = true;
        try { window.__mochiDataReady = true; } catch (e) {}
        try { document.dispatchEvent(new Event('mochi-restore-done')); } catch (e) {}
        try { window.dispatchEvent(new Event('mochi-restore-done')); } catch (e) {}
        try { document.dispatchEvent(new Event('mochi:dataready')); } catch (e) {}
      };
      setTimeout(fire, 1000);
      try { window.addEventListener('load', function () { setTimeout(fire, 600); }); } catch (e) {}
      try { if (document.readyState === 'complete') setTimeout(fire, 600); } catch (e) {}
    } catch (e) {}
  })();
  // 一次性：关掉「今日情话」的系统预设开关（用户要求系统预设全下线；模块读 null 时默认开，故显式写 0）
  (function offQuoteSystemPresets() {
    try {
      var MK = 'mochiStore:quote-system-off-v1';
      if (localStorage.getItem(MK) === '1') return;
      var k = 'mochiStore:xy-home-v2:default:quote-cards-default';
      if (localStorage.getItem(k) === null) localStorage.setItem(k, '0');
      localStorage.setItem(MK, '1');
    } catch (e) {}
  })();
  // 一次性：恢复「词典拼字」（qs-en=1）并由「自定义回复」取材——
  // 上一版曾因系统词典下线把它关掉（写 qs-en=0 并留下标记 mochiStore:qs-off-v1）；
  // 现在它的取材已改成自定义回复（dict 的「语录·自定义」组 + qs-cc 混入自定义池），故恢复开启。
  (function restoreDictSpellOnce() {
    try {
      var MK = 'mochiStore:qs-off-v1';
      if (localStorage.getItem(MK) !== '1') return;
      var fire = function () {
        try {
          if (typeof window.replyCfg === 'function' && typeof window.saveReplyCfg === 'function') {
            var c = window.replyCfg();
            if (Number(c['qs-en']) !== 1) window.saveReplyCfg('qs-en', 1);
            if (Number(c['qs-cc']) !== 1) window.saveReplyCfg('qs-cc', 1);   // 混用自定义字卡（=你的自定义回复）
            if (Number(c['py-en']) !== 1) window.saveReplyCfg('py-en', 1);   // 拼字总闸
          }
        } catch (e) {}
      };
      document.addEventListener('mochi-restore-done', function () { setTimeout(fire, 200); });
      setTimeout(fire, 1500);
      localStorage.removeItem(MK);
    } catch (e) {}
  })();
  /* ---------- 18. 收藏汇总 + 对方概率收藏（用户需求） ----------
     ① 所有收藏都要出现在主页收藏里：milk-main 自己的消息收藏在 renderFavorites()，
        新版模块（信件/朋友圈/卡片）的收藏写在 fav-msgs —— 这里包装 renderFavorites，
        在其后再追加 fav-msgs 的记录，于是「收藏页」= 消息收藏 + 其它一切收藏。
     ② 对方也有概率收藏我发出的内容：
        · ta-mail / ta-feed 模块里已自带（mail.js / feed.js）
        · ta-msg / ta-card 由本文件实现，钩子挂在 core.js 的发送路径上（window.mochiMaybeTaFavSent） */
  var FAV_KIND_LABEL = { msg: '聊天', card: '卡片', mail: '信件', feed: '动态' };
  function _mochiFavRecords() {
    try {
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!s) return [];
      var v = JSON.parse(s.get('fav-msgs') || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function _mochiEsc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _mochiFavKindLabel(r) { return FAV_KIND_LABEL[r.kind] || '其它'; }
  function _mochiFavRowHtml(r) {
    var kind = _mochiFavKindLabel(r);
    var when = r.ts ? new Date(r.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    var text = _mochiEsc(r.text || r.title || '').slice(0, 200);
    return '<div class="fav-x-row">' +
      '<div class="fav-x-top"><span class="fav-x-kind">' + kind + '</span><span class="fav-x-time">' + when + '</span></div>' +
      (text ? '<div class="fav-x-text">' + text + '</div>' : '') + '</div>';
  }
  function _mochiFavRowsHtml(arr) {
    return arr.map(_mochiFavRowHtml).join('');
  }
  function _mochiFavDedupe(arr) {
    var seen = {}, out = [];
    arr.forEach(function (r) {
      if (!r) return;
      var key = (r.kind || '') + '|' + (r.ts || '') + '|' + String(r.text || r.title || '').slice(0, 60);
      if (seen[key]) return;
      seen[key] = 1; out.push(r);
    });
    return out;
  }
  // 收藏页两个分页：我的收藏（原消息卡 + 我的其它收藏）/ 他的收藏（by:'ta' 的记录）
  function _mochiAppendFavExtra() {
    try { if (typeof _mochiFavReconcile === 'function') _mochiFavReconcile(); } catch (e) {}
    var mineList = document.getElementById('favorites-list');
    var taList = document.getElementById('fav-ta-list');
    var recs = _mochiFavRecords();
    var shownMsg = {};
    try {
      (window.getChatMsgs ? window.getChatMsgs() : []).forEach(function (m) { if (m && m.favorited) shownMsg['msg#' + m.id] = 1; });
    } catch (e) {}
    var mine = [], ta = [];
    recs.forEach(function (r) {
      if (!r) return;
      if (r.ref && shownMsg[r.ref]) return;          // 已作为消息卡显示过 → 不重复列
      (r.by === 'ta' ? ta : mine).push(r);
    });
    mine = _mochiFavDedupe(mine);
    ta = _mochiFavDedupe(ta);
    if (mineList) {
      var old = mineList.querySelector('.fav-mine-extra');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      if (mine.length) {
        var box = document.createElement('div');
        box.className = 'fav-mine-extra fav-sec-box';
        box.innerHTML = _mochiFavRowsHtml(mine);
        mineList.appendChild(box);
      }
    }
    if (taList) {
      taList.innerHTML = ta.length
        ? _mochiFavRowsHtml(ta)
        : '<div class="ta-empty" style="font-size:12px;color:var(--text-secondary);padding:10px 2px;">TA 还没有收藏任何内容</div>';
    }
  }
  // 包装 renderFavorites（games.js 稍后加载，故用重试包裹 + 数据就绪时再包一次）
  (function wrapRenderFavorites() {
    var tries = 0;
    var wrap = function () {
      if (typeof window.renderFavorites === 'function' && !window.renderFavorites.__mochiWrapped) {
        var orig = window.renderFavorites;
        var wrapped = function () {
          var r = orig.apply(this, arguments);
          try { _mochiAppendFavExtra(); } catch (e) {}
          return r;
        };
        wrapped.__mochiWrapped = true;
        window.renderFavorites = wrapped;
        window.renderFav = wrapped;      // 「收藏设置页」返回时会调 window.renderFav()
        return true;
      }
      return false;
    };
    if (!wrap()) {
      var iv = setInterval(function () { if (wrap() || ++tries > 40) clearInterval(iv); }, 250);
      try { document.addEventListener('mochi-restore-done', function () { setTimeout(wrap, 100); }); } catch (e) {}
    }
  })();
  // ②-1 对方收藏我发的聊天消息 / 卡片（ta-msg / ta-card；mail/feed 模块自带）
  window.mochiMaybeTaFavSent = function (msg) {
    try {
      if (!msg) return false;
      var cfg = (typeof window.favCfg === 'function') ? window.favCfg() : null;
      if (!cfg) return false;
      var text = String(msg.text == null ? '' : msg.text).trim();
      var isCard = !!(msg.cardTag || msg.image || msg.type === 'sticker' || msg.mediaToken);
      var prob = Number(isCard ? cfg.taCard : cfg.taMsg);
      if (!isFinite(prob) || prob <= 0) return false;
      if (!text && !isCard) return false;
      if (Math.random() * 100 >= prob) return false;
      if (typeof window.addTaFavItem !== 'function') return false;
      var label = (msg.type === 'sticker' || msg.sticker || msg.emoji || msg.isEmoji) ? '[表情]' : '[图片]';
      window.addTaFavItem({ kind: isCard ? 'card' : 'msg', text: text || label, ts: Date.now() });
      if (typeof window.showNotification === 'function') {
        window.showNotification(isCard ? '对方收藏了你的卡片 ★' : '对方收藏了这条消息 ★', 'success', 1800);
      }
      return true;
    } catch (e) { return false; }
  };
  // 汇总块的样式
  (function injectFavExtraStyle() {
    try {
      if (document.getElementById('mochi-favextra-style')) return;
      var s = document.createElement('style');
      s.id = 'mochi-favextra-style';
      s.textContent =
        '.fav-sec-head{font-size:12px;font-weight:700;color:var(--accent-color);margin:14px 0 8px;' +
        'border-top:1px dashed var(--border-color);padding-top:10px;}' +
        '.fav-sec-box{display:flex;flex-direction:column;gap:8px;}' +
        '.fav-x-head{font-size:12px;font-weight:700;color:var(--accent-color);margin-bottom:8px;}' +
        '.fav-x-row{border:1px solid var(--border-color);border-radius:12px;padding:9px 11px;margin-bottom:8px;background:var(--secondary-bg);}' +
        '.fav-x-top{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-secondary);margin-bottom:4px;}' +
        '.fav-x-who{font-weight:700;color:var(--accent-color);}' +
        '.fav-x-who.ta{color:#e08a3a;}' +
        '.fav-x-kind{border:1px solid var(--border-color);border-radius:6px;padding:0 5px;}' +
        '.fav-x-time{margin-left:auto;}' +
        '.fav-x-text{font-size:13px;color:var(--text-primary);line-height:1.55;word-break:break-word;}';
      document.head.appendChild(s);
    } catch (e) {}
  })();
  /* ---------- 19. 消息收藏 ⇄ fav-msgs 对账（让统计覆盖聊天消息收藏） ----------
     milk-main 的星标/批量收藏只改 message.favorited；新版「收藏设置」的统计读 fav-msgs。
     这里以 favorited 为唯一真相做对账：新星标的补记录、取消星标的删记录（只动本机制写入的
     ref:'msg#<id>' 记录，不碰模块自己写的记录）。触发点：收藏页渲染时 + 轻量巡检 + 数据就绪。 */
  var _favMsgSig = null;
  function _mochiFavReconcile() {
    try {
      var msgs = (typeof window.getChatMsgs === 'function') ? (window.getChatMsgs() || []) : [];
      var favs = msgs.filter(function (m) { return m && m.favorited && m.type !== 'system'; });
      var sig = favs.map(function (m) { return String(m.id) + ':' + String(m.text || m.image || '').slice(0, 24); }).join('|');
      if (sig === _favMsgSig) return false;      // 没变化就不动
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!s) return false;
      var list = [];
      try { list = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { list = []; }
      if (!Array.isArray(list)) list = [];
      var isMineMsg = function (r) { return !!(r && r.by === 'me' && r.kind === 'msg' && r.ref); };
      var refOf = function (m) { return 'msg#' + String(m.id); };
      var before = list.length;
      list = list.filter(function (r) {
        if (!isMineMsg(r)) return true;                                  // 不是本机制写的 → 原样保留
        return favs.some(function (m) { return refOf(m) === r.ref; });    // 仍被收藏 → 保留
      });
      favs.forEach(function (m) {
        var ref = refOf(m);
        if (list.some(function (r) { return isMineMsg(r) && r.ref === ref; })) return;
        list.push({ kind: 'msg', by: 'me', ref: ref, ts: Date.now(),
          text: String(m.text || (m.image ? '[图片]' : '')).slice(0, 500) });
      });
      _favMsgSig = sig;
      if (list.length !== before) s.set('fav-msgs', JSON.stringify(list));
      return true;
    } catch (e) { return false; }
  }
  window.mochiFavReconcile = _mochiFavReconcile;
  try {
    document.addEventListener('mochi-restore-done', function () { setTimeout(_mochiFavReconcile, 300); });
    setInterval(_mochiFavReconcile, 3000);     // 轻量巡检（无变化直接返回）
  } catch (e) {}
  /* ---------- 20. 朋友圈星标高亮兜底 ----------
     用户反馈：取消收藏后星星仍是黄色。各页卡片模板（主列表 / 全部动态）重算 .faved 的时机不一，
     这里按收藏记录 + feed-posts 的 ts 映射，直接同步页面上所有 .feed-act[data-fav] 的高亮。 */
  window.mochiSyncFeedFavUI = function () {
    try {
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      if (!s) return false;
      var msgs = [];
      try { msgs = JSON.parse(s.get('fav-msgs') || '[]'); } catch (e) { msgs = []; }
      if (!Array.isArray(msgs)) msgs = [];
      var favTs = {};
      msgs.forEach(function (r) { if (r && (r.kind || '') === 'feed' && (r.by || '') !== 'ta') favTs[String(r.ts)] = 1; });
      var posts = [];
      try { posts = JSON.parse(s.get('feed-posts') || '[]'); } catch (e) { posts = []; }
      var tsById = {};
      (Array.isArray(posts) ? posts : []).forEach(function (p) { if (p && p.id) tsById[String(p.id)] = String(p.ts || 0); });
      var btns = document.querySelectorAll('.feed-act[data-fav]');
      for (var i = 0; i < btns.length; i++) {
        var ts = tsById[String(btns[i].dataset.fav)];
        if (ts === undefined) continue;
        btns[i].classList.toggle('faved', !!favTs[ts]);
      }
      return true;
    } catch (e) { return false; }
  };
  try {
    // 点任意朋友圈星标后稍后兜底同步一次（覆盖各页模板）+ 每 4 秒轻量巡检（无按钮时开销可忽略）
    document.addEventListener('click', function (e) {
      try {
        var b = e.target && e.target.closest ? e.target.closest('.feed-act[data-fav]') : null;
        if (b) setTimeout(function () { window.mochiSyncFeedFavUI(); }, 140);
      } catch (err) {}
    }, true);
    setInterval(function () { if (document.querySelector('.feed-act[data-fav]')) window.mochiSyncFeedFavUI(); }, 4000);
  } catch (e) {}
  /* ---------- 21. 对方主动来信调度（回复设置 ml-write-*） ----------
     ml-write-en 总开关 / ml-write-prob 概率% / ml-write-min~max 间隔分钟 / ml-write-daily-max 每日上限。
     每 60 秒巡检一次：到点掷概率，命中且未超当日上限就来一封（落在信封收件箱并弹提示）。 */
  var _mlNextAt = 0;
  function _mlDayKey() { var d = new Date(); return 'ml-write-count-' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function _mlCfg() {
    try { return (typeof window.replyCfg === 'function') ? (window.replyCfg() || {}) : {}; } catch (e) { return {}; }
  }
  function _mlNum(c, k, d) { var v = Number(c[k]); return isFinite(v) ? v : d; }
  window.mochiMlWriteTick = function (force) {
    try {
      var c = _mlCfg();
      if (_mlNum(c, 'ml-write-en', 1) !== 1 && !force) return 'off';
      var now = Date.now();
      if (!force && now < _mlNextAt) return 'wait';
      var mn = Math.max(1, _mlNum(c, 'ml-write-min', 1));
      var mx = Math.min(1440, Math.max(mn, _mlNum(c, 'ml-write-max', 480)));
      _mlNextAt = now + (mn + Math.random() * (mx - mn)) * 60000;
      var prob = _mlNum(c, 'ml-write-prob', 30);
      if (prob <= 0) return 'prob0';
      if (!force && Math.random() * 100 >= prob) return 'miss';
      // 当日上限
      var s = (typeof window.activeStore === 'function') ? window.activeStore() : null;
      var cap = Math.max(1, _mlNum(c, 'ml-write-daily-max', 3));
      var dayKey = _mlDayKey(), used = 0;
      if (s) { try { used = Number(s.get(dayKey)) || 0; } catch (e) {} }
      if (used >= cap) return 'cap';
      if (typeof window.envelopeReceiveFromPartner !== 'function') return 'no-envelope';
      var letter = window.envelopeReceiveFromPartner({
        minCards: Math.min(20, _mlNum(c, 'ml-min-cards', 20)), maxCards: Math.min(20, _mlNum(c, 'ml-max-cards', 20))
      });
      if (!letter) return 'empty';
      if (s) { try { s.set(dayKey, String(used + 1)); } catch (e) {} }
      if (typeof window.showNotification === 'function') window.showNotification('对方给你寄来了一封信 ✉', 'info', 2600);
      return 'sent';
    } catch (e) { return 'error'; }
  };
  try {
    document.addEventListener('mochi-restore-done', function () {
      setTimeout(function () { window.mochiMlWriteTick(false); }, 4000);
    });
    setInterval(function () { window.mochiMlWriteTick(false); }, 60000);
  } catch (e) {}
  console.log('[mochi-compat] 适配层就绪');
})();
