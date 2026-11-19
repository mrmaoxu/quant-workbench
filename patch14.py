#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch14：官方数据接入层
1) index.html 在 snapdata.js 之后引入 official_sync.js（官方真值覆盖）
2) holdVerdict：官方已结算当日 → 以官方持仓为准，收盘价复算目标仅作参考
   （平台按 14:50/10:30 执行时点价排名，收盘价在临界名次会翻转）
"""
import re

# ---- 1. index.html ----
p = 'index.html'
h = open(p, encoding='utf-8').read()
if 'official_sync.js' not in h:
    m = re.search(r'<script src="assets/snapdata\.js[^"]*"></script>', h)
    assert m, 'snapdata 引入未找到'
    h = h[:m.end()] + '\n<script src="assets/official_sync.js?v=1"></script>' + h[m.end():]
    open(p, 'w', encoding='utf-8', newline='').write(h)
    print('[1] index.html 已引入 official_sync.js')
else:
    print('[1] 已存在，跳过')

# ---- 2. ui.js holdVerdict ----
P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

anchor = "    var same = (cur.length === tgt.length) && cur.every(function (x) { return tgt.indexOf(x) >= 0; });"
assert txt.count(anchor) == 1, '锚点不唯一'

BLOCK = """    /* 官方已同步到该结算日 → 以官方持仓为准；收盘价复算仅作参考 */
    var lastD = String((a && a.lastDate) || '').replace(/-/g, '');
    if (d.sync && d.nav && d.nav.length && String(d.nav[d.nav.length - 1][0]) === lastD) {
      var oh = (d.holds && d.holds.length) ? d.holds[0] : null;
      var tgtName = tgt.length ? nm(tgt) : '空仓';
      var sameAsOff = (oh && tgt.length === 1 && String(oh.code) === String(tgt[0])) || (!oh && !tgt.length);
      var head = oh
        ? ('平台官方已执行：<b>' + esc(cname(String(oh.code))) + ' ' + oh.qty + ' 股 @' + oh.px +
           '</b>（' + dsh(String(oh.date)) + ' ' + (cfg.exec || '14:50') + ' 换入）')
        : ('平台官方已执行：<b>结算空仓</b>（' + dsh(lastD) + '）');
      var tail = sameAsOff
        ? '<div style="opacity:.72;margin-top:3px">按收盘价复算的目标同为 ' + tgtName + ' → <b>一致</b></div>'
        : ('<div style="opacity:.72;margin-top:3px">按收盘价复算的目标为 ' + tgtName +
           '，与官方不同：平台按<b>执行时点价</b>排名，收盘价在临界名次会翻转 → <b>以官方为准</b></div>');
      return '<div style="margin-top:8px;padding:8px 10px;border-left:3px solid var(--acc,#5b8cff);' +
        'background:rgba(255,255,255,.035);border-radius:0 8px 8px 0;font-size:11.5px;line-height:1.7">' +
        '<span class="badge on" style="margin-right:6px">官方口径</span>' + head + tail +
        '<div style="opacity:.62;margin-top:3px">同步时间 ' + esc(d.sync) +
        ' · 净值/绩效/持仓取自平台接口，未经本地重算</div></div>';
    }
"""

txt = txt.replace(anchor, BLOCK + anchor, 1)
out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('[2] ui.js %.1f KB' % (len(out.encode('utf-8')) / 1024))
