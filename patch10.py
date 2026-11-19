#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""patch10：给每个策略的排名卡补「换仓判定」条 —— 按该策略自身参数算目标持仓，与当前持仓比对。
patch11：earth 的过滤原因细分 M20 越界 / M26 越界。
"""
import io
import re

P = 'assets/ui.js'
raw = open(P, 'rb').read()
crlf = b'\r\n' in raw[:4000]
txt = raw.decode('utf-8').replace('\r\n', '\n')

FUNC = '''  /* ---------- 按本策略自身规则判定：该持谁 / 该不该换 ---------- */
  function holdVerdict(id, s, ranks, a) {
    var d = (typeof SNAP !== 'undefined' && SNAP.s) ? (SNAP.s[id] || {}) : {};
    var cfg = d.cfg || (s && s.cfg) || {};
    var mom = d.mom || {};
    var topN = (id === 'momentum') ? ((cfg.topK) || 3) : (cfg.topN || 1);
    var fb = cfg.fallback, tgt = [], cur = [], c;
    ranks.forEach(function (r) {
      if (id === 'momentum') { if (r.signal === 'hold') tgt.push(r.code); }
      else if (r.pass && r.rank <= topN) tgt.push(r.code);
    });
    for (c in a.pos) if (a.pos[c] && a.pos[c].sh > 0) cur.push(c);
    var nm = function (arr) {
      return arr.length ? arr.map(function (x) { return esc(cname(x)) }).join(' · ') : '空仓';
    };
    var same = (cur.length === tgt.length) && cur.every(function (x) { return tgt.indexOf(x) >= 0; });
    var cls_, txt;
    if (!tgt.length) {
      var fbs = (fb == null ? '' : String(fb));
      if (!fbs || fbs === '0') { cls_ = 'off'; txt = '无合格候选，规则要求<b>空仓持现金</b>'; }
      else { cls_ = 'cand'; txt = '无合格候选，规则要求<b>兜底 ' + esc(cname(fbs)) + ' ' + fbs + '</b>'; }
      if (cur.length) txt += '；当前持 ' + nm(cur) + ' → <b>需清出</b>';
    } else if (same) {
      cls_ = 'on'; txt = '目标 ' + nm(tgt) + '；与当前持仓一致 → <b>维持不动</b>';
    } else {
      cls_ = 'off';
      var sell = cur.filter(function (x) { return tgt.indexOf(x) < 0; });
      var buy = tgt.filter(function (x) { return cur.indexOf(x) < 0; });
      txt = '目标 ' + nm(tgt) + '；当前 ' + nm(cur);
      var acts = [];
      if (sell.length) acts.push('卖出 ' + nm(sell));
      if (buy.length) acts.push('买入 ' + nm(buy));
      txt += ' → <b>' + acts.join('，') + '</b>';
    }
    var rule = (mom.type === 'pct') ? ((mom.m1 || 2) + '日涨幅')
      : ((id === 'earth' ? 'M20/M26 双动量' : ((mom.m1 || 25) + '日加权斜率')));
    return '<div style="margin-top:8px;padding:8px 10px;border-left:3px solid ' +
      (cls_ === 'on' ? 'var(--up,#f0483e)' : 'var(--acc,#5b8cff)') +
      ';background:rgba(255,255,255,.035);border-radius:0 8px 8px 0;font-size:11.5px;line-height:1.7">' +
      '<span class="badge ' + cls_ + '" style="margin-right:6px">换仓判定</span>' + txt +
      '<div style="opacity:.62;margin-top:3px">依据本策略自身参数：' + rule +
      ' · 阈值 ' + (mom.m1lo != null ? mom.m1lo : 0) + '~' + (mom.m1hi != null ? mom.m1hi : 0) +
      ' · TOP' + topN + (cfg.minHold ? ' · 最短持有 ' + cfg.minHold + ' 日' : '') +
      (id === 'momentum' ? ' · GS/乖离剔除后递补' : '') + '</div></div>';
  }

'''

assert txt.count('function maAvg(ser, n) {') == 1
txt = txt.replace('  function maAvg(ser, n) {', FUNC + '  function maAvg(ser, n) {', 1)

n = 0
# ① 快照策略
a1 = "· 溢价需实时 IOPV，离线留空</div></div>';\n    return html;"
assert txt.count(a1) == 1
txt = txt.replace(a1, "· 溢价需实时 IOPV，离线留空</div></div>';\n    html += holdVerdict(s.id, s, ranks, a);\n    return html;", 1)
n += 1
# ② momentum
a2 = "信号「前N补」= 剔除后按乖离递补；高亮行 = 当前持仓</div></div>';\n      return html;"
assert txt.count(a2) == 1
txt = txt.replace(a2, "信号「前N补」= 剔除后按乖离递补；高亮行 = 当前持仓</div></div>';\n      html += holdVerdict(id, S, ranks, a);\n      return html;", 1)
n += 1
# ③ earth
a3 = "得分 = 年化斜率 × 加权R² · 涨跌 ≥9.8% 剔除</div></div>';\n      return html;"
assert txt.count(a3) == 1
txt = txt.replace(a3, "得分 = 年化斜率 × 加权R² · 涨跌 ≥9.8% 剔除</div></div>';\n      html += holdVerdict(id, S, ranks, a);\n      return html;", 1)
n += 1
# ④ lowfreq
a4 = "空仓时持 511880 银华日利</div></div>';\n    return html;"
assert txt.count(a4) == 1
txt = txt.replace(a4, "空仓时持 511880 银华日利</div></div>';\n    html += holdVerdict(id, S, ranks, a);\n    return html;", 1)
n += 1
# ⑤ earth 过滤原因细分
a5 = "r.why = r.pass ? '' : (r.score == null || r.score2 == null ? '数据不足' : '阈值外');"
assert txt.count(a5) == 1
txt = txt.replace(a5, "r.why = r.pass ? '' : (r.score == null || r.score2 == null ? '数据不足'\n          : (r.score <= 0 || r.score > 3 ? 'M20 越界' : 'M26 越界'));", 1)

out = txt.replace('\n', '\r\n') if crlf else txt
open(P, 'wb').write(out.encode('utf-8'))
print('插入 holdVerdict=%d 处, 文件 %.1f KB, crlf=%s' % (n, len(out) / 1024, crlf))
