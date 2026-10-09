/* 红包面板（新版红包系统整体覆盖式移植到 milk-main）
 *
 * 唯一来源（逐段对照）：
 *   ① 面板标记   mochi-main\src\template.html:6090-6173 —— #chat-rp-panel（头部 #rp-partner-name /
 *      #rp-settings-btn / #chat-rp-close；设置区 #rp-settings + #rp-settings-done；余额行 #rp-balance；
 *      封面区 #rp-cover-preview / #rp-cover-upload / #rp-cover-del；#rp-qixi-section +
 *      #rp-qixi-tag；情侣特殊金额；#rp-rand-val；#rp-custom；#rp-wish；#rp-send-btn；.poke-card-scroll）
 *   ② 面板逻辑   新功能\js\chat（提取）.js:10490-10598 —— 常量引用 / QIXI_DATES:10505 /
 *      openRpPanel:10511 / closeRpPanel:10545 / openRpSettings:10548 / closeRpSettings:10555 /
 *      side 切换:10563 / 金额与随机:10572 / 自定义金额互斥:10592
 *   ③ 钱包       同上:10599-10630（RP_WALLET_KEY='gift-wallet'、默认 52000 分、旧键 rp-wallet 迁移）
 *      + :10913-10918（rpRenderBalance）+ :10921-10969（rpEditWallet「向 Mochi 申请心意币」）
 *   ④ 红包封面   同上:10972-11043（rpCoverKey/Get/Set + rpCompressCover + rpRenderCover + 上传/删除）
 *   ⑤ 发送       同上:11044-11070（sendRedpacket：金额→留言→记账→记录→关面板）
 *   ⑥ 卡片渲染   同上:6115-6144（.msg-rp-card / msg-rp-top / msg-rp-amt / msg-rp-wish / msg-rp-foot）
 *   ⑦ 状态流转   同上:10667-10701（rpStatusText / rpStatusCls / rpPatchStatusInPlace）
 *      + :11076-11160 区段的领取/退回/长按退回/handleSendResponse/tryCollectPending
 *      + :10630（RP_EXPIRY_MS=24h）+ :10900-10912（rpExpireCheck 到期退回）
 *   ⑧ 对方主动发红包 同上:10702-10747（rpDailyMax / trySystemAutoSend 概率门 + 每日上限 + 随机金额）
 *   ⑨ 对方申请心意币 同上:10763-10809（rpAskProbRate / rpAskDailyMax / trySystemAskMochi）
 *   ⑩ 金额分布   同上:10631（RP_SPECIAL_FEN）+ :10655-10666（genRpAmount）
 *
 * 本工程适配（u=为让新版跑起来所必需的接线，其余一律照新版）：
 *   u1 我发红包：填应用自己的输入框 → 派发 input → 点 #send-btn，由应用落库并渲染气泡，
 *      随后把这个气泡升级成红包卡（加 .rp-card）。标记文本让刷新后仍能找回并重新美化。
 *   u2 对方消息：优先 window.mochiAddTaMessage()（core.js 暴露的真实消息写入口，会持久化），
 *      没有才回退自造 DOM 气泡（不持久化）。
 *   u3 文案：不内置任何金额/祝福语。祝福语输入框默认空、placeholder 也空；对方侧的话只在
 *      「自定义回复池」(window.getPool() / window.getCustomCards()) 里取，池为空就一个字都不说。
 *      新版里的系统预设话术池（rpThanksMsg/rpThxInMsg）与「你领取了红包（心意币 ¥x）」这类
 *      内置金额回执一律不搬（见交付清单「等价替代」一节）。
 *   u4 概率/上限读 window.replyCfg()['rp-ta-prob'](默认20) / ['rp-ta-cap'](默认2) / ['rp-ask-prob'] /
 *      ['rp-ask-cap']，并兼容新版落盘键 cs-rp-auto-prob / cs-rp-daily-max / cs-rp-ask-prob /
 *      cs-rp-ask-daily-max 与回复设置页的 reply-<key>（同键同域，可直接被写入）。
 *   u5 新版专有门面在本工程缺失，用最小等价替代，逐条见交付清单。
 */
(function () {
  'use strict';

  var MARK = '🧧红包';               // 我发的红包标记
  var TA_MARK = '🧧红包·对方';        // 对方发的红包标记（判定时先看它）
  // 「🧧红包 8.88 元 ｜ 留言」→ [全串, '·对方'|undefined, '8.88', '留言'|undefined]
  var RP_RE = /^🧧红包(·对方)?\s+([0-9]+(?:\.[0-9]+)?)\s*元(?:\s*[｜|]\s*([\s\S]*))?/;
  // 七夕日期表（chat（提取）.js:10505 原样）
  var QIXI_DATES = ['2024-08-10', '2025-08-29', '2026-08-19', '2027-08-08', '2028-08-26', '2029-08-15', '2030-08-04'];

  var TA_TIMER_BASE = 90000;         // 对方主动发红包的自调度基准（≈90s，另有 ±30s 抖动）
  var BEAUTIFY_MS = 3000;            // 周期性再美化 / 状态回填间隔
  var BUTTON_MS = 4000;              // 输入栏 🧧 按钮自愈间隔

  var rpSide = 'out';                // 'out'=我发红包 / 'in'=TA发红包（chat:10503）
  var rpPickedAmt = null;            // 当前选中的金额（chat:10504）

  /* ================= 工具 ================= */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function partnerName() {
    try { if (typeof window.chatPartnerName === 'function') return window.chatPartnerName() || 'TA'; } catch (e) {}
    try { var el = document.getElementById('partner-name'); if (el && el.textContent.trim()) return el.textContent.trim(); } catch (e) {}
    return 'TA';
  }

  function notify(msg) {
    try { if (typeof window.showNotification === 'function') { window.showNotification(msg, 'success', 2200); return; } } catch (e) {}
    try { if (typeof window.toast === 'function') { window.toast(msg); return; } } catch (e) {}
    try { if (typeof window.mochiToast === 'function') window.mochiToast(msg); } catch (e) {}
  }

  function isQixiToday() {
    try {
      var d = new Date();
      var k = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      return QIXI_DATES.indexOf(k) >= 0;
    } catch (e) { return false; }
  }

  function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

  function chatRoot() {
    return document.getElementById('chat-container') || document.querySelector('.main-chat-area') || null;
  }

  function saveNow() { try { if (typeof saveData === 'function') saveData(); } catch (e) {} }

  /* 存储门面：优先用应用自己的 activeStore（按联系人分域），没有就退回本模块自己的 localStorage 域 */
  function rpStore() {
    try {
      if (typeof window.activeStore === 'function') {
        var s = window.activeStore();
        if (s && typeof s.get === 'function' && typeof s.set === 'function') return s;
      }
    } catch (e) {}
    return {
      get: function (k) { try { return localStorage.getItem('milk-rp:' + k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem('milk-rp:' + k, v == null ? '' : String(v)); return true; } catch (e) { return false; } },
      remove: function (k) { try { localStorage.removeItem('milk-rp:' + k); return true; } catch (e) { return false; } }
    };
  }

  /* 读数值配置：replyCfg() → 应用落盘键 reply-<key>（activeStore / 裸 localStorage）→ 新版 cs-<key> → 默认值 */
  function cfgNum(key, dflt, legacyKey) {
    var v = NaN;
    try {
      var c = (typeof window.replyCfg === 'function') ? window.replyCfg() : null;
      if (c && c[key] != null && c[key] !== '') v = Number(c[key]);
    } catch (e) {}
    var keys = ['reply-' + key];
    if (legacyKey) keys.push(legacyKey);
    for (var i = 0; i < keys.length && !isFinite(v); i++) {
      try { var raw = rpStore().get(keys[i]); if (raw != null && raw !== '') v = Number(raw); } catch (e) {}
      if (!isFinite(v)) {
        try { var raw2 = localStorage.getItem(keys[i]); if (raw2 != null && raw2 !== '') v = Number(raw2); } catch (e) {}
      }
    }
    if (!isFinite(v)) v = dflt;
    return v;
  }

  function writeCfg(key, val) {
    try { if (typeof window.mochiSetReplyCfg === 'function') { window.mochiSetReplyCfg(key, val); return true; } } catch (e) {}
    try { if (typeof window.saveReplyCfg === 'function') { window.saveReplyCfg(key, val); return true; } } catch (e) {}
    try { return rpStore().set('reply-' + key, val) !== false; } catch (e) { return false; }
  }

  /* ================= 文案来源：只有自定义回复池 ================= */

  function pool() {
    var out = [];
    try {
      if (typeof window.getCustomCards === 'function') {
        var a = window.getCustomCards();
        if (Array.isArray(a)) out = out.concat(a);
      }
    } catch (e) {}
    try {
      if (typeof window.getPool === 'function') {
        var p = window.getPool();
        var t = Array.isArray(p) ? p : (p && Array.isArray(p.text) ? p.text : null);
        if (t) out = out.concat(t);
      }
    } catch (e) {}
    try { if (!out.length && Array.isArray(window._customReplies)) out = out.concat(window._customReplies); } catch (e) {}
    var seen = {}, list = [];
    for (var i = 0; i < out.length; i++) {
      var s = String(out[i] == null ? '' : out[i]).trim();
      if (!s || seen[s]) continue;
      seen[s] = 1; list.push(s);
    }
    return list;
  }

  /* 池为空 → 返回空串（调用方据此保持沉默） */
  function poolPick() {
    var p = pool();
    if (!p.length) return '';
    return String(p[Math.floor(Math.random() * p.length)] || '').trim();
  }

  /* ================= 样式
     面板自身的 .rp-* / .msg-rp-* / .poke-card* 规则已在 css/mochi-chat-core.css（与新版样式文件
     逐字节相同）里；缺的 .set-row 基础样式 / .msg-rp-side 在 css/home-shell.append.css 里补。
     这里只注入「本工程独有」的三处接线样式。 ================= */

  function ensureStyle() {
    try {
      if (document.getElementById('rp-style')) return;
      var st = document.createElement('style');
      st.id = 'rp-style';
      st.textContent = [
        /* 输入栏旁的 🧧 按钮：按用户要求做成「黑白的红包图标 + 灰色圆钮」——
           不再用红包红、也不再跟随主题色；灰底/深灰图标刻意与同一排的
           图片/表情/头像库按钮取同值（实测它们也是 #f0f0f0 底 + #7a7a7a 图标）。 */
        '#redpacket-btn{border-radius:50%;border:none;background:#f0f0f0;',
        'color:#7a7a7a;font-size:16px;line-height:1;flex:0 0 auto;cursor:pointer;padding:0;display:flex;',
        'align-items:center;justify-content:center;box-shadow:none;-webkit-tap-highlight-color:transparent;}',
        '#redpacket-btn:hover{background:#e6e6e6;}',
        '#redpacket-btn svg{width:18px;height:18px;display:block;}',
        '#redpacket-btn:active{transform:scale(.94);}',
        /* 气泡本体让位给 .msg-rp-card（新版红包卡是独立节点，这里把气泡升级成承载位） */
        '.message.rp-card{background:transparent!important;background-color:transparent!important;border:none!important;',
        'box-shadow:none!important;padding:0!important;border-radius:0!important;max-width:82%!important;min-width:0!important;}',
        '.message.rp-card .msg-rp-card{margin:0 auto;}',
        '.message.rp-card .msg-rp-wish{word-break:break-word;}',
        '.rp-set-inp{width:64px;padding:2px 6px;border-radius:8px;border:1px solid rgba(0,0,0,.15);font:inherit;text-align:right;}',
        '.rp-wallet-pick.act{background:#111;color:#fff;border-color:#111;}'
      ].join('');
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  /* ================= 钱包（chat:10599-10630 / 10913-10969）
     新版走 gift-shop 的全局一本账 window.giftWalletGet/Set；本工程没有这两个门面，
     最小等价 = 同名根键 'gift-wallet' 落在本会话 activeStore 里（默认双方各 520 元），
     有 giftWalletGet/Set 时依旧优先委托（将来接上账本即自动接管）。 ================= */

  var RP_WALLET_KEY = 'gift-wallet';
  var RP_LEGACY_WALLET_KEY = 'rp-wallet';
  var RP_WALLET_DEFAULT_FEN = 52000;

  function rpWalletGet() {
    try { if (typeof window.giftWalletGet === 'function') return window.giftWalletGet(); } catch (e) {}
    try {
      var w = JSON.parse(rpStore().get(RP_WALLET_KEY) || '');
      if (w && typeof w.myBalance === 'number' && typeof w.systemBalance === 'number') {
        if (w.myBalance === 99999999 && w.systemBalance === 99999999) {
          var nw = { myBalance: RP_WALLET_DEFAULT_FEN, systemBalance: RP_WALLET_DEFAULT_FEN };
          rpStore().set(RP_WALLET_KEY, JSON.stringify(nw));
          return nw;
        }
        return w;
      }
    } catch (e) {}
    var seed = { myBalance: RP_WALLET_DEFAULT_FEN, systemBalance: RP_WALLET_DEFAULT_FEN };
    try {
      var o = JSON.parse(rpStore().get(RP_LEGACY_WALLET_KEY) || '');
      if (o && typeof o.myBalance === 'number' && typeof o.systemBalance === 'number') seed = { myBalance: o.myBalance, systemBalance: o.systemBalance };
    } catch (e) {}
    rpStore().set(RP_WALLET_KEY, JSON.stringify(seed));
    return seed;
  }

  function rpWalletSet(w) {
    try { if (typeof window.giftWalletSet === 'function') { window.giftWalletSet(w); return; } } catch (e) {}
    rpStore().set(RP_WALLET_KEY, JSON.stringify(w));
  }

  function rpRenderBalance() {
    var el = document.getElementById('rp-balance');
    if (!el) return;
    var w = rpWalletGet();
    el.textContent = '心意币 ¥' + (w.myBalance / 100).toFixed(2) + ' · ' + partnerName() + ' ¥' + (w.systemBalance / 100).toFixed(2) + ' · 向 Mochi 申请心意币';
  }

  /* 通用小弹窗（新版用 window.openModal；本工程从未定义该函数，这是最小等价替代：
     复用应用自己的 .modal/.modal-content/.modal-input 与 showModal/hideModal） */
  function rpModal(title, staticHtml, onOk, opts) {
    opts = opts || {};
    var id = 'rp-modal-' + (opts.key || 'x');
    var m = document.getElementById(id);
    if (!m) {
      m = document.createElement('div');
      m.className = 'modal';
      m.id = id;
      m.style.zIndex = '3000';
      m.innerHTML = '<div class="modal-content">' +
        '<div class="modal-title"><span class="rp-modal-title"></span></div>' +
        '<div class="rp-modal-static" style="font-size:12px;color:var(--text-secondary);line-height:1.6;margin-bottom:10px;white-space:pre-line;"></div>' +
        (opts.noInput ? '' : '<input class="modal-input rp-modal-input" type="number" min="0" step="0.01">') +
        '<div class="rp-modal-pills" style="display:flex;gap:8px;margin-bottom:10px;"></div>' +
        '<div class="modal-buttons">' +
        '<button class="modal-btn modal-btn-secondary rp-modal-cancel" type="button"></button>' +
        '<button class="modal-btn modal-btn-primary rp-modal-ok" type="button"></button>' +
        '</div></div>';
      (document.querySelector('.main-chat-area') || document.body).appendChild(m);
    }
    m.querySelector('.rp-modal-title').textContent = title;
    m.querySelector('.rp-modal-static').textContent = opts.staticText || '';
    m.querySelector('.rp-modal-cancel').textContent = opts.cancelText || '取消';
    m.querySelector('.rp-modal-ok').textContent = opts.okText || '确定';
    var inp = m.querySelector('.rp-modal-input');
    if (inp) {
      inp.placeholder = opts.placeholder || '';
      inp.value = opts.value == null ? '' : String(opts.value);
    }
    var pillsBox = m.querySelector('.rp-modal-pills');
    var pills = opts.pills || [];
    pillsBox.innerHTML = '';
    pillsBox.style.display = pills.length ? 'flex' : 'none';
    var pillsEls = [];
    pills.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'modal-btn modal-btn-secondary rp-wallet-pick' + (p.value === opts.pill ? ' act' : '');
      b.textContent = p.label;
      b.addEventListener('click', function () {
        pillsEls.forEach(function (x) { x.classList.remove('act'); });
        b.classList.add('act');
      });
      pillsBox.appendChild(b);
      pillsEls.push(b);
    });
    var currentPill = function () {
      for (var i = 0; i < pillsEls.length; i++) if (pillsEls[i].classList.contains('act')) return pills[i].value;
      return opts.pill;
    };
    var ctl = {
      stay: function () { keepOpen = true; },
      value: function () { return inp ? inp.value : ''; },
      pill: currentPill,
      text: function (v) { if (inp) inp.value = v == null ? '' : String(v); },
      static: function (v) { m.querySelector('.rp-modal-static').textContent = v == null ? '' : String(v); },
      okText: function (v) { m.querySelector('.rp-modal-ok').textContent = v; }
    };
    var keepOpen = false;
    var okBtn = m.querySelector('.rp-modal-ok');
    var cancelBtn = m.querySelector('.rp-modal-cancel');
    var newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    var newCancel = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    newOk.addEventListener('click', function () {
      keepOpen = false;
      try { onOk(ctl); } catch (e) {}
      if (!keepOpen && typeof window.hideModal === 'function') window.hideModal(m);
    });
    newCancel.addEventListener('click', function () { if (typeof window.hideModal === 'function') window.hideModal(m); });
    if (typeof window.showModal === 'function') window.showModal(m, inp);
    else m.style.display = 'flex';
    return ctl;
  }

  /* 向 Mochi 申请心意币（chat:10921-10969 的流程；入口=余额行） */
  function rpEditWallet() {
    var taName = partnerName();
    var side = 'my';
    var ctl = rpModal('向 Mochi 申请心意币', '', function (c) {
      var picked = c.pill();
      var target = (picked === 'my' || picked === 'ta') ? picked : side;
      var raw = String(c.value() || '').trim();
      if (raw === '') return;               // 留空确定 = 结束本次申请
      var n = parseFloat(raw);
      if (isNaN(n) || n <= 0) { notify('申请金额需大于 0'); return; }
      var fen = Math.round(n * 100);
      var w = rpWalletGet();
      if (target === 'my') w.myBalance += fen;
      else w.systemBalance += fen;
      rpWalletSet(w);
      rpRenderBalance();
      side = (target === 'my') ? 'ta' : 'my';
      c.stay();
      c.text('');
      c.static(walletHint(side, true));
      c.okText('完成');
      notify('Mochi 已打款');
    }, {
      key: 'wallet',
      staticText: walletHint('my', false),
      pills: [{ value: 'my', label: '我的心意币' }, { value: 'ta', label: taName + ' 的心意币' }],
      pill: 'my',
      placeholder: '输入申请金额（元），留空结束',
      okText: '申请'
    });
    function walletHint(s, done) {
      var w = rpWalletGet();
      var head = '当前：心意币 ¥' + (w.myBalance / 100).toFixed(2) + ' · ' + taName + ' ¥' + (w.systemBalance / 100).toFixed(2);
      return head + '\n' + (done
        ? '已到账，可继续为' + (s === 'my' ? '我的心意币' : taName + '的心意币') + '申请；留空点【完成】结束'
        : '选择收款方，输入申请金额点【申请】，Mochi 打款后自动入账；留空点【完成】结束');
    }
    // 首屏提示按当前余额再刷一次（rpModal 里已写过一次）
    if (ctl) ctl.static(walletHint('my', false));
  }

  /* ================= 红包封面（chat:10972-11043）
     新版用 window.mochiFilePick + window.mochiImgCompressTo + idbSet；本工程这三个里
     mochiFilePick / mochiImgCompressTo 从未定义（只有调用点），最小等价 = 自建 input + canvas 缩放。 ================= */

  function rpCoverKey(side) { return 'rp-cover-' + (side || 'out'); }

  function rpCoverGet(side) {
    try { return rpStore().get(rpCoverKey(side)) || ''; } catch (e) { return ''; }
  }

  function rpCoverSet(side, dataUrl) {
    var k = rpCoverKey(side);
    try {
      if (dataUrl) {
        rpStore().set(k, dataUrl);
        if (typeof window.idbSet === 'function') window.idbSet(window.activePrefix() + ':' + k, dataUrl);
      } else {
        try { if (typeof rpStore().remove === 'function') rpStore().remove(k); else rpStore().set(k, ''); } catch (e) {}
        if (typeof window.idbSet === 'function') window.idbSet(window.activePrefix() + ':' + k, '');
      }
    } catch (e) {}
  }

  /* 幂等回填：新版开机从 idb 取回封面（chat:10985 附近的 idbGet 块） */
  function rpCoverHydrate() {
    try {
      if (typeof window.idbGet !== 'function') return;
      ['out', 'in'].forEach(function (side) {
        var myPrefix = window.activePrefix();
        window.idbGet(myPrefix + ':' + rpCoverKey(side)).then(function (v) {
          if (window.activePrefix() !== myPrefix) return;
          if (v && typeof v === 'string' && v.length > 2) rpStore().set(rpCoverKey(side), v);
        }).catch(function () {});
      });
    } catch (e) {}
  }

  function rpRenderCover() {
    try {
      var side = rpSide;
      var cover = rpCoverGet(side);
      var who = side === 'out' ? '我的' : (partnerName() + '的');
      var up = document.getElementById('rp-cover-upload');
      var del = document.getElementById('rp-cover-del');
      var prev = document.getElementById('rp-cover-preview');
      if (up) up.textContent = '上传' + who + '封面';
      if (del) del.textContent = '删除' + who + '封面';
      if (cover) {
        if (prev) {
          prev.style.backgroundImage = 'url("' + cover + '")';
          var sp = prev.querySelector('span'); if (sp) sp.style.display = 'none';
        }
        if (del) del.hidden = false;
      } else {
        if (prev) {
          prev.style.backgroundImage = '';
          var sp2 = prev.querySelector('span');
          if (sp2) { sp2.style.display = ''; sp2.textContent = '未设置' + who + '封面'; }
        }
        if (del) del.hidden = true;
      }
    } catch (e) {}
  }

  /* 最小等价替代 window.mochiImgCompressTo（maxSide 400 / 0.8，与 rpCompressCover 同参） */
  function rpDownscale(dataUrl, maxSide, quality, cb) {
    try {
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var s = Math.min(1, maxSide / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
          var cv = document.createElement('canvas');
          cv.width = cw; cv.height = ch;
          cv.getContext('2d').drawImage(img, 0, 0, cw, ch);
          cb(cv.toDataURL('image/jpeg', quality || 0.8));
        } catch (e) { cb(dataUrl); }
      };
      img.onerror = function () { cb(dataUrl); };
      img.src = dataUrl;
    } catch (e) { cb(dataUrl); }
  }

  /* 最小等价替代 window.mochiFilePick */
  function rpPickImage(cb) {
    try {
      var inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'image/*';
      inp.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;';
      (document.querySelector('.main-chat-area') || document.body).appendChild(inp);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        setTimeout(function () { try { inp.remove(); } catch (e) {} }, 0);
        if (!f) return;
        try {
          if (typeof window.mochiImgCompressTo === 'function') {
            window.mochiImgCompressTo(f, { maxSide: 400, quality: 0.8, tag: 'rp-cover' }).then(function (d) { cb(d); }).catch(function () { cb(null); });
            return;
          }
        } catch (e) {}
        try {
          var fr = new FileReader();
          fr.onload = function () { rpDownscale(String(fr.result || ''), 400, 0.8, cb); };
          fr.onerror = function () { cb(null); };
          fr.readAsDataURL(f);
        } catch (e) { cb(null); }
      });
      inp.click();
    } catch (e) { cb(null); }
  }

  /* ================= 面板标记（template.html:6090-6173 原样；index.html 已有静态标记时直接复用） ================= */

  var PANEL_HTML = [
    '<div class="poke-card-head">',
    '  <span>红包 · <b id="rp-partner-name">TA</b></span>',
    '  <div class="poke-card-head-actions">',

    '    <button class="poke-card-close" id="chat-rp-close">✕</button>',
    '  </div>',
    '</div>',

    '<div class="rp-balance" id="rp-balance"></div>',
    '<div class="poke-card-scroll">',
    '  <div class="rp-cover-row">',
    '    <div class="rp-cover-preview" id="rp-cover-preview"><span>未设置封面</span></div>',
    '    <div class="rp-cover-actions">',
    '      <button class="rp-cover-btn" id="rp-cover-upload" type="button">上传封面</button>',
    '      <button class="rp-cover-btn" id="rp-cover-del" type="button" hidden>删除封面</button>',
    '    </div>',
    '  </div>',
    '  <div class="rp-section" id="rp-qixi-section">',
    '    <div class="rp-section-title">七夕特别红包<span class="rp-qixi-tag" id="rp-qixi-tag">今天七夕</span></div>',
    '    <div class="rp-amounts">',
    '      <button class="rp-amt" data-rpamt="7.77" type="button">¥7.77</button>',
    '      <button class="rp-amt" data-rpamt="77.77" type="button">¥77.77</button>',
    '      <button class="rp-amt" data-rpamt="777.77" type="button">¥777.77</button>',
    '    </div>',
    '  </div>',
    '  <div class="rp-section">',
    '    <div class="rp-section-title">情侣特殊金额</div>',
    '    <div class="rp-amounts">',
    '      <button class="rp-amt" data-rpamt="5.20" type="button">¥5.20</button>',
    '      <button class="rp-amt" data-rpamt="13.14" type="button">¥13.14</button>',
    '      <button class="rp-amt" data-rpamt="52.00" type="button">¥52.00</button>',
    '      <button class="rp-amt" data-rpamt="99.99" type="button">¥99.99</button>',
    '      <button class="rp-amt" data-rpamt="131.40" type="button">¥131.40</button>',
    '      <button class="rp-amt" data-rpamt="520.00" type="button">¥520.00</button>',
    '    </div>',
    '  </div>',
    '  <div class="rp-section">',
    '    <div class="rp-section-title">随机幸运金额</div>',
    '    <div class="rp-amounts">',
    '      <button class="rp-amt rp-rand" data-rpamt="rand" type="button">摇一个随机金额</button>',
    '    </div>',
    '    <div class="rp-rand-val" id="rp-rand-val"></div>',
    '  </div>',
    '  <div class="rp-section">',
    '    <div class="rp-section-title">自定义金额</div>',
    '    <input class="rp-input" id="rp-custom" type="number" min="0" step="0.01" placeholder="输入金额">',
    '  </div>',
    '  <div class="rp-section">',
    '    <div class="rp-section-title">留言</div>',
    '    <input class="rp-input" id="rp-wish" type="text" placeholder="" maxlength="20">',
    '  </div>',
    '  <button class="rp-send" id="rp-send-btn" type="button">发送红包</button>',
    '</div>'
  ].join('\n');

  function panelEl() { return document.getElementById('chat-rp-panel'); }

  function ensurePanel() {
    var p = panelEl();
    if (p) { bindPanel(p); return p; }
    try {
      p = document.createElement('div');
      p.className = 'poke-card';
      p.id = 'chat-rp-panel';
      p.hidden = true;
      p.innerHTML = PANEL_HTML;
      // 放进聊天页容器：.main-chat-area 是 position:relative（styles.css:921）／进聊天页后由
      // home-shell.js:83 写成 position:fixed，正好当 .poke-card 的绝对定位参照；面板 z-index:70
      // 高于输入栏 50，不会被输入栏盖住。
      (document.querySelector('.main-chat-area') || document.body).appendChild(p);
      bindPanel(p);
      return p;
    } catch (e) { return null; }
  }

  function panelScroll() { var p = panelEl(); return p ? p.querySelector('.poke-card-scroll') : null; }

  /* ================= 设置区（chat:10548-10560 + 新版 chat-settings.js 的五行同源同步） ================= */

  function openRpSettings() {
    var p = panelEl(); if (!p) return;
    var s = document.getElementById('rp-settings'); if (!s) return;
    var bal = document.getElementById('rp-balance'); if (bal) bal.hidden = true;
    var sc = panelScroll(); if (sc) sc.hidden = true;
    syncSettings();
    s.hidden = false;
  }

  function closeRpSettings() {
    var s = document.getElementById('rp-settings'); if (!s) return;
    s.hidden = true;
    var bal = document.getElementById('rp-balance'); if (bal) bal.hidden = false;
    var sc = panelScroll(); if (sc) sc.hidden = false;
  }

  function syncSettings() {
    try {
      var pv = document.getElementById('rp-ta-prob-val');
      if (pv) pv.textContent = String(Math.round(cfgNum('rp-ta-prob', 20, 'cs-rp-auto-prob'))) + '%';
      var cv = document.getElementById('rp-ta-cap-val');
      if (cv) { var c = Math.round(cfgNum('rp-ta-cap', 2, 'cs-rp-daily-max')); cv.textContent = c > 0 ? (c + ' 次') : '不限'; }
      var ap = document.getElementById('rp-ask-prob-val');
      if (ap) ap.textContent = String(Math.round(cfgNum('rp-ask-prob', 4, 'cs-rp-ask-prob'))) + '%';
      var ac = document.getElementById('rp-ask-cap-val');
      if (ac) { var a = Math.round(cfgNum('rp-ask-cap', 0, 'cs-rp-ask-daily-max')); ac.textContent = a > 0 ? (a + ' 次') : '不限'; }
    } catch (e) {}
  }

  /* 设置行：点一下就地变输入框，回车/失焦即写盘（写 reply-rp-*，与回复设置页同键同域） */
  function bindSettingRow(rowId, key, dflt, min, max, legacyKey, fmt) {
    var row = document.getElementById(rowId);
    if (!row || row.__rpBound) return;
    row.__rpBound = true;
    row.style.cursor = 'pointer';
    row.addEventListener('click', function (e) {
      e.stopPropagation();
      if (row.__rpEditing) return;
      var valEl = row.querySelector('.val');
      if (!valEl) return;
      row.__rpEditing = true;
      valEl.innerHTML = '';
      var inp = document.createElement('input');
      inp.type = 'number'; inp.min = String(min); inp.max = String(max); inp.step = '1';
      inp.className = 'rp-set-inp';
      inp.value = String(Math.round(cfgNum(key, dflt, legacyKey)));
      valEl.appendChild(inp);
      try { inp.focus(); if (inp.select) inp.select(); } catch (er) {}
      var done = false;
      var finish = function (save) {
        if (done) return; done = true; row.__rpEditing = false;
        var v = Number(inp.value);
        if (save && isFinite(v)) writeCfg(key, Math.max(min, Math.min(max, Math.round(v))));
        valEl.textContent = fmt(Math.round(cfgNum(key, dflt, legacyKey)));
      };
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        else if (ev.key === 'Escape') finish(false);
      });
      inp.addEventListener('blur', function () { finish(true); });
      inp.addEventListener('click', function (ev) { ev.stopPropagation(); });
    });
  }

  function bindPanel(p) {
    if (!p || p.__rpBound) return;
    p.__rpBound = true;
    try { ensureStyle(); } catch (e) {}

    var closeBtn = document.getElementById('chat-rp-close');
    if (closeBtn) closeBtn.addEventListener('click', function (e) { e.stopPropagation(); closeRpPanel(); });

    var setBtn = document.getElementById('rp-settings-btn');
    if (setBtn) setBtn.addEventListener('click', function (e) { e.stopPropagation(); openRpSettings(); });

    var setDone = document.getElementById('rp-settings-done');
    if (setDone) setDone.addEventListener('click', function (e) { e.stopPropagation(); closeRpSettings(); });

    // 我发红包 / TA发红包（chat:10563-10571）
    Array.prototype.forEach.call(p.querySelectorAll('.rp-side'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        rpSide = btn.dataset.rpside || 'out';
        Array.prototype.forEach.call(p.querySelectorAll('.rp-side'), function (b) { b.classList.toggle('sel', b === btn); });
        rpRenderCover();
      });
    });

    // 金额按钮 + 随机摇（chat:10572-10591）
    Array.prototype.forEach.call(p.querySelectorAll('.rp-amt'), function (btn) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        var v = btn.dataset.rpamt;
        var randVal = document.getElementById('rp-rand-val');
        var custom = document.getElementById('rp-custom');
        if (v === 'rand') {
          var r = Math.round(Math.random() * 20000 + 1) / 100;
          rpPickedAmt = r;
          if (randVal) randVal.textContent = '本次随机：¥' + r.toFixed(2);
          if (custom) custom.value = '';
          Array.prototype.forEach.call(p.querySelectorAll('.rp-amt'), function (b) { b.classList.remove('sel'); });
          btn.classList.add('sel');
          return;
        }
        rpPickedAmt = parseFloat(v);
        if (randVal) randVal.textContent = '';
        if (custom) custom.value = '';
        Array.prototype.forEach.call(p.querySelectorAll('.rp-amt'), function (b) { b.classList.remove('sel'); });
        btn.classList.add('sel');
      });
    });

    // 手动输入金额 → 清掉预设选中（chat:10592-10597）
    var customInp = document.getElementById('rp-custom');
    if (customInp) {
      customInp.addEventListener('input', function () {
        Array.prototype.forEach.call(p.querySelectorAll('.rp-amt'), function (b) { b.classList.remove('sel'); });
        var randVal = document.getElementById('rp-rand-val');
        if (randVal) randVal.textContent = '';
      });
    }

    var sendBtn = document.getElementById('rp-send-btn');
    if (sendBtn) sendBtn.addEventListener('click', function (e) { e.stopPropagation(); sendRedpacket(); });

    // 余额行 → 向 Mochi 申请心意币（chat:10970-10971）
    var bal = document.getElementById('rp-balance');
    if (bal) bal.addEventListener('click', function (e) { e.stopPropagation(); rpEditWallet(); });

    // 封面（chat:11014-11043）
    var up = document.getElementById('rp-cover-upload');
    if (up) up.addEventListener('click', function (e) {
      e.stopPropagation();
      rpPickImage(function (data) {
        if (!data) { notify('没有取到图片，请再选一次'); return; }
        rpCoverSet(rpSide, data);
        rpRenderCover();
        notify('封面已设置');
      });
    });
    var del = document.getElementById('rp-cover-del');
    if (del) del.addEventListener('click', function (e) {
      e.stopPropagation();
      rpCoverSet(rpSide, '');
      rpRenderCover();
      notify('已恢复默认封面');
    });

    bindSettingRow('rp-set-prob', 'rp-ta-prob', 20, 0, 100, 'cs-rp-auto-prob', function (v) { return v + '%'; });
    bindSettingRow('rp-set-cap', 'rp-ta-cap', 2, 0, 99, 'cs-rp-daily-max', function (v) { return v > 0 ? (v + ' 次') : '不限'; });
    bindSettingRow('rp-set-ask-prob', 'rp-ask-prob', 4, 0, 100, 'cs-rp-ask-prob', function (v) { return v + '%'; });
    bindSettingRow('rp-set-ask-cap', 'rp-ask-cap', 0, 0, 99, 'cs-rp-ask-daily-max', function (v) { return v > 0 ? (v + ' 次') : '不限'; });
  }

  /* ================= 打开 / 关闭（chat:10511-10545） ================= */

  function openRpPanel() {
    var p = ensurePanel();
    if (!p) return false;

    // 沿用新版 openRpPanel 的互斥收口：先关掉可能开着的其它半框
    ['poke-card', 'emoji-panel', 'chat-search', 'chat-divine-panel', 'chat-decision-panel',
      'chat-rps-panel', 'chat-call-panel', 'avlib-card'].forEach(function (id) {
      try { var el = document.getElementById(id); if (el) el.hidden = true; } catch (e) {}
    });

    try {
      var nameEl = document.getElementById('rp-partner-name');
      if (nameEl) nameEl.textContent = partnerName();
      var qixiTag = document.getElementById('rp-qixi-tag');
      var qixiSection = document.getElementById('rp-qixi-section');
      // 只切显示，不写任何内置祝福语（#rp-wish 始终留空，placeholder 也是空的）
      if (isQixiToday()) {
        if (qixiTag) qixiTag.hidden = false;
        if (qixiSection) { qixiSection.hidden = false; qixiSection.classList.add('qixi-today'); }
      } else {
        if (qixiTag) qixiTag.hidden = true;
        if (qixiSection) { qixiSection.hidden = true; qixiSection.classList.remove('qixi-today'); }
      }

      rpSide = 'out';
      rpPickedAmt = null;
      var custom = document.getElementById('rp-custom'); if (custom) custom.value = '';
      var wish = document.getElementById('rp-wish'); if (wish) wish.value = '';
      var randVal = document.getElementById('rp-rand-val'); if (randVal) randVal.textContent = '';
      Array.prototype.forEach.call(p.querySelectorAll('.rp-side'), function (b) {
        b.classList.toggle('sel', b.dataset.rpside === 'out');
      });
      Array.prototype.forEach.call(p.querySelectorAll('.rp-amt'), function (b) { b.classList.remove('sel'); });
      closeRpSettings();
      syncSettings();
      rpRenderBalance();
      rpRenderCover();
      rpExpireCheck();
      refreshCards();
      p.hidden = false;
    } catch (e) { p.hidden = false; }
    return true;
  }

  function closeRpPanel() { var p = panelEl(); if (p) p.hidden = true; closeRpSettings(); }

  /* ================= 状态流转（chat:10667-10701 / 11076 区段 / 10630） ================= */

  var RP_EXPIRY_MS = 24 * 60 * 60 * 1000;

  function rpStatusText(rec) {
    var st = rec && rec.rpStatus || 'pending';
    if (st === 'received') return '已领取';
    if (st === 'expired') return '已过期·退回';
    if (st === 'returned') return '已退回';
    return (rec && rec.side === 'out') ? '待TA领取' : '待领取';
  }

  function rpStatusCls(rec) {
    var st = rec && rec.rpStatus || 'pending';
    if (st === 'received') return 'opened';
    if (st === 'expired' || st === 'returned') return 'expired';
    return '';
  }

  function msgs() {
    try { return (typeof window.getChatMsgs === 'function') ? (window.getChatMsgs() || []) : []; } catch (e) { return []; }
  }

  /* 按卡面文本找回那条真消息（标记文本唯一） */
  function findRec(text) {
    if (!text) return null;
    var list = msgs();
    for (var i = list.length - 1; i >= 0; i--) {
      var m = list[i];
      if (m && m.special === 'redpacket' && String(m.text == null ? '' : m.text) === text) return m;
    }
    return null;
  }

  function setStatus(text, status) {
    var m = findRec(text);
    if (!m) return false;
    m.rpStatus = status;
    if (status === 'received') m.rpOpenedAt = Date.now();
    if (status === 'expired' || status === 'returned') m.rpClosedAt = Date.now();
    saveNow();
    return true;
  }

  /* 卡面就地更新（对应新版 rpPatchStatusInPlace：不整窗重渲染＝不闪屏） */
  function refreshCards() {
    var n = 0;
    try {
      var root = chatRoot();
      if (!root) return 0;
      var cards = root.querySelectorAll('.message.rp-card');
      for (var i = 0; i < cards.length; i++) {
        var b = cards[i];
        var text = b.getAttribute('data-rp-text') || '';
        var ta = b.classList.contains('rp-ta');
        var rec = findRec(text) || { rpStatus: 'pending', side: ta ? 'in' : 'out' };
        var card = b.querySelector('.msg-rp-card');
        if (!card) continue;
        card.classList.remove('opened', 'expired');
        var cls = rpStatusCls(rec);
        if (cls) card.classList.add(cls);
        var st = card.querySelector('.msg-rp-status');
        if (st) st.textContent = rpStatusText(rec);
        n++;
      }
    } catch (e) {}
    return n;
  }

  /* 24h 到期退回（chat:10900-10912） */
  function rpExpireCheck() {
    try {
      var now = Date.now();
      var wallet = null;
      var changed = false;
      var list = msgs();
      for (var i = 0; i < list.length; i++) {
        var rec = list[i];
        if (rec && rec.special === 'redpacket' && (rec.rpStatus || 'pending') === 'pending' && rec.rpTs) {
          if (now - Number(rec.rpTs) > RP_EXPIRY_MS) {
            rec.rpStatus = 'expired';
            rec.rpClosedAt = now;
            if (!wallet) wallet = rpWalletGet();
            var fen = Math.round((rec.rpAmount || 0) * 100);
            if (rec.side === 'out') wallet.myBalance += fen; else wallet.systemBalance += fen;
            changed = true;
          }
        }
      }
      if (changed && wallet) { rpWalletSet(wallet); saveNow(); refreshCards(); rpRenderBalance(); }
    } catch (e) {}
  }

  /* 我发出的红包被 TA 领取/退回（新版 handleSendResponse；概率 20% 退回 / 70% 领取 / 10% 挂着） */
  function handleSendResponse(text) {
    try {
      var rec = findRec(text);
      if (!rec || (rec.rpStatus || 'pending') !== 'pending') return;
      var r = Math.random();
      var wallet = rpWalletGet();
      var fen = Math.round((rec.rpAmount || 0) * 100);
      if (r < 0.2) {
        rec.rpStatus = 'returned';
        wallet.myBalance += fen;
        rpWalletSet(wallet);
        saveNow(); refreshCards(); rpRenderBalance();
        notify(partnerName() + ' 退回了红包');
      } else if (r < 0.9) {
        rec.rpStatus = 'received';
        rec.rpOpenedAt = Date.now();
        wallet.systemBalance += fen;
        rpWalletSet(wallet);
        saveNow(); refreshCards(); rpRenderBalance();
        // 新版此处走 rpCollectFeedback('out') 的系统预设话术池；本工程改成自定义回复池（等价替代）
        scheduleTaReply();
      }
    } catch (e) {}
  }

  /* 8% 概率补领一条挂着待领的我方红包（新版 tryCollectPending） */
  function tryCollectPending() {
    try {
      if (Math.random() >= 0.08) return;
      var list = msgs();
      for (var i = 0; i < list.length; i++) {
        var rec = list[i];
        if (rec && rec.special === 'redpacket' && rec.side === 'out' && (rec.rpStatus || 'pending') === 'pending') {
          rec.rpStatus = 'received';
          rec.rpOpenedAt = Date.now();
          var wallet = rpWalletGet();
          wallet.systemBalance += Math.round((rec.rpAmount || 0) * 100);
          rpWalletSet(wallet);
          saveNow(); refreshCards(); rpRenderBalance();
          return;
        }
      }
    } catch (e) {}
  }

  /* ================= 发红包（chat:11044-11070） ================= */

  function inputEl() {
    return document.querySelector('.input-area-wrapper textarea')
      || document.querySelector('.input-area-wrapper [contenteditable="true"]')
      || document.getElementById('message-input');
  }

  function packetText(ta, amt, wish) {
    // 「🧧红包 8.88 元 ｜ 留言」——标记 + 金额，保证刷新后还能被 beautify() 认回来
    return (ta ? TA_MARK : MARK) + ' ' + Number(amt).toFixed(2) + ' 元' + (wish ? ' ｜ ' + wish : '');
  }

  function sendRedpacket() {
    var amt = rpPickedAmt;
    var custom = document.getElementById('rp-custom');
    if (custom && custom.value) {
      var cv = parseFloat(custom.value);
      if (!isNaN(cv) && cv >= 0) amt = Math.round(cv * 100) / 100;
    }
    if (amt == null || isNaN(amt) || amt < 0) { notify('先选择或输入红包金额'); return; }
    amt = Math.round(amt * 100) / 100;

    var wishInp = document.getElementById('rp-wish');
    var wish = (wishInp && wishInp.value || '').trim();
    var ta = (rpSide === 'in');
    // 对方侧的文字一律只从自定义回复池取；池为空就随红包一起保持沉默
    if (ta) wish = poolPick();
    var text = packetText(ta, amt, wish);

    // 记账（新版可透支为负，不拦截）
    try {
      var wallet = rpWalletGet();
      if (ta) wallet.systemBalance -= Math.round(amt * 100);
      else wallet.myBalance -= Math.round(amt * 100);
      rpWalletSet(wallet);
      rpRenderBalance();
    } catch (e) {}

    closeRpPanel();

    if (ta) {
      // TA 发的红包：优先写成真实消息（持久化），随后再美化
      if (!taMessage(text)) { notify('红包没发出去'); return; }
      setTimeout(function () { beautify(); rememberMeta(text, 'in', amt, wish); }, 80);
    } else {
      // 我发的红包：走应用自己的输入栏 → #send-btn，由应用落库并渲染气泡
      var input = inputEl();
      var send = document.getElementById('send-btn');
      if (!input || !send) { notify('找不到输入框，红包没发出去'); return; }
      if ('value' in input) input.value = text; else input.textContent = text;
      try { input.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
      setTimeout(function () {
        try { send.click(); } catch (e) {}
        setTimeout(function () {
          beautify();
          rememberMeta(text, 'out', amt, wish);
          // 新版：addRec 之后 setTimeout(handleSendResponse, randInt(3000,8000))
          setTimeout(function () { handleSendResponse(text); }, randInt(3000, 8000));
        }, 120);
      }, 60);
    }
  }

  /* 对方领了红包后捎一句话：文案只在自定义回复池里取，取不到就不说 */
  function scheduleTaReply() {
    setTimeout(function () {
      var line = poolPick();
      if (!line) return;
      taMessage(line);
    }, 2200);
  }

  /* 以对方身份发一条消息：优先 window.mochiAddTaMessage（core.js 的真实消息写入口，会持久化），
     没有才回退到自造 DOM 气泡（不持久化） */
  function taMessage(text) {
    try {
      if (typeof window.mochiAddTaMessage === 'function') {
        var r = window.mochiAddTaMessage(text);
        if (r !== false) return true;
      }
    } catch (e) {}
    return domBubble(text);
  }

  function domBubble(text) {
    try {
      var box = chatRoot();
      if (!box) return false;
      var w = document.createElement('div');
      w.className = 'message-wrapper received';
      w.setAttribute('data-rp-dom', '1');
      var cw = document.createElement('div');
      cw.className = 'message-content-wrapper';
      var b = document.createElement('div');
      b.className = 'message message-received';
      b.textContent = String(text == null ? '' : text);
      cw.appendChild(b);
      w.appendChild(cw);
      box.appendChild(w);
      try {
        var area = document.querySelector('.main-chat-area');
        if (area) area.scrollTop = area.scrollHeight;
      } catch (e) {}
      return true;
    } catch (e) { return false; }
  }

  /* ================= 气泡 → 红包卡（chat:6115-6144） ================= */

  function cardHTML(info) {
    var svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9c3 2 6 3 9 3s6-1 9-3"/><circle cx="12" cy="9" r="1.4"/></svg>';
    var rec = findRec(info.text) || { rpStatus: 'pending', side: info.ta ? 'in' : 'out' };
    var cls = rpStatusCls(rec);
    var h = '<div class="msg-rp-card' + (cls ? ' ' + cls : '') + '">' +
      '<div class="msg-rp-top"><span class="msg-rp-ico">' + svg + '</span><span class="msg-rp-label">红包</span></div>' +
      '<div class="msg-rp-amt">¥' + Number(info.amt || 0).toFixed(2) + '</div>';
    if (info.wish) h += '<div class="msg-rp-wish">' + esc(info.wish) + '</div>';
    h += '<div class="msg-rp-foot">' +
      '<span class="msg-rp-side">' + esc(info.ta ? partnerName() : '我') + ' 发出</span>' +
      '<span class="msg-rp-status">' + esc(rpStatusText(rec)) + '</span>' +
      '</div></div>';
    return h;
  }

  function decorate(wrapper, info) {
    try {
      var bubble = wrapper.querySelector('.message');
      if (!bubble) return false;
      bubble.classList.add('rp-card');
      if (info.ta) bubble.classList.add('rp-ta');
      bubble.setAttribute('data-rp-amt', String(info.amt));
      bubble.setAttribute('data-rp-text', String(info.text || ''));
      bubble.innerHTML = cardHTML(info);
      wrapper.setAttribute('data-rp-card', '1');
      wrapper.setAttribute('data-rp-side', info.ta ? 'in' : 'out');
      bindCardGestures(bubble, info);
      return true;
    } catch (e) { return false; }
  }

  /* 点：领取（TA 的）/ 等待（我的）；长按：退回（我的，仅 pending）—— chat:11076 区段 */
  function bindCardGestures(bubble, info) {
    var pressTimer = null, suppress = false;
    bubble.addEventListener('click', function () {
      if (suppress) { suppress = false; return; }
      onCardClick(bubble, info);
    });
    bubble.addEventListener('pointerdown', function () {
      if (info.ta) return;
      var rec = findRec(info.text);
      if (!rec || (rec.rpStatus || 'pending') !== 'pending') return;
      if (pressTimer) clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        pressTimer = null; suppress = true;
        rpModal('退回这个红包？', '', function () {
          var r = findRec(info.text);
          if (!r || (r.rpStatus || 'pending') !== 'pending') return;
          r.rpStatus = 'returned';
          r.rpClosedAt = Date.now();
          var wallet = rpWalletGet();
          wallet.myBalance += Math.round((r.rpAmount || 0) * 100);
          rpWalletSet(wallet);
          saveNow(); refreshCards(); rpRenderBalance();
          notify('已退回红包');
        }, { key: 'return', okText: '退回', cancelText: '取消', noInput: true });
        setTimeout(function () { suppress = false; }, 700);
      }, 500);
    });
    var clear = function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
    bubble.addEventListener('pointerup', clear);
    bubble.addEventListener('pointercancel', clear);
    bubble.addEventListener('pointerleave', clear);
  }

  function onCardClick(bubble, info) {
    try {
      var rec = findRec(info.text) || { rpStatus: 'pending', side: info.ta ? 'in' : 'out' };
      var st = rec.rpStatus || 'pending';
      if (st !== 'pending') { notify(rpStatusText(rec)); return; }
      if (!info.ta) { notify('等待 ' + partnerName() + ' 领取'); return; }
      // 我领 TA 的红包
      rec.rpStatus = 'received';
      rec.rpOpenedAt = Date.now();
      var wallet = rpWalletGet();
      wallet.myBalance += Math.round((rec.rpAmount || 0) * 100);
      rpWalletSet(wallet);
      saveNow(); refreshCards(); rpRenderBalance();
      notify('已拆开红包');
      // 新版此处 addIn('你领取了红包（心意币 ¥x）')；本工程不引入内置金额回执（见交付清单）
    } catch (e) {}
  }

  /* 周期性再美化：重渲染 / 刷新后，带标记的普通气泡自动恢复成红包卡 + 状态回填 */
  function beautify() {
    var n = 0;
    try {
      var root = chatRoot();
      if (!root) return 0;
      var ws = root.querySelectorAll('.message-wrapper');
      for (var i = 0; i < ws.length; i++) {
        var w = ws[i];
        var bubble = w.querySelector('.message');
        if (!bubble || bubble.classList.contains('rp-card')) continue;
        var raw = String(bubble.textContent || '').trim();
        var m = RP_RE.exec(raw);
        if (!m) continue;
        var amt = parseFloat(m[2]);
        if (!isFinite(amt)) continue;
        var wish = (m[3] || '').trim();
        var ta = !!m[1];
        if (decorate(w, { amt: amt, wish: wish, ta: ta, text: raw })) {
          rememberMeta(raw, ta ? 'in' : 'out', amt, wish);
          n++;
        }
      }
      refreshCards();
    } catch (e) {}
    return n;
  }

  /* ================= 真消息上的红包字段
     （主页「红包记录」读的就是这组：side / rpAmount / rpWish / rpStatus / rpTs，见 home-feed.js:456-479） ================= */

  function rememberMeta(text, side, amt, wish) {
    try {
      var list = msgs();
      if (!list.length || !text) return false;
      for (var i = list.length - 1; i >= 0; i--) {
        var m = list[i];
        if (!m || m.special === 'redpacket') continue;
        var t = String(m.text == null ? '' : m.text);
        if (!t || (t !== text && t.indexOf(text) !== 0)) continue;
        m.special = 'redpacket';
        m.side = side;
        m.rpAmount = Number(amt) || 0;
        m.rpWish = wish || '';
        m.rpStatus = m.rpStatus || 'pending';
        m.rpTs = Number(new Date(m.timestamp)) || Date.now();
        saveNow();
        return true;
      }
    } catch (e) {}
    return false;
  }

  /* ================= 金额分布（chat:10631 / 10655-10666） ================= */

  var RP_SPECIAL_FEN = [520, 5200, 52000, 520000, 1314, 131400]; // 5.2/52/520/5200/13.14/1314 元

  function genRpAmount(systemBalanceFen) {
    var amt;
    if (Math.random() < 0.4) {
      amt = RP_SPECIAL_FEN[Math.floor(Math.random() * RP_SPECIAL_FEN.length)];
    } else if (Math.random() < 0.8) {
      var max = Math.min(5200000, systemBalanceFen); // 52000 元 = 5200000 分
      amt = Math.floor(Math.random() * max) + 1;
    } else {
      amt = Math.floor(Math.random() * systemBalanceFen) + 1;
    }
    return Math.min(amt, systemBalanceFen);
  }

  /* ================= 对方主动发红包（chat:10702-10747） ================= */

  function rpLocalDay() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }
  function dailyGet(prefix) {
    try { var v = Number(rpStore().get(prefix + rpLocalDay())); return isFinite(v) ? v : 0; } catch (e) { return 0; }
  }
  function dailyIncr(prefix) {
    try { rpStore().set(prefix + rpLocalDay(), String(dailyGet(prefix) + 1)); } catch (e) {}
  }

  /* 概率/上限：replyCfg()['rp-ta-prob']（默认 20%）/ ['rp-ta-cap']（默认 2，0=不限） */
  function taSend(force) {
    try {
      var prob = Math.max(0, Math.min(100, cfgNum('rp-ta-prob', 20, 'cs-rp-auto-prob')));
      var cap = Math.max(0, Math.round(cfgNum('rp-ta-cap', 2, 'cs-rp-daily-max')));
      if (!force) {
        if (typeof window.nightModeActive === 'function' && window.nightModeActive()) return 'night';
        if (cap > 0 && dailyGet('rp-ta-daily-') >= cap) return 'cap';
        if (!(Math.random() * 100 < prob)) return 'miss';
      }
      // 新版此处从钱包扣 systemBalance 且不受余额约束（可透支为负，金额上限 ¥52000 档）
      var wallet = rpWalletGet();
      var amtFen = genRpAmount(Math.max(1, wallet.systemBalance > 0 ? wallet.systemBalance : 5200000));
      if (amtFen < 1) return 'error';
      var amt = Math.round(amtFen) / 100;
      wallet.systemBalance -= amtFen;
      rpWalletSet(wallet);
      dailyIncr('rp-ta-daily-');
      var wish = poolPick();                       // 池为空 → 一个字都不说
      var text = packetText(true, amt, wish);
      if (!taMessage(text)) return 'error';
      setTimeout(function () { beautify(); rememberMeta(text, 'in', amt, wish); }, 80);
      notify('收到一个红包 🧧');
      rpRenderBalance();
      return 'sent';
    } catch (e) { return 'error'; }
  }

  /* TA 向 Mochi 申请心意币（chat:10763-10809）。
     注意：新版会给它一条 special:'askcoin' 的聊天卡（core.js 的渲染分支），本工程的 messages 渲染器
     没有该分支；自动开火还会往聊天里写内置金额文案，与「除自定义回复外零内置文案」冲突，
     故只导出能力、不自动调度（详见交付清单）。 */
  function askCoin(force) {
    try {
      var prob = Math.max(0, Math.min(100, cfgNum('rp-ask-prob', 4, 'cs-rp-ask-prob')));
      var cap = Math.max(0, Math.round(cfgNum('rp-ask-cap', 0, 'cs-rp-ask-daily-max')));
      if (!force) {
        if (cap > 0 && dailyGet('rp-ask-daily-') >= cap) return 'cap';
        if (!(Math.random() * 100 < prob)) return 'miss';
      }
      var amtFen = genRpAmount(5200000);
      if (amtFen < 1) return 'error';
      dailyIncr('rp-ask-daily-');
      var wallet = rpWalletGet();
      wallet.systemBalance += amtFen;
      rpWalletSet(wallet);
      rpRenderBalance();
      return 'sent';
    } catch (e) { return 'error'; }
  }

  /* 轻量自调度：后台(document.hidden)不触发，回到前台后下一轮照常 */
  function scheduleTa() {
    var wait = TA_TIMER_BASE + Math.floor((Math.random() - 0.5) * 60000);
    if (wait < 20000) wait = 20000;
    setTimeout(function () {
      try {
        if (!document.hidden) {
          taSend(false);
          tryCollectPending();
          rpExpireCheck();
        }
      } catch (e) {}
      scheduleTa();
    }, wait);
  }

  /* ================= 输入栏 🧧 按钮（紧挨 #send-btn，落在 .input-area-wrapper 里） ================= */

  function ensureButton() {
    try {
      var send = document.getElementById('send-btn');
      var input = document.getElementById('message-input');   // 用户要求 2026-10-06：红包按钮放到**输入框左边**
      var bar = document.querySelector('.input-area-wrapper');
      if (!send && !bar && !input) return false;
      // 优先挂在输入框所在的 .input-area 里、插到输入框之前；拿不到输入框才退回旧位置（发送键前）
      var host = (input && input.parentElement) || (send && send.parentElement) || bar;
      if (!host) return false;
      var btn = document.getElementById('redpacket-btn');
      if (btn && btn.parentElement === host && ((input && btn.nextElementSibling === input) || (!input && btn.nextElementSibling === send))) return true;
      if (!btn) {
        ensureStyle();
        btn = document.createElement('button');
        btn.id = 'redpacket-btn';
        btn.type = 'button';
        /* 与同一排的图片/表情/头像库按钮同款类：尺寸与悬停/按下交互都跟着它们走（用户要求 2026-10-05） */
        btn.className = 'input-btn collapse-hideable';
        btn.title = '发红包';
        btn.setAttribute('aria-label', '发红包');
        /* 黑白红包图标（与聊天卡片 .msg-rp-card 里那枚描边图标同款，用 currentColor 取灰色） */
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
          'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
          '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9c3 2 6 3 9 3s6-1 9-3"/>' +
          '<circle cx="12" cy="9" r="1.4"/></svg>';
        btn.addEventListener('click', function (e) {
          try { e.preventDefault(); e.stopPropagation(); } catch (er) {}
          openRpPanel();
        });
      }
      host.insertBefore(btn, input || send || null);
      return true;
    } catch (e) { return false; }
  }

  /* ================= 启动 ================= */

  function boot() {
    ensureStyle();
    ensurePanel();
    ensureButton();
    rpCoverHydrate();
    rpRenderBalance();
    // 输入栏可能被应用重渲染 → 周期性自愈；面板被移除时一并重建
    setInterval(function () {
      try { ensurePanel(); ensureButton(); } catch (e) {}
    }, BUTTON_MS);
    // 刷新 / 重渲染后把带标记的普通气泡重新美化，并回填最新状态
    setInterval(function () { try { beautify(); } catch (e) {} }, BEAUTIFY_MS);
    setTimeout(function () { try { beautify(); rpExpireCheck(); } catch (e) {} }, 1500);
    scheduleTa();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(boot, 600); });
  else setTimeout(boot, 600);

  window.openRpPanel = openRpPanel;
  window.closeRpPanel = closeRpPanel;
  window.MochiRedpacket = {
    open: openRpPanel,
    close: closeRpPanel,
    taSend: taSend,
    askCoin: askCoin,
    beautify: beautify,
    refreshCards: refreshCards,
    expireCheck: rpExpireCheck,
    ensureButton: ensureButton,
    wallet: { get: rpWalletGet, set: rpWalletSet, render: rpRenderBalance },
    cover: { get: rpCoverGet, set: rpCoverSet, render: rpRenderCover },
    mark: MARK,
    taMark: TA_MARK
  };
})();
