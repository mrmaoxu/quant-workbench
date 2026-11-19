#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""官方同步：从 /api/etf/strategy/{id}/info 拉取真值，覆盖本地快照的
净值序列(nav) / 持仓(holds) / 绩效(metrics)，输出 assets/official_sync.js。

设计原则：
- 只搬官方字段，不在本地重算任何数字（绩效直接用 performance_metrics）
- 可重复运行；每次运行都会把净值推进到平台最新结算日
- 覆盖在 snapdata 之后生效，不改原始快照（保留可追溯）
"""
import json
import re
import time
import urllib.request

IDS = ['13429', '96242']
BASE = 'https://www.cifangquant.com/api/etf/strategy/%s/info'

MAP = {
    'total_return': 'total', 'annualized_return': 'annual', 'volatility': 'vol',
    'sharpe_ratio': 'sharpe', 'calmar_ratio': 'calmar', 'max_drawdown': 'mdd',
    'win_rate': 'win', 'total_trades': 'trades',
}


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip().replace('%', '').replace(',', '')
    try:
        return float(t)
    except ValueError:
        return None


def fetch(sid):
    req = urllib.request.Request(BASE % sid, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))['data']


def main():
    out = {}
    rows = []
    for sid in IDS:
        d = fetch(sid)
        navs = [[str(x['date']).replace('-', ''), round(float(x['portfolio_value']), 2)]
                for x in (d.get('daily_pnl') or []) if x.get('portfolio_value') is not None]
        holds = []
        for h in (d.get('holding_etfs') or []):
            holds.append({'code': str(h['code']), 'qty': h.get('amount'),
                          'px': h.get('buy_price'),
                          'date': str(h.get('buy_date') or '').replace('-', '')})
        m = {}
        p = d.get('performance_metrics') or {}
        for k, v in MAP.items():
            if k in p and num(p[k]) is not None:
                m[v] = num(p[k])
        if m.get('mdd') is not None:
            m['mdd'] = abs(m['mdd'])
        out['p' + sid] = {'nav': navs, 'holds': holds, 'metrics': m,
                          'sync': time.strftime('%Y-%m-%d %H:%M')}
        rows.append((sid, d.get('strategy_name'), len(navs), navs[-1] if navs else None, holds))

    js = ('/* 官方同步（%s）：/api/etf/strategy/{id}/info 真值，'
          '覆盖 nav/holds/metrics，不做本地重算 */\n'
          '(function(){var S=window.SNAP&&window.SNAP.s;if(!S)return;var D=%s;\n'
          'for(var k in D){var t=S[k];if(!t)continue;var s=D[k];'
          'if(s.nav&&s.nav.length)t.nav=s.nav;if(s.holds)t.holds=s.holds;'
          'if(s.metrics)t.metrics=s.metrics;t.sync=s.sync;}})();\n'
          % (time.strftime('%Y-%m-%d %H:%M'), json.dumps(out, ensure_ascii=False, separators=(',', ':'))))
    open('assets/official_sync.js', 'w', encoding='utf-8').write(js)
    print('assets/official_sync.js %.1f KB' % (len(js.encode('utf-8')) / 1024))
    for sid, name, n, last, holds in rows:
        print('  %s %-28s %d 条  尾=%s  持=%s' % (sid, name, n, last, holds))


if __name__ == '__main__':
    main()
