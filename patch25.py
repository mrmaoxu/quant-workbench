# -*- coding: utf-8 -*-
"""patch25：实时行情三源（腾讯 → 新浪 → 东财），降级链防限速"""
import io

P = 'assets/data.js'
t = io.open(P, encoding='utf-8').read()

old = """  function loadRT(codes) {
    return tencentRT(codes).then(function (a) {
      if (Object.keys(a).length >= 3) { D.rtSrc = '腾讯'; return a; }
      return emRT(codes).then(function (b) {
        D.rtSrc = Object.keys(b).length ? '东财' : '--';
        return Object.keys(b).length ? b : a;
      });
    }).then(function (out) {"""
new = """  /* ---- 实时：新浪（第二源，无 IOPV）---- */
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
          var v = window['hq_str_' + sy(c)];
          if (!v) return;
          var f = String(v).split(','), px = parseFloat(f[3]);
          if (!(px > 0)) return;
          out[c] = { price: px, pct: null, prev: parseFloat(f[2]) || null, nav: null, name: f[0] || null };
          try { delete window['hq_str_' + sy(c)]; } catch (e) {}
        });
        fin(out);
      };
      s.onerror = function () { fin({}); };
      setTimeout(function () { fin({}); }, 7000);
      s.src = 'https://hq.sinajs.cn/rn=' + Date.now() + '&list=' + codes.map(sy).join(',');
      document.head.appendChild(s);
    });
  }

  function loadRT(codes) {
    return tencentRT(codes).then(function (a) {
      if (Object.keys(a).length >= 3) { D.rtSrc = '腾讯'; return a; }
      return sinaRT(codes).then(function (s2) {
        if (Object.keys(s2).length >= 3) { D.rtSrc = '新浪'; return s2; }
        return emRT(codes).then(function (b) {
          D.rtSrc = Object.keys(b).length ? '东财' : '--';
          return Object.keys(b).length ? b : (Object.keys(s2).length ? s2 : a);
        });
      });
    }).then(function (out) {"""

assert old in t, 'loadRT not found'
t = t.replace(old, new, 1)
io.open(P, 'w', encoding='utf-8', newline='\n').write(t)

# 首页 hero 文案
U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()
u = u.replace("<div class=\"lb\">核心三策略合计 · 自动记账</div>", "<div class=\"lb\">本地核心三策略合计 · 自动记账</div>", 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

# 版本号
H = 'index.html'
h = io.open(H, encoding='utf-8').read().replace('?v=25', '?v=26')
io.open(H, 'w', encoding='utf-8', newline='\n').write(h)
print('patch25 OK')
