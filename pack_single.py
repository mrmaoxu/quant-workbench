#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 workbench-v2 内联成单个 HTML（无外链，可直接丢 CDN / 手机浏览器打开）

按 index.html 里实际出现的 <script src="assets/*.js"> 动态内联，
新增数据文件（如 official_sync.js）无需再改本脚本。
"""
import base64
import os
import re

SRC = os.path.dirname(os.path.abspath(__file__))
html = open(os.path.join(SRC, 'index.html'), encoding='utf-8').read()
css = open(os.path.join(SRC, 'assets', 'app.css'), encoding='utf-8').read()
html = re.sub(r'<link rel="stylesheet" href="assets/app\.css[^"]*">',
              lambda m: '<style>\n' + css + '\n</style>', html)
html = html.replace('<link rel="manifest" href="manifest.webmanifest">', '')
svg = open(os.path.join(SRC, 'assets', 'icon.svg'), encoding='utf-8').read()
html = html.replace('<link rel="icon" href="assets/icon.svg" type="image/svg+xml">',
                    '<link rel="icon" href="data:image/svg+xml;base64,' +
                    base64.b64encode(svg.encode()).decode() + '">')

names = re.findall(r'<script src="assets/([\w\-]+)\.js[^"]*"></script>', html)
for name in names:
    path = os.path.join(SRC, 'assets', name + '.js')
    js = open(path, encoding='utf-8').read()
    if '</script' in js:
        print('[warn] %s.js 含 </script，已转义' % name)
    js = js.replace('</script', '<\\/script')
    html = re.sub(r'<script src="assets/' + re.escape(name) + r'\.js[^"]*"></script>',
                  lambda m, js=js: '<script>\n' + js + '\n</script>', html, count=1)

html = re.sub(r"<script>\s*/\* 注册离线壳.*?</script>", '', html, flags=re.S)
assert '<script src="assets/' not in html and 'href="assets/' not in html, '仍有外链引用未内联'
out = os.path.join(SRC, '量化工作台_单文件.html')
open(out, 'w', encoding='utf-8').write(html)
print('OK %.1f KB -> %s（内联: %s）' % (len(html.encode('utf-8')) / 1024, out, ','.join(names)))
