#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch19：视觉与信息提升
1) index.html 的 official_sync.js 版本号升到 v=2（浏览器不再吃旧缓存）
2) 首页官方卡片：加「今日涨跌」和「官方同步时间」徽标
3) CSS：卡片渐变描边、同步徽标、详情页头部吸顶、指标卡更紧凑
"""
import io, re

# ---------- 1. index.html ----------
P1 = 'index.html'
t1 = io.open(P1, encoding='utf-8').read()
t1 = t1.replace('official_sync.js?v=1', 'official_sync.js?v=2')
io.open(P1, 'w', encoding='utf-8').write(t1)

# ---------- 2. ui.js 卡片 ----------
P2 = 'assets/ui.js'
raw = open(P2, 'rb').read()
crlf = b'\r\n' in raw[:4000]
t2 = raw.decode('utf-8').replace('\r\n', '\n')

a = """        if (s.snapshot) {
          var lastV = navs.length ? navs[navs.length - 1] : 0;"""
n = """        if (s.snapshot) {
          var lastV = navs.length ? navs[navs.length - 1] : 0;
          var dPnl = navs.length > 1 ? lastV - navs[navs.length - 2] : 0;
          var dPct = (navs.length > 1 && navs[navs.length - 2]) ? dPnl / navs[navs.length - 2] : 0;
          var syTxt = (SNAP.s[r.id] && SNAP.s[r.id].sync) ? String(SNAP.s[r.id].sync) : '';
          var syringe = a.lastDate ? ('官方 · ' + syTxt) : syTxt;"""
assert t2.count(a) == 1
t2 = t2.replace(a, n, 1)

a = """            '<div class="v num">' + money(lastV) + '<small>元</small></div>' +
            '<div class="r2"><span>累计 <b class="num ' + cls(m.total) + '">' + (m.total != null ? spct(m.total) : '--') + '</b></span>' +
            '<span>年化 <b class="num ' + cls(m.annual) + '">' + (m.annual != null ? spct(m.annual, 1) : '--') + '</b></span>' +
            '<span>回撤 <b class="num dn">' + (m.mdd != null ? pct(m.mdd, 1) : '--') + '</b></span></div>' +
            '<div class="hint">' + esc(s.sub || '') + (a.lastDate ? '<em>截至 ' + a.lastDate.slice(5) + '</em>' : '') + '</div>' +"""
n = """            '<div class="v num">' + money(lastV) + '<small>元</small></div>' +
            '<div class="r2"><span>今日 <b class="num ' + cls(dPnl) + '">' + (dPnl >= 0 ? '+' : '') + money(dPnl) + ' <i class="pp ' + cls(dPct) + '">' + spct(dPct) + '</i></b></span>' +
            '<span>累计 <b class="num ' + cls(m.total) + '">' + (m.total != null ? spct(m.total) : '--') + '</b></span>' +
            '<span>年化 <b class="num ' + cls(m.annual) + '">' + (m.annual != null ? spct(m.annual, 1) : '--') + '</b></span></div>' +
            '<div class="hint">' + esc(s.sub || '') + (a.lastDate ? '<em>截至 ' + a.lastDate.slice(5) + '</em>' : '') + '</div>' +
            (syringe ? '<div class="sy">' + esc(syringe) + '</div>' : '') +"""
assert t2.count(a) == 1
t2 = t2.replace(a, n, 1)

out = t2.replace('\n', '\r\n') if crlf else t2
open(P2, 'wb').write(out.encode('utf-8'))

# ---------- 3. CSS ----------
P3 = 'assets/app.css'
raw3 = open(P3, 'rb').read()
crlf3 = b'\r\n' in raw3[:4000]
t3 = raw3.decode('utf-8').replace('\r\n', '\n')
ADD = """
/* ==== 官方数据强调 + 详情页吸顶（patch19） ==== */
.sc{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012)),var(--card);box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 6px 18px rgba(0,0,0,.18)}
.sc:hover{border-color:#2b3b55}
.sy{margin-top:7px;font-size:10px;color:var(--dim,#6b7a90);letter-spacing:.2px;font-style:normal}
.tk-gold{background:rgba(212,168,86,.14);color:#e7c478;border:1px solid rgba(212,168,86,.35)}
.dhead{position:sticky;top:0;z-index:15;background:rgba(8,11,17,.92);backdrop-filter:blur(12px);padding-bottom:8px;margin-bottom:2px}
[data-theme="light"] .dhead{background:rgba(247,249,252,.94)}
[data-theme="light"] .sc{background:linear-gradient(180deg,rgba(255,255,255,.9),rgba(255,255,255,.55));box-shadow:0 4px 14px rgba(20,40,70,.06)}
"""
assert '.tk-gold' not in t3, '已打过此补丁'
t3 = t3 + ADD
out3 = t3.replace('\n', '\r\n') if crlf3 else t3
open(P3, 'wb').write(out3.encode('utf-8'))
print('OK')
