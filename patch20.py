# -*- coding: utf-8 -*-
"""patch20：统一策略网格 + 对齐卡片 + 多源行情 + 日历今日实时 + 买地球官方信号"""
import io, sys, re

U = 'assets/ui.js'
C = 'assets/app.css'
u = io.open(U, encoding='utf-8').read()
c = io.open(C, encoding='utf-8').read()

def rep(old, new, cnt=1):
    global u
    assert old in u, 'NOT FOUND: ' + old[:70]
    u = u.replace(old, new, cnt)

# ---------- 1. SNAP_META：取消分组，新增买地球官方对照 ----------
rep("""  var SNAP_META = {
    p13429: { short: '纯粹', group: '平台官方', tag: '官方真值', tagc: 'gold' },
    p96242: { short: 'ETF动量轮动', group: '平台官方', tag: '官方真值', tagc: 'gold' },
    p96561: { short: '大类资产轮动', group: '防守策略', tag: '官方真值', tagc: 'gold' },
    p96563: { short: '七龙珠V2', group: '防守策略', tag: '官方真值', tagc: 'gold' },
    p96560: { short: '银行等股灾', group: '防守策略', tag: '官方真值', tagc: 'gold' }
  };
  var SNAP_ORDER = ['p13429', 'p96242', 'p96561', 'p96563', 'p96560'];""",
"""  var SNAP_META = {
    p13429: { short: '纯粹', tag: '官方真值', tagc: 'gold' },
    p96242: { short: 'ETF动量轮动', tag: '官方真值', tagc: 'gold' },
    p96563: { short: '七龙珠V2', tag: '官方真值', tagc: 'gold' },
    p96560: { short: '银行等股灾', tag: '官方真值', tagc: 'gold' },
    p96561: { short: '大类资产轮动', tag: '官方真值', tagc: 'gold' },
    p22753: { short: '买地球·官方', tag: '官方对照', tagc: 'cyan', aux: true }
  };
  var SNAP_ORDER = ['p13429', 'p96242', 'p96563', 'p96560', 'p96561'];""")

# ---------- 2. injectSnap 去分组、跳过 aux ----------
rep("""  function injectSnap() {
    ['momentum', 'earth', 'lowfreq'].forEach(function (id) {
      if (QE.STRATS[id]) QE.STRATS[id].group = '核心引擎';
    });
    if (typeof SNAP === 'undefined' || !SNAP || !SNAP.s) return;
    SNAP_ORDER.forEach(function (id) {
      var d = SNAP.s[id];
      if (!d) return;
      var mt = SNAP_META[id] || { short: d.name, group: '其他', tag: '快照', tagc: 'blue' };""",
"""  function injectSnap() {
    if (typeof SNAP === 'undefined' || !SNAP || !SNAP.s) return;
    SNAP_ORDER.forEach(function (id) {
      var d = SNAP.s[id];
      if (!d) return;
      var mt = SNAP_META[id] || { short: d.name, tag: '快照', tagc: 'blue' };""")

rep("""        tag: mt.tag, tagc: mt.tagc, group: mt.group, note: d.note || ''""",
"""        tag: mt.tag, tagc: mt.tagc, group: 'all', note: d.note || ''""")

# ---------- 3. 日历：补今日实时点 ----------
rep("""  function perfData(a) {
    var nav = a.nav || [], navD = a.navD || [], out = [];
    if (!nav.length) return out;
    var base = a.capital || nav[0], peak = -Infinity;""",
"""  function livePoint(a, id) {
    var today = todayStr();
    if (!isTradingDay(today)) return null;
    if (a.navD && a.navD.length && a.navD[a.navD.length - 1] === today) return null;
    if (a.src === 'snap') {
      var sm = (typeof SNAP !== 'undefined' && SNAP.s) ? SNAP.s[id] : null;
      var tk = today.replace(/-/g, '');
      if (sm && sm.nav && sm.nav.length && String(sm.nav[sm.nav.length - 1][0]) === tk) {
        return { d: today, v: +sm.nav[sm.nav.length - 1][1] };
      }
    }
    try {
      var lv = liveValue(id);
      if (lv && lv.cur > 0) return { d: today, v: lv.cur };
    } catch (e) {}
    return null;
  }

  function perfData(a, extra) {
    var nav = a.nav || [], navD = a.navD || [], out = [];
    if (!nav.length) return out;
    var base = a.capital || nav[0], peak = -Infinity;""")

rep("""        pnl: i > 0 ? v - nav[i - 1] : 0
      });
    }
    return out;
  }""",
"""        pnl: i > 0 ? v - nav[i - 1] : 0
      });
    }
    if (extra && extra.d && extra.v > 0 && navD[navD.length - 1] !== extra.d) {
      var pv = nav[nav.length - 1], pk = Math.max(peak, extra.v);
      out.push({
        d: extra.d, v: extra.v,
        cum: base > 0 ? extra.v / base - 1 : 0,
        dd: pk > 0 ? extra.v / pk - 1 : 0,
        ret: pv > 0 ? extra.v / pv - 1 : 0,
        pnl: extra.v - pv, intraday: true
      });
    }
    return out;
  }""")

rep("""  function perfCard(id, a) {
    var rows = perfData(a);""",
"""  function perfCard(id, a) {
    var rows = perfData(a, livePoint(a, id));""")

rep("""      '<span class="rt">' + a.start.slice(2) + '~' + rows[rows.length - 1].d.slice(2) + ' · ' + rows.length + ' 日</span></div>';""",
"""      '<span class="rt">' + a.start.slice(2) + '~' + rows[rows.length - 1].d.slice(2) + ' · ' + rows.length + ' 日' +
      (rows[rows.length - 1].intraday ? ' · 今日实时' : '') + '</span></div>';""")

# ---------- 4. 多源行情 ----------
rep("""  function liveQuotes(codes, cb) {
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
  }""",
"""  /* 多源行情：腾讯 → 新浪 → 东财，任一源拿到即返回，防单源限速 */
  function jsonp(src, charset, onload, onerr) {
    var s = document.createElement('script');
    if (charset) s.charset = charset;
    s.src = src;
    s.onload = function () { try { onload(); } finally { s.parentNode && s.parentNode.removeChild(s); } };
    s.onerror = function () { s.parentNode && s.parentNode.removeChild(s); onerr && onerr(); };
    document.head.appendChild(s);
    return s;
  }
  function qTencent(codes, cb) {
    jsonp('https://qt.gtimg.cn/q=' + codes.map(secOf).join(',') + '&_=' + Date.now(), 'gbk', function () {
      var px = {};
      codes.forEach(function (c) {
        var v = window['v_' + secOf(c)];
        if (!v) return;
        var p = parseFloat(String(v).split('~')[3]);
        if (p > 0) px[c] = p;
      });
      cb(Object.keys(px).length ? px : null);
    }, function () { cb(null); });
  }
  function qSina(codes, cb) {
    jsonp('https://hq.sinajs.cn/rn=' + Date.now() + '&list=' + codes.map(secOf).join(','), 'gbk', function () {
      var px = {};
      codes.forEach(function (c) {
        var v = window['hq_str_' + secOf(c)];
        if (!v) return;
        var a = String(v).split(',');
        var p = parseFloat(a[3]);
        if (p > 0) px[c] = p;
      });
      cb(Object.keys(px).length ? px : null);
    }, function () { cb(null); });
  }
  function qEast(codes, cb) {
    var cbName = 'emq_' + Math.floor(Math.random() * 1e6);
    window[cbName] = function (j) {
      var px = {};
      try {
        ((j && j.data && j.data.diff) || []).forEach(function (o) {
          var code = String(o.f12 || ''), p = +o.f2;
          if (code && p > 0) px[code] = p;
        });
      } catch (e) {}
      try { delete window[cbName]; } catch (e) {}
      cb(Object.keys(px).length ? px : null);
    };
    var secids = codes.map(function (c) { return (c.charAt(0) === '5' || c.charAt(0) === '6' ? '1.' : '0.') + c; }).join(',');
    jsonp('https://push2.eastmoney.com/api/qt/ulist.np/get?cb=' + cbName + '&secids=' + secids + '&fields=f2,f12&_=' + Date.now(), null,
      function () {}, function () { cb(null); });
  }
  function liveQuotes(codes, cb) {
    if (!codes.length) { cb(null); return; }
    var srcs = [qTencent, qSina, qEast], i = 0;
    function step() {
      if (i >= srcs.length) { cb(null); return; }
      var fn = srcs[i++];
      var done = false;
      var to = setTimeout(function () { if (!done) { done = true; step(); } }, 6000);
      fn(codes, function (px) {
        if (done) return;
        done = true; clearTimeout(to);
        if (px && Object.keys(px).length) cb(px); else step();
      });
    }
    step();
  }""")

# ---------- 5. liveSync 覆盖 6 条（含买地球官方对照） ----------
rep("""    var ids = ['13429', '96242'], jobs = [], MP = {""",
"""    var ids = ['13429', '96242', '26867', '96070', '95204', '22753'], jobs = [], MP = {""")

# ---------- 6. 统一卡片 ----------
rep("""  /* ---------- 渲染：总览 ---------- */
  function renderHome() {""",
"""  /* ---------- 卡片：与次方官网同构（等高、指标左右对齐） ---------- */
  function momLabelOf(id, s, snap) {
    var mom = (snap && snap.mom) || null;
    if (mom) return mom.m2 ? ('双动量 ' + mom.m1 + '/' + mom.m2) : ('加权斜率 ' + mom.m1 + '日');
    var c = s.cfg || {};
    if (c.n2 && c.n2 !== c.n1) return '双动量 ' + c.n1 + '/' + c.n2;
    return '加权斜率 ' + (c.n1 || 25) + '日';
  }
  function slipTxt(v) {
    if (v == null) return null;
    var p = v * 100;
    return '滑点' + (p >= 0.1 ? p.toFixed(2).replace(/0$/, '') : p.toFixed(3).replace(/0+$/, '')) + '%';
  }
  function cardHTML(id) {
    var s = QE.STRATS[id], a = APP.accounts[id] || { nav: [], cash: 0 };
    var snap = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || null) : null;
    var eo = null;
    if (id === 'earth' && typeof SNAP !== 'undefined' && SNAP.s) eo = SNAP.s.p22753 || null;
    var navs = a.nav || [];
    var lastV = navs.length ? navs[navs.length - 1] : 0;
    var dPnl = navs.length > 1 ? lastV - navs[navs.length - 2] : 0;
    var dPct = (navs.length > 1 && navs[navs.length - 2]) ? dPnl / navs[navs.length - 2] : 0;
    var curV = lastV;
    if (!s.snapshot) { var lv = liveValue(id); curV = lv.cur; dPnl = lv.dayPnl; dPct = lv.dayPct; }
    var m = s.snapshot ? snapMetrics(id, snap || {}, navs) : (metrics[id] || {});
    var cum = s.snapshot ? m.total : (m.total != null ? m.total : 0);
    var ann = s.snapshot ? m.annual : m.annual;
    var mdd = s.snapshot ? m.mdd : (m.mdd != null ? -Math.abs(m.mdd) : null);
    var sharpe = s.snapshot ? m.sharpe : m.sharpe;
    var cfg = s.cfg || {};
    var scfg = (snap && snap.cfg) || {};
    var exec = String(scfg.exec || s.time || '14:50').slice(0, 5);
    var minHold = scfg.minHold != null ? scfg.minHold : (cfg.minHold || 1);
    var slip = scfg.slip != null ? scfg.slip : cfg.slip;
    var pills = [momLabelOf(id, s, snap)];
    pills.push('持有' + minHold + (scfg.calDays ? '自然日' : '天'));
    var dd = scfg.ddStop != null ? scfg.ddStop : (cfg.ddStop || 0);
    if (dd > 0) pills.push('止损' + (dd * 100).toFixed(0) + '%');
    var st2 = slipTxt(slip);
    if (st2) pills.push(st2);
    var sid = s.snapshot ? ('ID:' + id.replace(/^p/, '')) : '本地引擎';
    var startD = (snap && snap.start) ? dsh(snap.start) : ((APP.settings[id] || {}).start || '');
    var yrs = startD ? (new Date() - new Date(startD)) / 31536000000 : 0;
    var metaR = startD ? (yrs >= 1 ? '回测' + Math.round(yrs) + '年' : '回测' + Math.max(1, Math.round(yrs * 12)) + '月') : '';
    var navsForSpark = navs;
    var spark = navsForSpark.length > 3
      ? '<svg class="spk" viewBox="0 0 120 40" preserveAspectRatio="none"><path d="' + navPath(navsForSpark.slice(-60), 120, 38) + '" fill="none" stroke="' + (navsForSpark[navsForSpark.length - 1] >= navsForSpark[0] ? 'var(--up)' : 'var(--dn)') + '" stroke-width="1.3" opacity=".7" vector-effect="non-scaling-stroke"/></svg>'
      : '';
    var foot, footCls = 'dim';
    if (s.snapshot) {
      foot = (snap && snap.sync ? '官方 · ' + snap.sync : '官方真值') + (snap && snap.intraday ? ' · 盘中估算' : '');
      footCls = 'gold';
    } else if (id === 'earth' && eo && eo.holds && eo.holds.length) {
      var h0 = eo.holds[0];
      foot = '官方 14:30 信号 · ' + cname(h0.code) + ' ' + (h0.qty || '') + '股' + (h0.date ? ' · ' + dsh(h0.date).slice(5) : '');
      footCls = 'cyan';
    } else if (id === 'earth') {
      foot = '本地复算 · 14:30 时点价 · 无官方对照';
    } else {
      foot = '本地引擎 · 收盘价复算';
    }
    var badge = (dPct != null ? spct(dPct) : '--');
    var badgeCls = (dPct || 0) >= 0 ? 'up' : 'dn';
    return '<div class="sc2" onclick="UI.go(\\'' + id + '\\')">' +
      '<div class="s2h"><span class="nm">' + esc(s.short || s.name) + '</span>' +
      '<span class="bdg ' + badgeCls + '">' + badge + '</span></div>' +
      '<div class="s2m"><span>' + sid + '</span><i>' + metaR + '</i></div>' +
      '<div class="s2p">' + pills.map(function (p) { return '<span>' + esc(p) + '</span>'; }).join('') + '</div>' +
      '<div class="s2v num">' + money(curV) + '<small>元</small></div>' +
      '<div class="s2k">' +
      '<div><span>今日盈亏</span><b class="num ' + cls(dPnl) + '">' + (dPnl >= 0 ? '+' : '') + money(dPnl) + '</b></div>' +
      '<div><span>累计收益</span><b class="num ' + cls(cum) + '">' + (cum != null ? spct(cum) : '--') + '</b></div>' +
      '<div><span>年化收益</span><b class="num ' + cls(ann) + '">' + (ann != null ? spct(ann, 1) : '--') + '</b></div>' +
      '<div><span>最大回撤</span><b class="num dn">' + (mdd != null ? pct(mdd, 1) : '--') + '</b></div>' +
      '<div><span>夏普比率</span><b class="num">' + (sharpe != null ? (+sharpe).toFixed(2) : '--') + '</b></div>' +
      '<div><span>执行时间</span><b class="num">' + exec + '</b></div>' +
      '</div>' +
      '<div class="s2f ' + footCls + '"><span>' + esc(foot) + '</span>' + spark + '</div>' +
      '</div>';
  }

  /* ---------- 渲染：总览 ---------- */
  function renderHome() {""")

# 替换卡片渲染块（分组 → 单一网格）
start = u.index("    /* 策略卡：按分组渲染 */")
end = u.index("    /* 合计曲线 */")
assert start > 0 and end > start
u = u[:start] + """    /* 策略卡：统一网格，不区分来源 */
    var ORDER = ['momentum', 'earth', 'lowfreq', 'p13429', 'p96242', 'p96563', 'p96560', 'p96561'];
    var list = [];
    ORDER.forEach(function (id) { if (QE.STRATS[id]) list.push(id); });
    Object.keys(QE.STRATS).forEach(function (id) { if (ORDER.indexOf(id) < 0) list.push(id); });
    html += '<div class="gtitle one"><span>全部策略</span><i>' + list.length + ' 个 · 同一口径账本</i></div>';
    html += '<div class="sgrid2">' + list.map(function (id) { return cardHTML(id); }).join('') + '</div>';

""" + u[end:]

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

# ---------- 7. CSS ----------
css_new = """
/* ===== 统一策略卡片（对齐次方官网） ===== */
.gtitle{display:flex;align-items:center;gap:8px;margin:16px 2px 10px;font-size:12px;color:var(--sub);letter-spacing:.4px}
.gtitle.one span{font-weight:600;color:var(--txt)}
.gtitle i{font-style:normal;font-size:11px;color:var(--dim);margin-left:auto}
.sgrid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;align-items:stretch}
.sc2{display:flex;flex-direction:column;background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:var(--r);padding:13px 14px 10px;cursor:pointer;transition:border-color .18s,transform .18s,box-shadow .18s;position:relative;min-height:266px}
.sc2:hover{border-color:color-mix(in srgb,var(--acc) 55%,var(--line));transform:translateY(-1px);box-shadow:0 10px 26px rgba(0,0,0,.22)}
.s2h{display:flex;align-items:center;gap:8px}
.s2h .nm{font-size:14.5px;font-weight:700;letter-spacing:.2px;overflow-wrap:anywhere;word-break:break-word}
.s2h .bdg{margin-left:auto;flex:0 0 auto;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;border:1px solid transparent;font-variant-numeric:tabular-nums}
.bdg.up{color:var(--up);background:rgba(255,77,79,.10);border-color:rgba(255,77,79,.28)}
.bdg.dn{color:var(--dn);background:rgba(18,184,134,.10);border-color:rgba(18,184,134,.28)}
.s2m{display:flex;align-items:center;gap:8px;margin-top:5px;font-size:10.5px;color:var(--dim)}
.s2m i{font-style:normal;margin-left:auto}
.s2p{display:flex;flex-wrap:wrap;gap:5px;margin:9px 0 8px}
.s2p span{font-size:10.5px;color:var(--sub);border:1px solid var(--line);background:var(--bg2);border-radius:6px;padding:2px 7px;line-height:1.5}
.s2v{font-size:25px;font-weight:750;letter-spacing:-.3px;line-height:1.15;margin:2px 0 9px}
.s2v small{font-size:11px;font-weight:500;color:var(--sub);margin-left:4px}
.s2k{display:flex;flex-direction:column;gap:0;margin-top:auto;padding-top:2px}
.s2k>div{display:flex;align-items:baseline;justify-content:space-between;gap:10px;padding:4.5px 0;border-bottom:1px dashed var(--line)}
.s2k>div:last-child{border-bottom:0}
.s2k span{font-size:11.5px;color:var(--sub)}
.s2k b{font-size:12.5px;font-weight:650}
.s2f{display:flex;align-items:flex-end;gap:8px;margin-top:8px;padding-top:7px;border-top:1px solid var(--line);font-size:10.5px;min-height:26px}
.s2f span{flex:1;min-width:0;overflow-wrap:anywhere;word-break:break-word}
.s2f.gold span{color:var(--gold)}
.s2f.cyan span{color:var(--acc)}
.s2f.dim span{color:var(--dim)}
.s2f .spk{width:104px;height:30px;flex:0 0 auto;opacity:.9}
[data-theme="light"] .sc2{background:linear-gradient(180deg,#fff,#f7f9fc);border-color:#dfe6ef}
[data-theme="light"] .sc2:hover{border-color:#b7cdf5;box-shadow:0 8px 22px rgba(31,63,122,.10)}
[data-theme="light"] .s2p span{background:#f2f5fa;border-color:#e4eaf3}
[data-theme="light"] .s2v{color:#0f1a2b}
"""
c = c + css_new
io.open(C, 'w', encoding='utf-8', newline='\n').write(c)
print('patch20 OK | ui.js %d bytes | css %d bytes' % (len(u.encode('utf-8')), len(c.encode('utf-8'))))
