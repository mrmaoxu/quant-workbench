# -*- coding: utf-8 -*-
"""patch31：调仓记录明确标注为回测副本流水，与官方实例区分"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

old = """  function snapTrades(id, a) {
    var all = a.trades || [];
    if (!all.length) {
      return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
        '<span class="rt">平台未开放</span></div><div class="vnote">该策略在平台侧只开放净值与日盈亏接口，' +
        '没有逐笔交割单。净值、日/月/年收益、持仓与排名均为官方真值，不做估算补齐。</div></div>';
    }"""

new = """  function snapTrades(id, a) {
    var all = a.trades || [];
    var OFFID = { p13429: '13429', p96242: '96242', p96563: '26867',
                  p96560: '96070', p96561: '95204', p22753: '22753' }[id] || '';
    if (!all.length) {
      return '<div class="card tight"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
        '<span class="rt">平台未开放</span></div><div class="vnote">平台官方接口（ID ' + OFFID + '）只开放净值、' +
        '日盈亏与当前持仓，没有逐笔交割单。净值、日/月/年收益、持仓与排名均为官方真值，不做估算补齐。</div></div>';
    }"""
assert old in u
u = u.replace(old, new, 1)

old2 = """    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>调仓记录</h2>' +
      '<span class="rt">共 ' + all.length + ' 笔 · 第 ' + pg + '/' + pages + ' 页</span></div>' +
      '<div class="tw"><table class="rt4"><thead><tr>' +"""
new2 = """    var lastD = (all[all.length - 1] || {}).d || '';
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>调仓记录 · 回测副本</h2>' +
      '<span class="rt">共 ' + all.length + ' 笔 · 第 ' + pg + '/' + pages + ' 页 · 截止 ' + lastD.slice(2) + '</span></div>' +
      '<div class="vnote">以下是 <b>本地回测副本 ' + id.slice(1) + '</b> 的逐笔流水；平台运行实例（官方 ID ' + OFFID + '）的成交明细未开放。' +
      '两者不是同一账户，持仓与调仓日可能不同——真实持仓以顶部「官方口径」为准。</div>' +
      '<div class="tw"><table class="rt4"><thead><tr>' +"""
assert old2 in u
u = u.replace(old2, new2, 1)

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=32', '?v=33')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch31 OK')
