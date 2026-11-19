/* ============================================================
 * engine.js — 三策略量化引擎（纯前端，可同时运行于浏览器与 Node）
 *
 * 1) momentum : ETF动量轮动 v4.5「全球11池」
 *      - 池：518880 513500 159915 511380 510500 159985 513880 513100 159518 512480 513030
 *      - 加权动量 = 2×r15 + 3×r20 + 1×r25（百分数口径）
 *      - GS 过滤：6/12/24 日均线乖离 (v2+2v3+3v4)/6 三日平滑，>0 = G 允许买入，<=0 = S 顺延剔除
 *      - 乖离双层：周四选股层 乖离>12% 剔除递补；日频止盈层 持仓乖离>20% 降至 0.3 倍等权
 *      - 波动目标：近 90 日年化波动 >26% 等比降仓，减出仓位停泊 511380 可转债ETF
 *      - 前 3 等权（各 33.3%）、整百股、×0.99、佣金万3、周四 14:50 调仓
 * 2) earth    : 田先生买地球（加权斜率V2 双动量 M20 主排名 / M26 过滤，TOP1 满仓，每日 14:30）
 * 3) lowfreq  : 低频轮动 94618（25 日加权斜率得分 ∈(0.05,2]，TOP1，回撤5%止损/盈利12%止盈，
 *                空仓持 511880 银华日利，每日 14:50）
 *
 * 所有策略均为「自动记账」：按真实收盘价自动完成买卖、股数取整、佣金扣除、现金/持仓/净值更新。
 * 盘中用实时价生成「今日待办」前瞻信号，不落账。
 * ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.QE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ---------------- 策略定义 ---------------- */
  var STRATS = {
    momentum: {
      id: 'momentum',
      name: 'ETF动量轮动 v4.5',
      short: '动量轮动',
      sub: '全球11池 · 加权动量[15,20,25]×[2,3,1] · 前3等权 · 周四14:50 · GS过滤 · 乖离双层12/20 · 波动26%',
      exec: 'weekly',
      time: '14:50',
      weekday: 4,
      pool: [
        { c: '518880', n: '黄金ETF' }, { c: '513500', n: '标普500' },
        { c: '159915', n: '创业板ETF' }, { c: '511380', n: '可转债ETF' },
        { c: '510500', n: '中证500ETF' }, { c: '159985', n: '豆粕ETF' },
        { c: '513880', n: '日经225' }, { c: '513100', n: '纳斯达克' },
        { c: '159518', n: '标普油气' }, { c: '512480', n: '半导体ETF' },
        { c: '513030', n: '德国ETF' }
      ],
      qdii: { '513500': 1, '513880': 1, '513100': 1, '159518': 1, '513030': 1 },
      bench: { c: '510300', n: '沪深300' },
      cfg: {
        windows: [15, 20, 25], weights: [2, 3, 1], topK: 3,
        volTarget: 0.26, volWin: 90,
        biasExclude: 0.12, biasStop: 0.20, biasScale: 0.3,
        gsSmooth: 3, highNq: 5, highQdii: 12,
        cashFactor: 0.99, bond: '511380',
        commission: 0.0003, slip: 0, minLot: 100
      }
    },

    earth: {
      id: 'earth',
      name: '田先生买地球',
      short: '买地球',
      sub: '双动量加权斜率 · TOP1 满仓 · 每日14:30',
      exec: 'daily',
      time: '14:30',
      pool: [
        { c: '518880', n: '黄金' }, { c: '159509', n: '纳指科技' },
        { c: '588000', n: '科创50' }, { c: '501225', n: '全球芯片LOF' },
        { c: '513100', n: '纳指' }, { c: '513310', n: '中韩半导体' },
        { c: '159915', n: '创业板' }, { c: '162719', n: '石油LOF' },
        { c: '159985', n: '豆粕' }, { c: '513030', n: '德国' },
        { c: '513290', n: '纳指生物' }, { c: '513520', n: '日经' }
      ],
      bench: { c: '510300', n: '沪深300' },
      cfg: {
        /* 官方 /22753 参数：weighted_slope 20 日单动量，合格区间 0~3，
           无 M2 过滤、无涨跌停剔除、满仓无预留、滑点 0.1%、佣金万1 */
        n1: 20, n2: 20, lo1: 0, hi1: 3, lo2: -999, hi2: 999,
        topK: 1, minHold: 2, reserve: 0, limit: 1,
        commission: 0.0001, slip: 0.001, minLot: 100,
        ddStop: 0.04, stopLoss: 0.06, freeze: 0
      }
    },

    lowfreq: {
      id: 'lowfreq',
      name: '低频轮动',
      short: '低频轮动',
      sub: '20池+货币备选 · 25日加权斜率 · TOP1 · 止损5%止盈12% · 14:50',
      exec: 'daily',
      time: '14:50',
      pool: [
        { c: '518880', n: '黄金ETF' }, { c: '162415', n: '美国消费LOF' },
        { c: '501225', n: '全球芯片LOF' }, { c: '159915', n: '创业板ETF' },
        { c: '159985', n: '豆粕ETF' }, { c: '161226', n: '国投白银LOF' },
        { c: '159941', n: '纳指ETF' }, { c: '513030', n: '德国ETF' },
        { c: '563230', n: '卫星ETF' }, { c: '161127', n: '标普生物LOF' },
        { c: '159852', n: '软件ETF' }, { c: '512980', n: '传媒ETF' },
        { c: '162719', n: '石油LOF' }, { c: '513090', n: '香港证券' },
        { c: '159582', n: '半导体ETF' }, { c: '162411', n: '华宝油气' },
        { c: '159995', n: '芯片ETF' }, { c: '160723', n: '嘉实原油LOF' },
        { c: '159667', n: '工业母机' }, { c: '512200', n: '房地产ETF' }
      ],
      bench: { c: '510300', n: '沪深300' },
      cfg: {
        n: 25, lo: 0.05, hi: 2.0, topK: 1, minHold: 2,
        stopLoss: 0.05, stopFreeze: 1,
        takeProfit: 0.12, tpCooldown: 2,
        fallback: { c: '511880', n: '银华日利' },
        reserve: 0.02, commission: 0.00005, slip: 0, minLot: 100
      }
    }
  };

  /* ---------------- 工具 ---------------- */
  function sym(code) { return (code[0] === '5' || code[0] === '6') ? 'sh' + code : 'sz' + code; }
  function nameOf(strat, code) {
    for (var i = 0; i < strat.pool.length; i++) if (strat.pool[i].c === code) return strat.pool[i].n;
    if (strat.cfg.fallback && strat.cfg.fallback.c === code) return strat.cfg.fallback.n;
    if (code === '511880') return '银华日利';
    return code;
  }
  function lot(sh, minLot) { minLot = minLot || 100; return Math.floor(sh / minLot) * minLot; }
  function round2(x) { return Math.round(x * 100) / 100; }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /* 加权斜率 V2：得分 = 年化斜率 × 加权R²（与既有引擎逐行一致） */
  function wslopeFull(closes, n) {
    if (!closes || closes.length < n) return null;
    var p = closes.slice(-n), i;
    for (i = 0; i < p.length; i++) if (!(p[i] > 0)) return null;
    var y = [], x = [], w = [], ww = [];
    for (i = 0; i < n; i++) {
      y.push(Math.log(p[i])); x.push(i);
      w.push(1 + i / (n - 1)); ww.push(w[i] * w[i]);
    }
    var sw = 0, sxw = 0, syw = 0;
    for (i = 0; i < n; i++) { sw += ww[i]; sxw += ww[i] * x[i]; syw += ww[i] * y[i]; }
    var xbar = sxw / sw, ybar = syw / sw, sxy = 0, sxx = 0;
    for (i = 0; i < n; i++) {
      sxy += ww[i] * (x[i] - xbar) * (y[i] - ybar);
      sxx += ww[i] * (x[i] - xbar) * (x[i] - xbar);
    }
    var slope = sxx > 0 ? sxy / sxx : 0;
    var intercept = ybar - slope * xbar;
    var annual = Math.exp(slope * 250) - 1;
    var yb = 0, sws = 0;
    for (i = 0; i < n; i++) { yb += w[i] * y[i]; sws += w[i]; }
    yb /= sws;
    var ssres = 0, sstot = 0;
    for (i = 0; i < n; i++) {
      var yp = slope * x[i] + intercept;
      ssres += w[i] * (y[i] - yp) * (y[i] - yp);
      sstot += w[i] * (y[i] - yb) * (y[i] - yb);
    }
    var r2 = sstot > 0 ? 1 - ssres / sstot : 0;
    return { score: annual * r2, annual: annual, r2: r2, slope: slope };
  }
  function wslopeV2(closes, n) {
    var o = wslopeFull(closes, n);
    return o ? o.score : null;
  }

  /* ---------------- 行情索引 ---------------- */
  function buildIndex(klines) {
    var idx = { byCode: {}, calendar: [] }, set = {}, i, code;
    for (code in klines) {
      var k = klines[code];
      if (!k || !k.d || !k.d.length) continue;
      var map = {}, closes = [];
      for (i = 0; i < k.d.length; i++) { map[k.d[i]] = i; closes.push(k.c[i]); set[k.d[i]] = 1; }
      idx.byCode[code] = { map: map, dates: k.d, closes: closes };
    }
    idx.calendar = Object.keys(set).sort();
    return idx;
  }

  /* 序列最后一条的索引（<=date） */
  function lastIdxOf(idx, code, date) {
    var o = idx.byCode[code];
    if (!o) return null;
    if (o.map[date] !== undefined) return { o: o, i: o.map[date] };
    var lo = 0, hi = o.dates.length - 1, ans = -1;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (o.dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (ans < 0) return null;
    return { o: o, i: ans };
  }

  /* 取序列；若今日实时价尚未进入日线，则追加为当日bar */
  function seriesFor(idx, code, date, extra, today) {
    var li = lastIdxOf(idx, code, date);
    if (!li) return null;
    var s = li.o.closes.slice(0, li.i + 1);
    if (extra && extra[code] != null && extra[code] > 0) {
      var lastD = li.o.dates[li.i];
      if (!today || lastD < today) s = s.concat([extra[code]]);
    }
    return s;
  }

  function priceAt(idx, code, date) {
    var o = idx.byCode[code];
    if (!o) return null;
    var i = o.map[date];
    if (i === undefined) return null;
    return o.closes[i];
  }

  /* 收盘序列（截至 date，含当日）；无当日数据返回截至该日的最后一条 */
  function seriesTo(idx, code, date) {
    var o = idx.byCode[code];
    if (!o) return null;
    var i = o.map[date];
    if (i === undefined) {
      var lo = 0, hi = o.dates.length - 1, ans = -1;
      while (lo <= hi) {
        var mid = (lo + hi) >> 1;
        if (o.dates[mid] <= date) { ans = mid; lo = mid + 1; } else hi = mid - 1;
      }
      if (ans < 0) return null;
      return o.closes.slice(0, ans + 1);
    }
    return o.closes.slice(0, i + 1);
  }

  function lastPriceBefore(idx, code, date) {
    var s = seriesTo(idx, code, date);
    return s && s.length ? s[s.length - 1] : null;
  }

  /* ============================================================
   * v4.5 动量口径（与壳工程 index.html 逐行一致）
   * ref = 评估日之前的收盘序列（剔除评估当日 bar）
   * px  = 评估价（回放=当日收盘；实时=实时价）
   * ============================================================ */
  function momSeries(idx, code, date, rt, today) {
    var li = lastIdxOf(idx, code, date);
    if (!li) return null;
    var o = li.o, i = li.i;
    var live = !!(rt && rt[code] && rt[code].price > 0 && (!today || date >= today));
    var px = live ? rt[code].price : o.closes[i];
    // ref = 评估日之前的收盘序列
    //   回放：评估日 bar 即成交价 → 剔除（i-1）
    //   实时且日K已含今日 bar：今日 bar 是盘中未完成 bar → 剔除（i-1）
    //   实时且日K尚未含今日：最后一根已是昨日 → 保留（i）
    var refEnd = (!live || o.dates[i] >= today) ? i - 1 : i;
    if (refEnd < 0) return null;
    var ref = o.closes.slice(0, refEnd + 1);
    return { ref: ref, px: px, lastD: o.dates[i], live: live };
  }

  function momOf(px, ref, n) {
    if (!ref || ref.length < n) return null;
    var ago = ref[ref.length - n];
    if (!(ago > 0)) return null;
    return px / ago - 1;
  }
  function biasOf(px, ref) {
    if (!ref || ref.length < 20) return null;
    var s = 0;
    for (var i = ref.length - 20; i < ref.length; i++) s += ref[i];
    var ma = s / 20;
    if (!(ma > 0)) return null;
    return px / ma - 1;
  }
  function gsOf(ref, smooth) {
    smooth = smooth || 3;
    if (!ref || ref.length < 25) return null;
    var vals = [], off, k;
    for (off = smooth - 1; off >= 0; off--) {
      var i = ref.length - 1 - off;
      if (i < 24) return null;
      var c = ref[i], m6 = 0, m12 = 0, m24 = 0;
      for (k = 0; k < 6; k++) m6 += ref[i - k];
      for (k = 0; k < 12; k++) m12 += ref[i - k];
      for (k = 0; k < 24; k++) m24 += ref[i - k];
      m6 /= 6; m12 /= 12; m24 /= 24;
      var v2 = (c - m6) / m6 * 100, v3 = (c - m12) / m12 * 100, v4 = (c - m24) / m24 * 100;
      vals.push((v2 + 2 * v3 + 3 * v4) / 6);
    }
    var s = 0;
    for (k = 0; k < vals.length; k++) s += vals[k];
    s /= vals.length;
    return isFinite(s) ? s : null;
  }

  /* 近 volWin 日等权组合年化波动（复刻 combVol） */
  function combVolAt(idx, codes, date, volWin, rt, today) {
    var cfg = STRATS.momentum.cfg;
    volWin = volWin || cfg.volWin;
    var series = {}, keys = [], i, c;
    for (i = 0; i < codes.length; i++) {
      c = codes[i];
      var o = idx.byCode[c];
      if (!o || o.dates.length < 30) continue;
      var s = {}, j;
      for (j = 0; j < o.dates.length; j++) {
        if (o.dates[j] > date) break;
        s[o.dates[j]] = o.closes[j];
      }
      if (rt && rt[c] && rt[c].price > 0 && (!today || date >= today)) s[date] = rt[c].price;
      series[c] = s; keys.push(c);
    }
    if (!keys.length) return { realized: null, scale: 1 };
    var dset = {}, k;
    for (k = 0; k < keys.length; k++) for (var d in series[keys[k]]) dset[d] = 1;
    var dates = Object.keys(dset).sort();
    var prev = null, rets = [], avgSeq = [], dateSeq = [];
    for (i = 0; i < dates.length; i++) {
      var sum = 0, n = 0;
      for (k = 0; k < keys.length; k++) {
        var v = series[keys[k]][dates[i]];
        if (v != null) { sum += v; n++; }
      }
      if (!n) continue;
      var avg = sum / n;
      if (prev !== null && prev > 0) rets.push(avg / prev - 1);
      avgSeq.push(avg); dateSeq.push(dates[i]);
      prev = avg;
    }
    var startIdx = Math.max(0, rets.length - volWin);
    var win = rets.slice(startIdx);
    if (win.length < 20) return { realized: null, scale: 1 };
    var mean = 0;
    for (i = 0; i < win.length; i++) mean += win[i];
    mean /= win.length;
    var varr = 0;
    for (i = 0; i < win.length; i++) varr += (win[i] - mean) * (win[i] - mean);
    varr /= (win.length - 1);
    var dailyStd = Math.sqrt(varr);
    var realized = dailyStd * Math.sqrt(252);
    var scale = (realized > cfg.volTarget && realized > 0) ? Math.min(1, cfg.volTarget / realized) : 1;
    var a0 = avgSeq[startIdx] || 1, a1 = avgSeq[Math.min(rets.length, avgSeq.length - 1)] || 1;
    return {
      realized: realized, scale: scale, ok: scale >= 0.999,
      winStart: dateSeq[startIdx], winEnd: dateSeq[dateSeq.length - 1],
      windowRet: a0 > 0 ? a1 / a0 - 1 : null,
      nRets: win.length, dailyStd: dailyStd
    };
  }

  /* ============================================================
   * 动量榜：11 只全量（含 r15/r20/r25/加权动量/乖离/溢价/GS/信号）
   * ============================================================ */
  function momBoard(strat, idx, date, rt, today) {
    var cfg = strat.cfg, out = [], i;
    for (i = 0; i < strat.pool.length; i++) {
      var it = strat.pool[i];
      var ms = momSeries(idx, it.c, date, rt, today);
      if (!ms) continue;
      var r15 = momOf(ms.px, ms.ref, 15), r20 = momOf(ms.px, ms.ref, 20), r25 = momOf(ms.px, ms.ref, 25);
      if (r15 == null || r20 == null || r25 == null) continue;
      var mom = 2 * r15 + 3 * r20 + 1 * r25;
      var bias = biasOf(ms.px, ms.ref);
      var gs = gsOf(ms.ref, cfg.gsSmooth);
      var nav = (ms.live && rt[it.c].nav > 0) ? rt[it.c].nav : null;
      var prem = nav ? (ms.px / nav - 1) : null;
      var chg = (ms.live && rt[it.c].pct != null) ? rt[it.c].pct / 100
        : (ms.ref.length >= 1 && ms.ref[ms.ref.length - 1] > 0 ? ms.px / ms.ref[ms.ref.length - 1] - 1 : null);
      out.push({
        code: it.c, n: it.n, price: ms.px, chg: chg,
        r15: r15 * 100, r20: r20 * 100, r25: r25 * 100,
        mom: mom * 100, bias: bias != null ? bias * 100 : null,
        premium: prem != null ? prem * 100 : null,
        gs: gs, signal: null, pass: false
      });
    }
    out.sort(function (a, b) { return b.mom - a.mom; });
    for (i = 0; i < out.length; i++) out[i].rank = i + 1;
    momPick(strat, out);
    return out;
  }

  /* 选股：GS<=0 顺延剔除 → 乖离>12% 剔除 → 取前3；不足则仅按乖离递补 */
  function momPick(strat, board) {
    var cfg = strat.cfg, top = [], excluded = [], i, it;
    for (i = 0; i < board.length; i++) {
      it = board[i];
      it.signal = null; it.pass = false; it.filled = false;
      if (top.length >= cfg.topK) { it.signal = 'idle'; continue; }
      if (it.gs != null && it.gs <= 0) { it.signal = 'gs'; excluded.push(it); continue; }
      if (it.bias != null && it.bias > cfg.biasExclude * 100) { it.signal = 'bias'; excluded.push(it); continue; }
      it.signal = 'hold'; it.pass = true; top.push(it);
    }
    if (top.length < cfg.topK) {
      var have = {};
      for (i = 0; i < top.length; i++) have[top[i].code] = 1;
      for (i = 0; i < board.length && top.length < cfg.topK; i++) {
        it = board[i];
        if (have[it.code]) continue;
        if (it.bias != null && it.bias > cfg.biasExclude * 100) continue;
        it.signal = 'hold'; it.pass = true; it.filled = true;
        top.push(it); have[it.code] = 1;
      }
    }
    return { top: top, excluded: excluded };
  }

  /* ---------------- 账户 ---------------- */
  function newAccount(stratId, capital, startDate) {
    return {
      id: stratId, capital: capital || 100000, start: startDate || '2024-01-02',
      lastDate: null, cash: capital || 100000, pos: {},
      nav: [], navD: [], trades: [],
      freezeMap: {}, coolMap: {},   // 止损/止盈只冻结被卖出的那只，当天仍可换到其他标的
      todayTrades: [], lastSignal: null
    };
  }

  function posList(acct) {
    var out = [];
    for (var c in acct.pos) {
      var p = acct.pos[c];
      if (p && p.sh > 0) out.push({ code: c, sh: p.sh, cost: p.cost, buyDate: p.buyDate, peak: p.peak, entry: p.entry });
    }
    return out;
  }

  function valueAt(acct, idx, date) {
    var mv = 0, list = posList(acct);
    for (var i = 0; i < list.length; i++) {
      var px = priceAt(idx, list[i].code, date);
      if (px == null) px = lastPriceBefore(idx, list[i].code, date) || list[i].cost;
      mv += list[i].sh * px;
    }
    return { total: acct.cash + mv, mv: mv };
  }

  /* ---------------- 交易执行 ---------------- */
  function trade(acct, date, act, code, name, sh, px, feeRate, slipRate, note) {
    if (sh <= 0) return;
    var amt, fee, holdDays = null, pnl = null, pnlPct = null, costPx = null;
    if (act === 'BUY') {
      px = px * (1 + (slipRate || 0));
      amt = sh * px; fee = Math.max(amt * (feeRate || 0), 0);
      acct.cash -= amt + fee;
      var cur = acct.pos[code];
      if (cur) {
        cur.cost = (cur.cost * cur.sh + amt) / (cur.sh + sh);
        cur.sh += sh;
        cur.entry = cur.cost;
      } else {
        acct.pos[code] = { sh: sh, cost: px, buyDate: date, peak: px, entry: px };
      }
    } else {
      var held = acct.pos[code];
      costPx = held ? held.cost : null;
      if (held && held.buyDate) holdDays = daysBetween(acct._cal, held.buyDate, date);
      px = px * (1 - (slipRate || 0));
      amt = sh * px; fee = Math.max(amt * (feeRate || 0), 0);
      acct.cash += amt - fee;
      if (costPx) {
        pnl = round2(sh * (px - costPx) - fee);
        pnlPct = costPx > 0 ? px / costPx - 1 : null;
      }
      var p = acct.pos[code];
      if (p) {
        p.sh -= sh;
        if (p.sh <= 0) delete acct.pos[code];
      }
    }
    var rec = {
      d: date, act: act, code: code, n: name, sh: sh, px: r3(px),
      amt: Math.round(amt), fee: round2(fee), note: note || '',
      costPx: costPx != null ? r3(costPx) : null,
      holdDays: holdDays, pnl: pnl, pnlPct: pnlPct
    };
    acct.trades.push(rec);
    acct.todayTrades.push(rec);
    return rec;
  }

  /* 交易日间隔（用于持有天数） */
  function daysBetween(cal, a, b) {
    if (!cal || !a || !b) return null;
    var n = 0;
    for (var i = 0; i < cal.length; i++) if (cal[i] > a && cal[i] <= b) n++;
    return n;
  }

  /* ---------------- 信号：加权斜率（earth / lowfreq） ---------------- */
  function scoreSlope(strat, idx, date, n, lo, hi, extra, limitCheck, today) {
    var out = [];
    for (var i = 0; i < strat.pool.length; i++) {
      var it = strat.pool[i];
      var s = seriesFor(idx, it.c, date, extra, today);
      if (!s || s.length < n + 1) continue;
      var cur = s[s.length - 1];
      if (!(cur > 0)) continue;
      var o = wslopeFull(s, n);
      if (!o || !isFinite(o.score)) continue;
      var chg = null;
      if (s.length >= 2 && s[s.length - 2] > 0) chg = cur / s[s.length - 2] - 1;
      var pass = (o.score > lo && o.score <= hi);
      var why = pass ? '' : (o.score <= lo ? '动量不足' : '动量过热');
      if (limitCheck && chg != null && Math.abs(chg) >= limitCheck) { pass = false; why = '近涨跌停'; }
      out.push({
        code: it.c, n: it.n, price: cur, chg: chg,
        score: o.score, annual: o.annual, r2: o.r2, pass: pass, why: why
      });
    }
    out.sort(function (a, b) { return b.score - a.score; });
    return out;
  }

  /* ---------------- 每日决策 ---------------- */
  function decide(strat, acct, idx, date, ranks, rt, today) {
    var cfg = strat.cfg, tv = valueAt(acct, idx, date).total;
    var pos = posList(acct), held = pos.length ? pos[0] : null;
    var heldDays = held ? tradingDaysBetween(idx, held.buyDate, date) : 0;

    /* ---------- 动量轮动 v4.5 ---------- */
    if (strat.id === 'momentum') {
      var pick = momPick(strat, ranks);
      var top = pick.top;
      var vol = combVolAt(idx, top.map(function (t) { return t.code; }), date, cfg.volWin, rt, today);
      var scale = vol.scale || 1;
      var targets = [], i;
      for (i = 0; i < top.length; i++) {
        var t = top[i];
        var extra = (scale < 1 && t.code === cfg.bond) ? (1 - scale) : 0;
        var tgtVal = tv * (scale / cfg.topK + extra) * cfg.cashFactor;
        var sh = lot(Math.floor(tgtVal / t.price), cfg.minLot);
        if (sh >= cfg.minLot) targets.push({ code: t.code, n: t.n, sh: sh, px: t.price });
      }
      if (scale < 1) {
        var parked = false;
        for (i = 0; i < targets.length; i++) if (targets[i].code === cfg.bond) parked = true;
        if (!parked) {
          var bp = priceAt(idx, cfg.bond, date) || lastPriceBefore(idx, cfg.bond, date);
          if (bp) {
            var bsh = lot(Math.floor(tv * (1 - scale) * cfg.cashFactor / bp), cfg.minLot);
            if (bsh >= cfg.minLot) targets.push({ code: cfg.bond, n: '可转债ETF', sh: bsh, px: bp });
          }
        }
      }
      return {
        targets: targets, scale: scale, top: top, excluded: pick.excluded, vol: vol,
        note: !top.length ? '无合格标的 · 空仓'
          : (scale < 0.999 ? '波动目标降仓 ' + (scale * 100).toFixed(0) + '%' : '前' + top.length + '等权')
      };
    }

    /* ---------- 买地球 ---------- */
    if (strat.id === 'earth') {
      var t1 = ranks.filter(function (r) { return r.pass; })[0];
      if (!t1) return { targets: [], note: '无合格候选 · 空仓' };
      if (held && held.code === t1.code) return { targets: null, note: '继续持有 TOP1' };
      if (held && heldDays < cfg.minHold) return { targets: null, note: '最短持有未满（' + heldDays + '/2日）' };
      var budget = tv * (1 - cfg.reserve);
      var sh1 = lot(Math.floor(budget / (t1.price * (1 + cfg.slip))), cfg.minLot);
      if (sh1 < cfg.minLot) return { targets: [], note: '资金不足一手' };
      return { targets: [{ code: t1.code, n: t1.n, sh: sh1, px: t1.price }], note: held ? '换仓' : '建仓' };
    }

    /* ---------- 低频轮动 ---------- */
    // 止损/止盈只冻结被卖出的那只，当天即可按排名换到其他标的
    var t2 = ranks.filter(function (r) { return r.pass && !frozenOf(acct, r.code); })[0];
    if (held && t2 && held.code === t2.code) return { targets: null, note: '继续持有' };
    if (held && t2 && heldDays < cfg.minHold) return { targets: null, note: '最短持有未满（' + heldDays + '/2日）' };
    if (!t2) {
      var fb = cfg.fallback;
      if (held && held.code === fb.c) return { targets: null, note: '空仓期持有货币ETF' };
      var fbp = priceAt(idx, fb.c, date) || lastPriceBefore(idx, fb.c, date);
      if (!fbp) return { targets: [], note: '无候选 · 空仓' };
      var fbsh = lot(Math.floor(tv * (1 - cfg.reserve) / (fbp * (1 + cfg.slip))), cfg.minLot);
      return { targets: fbsh >= cfg.minLot ? [{ code: fb.c, n: fb.n, sh: fbsh, px: fbp }] : [], note: '无候选 · 转货币ETF' };
    }
    var sh2 = lot(Math.floor(tv * (1 - cfg.reserve) / (t2.price * (1 + cfg.slip))), cfg.minLot);
    if (sh2 < cfg.minLot) return { targets: [], note: '资金不足一手' };
    return { targets: [{ code: t2.code, n: t2.n, sh: sh2, px: t2.price }], note: held ? '换仓' : '建仓' };
  }

  function applyTargets(acct, strat, idx, date, plan) {
    var cfg = strat.cfg;
    if (plan.targets === null) return;
    var want = {};
    plan.targets.forEach(function (t) { want[t.code] = t.sh; });
    var list = posList(acct), i;
    for (i = 0; i < list.length; i++) {
      if (want[list[i].code] === undefined) {
        var px = priceAt(idx, list[i].code, date) || lastPriceBefore(idx, list[i].code, date);
        if (px) trade(acct, date, 'SELL', list[i].code, nameOf(strat, list[i].code), list[i].sh, px, cfg.commission, cfg.slip, plan.note);
      }
    }
    for (var j = 0; j < plan.targets.length; j++) {
      var t = plan.targets[j], cur = acct.pos[t.code] ? acct.pos[t.code].sh : 0;
      var diff = t.sh - cur;
      if (diff > 0) {
        var afford = lot(Math.floor(acct.cash / (t.px * (1 + cfg.slip) * (1 + cfg.commission))), cfg.minLot);
        var buy = Math.min(diff, afford);
        if (buy >= cfg.minLot) trade(acct, date, 'BUY', t.code, nameOf(strat, t.code), buy, t.px, cfg.commission, cfg.slip, plan.note);
      } else if (diff < 0) {
        trade(acct, date, 'SELL', t.code, nameOf(strat, t.code), -diff, t.px, cfg.commission, cfg.slip, plan.note);
      }
    }
  }

  /* 该标的是否在冻结/冷静期（止损后 N 日不买回同一只） */
  function frozenOf(acct, code) {
    return ((acct.freezeMap && acct.freezeMap[code]) || 0) > 0 ||
      ((acct.coolMap && acct.coolMap[code]) || 0) > 0;
  }
  function tickFreeze(acct) {
    var k;
    if (acct.freezeMap) for (k in acct.freezeMap) if (acct.freezeMap[k] > 0) acct.freezeMap[k]--;
    if (acct.coolMap) for (k in acct.coolMap) if (acct.coolMap[k] > 0) acct.coolMap[k]--;
  }

  function tradingDaysBetween(idx, a, b) {
    if (!a || !b) return 0;
    var cal = idx.calendar, n = 0;
    for (var i = 0; i < cal.length; i++) if (cal[i] > a && cal[i] <= b) n++;
    return n;
  }

  /* ---------------- 回放主循环 ---------------- */
  function replay(acct, strat, idx, upTo, opt) {
    opt = opt || {};
    var cfg = strat.cfg;
    var cal = idx.calendar.filter(function (d) { return d >= acct.start && d <= upTo; });
    var i, j;
    acct.todayTrades = [];
    acct._cal = idx.calendar;   // 供 trade() 计算持有天数
    for (i = 0; i < cal.length; i++) {
      var date = cal[i];
      if (acct.lastDate && date <= acct.lastDate) continue;

      // 当日净值在「日末」记录（交易后），否则换仓日会把今日盈亏算错

      // 更新持仓峰值（止损用）
      var pl = posList(acct);
      for (j = 0; j < pl.length; j++) {
        var px = priceAt(idx, pl[j].code, date);
        if (px && acct.pos[pl[j].code]) acct.pos[pl[j].code].peak = Math.max(acct.pos[pl[j].code].peak || 0, px);
      }

      var isThu = new Date(date + 'T00:00:00').getDay() === 4;
      var doTrade = strat.exec === 'weekly' ? isThu : true;

      var ranks = null;
      if (strat.id === 'momentum') {
        ranks = momBoard(strat, idx, date, null, null);
      } else if (strat.id === 'earth') {
        ranks = scoreSlope(strat, idx, date, cfg.n1, cfg.lo1, cfg.hi1, null, cfg.limit);
        var m26 = scoreSlope(strat, idx, date, cfg.n2, cfg.lo2, cfg.hi2, null, cfg.limit);
        var m26map = {};
        m26.forEach(function (r) { m26map[r.code] = r; });
        ranks = ranks.map(function (r) {
          var f = m26map[r.code];
          r.score2 = f ? f.score : null;
          if (!f || !f.pass) { r.pass = false; if (!r.why) r.why = 'M26过滤'; }
          return r;
        }).sort(function (a, b) { return b.score - a.score; });
      } else {
        ranks = scoreSlope(strat, idx, date, cfg.n, cfg.lo, cfg.hi, null, 0);
      }
      acct.lastRanks = ranks;

      // ---- 动量轮动：非周四做日频乖离止盈（>20% → 降至 0.3 倍等权） ----
      if (strat.id === 'momentum' && !isThu) {
        var tv0 = valueAt(acct, idx, date).total;
        var ps0 = posList(acct);
        for (j = 0; j < ps0.length; j++) {
          var c0 = ps0[j].code, p0 = acct.pos[c0];
          if (!p0) continue;
          var li0 = lastIdxOf(idx, c0, date);
          if (!li0 || li0.i < 21) continue;
          var ref0 = li0.o.closes.slice(0, li0.i);
          var b0 = biasOf(li0.o.closes[li0.i], ref0);
          if (b0 == null || b0 <= cfg.biasStop) continue;
          var px0 = li0.o.closes[li0.i];
          var tv0v = tv0 * cfg.biasScale / cfg.topK * cfg.cashFactor;
          var tsh0 = lot(Math.floor(tv0v / px0), cfg.minLot);
          if (tsh0 > 0 && tsh0 < p0.sh) {
            trade(acct, date, 'SELL', c0, nameOf(strat, c0), p0.sh - tsh0, px0, cfg.commission, cfg.slip,
              '日频乖离止盈 ' + (b0 * 100).toFixed(1) + '%');
          }
        }
        acct.lastPlan = { targets: [], note: '非调仓日 · 仅日频乖离止盈' };
        snap(acct, idx, date);
        acct.lastDate = date;
        continue;
      }

      // ---- 低频轮动：止损/止盈（逐日，优先于轮动） ----
      // 卖出后只冻结该标的 N 日，当天仍继续按排名换仓（否则换仓日会被推迟一天）
      var riskOut = null;
      if (strat.id === 'lowfreq') {
        var ps = posList(acct);
        for (j = 0; j < ps.length; j++) {
          var code = ps[j].code;
          var p = acct.pos[code];
          if (!p || code === cfg.fallback.c) continue;
          var cpx = priceAt(idx, code, date);
          if (!cpx) continue;
          if (p.peak && cpx / p.peak - 1 <= -cfg.stopLoss) {
            trade(acct, date, 'SELL', code, nameOf(strat, code), p.sh, cpx, cfg.commission, cfg.slip, '高点回撤止损 -' + (cfg.stopLoss * 100) + '%');
            acct.freezeMap[code] = cfg.stopFreeze;
            riskOut = nameOf(strat, code) + ' 回撤 ' + ((cpx / p.peak - 1) * 100).toFixed(1) + '% 止损';
            break;
          }
          if (p.entry && cpx / p.entry - 1 >= cfg.takeProfit) {
            trade(acct, date, 'SELL', code, nameOf(strat, code), p.sh, cpx, cfg.commission, cfg.slip, '盈利止盈 +' + (cfg.takeProfit * 100) + '%');
            acct.coolMap[code] = cfg.tpCooldown;
            riskOut = nameOf(strat, code) + ' 盈利 ' + ((cpx / p.entry - 1) * 100).toFixed(1) + '% 止盈';
            break;
          }
        }
      }

      if (doTrade) {
        var plan = decide(strat, acct, idx, date, ranks, null, null);
        if (riskOut) plan.note = riskOut + ' → ' + plan.note;
        acct.lastPlan = plan;
        applyTargets(acct, strat, idx, date, plan);
      }

      tickFreeze(acct);
      snap(acct, idx, date);
      acct.lastDate = date;
    }
    return acct;
  }

  /* 记录当日收盘净值（交易后） */
  function snap(acct, idx, date) {
    var v = valueAt(acct, idx, date);
    acct.nav.push(round2(v.total));
    acct.navD.push(date);
  }

  /* ---------------- 绩效 ---------------- */
  function metrics(acct, idx, strat) {
    var nav = acct.nav;
    if (!nav.length) return null;
    var n = nav.length, years = n / 252, finalV = nav[n - 1], initV = acct.capital;
    var total = finalV / initV - 1;
    var annual = years > 0 ? Math.pow(finalV / initV, 1 / years) - 1 : 0;
    var rets = [], i;
    for (i = 1; i < n; i++) rets.push(nav[i] / nav[i - 1] - 1);
    var mean = 0; for (i = 0; i < rets.length; i++) mean += rets[i]; mean /= (rets.length || 1);
    var v = 0; for (i = 0; i < rets.length; i++) v += (rets[i] - mean) * (rets[i] - mean);
    var vol = Math.sqrt(v / Math.max(rets.length - 1, 1)) * Math.sqrt(252);
    var sharpe = vol > 0 ? (annual - 0.02) / vol : 0;
    var peak = nav[0], mdd = 0;
    for (i = 0; i < n; i++) {
      if (nav[i] > peak) peak = nav[i];
      var dd = nav[i] / peak - 1;
      if (dd < mdd) mdd = dd;
    }
    var wins = rets.filter(function (r) { return r > 0; }).length;
    var pos = posList(acct);
    var mv = 0;
    for (i = 0; i < pos.length; i++) {
      var px = lastPriceBefore(idx, pos[i].code, acct.lastDate) || pos[i].cost;
      mv += pos[i].sh * px;
    }
    return {
      capital: initV, value: finalV, total: total, annual: annual, vol: vol, sharpe: sharpe,
      mdd: mdd, winRate: rets.length ? wins / rets.length : 0,
      days: n, trades: acct.trades.length, mv: mv, cash: acct.cash,
      lastDate: acct.lastDate, start: acct.start
    };
  }

  /* ---------------- 今日待办（实时价前瞻，不落账） ---------------- */
  function pendingSignal(strat, acct, idx, rt, today) {
    var cfg = strat.cfg;
    var extra = {};
    if (rt) for (var c in rt) if (rt[c] && rt[c].price > 0) extra[c] = rt[c].price;
    var lastD = acct.lastDate || today;
    var tv = valueAt(acct, idx, lastD).total;
    var pos = posList(acct);
    var isThu = new Date(today + 'T00:00:00').getDay() === 4;

    /* ---------- 动量轮动 ---------- */
    if (strat.id === 'momentum') {
      var board = momBoard(strat, idx, today, rt, today);
      var pick = momPick(strat, board);
      var top = pick.top;
      var vol = combVolAt(idx, top.map(function (t) { return t.code; }), today, cfg.volWin, rt, today);
      var scale = vol.scale || 1;
      var out = [], i, j;

      // 目标组合（按今日排名等权 + 波动系数）
      var tgt = {}, order = [];
      for (i = 0; i < top.length; i++) {
        var t = top[i];
        var ex = (scale < 1 && t.code === cfg.bond) ? (1 - scale) : 0;
        var val = tv * (scale / cfg.topK + ex) * cfg.cashFactor;
        var sh = lot(Math.floor(val / t.price), cfg.minLot);
        if (sh >= cfg.minLot) { tgt[t.code] = sh; order.push({ code: t.code, n: t.n, px: t.price, sh: sh, w: (scale / cfg.topK + ex) * 100 }); }
      }
      if (scale < 1 && tgt[cfg.bond] === undefined) {
        var bp = (rt && rt[cfg.bond] && rt[cfg.bond].price) || priceAt(idx, cfg.bond, lastD);
        if (bp) {
          var bsh = lot(Math.floor(tv * (1 - scale) * cfg.cashFactor / bp), cfg.minLot);
          if (bsh >= cfg.minLot) { tgt[cfg.bond] = bsh; order.push({ code: cfg.bond, n: '可转债ETF', px: bp, sh: bsh, w: (1 - scale) * 100 }); }
        }
      }

      if (isThu) {
        // 卖出落榜/减仓
        for (i = 0; i < pos.length; i++) {
          var w = tgt[pos[i].code] || 0;
          if (w < pos[i].sh) out.push({ act: 'SELL', code: pos[i].code, n: nameOf(strat, pos[i].code), sh: pos[i].sh - w, px: extra[pos[i].code] || null });
        }
        // 买入不足
        for (j = 0; j < order.length; j++) {
          var cur = acct.pos[order[j].code] ? acct.pos[order[j].code].sh : 0;
          if (order[j].sh - cur >= cfg.minLot) out.push({ act: 'BUY', code: order[j].code, n: order[j].n, sh: order[j].sh - cur, px: order[j].px });
        }
        return {
          ranks: board, top: top, excluded: pick.excluded, vol: vol, scale: scale, targets: order,
          actions: out, note: out.length ? '周四调仓' : '本周无需调仓'
        };
      }

      // 非周四：只提示日频乖离止盈
      for (i = 0; i < pos.length; i++) {
        var li = lastIdxOf(idx, pos[i].code, today);
        if (!li) continue;
        var live = (rt && rt[pos[i].code] && rt[pos[i].code].price > 0);
        var px1 = live ? rt[pos[i].code].price : li.o.closes[li.i];
        var refEnd1 = (!live || li.o.dates[li.i] >= today) ? li.i - 1 : li.i;
        if (refEnd1 < 0) continue;
        var ref1 = li.o.closes.slice(0, refEnd1 + 1);
        var b1 = biasOf(px1, ref1);
        if (b1 != null && b1 > cfg.biasStop) {
          var keep = lot(Math.floor(tv * cfg.biasScale / cfg.topK * cfg.cashFactor / px1), cfg.minLot);
          if (keep < pos[i].sh) out.push({ act: 'SELL', code: pos[i].code, n: nameOf(strat, pos[i].code), sh: pos[i].sh - keep, px: px1 });
        }
      }
      return {
        ranks: board, top: top, excluded: pick.excluded, vol: vol, scale: scale, targets: order,
        actions: out, note: out.length ? '日频乖离止盈（持仓乖离>20%）' : '非调仓日 · 继续持有'
      };
    }

    /* ---------- 买地球 ---------- */
    if (strat.id === 'earth') {
      var ranks = scoreSlope(strat, idx, today, cfg.n1, cfg.lo1, cfg.hi1, extra, cfg.limit, today);
      var m26b = scoreSlope(strat, idx, today, cfg.n2, cfg.lo2, cfg.hi2, extra, cfg.limit, today);
      var mm = {}; m26b.forEach(function (r) { mm[r.code] = r; });
      ranks = ranks.map(function (r) {
        var f = mm[r.code]; r.score2 = f ? f.score : null;
        if (!f || !f.pass) { r.pass = false; if (!r.why) r.why = 'M26过滤'; }
        return r;
      }).sort(function (a, b) { return b.score - a.score; });

      var held = pos[0] || null;
      var heldDays = held ? tradingDaysBetween(idx, held.buyDate, lastD) : 0;
      var top1 = ranks.filter(function (r) { return r.pass; })[0];
      var acts = [];
      if (!top1) {
        if (held) acts.push({ act: 'SELL', code: held.code, n: nameOf(strat, held.code), sh: held.sh, px: extra[held.code] || null });
      } else if (!held || held.code !== top1.code) {
        if (!held || heldDays >= cfg.minHold) {
          if (held) acts.push({ act: 'SELL', code: held.code, n: nameOf(strat, held.code), sh: held.sh, px: extra[held.code] || null });
          var sh1 = lot(Math.floor(tv * (1 - cfg.reserve) / (top1.price * (1 + cfg.slip))), cfg.minLot);
          if (sh1 >= cfg.minLot) acts.push({ act: 'BUY', code: top1.code, n: top1.n, sh: sh1, px: top1.price });
        }
      }
      return { ranks: ranks, actions: acts, note: acts.length ? '待执行' : (held ? '继续持有' : '空仓观望') };
    }

    /* ---------- 低频轮动 ---------- */
    var ranks2 = scoreSlope(strat, idx, today, cfg.n, cfg.lo, cfg.hi, extra, 0, today);
    var fb = cfg.fallback;
    var mfb = wslopeFull(seriesFor(idx, fb.c, today, extra, today), cfg.n);
    if (mfb) {
      ranks2.push({
        code: fb.c, n: fb.n, price: extra[fb.c] || priceAt(idx, fb.c, lastD),
        chg: (rt && rt[fb.c] && rt[fb.c].pct != null) ? rt[fb.c].pct / 100 : null,
        score: mfb.score, annual: mfb.annual, r2: mfb.r2,
        pass: false, why: '货币备选', fb: true
      });
    }
    var held2 = pos[0] || null;
    var hd2 = held2 ? tradingDaysBetween(idx, held2.buyDate, lastD) : 0;
    var t2 = ranks2.filter(function (r) { return r.pass && !r.fb && !frozenOf(acct, r.code); })[0];
    var acts2 = [];
    if (!t2) {
      if (!held2) {
        var fbp = extra[fb.c] || priceAt(idx, fb.c, lastD);
        var fsh = fbp ? lot(Math.floor(tv * (1 - cfg.reserve) / (fbp * (1 + cfg.slip))), cfg.minLot) : 0;
        if (fsh >= cfg.minLot) acts2.push({ act: 'BUY', code: fb.c, n: fb.n, sh: fsh, px: fbp });
      } else if (held2.code !== fb.c && hd2 >= cfg.minHold) {
        acts2.push({ act: 'SELL', code: held2.code, n: nameOf(strat, held2.code), sh: held2.sh, px: extra[held2.code] || null });
        var fbp2 = extra[fb.c] || priceAt(idx, fb.c, lastD);
        var fsh2 = fbp2 ? lot(Math.floor(tv * (1 - cfg.reserve) / (fbp2 * (1 + cfg.slip))), cfg.minLot) : 0;
        if (fsh2 >= cfg.minLot) acts2.push({ act: 'BUY', code: fb.c, n: fb.n, sh: fsh2, px: fbp2 });
      }
    } else if (!held2 || held2.code !== t2.code) {
      if (!held2 || hd2 >= cfg.minHold) {
        if (held2) acts2.push({ act: 'SELL', code: held2.code, n: nameOf(strat, held2.code), sh: held2.sh, px: extra[held2.code] || null });
        var sh2 = lot(Math.floor(tv * (1 - cfg.reserve) / (t2.price * (1 + cfg.slip))), cfg.minLot);
        if (sh2 >= cfg.minLot) acts2.push({ act: 'BUY', code: t2.code, n: t2.n, sh: sh2, px: t2.price });
      }
    }
    return { ranks: ranks2, actions: acts2, note: acts2.length ? '待执行' : (held2 ? '继续持有' : '空仓观望') };
  }

  /* ---------------- 对外接口 ---------------- */
  return {
    STRATS: STRATS,
    sym: sym,
    nameOf: nameOf,
    wslopeV2: wslopeV2,
    wslopeFull: wslopeFull,
    buildIndex: buildIndex,
    newAccount: newAccount,
    replay: replay,
    metrics: metrics,
    pendingSignal: pendingSignal,
    posList: posList,
    valueAt: valueAt,
    seriesTo: seriesTo,
    priceAt: priceAt,
    tradingDaysBetween: tradingDaysBetween,
    momBoard: momBoard,
    momPick: momPick,
    biasOf: biasOf,
    gsOf: gsOf,
    combVolAt: combVolAt,
    scoreSlope: scoreSlope
  };
});
