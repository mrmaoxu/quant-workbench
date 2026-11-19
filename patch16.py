#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch16：修正 liveSync 时序竞态
现象：在线同步后「期末持仓」的现金变成净值全额（258,305），因为同步回调早于行情索引就绪，
buildSnapAccount 里 priceAt 返回 0，现金没扣持仓市值。
修法：同步完成后先 injectSnap() 再 runAll()（重建索引与账户），最后 renderAll；触发延迟 300→900ms。
"""
P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

a1 = """      try { injectSnap(); } catch (e) {}
      renderAll();
      toast('已同步平台官方当日数据');"""
n1 = """      try { injectSnap(); } catch (e) {}
      try { runAll(); } catch (e) {}
      renderAll();
      toast('已同步平台官方当日数据');"""
assert txt.count(a1) == 1, '同步块锚点不唯一'
txt = txt.replace(a1, n1, 1)

a2 = "setTimeout(function () { try { liveSync(); } catch (e) {} }, 300);"
n2 = "setTimeout(function () { try { liveSync(); } catch (e) {} }, 900);"
assert txt.count(a2) == 1
txt = txt.replace(a2, n2, 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('OK %.1f KB' % (len(out.encode('utf-8')) / 1024))
