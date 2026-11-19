# -*- coding: utf-8 -*-
"""patch22：买地球本地引擎按官方22753参数（单动量20日）+ 详情页本地区块标注"""
import io

U = 'assets/ui.js'
E = 'assets/engine.js'
C = 'assets/app.css'
u = io.open(U, encoding='utf-8').read()
e = io.open(E, encoding='utf-8').read()
c = io.open(C, encoding='utf-8').read()


def rep(f, old, new):
    global u, e
    assert old in f, 'NOT FOUND: ' + old[:80]
    return f.replace(old, new, 1)

# 1) 引擎：买地球参数对齐官方 22753（20日单动量 0~3，无M2过滤，无涨跌停剔除）
e = rep(e, """      cfg: {
        n1: 20, n2: 26, lo1: 0, hi1: 3, lo2: 0, hi2: 10,
        topK: 1, minHold: 2, reserve: 0.02, limit: 0.098,
        commission: 0.0001, slip: 0.001, minLot: 100
      }""",
"""      cfg: {
        /* 官方 /22753 参数：weighted_slope 20 日单动量，合格区间 0~3，
           无 M2 过滤、无涨跌停剔除、满仓无预留、滑点 0.1%、佣金万1 */
        n1: 20, n2: 20, lo1: 0, hi1: 3, lo2: -999, hi2: 999,
        topK: 1, minHold: 2, reserve: 0, limit: 1,
        commission: 0.0001, slip: 0.001, minLot: 100,
        ddStop: 0.04, stopLoss: 0.06, freeze: 0
      }""")

# 2) 详情页：本地信号区标注口径
u = rep(u, """    html += secBar('01', '今日', '该做什么 · 持仓要不要动');""",
"""    html += secBar('01', id === 'earth' && typeof SNAP !== 'undefined' && SNAP.s && SNAP.s.p22753
      ? '本地复算' : '今日',
      id === 'earth' ? '收盘价口径独立复算 · 与官方信号对照' : '该做什么 · 持仓要不要动');""")

c += """
/* 买地球本地区块提示条 */
.lnote{font-size:11px;color:var(--warn);background:rgba(255,169,77,.08);border:1px solid rgba(255,169,77,.22);
border-radius:9px;padding:8px 10px;line-height:1.6;margin:8px 0 0}
[data-theme="light"] .lnote{background:#fff8ec;border-color:#f0d9b0;color:#a86a12}
"""
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)
io.open(E, 'w', encoding='utf-8', newline='\n').write(e)
io.open(C, 'w', encoding='utf-8', newline='\n').write(c)
print('patch22 OK ui=%d engine=%d' % (len(u.encode('utf-8')), len(e.encode('utf-8'))))
