#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch17：持仓现金计算不再依赖行情索引
buildSnapAccount 里 priceAt 拿不到价时，回落到内置日线 CL 的最后一个有效价，
避免"现金 = 净值全额"；同时把 liveSync 内部顺序改为 runAll(建索引) → injectSnap(建账户) → renderAll。
"""
P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

a1 = """    if (idx) {
      for (k in pos) {
        var px = QE.priceAt(idx, k, endD);
        if (px > 0) cash -= pos[k].sh * px;
      }
    }"""
n1 = """    for (k in pos) {
      var px = idx ? QE.priceAt(idx, k, endD) : 0;
      if (!(px > 0) && typeof CL !== 'undefined' && CL.d && CL.d[k] && CL.d[k].length) {
        var arr = CL.d[k], q;
        for (q = arr.length - 1; q >= 0; q--) { if (arr[q] > 0) { px = +arr[q]; break; } }
      }
      if (px > 0) cash -= pos[k].sh * px;
    }"""
assert txt.count(a1) == 1, '现金扣减锚点不唯一'
txt = txt.replace(a1, n1, 1)

a2 = """      try { injectSnap(); } catch (e) {}
      try { runAll(); } catch (e) {}
      renderAll();"""
n2 = """      try { runAll(); } catch (e) {}
      try { injectSnap(); } catch (e) {}
      renderAll();"""
assert txt.count(a2) == 1
txt = txt.replace(a2, n2, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK %.1f KB' % (len(out.encode('utf-8')) / 1024))
