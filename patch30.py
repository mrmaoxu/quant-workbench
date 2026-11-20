# -*- coding: utf-8 -*-
"""patch30：修正 patch29 的误替换——renderHome 循环还原，liveSync 用 IDS 映射"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

# 1) 还原 renderHome（1012 附近）被误改的循环
bad_render = """    IDS.forEach(function (pair) {
      var id = pair[0], key = pair[1];
      rows.push({ id: id, lv: liveValue(id), s: QE.STRATS[id], m: metrics[id] });
    });"""
good_render = """    ids.forEach(function (id) {
      rows.push({ id: id, lv: liveValue(id), s: QE.STRATS[id], m: metrics[id] });
    });"""
assert bad_render in u, 'renderHome block not found'
u = u.replace(bad_render, good_render, 1)

# 2) 修正 liveSync 内的遍历（其下一行是 var direct）
bad_sync = """    ids.forEach(function (id) {
      var direct = function () {
        return fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info', { cache: 'no-store' });
      };"""
good_sync = """    IDS.forEach(function (pair) {
      var id = pair[0], key = pair[1];
      var direct = function () {
        return fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info', { cache: 'no-store' });
      };"""
assert bad_sync in u, 'liveSync loop not found'
u = u.replace(bad_sync, good_sync, 1)

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=30', '?v=31')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch30 OK')
