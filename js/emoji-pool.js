/* 自定义回复库「Emoji 库」的取材口（用户要求 2026-10-05）
   需求：自定义回复库里的「主字卡」和「Emoji」都要能参与**造句**（mjf）与**拼字**（qs）。

   现状：两处取材都只走主字卡，而且 filter 明确把 Emoji 排除在外 ——
     · dream-free.js 的 filterCorpus 要求「≥4 个汉字」→ Emoji 整卡被滤掉；
     · quote-spell.js 的 quotePool 直接写着 `emoji 整卡不拼`，qs-cc 并入池又要求「≥2 个汉字」。
   这里给一个统一的 Emoji 池出口，两个模块各自 concat 进去；
   只排除**不能当文字用的**条目（图片/媒体令牌、超长、空串），其余 Emoji 照收。
   单独成一个模块也便于验证与以后调整（改这一个口子即可）。 */
(function () {
  'use strict';
  window.mochiEmojiPool = function (opts) {
    try {
      var maxLen = (opts && opts.maxLen) || 30;
      var src = [];
      try {
        if (typeof customEmojis !== 'undefined' && Array.isArray(customEmojis)) src = customEmojis;
        else if (window.customEmojis && Array.isArray(window.customEmojis)) src = window.customEmojis;
      } catch (e) { src = []; }
      return src.map(function (s) { return String(s == null ? '' : s).trim(); }).filter(function (t) {
        if (!t) return false;
        if (t.length > maxLen) return false;
        if (t.indexOf('data:') === 0 || t.indexOf('|||') >= 0) return false;
        if (window.mochiMediaIsToken && window.mochiMediaIsToken(t)) return false;
        return true;
      });
    } catch (e) { return []; }
  };
})();
