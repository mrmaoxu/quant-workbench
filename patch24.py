# -*- coding: utf-8 -*-
"""patch24：日历今日补点不再依赖交易日历（周末除外）"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()
old = """  function livePoint(a, id) {
    var today = todayStr();
    if (!isTradingDay(today)) return null;
    if (a.navD && a.navD.length && a.navD[a.navD.length - 1] === today) return null;"""
new = """  function livePoint(a, id) {
    var today = todayStr();
    var wd = new Date().getDay();
    if (wd === 0 || wd === 6) return null;
    if (a.navD && a.navD.length && a.navD[a.navD.length - 1] === today) return null;"""
assert old in u
u = u.replace(old, new, 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)
print('patch24 OK')
