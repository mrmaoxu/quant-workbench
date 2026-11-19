#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch18：官方参数生效 + 盘中实时估算
1) 三条防守策略标签改为「官方真值」（净值/绩效/持仓官方，排名按官方参数本地复算）
2) injectSnap 允许覆盖已有策略的 pool/mom/cfg（否则官方参数进不来）
3) 新增 intradaySync：交易时段用官方持仓 + 实时价算浮动净值，替换当日数据点，
   覆盖「14:30 调仓后到收盘这半小时」的真实波动；30 秒一轮。
"""
P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

a1 = """    p96561: { short: '大类资产轮动', group: '防守策略', tag: '本地复现', tagc: 'cyan' },
    p96563: { short: '七龙珠V2', group: '防守策略', tag: '本地复现', tagc: 'cyan' },
    p96560: { short: '银行等股灾', group: '防守策略', tag: '本地复现', tagc: 'cyan' }"""
n1 = """    p96561: { short: '大类资产轮动', group: '防守策略', tag: '官方真值', tagc: 'gold' },
    p96563: { short: '七龙珠V2', group: '防守策略', tag: '官方真值', tagc: 'gold' },
    p96560: { short: '银行等股灾', group: '防守策略', tag: '官方真值', tagc: 'gold' }"""
assert txt.count(a1) == 1, 'META 锚点不唯一'
txt = txt.replace(a1, n1, 1)

a2 = "      if (!d || QE.STRATS[id]) return;"
n2 = "      if (!d) return;"
assert txt.count(a2) == 1
txt = txt.replace(a2, n2, 1)

LIVE = '''  /* ===== 盘中实时估算：官方持仓 + 实时价，覆盖 14:30 调仓后的真实波动 ===== */
  function isTradingNow() {
    var d = new Date(), w = d.getDay();
    if (w === 0 || w === 6) return false;
    var m = d.getHours() * 60 + d.getMinutes();
    return (m >= 570 && m <= 690) || (m >= 780 && m <= 900);
  }
  function secOf(c) { return ((c.charAt(0) === '5' || c.charAt(0) === '6') ? 'sh' : 'sz') + c; }
  function liveQuotes(codes, cb) {
    if (!codes.length) { cb(null); return; }
    var s = document.createElement('script');
    s.charset = 'gbk';
    s.src = 'https://qt.gtimg.cn/q=' + codes.map(secOf).join(',') + '&_=' + Date.now();
    s.onload = function () {
      var px = {};
      codes.forEach(function (c) {
        var v = window['v_' + secOf(c)];
        if (!v) return;
        var a = String(v).split('~'), p = parseFloat(a[3]);
        if (p > 0) px[c] = p;
      });
      s.parentNode && s.parentNode.removeChild(s);
      cb(px);
    };
    s.onerror = function () { s.parentNode && s.parentNode.removeChild(s); cb(null); };
    document.head.appendChild(s);
  }
  function intradaySync() {
    if (!isTradingNow() || typeof SNAP === 'undefined' || !SNAP.s) return;
    var codes = {}, any = false;
    SNAP_ORDER.forEach(function (k) {
      var d = SNAP.s[k];
      if (!d || !d.holds) return;
      d.holds.forEach(function (h) { codes[h.code] = 1; any = true; });
    });
    if (!any) return;
    liveQuotes(Object.keys(codes), function (px) {
      if (!px) return;
      var today = new Date(), tk = '' + today.getFullYear() + ('0' + (today.getMonth() + 1)).slice(-2) + ('0' + today.getDate()).slice(-2);
      SNAP_ORDER.forEach(function (k) {
        var d = SNAP.s[k], a = APP.accounts[k];
        if (!d || !d.nav || !d.nav.length || !d.holds || !d.holds.length || !a) return;
        var mv = 0, miss = false;
        d.holds.forEach(function (h) {
          var p = px[h.code];
          if (!(p > 0)) { miss = true; return; }
          mv += h.qty * p;
        });
        if (miss || !(a.cash >= 0)) return;
        var est = Math.round((a.cash + mv) * 100) / 100;
        var last = d.nav[d.nav.length - 1];
        if (String(last[0]) === tk) { last[1] = est; }
        else { d.nav.push([tk, est]); }
        var hh = today.getHours(), mm = today.getMinutes();
        d.sync = '盘中估算 ' + ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
        d.intraday = true;
      });
      try { injectSnap(); } catch (e) {}
      renderAll();
    });
  }

'''

anchor = '  /* 运行时同步平台官方真值（CORS 已放开）。失败静默回落本地快照 */'
assert txt.count(anchor) == 1
txt = txt.replace(anchor, LIVE + anchor, 1)

# liveSync 成功后顺带做一次盘中估算
a3 = """      toast('已同步平台官方当日数据');"""
n3 = """      toast('已同步平台官方当日数据');
      setTimeout(function () { try { intradaySync(); } catch (e) {} }, 400);"""
assert txt.count(a3) == 1
txt = txt.replace(a3, n3, 1)

# 定时 30s 盯盘
a4 = """    setTimeout(function () { try { liveSync(); } catch (e) {} }, 900);"""
n4 = """    setTimeout(function () { try { liveSync(); } catch (e) {} }, 900);
    setInterval(function () { try { intradaySync(); } catch (e) {} }, 30000);"""
assert txt.count(a4) == 1
txt = txt.replace(a4, n4, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK %.1f KB' % (len(out.encode('utf-8')) / 1024))
