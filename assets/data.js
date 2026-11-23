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
    biLast: {},
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

  /* 内置日线：作为基线，保证离线 / 慢网也能算出排名与净值 */
  function applyBuiltin() {
    var CL = root.CL;
    if (!CL || !CL.ax || !CL.d) return 0;
    var ax = CL.ax, i, code, n = 0;
    D.biLast = D.biLast || {};
    for (code in CL.d) {
      var arr = CL.d[code], dd = [], cc = [], v;
      for (i = 0; i < ax.length; i++) {
        v = arr[i];
        if (v > 0) {
          dd.push(ax[i].slice(0, 4) + '-' + ax[i].slice(4, 6) + '-' + ax[i].slice(6));
          cc.push(v);
        }
      }
      if (!dd.length) continue;
      D.clLast = D.clLast || {};
      D.clLast[code] = dd[dd.length - 1];
      var cur = D.klines[code];
      if (cur && cur.d && cur.d.length) {
        var lastB = dd[dd.length - 1];
        for (i = 0; i < cur.d.length; i++) {
          if (cur.d[i] > lastB) { dd.push(cur.d[i]); cc.push(cur.c[i]); }
        }
      }
      D.klines[code] = { d: dd, c: cc, hl: (cur && cur.hl) || undefined };
      D.biLast[code] = dd[dd.length - 1];
      n++;
    }
    return n;
  }

  /* 计算完只把「内置 clist 基线之后」的增量写缓存（含平台/ktail 补的新交易日），
     并与已存缓存取并集，避免某次拉取失败把旧增量清掉 */
  function slimCache() {
    var out = {}, code, i;
    for (code in D.klines) {
      var o = D.klines[code];
      if (!o || !o.d) continue;
      var bi = (D.clLast && D.clLast[code]) || (D.biLast && D.biLast[code]);
      if (!bi) { out[code] = { d: o.d, c: o.c }; continue; }
      var dd = [], cc = [];
      for (i = 0; i < o.d.length; i++) if (o.d[i] > bi) { dd.push(o.d[i]); cc.push(o.c[i]); }
      if (dd.length) out[code] = { d: dd, c: cc };
    }
    return out;
  }

  /* 平台动量接口返回的日线尾部（serve.py /api/ktail 或仓库 ktail.js）。
     平台为后复权口径，与内置前复权基线差一个常数倍：在拼接点用内置收盘锚定缩放，
     只补「内置最后日期之后」的新交易日，保证引擎净值口径不被污染。 */
  function mergeKtail(K) {
    if (!K) return 0;
    var n = 0;
    for (var code in K) {
      var t = K[code], cur = D.klines[code];
      if (!t || !t.d || !t.d.length || !cur || !cur.d || !cur.d.length) continue;
      var lastB = cur.d[cur.d.length - 1], lastC = cur.c[cur.c.length - 1];
      var ai = -1, i;
      for (i = 0; i < t.d.length; i++) if (t.d[i] === lastB) { ai = i; break; }
      var ref = ai >= 0 ? t.c[ai] : t.c[t.c.length - 1];
      if (!(ref > 0) || !(lastC > 0)) continue;
      var f = lastC / ref;
      var dd = cur.d.slice(), cc = cur.c.slice(), hl = Object.assign({}, cur.hl || {});
      var added = 0;
      for (i = 0; i < t.d.length; i++) {
        if (t.d[i] > lastB) { dd.push(t.d[i]); cc.push(t.c[i] * f); added++; }
        if (t.hl && t.hl[t.d[i]]) hl[t.d[i]] = [t.hl[t.d[i]][0] * f, t.hl[t.d[i]][1] * f];
      }
      if (added) {
        D.klines[code] = { d: dd, c: cc, hl: hl };
        D.biLast[code] = dd[dd.length - 1];
        D.meta[code] = { t: Date.now(), last: dd[dd.length - 1], name: (D.meta[code] || {}).name };
        n++;
      } else if (Object.keys(hl).length) {
        cur.hl = hl;
      }
    }
    return n;
  }

  function applyKtail() { mergeKtail(root.KTAIL); }

  /* 在线（localhost 代理）：直接用平台接口补日线尾部，绕开行情站限流 */
  function platformKtail(codes) {
    if (location.protocol.indexOf('http') !== 0) return Promise.resolve(0);
    return fetch('/api/ktail?codes=' + codes.join(','), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.code !== 0) return 0;
        var n = mergeKtail(j.data);
        D.platCovered = D.platCovered || {};
        for (var c in j.data) {
          var t = j.data[c];
          if (t && t.d && t.d.length) {
            D.meta[c] = { t: Date.now(), last: t.d[t.d.length - 1], name: (D.meta[c] || {}).name };
            D.platCovered[c] = 1;
          }
        }
        return n;
      })
      .catch(function () { return 0; });
  }

  function loadCache() {
    try {
      var k = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      var m = JSON.parse(localStorage.getItem(META_KEY) || '{}');
      D.klines = k || {}; D.meta = m || {};
    } catch (e) { D.klines = {}; D.meta = {}; }
    applyBuiltin();
    applyKtail();
  }

  var saveTimer = null;
  function saveCache() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        /* 与已存增量取并集（新值覆盖同日期），失败的一次拉取不会清掉旧增量 */
        var slim = slimCache(), old = {}, c, i;
        try { old = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch (e) { old = {}; }
        for (c in slim) {
          var o = old[c], nw = slim[c];
          if (!o || !o.d) { old[c] = nw; continue; }
          var map = {}, dd = [], cc = [];
          for (i = 0; i < o.d.length; i++) map[o.d[i]] = o.c[i];
          for (i = 0; i < nw.d.length; i++) map[nw.d[i]] = nw.c[i];
          var ks = Object.keys(map).sort();
          for (i = 0; i < ks.length; i++) { dd.push(ks[i]); cc.push(map[ks[i]]); }
          old[c] = { d: dd, c: cc };
        }
        localStorage.setItem(CACHE_KEY, JSON.stringify(old));
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

  /* 腾讯日线（前复权）：script + _var 全局变量，file:// 也能用。
     返回 [date, open, close, high, low, volume]；与现有历史拼接，只替换取到的区间 */
  function tencentKline(code, count) {
    return new Promise(function (res, rej) {
      var v = 'txk_' + code + '_' + Math.random().toString(36).slice(2);
      var s = document.createElement('script');
      var done = false;
      var t = setTimeout(function () { if (!done) { done = true; clean(); rej(new Error('tx timeout')); } }, 12000);
      function clean() { clearTimeout(t); if (s.parentNode) s.parentNode.removeChild(s); }
      s.onload = function () {
        if (done) return; done = true;
        var j = window[v]; try { delete window[v]; } catch (e) { window[v] = undefined; }
        clean();
        try {
          var q = j.data[sym(code)];
          var arr = q.qfqday || q.day;
          if (!arr || !arr.length) return rej(new Error('tx empty'));
          var dd = [], cc = [], i, hl = {};
          for (i = 0; i < arr.length; i++) {
            dd.push(arr[i][0]); cc.push(parseFloat(arr[i][2]));
            hl[arr[i][0]] = [parseFloat(arr[i][3]), parseFloat(arr[i][4])];
          }
          var cur = D.klines[code], od = [], oc = [];
          if (cur && cur.d) {
            for (i = 0; i < cur.d.length; i++) {
              if (cur.d[i] < dd[0]) { od.push(cur.d[i]); oc.push(cur.c[i]); }
            }
          }
          D.klines[code] = { d: od.concat(dd), c: oc.concat(cc), hl: Object.assign({}, (cur && cur.hl) || {}, hl) };
          D.meta[code] = { t: Date.now(), last: dd[dd.length - 1], name: (q.qt && q.qt[sym(code)] && q.qt[sym(code)][1]) || (D.meta[code] || {}).name };
          res(D.klines[code]);
        } catch (e) { rej(new Error('tx parse')); }
      };
      s.onerror = function () { if (done) return; done = true; clean(); rej(new Error('tx network')); };
      s.src = 'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + sym(code) + ',day,,,' + (count || 320) + ',qfq&_var=' + v + '&_=' + Date.now();
      document.head.appendChild(s);
    });
  }

  function fetchKline(code) {
    /* 腾讯对突发并发限流(501)：失败退避 2s 重试一次，再兜底东财 */
    return tencentKline(code, 320).catch(function () {
      return new Promise(function (r) { setTimeout(r, 2000); }).then(function () { return tencentKline(code, 320); });
    }).catch(function () { return emKline(code); });
  }

  function emKline(code) {
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
    /* 盘中今日bar会随价格变动、收盘后需拿最终收盘价：统一按缓存年龄 10 分钟节流 */
    return Date.now() - (m.t || 0) > 10 * 60 * 1000;
  }

  function loadKlines(codes, progress, force) {
    loadCache();
    /* 先用平台接口补日线尾部（不受行情站限流影响），已覆盖的不再走腾讯/东财 */
    return platformKtail(codes).then(function () {
      var queue = codes.filter(function (c) {
        if (D.platCovered && D.platCovered[c]) return false;
        return force || needFetch(c);
      });
      var total = queue.length, done = 0, idx = 0, active = 0;
      if (!total) { saveCache(); if (progress) progress(1, 1); return Promise.resolve(D.klines); }
      return new Promise(function (resolve) {
        function next() {
          if (idx >= queue.length && active === 0) { saveCache(); return resolve(D.klines); }
          while (active < 2 && idx < queue.length) {
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

  /* ---- 实时：新浪（第二源，无 IOPV）---- */
  function sinaRT(codes) {
    if (!codes.length) return Promise.resolve({});
    return new Promise(function (res) {
      var s = document.createElement('script'), done = false;
      var clean = function () { if (s.parentNode) s.parentNode.removeChild(s); };
      var fin = function (o) { if (done) return; done = true; clean(); res(o); };
      s.charset = 'gbk';
      s.onload = function () {
        var out = {};
        codes.forEach(function (c) {
          var v = window['hq_str_' + sym(c)];
          if (!v) return;
          var f = String(v).split(','), px = parseFloat(f[3]);
          if (!(px > 0)) return;
          out[c] = { price: px, pct: null, prev: parseFloat(f[2]) || null, nav: null, name: f[0] || null };
          try { delete window['hq_str_' + sym(c)]; } catch (e) {}
        });
        fin(out);
      };
      s.onerror = function () { fin({}); };
      setTimeout(function () { fin({}); }, 7000);
      s.src = 'https://hq.sinajs.cn/rn=' + Date.now() + '&list=' + codes.map(sym).join(',');
      document.head.appendChild(s);
    });
  }

  function loadRT(codes) {
    var need = Math.min(3, codes.length);
    return tencentRT(codes).then(function (a) {
      if (Object.keys(a).length >= need) { D.rtSrc = '腾讯'; return a; }
      return sinaRT(codes).then(function (s2) {
        if (Object.keys(s2).length >= need) { D.rtSrc = '新浪'; return s2; }
        return emRT(codes).then(function (b) {
          D.rtSrc = Object.keys(b).length ? '东财' : '--';
          return Object.keys(b).length ? b : (Object.keys(s2).length ? s2 : a);
        });
      });
    }).then(function (out) {
      if (Object.keys(out).length) {
        D.rt = out; D.lastFetch = Date.now();
        /* 腾讯日线只给两位小数：今日bar用实时价（三位小数）覆盖，保证动量/排名精度 */
        var t = today();
        for (var c in out) {
          var k = D.klines[c];
          if (k && k.d && k.d[k.d.length - 1] === t && out[c].price > 0) k.c[k.c.length - 1] = out[c].price;
        }
      }
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
  D.applyBuiltin = applyBuiltin;
  D.saveCache = saveCache;
  root.DATA = D;
})(window);
