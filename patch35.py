# -*- coding: utf-8 -*-
"""patch35b：池子排名加「兜底」标识（不动原表达式，插入覆盖语句）"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

anchor = "      var mv = (r.score == null) ? '--' : (isPct ? spct(r.score) : num(r.score, 3));"
assert anchor in u, 'mv anchor not found'

ins = ("      if (d.cfg && d.cfg.fallback && String(d.cfg.fallback) === String(r.code) && !r.held) {\n"
       "        badge = '<span class=\"badge cand\">兜底</span>';\n"
       "      }\n") + anchor
u = u.replace(anchor, ins, 1)

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=36', '?v=37')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch35b OK')
