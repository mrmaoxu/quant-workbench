#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch15：运行时官方同步
打开即从 /api/etf/strategy/{id}/info 拉真值（该接口 CORS 放开 *），
覆盖 nav/holds/metrics 后重建账户并重渲染；失败静默回落到本地快照。
作用：解决"跑着跑着又和官网不一样"——每次打开/刷新都以平台当日结算为准。
"""
P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

FUNC = '''  /* 运行时同步平台官方真值（CORS 已放开）。失败静默回落本地快照 */
  function liveSync() {
    var ids = ['13429', '96242'], jobs = [], MP = {
      total_return: 'total', annualized_return: 'annual', volatility: 'vol',
      sharpe_ratio: 'sharpe', calmar_ratio: 'calmar', max_drawdown: 'mdd',
      win_rate: 'win', total_trades: 'trades'
    };
    ids.forEach(function (id) {
      jobs.push(fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info', { cache: 'no-store' })
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var d = j.data || {};
          var s = (typeof SNAP !== 'undefined' && SNAP.s) ? SNAP.s['p' + id] : null;
          if (!s) return false;
          var navs = [], i, x;
          for (i = 0; i < (d.daily_pnl || []).length; i++) {
            x = d.daily_pnl[i];
            if (x && x.portfolio_value != null) {
              navs.push([String(x.date).replace(/-/g, ''), Math.round(+x.portfolio_value * 100) / 100]);
            }
          }
          if (navs.length) s.nav = navs;
          if (d.holding_etfs) {
            s.holds = d.holding_etfs.map(function (h) {
              return { code: String(h.code), qty: h.amount, px: h.buy_price,
                       date: String(h.buy_date || '').replace(/-/g, '') };
            });
          }
          var pm = d.performance_metrics || {}, m = {}, k, v;
          for (k in MP) {
            if (pm[k] == null) continue;
            v = parseFloat(String(pm[k]).replace(/[%,]/g, ''));
            if (!isNaN(v)) m[MP[k]] = (k === 'max_drawdown' ? Math.abs(v) : v);
          }
          if (m.trades != null) m.trades = Math.round(m.trades);
          if (Object.keys(m).length) s.metrics = m;
          s.sync = '在线 ' + new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\\//g, '-');
          return true;
        })
        .catch(function () { return false; }));
    });
    return Promise.all(jobs).then(function (res) {
      var any = false;
      res.forEach(function (x) { if (x) any = true; });
      if (!any) { toast('官方接口暂不可达，继续用本地快照'); return; }
      try { injectSnap(); } catch (e) {}
      renderAll();
      toast('已同步平台官方当日数据');
    });
  }

'''

anchor = '  function renderAll() {'
assert txt.count(anchor) == 1
txt = txt.replace(anchor, FUNC + anchor, 1)

# boot 之后触发一次在线同步
a2 = """    if (h) window.__QW_H = h;
    boot();"""
n2 = """    if (h) window.__QW_H = h;
    boot();
    setTimeout(function () { try { liveSync(); } catch (e) {} }, 300);"""
assert txt.count(a2) == 1
txt = txt.replace(a2, n2, 1)

# 刷新按钮：先刷行情，再同步官方
a3 = """    $('btnRefresh').addEventListener('click', function () { boot(true); });"""
n3 = """    $('btnRefresh').addEventListener('click', function () { boot(true); try { liveSync(); } catch (e) {} });"""
assert txt.count(a3) == 1
txt = txt.replace(a3, n3, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK %.1f KB' % (len(out.encode('utf-8')) / 1024))
