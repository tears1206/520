/* 图片管线门面：mochiImgIngest / mochiImgCompressTo / mochiImgIngestMiss / mochiFilePick* 
 *
 * 背景：这些函数在本工程里**只有调用点、从未定义**（redpacket.js 的注释也记了同一事实），于是：
 *   · 头像与昵称库「添加」→ 选完图后 `if (!window.mochiImgIngest)` 直接报「图片处理组件没加载上」＝
 *     用户看到的「无法上传头像」（群头像 / 群聊壁纸 / 朋友圈发图 / 通话背景 同因）；
 *   · 失败分支里的 `window.mochiImgIngestMiss(...)` 也未定义 → 一旦真失败会抛 TypeError。
 * 这里按调用方既有契约补齐（零机型分支，只用 canvas + FileReader）：
 *   mochiImgIngest(file, { maxSide, quality, mime, byteLimit, tag })
 *        → Promise<{ st:'ok'|'err'|'toobig'|'timeout', data?:dataURL, w?, h?, bytes?, msg? }>
 *   mochiImgCompressTo(src, { maxSide, quality, mime, byteLimit, tag }) → Promise<dataURL>
 *   mochiImgIngestMiss(r, label) → 一句人能看懂的原因（给 toast 用）
 *   mochiFilePick({ id, accept, multiple, onFiles }) → 打开选择器并把文件交回 onFiles
 *   mochiFilePickFire(input, { onFail }) / mochiFilePickGuard(input, fb) → 打开选择器的两条兜底腿
 */
(function () {
  'use strict';
  var DEFAULTS = { maxSide: 256, quality: 0.85, mime: 'image/jpeg', ingestTimeoutMs: 20000, maxFileBytes: 60 * 1024 * 1024 };

  function dataUrlBytes(dataUrl) {
    try {
      var s = String(dataUrl || '');
      var i = s.indexOf(',');
      if (i < 0) return 0;
      return Math.round((s.length - i - 1) * 3 / 4);
    } catch (e) { return 0; }
  }

  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(String(fr.result || '')); };
        fr.onerror = function () { reject(new Error('文件读取失败')); };
        fr.readAsDataURL(file);
      } catch (e) { reject(e); }
    });
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      try {
        var img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error('图片解码失败')); };
        img.src = src;
      } catch (e) { reject(e); }
    });
  }

  function drawScaled(img, opts) {
    var maxSide = Math.max(16, Math.round(opts.maxSide || DEFAULTS.maxSide));
    var quality = typeof opts.quality === 'number' ? opts.quality : DEFAULTS.quality;
    var w0 = img.naturalWidth || img.width || 0;
    var h0 = img.naturalHeight || img.height || 0;
    if (!w0 || !h0) return null;
    var scale = Math.min(1, maxSide / Math.max(w0, h0));
    var w = Math.max(1, Math.round(w0 * scale));
    var h = Math.max(1, Math.round(h0 * scale));
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var ctx = c.getContext('2d');
    if (!ctx) return null;
    try {
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
    } catch (e) { return null; }
    var mime = opts.mime || DEFAULTS.mime;
    var out = '';
    try { out = c.toDataURL(mime, quality); } catch (e) { out = ''; }
    if (!out) { try { out = c.toDataURL('image/png'); } catch (e2) { out = ''; } }
    if (!out) return null;
    return { data: out, w: w, h: h, bytes: dataUrlBytes(out) };
  }

  /* 按 byteLimit 逐档降质量/降边长（最多 3 次），拿到就返回 */
  function compress(src, opts) {
    opts = opts || {};
    return loadImage(src).then(function (img) {
      var tries = [
        { maxSide: opts.maxSide, quality: opts.quality, mime: opts.mime },
        { maxSide: Math.max(64, Math.round((opts.maxSide || DEFAULTS.maxSide) * 0.8)), quality: 0.75, mime: opts.mime },
        { maxSide: Math.max(48, Math.round((opts.maxSide || DEFAULTS.maxSide) * 0.65)), quality: 0.65, mime: opts.mime }
      ];
      var best = null;
      for (var i = 0; i < tries.length; i++) {
        var r = drawScaled(img, tries[i]);
        if (!r) continue;
        best = r;
        if (!opts.byteLimit || r.bytes <= opts.byteLimit) break;
      }
      return best;
    });
  }

  window.mochiImgCompressTo = window.mochiImgCompressTo || function (src, opts) {
    return compress(src, opts || {}).then(function (r) { return r && r.data ? r.data : ''; });
  };

  window.mochiImgIngest = window.mochiImgIngest || function (file, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () { finish({ st: 'timeout', msg: '图片处理超时' }); }, opts.timeoutMs || DEFAULTS.ingestTimeoutMs);
      function finish(r) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(r);
      }
      try {
        if (!file) { finish({ st: 'err', msg: '没有读到文件' }); return; }
        if (file.size && file.size > (opts.maxFileBytes || DEFAULTS.maxFileBytes)) {
          finish({ st: 'toobig', bytes: file.size, limit: DEFAULTS.maxFileBytes, msg: '图片太大' });
          return;
        }
        readAsDataURL(file).then(function (dataUrl) {
          if (!dataUrl) { finish({ st: 'err', msg: '文件读取失败' }); return; }
          return compress(dataUrl, opts).then(function (r) {
            if (!r || !r.data) { finish({ st: 'err', msg: '图片解码失败' }); return; }
            if (opts.byteLimit && r.bytes > opts.byteLimit) {
              finish({ st: 'toobig', data: r.data, bytes: r.bytes, limit: opts.byteLimit, w: r.w, h: r.h, msg: '压缩后仍然偏大' });
              return;
            }
            finish({ st: 'ok', data: r.data, w: r.w, h: r.h, bytes: r.bytes, type: opts.tag || '' });
          });
        }).catch(function (e) { finish({ st: 'err', msg: String((e && e.message) || e) }); });
      } catch (e) { finish({ st: 'err', msg: String((e && e.message) || e) }); }
    });
  };

  window.mochiImgIngestMiss = window.mochiImgIngestMiss || function (r, label) {
    var what = label ? '「' + label + '」' : '图片';
    if (r && r.st === 'toobig') {
      var mb = r.limit ? Math.round(r.limit / 1024 / 1024 * 10) / 10 : 0;
      return what + '太大了' + (mb ? '（上限约 ' + mb + 'MB）' : '') + '，换一张小一点的试试';
    }
    if (r && r.st === 'timeout') return what + '处理超时了，换一张再试';
    if (r && r.msg) return what + '处理失败：' + r.msg;
    return what + '处理失败，请换一张图片再试';
  };

  window.mochiFilePick = window.mochiFilePick || function (opts) {
    opts = opts || {};
    var id = opts.id || 'mochi-file-pick';
    var input = document.getElementById(id);
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = id;
      input.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);';
      document.body.appendChild(input);
    }
    input.setAttribute('accept', opts.accept || 'image/*');
    input.multiple = !!opts.multiple;
    input.onchange = function () {
      var files = Array.prototype.slice.call(input.files || []);
      try { input.value = ''; } catch (e) {}
      try { if (typeof opts.onFiles === 'function') opts.onFiles(files); } catch (e) {}
    };
    try { if (typeof input.showPicker === 'function') input.showPicker(); else input.click(); }
    catch (e) { try { input.click(); } catch (e2) {} }
    return input;
  };

  window.mochiFilePickFire = window.mochiFilePickFire || function (input, o) {
    if (!input) { if (o && o.onFail) o.onFail(); return false; }
    try { if (typeof input.showPicker === 'function') { input.showPicker(); return true; } } catch (e) {}
    try { input.click(); return true; } catch (e) { if (o && o.onFail) o.onFail(); return false; }
  };

  window.mochiFilePickGuard = window.mochiFilePickGuard || function (input, fb) {
    try { if (input && typeof input.showPicker === 'function') { input.showPicker(); return true; } } catch (e) {}
    try { if (typeof fb === 'function') fb(); } catch (e) {}
    return false;
  };
})();
