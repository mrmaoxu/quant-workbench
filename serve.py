# -*- coding: utf-8 -*-
"""量化工作台本地服务：静态文件 + 官方接口代理（绕过 CORS）

用法: python serve.py [port]    默认 8765
  GET /                  -> workbench-v2/index.html
  GET /assets/...        -> 静态资源
  GET /api/off/<id>      -> 转发 https://www.cifangquant.com/api/etf/strategy/<id>/info
"""
import json
import os
import re
import sys
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
OFFICIAL = 'https://www.cifangquant.com/api/etf/strategy/%s/info'
UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_GET(self):
        m = re.match(r'^/api/off/(\d+)$', self.path)
        if m:
            self._proxy(m.group(1))
            return
        path_only = self.path.split('?')[0]
        if path_only == '/':
            self.path = '/index.html'
        return super().do_GET()

    def _proxy(self, sid):
        try:
            req = urllib.request.Request(
                OFFICIAL % sid,
                headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=25) as resp:
                body = resp.read()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as exc:
            payload = json.dumps({'error': str(exc)}).encode('utf-8')
            self.send_response(502)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print('Quant Workbench -> http://127.0.0.1:%d/' % port)
    ThreadingHTTPServer(('0.0.0.0', port), Handler).serve_forever()
