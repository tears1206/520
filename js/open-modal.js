/* 应用内通用弹窗 window.openModal（新版门面）
 *
 * 背景：本工程此前**从未定义** window.openModal，于是
 *   · 「新建/重命名/删除分组」（mochi-compat.js 的 window.cardGroups）只能退回浏览器原生
 *     prompt()/confirm() —— 原生框由浏览器画在**屏幕正中**、风格不符；
 *   · 头像与昵称库的「换头像 / 换昵称邀请」弹窗（avlib.js 的 showMeAvatarInvite /
 *     showMeNickInvite，用户要求：随机更换时有概率弹出申请、由用户选择同意/拒绝）**永远弹不出来**。
 *
 * 这里按应用自己的配色做一张「贴底半框」卡片，并完整支持调用方既有用法：
 *   window.openModal(title, defaultValue, cb, opts)
 *     opts: { noInput, staticText, okText, cancelText, key, inputType, placeholder,
 *             lock,          // 锁定：点遮罩 / Esc / 取消都不关闭，必须点胶囊或确定
 *             pills, pill }  // 选项胶囊（如「同意 / 拒绝」）：点击即确认，pill = 默认选中值
 *   回调 cb(value)：输入型取输入框文本；noInput 型取所选胶囊的 value（无胶囊则 true）；
 *   回调里调用 ctl.stay() 可阻止关闭（校验不通过时留在弹窗里）。
 *   返回控制对象：{ el, input, static(t), hint(t), pills(list, cur), pick(v), stay(), close() }
 *
 * 静态区固定 id="modal-static"：新版模块（avlib 等）会往它里面追加预览图 / 预览昵称。
 * 组件的错误不抛给调用方（内部 try/catch）。
 */
(function () {
  'use strict';
  var current = null;

  function ensureStyle() {
    try {
      if (document.getElementById('app-open-modal-style')) return;
      var st = document.createElement('style');
      st.id = 'app-open-modal-style';
      st.textContent = [
        // 用户要求 2026-10-05：小框弹在**屏幕正中央**（原来贴底）。align-items:center + 卡片 margin:auto 保证横竖都居中。
        '.app-open-modal{position:fixed;left:0;right:0;top:0;bottom:0;z-index:3000;display:flex;align-items:center;justify-content:center;background:transparent;}',
        '.app-open-modal .aom-card{pointer-events:auto;width:min(360px,92vw);margin:0 10px;max-height:86vh;overflow-y:auto;',
        'background:var(--secondary-bg,#fff);color:var(--text-primary);border:1px solid var(--border-color,rgba(0,0,0,.1));',
        'border-radius:20px;box-shadow:0 18px 44px rgba(0,0,0,.22);padding:16px 18px;display:flex;flex-direction:column;gap:10px;',
        'animation:aomUp .26s cubic-bezier(.22,1,.36,1);}',
        '@keyframes aomUp{from{transform:translateY(10px) scale(.98);opacity:.4}to{transform:translateY(0) scale(1);opacity:1}}',
        '.aom-title{font-size:15px;font-weight:700;line-height:1.35;}',
        '.aom-static{font-size:12.5px;color:var(--text-secondary);line-height:1.6;white-space:pre-line;}',
        '.aom-static:empty{display:none;}',
        '.aom-input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:12px;border:1px solid var(--border-color,rgba(0,0,0,.12));',
        'background:var(--primary-bg,#f9f9f9);color:var(--text-primary);font:inherit;font-size:14px;}',
        '.aom-pills{display:flex;flex-wrap:wrap;gap:8px;}',
        '.aom-pills:empty{display:none;}',
        '.aom-pill{flex:1 1 auto;min-width:96px;padding:11px 14px;border-radius:14px;border:1px solid var(--border-color,rgba(0,0,0,.12));',
        'background:var(--primary-bg,#f9f9f9);color:var(--text-primary);font:inherit;font-size:14px;cursor:pointer;}',
        '.aom-pill.sel{background:var(--btn-bg,var(--accent-color,#c5a47e));color:var(--btn-ink,#fff);border-color:transparent;}',
        '.aom-pill:active{transform:scale(.98);}',
        '.aom-hint{font-size:12px;color:#e05555;line-height:1.45;}',
        '.aom-hint:empty{display:none;}',
        '.aom-buttons{display:flex;gap:10px;justify-content:flex-end;margin-top:2px;}',
        '.aom-btn{padding:9px 18px;border-radius:12px;border:1px solid var(--border-color,rgba(0,0,0,.12));background:var(--primary-bg,#f9f9f9);',
        'color:var(--text-primary);font:inherit;font-size:13.5px;cursor:pointer;}',
        '.aom-btn:active{transform:scale(.97);}',
        '.aom-ok{background:var(--btn-bg,var(--accent-color,#c5a47e));color:var(--btn-ink,#fff);border-color:transparent;}'
      ].join('');
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  function openModal(title, value, cb, opts) {
    opts = opts || {};
    ensureStyle();
    try { closeOpenModal(); } catch (e) {}
    var lock = !!opts.lock;
    var id = 'app-open-modal-' + (opts.key || 'default');
    var m = document.createElement('div');
    m.className = 'app-open-modal' + (lock ? ' aom-locked' : '');
    m.id = id;
    m.innerHTML =
      '<div class="aom-card">' +
        '<div class="aom-title"></div>' +
        '<div class="aom-static" id="modal-static"></div>' +
        (opts.noInput ? '' : '<input class="aom-input" type="' + (opts.inputType || 'text') + '">') +
        '<div class="aom-pills"></div>' +
        '<div class="aom-hint"></div>' +
        '<div class="aom-buttons">' +
          '<button class="aom-btn aom-cancel" type="button"></button>' +
          '<button class="aom-btn aom-ok" type="button"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);

    var titleEl = m.querySelector('.aom-title');
    var staticEl = m.querySelector('.aom-static');
    var input = m.querySelector('.aom-input');
    var pillBox = m.querySelector('.aom-pills');
    var hintEl = m.querySelector('.aom-hint');
    var buttonsEl = m.querySelector('.aom-buttons');
    var okBtn = m.querySelector('.aom-ok');
    var cancelBtn = m.querySelector('.aom-cancel');

    titleEl.textContent = title == null ? '' : String(title);
    staticEl.textContent = opts.staticText || '';
    if (input) {
      input.value = value == null ? '' : String(value);
      if (opts.placeholder) input.setAttribute('placeholder', opts.placeholder);
    }
    okBtn.textContent = opts.okText || '确定';
    cancelBtn.textContent = opts.cancelText || '取消';
    cancelBtn.style.display = lock ? 'none' : '';

    var ctl = {
      el: m,
      input: input,
      pillValue: opts.pill == null ? null : opts.pill,
      _stay: false,
      'static': function (txt) { staticEl.textContent = txt == null ? '' : String(txt); return ctl; },
      hint: function (txt) { hintEl.textContent = txt == null ? '' : String(txt); return ctl; },
      stay: function () { ctl._stay = true; return ctl; },
      close: function () { try { m.remove(); } catch (e) {} if (current === ctl) current = null; },
      pick: function (v) { ctl.pillValue = v; markSel(v); finish(); },
      pills: function (list, sel) {
        pillBox.innerHTML = '';
        if (sel != null) ctl.pillValue = sel;
        (list || []).forEach(function (it) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'aom-pill' + (String(it.value) === String(ctl.pillValue) ? ' sel' : '');
          b.setAttribute('data-value', String(it.value));
          b.textContent = it.label;
          b.addEventListener('click', function () { ctl.pick(it.value); });
          pillBox.appendChild(b);
        });
        syncButtons();
        return ctl;
      }
    };

    function markSel(v) {
      Array.prototype.forEach.call(pillBox.children, function (c) {
        c.classList.toggle('sel', String(c.getAttribute('data-value')) === String(v));
      });
    }
    // 有胶囊时：胶囊本身就是动作按钮（点击即确认），隐藏「取消 / 确定」那一行
    function syncButtons() {
      var hasPills = pillBox.children.length > 0;
      buttonsEl.style.display = hasPills ? 'none' : 'flex';
      cancelBtn.style.display = (hasPills || lock) ? 'none' : '';
    }
    function finish() {
      var v;
      if (input) v = String(input.value || '').trim();
      else if (ctl.pillValue != null) v = ctl.pillValue;
      else v = true;
      ctl._stay = false;
      try { if (typeof cb === 'function') cb(v); } catch (e) {}
      if (!ctl._stay) ctl.close();
    }

    if (opts.pills && opts.pills.length) ctl.pills(opts.pills, opts.pill);
    else syncButtons();

    okBtn.addEventListener('click', finish);
    cancelBtn.addEventListener('click', function () { if (!lock) ctl.close(); });
    m.addEventListener('pointerdown', function (e) { if (e.target === m && !lock) ctl.close(); });
    m.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !lock) ctl.close(); });
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); finish(); } });
    setTimeout(function () { try { if (input) { input.focus(); if (input.select) input.select(); } } catch (e) {} }, 60);
    current = ctl;
    return ctl;
  }

  function closeOpenModal() {
    try { if (current && current.el) current.el.remove(); } catch (e) {}
    current = null;
  }

  // 通用「应用内确认框」：清除会话 / 重置数据等提示都走这里（用户要求 2026-10-05）。
  // 用法：window.appConfirm(title, detail, okText, function (ok) { ... })
  window.appConfirm = function (title, detail, okText, cb) {
    if (typeof cb !== 'function') cb = function () {};
    try {
      if (typeof window.openModal === 'function') {
        window.openModal(String(title || ''), '', function () { cb(true); }, {
          noInput: true,
          staticText: String(detail || ''),
          okText: okText || '确定',
          cancelText: '取消'
        });
        return;
      }
    } catch (e) {}
    var ok = false;
    try { ok = window.confirm(String(title || '') + (detail ? '\n' + detail : '')); } catch (e2) {}
    cb(!!ok);
  };

  window.openModal = window.openModal || openModal;
  window.closeOpenModal = window.closeOpenModal || closeOpenModal;
})();
