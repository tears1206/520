/* 「对方主动来信」设置小面板（本工程自建的胶水层，不属于新版 14 模块）
 *
 * 需求：新版那套 41 元素的「回复设置图形页」没有重建，ml-write-* 只能从 Console 调；
 * 这里给最常用的几项做一个独立小面板，直接读写真实的配置中心 replyCfg()/saveReplyCfg()。
 *
 * 对应键（新版设置里本来就有的）：
 *   ml-write-en        总开关（1 开 / 0 关）
 *   ml-write-prob      到点来信概率（%）
 *   ml-write-min/max   两封信的间隔（分钟）
 *   ml-write-daily-max 每日上限（封）
 *   ml-min-cards/max   来信长度（句数）
 */
(function () {
  var KEYS = ['ml-write-en', 'ml-write-prob', 'ml-write-min', 'ml-write-max', 'ml-write-daily-max', 'ml-min-cards', 'ml-max-cards'];

  function cfgGet(k, d) {
    try {
      var c = (typeof window.replyCfg === 'function') ? window.replyCfg() : null;
      var v = c ? Number(c[k]) : NaN;
      return isFinite(v) ? v : d;
    } catch (e) { return d; }
  }
  function cfgSet(k, v) {
    try {
      if (typeof window.saveReplyCfg === 'function') { window.saveReplyCfg(k, v); return true; }
      if (typeof window.mochiSetReplyCfg === 'function') { window.mochiSetReplyCfg(k, v); return true; }
    } catch (e) {}
    return false;
  }

  function el(id) { return document.getElementById(id); }

  function fill() {
    var en = cfgGet('ml-write-en', 1) === 1;
    var cb = el('mlw-en'); if (cb) cb.checked = en;
    var pairs = [
      ['mlw-prob', 'ml-write-prob', 30], ['mlw-min', 'ml-write-min', 1], ['mlw-max', 'ml-write-max', 480],
      ['mlw-cap', 'ml-write-daily-max', 3], ['mlw-cmin', 'ml-min-cards', 20], ['mlw-cmax', 'ml-max-cards', 20]
    ];
    pairs.forEach(function (p) {
      var input = el(p[0]), label = el(p[0] + '-v');
      var v = cfgGet(p[1], p[2]);
      // 用户要求 2026-10-05：来信句数上限 20 —— 老存档里超出滑块上限的值在打开面板时收敛并回写，
      // 免得滑块停在 20 而数字标签还写着 50。
      if (input) {
        var lo = Number(input.min), hi = Number(input.max);
        if (isFinite(hi) && v > hi) { v = hi; cfgSet(p[1], v); }
        if (isFinite(lo) && v < lo) { v = lo; cfgSet(p[1], v); }
        input.value = String(v);
      }
      if (label) label.textContent = String(v);
    });
    var st = el('mlw-status');
    if (st) st.textContent = en ? '已开启：对方会不定时主动给你寄信' : '已关闭：对方不会主动来信';
  }

  function bindRange(id, key) {
    var input = el(id), label = el(id + '-v');
    if (!input || input.__bound) return;
    input.__bound = true;
    input.addEventListener('input', function () {
      var v = Number(input.value) || 0;
      if (label) label.textContent = String(v);
      cfgSet(key, v);
      // 间隔最小值不能大于最大值（反之亦然）
      if (key === 'ml-write-min') {
        var mx = Number((el('mlw-max') || {}).value || 0);
        if (mx && v > mx) { var i2 = el('mlw-max'); if (i2) { i2.value = String(v); var l2 = el('mlw-max-v'); if (l2) l2.textContent = String(v); } cfgSet('ml-write-max', v); }
      }
      if (key === 'ml-min-cards') {
        var cmx = Number((el('mlw-cmax') || {}).value || 0);
        if (cmx && v > cmx) { var i3 = el('mlw-cmax'); if (i3) { i3.value = String(v); var l3 = el('mlw-cmax-v'); if (l3) l3.textContent = String(v); } cfgSet('ml-max-cards', v); }
      }
    });
  }

  function bindAll() {
    var cb = el('mlw-en');
    if (cb && !cb.__bound) {
      cb.__bound = true;
      cb.addEventListener('change', function () {
        cfgSet('ml-write-en', cb.checked ? 1 : 0);
        var st = el('mlw-status');
        if (st) st.textContent = cb.checked ? '已开启：对方会不定时主动给你寄信' : '已关闭：对方不会主动来信';
      });
    }
    bindRange('mlw-prob', 'ml-write-prob');
    bindRange('mlw-min', 'ml-write-min');
    bindRange('mlw-max', 'ml-write-max');
    bindRange('mlw-cap', 'ml-write-daily-max');
    bindRange('mlw-cmin', 'ml-min-cards');
    bindRange('mlw-cmax', 'ml-max-cards');
    var now = el('mlw-now');
    if (now && !now.__bound) {
      now.__bound = true;
      now.addEventListener('click', function () {
        var r = (typeof window.mochiMlWriteTick === 'function') ? window.mochiMlWriteTick(true) : 'no-tick';
        var msg = { sent: '已寄出一封，去「信封 → 收件箱」看看 ✉', cap: '今天的额度已用完（可在上面调「每日上限」）',
          off: '开关是关的，先打开总开关', empty: '自定义回复池是空的，先往「自定义回复」加内容', 'no-envelope': '信封模块未就绪' }[r] || ('结果：' + r);
        if (typeof window.showNotification === 'function') window.showNotification(msg, r === 'sent' ? 'success' : 'info', 2600);
        else alert(msg);
      });
    }
  }

  window.openMlWritePanel = function () {
    var m = el('ml-write-modal');
    if (!m) { if (typeof window.showNotification === 'function') window.showNotification('面板未找到', 'error'); return; }
    fill(); bindAll();
    if (typeof window.showModal === 'function') window.showModal(m);
    else m.style.display = 'flex';
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { bindAll(); });
  else bindAll();

  window.MlWritePanel = { open: window.openMlWritePanel, refresh: fill, keys: KEYS };
})();
