# -*- coding: utf-8 -*-
"""patch27：盘中值一律以官方接口为准，禁止本地估算覆盖官方净值"""
import io, re

U = 'assets/ui.js'
u = io.open(U, encoding='utf-8').read()

# 1) 整段替换 intradaySync（旧逻辑会用本地现金估算并覆盖官方当日净值）
start = u.index('  function intradaySync() {')
end = u.index('  /* 运行时同步平台官方真值', start)
old_block = u[start:end]
new_block = '''  function intradaySync() {
    if (typeof SNAP === 'undefined' || !SNAP.s) return;
    if (!isTradingNow()) return;
    var today = new Date();
    var tk = '' + today.getFullYear() + ('0' + (today.getMonth() + 1)).slice(-2) + ('0' + today.getDate()).slice(-2);
    var missing = false;
    SNAP_ORDER.forEach(function (k) {
      var d = SNAP.s[k];
      if (d && d.holds && d.holds.length && d.nav && d.nav.length &&
          String(d.nav[d.nav.length - 1][0]) !== tk) missing = true;
    });
    /* 官方接口尚未给出今日净值时，拉一次官方（绝不本地估算硬凑） */
    if (missing) { try { liveSync(true); } catch (e) {} }
  }

'''
assert old_block, 'intradaySync block not found'
u = u.replace(old_block, new_block, 1)

# 2) liveSync 支持静默
u = u.replace('  function liveSync() {', '  function liveSync(silent) {', 1)
u = u.replace("      if (!any) { toast('官方接口暂不可达，继续用本地快照'); return; }",
              "      if (!any) { if (!silent) toast('官方接口暂不可达，继续用本地快照'); return; }", 1)
u = u.replace("      toast('已同步平台官方当日数据');", "      if (!silent) toast('已同步平台官方当日数据');", 1)

# 3) 同步完成后不再触发本地估算覆盖
u = u.replace("""      setTimeout(function () { try { intradaySync(); } catch (e) {} }, 400);\n""", "", 1)

# 4) 官方当日点标记：用官方时标明“官方实时”，非估算
u = u.replace("          s.sync = '在线 ' + new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\\//g, '-');",
              "          s.sync = '在线 ' + new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\\//g, '-');\n          s.intraday = false;", 1)

# 5) 卡片脚注文案
u = u.replace("(snap && snap.intraday ? ' · 盘中估算' : '');", "(snap && snap.intraday ? ' · 官方实时' : '');", 1)

# 6) 30s 定时同时拉官方
u = u.replace("    setInterval(function () { try { intradaySync(); } catch (e) {} }, 30000);",
              "    setInterval(function () { try { liveSync(true); } catch (e) {} try { intradaySync(); } catch (e) {} }, 30000);", 1)

io.open(U, 'w', encoding='utf-8', newline='\n').write(u)

H = 'index.html'
h = io.open(H, encoding='utf-8').read().replace('?v=27', '?v=28')
io.open(H, 'w', encoding='utf-8', newline='\n').write(h)
print('patch27 OK')
