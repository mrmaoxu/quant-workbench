# -*- coding: utf-8 -*-
"""patch28：官方数据经本地代理 /api/off/{id} 拉取（绕过 CORS）"""
import io

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

old = """      jobs.push(fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info', { cache: 'no-store' })
        .then(function (r) { return r.json(); })"""
new = """      var direct = function () {
        return fetch('https://www.cifangquant.com/api/etf/strategy/' + id + '/info', { cache: 'no-store' });
      };
      var viaProxy = function () {
        if (location.protocol !== 'http:' && location.protocol !== 'https:') return Promise.reject(new Error('no proxy'));
        return fetch('/api/off/' + id, { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('proxy ' + r.status);
          return r;
        });
      };
      jobs.push(viaProxy().catch(direct)
        .then(function (r) { return r.json(); })"""

assert old in u, 'liveSync fetch block not found'
u = u.replace(old, new, 1)
io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

h = io.open('index.html', encoding='utf-8').read().replace('?v=28', '?v=29')
io.open('index.html', 'w', encoding='utf-8', newline='\n').write(h)
print('patch28 OK')
