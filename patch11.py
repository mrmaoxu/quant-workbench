#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch11：详情页信息架构整理
1) 新增 secBar 段落分隔条（01 今日 / 02 资产 / 03 依据）
2) 换仓判定从排名卡抽出，提到「今日」段，一进页面就知道要不要动
3) 账户 9 格 → 4 主格 + 一行次要指标（数字全保留）
"""
import re

P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

# ---------- 1. 移除 rankCard 里的 4 处 holdVerdict 调用 ----------
n_rm = len(re.findall(r'\n\s*html \+= holdVerdict\([^\n]*\);', txt))
assert n_rm == 4, '预期 4 处，实际 %d' % n_rm
txt = re.sub(r'\n\s*html \+= holdVerdict\([^\n]*\);', '', txt)

# ---------- 2. 插入 secBar ----------
SEC = '''  function secBar(no, t, hint) {
    return '<div style="display:flex;align-items:center;gap:8px;margin:20px 2px 1px">' +
      '<i style="font-style:normal;font-size:10px;letter-spacing:1.5px;color:var(--dim)">' + no + '</i>' +
      '<b style="font-size:12.5px;letter-spacing:.5px">' + t + '</b>' +
      '<span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(255,255,255,.16),transparent)"></span>' +
      '<span style="font-size:10.5px;color:var(--dim)">' + hint + '</span></div>';
  }

'''
assert txt.count('  function mi(k, v, c) {') == 1
txt = txt.replace('  function mi(k, v, c) {', SEC + '  function mi(k, v, c) {', 1)

# ---------- 3. 快照分支重排 ----------
old = """    if (s.snapshot) {
      html += snapHead(id, s, a, m);
      html += snapStats(id, s, a, m);
      html += snapPos(id, s, a);
      html += perfCard(id, a);
      html += rankCard(id, p, a);
      html += snapTrades(id, a);"""
new = """    if (s.snapshot) {
      var rk0 = (p && p.ranks && p.ranks.length) ? p.ranks : rankAt(id, s, a);
      html += secBar('01', '今日', '该做什么 · 持仓要不要动');
      html += snapHead(id, s, a, m);
      html += holdVerdict(id, s, rk0, a);
      html += secBar('02', '资产', '净值 · 持仓 · 日/月/年收益');
      html += snapStats(id, s, a, m);
      html += snapPos(id, s, a);
      html += perfCard(id, a);
      html += secBar('03', '依据', '排名 · 调仓 · 规则');
      html += rankCard(id, p, a);
      html += snapTrades(id, a);"""
assert txt.count(old) == 1
txt = txt.replace(old, new, 1)

# ---------- 4. 核心三：段落条 + 今日段落地 holdVerdict ----------
o1 = """    html += '<div class="' + sigCls + '"><div class="chd"><span class="bar"></span><h2>今日信号 · '"""
n1 = """    html += secBar('01', '今日', '该做什么 · 持仓要不要动');
    html += '<div class="' + sigCls + '"><div class="chd"><span class="bar"></span><h2>今日信号 · '"""
assert txt.count(o1) == 1
txt = txt.replace(o1, n1, 1)

o2 = """    /* 指标 */
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
      '</div></div>';"""
n2 = """    /* 今日段收口：按本策略规则判定持/换仓 */
    html += holdVerdict(id, s, (p && p.ranks && p.ranks.length) ? p.ranks : rankAt(id, s, a), a);

    /* 账户（4 主格 + 次要一行，数字一个不少） */
    html += secBar('02', '资产', '账户 · 持仓 · 日/月/年收益');
    html += '<div class="card tight"><div class="chd"><span class="bar"></span><h2>账户</h2>' +
      '<span class="rt">起始 ' + a.start + ' · 自动记账</span></div>' +
      '<div class="mgrid">' +
      mi('总资产', money(lv.cur), '') +
      mi('累计收益', m ? spct(m.total) : '--', m ? cls(m.total) : '') +
      mi(lv.refLabel + '盈亏', (lv.dayPnl >= 0 ? '+' : '') + money(lv.dayPnl), cls(lv.dayPnl)) +
      mi('组合今涨', lv.combPct != null ? spct(lv.combPct) : '空仓', cls(lv.combPct)) +
      '</div>' +
      '<div style="display:flex;flex-wrap:wrap;gap:5px 16px;margin-top:9px;font-size:11px;color:var(--sub)">' +
      '<span>年化 <b class="num ' + (m ? cls(m.annual) : '') + '">' + (m ? spct(m.annual, 1) : '--') + '</b></span>' +
      '<span>最大回撤 <b class="num dn">' + (m ? pct(m.mdd) : '--') + '</b></span>' +
      '<span>夏普 <b class="num">' + (m ? m.sharpe.toFixed(2) : '--') + '</b></span>' +
      '<span>持仓市值 <b class="num">' + money(lv.mv) + '</b></span>' +
      '<span>可用现金 <b class="num">' + money(lv.cash) + '</b></span>' +
      '</div></div>';"""
assert txt.count(o2) == 1
txt = txt.replace(o2, n2, 1)

o3 = """    /* 波动目标 / 溢价预警（动量轮动专属） */"""
n3 = """    html += secBar('03', '依据', '排名 · 调仓 · 风控 · 规则');
    /* 波动目标 / 溢价预警（动量轮动专属） */"""
assert txt.count(o3) == 1
txt = txt.replace(o3, n3, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK 移除%d处判定 + 4 段位插入, %.1f KB' % (n_rm, len(out.encode('utf-8')) / 1024))
