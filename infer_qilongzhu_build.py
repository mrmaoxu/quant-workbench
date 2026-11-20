# -*- coding: utf-8 -*-
"""反推结果清洗 → 生成与次方页面同构的逐笔交易 + assets/offtrades.js"""
import json, urllib.request

NAME = {"518880": "黄金ETF", "159941": "纳指ETF", "512890": "红利低波ETF", "159915": "创业板ETF",
        "159985": "豆粕ETF", "513520": "日经ETF", "161127": "标普生物ETF"}
raw = json.load(open("raw_qlz.json", encoding="utf-8"))
d0 = json.load(open("official_trades.json", encoding="utf-8"))
data = json.loads(urllib.request.urlopen(
    "http://127.0.0.1:8765/api/off/26867", timeout=30).read().decode("utf-8"))["data"]
rows = d0["rows"]
dates = [d for d, _ in rows]
di = {d: i for i, d in enumerate(dates)}


def span_days(a, b):
    return di.get(b, 0) - di.get(a, 0)


segs = [s for s in d0["segs"] if s["code"]]
# 合并短段（<2 交易日）到前一段
changed = True
while changed:
    changed = False
    for i in range(len(segs)):
        s = segs[i]
        if span_days(s["start"], s["end"]) < 2 and i > 0:
            segs[i - 1]["end"] = s["end"]
            segs.pop(i)
            changed = True
            break

anchor_code = None
anchor_px = None
if data.get("holding_etfs"):
    anchor_code = str(data["holding_etfs"][0]["code"])
    anchor_px = float(data["holding_etfs"][0]["buy_price"])

out = []
for i, s in enumerate(segs):
    c = s["code"]
    p0 = raw.get(c, {}).get(s["start"]) or None
    if p0 is None:
        ds = [x for x in raw.get(c, {}) if x <= s["start"]]
        p0 = raw[c][ds[-1]] if ds else None
    if not p0:
        continue
    holding = (i == len(segs) - 1)
    p1 = None if holding else (raw.get(c, {}).get(s["end"]) or None)
    if not holding and p1 is None:
        ds = [x for x in raw.get(c, {}) if x <= s["end"]]
        p1 = raw[c][ds[-1]] if ds else None
    sh = int(s["v0"] / p0 // 100) * 100
    if anchor_code == c and i == len(segs) - 1 and anchor_px:
        # 末段用官方真实买入价与股数
        p0 = anchor_px
        sh = int(float(data["holding_etfs"][0]["amount"]) // 1)
    pnl = None if holding else round((p1 - p0) * sh, 2)
    out.append({
        "c": c, "n": NAME[c], "sh": sh, "p0": round(p0, 4),
        "p1": None if holding else round(p1, 4),
        "buy": s["start"], "sell": None if holding else s["end"],
        "amt0": round(sh * p0, 2),
        "amt1": None if holding else round(sh * p1, 2),
        "pnl": pnl, "days": None if holding else span_days(s["start"], s["end"]),
        "hold": holding
    })

print("清洗后持仓段", len(out), "→ 逐笔", len(out) * 2 - (1 if out and out[-1]["hold"] else 0))
pj = sum(x["pnl"] for x in out if x["pnl"] is not None)
print("已实现盈亏合计 %.0f" % pj)
for x in out[-6:]:
    print(x["buy"], "买", x["n"], x["p0"], x["sh"], "| 卖", x["sell"], x["p1"], "盈亏", x["pnl"], "持有", x["days"])

js = {"id": "26867", "src": "官方净值逐日反推", "trades": out, "nav": rows}
with open(r"G:\AI_DEMO\纯粹策略\workbench-v2\assets\offtrades.js", "w", encoding="utf-8") as f:
    f.write("window.OFFTR=" + json.dumps({"p96563": js}, ensure_ascii=False, separators=(",", ":")) + ";\n")
json.dump(out, open("trades_clean.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("assets/offtrades.js written")
