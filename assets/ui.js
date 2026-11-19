/* ui.js — 界面渲染与自动记账调度 */
(function () {
  'use strict';
  var SKEY = 'qw_state_v4';
  var APP = {
    settings: {
      momentum: { capital: 100000, start: '2020-01-02' },
      earth: { capital: 5000, start: '2020-01-02' },
      lowfreq: { capital: 10000, start: '2020-01-02' }
    },
    accounts: {},
    ack: {},
    view: 'home',
    notifyOn: false,
    tradePage: { momentum: 1, earth: 1, lowfreq: 1 },
    calMode: { momentum: 'd', earth: 'd', lowfreq: 'd' },
    calPage: { momentum: { d: '', m: '' }, earth: { d: '', m: '' }, lowfreq: { d: '', m: '' } }
  };
  var idx = null, lastClosed = null, pend = {}, metrics = {}, booted = false, booting = false;

  /* ---------- 基础工具 ---------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(v) { if (v == null || isNaN(v)) return '--'; var n = Math.round(v); if (n === 0) n = 0; return n.toLocaleString('en-US'); }
  function pct(v, d) { if (v == null || isNaN(v)) return '--'; d = d == null ? 2 : d; return (v * 100).toFixed(d) + '%'; }
  function spct(v, d) { if (v == null || isNaN(v)) return '--'; return (v > 0 ? '+' : '') + pct(v, d); }
  function cls(v) { return v > 0 ? 'up' : (v < 0 ? 'dn' : 'flat'); }
  function pad(x) { return (x < 10 ? '0' : '') + x; }
  var NOWO = null;
  try { var qn = new URLSearchParams(location.search).get('now'); if (qn) { var dt = new Date(qn); if (!isNaN(dt)) NOWO = dt; } } catch (e) { }
  function nowDate() { return NOWO || new Date(); }
  function todayStr() { var d = nowDate(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHM() { var d = nowDate(); return d.getHours() * 100 + d.getMinutes(); }
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast on';
    clearTimeout(t._t); t._t = setTimeout(function () { t.className = 'toast'; }, 2000);
  }

  /* ---------- 状态持久化 ---------- */
  function loadState() {
    try {
      var o = JSON.parse(localStorage.getItem(SKEY) || 'null');
      if (o) {
        if (o.settings) for (var k in o.settings) if (APP.settings[k]) APP.settings[k] = o.settings[k];
        if (o.accounts) APP.accounts = o.accounts;
        if (o.ack) APP.ack = o.ack;
        if (o.notifyOn != null) APP.notifyOn = o.notifyOn;
      }
    } catch (e) { }
  }
  function saveState() {
    var acc = {};
    for (var id in APP.accounts) {
      var a = APP.accounts[id];
      acc[id] = {
        id: a.id, capital: a.capital, start: a.start, lastDate: a.lastDate,
        cash: a.cash, pos: a.pos, nav: a.nav, navD: (a.navD || []), trades: a.trades.slice(-3000),
        freezeMap: a.freezeMap || {}, coolMap: a.coolMap || {}
      };
    }
    try {
      localStorage.setItem(SKEY, JSON.stringify({ settings: APP.settings, accounts: acc, ack: APP.ack, notifyOn: APP.notifyOn }));
    } catch (e) { }
  }

  function allCodes() {
    var set = {};
    for (var id in QE.STRATS) {
      var s = QE.STRATS[id];
      s.pool.forEach(function (p) { set[p.c] = 1; });
      set[s.bench.c] = 1;
      if (s.cfg.bond) set[s.cfg.bond] = 1;
      if (s.cfg.fallback) set[s.cfg.fallback.c] = 1;
    }
    return Object.keys(set);
  }

  /* ---------- 自动记账 ---------- */
  function calcLastClosed() {
    var t = todayStr();
    var bench = QE.STRATS.momentum.bench.c;
    var o = idx.byCode[bench];
    if (!o) return t;
    var hasToday = o.map[t] !== undefined;
    var hm = nowHM();
    if (hasToday && hm >= 1505) return t;
    // 取今天之前最后一个交易日
    var cal = idx.calendar;
    for (var i = cal.length - 1; i >= 0; i--) if (cal[i] < t) return cal[i];
    return cal[cal.length - 1];
  }

  /* ===== 快照策略：官方接口 / 本地复算（非自动记账） ===== */
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

  function ensureAccounts() {
    injectSnap();
    var hasHist = (typeof HIST !== 'undefined' && HIST && HIST.cal && HIST.cal.length);
    for (var id in QE.STRATS) {
      if (QE.STRATS[id].snapshot) continue;
      var st = APP.settings[id];
      var a = APP.accounts[id];
      /* 有真实交割单的策略：直接以聚宽记录为准，不再回放模拟 */
      if (hasHist && HIST[id]) {
        var ver = histVer(HIST[id]);
        if (!a || a.src !== 'hist' || a.ver !== ver) {
          a = buildHistAccount(id, HIST[id], st);
          APP.accounts[id] = a;
        }
        st.capital = HIST[id].cap;
        st.start = HIST.cal[0];
        continue;
      }
      // 旧缓存里的成交记录没有 holdDays/pnl 字段 → 整账重算一次
      var stale = !!(a && a.trades && a.trades.length && !('holdDays' in a.trades[a.trades.length - 1]));
      if (!a || a.capital !== st.capital || a.start !== st.start || stale) {
        a = QE.newAccount(id, st.capital, st.start);
        APP.accounts[id] = a;
      }
    }
  }

  /* ---------- 真实交割单账户（聚宽导出） ---------- */
  function histVer(H) {
    return (H.cap || 0) + '|' + HIST.cal[HIST.cal.length - 1] + '|' +
      (H.tr ? H.tr.length : (H.sw ? H.sw.length : 0));
  }

  function buildHistAccount(id, H, st) {
    var cal = HIST.cal, strat = QE.STRATS[id];
    var a = QE.newAccount(id, H.cap, cal[0]);
    a.capital = H.cap;
    a.nav = H.nav.slice();
    a.navD = cal.slice();
    a.lastDate = cal[cal.length - 1];
    a.src = 'hist';
    a.ver = histVer(H);
    a.cash = H.cap;
    a.pos = {};
    var pos = a.pos, i, d, c;

    if (H.tr) {
      /* 买地球：逐笔真实成交 */
      a.trades = H.tr.map(function (t) {
        var costPx = null;
        if (t.act === 'SELL' && t.pnl != null && t.sh > 0) {
          costPx = Math.round((t.px - t.pnl / t.sh) * 1000) / 1000;
        }
        return {
          d: t.d, act: t.act, code: t.code, n: t.n, sh: t.sh, px: t.px,
          amt: t.amt, fee: t.fee, note: '', costPx: costPx,
          holdDays: t.hold, pnl: t.pnl, pnlPct: t.pnlPct
        };
      });
      H.tr.forEach(function (t) {
        if (t.act === 'BUY') {
          var p = pos[t.code];
          if (!p) p = pos[t.code] = { sh: 0, cost: t.px, buyDate: t.d, peak: t.px, entry: t.px };
          p.sh += t.sh;
          p.cost = t.px;
          if (!(p.peak >= t.px)) p.peak = t.px;
        } else if (pos[t.code]) {
          pos[t.code].sh -= t.sh;
          if (pos[t.code].sh <= 0) delete pos[t.code];
        }
        a.cash = t.c;
      });
      /* 真实当前持仓：正向累加会被份额折算污染，以交割单反推结果为准 */
      if (H.pos) {
        var np = {};
        for (var code in H.pos) {
          var last = null;
          for (i = H.tr.length - 1; i >= 0; i--) {
            if (H.tr[i].code === code && H.tr[i].act === 'BUY') { last = H.tr[i]; break; }
          }
          np[code] = {
            sh: H.pos[code], cost: last ? last.px : 0,
            buyDate: last ? last.d : '', peak: last ? last.px : 0, entry: last ? last.px : 0
          };
        }
        a.pos = np;
      }
      if (H.cash != null) a.cash = H.cash;
      return a;
    }

    /* 低频：由真实净值 + 反推持仓序列重建成交（每笔锚定真实净值，避免误差累积） */
    var holdSeq = H.hold || [], prev = null, cash = H.cap;
    var tr = [];
    for (i = 0; i < cal.length; i++) {
      d = cal[i]; c = holdSeq[i];
      if (!c || c === prev) continue;
      var px = QE.priceAt(idx, c, d);
      if (!(px > 0)) continue;
      var nv = H.nav[i] || 0;
      if (prev && pos[prev]) {
        var o = pos[prev];
        var sp = QE.priceAt(idx, prev, d) || px;
        var amtS = Math.round(o.sh * sp * 100) / 100;
        var feeS = Math.round(amtS * 0.00005 * 100) / 100;
        tr.push({
          d: d, act: 'SELL', code: prev, n: QE.nameOf(strat, prev), sh: o.sh, px: sp,
          amt: amtS, fee: feeS, note: '换仓', costPx: o.cost,
          holdDays: QE.tradingDaysBetween(idx, o.buyDate, d),
          pnl: Math.round((sp - o.cost) * o.sh * 100) / 100,
          pnlPct: o.cost > 0 ? sp / o.cost - 1 : 0
        });
        delete pos[prev];
      }
      var sh = Math.floor(nv * 0.999 / px / 100) * 100;
      if (sh < 100) continue;
      var amtB = Math.round(sh * px * 100) / 100;
      var feeB = Math.round(amtB * 0.00005 * 100) / 100;
      tr.push({
        d: d, act: 'BUY', code: c, n: QE.nameOf(strat, c), sh: sh, px: px,
        amt: amtB, fee: feeB, note: '换仓', costPx: null,
        holdDays: null, pnl: null, pnlPct: null
      });
      cash = Math.round((nv - amtB - feeB) * 100) / 100;
      pos[c] = { sh: sh, cost: px, buyDate: d, peak: px, entry: px };
      prev = c;
    }
    a.trades = tr;
    a.cash = Math.max(0, cash);
    return a;
  }

  function runAll() {
    ensureAccounts();
    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      if (s.snapshot) { metrics[id] = snapMetrics(id, SNAP.s[id], a.nav); continue; }
      if (a.lastDate && a.lastDate >= lastClosed) { metrics[id] = QE.metrics(a, idx, s); continue; }
      QE.replay(a, s, idx, lastClosed);
      metrics[id] = QE.metrics(a, idx, s);
    }
    computePending();
    saveState();
  }

  function isTradingDay(d) {
    var o = idx.byCode[QE.STRATS.momentum.bench.c];
    return !!(o && o.map[d] !== undefined);
  }

  function computePending() {
    var t = todayStr();
    pend = {};
    for (var id in QE.STRATS) {
      var s = QE.STRATS[id], a = APP.accounts[id];
      if (s.snapshot) { pend[id] = { actions: [], ranks: [], done: true, note: '快照策略不含今日实盘信号', snap: true }; continue; }
      var p = QE.pendingSignal(s, a, idx, DATA.rt, t);
      // 非交易日 → 不产生动作
      if (!isTradingDay(t)) p.actions = [];
      // 已收盘并已自动执行 → 今日动作清空
      if (a.lastDate === t && nowHM() >= 1505) p.actions = [];
      p.done = APP.ack[t] && APP.ack[t][id];
      pend[id] = p;
    }
  }

  /* ---------- 时间 ---------- */
  function nextRun(id) {
    var s = QE.STRATS[id];
    var hm = s.time.replace(':', '') * 1;
    var now = nowDate();
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    for (var i = 0; i < 10; i++) {
      var wd = d.getDay();
      var ok = true;
      if (id === 'momentum') ok = (wd === 4);
      else ok = (wd !== 0 && wd !== 6);
      if (ok) {
        if (i === 0 && nowHM() >= hm) { } else {
          return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(hm / 100), hm % 100);
        }
      }
      d.setDate(d.getDate() + 1);
    }
    return now;
  }
  function cdText(target) {
    var diff = target - nowDate();
    if (diff <= 0) return '已到时点';
    var m = Math.floor(diff / 60000), h = Math.floor(m / 60);
    if (h >= 24) return Math.floor(h / 24) + '天' + (h % 24) + '小时后';
    if (h > 0) return h + '小时' + (m % 60) + '分后';
    return m + '分钟后';
  }
  function md(d) { return (d.getMonth() + 1) + '月' + d.getDate() + '日'; }

  /* ---------- 计算：实时估值 ---------- */
  function liveValue(id) {
    var a = APP.accounts[id];
    var mv = 0, mvPrev = 0, list = QE.posList(a);
    for (var i = 0; i < list.length; i++) {
      var rt = DATA.rt[list[i].code];
      var px = rt && rt.price > 0 ? rt.price : (QE.seriesTo(idx, list[i].code, a.lastDate) || []).pop() || list[i].cost;
      mv += list[i].sh * px;
      // 组合涨跌用「昨收」口径，实时行情带 prev 时优先用它
      var pv = (rt && rt.prev > 0) ? rt.prev : prevClose(list[i].code);
      mvPrev += list[i].sh * (pv > 0 ? pv : px);
    }
    var today = todayStr();
    var tradingToday = isTradingDay(today);
    var navArr = a.nav, n = navArr.length;
    // 参考日：今天有行情就是今天；休市/未开盘则回退到最近一个收盘日
    var refDate = tradingToday ? today : (lastClosed || today);
    var prev;
    if ((!tradingToday || a.lastDate === today) && n > 1) {
      prev = navArr[n - 2];            // 已记到参考日 → 与前一交易日比
    } else {
      prev = n ? navArr[n - 1] : a.capital;   // 盘中未记账 → 与昨收净值比
    }
    var cur = a.cash + mv;
    return {
      cur: cur, mv: mv, cash: a.cash,
      dayPnl: cur - prev, dayPct: prev > 0 ? cur / prev - 1 : 0,
      combPct: mvPrev > 0 ? mv / mvPrev - 1 : null,   // 持仓组合自身涨跌（不含现金）
      refDate: refDate, refLabel: refDate === today ? '今日' : refDate.slice(5),
      posN: list.length
    };
  }
  /* 昨收：优先取日线倒数第二根（实时价当日已并入时） */
  function prevClose(code) {
    var s = QE.seriesTo(idx, code, lastClosed || todayStr());
    if (!s || s.length < 2) return null;
    return s[s.length - 2];
  }
  function priceOf(code) {
    var rt = DATA.rt[code];
    if (rt && rt.price > 0) return rt.price;
    var a = lastClosed || todayStr();
    var s = QE.seriesTo(idx, code, a);
    return s && s.length ? s[s.length - 1] : null;
  }

  /* ---------- SVG 图表 ---------- */
  function navPath(navs, w, h) {
    if (!navs || navs.length < 2) return '';
    var min = Math.min.apply(null, navs), max = Math.max.apply(null, navs);
    var pad = (max - min) * 0.12 || 1;
    min -= pad; max += pad;
    var n = navs.length, pts = [];
    for (var i = 0; i < n; i++) {
      var x = (i / (n - 1)) * w;
      var y = h - ((navs[i] - min) / (max - min)) * h;
      pts.push((i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1));
    }
    return pts.join(' ');
  }
  function chart(navs, opt) {
    opt = opt || {};
    var w = 600, h = opt.h || 150;
    if (!navs || navs.length < 2) return '<div class="empty">数据不足，无法绘制</div>';
    var up = navs[navs.length - 1] >= navs[0];
    var color = opt.color || (up ? '#ff4d4f' : '#12b886');
    var p = navPath(navs, w, h);
    var area = p + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
    var gid = 'g' + Math.random().toString(36).slice(2, 7);
    var grid = '';
    for (var i = 1; i < 4; i++) {
      var y = (h / 4) * i;
      grid += '<line x1="0" y1="' + y + '" x2="' + w + '" y2="' + y + '" stroke="#1b2534" stroke-width="1"/>';
    }
    var min = Math.min.apply(null, navs), max = Math.max.apply(null, navs);
    return '<svg class="chart" viewBox="0 0 ' + w + ' ' + (h + 4) + '" preserveAspectRatio="none" style="height:' + (opt.h || 150) + 'px">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.26"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<path d="' + area + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + p + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' +
      '</svg>' +
      '<div class="legend"><span>最低 ' + money(min) + '</span><span>最高 ' + money(max) + '</span><span>最新 ' + money(navs[navs.length - 1]) + '</span></div>';
  }

  /* ---------- 收益分析：序列 / 走势图 / 日历 ---------- */
  function perfData(a) {
    var nav = a.nav || [], navD = a.navD || [], out = [];
    if (!nav.length) return out;
    var base = a.capital || nav[0], peak = -Infinity;
    for (var i = 0; i < nav.length; i++) {
      var v = nav[i];
      peak = Math.max(peak, v);
      out.push({
        d: navD[i] || '',
        v: v,
        cum: base > 0 ? v / base - 1 : 0,
        dd: peak > 0 ? v / peak - 1 : 0,
        ret: i > 0 && nav[i - 1] > 0 ? v / nav[i - 1] - 1 : 0,
        pnl: i > 0 ? v - nav[i - 1] : 0
      });
    }
    return out;
  }

  function maxDDInfo(rows) {
    var peakV = -Infinity, peakI = 0, best = 0, bi = 0, bj = 0;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].v > peakV) { peakV = rows[i].v; peakI = i; }
      var dd = peakV > 0 ? rows[i].v / peakV - 1 : 0;
      if (dd < best) { best = dd; bi = peakI; bj = i; }
    }
    var rec = null;
    for (var k = bj + 1; k < rows.length; k++) {
      if (rows[k].v >= rows[bi].v) { rec = k - bj; break; }
    }
    return { mdd: best, s: rows[bi] ? rows[bi].d : '', e: rows[bj] ? rows[bj].d : '', rec: rec };
  }

  /* 规整刻度：返回 min~max 之间的“好看”数值 */
  function niceTicks(min, max, count) {
    var span = max - min;
    if (!(span > 0)) return [min];
    var step = Math.pow(10, Math.floor(Math.log(span / count) / Math.LN10));
    var err = span / count / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3.5) step *= 5;
    else if (err >= 1.5) step *= 2;
    var out = [], v = Math.ceil(min / step - 1e-9) * step;
    for (; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
    return out;
  }

  /* 走势图悬停数据缓存：id -> 几何信息 */
  var PC = {};

  function perfChart(a, id) {
    var rows = perfData(a);
    if (rows.length < 2) return '<div class="empty">数据不足，无法绘制</div>';
    var W = 600, L = 44, R = 10, T = 12, HH = 130, GAP = 26, DH = 56;
    var cums = [], dds = [], i;
    for (i = 0; i < rows.length; i++) { cums.push(rows[i].cum); dds.push(rows[i].dd); }
    var cMax = Math.max.apply(null, cums.concat([0.0001]));
    var cMin = Math.min.apply(null, cums.concat([0]));
    var pad = (cMax - cMin) * 0.10 || 0.01;
    cMax += pad; cMin -= pad;
    var ddMin = Math.min.apply(null, dds.concat([-0.0001]));
    var ddMax = 0;
    var plotW = W - L - R;
    var vbH = T + HH + GAP + DH + 26;

    function X(k) { return L + (k / (rows.length - 1)) * plotW; }
    function YC(v) { return T + HH - ((v - cMin) / (cMax - cMin)) * HH; }
    function YD(v) { return T + HH + GAP + ((ddMax - v) / (ddMax - ddMin)) * DH; }

    var pC = '', pD = '';
    for (i = 0; i < rows.length; i++) {
      pC += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + YC(cums[i]).toFixed(1);
      pD += (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + YD(dds[i]).toFixed(1);
    }
    var y0 = YC(0);
    var areaC = pC + ' L' + X(rows.length - 1).toFixed(1) + ' ' + y0.toFixed(1) +
      ' L' + X(0).toFixed(1) + ' ' + y0.toFixed(1) + ' Z';
    var areaD = pD + ' L' + X(rows.length - 1).toFixed(1) + ' ' + YD(0).toFixed(1) +
      ' L' + X(0).toFixed(1) + ' ' + YD(0).toFixed(1) + ' Z';

    var gid = 'pg' + Math.random().toString(36).slice(2, 7);
    var grid = '', ticks = '';
    var cTicks = niceTicks(cMin, cMax, 3);
    cTicks.forEach(function (v) {
      var y = YC(v);
      if (Math.abs(v) < 1e-9) return;
      grid += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) + '" stroke="#1b2534" stroke-width="1"/>';
      ticks += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="#55637a" font-size="10">' + pct(v, 0) + '</text>';
    });
    grid += '<line x1="' + L + '" y1="' + y0.toFixed(1) + '" x2="' + W + '" y2="' + y0.toFixed(1) + '" stroke="#3a4a63" stroke-width="1" stroke-dasharray="4 3"/>';
    ticks += '<text x="' + (L - 6) + '" y="' + (y0 + 3.5).toFixed(1) + '" text-anchor="end" fill="#8a99b0" font-size="10">0%</text>';

    var dTicks = [ddMin];
    dTicks.forEach(function (v) {
      var y = YD(v);
      if (Math.abs(v) < 1e-9) return;
      grid += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + W + '" y2="' + y.toFixed(1) + '" stroke="#1b2534" stroke-width="1"/>';
      ticks += '<text x="' + (L - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end" fill="#55637a" font-size="10">' + pct(v, 0) + '</text>';
    });

    var dd = maxDDInfo(rows), mark = '';
    if (dd.mdd < -0.001) {
      var bi = 0;
      for (i = 0; i < rows.length; i++) if (rows[i].d === dd.e) { bi = i; break; }
      var mx = X(bi), my = YC(cums[bi]);
      var right = mx > W * 0.55;
      mark = '<circle cx="' + mx.toFixed(1) + '" cy="' + my.toFixed(1) + '" r="3" fill="#ff4d4f" stroke="#0e1622" stroke-width="1.5"/>' +
        '<text x="' + (right ? mx - 7 : mx + 7).toFixed(1) + '" y="' + (my + 14).toFixed(1) + '" ' +
        'text-anchor="' + (right ? 'end' : 'start') + '" fill="#ff8b8d" font-size="10">' +
        '最大回撤 ' + pct(dd.mdd, 1) + '</text>';
    }

    /* 末端“最新”标记 */
    var lastI = rows.length - 1, lx = X(lastI), ly = YC(cums[lastI]);
    var tail = '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="3" fill="#7fb0ff"/>' +
      '<circle cx="' + lx.toFixed(1) + '" cy="' + ly.toFixed(1) + '" r="7" fill="#4d8bff" opacity=".18"/>';

    var yearTicks = '', lastY = '';
    for (i = 0; i < rows.length; i++) {
      var y = rows[i].d.slice(0, 4);
      if (y && y !== lastY) {
        lastY = y;
        yearTicks += '<text x="' + X(i).toFixed(1) + '" y="' + (T + HH + GAP + DH + 18) + '" text-anchor="middle" fill="#55637a" font-size="10">' + y + '</text>';
      }
    }

    PC[id] = { rows: rows, L: L, plotW: plotW, vbW: W, vbH: vbH, X: X, YC: YC, YD: YD,
      top: T, bot: T + HH + GAP + DH };

    var tipId = 'pct-' + id, gdId = 'pcg-' + id;
    return '<div class="pcwrap">' +
      '<svg class="pchart" id="pcv-' + id + '" viewBox="0 0 ' + W + ' ' + vbH + '" preserveAspectRatio="xMidYMid meet" ' +
      'onmousemove="UI.pcMove(event,\'' + id + '\')" onmouseleave="UI.pcOut(\'' + id + '\')" ' +
      'ontouchstart="UI.pcMove(event,\'' + id + '\')" ontouchmove="UI.pcMove(event,\'' + id + '\')" ontouchend="UI.pcOut(\'' + id + '\')">' +
      '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#4d8bff" stop-opacity=".30"/>' +
      '<stop offset="100%" stop-color="#4d8bff" stop-opacity="0"/></linearGradient>' +
      '<linearGradient id="' + gid + 'd" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="#ff4d4f" stop-opacity=".26"/>' +
      '<stop offset="100%" stop-color="#ff4d4f" stop-opacity=".02"/></linearGradient></defs>' +
      grid +
      '<path d="' + areaC + '" fill="url(#' + gid + ')"/>' +
      '<path d="' + pC + '" fill="none" stroke="#4d8bff" stroke-width="1.7" vector-effect="non-scaling-stroke"/>' +
      mark + tail +
      '<path d="' + areaD + '" fill="url(#' + gid + 'd)"/>' +
      '<path d="' + pD + '" fill="none" stroke="#ff4d4f" stroke-width="1.2" vector-effect="non-scaling-stroke"/>' +
      '<line x1="' + L + '" y1="' + YD(0).toFixed(1) + '" x2="' + W + '" y2="' + YD(0).toFixed(1) + '" stroke="#3a4a63" stroke-width="1"/>' +
      ticks + yearTicks +
      '<g id="' + gdId + '" style="display:none;pointer-events:none">' +
      '<line class="gv" x1="0" y1="' + T + '" x2="0" y2="' + (T + HH + GAP + DH) + '" stroke="#5b6b85" stroke-width="1" stroke-dasharray="3 3"/>' +
      '<line class="gh" x1="' + L + '" y1="0" x2="' + W + '" y2="0" stroke="#5b6b85" stroke-width="1" stroke-dasharray="3 3" opacity=".55"/>' +
      '<circle class="gc1" cx="0" cy="0" r="3.6" fill="#4d8bff" stroke="#0e1622" stroke-width="2"/>' +
      '<circle class="gc2" cx="0" cy="0" r="3" fill="#ff4d4f" stroke="#0e1622" stroke-width="1.6"/>' +
      '</g></svg>' +
      '<div class="pctip" id="' + tipId + '"></div></div>';
  }

  /* 悬停：十字线 + 详情浮层 */
  function pcMove(ev, id) {
    var m = PC[id];
    if (!m) return;
    var svg = document.getElementById('pcv-' + id), gd = document.getElementById('pcg-' + id);
    var tip = document.getElementById('pct-' + id);
    if (!svg || !gd || !tip) return;
    var r = svg.getBoundingClientRect();
    if (!r.width) return;
    var e = ev.touches && ev.touches.length ? ev.touches[0] : ev;
    var x = (e.clientX - r.left) * m.vbW / r.width;
    var n = m.rows.length;
    var k = Math.round((x - m.L) / m.plotW * (n - 1));
    if (k < 0) k = 0; if (k > n - 1) k = n - 1;
    var row = m.rows[k];
    var gx = m.X(k), gy = m.YC(row.cum), dy = m.YD(row.dd);

    gd.style.display = '';
    var gv = gd.querySelector('.gv'), gh = gd.querySelector('.gh');
    gv.setAttribute('x1', gx.toFixed(1)); gv.setAttribute('x2', gx.toFixed(1));
    gh.setAttribute('y1', gy.toFixed(1)); gh.setAttribute('y2', gy.toFixed(1));
    var c1 = gd.querySelector('.gc1'), c2 = gd.querySelector('.gc2');
    c1.setAttribute('cx', gx.toFixed(1)); c1.setAttribute('cy', gy.toFixed(1));
    c2.setAttribute('cx', gx.toFixed(1)); c2.setAttribute('cy', dy.toFixed(1));

    tip.innerHTML =
      '<div class="td">' + row.d + '</div>' +
      '<div class="tl"><i class="dt b"></i><span>累计收益</span><b class="' + cls(row.cum) + '">' + spct(row.cum) + '</b></div>' +
      '<div class="tl"><i class="dt r"></i><span>当日涨跌</span><b class="' + cls(row.ret) + '">' + spct(row.ret) + '</b></div>' +
      '<div class="tl"><i class="dt g"></i><span>当日盈亏</span><b class="' + cls(row.pnl) + '">' + (row.pnl >= 0 ? '+' : '') + money(row.pnl) + '</b></div>' +
      '<div class="tl"><i class="dt y"></i><span>回撤</span><b class="' + (row.dd < 0 ? 'dn' : 'flat') + '">' + pct(row.dd, 2) + '</b></div>' +
      '<div class="tl"><i class="dt n"></i><span>总资产</span><b class="sm">' + money(row.v) + '</b></div>';
    tip.style.display = 'block';

    var px = gx * r.width / m.vbW;
    var py = gy * r.height / m.vbH;
    var flip = px > r.width * 0.56;
    tip.style.transform = flip ? 'translateX(-100%)' : 'none';
    tip.style.left = (flip ? px - 12 : px + 12) + 'px';
    var th = tip.offsetHeight || 120;
    var top = py - th * 0.42;
    if (top < 2) top = 2;
    if (top + th > r.height - 2) top = Math.max(2, r.height - th - 2);
    tip.style.top = top + 'px';
  }

  function pcOut(id) {
    var gd = document.getElementById('pcg-' + id), tip = document.getElementById('pct-' + id);
    if (gd) gd.style.display = 'none';
    if (tip) tip.style.display = 'none';
  }

  /* 月 / 年聚合 */
  function monthAgg(rows) {
    var m = {}, order = [];
    for (var i = 0; i < rows.length; i++) {
      var ym = (rows[i].d || '').slice(0, 7);
      if (!ym) continue;
      if (!m[ym]) { m[ym] = { ym: ym, base: i > 0 ? rows[i - 1].v : rows[i].v, last: rows[i].v }; order.push(ym); }
      m[ym].last = rows[i].v;
    }
    var out = {};
    order.forEach(function (k) {
      var x = m[k];
      out[k] = { ret: x.base > 0 ? x.last / x.base - 1 : 0, pnl: x.last - x.base };
    });
    return out;
  }
  function yearAgg(rows) {
    var m = {}, order = [];
    for (var i = 0; i < rows.length; i++) {
      var y = (rows[i].d || '').slice(0, 4);
      if (!y) continue;
      if (!m[y]) { m[y] = { y: y, base: i > 0 ? rows[i - 1].v : rows[i].v, last: rows[i].v }; order.push(y); }
      m[y].last = rows[i].v;
    }
    var out = {};
    order.forEach(function (k) {
      var x = m[k];
      out[k] = { ret: x.base > 0 ? x.last / x.base - 1 : 0, pnl: x.last - x.base };
    });
    return out;
  }

  function heatCls(r) {
    if (r == null || isNaN(r)) return 'f0';
    var a = Math.abs(r);
    if (a < 0.005) return r >= 0 ? 'u0' : 'd0';
    if (a < 0.02) return r > 0 ? 'u1' : 'd1';
    if (a < 0.05) return r > 0 ? 'u2' : 'd2';
    return r > 0 ? 'u3' : 'd3';
  }

  /* 有数据的月份 / 年份列表（升序） */
  function ymList(rows) {
    var s = {}, out = [];
    for (var i = 0; i < rows.length; i++) {
      var k = (rows[i].d || '').slice(0, 7);
      if (k && !s[k]) { s[k] = 1; out.push(k); }
    }
    return out.sort();
  }
  function yList(rows) {
    var s = {}, out = [];
    for (var i = 0; i < rows.length; i++) {
      var k = (rows[i].d || '').slice(0, 4);
      if (k && !s[k]) { s[k] = 1; out.push(k); }
    }
    return out.sort();
  }

  function navBar(id, mode, label, canPrev, canNext) {
    var pl = mode === 'd' ? '‹ 上月' : '‹ 上年';
    var nl = mode === 'd' ? '下月 ›' : '下年 ›';
    return '<div class="calnav">' +
      '<button class="cnb" onclick="UI.calPg(\'' + id + '\',\'' + mode + '\',-1)"' + (canPrev ? '' : ' disabled') + '>' + pl + '</button>' +
      '<b class="cnt">' + label + '</b>' +
      '<button class="cnb" onclick="UI.calPg(\'' + id + '\',\'' + mode + '\',1)"' + (canNext ? '' : ' disabled') + '>' + nl + '</button>' +
      '</div>';
  }

  function sumLine(txt, ret, pnl) {
    return '<div class="calsum"><span>' + txt + '</span>' +
      '<b class="' + cls(ret) + '">' + spct(ret) + '</b>' +
      '<em class="' + cls(pnl) + '">(' + (pnl >= 0 ? '+' : '') + money(pnl) + ')</em></div>';
  }

  function calDay(rows, id, pick) {
    var months = ymList(rows);
    if (!months.length) return '<div class="empty">暂无数据</div>';
    var ym = pick && months.indexOf(pick) >= 0 ? pick : months[months.length - 1];
    var mi = months.indexOf(ym);
    var y = +ym.slice(0, 4), mo = +ym.slice(5, 7);
    var map = {};
    rows.forEach(function (r) { if (r.d.slice(0, 7) === ym) map[r.d] = r; });
    var days = new Date(y, mo, 0).getDate();
    // 首个工作日的列索引
    var off = 0;
    for (var d0 = 1; d0 <= 7; d0++) {
      var w0 = new Date(y, mo - 1, d0).getDay();
      if (w0 >= 1 && w0 <= 5) { off = w0 - 1; break; }
    }
    var cells = [];
    for (var i = 0; i < off; i++) cells.push('<div class="cc blank"></div>');
    for (var d = 1; d <= days; d++) {
      var wd = new Date(y, mo - 1, d).getDay();
      if (wd === 0 || wd === 6) continue;
      var key = ym + '-' + (d < 10 ? '0' : '') + d;
      var r = map[key];
      if (r) {
        cells.push('<div class="cc ' + heatCls(r.ret) + '" title="' + key + '">' +
          '<b class="cd">' + d + '</b>' +
          '<i class="cr">' + spct(r.ret) + '</i>' +
          '<i class="cp">' + (r.pnl >= 0 ? '+' : '') + money(r.pnl) + '</i></div>');
      } else {
        cells.push('<div class="cc f0"><b class="cd">' + d + '</b><i class="cr">—</i><i class="cp"></i></div>');
      }
    }
    var agg = monthAgg(rows)[ym] || { ret: 0, pnl: 0 };
    return navBar(id, 'd', y + '年' + mo + '月', mi > 0, mi < months.length - 1) +
      '<div class="calgrid">' +
      ['一', '二', '三', '四', '五'].map(function (w) { return '<div class="cwd">周' + w + '</div>'; }).join('') +
      cells.join('') + '</div>' +
      sumLine('当月收益', agg.ret, agg.pnl);
  }

  function calMonth(rows, id, pick) {
    var years = yList(rows);
    if (!years.length) return '<div class="empty">暂无数据</div>';
    var y = pick && years.indexOf(pick) >= 0 ? pick : years[years.length - 1];
    var yi = years.indexOf(y);
    var agg = monthAgg(rows);
    var html = navBar(id, 'm', y + '年', yi > 0, yi < years.length - 1) + '<div class="mgrid12">';
    for (var m = 1; m <= 12; m++) {
      var k = y + '-' + (m < 10 ? '0' : '') + m;
      var x = agg[k];
      html += '<div class="mc ' + (x ? heatCls(x.ret) : 'f0') + '">' +
        '<b>' + m + '月</b>' +
        (x ? '<i>' + spct(x.ret) + '</i><em>' + (x.pnl >= 0 ? '+' : '') + money(x.pnl) + '</em>' : '<i>—</i><em></em>') +
        '</div>';
    }
    html += '</div>';
    // 本年收益 = 该年最后一日 / 上年最后一日
    var ya = yearAgg(rows)[y] || { ret: 0, pnl: 0 };
    return html + sumLine('本年收益', ya.ret, ya.pnl);
  }

  function calYear(rows, id, a) {
    var agg = yearAgg(rows);
    var keys = Object.keys(agg).sort();
    if (!keys.length) return '<div class="empty">暂无数据</div>';
    var lastK = keys[keys.length - 1];
    var html = '<div class="calhd"><span>年度收益</span><span class="dim">共 ' + keys.length + ' 年</span></div><div class="ygrid">';
    keys.forEach(function (k) {
      var x = agg[k];
      html += '<div class="yc ' + heatCls(x.ret) + '">' +
        (k === lastK ? '<i class="ycur"></i>' : '') +
        '<b>' + k + '年</b>' +
        '<i class="yr">' + spct(x.ret) + '</i>' +
        '<em>' + (x.pnl >= 0 ? '+' : '') + money(x.pnl) + '</em></div>';
    });
    html += '</div>';
    var last = rows[rows.length - 1].v;
    var base = (a && a.capital) || rows[0].v;
    var tr = base > 0 ? last / base - 1 : 0;
    return html + sumLine('总收益', tr, last - base);
  }

  function perfCard(id, a) {
    var rows = perfData(a);
    if (rows.length < 2) return '';
    var dd = maxDDInfo(rows);
    var mode = APP.calMode[id] || 'd';
    var pg = APP.calPage[id] || {};
    var tot = rows[rows.length - 1].cum;
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>收益走势</h2>' +
      '<span class="rt">' + a.start.slice(2) + '~' + rows[rows.length - 1].d.slice(2) + ' · ' + rows.length + ' 日</span></div>';
    html += '<div class="pstats">' +
      '<div><span>区间收益</span><b class="' + cls(tot) + '">' + spct(tot) + '</b></div>' +
      '<div><span>最大回撤</span><b class="dn">' + pct(dd.mdd, 1) + '</b></div>' +
      '<div><span>回撤区间</span><b class="sm">' + (dd.s ? dd.s.slice(2) + '~' + dd.e.slice(5) : '--') + '</b></div>' +
      '<div><span>修复天数</span><b class="sm">' + (dd.rec != null ? dd.rec + ' 日' : '未修复') + '</b></div>' +
      '</div>';
    html += perfChart(a, id);
    html += '<div class="clgd"><span class="l1">策略累计收益</span><span class="l2">回撤</span>' +
      '<span class="l3">悬停查看每日明细</span></div>';

    /* 日 / 月 / 年 日历 */
    html += '<div class="calwrap"><div class="caltabs">' +
      ['d:日收益', 'm:月收益', 'y:年收益'].map(function (s) {
        var p = s.split(':');
        return '<button class="ctb' + (mode === p[0] ? ' on' : '') + '" onclick="UI.cal(\'' + id + '\',\'' + p[0] + '\')">' + p[1] + '</button>';
      }).join('') + '</div>';
    html += mode === 'y' ? calYear(rows, id, a)
      : (mode === 'm' ? calMonth(rows, id, pg.m) : calDay(rows, id, pg.d));
    html += '</div></div>';

    /* 收益口径：成交价 = 时点价；当日净值 = 收盘价 → 成交后剩余时段涨跌计入当日 */
    var tmo = (QE.STRATS[id] && QE.STRATS[id].time) ? QE.STRATS[id].time : (id === 'earth' ? '14:30' : '14:50');
    if (a && a.src === 'hist') {
      html += '<div class="calnote">收益口径：按交割单<b>真实成交价</b>（' + tmo + ' 时点价）成交，当日净值按<b>收盘价</b>重估，' +
        '因此<b>成交后剩余交易时段的涨跌一并计入当日收益</b>，与聚宽逐日对账一致。' +
        '<i>净值用不复权价重建，未做复权调整，可与交割单的成交金额、现金余额逐笔核对。</i></div>';
    } else if (a && a.src === 'snap') {
      var dd0 = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
      html += '<div class="calnote">数据口径：净值与逐日盈亏取自' +
        (QE.STRATS[id].official ? '<b>平台官方绩效接口</b>' : '<b>本地引擎按平台参数复算</b>') +
        '，截至 <b>' + esc(a.navD[a.navD.length - 1] || '') + '</b>。' +
        '<i>' + esc(dd0.note || '') + '</i></div>';
    } else {
      html += '<div class="calnote">收益口径：按 ' + tmo + ' 时点价成交、收盘价重估，成交后剩余时段涨跌计入当日。' +
        '<i>该策略暂无交割单，由引擎按历史日线回放，股数为估算值。</i></div>';
    }
    return html;
  }

  /* ---------- 渲染：总览 ---------- */
  function renderHome() {
    var CORE = ['momentum', 'earth', 'lowfreq'];
    var ids = Object.keys(QE.STRATS);
    var tot = 0, totPrev = 0, rows = [], acts = [];
    CORE.forEach(function (id) {
      var lv = liveValue(id);
      tot += lv.cur; totPrev += (lv.cur - lv.dayPnl);
      if (pend[id] && pend[id].actions.length && !pend[id].done) {
        pend[id].actions.forEach(function (a) { acts.push({ id: id, a: a }); });
      }
    });
    ids.forEach(function (id) {
      rows.push({ id: id, lv: liveValue(id), s: QE.STRATS[id], m: metrics[id] });
    });
    var dayPnl = tot - totPrev;
    var initSum = CORE.reduce(function (x, id) { return x + APP.settings[id].capital; }, 0);

    var html = '';
    html += '<div class="hero">' +
      '<div class="lb">核心三策略合计 · 自动记账</div>' +
      '<div class="big num">' + money(tot) + '<small>元</small></div>' +
      '<div class="row">' +
      '<div>' + (rows[0] ? rows[0].lv.refLabel : '今日') + '盈亏<b class="num ' + cls(dayPnl) + '">' + (dayPnl >= 0 ? '+' : '') + money(dayPnl) + '</b>' +
      '<i class="hp ' + cls(dayPnl) + '">' + spct(totPrev > 0 ? tot / totPrev - 1 : 0) + '</i></div>' +
      '<div>累计收益<b class="num ' + cls(tot - initSum) + '">' + spct(initSum > 0 ? tot / initSum - 1 : 0) + '</b></div>' +
      '<div>投入本金<b class="num">' + money(initSum) + '</b></div>' +
      '<div>数据<b class="num" style="font-size:12px">' + (DATA.lastFetch ? new Date(DATA.lastFetch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--') + '</b></div>' +
      '</div></div>';

    /* 今日待办 */
    if (acts.length) {
      var first = acts[0];
      var tgt = nextRun(first.id);
      html += '<div class="alert"><div class="ah"><span class="tag">今日待办</span>需要操作 ' + acts.length + ' 笔' +
        '<span class="cd" id="cdBox">' + cdText(tgt) + '</span></div>';
      acts.forEach(function (x) {
        var s = QE.STRATS[x.id];
        var qty = x.a.sh ? x.a.sh + '股' : '';
        html += '<div class="arow"><span class="who">' + esc(s.short) + '</span>' +
          '<span class="act ' + (x.a.act === 'BUY' ? 'b' : 's') + '">' + (x.a.act === 'BUY' ? '买入' : '卖出') + '</span>' +
          '<span class="nm">' + esc(x.a.n) + '<em>' + x.a.code + '</em></span>' +
          '<span class="qty num">' + qty + '</span>' +
          '<span class="tm">' + s.time + '</span></div>';
      });
      html += '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn pri" style="flex:1" onclick="UI.ackAll()">标记已操作</button>' +
        '<button class="btn" onclick="UI.copyActions()">复制清单</button></div>';
      html += '</div>';
    } else {
      var done = [];
      ids.forEach(function (id) {
        var a = APP.accounts[id];
        for (var i = 0; i < a.trades.length; i++) if (a.trades[i].d === todayStr()) done.push({ id: id, t: a.trades[i] });
      });
      if (done.length) {
        html += '<div class="alert calm"><div class="ah"><span class="tag">今日已自动记账</span>' + done.length + ' 笔调仓已按收盘价执行' +
          '<span class="cd">' + todayStr().slice(5) + '</span></div>';
        done.slice(0, 6).forEach(function (x) {
          html += '<div class="arow"><span class="who">' + esc(QE.STRATS[x.id].short) + '</span>' +
            '<span class="act ' + (x.t.act === 'BUY' ? 'b' : 's') + '">' + (x.t.act === 'BUY' ? '买入' : '卖出') + '</span>' +
            '<span class="nm">' + esc(x.t.n) + '<em>' + x.t.code + '</em></span>' +
            '<span class="qty num">' + x.t.sh + ' 股 @ ' + x.t.px + '</span></div>';
        });
        html += '<div style="font-size:11.5px;color:var(--sub);margin-top:8px">持仓、现金、净值已自动更新，无需手动记仓。</div></div>';
      } else {
        var todayIsTd = isTradingDay(todayStr());
        var mst = DATA.marketState ? DATA.marketState() : { text: '' };
        var tagTxt = todayIsTd ? '今日状态' : '休市';
        var subTxt = todayIsTd ? '无需操作，持仓自动跟踪中'
          : '今日休市，以下为最近收盘日（' + (lastClosed || '').slice(5) + '）口径';
        html += '<div class="alert calm"><div class="ah"><span class="tag">' + tagTxt + '</span>' + subTxt +
          '<span class="cd">' + md(nextRun('momentum')) + ' 动量轮动</span></div>' +
          '<div style="font-size:11.5px;color:var(--sub);line-height:1.6">三套策略均按规则自动记账，调仓日会自动给出买卖股数；无需手动记录持仓。</div></div>';
      }
    }

    /* 策略卡：按分组渲染 */
    var GROUPS = ['核心引擎', '平台官方', '防守策略'];
    GROUPS.forEach(function (gname) {
      var list = rows.filter(function (r) { return (QE.STRATS[r.id].group || '核心引擎') === gname; });
      if (!list.length) return;
      html += '<div class="gtitle"><span>' + gname + '</span><i>' + list.length + ' 个策略</i></div>';
      html += '<div class="sgrid">';
      list.forEach(function (r) {
        var s = QE.STRATS[r.id], a = APP.accounts[r.id], m = metrics[r.id] || {};
        var navs = a.nav || [];
        var spark = navs.length > 3
          ? '<svg viewBox="0 0 120 46" preserveAspectRatio="none" style="width:120px;height:46px"><path d="' + navPath(navs.slice(-60), 120, 44) + '" fill="none" stroke="' + (navs[navs.length - 1] >= navs[0] ? '#ff4d4f' : '#12b886') + '" stroke-width="1.4" opacity=".75" vector-effect="non-scaling-stroke"/></svg>'
          : '';
        if (s.snapshot) {
          var lastV = navs.length ? navs[navs.length - 1] : 0;
          html += '<div class="sc" onclick="UI.go(\'' + r.id + '\')">' +
            '<div class="sh"><span class="nm">' + esc(s.short || s.name) + '</span>' +
            '<span class="st tk-' + (s.tagc || 'blue') + '">' + esc(s.tag) + '</span></div>' +
            '<div class="v num">' + money(lastV) + '<small>元</small></div>' +
            '<div class="r2"><span>累计 <b class="num ' + cls(m.total) + '">' + (m.total != null ? spct(m.total) : '--') + '</b></span>' +
            '<span>年化 <b class="num ' + cls(m.annual) + '">' + (m.annual != null ? spct(m.annual, 1) : '--') + '</b></span>' +
            '<span>回撤 <b class="num dn">' + (m.mdd != null ? pct(m.mdd, 1) : '--') + '</b></span></div>' +
            '<div class="hint">' + esc(s.sub || '') + (a.lastDate ? '<em>截至 ' + a.lastDate.slice(5) + '</em>' : '') + '</div>' +
            '<div class="spark">' + spark + '</div></div>';
          return;
        }
        var st = pend[r.id] && pend[r.id].actions.length ? { t: '待操作', c: 'act' } : (QE.posList(a).length ? { t: '持有中', c: 'hold' } : { t: '空仓', c: 'cash' });
        var hint;
        if (pend[r.id] && pend[r.id].actions.length) {
          hint = pend[r.id].actions.map(function (x) { return (x.act === 'BUY' ? '买 ' : '卖 ') + x.n + (x.sh ? ' ' + x.sh + '股' : ''); }).join(' · ');
        } else {
          var pos = QE.posList(a);
          hint = pos.length ? pos.map(function (p) { return QE.nameOf(s, p.code) + ' ' + p.sh + '股'; }).join(' · ') : '空仓持币，等待信号';
        }
        html += '<div class="sc" onclick="UI.go(\'' + r.id + '\')">' +
          '<div class="sh"><span class="nm">' + esc(s.name) + '</span><span class="st ' + st.c + '">' + st.t + '</span></div>' +
          '<div class="v num">' + money(r.lv.cur) + '<small>元</small></div>' +
          '<div class="r2"><span>' + r.lv.refLabel + ' <b class="num ' + cls(r.lv.dayPnl) + '">' + (r.lv.dayPnl >= 0 ? '+' : '') + money(r.lv.dayPnl) + '</b>' +
          '<i class="pp ' + cls(r.lv.combPct) + '">' + (r.lv.combPct != null ? '组合 ' + spct(r.lv.combPct) : '空仓') + '</i></span>' +
          '<span>累计 <b class="num ' + cls(m.total) + '">' + (m.total != null ? spct(m.total) : '--') + '</b></span>' +
          '<span>年化 <b class="num ' + cls(m.annual) + '">' + (m.annual != null ? spct(m.annual, 1) : '--') + '</b></span></div>' +
          '<div class="hint">' + esc(hint) + '</div>' +
          '<div class="spark">' + spark + '</div></div>';
      });
      html += '</div>';
    });

    /* 合计曲线 */
    var combo = combinedNav();
    html += '<div class="card" style="margin-top:12px"><div class="chd"><span class="bar"></span><h2>合计净值走势</h2><span class="rt">' + (combo.length ? combo.length + ' 个交易日' : '') + '</span></div>' +
      chart(combo, { h: 160 }) + '</div>';

    $('view-home').innerHTML = html;
  }

  function combinedNav() {
    var ids = ['momentum', 'earth', 'lowfreq'];
    var map = {}, out = [];
    ids.forEach(function (id) {
      var a = APP.accounts[id];
      for (var i = 0; i < a.nav.length; i++) {
        var d = a.navD ? a.navD[i] : null;
        if (!d) continue;
        map[d] = map[d] || {};
        map[d][id] = a.nav[i];
      }
    });
    var dates = Object.keys(map).sort();
    if (dates.length < 3) return [];
    var last = {}, started = {};
    ids.forEach(function (id) { last[id] = APP.settings[id].capital; started[id] = false; });
    for (var i = 0; i < dates.length; i++) {
      var row = map[dates[i]], sum = 0;
      for (var j = 0; j < ids.length; j++) {
        var id = ids[j];
        if (row[id] != null) { last[id] = row[id]; started[id] = true; }
        sum += started[id] ? last[id] : APP.settings[id].capital;
      }
      out.push(sum);
    }
    return out;
  }

  /* ---------- 渲染：策略详情 ---------- */
  function renderStrat(id) {
    var s = QE.STRATS[id], a = APP.accounts[id], m = metrics[id], lv = liveValue(id);
    var p = pend[id] || { actions: [], ranks: [] };
    var pos = QE.posList(a);
    var html = '<div class="dhead"><button class="btn" onclick="UI.go(\'home\')">‹ 总览</button>' +
      '<b>' + esc(s.short || s.name) + '</b>' +
      (s.snapshot ? '<span class="st tk-' + (s.tagc || 'blue') + '">' + esc(s.tag) + '</span>' : '') +
      '<span class="rt">' + esc(s.time) + (s.exec === 'snapshot' ? ' · 快照' : '') + '</span></div>';

    if (s.snapshot) {
      html += snapHead(id, s, a, m);
      html += snapStats(id, s, a, m);
      html += snapPos(id, s, a);
      html += perfCard(id, a);
      html += rankCard(id, p, a);
      html += snapTrades(id, a);
      html += '<div class="card"><div class="chd"><span class="bar"></span><h2>策略规则</h2><span class="rt">' + esc(s.tag) + '</span></div>' +
        '<div class="rules">' + rulesHTML(id) + '</div></div>';
      var dh = $('view-detail');
      if (dh) dh.innerHTML = html;
      return;
    }

    /* 信号卡 */
    var sigCls = 'card', sigTitle, sigBody;
    var todays = [];
    for (var ti = 0; ti < a.trades.length; ti++) if (a.trades[ti].d === todayStr()) todays.push(a.trades[ti]);
    var stateNote = '';
    if (id === 'lowfreq') {
      var frz = [], fm = a.freezeMap || {}, cm = a.coolMap || {}, fc, cc;
      for (fc in fm) if (fm[fc] > 0) frz.push(QE.nameOf(QE.STRATS.lowfreq, fc) + ' 止损冻结 ' + fm[fc] + ' 日');
      for (cc in cm) if (cm[cc] > 0) frz.push(QE.nameOf(QE.STRATS.lowfreq, cc) + ' 止盈冷静 ' + cm[cc] + ' 日');
      if (frz.length) stateNote = frz.join(' · ') + '（仅该标的不买入，其余标的照常轮动）';
    }
    var passN = (p.ranks || []).filter(function (r) { return r.pass; }).length;

    if (p.actions.length && !p.done) {
      sigTitle = '<span style="color:#ff8b8d">● 今日需操作</span>';
      sigBody = p.actions.map(function (x) {
        var amt = x.px ? x.sh * x.px : null;
        return '<div class="arow"><span class="act ' + (x.act === 'BUY' ? 'b' : 's') + '">' + (x.act === 'BUY' ? '买入' : '卖出') + '</span>' +
          '<span class="nm">' + esc(x.n) + '<em>' + x.code + '</em></span>' +
          '<span class="qty num">' + x.sh + ' 股' + (amt ? ' ≈ ' + money(amt) + '元' : '') + '</span></div>';
      }).join('');
      sigBody += '<div style="margin-top:10px;font-size:11.5px;color:var(--sub);line-height:1.6">' +
        '执行时点 <b style="color:var(--warn)">' + s.time + '</b> · ' + cdText(nextRun(id)) +
        '<br>按整百股计算，收盘后系统自动记账，无需手动填持仓。</div>' +
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn pri" style="flex:1" onclick="UI.ack(\'' + id + '\')">标记已操作</button>' +
        '<button class="btn" onclick="UI.copyActions(\'' + id + '\')">复制清单</button></div>';
    } else if (p.actions.length && p.done) {
      sigTitle = '<span style="color:#3ddba8">● 今日已操作</span>';
      sigBody = '<div style="font-size:12.5px;color:var(--sub);line-height:1.7">今日操作已标记完成，收盘后自动记账。<br>' +
        '下一时点：' + md(nextRun(id)) + ' ' + s.time + '（' + cdText(nextRun(id)) + '）</div>';
    } else if (todays.length) {
      sigTitle = '<span style="color:#3ddba8">● 今日已自动调仓</span>';
      sigBody = todays.map(function (t) {
        return '<div class="arow"><span class="act ' + (t.act === 'BUY' ? 'b' : 's') + '">' + (t.act === 'BUY' ? '买入' : '卖出') + '</span>' +
          '<span class="nm">' + esc(t.n) + '<em>' + t.code + '</em></span>' +
          '<span class="qty num">' + t.sh + ' 股 @ ' + t.px + '</span></div>';
      }).join('');
      sigBody += '<div style="margin-top:9px;font-size:11.5px;color:var(--sub);line-height:1.6">' +
        '已按今日收盘价自动记账，持仓与现金已更新。<br>下一时点 ' + md(nextRun(id)) + ' ' + s.time + '（' + cdText(nextRun(id)) + '）</div>';
    } else {
      sigTitle = pos.length ? '<span style="color:#8fb4ff">● 继续持有</span>' : '<span style="color:var(--sub)">● 空仓观望</span>';
      var reason = stateNote || p.note || '';
      sigBody = '<div style="font-size:13px;line-height:1.7">' +
        (pos.length ? pos.map(function (x) { return '<b>' + esc(QE.nameOf(s, x.code)) + '</b> ' + x.sh + ' 股 · 建仓 ' + x.buyDate; }).join('<br>')
          : (stateNote ? '当前持币观望' : '当前无合格标的，资金留在现金/货币ETF')) +
        '</div><div style="margin-top:8px;font-size:11.5px;color:var(--sub)">' + esc(reason) +
        ' · 下一时点 ' + md(nextRun(id)) + ' ' + s.time + '（' + cdText(nextRun(id)) + '）</div>';
    }
    html += '<div class="' + sigCls + '"><div class="chd"><span class="bar"></span><h2>今日信号 · ' + esc(s.name) + '</h2><span class="rt">' + s.time + '</span></div>' +
      '<div style="font-size:13px;font-weight:700;margin-bottom:6px">' + sigTitle + '</div>' + sigBody + '</div>';

    /* 目标组合（动量轮动） */
    if (id === 'momentum' && p.targets && p.targets.length) {
      var isThu = new Date(todayStr() + 'T00:00:00').getDay() === 4;
      var executed = (a.lastDate === todayStr());
      html += '<div class="card tight"><div class="chd"><span class="bar"></span><h2>目标组合</h2>' +
        '<span class="rt">' + (executed ? '今日已执行' : (isThu ? '本周四执行' : '按今日排名 · 下周四执行')) + '</span></div>';
      p.targets.forEach(function (t) {
        var cur = a.pos[t.code] ? a.pos[t.code].sh : 0;
        var tsh = executed ? cur : t.sh;
        var diff = tsh - cur;
        html += '<div class="pos"><div class="l"><div class="nm">' + esc(t.n) + '<em>' + t.code + '</em></div>' +
          '<div class="sb">目标 ' + tsh + ' 股 · 现持 ' + cur + ' 股 · 权重 ' + t.w.toFixed(1) + '%</div></div>' +
          '<div class="r"><div class="pnl num ' + (diff > 0 ? 'up' : (diff < 0 ? 'dn' : '')) + '">' +
          (diff === 0 ? '已对齐' : (diff > 0 ? '+' : '') + diff + ' 股') + '</div>' +
          '<div class="amt num">' + num(t.px, 3) + '</div></div></div>';
      });
      html += '<div class="vnote" style="margin-top:8px">按整百股取整 · 佣金万3 · ×0.99 保守取整；收盘后自动记账，无需手动填单</div></div>';
    }

    /* 指标 */
    html += '<div class="card tight"><div class="chd"><span class="bar"></span><h2>账户（自动记账）</h2><span class="rt">起始 ' + a.start + '</span></div>' +
      '<div class="mgrid">' +
      mi('总资产', money(lv.cur), '') +
      mi(lv.refLabel + '盈亏', (lv.dayPnl >= 0 ? '+' : '') + money(lv.dayPnl), cls(lv.dayPnl)) +
      mi('组合今涨', lv.combPct != null ? spct(lv.combPct) : '空仓', cls(lv.combPct)) +
      mi('累计收益', m ? spct(m.total) : '--', m ? cls(m.total) : '') +
      mi('年化收益', m ? spct(m.annual, 1) : '--', m ? cls(m.annual) : '') +
      mi('最大回撤', m ? pct(m.mdd) : '--', 'dn') +
      mi('夏普比率', m ? m.sharpe.toFixed(2) : '--', '') +
      mi('持仓市值', money(lv.mv), '') +
      mi('可用现金', money(lv.cash), '') +
      '</div></div>';

    /* 持仓 */
    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>当前持仓</h2><span class="rt">' + pos.length + ' 只</span></div>';
    if (!pos.length) html += '<div class="empty">空仓（现金 ' + money(a.cash) + ' 元）</div>';
    else {
      pos.forEach(function (x) {
        var px = priceOf(x.code) || x.cost;
        var pnl = (px - x.cost) * x.sh, pnlPct = px / x.cost - 1;
        var held = QE.tradingDaysBetween(idx, x.buyDate, lastClosed || todayStr());
        html += '<div class="pos"><div class="l"><div class="nm">' + esc(QE.nameOf(s, x.code)) + '<em>' + x.code + '</em></div>' +
          '<div class="sb">' + x.sh + ' 股 · 成本 ' + x.cost.toFixed(3) + ' · 现价 ' + px.toFixed(3) + ' · 持有 ' + held + ' 日</div></div>' +
          '<div class="r"><div class="pnl num ' + cls(pnl) + '">' + (pnl >= 0 ? '+' : '') + money(pnl) + '</div>' +
          '<div class="amt num">' + spct(pnlPct) + '</div></div></div>';
      });
    }
    html += '</div>';

    /* 收益分析：走势 + 日/月/年日历 */
    html += perfCard(id, a);

    /* 波动目标 / 溢价预警（动量轮动专属） */
    if (id === 'momentum' && p.vol) html += volCard(p);
    if (id === 'momentum') html += premiumWarn(p);

    /* 排名 */
    html += rankCard(id, p, a);

    /* 调仓记录（完整口径：金额 / 持有天数 / 盈亏） */
    var PER = 15, totalT = a.trades.length;
    var pages = Math.max(1, Math.ceil(totalT / PER));
    var pg = APP.tradePage[id] || 1;
    if (pg > pages) pg = pages;
    if (pg < 1) pg = 1;
    APP.tradePage[id] = pg;
    var endI = totalT - (pg - 1) * PER;
    var startI = Math.max(0, endI - PER);
    var trs = a.trades.slice(startI, endI).reverse();

    var histSrc = a.src === 'hist';
    var histNote = histSrc
      ? (id === 'earth' ? '聚宽真实成交' : '净值反推·股数为估算')
      : '';
    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
      '<span class="rt">' + (histNote ? '<em class="hsrc">' + histNote + '</em> · ' : '') +
      '共 ' + totalT + ' 笔' + (pages > 1 ? ' · 第 ' + pg + '/' + pages + ' 页' : '') + '</span></div>';
    if (!trs.length) html += '<div class="empty">暂无交易</div>';
    else {
      html += '<div class="tw"><table class="tlog"><thead><tr>' +
        '<th>日期</th><th>方向</th><th>名称/代码</th><th>价格</th><th>数量</th>' +
        '<th>持有</th><th>金额</th><th>盈亏</th></tr></thead><tbody>';
      trs.forEach(function (t) {
        var isB = t.act === 'BUY';
        var pnlCell = t.pnl != null
          ? '<b class="' + cls(t.pnl) + '">' + (t.pnl >= 0 ? '+' : '') + money(t.pnl) + '</b>' +
            '<i class="sub2 ' + cls(t.pnlPct) + '">' + spct(t.pnlPct) + '</i>'
          : '<span style="color:var(--dim)">—</span>';
        html += '<tr><td class="dt">' + t.d.slice(5) + '</td>' +
          '<td><span class="actt ' + (isB ? 'b' : 's') + '">' + (isB ? '买入' : '卖出') + '</span></td>' +
          '<td class="nmc">' + esc(t.n) + '<i class="cd2">' + t.code + '</i></td>' +
          '<td class="num">' + t.px + '</td>' +
          '<td class="num">' + t.sh + '</td>' +
          '<td class="num">' + (t.holdDays != null ? t.holdDays + '天' : '—') + '</td>' +
          '<td class="num">' + money(t.amt) + '</td>' +
          '<td class="num">' + pnlCell + '</td></tr>';
      });
      html += '</tbody></table></div>';
      if (pages > 1) {
        html += '<div class="pager">' +
          '<button class="pgb" onclick="UI.tp(\'' + id + '\',-1)"' + (pg <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
          '<span class="pgi">' + pg + ' / ' + pages + '</span>' +
          '<button class="pgb" onclick="UI.tp(\'' + id + '\',1)"' + (pg >= pages ? ' disabled' : '') + '>下一页 ›</button>' +
          '</div>';
      }
    }
    html += '</div>';

    /* 规则 */
    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>策略规则</h2></div><div class="rules">' + rulesHTML(id) + '</div></div>';

    var host0 = $('view-detail');
    if (host0) host0.innerHTML = html;
  }

  function mi(k, v, c) {
    return '<div class="mi"><div class="k">' + k + '</div><div class="v num ' + (c || '') + '">' + v + '</div></div>';
  }

  /* ---------- 榜单辅助 ---------- */
  function num(v, d) { if (v == null || isNaN(v)) return '--'; return Number(v).toFixed(d == null ? 2 : d); }
  function sgn(v, d) { if (v == null || isNaN(v)) return '--'; return (v > 0 ? '+' : '') + num(v, d); }
  function sgTag(gs) {
    if (gs == null) return '<span class="sg x">--</span>';
    return gs > 0
      ? '<span class="sg g">G +' + gs.toFixed(2) + '</span>'
      : '<span class="sg s">S ' + gs.toFixed(2) + '</span>';
  }

  /* 波动目标卡（动量轮动） */
  function volCard(p) {
    var v = p.vol || {}, cfg = QE.STRATS.momentum.cfg;
    var rv = v.realized, sc = (v.scale == null ? 1 : v.scale), ok = sc >= 0.999;
    var bar = rv == null ? 0 : Math.min(100, rv / (cfg.volTarget * 2) * 100);
    var thr = 50;
    return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>波动目标</h2>' +
      '<span class="rt">近 ' + cfg.volWin + ' 日等权组合</span></div>' +
      '<div class="vrow"><span>实测年化波动</span><b class="num">' + (rv == null ? '--' : (rv * 100).toFixed(2) + '%') + '</b></div>' +
      '<div class="vbar"><i style="width:' + bar.toFixed(1) + '%"></i><u style="left:' + thr + '%"></u></div>' +
      '<div class="vrow"><span>阈值</span><b class="num">' + (cfg.volTarget * 100).toFixed(0) + '%</b></div>' +
      '<div class="vrow"><span>仓位系数</span><b class="num">' + sc.toFixed(2) + '（' + (sc * 100).toFixed(0) + '%）</b></div>' +
      '<div class="vnote">' + (ok ? '未超阈值 → 满仓等权，每只约 ' + (100 / cfg.topK * sc).toFixed(1) + '%'
        : '超出阈值 → 等比降仓，减出部分停泊 511380 可转债ETF') + '</div></div>';
  }

  /* 风控提示（动量轮动）：剔除原因 + 溢价预警 */
  function premiumWarn(p) {
    var cfg = QE.STRATS.momentum.cfg, S = QE.STRATS.momentum, list = [], inTop = {};
    (p.top || []).forEach(function (t) { inTop[t.code] = 1; });
    (p.excluded || []).forEach(function (t) {
      if (inTop[t.code] || t.rank > cfg.topK) return;
      if (t.signal === 'gs') list.push(t.n + '（' + t.code + '）GS ' + num(t.gs) + ' ≤ 0，S 空头 → 顺延剔除');
      else if (t.signal === 'bias') list.push(t.n + '（' + t.code + '）乖离 ' + num(t.bias) + '% > 12% → 周四剔除递补');
    });
    (p.top || []).forEach(function (t) {
      if (t.filled) {
        var why = (t.gs != null && t.gs <= 0) ? ('GS ' + num(t.gs) + ' ≤ 0（S 空头）')
          : ('乖离 ' + num(t.bias) + '% > 12%');
        list.push(t.n + '（' + t.code + '）' + why + ' → 首轮剔除，按乖离递补回前' + t.rank + '，仍按等权买入');
      }
      if (t.premium == null) return;
      var lim = S.qdii[t.code] ? cfg.highQdii : cfg.highNq;
      if (t.premium > lim) list.push(t.n + '（' + t.code + '）溢价 ' + num(t.premium) + '% > ' + lim + '%' +
        (S.qdii[t.code] ? '（QDII）' : '') + '，建议调仓日跳过买入/减仓');
    });
    if (!list.length) return '';
    return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>风控提示</h2><span class="rt">' + list.length + ' 条</span></div>' +
      '<div class="rules"><ul>' + list.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div></div>';
  }

  /* 排名表：三策略各自的完整列 */
  /* ===== 快照策略详情页组件 ===== */
  function snapHead(id, s, a, m) {
    var navs = a.nav || [], n = navs.length;
    var last = n ? navs[n - 1] : 0, prev = n > 1 ? navs[n - 2] : last;
    var day = last - prev, dp = prev > 0 ? day / prev : 0;
    return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>期末净值</h2>' +
      '<span class="rt">' + esc(a.navD[n - 1] || a.lastDate) + ' 收盘</span></div>' +
      '<div class="bigv num">' + money(last) + '<small>元</small></div>' +
      '<div class="pstats" style="margin-top:8px">' +
      '<div><span>最新一日变动</span><b class="num ' + cls(day) + '">' + (day >= 0 ? '+' : '') + money(day) + '</b></div>' +
      '<div><span>当日涨跌</span><b class="num ' + cls(dp) + '">' + spct(dp) + '</b></div>' +
      '<div><span>累计收益</span><b class="num ' + cls(m.total) + '">' + (m.total != null ? spct(m.total) : '--') + '</b></div>' +
      '<div><span>年化</span><b class="num ' + cls(m.annual) + '">' + (m.annual != null ? spct(m.annual, 1) : '--') + '</b></div>' +
      '</div></div>';
  }

  function snapStats(id, s, a, m) {
    var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
    var mm = d.metrics || {};
    return '<div class="card"><div class="chd"><span class="bar"></span><h2>绩效指标</h2>' +
      '<span class="rt">' + esc(s.tag) + '</span></div>' +
      '<div class="mgrid">' +
      '<div class="mi"><div class="k">最大回撤</div><div class="v num dn">' + (mm.mdd != null ? (mm.mdd > 0 ? '-' : '') + mm.mdd.toFixed(2) + '%' : '--') + '</div></div>' +
      '<div class="mi"><div class="k">夏普比率</div><div class="v num">' + (mm.sharpe != null ? mm.sharpe.toFixed(2) : '--') + '</div></div>' +
      '<div class="mi"><div class="k">年化波动</div><div class="v num">' + (mm.vol != null ? mm.vol.toFixed(2) + '%' : '--') + '</div></div>' +
      '<div class="mi"><div class="k">胜率</div><div class="v num">' + (mm.win != null ? mm.win.toFixed(1) + '%' : '--') + '</div></div>' +
      '<div class="mi"><div class="k">交易笔数</div><div class="v num">' + (mm.trades != null ? mm.trades : '--') + '</div></div>' +
      '<div class="mi"><div class="k">卡玛比率</div><div class="v num">' + (mm.calmar != null ? mm.calmar.toFixed(2) : '--') + '</div></div>' +
      '</div>' +
      '<div class="vnote" style="margin-top:8px">' + (s.official ? '指标取自平台官方绩效接口，与官网逐位一致。' : '指标由本地引擎按平台参数回测得出，与官网同量级（非官方记录）。') + '</div>' +
      '</div>';
  }

  function snapPos(id, s, a) {
    var pos = QE.posList(a);
    var endD = a.lastDate || '';
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>期末持仓</h2>' +
      '<span class="rt">' + (pos.length ? pos.length + ' 只 · 现金 ' + money(a.cash) : '空仓') + '</span></div>';
    if (!pos.length) {
      html += '<div class="empty">期末空仓，全部为现金</div></div>';
      return html;
    }
    html += '<div class="tw"><table class="rt4"><thead><tr><th>标的</th><th>股数</th><th>成本</th><th>期末价</th>' +
      '<th>市值</th><th>浮盈</th></tr></thead><tbody>';
    pos.forEach(function (p) {
      var px = QE.priceAt(idx, p.code, endD) || p.cost || 0;
      var mv = px * p.sh;
      var pnl = (px - (p.cost || px)) * p.sh;
      html += '<tr class="hrow"><td><span class="nm">' + esc(cname(p.code)) + '</span><i class="sub15">' + p.code + '</i></td>' +
        '<td class="num">' + p.sh + '</td>' +
        '<td class="num">' + num(p.cost, 3) + '</td>' +
        '<td class="num">' + num(px, 3) + '</td>' +
        '<td class="num">' + money(mv) + '</td>' +
        '<td class="num ' + cls(pnl) + '">' + (pnl >= 0 ? '+' : '') + money(pnl) + '</td></tr>';
    });
    html += '</tbody></table></div></div>';
    return html;
  }

  /* ---------- 全池排名兜底：无当日信号时按最近收盘日复算 ---------- */
  /* ---------- 按本策略自身规则判定：该持谁 / 该不该换 ---------- */
  function holdVerdict(id, s, ranks, a) {
    var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
    var cfg = d.cfg || (s && s.cfg) || {};
    var mom = d.mom || {};
    var topN = (id === 'momentum') ? ((cfg.topK) || 3) : (cfg.topN || 1);
    var fb = cfg.fallback, tgt = [], cur = [], c;
    ranks.forEach(function (r) {
      if (id === 'momentum') { if (r.signal === 'hold') tgt.push(r.code); }
      else if (r.pass && r.rank <= topN) tgt.push(r.code);
    });
    for (c in a.pos) if (a.pos[c] && a.pos[c].sh > 0) cur.push(c);
    var nm = function (arr) {
      return arr.length ? arr.map(function (x) { return esc(cname(x)) }).join(' · ') : '空仓';
    };
    var same = (cur.length === tgt.length) && cur.every(function (x) { return tgt.indexOf(x) >= 0; });
    var cls_, txt;
    if (!tgt.length) {
      var fbs = (fb == null ? '' : String(fb));
      if (!fbs || fbs === '0') { cls_ = 'off'; txt = '无合格候选，规则要求<b>空仓持现金</b>'; }
      else { cls_ = 'cand'; txt = '无合格候选，规则要求<b>兜底 ' + esc(cname(fbs)) + ' ' + fbs + '</b>'; }
      if (cur.length) txt += '；当前持 ' + nm(cur) + ' → <b>需清出</b>';
    } else if (same) {
      cls_ = 'on'; txt = '目标 ' + nm(tgt) + '；与当前持仓一致 → <b>维持不动</b>';
    } else {
      cls_ = 'off';
      var sell = cur.filter(function (x) { return tgt.indexOf(x) < 0; });
      var buy = tgt.filter(function (x) { return cur.indexOf(x) < 0; });
      txt = '目标 ' + nm(tgt) + '；当前 ' + nm(cur);
      var acts = [];
      if (sell.length) acts.push('卖出 ' + nm(sell));
      if (buy.length) acts.push('买入 ' + nm(buy));
      txt += ' → <b>' + acts.join('，') + '</b>';
    }
    var rule = (mom.type === 'pct') ? ((mom.m1 || 2) + '日涨幅')
      : ((id === 'earth' ? 'M20/M26 双动量' : ((mom.m1 || 25) + '日加权斜率')));
    return '<div style="margin-top:8px;padding:8px 10px;border-left:3px solid ' +
      (cls_ === 'on' ? 'var(--up,#f0483e)' : 'var(--acc,#5b8cff)') +
      ';background:rgba(255,255,255,.035);border-radius:0 8px 8px 0;font-size:11.5px;line-height:1.7">' +
      '<span class="badge ' + cls_ + '" style="margin-right:6px">换仓判定</span>' + txt +
      '<div style="opacity:.62;margin-top:3px">依据本策略自身参数：' + rule +
      ' · 阈值 ' + (mom.m1lo != null ? mom.m1lo : 0) + '~' + (mom.m1hi != null ? mom.m1hi : 0) +
      ' · TOP' + topN + (cfg.minHold ? ' · 最短持有 ' + cfg.minHold + ' 日' : '') +
      (id === 'momentum' ? ' · GS/乖离剔除后递补' : '') + '</div></div>';
  }

  function maAvg(ser, n) {
    if (!ser || ser.length < n) return null;
    var s = 0, i;
    for (i = ser.length - n; i < ser.length; i++) s += ser[i];
    return s / n;
  }
  function gsCalc(ref) {
    if (!ref || ref.length < 26) return null;
    var i = ref.length - 1, c = ref[i], m6 = 0, m12 = 0, m24 = 0, k;
    for (k = 0; k < 6; k++) m6 += ref[i - k];
    for (k = 0; k < 12; k++) m12 += ref[i - k];
    for (k = 0; k < 24; k++) m24 += ref[i - k];
    m6 /= 6; m12 /= 12; m24 /= 24;
    if (!(m6 > 0) || !(m12 > 0) || !(m24 > 0)) return null;
    var v2 = (c - m6) / m6 * 100, v3 = (c - m12) / m12 * 100, v4 = (c - m24) / m24 * 100;
    return (v2 + 2 * v3 + 3 * v4) / 6;
  }
  function rankAt(id, s, a) {
    if (!s || !idx) return [];
    var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
    var mom = d.mom || {};
    var date = a.lastDate || (idx.calendar.length ? idx.calendar[idx.calendar.length - 1] : '');
    var held = {}, c;
    for (c in a.pos) if (a.pos[c] && a.pos[c].sh > 0) held[c] = 1;
    var out = [];
    (s.pool || []).forEach(function (it) {
      var code = it.c || it[0], nm = it.n || it[1];
      var ser = QE.seriesTo(idx, code, date) || [];
      if (ser.length < 3) return;
      var px = ser[ser.length - 1], prev = ser[ser.length - 2];
      var chg = prev > 0 ? px / prev - 1 : 0;
      var ref = ser.slice(0, ser.length - 1);
      var ma20 = maAvg(ref, 20);
      var r = { code: code, n: nm, price: px, chg: chg, held: !!held[code],
                bias: ma20 ? (px / ma20 - 1) * 100 : null, premium: null, gs: null };
      if (s.snapshot) {
        if (mom.type === 'pct') {
          var kk = mom.m1 || 2;
          r.win = kk;
          r.score = ser.length > kk ? px / ser[ser.length - 1 - kk] - 1 : null;
        } else {
          var win = mom.m1 || 25, o = QE.wslopeFull(ser, win);
          r.win = win;
          r.score = o ? o.score : null;
          r.annual = o ? o.annual : null;
        }
        var lo = (mom.m1lo != null ? mom.m1lo : -1e9);
        var hi = (mom.m1hi != null ? mom.m1hi : 1e9);
        r.pass = (r.score != null && r.score >= lo && r.score <= hi);
      } else if (id === 'momentum') {
        var r15 = ser.length > 16 ? px / ser[ser.length - 17] - 1 : null;
        var r20 = ser.length > 21 ? px / ser[ser.length - 22] - 1 : null;
        var r25 = ser.length > 26 ? px / ser[ser.length - 27] - 1 : null;
        r.r15 = r15 == null ? null : r15 * 100;
        r.r20 = r20 == null ? null : r20 * 100;
        r.r25 = r25 == null ? null : r25 * 100;
        r.mom = (r15 != null && r20 != null && r25 != null) ? (2 * r15 + 3 * r20 + r25) * 100 : null;
        r.gs = gsCalc(ref);
        r.pass = (r.mom != null && r.mom > 0);
      } else if (id === 'earth') {
        var o1 = QE.wslopeFull(ser, 20), o2 = QE.wslopeFull(ser, 26);
        r.score = o1 ? o1.score : null;
        r.score2 = o2 ? o2.score : null;
        r.pass = (r.score != null && r.score > 0 && r.score <= 3 && r.score2 != null && r.score2 > 0 && r.score2 <= 10);
        r.why = r.pass ? '' : (r.score == null || r.score2 == null ? '数据不足'
          : (r.score <= 0 || r.score > 3 ? 'M20 越界' : 'M26 越界'));
      } else if (id === 'lowfreq') {
        var o3 = QE.wslopeFull(ser, 25);
        r.score = o3 ? o3.score : null;
        r.annual = o3 ? o3.annual : null;
        r.pass = (r.score != null && r.score > 0.05 && r.score <= 2);
        r.why = r.pass ? '' : '阈值外';
      } else {
        var o4 = QE.wslopeFull(ser, 25);
        r.score = o4 ? o4.score : null;
        r.pass = (r.score != null && r.score > 0 && r.score <= 2);
        r.why = r.pass ? '' : '阈值外';
      }
      out.push(r);
    });
    var keyName = (id === 'momentum') ? 'mom' : 'score';
    out.sort(function (x, y) {
      var X = (x[keyName] == null ? -1e9 : x[keyName]);
      var Y = (y[keyName] == null ? -1e9 : y[keyName]);
      return Y - X;
    });
    out.forEach(function (r, i) {
      r.rank = i + 1;
      if (id === 'momentum') {
        var tk = (s.cfg && s.cfg.topK) || 3;
        if (r.held) { r.signal = 'hold'; }
        else if (i < tk) { r.signal = 'hold'; r.filled = true; }
        else { r.signal = '-'; }
      }
    });
    return out;
  }

  /* ---------- 平台快照策略：池子排名表 ---------- */
  function snapRankCard(s, ranks, a) {
    var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[s.id] || {}) : {};
    var mom = d.mom || {};
    var isPct = (mom.type === 'pct');
    var win = mom.m1 || (isPct ? 2 : 25);
    var passN = 0;
    ranks.forEach(function (r) { if (r.pass) passN++; });
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>池子排名</h2>' +
      '<span class="rt">全 ' + ranks.length + ' 只 · 合格 ' + passN + '</span></div>' +
      '<div class="tw"><table class="rt4"><thead><tr>' +
      '<th>#</th><th>标的</th><th>现价</th><th>涨跌</th><th>' + (isPct ? (win + '日涨幅') : (win + '日斜率')) + '</th>' +
      '<th>乖离</th><th>状态</th></tr></thead><tbody>';
    ranks.forEach(function (r, i) {
      var badge = r.held ? '<span class="badge on">持仓</span>'
        : (r.pass ? (i === 0 ? '<span class="badge top">TOP1</span>' : '<span class="badge cand">候选</span>')
          : '<span class="badge off">' + (isPct ? '区间外' : '阈值外') + '</span>');
      var mv = (r.score == null) ? '--' : (isPct ? spct(r.score) : num(r.score, 3));
      html += '<tr' + (r.held ? ' class="hrow"' : '') + '><td>' + (i + 1) + '</td>' +
        '<td><span class="nm">' + esc(r.n) + '</span><i class="sub15">' + r.code + '</i></td>' +
        '<td class="num">' + num(r.price, 3) + '</td>' +
        '<td class="num ' + cls(r.chg) + '">' + spct(r.chg) + '</td>' +
        '<td class="num ' + cls(r.score) + '"><b>' + mv + '</b></td>' +
        '<td class="num ' + cls(r.bias) + '">' + (r.bias == null ? '--' : num(r.bias) + '%') + '</td>' +
        '<td>' + badge + '</td></tr>';
    });
    var lo = (mom.m1lo != null ? mom.m1lo : 0), hi = (mom.m1hi != null ? mom.m1hi : 0);
    html += '</tbody></table></div><div class="vnote" style="margin-top:8px">动量口径：' +
      (isPct ? (win + ' 日涨幅，合格区间 ' + (lo * 100).toFixed(2) + '% ~ ' + (hi * 100).toFixed(1) + '%')
        : (win + ' 日加权斜率（年化斜率 × 加权R²），合格区间 ' + lo + ' ~ ' + hi)) +
      ' · 乖离 = 现价/MA20 − 1 · 按 ' + esc(a.lastDate || '最新') + ' 收盘复算 · 溢价需实时 IOPV，离线留空</div></div>';
    html += holdVerdict(s.id, s, ranks, a);
    return html;
  }

  /* ---------- 平台快照策略：调仓记录 ---------- */
  function snapTrades(id, a) {
    var all = a.trades || [];
    if (!all.length) {
      return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
        '<span class="rt">平台未开放</span></div><div class="vnote">该策略在平台侧只开放净值与日盈亏接口，' +
        '没有逐笔交割单。净值、日/月/年收益、持仓与排名均为官方真值，不做估算补齐。</div></div>';
    }
    var PER = 15;
    var pages = Math.max(1, Math.ceil(all.length / PER));
    var pg = APP.tradePage[id] || 1;
    if (pg > pages) pg = pages;
    if (pg < 1) pg = 1;
    var rows = all.slice().reverse().slice((pg - 1) * PER, pg * PER);
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
      '<span class="rt">共 ' + all.length + ' 笔 · 第 ' + pg + '/' + pages + ' 页</span></div>' +
      '<div class="tw"><table class="rt4"><thead><tr>' +
      '<th>日期</th><th>方向</th><th>标的</th><th>价格</th><th>股数</th><th>金额</th></tr></thead><tbody>';
    rows.forEach(function (t) {
      html += '<tr><td class="num" style="font-size:10.5px;color:var(--sub)">' + (t.d || '').slice(2) + '</td>' +
        '<td><span class="badge ' + (t.act === 'BUY' ? 'on' : 'off') + '">' + (t.act === 'BUY' ? '买入' : '卖出') + '</span></td>' +
        '<td><span class="nm">' + esc(t.n) + '</span><i class="sub15">' + t.code + '</i></td>' +
        '<td class="num">' + num(t.px, 3) + '</td>' +
        '<td class="num">' + (t.sh == null ? '--' : t.sh) + '</td>' +
        '<td class="num">' + money(t.amt) + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (pages > 1) {
      html += '<div class="pager">' +
        '<button class="pgb" onclick="UI.tp(\'' + id + '\',-1)"' + (pg <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
        '<span class="pgn">' + pg + ' / ' + pages + '</span>' +
        '<button class="pgb" onclick="UI.tp(\'' + id + '\',1)"' + (pg >= pages ? ' disabled' : '') + '>下一页 ›</button></div>';
    }
    html += '</div>';
    return html;
  }

  function rankCard(id, p, a) {
    var S = QE.STRATS[id];
    var ranks = (p && p.ranks && p.ranks.length) ? p.ranks : rankAt(id, S, a);
    if (!ranks.length) return '';
    if (S.snapshot) return snapRankCard(S, ranks, a);
    var html = '';

    if (id === 'momentum') {
      var cfg = S.cfg;
      html += '<div class="card"><div class="chd"><span class="bar"></span><h2>动量排名 · 全球11池</h2>' +
        '<span class="rt">全 ' + ranks.length + ' 只 · 前3等权</span></div><div class="tw"><table class="rt4"><thead><tr>' +
        '<th>#</th><th>标的</th><th>现价</th><th>涨跌</th><th>动量</th><th>乖离</th><th>溢价</th><th>GS</th><th>信号</th></tr></thead><tbody>';
      ranks.forEach(function (r) {
        var held = a.pos[r.code];
        var sig;
        if (r.signal === 'hold') sig = '<span class="badge top">前' + r.rank + (r.filled ? '补' : '') + '</span>';
        else if ((r.signal === 'gs' || r.signal === 'bias') && r.rank <= cfg.topK) sig = '<span class="badge off">剔</span>';
        else sig = '<span class="badge off">—</span>';
        html += '<tr' + (held ? ' class="hrow"' : '') + '><td>' + r.rank + '</td>' +
          '<td><span class="nm">' + esc(r.n) + '</span>' +
          '<i class="sub15">' + r.code + (held ? ' · 持仓' : '') + '</i></td>' +
          '<td class="num">' + num(r.price, 3) + '</td>' +
          '<td class="num ' + cls(r.chg) + '">' + spct(r.chg) + '</td>' +
          '<td class="num ' + cls(r.mom) + '"><b>' + sgn(r.mom) + '</b>' +
          '<i class="sub15">' + sgn(r.r15) + ' / ' + sgn(r.r20) + ' / ' + sgn(r.r25) + '</i></td>' +
          '<td class="num ' + cls(r.bias) + '">' + num(r.bias) + '</td>' +
          '<td class="num">' + num(r.premium) + '</td>' +
          '<td>' + sgTag(r.gs) + '</td>' +
          '<td>' + sig + '</td></tr>';
      });
      html += '</tbody></table></div>' +
        '<div class="vnote" style="margin-top:8px">动量 = 2×r15+3×r20+1×r25（副行为 r15 / r20 / r25）；乖离 = 现价/MA20−1；溢价 = 现价/IOPV−1；GS &gt;0 为 G，≤0 为 S；信号「前N补」= 剔除后按乖离递补；高亮行 = 当前持仓</div></div>';
      html += holdVerdict(id, S, ranks, a);
      return html;
    }

    if (id === 'earth') {
      var cfg2 = S.cfg, passN = ranks.filter(function (r) { return r.pass; }).length;
      html += '<div class="card"><div class="chd"><span class="bar"></span><h2>动量排名 · 加权斜率V2</h2>' +
        '<span class="rt">全 ' + ranks.length + ' 只 · 通过 ' + passN + '</span></div><div class="tw"><table class="rt4"><thead><tr>' +
        '<th>#</th><th>标的</th><th>现价</th><th>涨跌</th><th>M20</th><th>M26</th><th>状态</th></tr></thead><tbody>';
      ranks.forEach(function (r, i) {
        var held = a.pos[r.code];
        var badge = held ? '<span class="badge on">持仓</span>'
          : (r.pass ? (i === 0 ? '<span class="badge top">TOP1</span>' : '<span class="badge cand">候选</span>')
            : '<span class="badge off">' + esc(r.why || '过滤') + '</span>');
        html += '<tr' + (held ? ' class="hrow"' : '') + '><td>' + (i + 1) + '</td>' +
          '<td><span class="nm">' + esc(r.n) + '</span><i class="sub15">' + r.code + '</i></td>' +
          '<td class="num">' + num(r.price, 3) + '</td>' +
          '<td class="num ' + cls(r.chg) + '">' + spct(r.chg) + '</td>' +
          '<td class="num ' + cls(r.score) + '"><b>' + num(r.score, 3) + '</b></td>' +
          '<td class="num ' + cls(r.score2) + '">' + num(r.score2, 3) + '</td>' +
          '<td>' + badge + '</td></tr>';
      });
      html += '</tbody></table></div><div class="vnote" style="margin-top:8px">M20 ∈ (0, 3] 作主排名 · M26 ∈ (0, 10] 作过滤 · 得分 = 年化斜率 × 加权R² · 涨跌 ≥9.8% 剔除</div></div>';
      html += holdVerdict(id, S, ranks, a);
      return html;
    }

    /* lowfreq */
    var cfg3 = S.cfg, passN2 = ranks.filter(function (r) { return r.pass && !r.fb; }).length;
    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>斜率排名 · 21池</h2>' +
      '<span class="rt">全 ' + ranks.length + ' 只 · 通过 ' + passN2 + '</span></div><div class="tw"><table class="rt4"><thead><tr>' +
      '<th>#</th><th>标的</th><th>现价</th><th>涨跌</th><th>得分</th><th>年化</th><th>状态</th></tr></thead><tbody>';
    ranks.forEach(function (r, i) {
      var held = a.pos[r.code];
      var badge = held ? '<span class="badge on">持仓</span>'
        : (r.fb ? '<span class="badge off">货币备选</span>'
          : (r.pass ? (i === 0 ? '<span class="badge top">TOP1</span>' : '<span class="badge cand">候选</span>')
            : '<span class="badge off">' + esc(r.why || '过滤') + '</span>'));
      html += '<tr' + (held ? ' class="hrow"' : '') + '><td>' + (i + 1) + '</td>' +
        '<td><span class="nm">' + esc(r.n) + '</span><i class="sub15">' + r.code + '</i></td>' +
        '<td class="num">' + num(r.price, 3) + '</td>' +
        '<td class="num ' + cls(r.chg) + '">' + spct(r.chg) + '</td>' +
        '<td class="num ' + cls(r.score) + '"><b>' + (r.score == null ? '--' : Math.round(r.score * 10000)) + '</b></td>' +
        '<td class="num ' + cls(r.annual) + '">' + (r.annual == null ? '--' : spct(r.annual)) + '</td>' +
        '<td>' + badge + '</td></tr>';
    });
    html += '</tbody></table></div><div class="vnote" style="margin-top:8px">得分 = 年化斜率 × 加权R²（×1万显示）· 阈值 0.05 ~ 2.0（即得分 500 ~ 20000）· 空仓时持 511880 银华日利</div></div>';
    html += holdVerdict(id, S, ranks, a);
    return html;
  }

  function rulesHTML(id) {
    var S0 = QE.STRATS[id];
    if (S0 && S0.snapshot) {
      var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
      var c = d.cfg || {};
      var li = '';
      li += '<li><span class="k">池</span>：' + (d.pool || []).map(function (x) { return cname(x) + ' ' + x; }).join(' · ') + '</li>';
      li += '<li><span class="k">参数</span>：TOP' + (c.topN || 1) + ' · 最短持有 ' + (c.minHold || 1) + (c.calDays ? ' 自然日' : ' 交易日') +
        ' · 执行 ' + (c.exec || '') + ' · 佣金 ' + (((c.comm || 0) * 10000).toFixed(1)) + '‱ · 滑点 ' + ((c.slip || 0) * 100) + '%</li>';
      if (c.ddStop) li += '<li><span class="k">止损</span>：回撤 ' + (c.ddStop * 100).toFixed(0) + '% 清仓，冷却 ' + (c.ddFreeze || 0) + ' 日</li>';
      if (c.filters && c.filters.length) {
        li += '<li><span class="k">过滤</span>：' + c.filters.map(function (f) {
          if (f.type === 'ma_golden_cross') return 'MA' + f.fast_period + '&gt;MA' + f.slow_period;
          if (f.type === 'close_above_ma') return '收盘站上 MA' + f.period;
          if (f.type === 'premium_limit') return '溢价 &lt;' + f.max_premium + '%';
          return f.type;
        }).join(' · ') + '</li>';
      }
      li += '<li><span class="k">口径</span>：' + esc(d.note || '') + '</li>';
      return '<ul>' + li + '</ul>';
    }
    if (id === 'momentum') return '<ul>' +
      '<li><span class="k">池</span>：全球 11 池 — 黄金518880 · 标普500 513500 · 创业板159915 · 可转债511380 · 中证500 510500 · 豆粕159985 · 日经225 513880 · 纳指513100 · 标普油气159518 · 半导体512480 · 德国513030</li>' +
      '<li><span class="k">加权动量</span>：2×r15 + 3×r20 + 1×r25，按降序排名</li>' +
      '<li><span class="k">GS 过滤</span>：6/12/24 日均线乖离 (v2+2v3+3v4)/6 三日平滑；&gt;0 为 G 允许买入，≤0 为 S 顺延剔除</li>' +
      '<li><span class="k">乖离双层</span>：周四选股层 乖离&gt;12% 直接剔除递补；日频止盈层 持仓乖离&gt;20% 降至 0.3 倍等权</li>' +
      '<li><span class="k">波动目标</span>：近 90 日等权组合年化波动 &gt;26% 时等比降仓，减出仓位停泊 511380 可转债ETF</li>' +
      '<li><span class="k">建仓</span>：前 3 名等权各 33.3%，×0.99，整百股，佣金万 3，无滑点</li>' +
      '<li><span class="k">时点</span>：每周四 14:50，收盘价口径；非周四只做日频乖离止盈</li>' +
      '<li><span class="k">溢价预警</span>：非 QDII 溢价&gt;5%、QDII 溢价&gt;12% 提示调仓日跳过买入</li></ul>' +
      '<div style="margin-top:8px;color:var(--dim)">口径对齐 v4.5 壳工程（全球11池 / 波动26% / GS过滤 / 乖离12-20），信号计算与 APK 逐行一致。</div>';
    if (id === 'earth') return '<ul>' +
      '<li><span class="k">池</span>：12 只跨境/商品/宽基 ETF，TOP1 满仓轮动</li>' +
      '<li><span class="k">双动量</span>：M20 加权斜率得分 ∈ (0, 3] 作主排名；M26 得分 ∈ (0, 10] 作过滤</li>' +
      '<li><span class="k">得分</span>：年化对数斜率 × 加权 R²（近期权重更高）</li>' +
      '<li><span class="k">风控</span>：最短持有 2 个交易日；当日涨跌 ≥9.8% 剔除；无合格标的空仓</li>' +
      '<li><span class="k">资金</span>：可用资金 ×98%（留 2% 备用），整百股，佣金万 1，买入含千 1 滑点</li>' +
      '<li><span class="k">时点</span>：每个交易日 14:30</li></ul>';
    return '<ul>' +
      '<li><span class="k">池</span>：20 只 ETF/LOF（含美国消费LOF 162415、石油LOF、白银LOF 等）+ 货币备选 511880，共 21 只</li>' +
      '<li><span class="k">动量</span>：25 日加权斜率得分 ∈ (0.05, 2.0]（得分 ×1万 显示）</li>' +
      '<li><span class="k">风控</span>：高点回撤 5% 止损（冻结 1 日）；盈利 12% 止盈（冷静期 2 日）；最短持有 2 日</li>' +
      '<li><span class="k">空仓</span>：无合格标的时买入货币ETF 511880 银华日利</li>' +
      '<li><span class="k">成本</span>：佣金万 0.5，留 2% 备用金，整百股</li>' +
      '<li><span class="k">时点</span>：每个交易日 14:50</li></ul>';
  }

  /* ---------- 渲染：设置 ---------- */
  function renderSettings() {
    var html = '';
    Object.keys(QE.STRATS).forEach(function (id) {
      var s = QE.STRATS[id], st = APP.settings[id];
      if (s.snapshot) {
        html += '<div class="card tight"><div class="chd"><span class="bar"></span><h2>' + esc(s.short || s.name) + ' · 只读快照</h2>' +
          '<span class="rt">' + esc(s.tag) + '</span></div><div class="vnote">净值、日/月/年收益、排名与指标为' +
          (s.official ? '平台官方接口数据' : '本地引擎按平台参数复算') + '，不可修改本金与起始日。</div></div>';
        return;
      }
      html += '<div class="card"><div class="chd"><span class="bar"></span><h2>' + esc(s.name) + ' · 账户设置</h2></div>' +
        '<div class="field"><label>初始资金<small>改动后从起始日重新自动记账</small></label>' +
        '<input type="number" id="cap_' + id + '" value="' + st.capital + '" step="10000" min="10000"></div>' +
        '<div class="field"><label>起始日期<small>建议不早于 2024-01-02（部分标的上市较晚）</small></label>' +
        '<input type="date" id="st_' + id + '" value="' + st.start + '"></div>' +
        '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn pri" onclick="UI.saveCfg(\'' + id + '\')">保存并重算</button>' +
        '<button class="btn" onclick="UI.resetOne(\'' + id + '\')">重置账户</button></div></div>';
    });

    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>提醒</h2></div>' +
      '<div class="field"><label>操作提醒<small>' + (window.AndroidBridge ? '系统通知（APK）' : '浏览器通知') + ' · 有待操作时推送</small></label>' +
      '<div class="sw ' + (APP.notifyOn ? 'on' : '') + '" id="swNotify" onclick="UI.toggleNotify()"></div></div>' +
      '<div class="field"><label>调仓时点<small>动量轮动 14:50 · 买地球 14:30 · 低频轮动 14:50</small></label>' +
      '<span style="color:var(--sub);font-size:12px">固定</span></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px"><button class="btn" onclick="UI.testNotify()">发送测试通知</button>' +
      '<button class="btn" onclick="UI.copyActions()">复制今日操作清单</button></div></div>';

    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>数据</h2></div>' +
      '<div class="field"><label>日线<small>东方财富 · 动量用前复权（fqt=1）· 净值重建用不复权（fqt=0）</small></label><span style="color:var(--sub);font-size:11.5px">JSONP</span></div>' +
      '<div class="field"><label>交割单<small>聚宽导出 · 买地球 773 笔 / 低频 1039 笔 · 2020-01-02 ~ 2026-11-06</small></label><span style="color:var(--dn);font-size:11.5px">已内置</span></div>' +
      '<div class="field"><label>实时<small>腾讯行情 · 现价 / 涨跌幅 / IOPV 净值（当前源：' + (DATA.rtSrc || '--') + '）</small></label><span style="color:var(--sub);font-size:11.5px">' +
      (DATA.lastFetch ? new Date(DATA.lastFetch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--') + '</span></div>' +
      '<div class="field"><label>已缓存标的<small>' + Object.keys(DATA.klines).length + ' 只 · 最近更新 ' + (DATA.lastFetch ? new Date(DATA.lastFetch).toLocaleString('zh-CN', { hour12: false }) : '--') + '</small></label>' +
      '<button class="btn" onclick="UI.hardRefresh()">强制刷新</button></div>' +
      '<div class="field"><label>清除本地缓存<small>会清空账户记账与行情缓存</small></label>' +
      '<button class="btn danger" onclick="UI.clearAll()">清除</button></div></div>';

    html += '<div class="card"><div class="chd"><span class="bar"></span><h2>关于</h2></div><div class="rules">' +
      '三套策略共用一个自动记账内核：按真实收盘价自动完成买卖、股数取整、佣金扣除、净值计算。<br>' +
      '你不需要手动记录任何持仓——打开 App 即可看到当前持仓、盈亏和今日该做的操作。<br>' +
      '<span style="color:var(--dim)">数据仅用于本地计算，不上传任何服务器；历史回测不代表未来收益。</span><br>' +
      '<span style="color:var(--dim)">数据版本 <b style="color:var(--acc2)">v2.0</b> · 交割单截至 2026-11-06 · 前端 v13</span></div></div>';

    $('view-settings').innerHTML = html;
  }

  /* ---------- 视图切换 ---------- */
  function renderAll() {
    renderHome();
    Object.keys(QE.STRATS).forEach(function (id) { if (!QE.STRATS[id].snapshot) renderStrat(id); });
    renderSettings();
    if (APP.view && QE.STRATS[APP.view]) renderStrat(APP.view);
  }
  function go(v) {
    var isStrat = !!QE.STRATS[v];
    APP.view = v;
    if (history.replaceState) history.replaceState(null, '', (!isStrat && v === 'home') ? location.pathname : '#' + v);
    var target = isStrat ? 'detail' : v;
    if (isStrat) renderStrat(v);
    var views = document.querySelectorAll('.view');
    for (var i = 0; i < views.length; i++) views[i].className = 'view' + (views[i].id === 'view-' + target ? ' on' : '');
    var tabs = document.querySelectorAll('#tabs a');
    var tabV = isStrat ? (document.querySelector('#tabs a[data-v="' + v + '"]') ? v : 'home') : v;
    for (i = 0; i < tabs.length; i++) tabs[i].className = tabs[i].getAttribute('data-v') === tabV ? 'on' : '';
    window.scrollTo(0, 0);
  }

  /* ===== 双主题（深色 / 浅色） ===== */
  function themeNow() { return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark'; }
  function paintThemeIcon() {
    var b = $('btnTheme');
    if (!b) return;
    b.innerHTML = themeNow() === 'light'
      ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
  }
  function themeInit() {
    var t = 'dark';
    try { t = localStorage.getItem('qw_theme') || 'dark'; } catch (e) { }
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : 'dark');
    paintThemeIcon();
  }
  function toggleTheme() {
    var t = themeNow() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('qw_theme', t); } catch (e) { }
    paintThemeIcon();
    toast(t === 'light' ? '已切换浅色模式' : '已切换深色模式');
  }

  /* ---------- 通知 ---------- */
  function nativeNotify(title, body) {
    try {
      if (window.AndroidBridge && window.AndroidBridge.notify) {
        window.AndroidBridge.notify(title, body);
        return true;
      }
    } catch (e) { }
    return false;
  }
  function notify(title, body) {
    if (!APP.notifyOn) return;
    if (nativeNotify(title, body)) return;      // APK 内走系统通知
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try { new Notification(title, { body: body, icon: 'assets/icon.svg', tag: 'qw-' + todayStr() }); } catch (e) { }
  }
  function pushDaily() {
    var t = todayStr();
    var key = 'qw_notified_' + t;
    if (localStorage.getItem(key)) return;
    var lines = [];
    for (var id in pend) {
      if (pend[id].actions.length && !pend[id].done) {
        pend[id].actions.forEach(function (a) {
          lines.push(QE.STRATS[id].short + '：' + (a.act === 'BUY' ? '买 ' : '卖 ') + a.n + ' ' + a.sh + '股');
        });
      }
    }
    if (lines.length) {
      notify('今日有 ' + lines.length + ' 笔操作待执行', lines.join('\n'));
      localStorage.setItem(key, '1');
    }
  }

  /* ---------- 主流程 ---------- */
  function setStatus(txt, live) {
    var p = $('mkPill');
    p.innerHTML = '<i class="dot' + (live ? '' : ' off') + '"></i><span>' + esc(txt) + '</span>';
  }

  function boot(force) {
    if (booting) return;
    booting = true;
    loadState();
    // 可选：?cal=m / ?cal=y 直接打开对应收益视图
    try {
      var q = new URLSearchParams(location.search).get('cal');
      if (q && 'dmy'.indexOf(q) >= 0) for (var ck in APP.calMode) APP.calMode[ck] = q;
    } catch (e) { }
    setStatus('加载行情…', false);
    var btn = $('btnRefresh'); btn.className = 'iconbtn spin';
    var codes = allCodes();
    DATA.loadKlines(codes, function (done, total) {
      setStatus('行情 ' + done + '/' + total, false);
    }).then(function () {
      idx = QE.buildIndex(DATA.klines);
      return DATA.loadRT(codes);
    }).then(function () {
      lastClosed = calcLastClosed();
      runAll();
      renderAll();
      booted = true;
      if (window.__QW_H && (QE.STRATS[window.__QW_H] || $('view-' + window.__QW_H))) { go(window.__QW_H); window.__QW_H = ''; }
      else if (window.__QW_H) { go(window.__QW_H); window.__QW_H = ''; }
      var ms = DATA.marketState();
      setStatus(ms.text + ' · ' + (DATA.lastFetch ? new Date(DATA.lastFetch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''), ms.open);
      btn.className = 'iconbtn';
      booting = false;
      pushDaily();
    }).catch(function (e) {
      setStatus('行情加载失败', false);
      btn.className = 'iconbtn'; booting = false;
      if (!booted) {
        idx = QE.buildIndex(DATA.klines);
        if (idx.calendar.length) {
          lastClosed = calcLastClosed(); runAll(); renderAll();
          toast('网络异常，使用本地缓存数据');
        } else {
          $('view-home').innerHTML = '<div class="card"><div class="empty">行情加载失败：' + esc(e.message) + '<br><br>请检查网络后点击右上角刷新</div></div>';
        }
      }
    });
  }

  /* ---------- 对外交互 ---------- */
  var UI = {
    go: go,
    theme: toggleTheme,
    ack: function (id) {
      var t = todayStr();
      APP.ack[t] = APP.ack[t] || {};
      APP.ack[t][id] = 1;
      saveState(); computePending(); renderAll(); toast('已标记完成');
    },
    ackAll: function () {
      var t = todayStr();
      APP.ack[t] = APP.ack[t] || {};
      for (var id in pend) if (pend[id].actions.length) APP.ack[t][id] = 1;
      saveState(); computePending(); renderAll(); toast('今日操作已全部标记完成');
    },
    cal: function (id, mode) {
      APP.calMode[id] = mode;
      if (APP.calPage[id]) APP.calPage[id][mode] = '';
      renderStrat(id);
    },
    calPg: function (id, mode, d) {
      var a = APP.accounts[id];
      if (!a) return;
      if (!APP.calPage[id]) APP.calPage[id] = { d: '', m: '' };
      var rows = perfData(a);
      var keys = mode === 'd' ? ymList(rows) : yList(rows);
      if (!keys.length) return;
      var cur = (APP.calPage[id] && APP.calPage[id][mode]) || keys[keys.length - 1];
      var i = keys.indexOf(cur);
      if (i < 0) i = keys.length - 1;
      i += d;
      if (i < 0) i = 0;
      if (i > keys.length - 1) i = keys.length - 1;
      APP.calPage[id][mode] = keys[i];
      renderStrat(id);
    },
    pcMove: pcMove,
    pcOut: pcOut,
    tp: function (id, d) {
      var PER = 15;
      var total = (APP.accounts[id] && APP.accounts[id].trades.length) || 0;
      var pages = Math.max(1, Math.ceil(total / PER));
      var p = (APP.tradePage[id] || 1) + d;
      if (p < 1) p = 1;
      if (p > pages) p = pages;
      APP.tradePage[id] = p;
      renderStrat(id);
    },
    copyActions: function (id) {
      var lines = ['【三策略操作清单 ' + todayStr() + '】'];
      for (var k in pend) {
        if (id && k !== id) continue;
        if (!pend[k].actions.length) continue;
        lines.push('— ' + QE.STRATS[k].name + '（' + QE.STRATS[k].time + '）');
        pend[k].actions.forEach(function (a) {
          lines.push((a.act === 'BUY' ? '买入 ' : '卖出 ') + a.n + '(' + a.code + ') ' + a.sh + '股' + (a.px ? ' 参考价 ' + a.px.toFixed(3) : ''));
        });
      }
      if (lines.length === 1) lines.push('今日无需操作');
      var txt = lines.join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).then(function () { toast('清单已复制'); }, function () { alert(txt); });
      } else { alert(txt); }
    },
    saveCfg: function (id) {
      var cap = parseFloat($('cap_' + id).value), st = $('st_' + id).value;
      if (!(cap >= 10000)) { toast('资金至少 1 万'); return; }
      if (!st) { toast('请选择起始日期'); return; }
      APP.settings[id] = { capital: Math.round(cap), start: st };
      APP.accounts[id] = QE.newAccount(id, Math.round(cap), st);
      saveState();
      lastClosed = calcLastClosed();
      runAll(); renderAll(); toast('已按新参数重算');
    },
    resetOne: function (id) {
      if (!confirm('重置该策略账户？将按当前设置从起始日重新自动记账。')) return;
      var st = APP.settings[id];
      APP.accounts[id] = QE.newAccount(id, st.capital, st.start);
      saveState(); runAll(); renderAll(); toast('已重置');
    },
    toggleNotify: function () {
      if (APP.notifyOn) { APP.notifyOn = false; saveState(); renderSettings(); return; }
      if (window.AndroidBridge && window.AndroidBridge.notify) {
        APP.notifyOn = true; saveState(); renderSettings(); toast('已开启系统通知'); return;
      }
      if (!('Notification' in window)) { toast('当前环境不支持通知'); return; }
      Notification.requestPermission().then(function (p) {
        if (p === 'granted') { APP.notifyOn = true; saveState(); renderSettings(); toast('已开启提醒'); }
        else { toast('通知权限被拒绝'); }
      });
    },
    testNotify: function () {
      if (nativeNotify('测试提醒', '这是一条来自三策略量化工作台的通知')) { toast('已发送系统通知'); return; }
      if (!('Notification' in window)) { toast('当前环境不支持通知'); return; }
      Notification.requestPermission().then(function (p) {
        if (p !== 'granted') { toast('请先允许通知'); return; }
        notify('测试提醒', '这是一条来自三策略量化工作台的通知');
        toast('已发送');
      });
    },
    hardRefresh: function () {
      try { localStorage.removeItem('qw_meta_v3'); } catch (e) { }
      toast('正在重新拉取行情…');
      boot(true);
    },
    clearAll: function () {
      if (!confirm('清除全部本地数据（账户记账 + 行情缓存）？')) return;
      localStorage.removeItem(SKEY);
      localStorage.removeItem('qw_kline_v4');
      localStorage.removeItem('qw_meta_v4');
      localStorage.removeItem('qw_kline_v3');
      localStorage.removeItem('qw_meta_v3');
      location.reload();
    }
  };
  window.UI = UI;

  /* 定时器：实时价 60s，倒计时 20s */
  setInterval(function () {
    if (!booted) return;
    var ms = DATA.marketState();
    if (ms.open) {
      DATA.loadRT(allCodes()).then(function () {
        computePending();
        if (APP.view === 'home') renderHome(); else renderStrat(APP.view);
        pushDaily();
      });
    }
    var cd = $('cdBox');
    if (cd) {
      var first = null;
      for (var id in pend) if (pend[id].actions.length && !pend[id].done) { first = id; break; }
      if (first) cd.textContent = cdText(nextRun(first));
    }
  }, 60000);

  /* 回到前台：超过 3 分钟则刷新实时价 */
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible' || !booted) return;
    if (Date.now() - (DATA.lastFetch || 0) < 180000) return;
    DATA.loadRT(allCodes()).then(function () {
      computePending();
      renderAll();
      setStatus(DATA.marketState().text + ' · ' + new Date(DATA.lastFetch).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), DATA.marketState().open);
    });
  });

  /* 启动 */
  document.addEventListener('DOMContentLoaded', function () {
    var tabs = document.querySelectorAll('#tabs a');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () { go(this.getAttribute('data-v')); });
    }
    $('btnRefresh').addEventListener('click', function () { boot(true); });
    themeInit();
    if ($('btnTheme')) $('btnTheme').addEventListener('click', toggleTheme);
    var h = (location.hash || '').replace('#', '');
    if (h) window.__QW_H = h;
    boot();
  });
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    // 兜底：若 DOMContentLoaded 已过
    setTimeout(function () { if (!booted && !$('view-home').innerHTML) boot(); }, 60);
  }
})();
