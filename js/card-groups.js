/* 字卡 / 情话「分组」流程（新版 window.cardGroups 门面）
 *
 * 与 mochi-compat.js 里的同名门面等价，但把「新建 / 重命名 / 删除分组」从浏览器原生
 * prompt()/confirm() 换成应用内弹窗 window.openModal（贴底半框）。
 * 原生框由浏览器画在**屏幕正中**、风格与应用不符（用户反馈：改字卡分组时的提示跑到屏幕中央）。
 *
 * 加载顺序：本文件在 mochi-compat.js **之前**加载，所以后者那句
 * `window.cardGroups = window.cardGroups || {...}` 会保留这里这一份实现；
 * 万一 window.openModal 缺失（脚本没加载），这里仍退回原生框，功能不会丢。
 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, ''); }
  function newId() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function askName(title, dflt, cb) {
    if (typeof window.openModal === 'function') {
      window.openModal(title, dflt || '', function (v) {
        cb(String(v == null ? '' : v).trim() || null);
      }, { okText: '确定', cancelText: '取消' });
      return;
    }
    var name = '';
    try { name = String(window.prompt(title, dflt || '') || '').trim(); } catch (e) {}
    cb(name || null);
  }

  function askConfirm(title, detail, okText, cb) {
    if (typeof window.openModal === 'function') {
      window.openModal(title, '', function () { cb(true); }, {
        noInput: true, staticText: detail || '', okText: okText || '删除', cancelText: '取消'
      });
      return;
    }
    var ok = false;
    try { ok = window.confirm(title + (detail ? '\n' + detail : '')); } catch (e) {}
    cb(ok);
  }

  window.cardGroups = {
    _newId: newId,
    // 通用门面（用户要求 2026-10-05）：字卡库删除 / 更改字卡时也走应用内弹窗，不再用浏览器原生框
    askText: askName,
    askConfirm: askConfirm,
    addFlow: function (groups, cb) {
      askName('新建分组名称', '', function (name) {
        if (!name) { if (cb) cb(null); return; }
        var g = { id: newId(), name: name };
        groups.push(g);
        if (cb) cb(g);
      });
    },
    renameFlow: function (g, groups, cb) {
      askName('重命名分组', g && g.name, function (name) {
        if (!name || !g) { if (cb) cb(null); return; }
        g.name = name;
        if (cb) cb(name);
      });
    },
    removeFlow: function (name, cb) {
      askConfirm('删除分组「' + name + '」？', '组内的字卡 / 情话会回到「未分组」。', '删除', function (ok) {
        if (cb) cb(!!ok);
      });
    },
    grpOnlyOptsHtml: function (groups, cur) {
      var h = '<option value="">未分组</option>';
      (groups || []).forEach(function (g) {
        h += '<option value="' + esc(g.id) + '"' + (String(cur) === String(g.id) ? ' selected' : '') + '>' + esc(g.name) + '</option>';
      });
      return h;
    },
    bindNewGrp: function () {},
    parseCatVal: function (v) { return { grp: v || '' }; }
  };
})();
