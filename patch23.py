# -*- coding: utf-8 -*-
"""patch23：状态版本升级（旧账本作废重算）+ 买地球本地区块标题 + 卡片间距"""
import io

U = 'assets/ui.js'
C = 'assets/app.css'
u = io.open(U, encoding='utf-8').read()
c = io.open(C, encoding='utf-8').read()


def rep(old, new):
    global u
    assert old in u, 'NOT FOUND: ' + old[:70]
    u = u.replace(old, new, 1)

rep("var SKEY = 'qw_state_v4';", "var SKEY = 'qw_state_v5';")

# 第二处（非快照分支）的今日区块标题
rep("""    html += secBar('01', '今日', '该做什么 · 持仓要不要动');""",
"""    html += secBar('01', id === 'earth' && typeof SNAP !== 'undefined' && SNAP.s && SNAP.s.p22753
      ? '本地复算' : '今日',
      id === 'earth' ? '收盘价口径独立复算 · 与官方信号对照' : '该做什么 · 持仓要不要动');""")

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

c = c.replace(".s2f{display:grid;grid-template-columns:minmax(0,1fr) 92px;align-items:end;column-gap:8px}",
              ".s2f{display:grid;grid-template-columns:minmax(0,1fr) 88px;align-items:end;column-gap:12px}")
c = c.replace(".s2f .spk{width:92px;height:28px}", ".s2f .spk{width:88px;height:28px}")
io.open(C, 'w', encoding='utf-8', newline='\n').write(c)
print('patch23 OK')
