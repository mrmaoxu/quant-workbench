#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch13：按平台口径修正动量与过滤器（补规则，不凑数字）

1) 新增 wslopePlat：平台实测口径（回归矩用 w²，R² 用 w）。实测同数据下 513030 得分
   0.095（标准V2）→ 0.058（平台），相差 39%，足以翻转临界排名。
2) 平台 5 策略的排名统一走 wslopePlat；earth（双动量 V2）同步。
3) 补齐平台 condition_filter_config：
   - ma_golden_cross(fast/slow)：MA_fast 必须 > MA_slow 才合格
   - close_above_ma(period)：收盘必须站上 MA_period
   - premium_limit(max)：离线拿不到实时 IOPV → 判为「溢价未知」且不合格（保守）。
     这正是七龙珠今天误判"买入德国"的原因：平台因溢价剔除，我算不出来就放行。
4) 补齐 extreme_filter（涨跌停剔除）：|当日涨跌| ≥ 9.8% 剔除。
5) 状态列与换仓判定显示真实剔除原因。
"""
import re

P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

FUNC = '''  /* 平台实测口径：回归矩用 w²、R² 用 w（与标准 polyfit 版相差可达 39%） */
  function wslopePlat(ser, n) {
    if (!ser || ser.length < n || n < 2) return null;
    var p = ser.slice(-n), y = [], w = [], i;
    for (i = 0; i < n; i++) { if (!(p[i] > 0)) return null; y.push(Math.log(p[i])); w.push(1 + i / (n - 1)); }
    var sw = 0, sy = 0, sw2 = 0, sxw = 0, syw = 0, sxxw = 0, sxyw = 0;
    for (i = 0; i < n; i++) {
      var w2 = w[i] * w[i];
      sw += w[i]; sy += w[i] * y[i];
      sw2 += w2; sxw += w2 * i; syw += w2 * y[i];
      sxxw += w2 * i * i; sxyw += w2 * i * y[i];
    }
    var den = sw2 * sxxw - sxw * sxw;
    if (!(den > 0)) return null;
    var slope = (sw2 * sxyw - sxw * syw) / den, b = (syw - slope * sxw) / sw2;
    var annual = Math.exp(slope * 250) - 1;
    if (!isFinite(annual)) return null;
    var ybar = sy / sw, sr = 0, st = 0;
    for (i = 0; i < n; i++) {
      sr += w[i] * Math.pow(y[i] - (slope * i + b), 2);
      st += w[i] * Math.pow(y[i] - ybar, 2);
    }
    var r2 = st > 0 ? 1 - sr / st : 0;
    return { score: annual * r2, annual: annual, r2: r2 };
  }

'''
assert txt.count('  function maAvg(ser, n) {') == 1
txt = txt.replace('  function maAvg(ser, n) {', FUNC + '  function maAvg(ser, n) {', 1)

# ---- 2/3/4：快照分支改用平台口径 + 过滤器 ----
old = """        } else {
          var win = mom.m1 || 25, o = QE.wslopeFull(ser, win);
          r.win = win;
          r.score = o ? o.score : null;
          r.annual = o ? o.annual : null;
        }
        var lo = (mom.m1lo != null ? mom.m1lo : -1e9);
        var hi = (mom.m1hi != null ? mom.m1hi : 1e9);
        r.pass = (r.score != null && r.score >= lo && r.score <= hi);"""
new = """        } else {
          var win = mom.m1 || 25, o = wslopePlat(ser, win);
          r.win = win;
          r.score = o ? o.score : null;
          r.annual = o ? o.annual : null;
        }
        var lo = (mom.m1lo != null ? mom.m1lo : -1e9);
        var hi = (mom.m1hi != null ? mom.m1hi : 1e9);
        r.pass = (r.score != null && r.score >= lo && r.score <= hi);
        r.filters = [];
        var cfgS = d.cfg || {};
        if ((cfgS.filters || []).length) {
          cfgS.filters.forEach(function (f) {
            if (f.type === 'ma_golden_cross') {
              var fN = f.fast_period || 10, sN = f.slow_period || 20;
              var mf = maAvg(ser, fN), ms = maAvg(ser, sN);
              if (mf == null || ms == null) { r.pass = false; r.filters.push('均线数据不足'); }
              else if (!(mf > ms)) { r.pass = false; r.filters.push('MA' + fN + '未上穿MA' + sN); }
            } else if (f.type === 'close_above_ma') {
              var nN = f.period || 10, mn = maAvg(ser, nN);
              if (mn == null || !(px > mn)) { r.pass = false; r.filters.push('未站上MA' + nN); }
            } else if (f.type === 'premium_limit') {
              r.pass = false; r.filters.push('溢价未知(上限' + (f.max_premium || 20) + '%)');
            }
          });
        }
        if ((cfgS.limit || []).length && Math.abs(chg) >= 0.098) {
          r.pass = false; r.filters.push('涨跌停剔除');
        }"""
assert txt.count(old) == 1
txt = txt.replace(old, new, 1)

# ---- 5：状态列显示真实剔除原因 ----
o2 = """          : '<span class="badge off">' + (isPct ? '区间外' : '阈值外') + '</span>');"""
n2 = """          : '<span class="badge off">' + esc((r.filters && r.filters.length) ? r.filters[0]
            : (r.score == null ? '数据不足' : (isPct ? '区间外' : '阈值外'))) + '</span>');"""
assert txt.count(o2) == 1
txt = txt.replace(o2, n2, 1)

# ---- 6：earth 也用平台口径（双动量 V2 同源） ----
o3 = """        var o1 = QE.wslopeFull(ser, 20), o2 = QE.wslopeFull(ser, 26);"""
n3 = """        var o1 = wslopePlat(ser, 20), o2 = wslopePlat(ser, 26);"""
assert txt.count(o3) == 1
txt = txt.replace(o3, n3, 1)

# ---- 7：换仓判定补「主要剔除原因」 ----
o4 = """    return '<div style="margin-top:8px;padding:8px 10px;border-left:3px solid ' +"""
n4 = """    var whyList = [];
    ranks.forEach(function (r) {
      if (!r.pass && r.filters && r.filters.length && whyList.length < 3) {
        whyList.push(esc(cname(r.code)) + '：' + esc(r.filters[0]));
      }
    });
    if (whyList.length) txt += '<div style="opacity:.72;margin-top:3px">主要剔除原因：' + whyList.join('；') + '</div>';
    return '<div style="margin-top:8px;padding:8px 10px;border-left:3px solid ' +"""
assert txt.count(o4) == 1
txt = txt.replace(o4, n4, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK %.1f KB' % (len(out.encode('utf-8')) / 1024))
