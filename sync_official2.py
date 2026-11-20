#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""拉 5 条平台官方策略 /api/etf/strategy/{id}/info，生成 assets/official_sync.js
覆盖：nav / holds / metrics / official / start / sync，同时把官方 strategy_setting 的参数
写回 mom / cfg / pool / init —— 参数对了，本地排名与换仓信号才和平台一致。
"""
import json, urllib.request, datetime, io

MAP = {
    'p13429': '13429',   # 纯粹
    'p96242': '96242',   # ETF动量轮动
    'p96563': '26867',   # 七龙珠v2
    'p96560': '96070',   # 银行等股灾
    'p96561': '95204',   # 大类资产对冲组合轮动-V2
    'p22753': '22753',   # momo要买地球2点30版本（买地球官方对照）
}
NOW = datetime.datetime.now().strftime('%Y-%m-%d %H:%M')


def num(s):
    if s is None:
        return None
    try:
        return float(str(s).replace('%', '').replace(',', ''))
    except Exception:
        return None


def build(sid):
    url = 'https://www.cifangquant.com/api/etf/strategy/%s/info' % sid
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    d = json.loads(urllib.request.urlopen(req, timeout=40).read().decode('utf-8'))['data']
    nav = [[str(x['date']).replace('-', ''), round(float(x['portfolio_value']), 2)]
           for x in (d.get('daily_pnl') or []) if x.get('portfolio_value') is not None]
    holds = [{'code': str(h['code']), 'qty': h['amount'], 'px': h['buy_price'],
              'date': str(h.get('buy_date') or '').replace('-', '')}
             for h in (d.get('holding_etfs') or [])]
    pm = d.get('performance_metrics') or {}
    m = {}
    for k, out in [('total_return', 'total'), ('annualized_return', 'annual'),
                   ('volatility', 'vol'), ('sharpe_ratio', 'sharpe'),
                   ('calmar_ratio', 'calmar'), ('max_drawdown', 'mdd'),
                   ('win_rate', 'win'), ('total_trades', 'trades')]:
        v = num(pm.get(k))
        if v is not None:
            m[out] = abs(v) if out == 'mdd' else (round(v) if out == 'trades' else v)
    st = d.get('strategy_setting') or {}
    pool = list(st.get('etf_pool') or [])
    fb = str(st.get('fallback_etf') or '0')
    if fb and fb != '0' and fb not in pool:
        pool.append(fb)          # 兜底标的也入排名表，页面标注「兜底」
    o = {
        'official': True, 'nav': nav, 'holds': holds, 'metrics': m,
        'start': nav[0][0] if nav else None, 'sync': NOW,
        'name': d.get('strategy_name'),
        'sub': '平台官方接口 · 净值/绩效/持仓直取（/%s）' % sid,
        'note': '收益、净值、持仓、绩效取自平台官方接口，未经本地重算；排名与换仓信号按官方参数本地复算。',
        'pool': pool,
        'init': st.get('initial_capital'),
        'mom': {'type': 'wslope', 'm1': st.get('momentum_period'),
                'm2': None, 'm1lo': st.get('momentum_threshold'),
                'm1hi': st.get('momentum_upper_threshold'),
                'm2lo': 0, 'm2hi': 3},
        'cfg': {'minHold': st.get('min_hold_days'), 'topN': st.get('top_n'),
                'exec': st.get('execute_time') or '14:50:00',
                'comm': st.get('commission') or 0, 'slip': st.get('slippage') or 0,
                'reserve': 0.02,
                'fallback': str(st.get('fallback_etf') or '0'),
                'limit': st.get('extreme_filter_conditions') or [],
                'ddStop': st.get('drawdown_stop_threshold'),
                'ddFreeze': st.get('stop_loss_freeze_days'),
                'tpOn': bool(st.get('take_profit_enabled')),
                'tpThr': st.get('take_profit_threshold'),
                'filters': st.get('condition_filter_config') or [],
                'calDays': st.get('days_count_type') == 'calendar_days'},
    }
    return o


def main():
    out = {}
    for key, sid in MAP.items():
        try:
            out[key] = build(sid)
            print('%s <- %s  nav=%d holds=%d total=%s' % (key, sid, len(out[key]['nav']),
                  len(out[key]['holds']), out[key]['metrics'].get('total')))
        except Exception as e:
            print('%s <- %s FAIL %s' % (key, sid, e))
    js = '/* 官方同步（%s）：/api/etf/strategy/{id}/info 真值 + 官方参数，不做本地重算 */\n' % NOW
    js += '(function(){var S=window.SNAP&&window.SNAP.s;if(!S)return;var D='
    js += json.dumps(out, ensure_ascii=False, separators=(',', ':'))
    js += ';for(var k in D){var t=S[k];if(!t){t=S[k]={name:D[k].name};}var s=D[k];'
    js += 'if(s.nav&&s.nav.length)t.nav=s.nav;if(s.holds)t.holds=s.holds;if(s.metrics)t.metrics=s.metrics;'
    js += 'if(s.pool&&s.pool.length)t.pool=s.pool;if(s.mom)t.mom=s.mom;if(s.cfg)t.cfg=s.cfg;'
    js += 'if(s.init)t.init=s.init;if(s.start)t.start=s.start;'
    js += 't.official=true;t.engine=false;t.sync=s.sync;'
    js += 'if(s.sub)t.sub=s.sub;if(s.note)t.note=s.note;}})();\n'
    io.open('assets/official_sync.js', 'w', encoding='utf-8').write(js)
    print('WROTE assets/official_sync.js %.1f KB @ %s' % (len(js.encode('utf-8')) / 1024, NOW))


if __name__ == '__main__':
    main()
