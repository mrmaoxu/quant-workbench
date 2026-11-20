# -*- coding: utf-8 -*-
"""patch32：买地球本地复算区补官方实盘持仓对照，消除"持有德国"误解"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

old = """      (id === 'momentum' ? ' · GS/乖离剔除后递补 · 股数以目标组合为准' : '') + '</div></div>';
  }"""
new = """      (id === 'momentum' ? ' · GS/乖离剔除后递补 · 股数以目标组合为准' : '') + '</div>' +
      (id === 'earth' ? earthOffNote() : '') + '</div>';
  }

  /* 买地球：本地模拟账本 vs 官方实盘持仓对照（官方 ID 22753） */
  function earthOffNote() {
    var h = (window.SNAP && SNAP.s && SNAP.s.p22753) ? SNAP.s.p22753.holds : null;
    if (!h || !h.length) return '';
    var t = h.map(function (x) {
      var d = String(x.date || '');
      return cname(x.code) + ' ' + x.qty + ' 股 @' + x.px +
        (d.length === 8 ? '（' + d.slice(4, 6) + '-' + d.slice(6) + ' 换入）' : '');
    }).join('、');
    return '<div style="opacity:.82;margin-top:3px;color:var(--sub)">官方实盘当前持 <b>' + esc(t) +
      '</b>｜本地模拟账本与官方独立（池/参数/执行时点不同），差异仅供逻辑验证，<b>以官方为准</b></div>';
  }"""
assert old in u
u = u.replace(old, new, 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=33', '?v=34')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch32 OK')
