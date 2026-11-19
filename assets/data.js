/* data.js — 行情数据层
 *
 * 日线：东方财富 push2his（前复权 fqt=1，全历史）→ JSONP
 * 实时：腾讯 qt.gtimg.cn（现价 / 涨跌幅 / IOPV 净值）→ <script> 直接执行，天然绕过 file:// 的 CORS
 *       失败时退回东方财富 ulist.np（无 IOPV，溢价显示 --）
 *
 * 之所以不走 fetch：APK 内是 file:// 环境，fetch 会被 CORS 拦截，script 标签不受限制。
 */
(function (root) {
  'use strict';
  var CACHE_KEY = 'qw_kline_v4';
  var META_KEY = 'qw_meta_v4';

  var D = {
    klines: {},
    rt: {},
    meta: {},
    loading: false,
    lastFetch: 0,
    rtSrc: '--',
    errors: []
  };

  function secid(c) { return (c[0] === '5' || c[0] === '6' ? '1.' : '0.') + c; }
  function sym(c) { return (c[0] === '5' || c[0] === '6' ? 'sh' : 'sz') + c; }
  function today() {
    var d = new Date();
    var p = function (x) { return (x < 10 ? '0' : '') + x; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* JSONP：东方财富接口支持 cb= 回调名 */
  function jsonp(url, ms) {
    return new Promise(function (res, rej) {
      var cb = 'jq' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      var s = document.createElement('script');
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; clean(); rej(new Error('timeout')); } }, ms || 12000);
      function clean() {
        clearTimeout(t);
        try { delete window[cb]; } catch (e) { window[cb] = undefined; }
        if (s.parentNode) s.parentNode.removeChild(s);
      }
      window[cb] = function (d) { if (done) return; done = true; clean(); res(d); };
      s.onerror = function () { if (done) return; done = true; clean(); rej(new Error('network')); };
      s.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + 'cb=' + cb;
      document.head.appendChild(s);
    });
  }

  function loadCache() {
    try {
      var k = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      var m = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      D.klines = k || {}; D.meta = m || {};
    } catch (e) { D.klines = {}; D.meta = {}; }
  }

  var saveTimer = null;
  function saveCache() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(D.klines));
        localStorage.setItem(META_KEY, JSON.stringify(D.meta));
      } catch (e) {
        // 超限时只保留最近 3 年
        try {
          var cut = (new Date().getFullYear() - 3) + '-01-01';
          for (var c in D.klines) {
            var o = D.klines[c], nd = [], nc = [];
            for (var i = 0; i < o.d.length; i++) if (o.d[i] >= cut) { nd.push(o.d[i]); nc.push(o.c[i]); }
            D.klines[c] = { d: nd, c: nc };
          }
          localStorage.setItem(CACHE_KEY, JSON.stringify(D.klines));
        } catch (e2) { }
      }
    }, 400);
  }

  function fetchKline(code) {
    var url = 'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid(code) +
      '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f53&klt=101&fqt=1&beg=20190101&end=20500101&lmt=100000';
    return jsonp(url, 15000).then(function (j) {
      if (!j || !j.data || !j.data.klines || !j.data.klines.length) throw new Error('empty ' + code);
      var d = [], c = [];
      for (var i = 0; i < j.data.klines.length; i++) {
        var p = j.data.klines[i].split(',');
        d.push(p[0]); c.push(parseFloat(p[1]));
      }
      D.klines[code] = { d: d, c: c };
      D.meta[code] = { t: Date.now(), last: d[d.length - 1], name: j.data.name };
      return D.klines[code];
    });
  }

  function needFetch(code) {
    var m = D.meta[code], k = D.klines[code];
    if (!m || !k || !k.d || !k.d.length) return true;
    var lastBar = k.d[k.d.length - 1];
    if (lastBar >= today()) return false;
    var age = Date.now() - (m.t || 0);
    return age > 10 * 60 * 1000;
  }

  function loadKlines(codes, progress) {
    loadCache();
    var queue = codes.filter(needFetch);
    var total = queue.length, done = 0, idx = 0, active = 0;
    if (!total) { if (progress) progress(1, 1); return Promise.resolve(D.klines); }
    return new Promise(function (resolve) {
      function next() {
        if (idx >= queue.length && active === 0) { saveCache(); return resolve(D.klines); }
        while (active < 4 && idx < queue.length) {
          (function (code) {
            active++; idx++;
            fetchKline(code).then(function () { }, function (e) {
              D.errors.push(code + ':' + e.message);
            }).then(function () {
              active--; done++;
              if (progress) progress(done, total);
              next();
            });
          })(queue[idx]);
        }
      }
      next();
    });
  }

  /* ---- 实时：腾讯（含 IOPV）---- */
  function tencentRT(codes) {
    return new Promise(function (res) {
      if (!codes.length) return res({});
      var list = codes.map(sym);
      var s = document.createElement('script');
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; clean(); res({}); } }, 9000);
      function clean() { clearTimeout(t); if (s.parentNode) s.parentNode.removeChild(s); }
      s.charset = 'gbk';
      s.onload = function () {
        if (done) return; done = true; clean();
        var out = {};
        list.forEach(function (sy) {
          var v = window['v_' + sy];
          if (typeof v !== 'string') return;
          var f = v.split('~');
          var px = parseFloat(f[3]);
          if (!(px > 0)) return;
          var nav = parseFloat(f[78]);
          out[f[2]] = {
            price: px,
            prev: parseFloat(f[4]) || null,
            pct: (f[32] != null && f[32] !== '') ? parseFloat(f[32]) : null,
            nav: (nav > 0 ? nav : null),
            name: f[1] || null,
            time: f[30] || null
          };
          window['v_' + sy] = undefined;
        });
        res(out);
      };
      s.onerror = function () { if (done) return; done = true; clean(); res({}); };
      s.src = 'https://qt.gtimg.cn/q=' + list.join(',') + '&_=' + Date.now();
      document.head.appendChild(s);
    });
  }

  /* ---- 实时：东方财富（兜底，无 IOPV）---- */
  function emRT(codes) {
    if (!codes.length) return Promise.resolve({});
    var ids = codes.map(secid).join(',');
    var url = 'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&secids=' + ids +
      '&fields=f2,f3,f12,f13,f14,f18';
    return jsonp(url, 10000).then(function (j) {
      var out = {};
      if (!j || !j.data || !j.data.diff) return out;
      var arr = j.data.diff;
      for (var i = 0; i < arr.length; i++) {
        var r = arr[i], px = r.f2;
        if (typeof px !== 'number' || px <= 0) continue;
        out[r.f12] = { price: px, pct: r.f3, prev: r.f18, nav: null, name: r.f14 };
      }
      return out;
    }, function () { return {}; });
  }

  function loadRT(codes) {
    return tencentRT(codes).then(function (a) {
      if (Object.keys(a).length >= 3) { D.rtSrc = '腾讯'; return a; }
      return emRT(codes).then(function (b) {
        D.rtSrc = Object.keys(b).length ? '东财' : '--';
        return Object.keys(b).length ? b : a;
      });
    }).then(function (out) {
      if (Object.keys(out).length) { D.rt = out; D.lastFetch = Date.now(); }
      return out;
    });
  }

  function marketState() {
    var n = new Date(), d = n.getDay(), h = n.getHours() * 100 + n.getMinutes();
    if (d === 0 || d === 6) return { open: false, text: '休市' };
    if (h >= 930 && h <= 1130) return { open: true, text: '盘中' };
    if (h >= 1300 && h <= 1500) return { open: true, text: '盘中' };
    if (h > 1130 && h < 1300) return { open: false, text: '午间休市' };
    if (h < 930) return { open: false, text: '未开盘' };
    return { open: false, text: '已收盘' };
  }

  D.jsonp = jsonp;
  D.loadKlines = loadKlines;
  D.loadRT = loadRT;
  D.today = today;
  D.sym = sym;
  D.marketState = marketState;
  D.loadCache = loadCache;
  D.saveCache = saveCache;
  root.DATA = D;
})(window);
