# -*- coding: utf-8 -*-
"""patch29：官方 id 与本地快照键建立映射（96070->p96560 等），修复实时同步写错键"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

old_head = "    var ids = ['13429', '96242', '26867', '96070', '95204', '22753'], jobs = [], MP = {"
new_head = """    var IDS = [
      ['13429', 'p13429'], ['96242', 'p96242'], ['26867', 'p96563'],
      ['96070', 'p96560'], ['95204', 'p96561'], ['22753', 'p22753']
    ], jobs = [], MP = {"""
assert old_head in u
u = u.replace(old_head, new_head, 1)

old_for = "    ids.forEach(function (id) {"
new_for = """    IDS.forEach(function (pair) {
      var id = pair[0], key = pair[1];"""
assert old_for in u
u = u.replace(old_for, new_for, 1)

old_get = "          var s = (typeof SNAP !== 'undefined' && SNAP.s) ? SNAP.s['p' + id] : null;"
new_get = "          var s = (typeof SNAP !== 'undefined' && SNAP.s) ? SNAP.s[key] : null;"
assert old_get in u
u = u.replace(old_get, new_get, 1)

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=29', '?v=30')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch29 OK')
