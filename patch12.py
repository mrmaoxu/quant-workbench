#!/usr/bin/env python3
# -*- coding: utf-8 -*-
P = 'assets/ui.js'
s = open(P, encoding='utf-8').read()
a = "<h2>今日信号 · ' + esc(s.name) + '</h2>"
assert s.count(a) == 1, s.count(a)
s = s.replace(a, "<h2>今日信号</h2>", 1)
b = "(id === 'momentum' ? ' · GS/乖离剔除后递补' : '')"
assert s.count(b) == 1
s = s.replace(b, "(id === 'momentum' ? ' · GS/乖离剔除后递补 · 股数以目标组合为准' : '')", 1)
open(P, 'w', encoding='utf-8').write(s)
print('OK %.1f KB' % (len(s.encode('utf-8')) / 1024))
