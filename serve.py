# -*- coding: utf-8 -*-
"""量化工作台本地服务：静态文件 + 官方接口代理（绕过 CORS）

用法: python serve.py [port]    默认 8765
  GET  /                    -> workbench-v2/index.html
  GET  /assets/...          -> 静态资源
  GET  /api/off/<id>        -> 转发 /api/etf/strategy/<id>/info
  POST /api/momentum        -> 转发 /api/etf/realtime-momentum（9 种动量算法）
  GET  /api/fund-search?kw= -> 转发 /api/stock/fund-search
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
OFFICIAL = 'https://www.cifangquant.com/api/etf/strategy/%s/info'
MOMENTUM = 'https://www.cifangquant.com/api/etf/realtime-momentum'
FUNDSEARCH = 'https://www.cifangquant.com/api/stock/fund-search?key_word=%s'
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
        m = re.match(r'^/api/fund-search\?kw=(.+)$', self.path)
        if m:
            self._get(FUNDSEARCH % urllib.parse.quote(urllib.parse.unquote(m.group(1))))
            return
        m = re.match(r'^/api/ktail\?codes=([0-9,]+)$', self.path)
        if m:
            self._ktail(m.group(1).split(','))
            return
        path_only = self.path.split('?')[0]
        if path_only == '/':
            self.path = '/index.html'
        return super().do_GET()

    def _ktail(self, codes):
        """用平台动量接口的 calculation_series 取日线尾部（收盘 + 高低价），不受行情站限流影响"""
        import datetime
        today = datetime.date.today().strftime('%Y-%m-%d')
        out = {}
        try:
            for typ, want_hl in (('simple_close', False), ('rsrs', True)):
                body = json.dumps({
                    'momentum_calculation_type': typ, 'momentum_period': 60,
                    'etf_pool': codes, 'end_date': today, 'end_time': '15:00:00'}).encode('utf-8')
                req = urllib.request.Request(
                    MOMENTUM, data=body, method='POST',
                    headers={'User-Agent': UA, 'Content-Type': 'application/json',
                             'Accept': 'application/json',
                             'Origin': 'https://www.cifangquant.com',
                             'Referer': 'https://www.cifangquant.com/tool/momentum'})
                with urllib.request.urlopen(req, timeout=40) as resp:
                    j = json.loads(resp.read().decode('utf-8'))
                for x in (j.get('data') or {}).get('etf_momentum_data', []):
                    c = str(x.get('etf_code'))
                    s = x.get('calculation_series') or {}
                    hist = s.get('history') or []
                    tgt = s.get('target') or {}
                    e = out.setdefault(c, {'d': [], 'c': [], 'hl': {}})
                    if not want_hl:
                        e['d'] = [h['date'] for h in hist]
                        e['c'] = [h['price'] for h in hist]
                        if tgt.get('date') and tgt.get('price'):
                            e['d'].append(tgt['date']); e['c'].append(tgt['price'])
                    else:
                        for h in hist:
                            if h.get('high') is not None and h.get('low') is not None:
                                e['hl'][h['date']] = [h['high'], h['low']]
                        if tgt.get('date') and tgt.get('high') is not None:
                            e['hl'][tgt['date']] = [tgt['high'], tgt['low']]
            self._send(200, json.dumps({'code': 0, 'data': out}).encode('utf-8'))
        except Exception as exc:
            self._send(502, json.dumps({'error': str(exc)}).encode('utf-8'))

    def do_POST(self):
        if self.path.split('?')[0] == '/api/momentum':
            try:
                n = int(self.headers.get('Content-Length') or 0)
                body = self.rfile.read(n)
                req = urllib.request.Request(
                    MOMENTUM, data=body, method='POST',
                    headers={'User-Agent': UA, 'Content-Type': 'application/json',
                             'Accept': 'application/json',
                             'Origin': 'https://www.cifangquant.com',
                             'Referer': 'https://www.cifangquant.com/tool/momentum'})
                with urllib.request.urlopen(req, timeout=40) as resp:
                    data = resp.read()
                self._send(200, data)
            except Exception as exc:
                self._send(502, json.dumps({'error': str(exc)}).encode('utf-8'))
            return
        self.send_error(404)

    def _send(self, code, body):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _get(self, url):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=20) as resp:
                self._send(200, resp.read())
        except Exception as exc:
            self._send(502, json.dumps({'error': str(exc)}).encode('utf-8'))

    def _proxy(self, sid):
        try:
            req = urllib.request.Request(
                OFFICIAL % sid,
                headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=25) as resp:
                body = resp.read()
            self._send(200, body)
        except Exception as exc:
            self._send(502, json.dumps({'error': str(exc)}).encode('utf-8'))

    def log_message(self, fmt, *args):
        pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    try:
        srv = ThreadingHTTPServer(('0.0.0.0', port), Handler)
    except OSError:
        sys.exit(0)          # 端口已被占用：已在后台运行，静默退出
    if sys.stdout:
        print('Quant Workbench -> http://127.0.0.1:%d/' % port)
    srv.serve_forever()
