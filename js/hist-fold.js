/* 主页「记录」各栏的折叠渲染兜底（本工程缺 mochiHistFold / mochiHistDel* ——
   它们属于新版 idb.js：home-feed.js 有 11 处调用 window.mochiHistFold，
   于是任何「有数据」的记录栏都会当场抛 TypeError、整栏空白。
   这里补一个等价实现：当天的条目直接列出，更早的按「年-月」折叠（点标题展开/收起）。
   mochiHistDel / mochiHistDelBind 也一并给安全兜底（没有删除按钮，也不绑定）。 */
(function () {
  'use strict';

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function monthKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }

  if (typeof window.mochiHistFold !== 'function') {
    window.mochiHistFold = function (items, opts) {
      try {
        opts = opts || {};
        var key = String(opts.key || 'hist');
        var arr = (items || []).slice();
        if (!arr.length) return String(opts.empty || opts.todayEmpty || '');
        arr.sort(function (a, b) { return (Number(b.ts) || 0) - (Number(a.ts) || 0); });
        var todayK = dayKey(new Date());
        var today = [], groups = {}, order = [];
        arr.forEach(function (it) {
          var d = new Date(Number(it.ts) || 0);
          if (dayKey(d) === todayK) { today.push(it); return; }
          var mk = monthKey(d);
          if (!groups[mk]) { groups[mk] = []; order.push(mk); }
          groups[mk].push(it);
        });
        var out = today.map(function (x) { return x.html; }).join('');
        order.forEach(function (mk) {
          var parts = mk.split('-');
          var rows = groups[mk].map(function (x) { return x.html; }).join('');
          var open = !!opts.expandAll;
          out += '<div class="hist-fold">' +
            '<div class="hist-fold-head">' + parts[0] + ' 年 ' + Number(parts[1]) + ' 月 · ' + groups[mk].length + ' 条</div>' +
            '<div class="hist-fold-body"' + (open ? '' : ' hidden') + '>' + rows + '</div>' +
            '</div>';
        });
        return out;
      } catch (e) { return ''; }
    };
  }

  // 展开/收起：事件委托，各栏共用
  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t || !t.closest) return;
      var head = t.closest('.hist-fold-head');
      if (!head) return;
      var body = head.parentElement ? head.parentElement.querySelector('.hist-fold-body') : null;
      if (body) body.hidden = !body.hidden;
    } catch (err) {}
  }, false);

  // 删除相关 API：本工程没有 → 安全兜底（不渲染删除按钮、不绑定）
  if (typeof window.mochiHistDel !== 'function') window.mochiHistDel = function () { return ''; };
  if (typeof window.mochiHistDelBind !== 'function') window.mochiHistDelBind = function () {};

  // 样式（自包含，避免依赖别处的 CSS）
  try {
    if (!document.getElementById('hist-fold-style')) {
      var st = document.createElement('style');
      st.id = 'hist-fold-style';
      st.textContent =
        '.hist-fold{margin-top:8px;}' +
        '.hist-fold-head{padding:7px 10px;border:1px solid var(--border-color,#e5e5e5);border-radius:10px;' +
        'font-size:12px;color:var(--text-secondary,#888);cursor:pointer;user-select:none;background:var(--card-bg,#fff);}' +
        '.hist-fold-head:hover{background:var(--hover-bg,rgba(0,0,0,.03));}' +
        '.hist-fold-body{padding-top:6px;display:flex;flex-direction:column;gap:6px;}';
      document.head.appendChild(st);
    }
  } catch (e) {}
})();
