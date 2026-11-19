# -*- coding: utf-8 -*-
"""patch26：买地球卡片脚注精简（避免与迷你曲线重叠）"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()
old = """      foot = '官方 14:30 信号 · ' + cname(h0.code) + ' ' + (h0.qty || '') + '股' + (h0.date ? ' · ' + dsh(h0.date).slice(5) : '');"""
new = """      foot = '官方信号 · ' + cname(h0.code) + ' ' + (h0.qty || '') + '股';"""
assert old in u
u = u.replace(old, new, 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)
h = io.open('index.html', encoding='utf-8').read().replace('?v=26', '?v=27')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch26 OK')
