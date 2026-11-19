# -*- coding: utf-8 -*-
"""patch21：买地球卡片/详情用官方真值；修卡片底部曲线与文字重叠"""
import io

U = 'assets/ui.js'
C = 'assets/app.css'
u = io.open(U, encoding='utf-8').read()
c = io.open(C, encoding='utf-8').read()


def rep(old, new):
    global u
    assert old in u, 'NOT FOUND: ' + old[:80]
    u = u.replace(old, new, 1)


# 1) 卡片：买地球改用官方真值
rep("""    var curV = lastV;
    if (!s.snapshot) { var lv = liveValue(id); curV = lv.cur; dPnl = lv.dayPnl; dPct = lv.dayPct; }
    var m = s.snapshot ? snapMetrics(id, snap || {}, navs) : (metrics[id] || {});""",
"""    var curV = lastV;
    if (!s.snapshot) { var lv = liveValue(id); curV = lv.cur; dPnl = lv.dayPnl; dPct = lv.dayPct; }
    var m;
    if (id === 'earth' && eo && eo.nav && eo.nav.length > 1) {
      m = snapMetrics('p22753', eo, eo.nav);
      curV = +eo.nav[eo.nav.length - 1][1];
      var ep = +eo.nav[eo.nav.length - 2][1];
      dPnl = curV - ep; dPct = ep > 0 ? dPnl / ep : 0;
    } else {
      m = s.snapshot ? snapMetrics(id, snap || {}, navs) : (metrics[id] || {});
    }""")

rep("""    var scfg = (snap && snap.cfg) || {};""",
"""    var scfg = (id === 'earth' && eo && eo.cfg) ? eo.cfg : ((snap && snap.cfg) || {});""")

rep("""    var pills = [momLabelOf(id, s, snap)];""",
"""    var pills = [momLabelOf(id, s, (id === 'earth' && eo) ? eo : snap)];""")

rep("""    var navsForSpark = navs;""",
"""    var navsForSpark = (id === 'earth' && eo && eo.nav && eo.nav.length > 3)
      ? eo.nav.map(function (x) { return +x[1]; }) : navs;""")

# 2) 详情页：买地球顶部加官方真值卡
rep("""  function renderStrat(id) {
    var s = QE.STRATS[id], a = APP.accounts[id], m = metrics[id], lv = liveValue(id);""",
"""  function offCard(pid, d) {
    if (!d) return '';
    var sm = snapMetrics(pid, d, d.nav);
    var nav = d.nav || [], last = nav.length ? +nav[nav.length - 1][1] : 0;
    var prev = nav.length > 1 ? +nav[nav.length - 2][1] : last;
    var dp = last - prev, dpc = prev ? dp / prev : 0;
    var holds = (d.holds || []).map(function (h) {
      return cname(h.code) + ' ' + h.qty + '股 @' + h.px + ' · ' + dsh(h.date).slice(5);
    }).join(' · ') || '空仓';
    return '<div class="card offc"><div class="chd"><span class="bar gold"></span>' +
      '<h2>官方真值 · 买地球 /22753</h2><span class="rt">' + esc(d.sync || '') + '</span></div>' +
      '<div class="offv num">' + money(last) + '<small>元</small></div>' +
      '<div class="offk">' +
      '<div><span>今日</span><b class="num ' + cls(dp) + '">' + (dp >= 0 ? '+' : '') + money(dp) + ' <i class="pp ' + cls(dpc) + '">' + spct(dpc) + '</i></b></div>' +
      '<div><span>累计</span><b class="num ' + cls(sm.total) + '">' + spct(sm.total) + '</b></div>' +
      '<div><span>年化</span><b class="num ' + cls(sm.annual) + '">' + spct(sm.annual, 1) + '</b></div>' +
      '<div><span>最大回撤</span><b class="num dn">' + pct(sm.mdd, 1) + '</b></div>' +
      '</div>' +
      '<div class="offh">持仓 <b>' + esc(holds) + '</b></div>' +
      '<div class="offn">以上取自平台官方接口（净值 / 绩效 / 持仓）。下方「本地引擎」为按收盘价独立复算，' +
      '用于策略逻辑验证；两者口径不同时以官方为准。</div></div>';
  }

  function renderStrat(id) {
    var s = QE.STRATS[id], a = APP.accounts[id], m = metrics[id], lv = liveValue(id);""")

rep("""    if (s.snapshot) {
      var rk0 = (p && p.ranks && p.ranks.length) ? p.ranks : rankAt(id, s, a);""",
"""    if (id === 'earth' && typeof SNAP !== 'undefined' && SNAP.s && SNAP.s.p22753) {
      html += offCard('p22753', SNAP.s.p22753);
    }

    if (s.snapshot) {
      var rk0 = (p && p.ranks && p.ranks.length) ? p.ranks : rankAt(id, s, a);""")

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

c += """
/* 卡片底部：文字与迷你曲线不重叠 */
.s2f{display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:end;column-gap:8px}
.s2f .spk{width:92px;height:28px}
/* 详情页官方真值卡 */
.bar.gold{background:var(--gold)}
.offc{background:linear-gradient(180deg,rgba(245,185,66,.08),transparent 60%),var(--card);border-color:rgba(245,185,66,.28)}
.offv{font-size:26px;font-weight:750;letter-spacing:-.3px;margin:2px 0 10px}
.offv small{font-size:11px;color:var(--sub);margin-left:4px;font-weight:500}
.offk{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:9px 0 11px;border-top:1px dashed var(--line);border-bottom:1px dashed var(--line)}
.offk>div{display:flex;flex-direction:column;gap:3px}
.offk span{font-size:10.5px;color:var(--dim)}
.offk b{font-size:13px}
.offh{font-size:12px;color:var(--sub);margin-top:10px;line-height:1.6}
.offh b{color:var(--txt)}
.offn{font-size:11px;color:var(--dim);margin-top:6px;line-height:1.6}
[data-theme="light"] .offc{background:linear-gradient(180deg,rgba(245,185,66,.10),transparent 60%),#fff;border-color:#ecd9a8}
"""
io.open(C, 'w', encoding='utf-8', newline='\n').write(c)
print('patch21 OK ui=%d css=%d' % (len(u.encode('utf-8')), len(c.encode('utf-8'))))
