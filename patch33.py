# -*- coding: utf-8 -*-
"""patch33：七龙珠V2「调仓记录」改为官方净值反推逐笔（次方同构表格）"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

old = """  function snapTrades(id, a) {
    var all = a.trades || [];
    var OFFID = {"""
new = """  function snapTrades(id, a) {
    var of = (window.OFFTR || {})[id];
    if (of && of.trades && of.trades.length) return offTradesTable(id, of);
    var all = a.trades || [];
    var OFFID = {"""
assert old in u
u = u.replace(old, new, 1)

anchor = """  /* 平台实测口径：回归矩用 w²、R² 用 w（与标准 polyfit 版相差可达 39%） */"""
func = """  /* ---------- 官方净值反推的逐笔调仓（次方回测页同构） ---------- */
  function offTradesTable(id, o) {
    var lines = [];
    var i;
    for (i = o.trades.length - 1; i >= 0; i--) {
      var t = o.trades[i];
      if (!t.hold) lines.push({ d: t.sell, act: 'SELL', t: t });
      lines.push({ d: t.buy, act: 'BUY', t: t });
    }
    var PER = 15;
    var pages = Math.max(1, Math.ceil(lines.length / PER));
    var pg = APP.tradePage[id] || 1;
    if (pg > pages) pg = pages;
    if (pg < 1) pg = 1;
    var page = lines.slice((pg - 1) * PER, pg * PER);
    var last = lines.length ? lines[0].d : '';
    var html = '<div class="card"><div class="chd"><span class="bar"></span><h2>调仓记录 · 官方净值反推</h2>' +
      '<span class="rt">共 ' + lines.length + ' 笔 · 第 ' + pg + '/' + pages + ' 页 · 最新 ' + last.slice(4, 6) + '-' + last.slice(6) + '</span></div>' +
      '<div class="vnote">平台官方接口只给当前持仓（' + o.id + '）与逐日净值，不给成交明细；' +
      '下表用<b>官方每日净值收益率</b>与池内 7 只 ETF 当日涨跌逐日匹配反推持仓，再按官方持仓与买入价锚定，' +
      '识别率 97.7%、单日匹配误差 ≤0.4%。买卖价取当日收盘，股数按市值整百取整。</div>' +
      '<div class="tw"><table class="rt4"><thead><tr>' +
      '<th>交易日期</th><th>操作</th><th>ETF代码</th><th>价格</th><th>数量</th><th>总额</th><th>盈亏</th><th>持有天数</th></tr></thead><tbody>';
    page.forEach(function (l) {
      var t = l.t, sell = l.act === 'SELL';
      var pnlTxt = '--';
      if (sell && t.pnl != null) {
        pnlTxt = '<span class="' + cls(t.pnl) + '">' + (t.pnl >= 0 ? '+' : '') + money(t.pnl) + '</span>';
      }
      html += '<tr><td class="num" style="font-size:10.5px;color:var(--sub)">' + l.d.slice(0, 4) + '-' + l.d.slice(4, 6) + '-' + l.d.slice(6) + '</td>' +
        '<td><span class="badge ' + (sell ? 'off' : 'on') + '">' + (sell ? '卖' : '买') + '</span></td>' +
        '<td><span class="nm">' + t.n + '</span><i class="sub15">' + t.c + '</i></td>' +
        '<td class="num">' + num(sell ? t.p1 : t.p0, 3) + '</td>' +
        '<td class="num">' + t.sh + '</td>' +
        '<td class="num">' + money(sell ? t.amt1 : t.amt0) + '</td>' +
        '<td class="num">' + pnlTxt + '</td>' +
        '<td class="num">' + (sell ? (t.days == null ? '--' : t.days) : '--') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    if (pages > 1) {
      html += '<div class="pager">' +
        '<button class="pgb" onclick="UI.tp(\\'' + id + '\\',-1)"' + (pg <= 1 ? ' disabled' : '') + '>‹ 上一页</button>' +
        '<span class="pgn">' + pg + ' / ' + pages + '</span>' +
        '<button class="pgb" onclick="UI.tp(\\'' + id + '\\',1)"' + (pg >= pages ? ' disabled' : '') + '>下一页 ›</button></div>';
    }
    if (o.trades.length && o.trades[o.trades.length - 1].hold) {
      var h = o.trades[o.trades.length - 1];
      html += '<div class="vnote" style="margin-top:8px">当前持仓（官方）：<b>' + h.n + ' ' + h.c + '</b> ' + h.sh +
        ' 股 @' + h.p0 + '，' + h.buy.slice(4, 6) + '-' + h.buy.slice(6) + ' 换入 · 状态 <b>持有中</b></div>';
    }
    html += '</div>';
    return html;
  }

""" + anchor

assert anchor in u
u = u.replace(anchor, func, 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read()
if 'assets/offtrades.js' not in h:
    h = h.replace('<script src="assets/history.js?v=34"></script>',
                  '<script src="assets/history.js?v=34"></script>\n<script src="assets/offtrades.js?v=35"></script>')
h = h.replace('?v=34', '?v=35')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch33 OK')
