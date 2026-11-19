#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch19c：sub 文案缩短 + 长串换行保护"""
import io
p = 'sync_official2.py'
t = io.open(p, encoding='utf-8').read()
old = "'sub': '平台官方 · 净值/绩效/持仓取自 /api/etf/strategy/%s/info' % sid,"
new = "'sub': '平台官方接口 · 净值/绩效/持仓直取（/%s）' % sid,"
if old in t:
    t = t.replace(old, new)
    io.open(p, 'w', encoding='utf-8').write(t)
    print('sub patched')
else:
    print('sub anchor missing')

pc = 'assets/app.css'
raw = open(pc, 'rb').read()
crlf = b'\r\n' in raw[:4000]
c = raw.decode('utf-8').replace('\r\n', '\n')
MARK = '/* patch19c */'
if MARK not in c:
    c += '\n' + MARK + """
.sc .hint,.sy,.sc .sh .nm{overflow-wrap:anywhere;word-break:break-word}
.sc .sh .st{flex:0 0 auto}
"""
    open(pc, 'wb').write((c.replace('\n', '\r\n') if crlf else c).encode('utf-8'))
    print('css patched')
