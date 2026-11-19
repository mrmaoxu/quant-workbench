# -*- coding: utf-8 -*-
"""patch1: 在 ui.js 注入快照策略（5 个）+ 适配 runAll / computePending / ensureAccounts"""
import io

P = r"G:\AI_DEMO\纯粹策略\workbench-v2\assets\ui.js"
s = io.open(P, "r", encoding="utf-8").read()

BLOCK = r"""  /* ===== 快照策略：官方接口 / 本地复算（非自动记账） ===== */
  var SNAP_META = {
    p13429: { short: '纯粹', group: '平台官方', tag: '官方真值', tagc: 'gold' },
    p96242: { short: 'ETF动量轮动', group: '平台官方', tag: '官方真值', tagc: 'gold' },
    p96561: { short: '大类资产轮动', group: '防守策略', tag: '本地复现', tagc: 'cyan' },
    p96563: { short: '七龙珠V2', group: '防守策略', tag: '本地复现', tagc: 'cyan' },
    p96560: { short: '银行等股灾', group: '防守策略', tag: '本地复现', tagc: 'cyan' }
  };
  var SNAP_ORDER = ['p13429', 'p96242', 'p96561', 'p96563', 'p96560'];
  var CODE_NAMES = {
    '518880':'黄金ETF','513500':'标普500','159915':'创业板ETF','511380':'可转债ETF','510500':'中证500',
    '159985':'豆粕ETF','513880':'日经225','513100':'纳指ETF','159518':'标普油气','512480':'半导体ETF',
    '513030':'德国ETF','159509':'纳指科技','588000':'科创50','501225':'全球芯片LOF','513310':'中韩半导体',
    '162719':'石油LOF','513290':'纳指生物','513520':'日经ETF','159941':'纳指ETF','512890':'红利低波',
    '161127':'标普生物','159552':'银行ETF','515020':'银行ETF','511880':'银华日利','162415':'美国消费LOF',
    '161226':'国投白银LOF','563230':'卫星ETF','159852':'软件ETF','512980':'传媒ETF','513090':'香港证券',
    '159582':'半导体ETF','162411':'华宝油气','159995':'芯片ETF','160723':'嘉实原油LOF','159667':'工业母机',
    '512200':'房地产ETF','510300':'沪深300'
  };

  function dsh(x) {
    var t = String(x || '');
    return t.length === 8 && /^\d+$/.test(t) ? t.slice(0, 4) + '-' + t.slice(4, 6) + '-' + t.slice(6) : t;
  }
  function cname(c) { return CODE_NAMES[c] || c; }

  function snapMetrics(id, d, nav) {
    var m = (d && d.metrics) || {};
    var init = (d && d.init) || (nav && nav.length ? nav[0] : 1);
    var last = nav && nav.length ? nav[nav.length - 1] : init;
    return {
      total: m.total != null ? m.total / 100 : (init > 0 ? last / init - 1 : 0),
      annual: m.annual != null ? m.annual / 100 : null,
      vol: m.vol != null ? m.vol / 100 : null,
      sharpe: m.sharpe != null ? m.sharpe : null,
      mdd: -Math.abs((m.mdd != null ? m.mdd : 0) / 100),
      calmar: m.calmar != null ? m.calmar : null,
      win: m.win != null ? m.win / 100 : null,
      trades: m.trades || 0
    };
  }

  function buildSnapAccount(id, d) {
    var navD = [], nav = [], i, k;
    for (i = 0; i < (d.nav || []).length; i++) { navD.push(dsh(d.nav[i][0])); nav.push(+d.nav[i][1]); }
    var pos = {};
    (d.holds || []).forEach(function (h) {
      pos[h.code] = { sh: h.qty, cost: h.px || 0, buyDate: dsh(h.date || ''), peak: h.px || 0, entry: h.px || 0 };
    });
    var trs = [];
    (d.trades || []).forEach(function (t) {
      trs.push({
        d: dsh(t.date), act: (t.act === 'buy' || t.act === 'BUY') ? 'BUY' : 'SELL',
        code: t.code, n: cname(t.code), sh: t.shares, px: t.px,
        amt: Math.round((t.px || 0) * (t.shares || 0) * 100) / 100,
        fee: 0, note: t.reason || '', holdDays: null, pnl: null, pnlPct: null
      });
    });
    var endD = navD.length ? navD[navD.length - 1] : '';
    var cash = nav.length ? nav[nav.length - 1] : 0;
    if (idx) {
      for (k in pos) {
        var px = QE.priceAt(idx, k, endD);
        if (px > 0) cash -= pos[k].sh * px;
      }
    }
    return {
      id: id, capital: d.init || (nav[0] || 1), start: navD[0] || '', lastDate: endD,
      nav: nav, navD: navD, trades: trs, pos: pos, cash: Math.max(0, cash),
      src: 'snap', ver: 'snap'
    };
  }

  function injectSnap() {
    ['momentum', 'earth', 'lowfreq'].forEach(function (id) {
      if (QE.STRATS[id]) QE.STRATS[id].group = '核心引擎';
    });
    if (typeof SNAP === 'undefined' || !SNAP || !SNAP.s) return;
    SNAP_ORDER.forEach(function (id) {
      var d = SNAP.s[id];
      if (!d || QE.STRATS[id]) return;
      var mt = SNAP_META[id] || { short: d.name, group: '其他', tag: '快照', tagc: 'blue' };
      var pool = (d.pool || []).map(function (c) { return { c: c, n: cname(c) }; });
      var cfg0 = d.cfg || {};
      QE.STRATS[id] = {
        id: id, name: d.name, short: mt.short, sub: d.sub || '',
        exec: 'snapshot', time: (cfg0.exec || '14:50').slice(0, 5), weekday: 0,
        pool: pool, bench: { c: '510300', n: '沪深300' },
        cfg: {
          topK: cfg0.topN || 1, commission: cfg0.comm || 0, slip: cfg0.slip || 0, minLot: 100,
          fallback: (cfg0.fallback && cfg0.fallback !== '0') ? { c: cfg0.fallback, n: cname(cfg0.fallback) } : null,
          windows: [], weights: [], volTarget: null, volWin: null
        },
        snapshot: true, official: !!d.official, engine: !!d.engine,
        tag: mt.tag, tagc: mt.tagc, group: mt.group, note: d.note || ''
      };
      APP.settings[id] = { capital: d.init || 5000, start: d.start ? dsh(d.start) : '', fixed: true };
      APP.accounts[id] = buildSnapAccount(id, d);
      APP.tradePage[id] = 1; APP.calMode[id] = 'd'; APP.calPage[id] = { d: '', m: '' };
    });
  }

"""

old1 = "  function ensureAccounts() {\n    var hasHist"
assert old1 in s, "anchor1"
s = s.replace(old1, BLOCK + "  function ensureAccounts() {\n    injectSnap();\n    var hasHist", 1)

old2 = """    for (var id in QE.STRATS) {
      var st = APP.settings[id];
      var a = APP.accounts[id];"""
assert old2 in s, "anchor2"
s = s.replace(old2, """    for (var id in QE.STRATS) {
      if (QE.STRATS[id].snapshot) continue;
      var st = APP.settings[id];
      var a = APP.accounts[id];""", 1)

old3 = """    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      if (a.lastDate && a.lastDate >= lastClosed) { metrics[id] = QE.metrics(a, idx, s); continue; }"""
assert old3 in s, "anchor3"
s = s.replace(old3, """    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      if (s.snapshot) { metrics[id] = snapMetrics(id, SNAP.s[id], a.nav); continue; }
      if (a.lastDate && a.lastDate >= lastClosed) { metrics[id] = QE.metrics(a, idx, s); continue; }""", 1)

old4 = """    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      var p = QE.pendingSignal(s, a, idx, DATA.rt, t);"""
assert old4 in s, "anchor4"
s = s.replace(old4, """    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      if (s.snapshot) { pend[id] = { actions: [], ranks: [], done: true, note: '快照策略不含今日实盘信号', snap: true }; continue; }
      var p = QE.pendingSignal(s, a, idx, DATA.rt, t);""", 1)

io.open(P, "w", encoding="utf-8", newline="\n").write(s)
print("patch1 ok", len(s))
