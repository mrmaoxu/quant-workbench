#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch19b：视觉补丁（CSS 部分）"""
P3 = 'assets/app.css'
raw3 = open(P3, 'rb').read()
crlf3 = b'\r\n' in raw3[:4000]
t3 = raw3.decode('utf-8').replace('\r\n', '\n')
MARK = '/* ==== 官方数据强调 + 详情页吸顶（patch19） ==== */'
if MARK in t3:
    print('SKIP 已存在')
    raise SystemExit(0)
t3 += MARK + """
.sc{background:linear-gradient(180deg,rgba(255,255,255,.045),rgba(255,255,255,.012)),var(--card);box-shadow:0 1px 0 rgba(255,255,255,.03) inset,0 6px 18px rgba(0,0,0,.18)}
.sc:hover{border-color:#2b3b55}
.sy{margin-top:7px;font-size:10px;color:#6b7a90;letter-spacing:.2px;font-style:normal}
.dhead{position:sticky;top:0;z-index:15;background:rgba(8,11,17,.92);backdrop-filter:blur(12px);padding-bottom:8px;margin-bottom:2px}
[data-theme="light"] .dhead{background:rgba(247,249,252,.94)}
[data-theme="light"] .sc{background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(255,255,255,.6));box-shadow:0 4px 14px rgba(20,40,70,.06)}
[data-theme="light"] .sy{color:#8a97a8}
"""
open(P3, 'wb').write((t3.replace('\n', '\r\n') if crlf3 else t3).encode('utf-8'))
print('OK css')
