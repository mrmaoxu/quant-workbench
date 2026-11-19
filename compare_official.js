// 官方对拍：拉 /api/etf/strategy/{id}/info 与本地 snapdata 逐项比对
const fs = require('fs');
global.window = {};
require('./assets/snapdata.js');
const SNAP = window.SNAP.s;
const IDS = ['13429', '96242', '96561', '96563', '96560'];

const f2 = (x, n = 2) => (x == null || Number.isNaN(+x) ? '--' : (+x).toFixed(n));

(async () => {
  for (const id of IDS) {
    let off;
    try {
      const r = await fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info');
      off = (await r.json()).data || {};
    } catch (e) {
      console.log(id, 'FETCH ERR', e.message);
      continue;
    }
    const s = SNAP['p' + id] || {};
    const myNav = (s.nav || []).slice(-3).map(v => (Array.isArray(v) ? v : [v.d, v.v]));
    const offDaily = (off.daily_pnl || []).slice(-3).map(x => [String(x.date || '').replace(/-/g, ''), x.portfolio_value]);
    const myHolds = (s.holds || []).map(h => h.code + '@' + (h.date || '') + ' x' + (h.qty || ''));
    const offHolds = (off.holding_etfs || []).map(h => h.code + '@' + (String(h.buy_date || '').replace(/-/g, '')) + ' x' + h.amount + ' 成本' + h.buy_price);
    const m = s.metrics || {};
    const p = off.performance_metrics || {};

    console.log('\n=== ' + id + ' ' + (off.strategy_name || s.name));
    console.log('  官方净值尾:', JSON.stringify(offDaily));
    console.log('  本地净值尾:', JSON.stringify(myNav));
    console.log('  官方持仓:', offHolds.length ? offHolds.join(' | ') : '空仓');
    console.log('  本地持仓:', myHolds.length ? myHolds.join(' | ') : '空仓');
    console.log('  官方绩效: 总' + p.total_return + ' 年化' + p.annualized_return + ' 回撤' + p.max_drawdown + ' 胜率' + p.win_rate + ' 笔数' + p.total_trades);
    console.log('  本地绩效: 总' + (m.total_return != null ? f2(m.total_return) + '%' : '--') +
      ' 年化' + (m.annual != null ? f2(m.annual) + '%' : '--') +
      ' 回撤' + (m.mdd != null ? f2(m.mdd) + '%' : '--') +
      ' 胜率' + (m.win != null ? f2(m.win) + '%' : '--') +
      ' 笔数' + (s.trades ? s.trades.length : '无'));
    console.log('  官方年收益:', (off.yearly_stats || []).length + ' 年 | 本地年收益:', (s.yearly || []).length + ' 年');
    console.log('  官方日序列:', (off.daily_pnl || []).length, '条 | 本地 nav:', (s.nav || []).length, '条');
  }
})();
