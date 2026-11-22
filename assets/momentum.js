/* 次方量化 · 全部动量算法本地复现（与官网 /tool/momentum 口径一致）
   方法：
     simple            区间涨幅            P_t / P_{t-N} - 1
     simple_intraday   区间涨幅(分时版)    同上，价格取每日固定时刻分时价
     slope             斜率               ln 价等权 OLS → 年化 × R²
     slope_intraday    斜率(分时版)
     wslope            加权斜率 V1        回归用 w，残差用 w，总方差用「未加权均值」→ 口径不一致，可能负 R²
     wslope_intraday   加权斜率(分时版) V1
     wslope_v2         加权斜率-V2        回归/残差/总方差/均值 全部 w²（官网弹窗实测口径）
     wslope_v2_intraday 加权斜率(分时版)-V2
     rsrs              RSRS 动量          high~low 回归 β×R²，再用历史 2N 期 Z-Score
   权重 w = 1 → 2 线性递增；年化 = exp(slope × 250) - 1；得分一律截断到 4 位小数 */
window.MOM = (function () {
  var METHODS = [
    { k: 'simple', n: '区间涨幅', src: 'close', desc: '只用首尾两个收盘价，最快最粗' },
    { k: 'simple_intraday', n: '区间涨幅(分时版)', src: 'intraday', desc: '首尾两点取 14:30 分时价' },
    { k: 'slope', n: '斜率', src: 'close', desc: 'ln 价等权回归，年化 × R²，兼顾方向与稳定' },
    { k: 'slope_intraday', n: '斜率(分时版)', src: 'intraday', desc: '同斜率，价格取 14:30 分时序列' },
    { k: 'wslope', n: '加权斜率', src: 'close', desc: 'V1：回归 w、总方差用未加权均值，R² 可能为负' },
    { k: 'wslope_intraday', n: '加权斜率(分时版)', src: 'intraday', desc: 'V1 的分时价版本' },
    { k: 'wslope_v2', n: '加权斜率-V2', src: 'close', desc: 'V2：回归/残差/总方差/均值统一 w²（推荐）' },
    { k: 'wslope_v2_intraday', n: '加权斜率(分时版)-V2', src: 'intraday', desc: 'V2 的分时价版本' },
    { k: 'rsrs', n: 'RSRS动量', src: 'ohlc', desc: '最高价对最低价回归 β×R²，再对历史 2N 期做 Z-Score' }
  ];

  function trunc4(x) { return Math.trunc(x * 10000) / 10000; }

  function ols(y, scheme) {
    var n = y.length, i;
    var w = [], E = [];
    for (i = 0; i < n; i++) {
      w.push(1 + i / (n - 1));
      E.push(scheme === 'ols' ? 1 : (scheme === 'v2' ? w[i] * w[i] : w[i]));
    }
    var sw = 0, sy = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
    for (i = 0; i < n; i++) {
      var e = E[i];
      sw += e; sy += e * y[i]; swx += e * i; swy += e * y[i];
      swxx += e * i * i; swxy += e * i * y[i];
    }
    var den = sw * swxx - swx * swx;
    if (!(den > 0)) return null;
    var slope = (sw * swxy - swx * swy) / den;
    var intercept = (swy - slope * swx) / sw;
    return { slope: slope, intercept: intercept, sw: sw, sy: sy, E: E, w: w };
  }

  function r2Of(y, fit, E, meanWeighted) {
    var i, sr = 0, st = 0;
    var ybar = meanWeighted ? fit.sy / fit.sw : y.reduce(function (a, b) { return a + b; }, 0) / y.length;
    for (i = 0; i < y.length; i++) {
      sr += E[i] * Math.pow(y[i] - (fit.slope * i + fit.intercept), 2);
      st += E[i] * Math.pow(y[i] - ybar, 2);
    }
    return st > 0 ? 1 - sr / st : 0;
  }

  function slopeFamily(prices, n, scheme) {
    if (!prices || prices.length < n || n < 2) return null;
    var p = prices.slice(-n), y = [], i;
    for (i = 0; i < n; i++) { if (!(p[i] > 0)) return null; y.push(Math.log(p[i])); }
    var fit = ols(y, scheme);
    if (!fit) return null;
    var r2 = r2Of(y, fit, fit.E, scheme === 'v2');
    var annual = Math.exp(fit.slope * 250) - 1;
    return { score: trunc4(annual * r2), annual: annual, r2: r2, slope: fit.slope, intercept: fit.intercept };
  }

  /* RSRS：窗口 N 内 高价 = a + b × 低价，β 做质量过滤后取 β×R²；
     再对最近 2N 个 RSRS 值做 Z-Score。参数默认 N=18、β∈[0,2]、R²≥0.8 */
  function rsrs(highs, lows, n, betaLo, betaHi, r2Thr) {
    n = n || 18; betaLo = betaLo == null ? 0 : betaLo; betaHi = betaHi == null ? 2 : betaHi;
    r2Thr = r2Thr == null ? 0.8 : r2Thr;
    if (!highs || !lows || highs.length < n * 3 || lows.length !== highs.length) return null;
    var vals = [], i, j;
    for (i = n - 1; i < highs.length; i++) {
      var ml = 0, mh = 0;
      for (j = i - n + 1; j <= i; j++) { ml += lows[j]; mh += highs[j]; }
      ml /= n; mh /= n;
      var cov = 0, varl = 0;
      for (j = i - n + 1; j <= i; j++) { cov += (lows[j] - ml) * (highs[j] - mh); varl += Math.pow(lows[j] - ml, 2); }
      cov /= n; varl /= n;
      var beta = varl > 0 ? cov / varl : NaN;
      var sr = 0, st = 0;
      for (j = i - n + 1; j <= i; j++) { sr += Math.pow(highs[j] - (mh + beta * (lows[j] - ml)), 2); st += Math.pow(highs[j] - mh, 2); }
      var r2 = st > 0 ? 1 - sr / st : 0;
      vals.push((beta >= betaLo && beta <= betaHi && r2 >= r2Thr) ? beta * r2 : NaN);
    }
    var cur = vals[vals.length - 1];
    if (!isFinite(cur)) return { score: 0, z: 0, rsrs: 0, beta: null };
    var hist = vals.slice(-(n * 2 + 1), -1).filter(function (x) { return isFinite(x); });
    if (hist.length < 3) return null;
    var mean = hist.reduce(function (a, b) { return a + b; }, 0) / hist.length;
    var sd = Math.sqrt(hist.reduce(function (a, b) { return a + Math.pow(b - mean, 2); }, 0) / hist.length);
    var z = sd > 0 ? (cur - mean) / sd : 0;
    return { score: trunc4(z), z: z, rsrs: cur, beta: null, histN: hist.length };
  }

  function calc(method, data, opt) {
    opt = opt || {};
    var n = opt.n || 25;
    var m = method;
    if (m === 'rsrs') return rsrs(data.highs, data.lows, opt.rsrsN || 18, opt.betaLo, opt.betaHi, opt.r2Thr);
    var intraday = /_intraday$/.test(m);
    var prices = intraday ? data.intraday : data.close;
    if (m === 'simple' || m === 'simple_intraday') {
      if (!prices || prices.length < n + 1) return null;
      var base = prices[prices.length - 1 - n], last = prices[prices.length - 1];
      if (!(base > 0)) return null;
      return { score: trunc4(last / base - 1), annual: last / base - 1, r2: null, slope: null };
    }
    var core = m.replace('_intraday', '');
    if (core === 'slope') return slopeFamily(prices, n, 'ols');
    if (core === 'wslope') return slopeFamily(prices, n, 'v1');
    if (core === 'wslope_v2') return slopeFamily(prices, n, 'v2');
    return null;
  }

  return { METHODS: METHODS, calc: calc, trunc4: trunc4 };
})();
