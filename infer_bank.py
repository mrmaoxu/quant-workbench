# -*- coding: utf-8 -*-
"""银行等股灾(96070)：官方净值反推逐笔 → 与官网交易信号同构"""
import json, urllib.request

NAME = {"515020": "银行ETF华夏", "159552": "中证2000增强ETF招商"}
raw = json.load(open("raw_bank.json", encoding="utf-8"))
data = json.loads(urllib.request.urlopen(
    "http://127.0.0.1:8765/api/off/96070", timeout=30).read().decode("utf-8"))["data"]
rows = [(str(r["date"]).replace("-", ""), float(r["portfolio_value"])) for r in data["daily_pnl"]]


def px_on(c, d):
    ser = raw.get(c, {})
    ds = [x for x in ser if x <= d]
    return ser[ds[-1]] if ds else None


def ret(c, d):
    ser = raw.get(c, {})
    ds = [x for x in ser if x <= d]
    if len(ds) < 2:
        return None
    a, b = ser[ds[-2]], ser[ds[-1]]
    return b / a - 1 if a else None


seq = []
for i, (d, v) in enumerate(rows):
    if i == 0:
        seq.append([d, None, 9.9, v])
        continue
    pv = rows[i - 1][1]
    r1 = v / pv - 1
    best = (9.9, None)
    for c in ("515020", "159552"):
        a = ret(c, d)
        if a is None:
            continue
        if abs(r1 - a) < best[0]:
            best = (abs(r1 - a), c)
    seq.append([d, best[1] if best[0] < 0.006 else None, best[0], v])

for _ in range(4):
    for i in range(1, len(seq) - 1):
        if seq[i][1] != seq[i - 1][1] and seq[i + 1][1] == seq[i - 1][1]:
            seq[i][1] = seq[i - 1][1]

# 官方持仓锚定
h = data["holding_etfs"][0]
anchor = (str(h["buy_date"]).replace("-", ""), str(h["code"]), float(h["buy_price"]), int(float(h["amount"])))
for i, s in enumerate(seq):
    if s[0] >= anchor[0]:
        seq[i][1] = anchor[1]

di = {d: i for i, (d, _) in enumerate(rows)}
segs, cur = [], None
prev_d = None
for d, c, e, v in seq:
    if cur is None or c != cur["code"]:
        if cur:
            cur["end"] = prev_d
            segs.append(cur)
        cur = {"code": c, "start": d, "v0": v}
    prev_d = d
if cur:
    cur["end"] = prev_d
    segs.append(cur)

changed = True
while changed:
    changed = False
    for i in range(len(segs)):
        s = segs[i]
        if s["code"] and di.get(s["end"], 0) - di.get(s["start"], 0) < 2 and i > 0:
            segs[i - 1]["end"] = s["end"]
            segs.pop(i)
            changed = True
            break

out = []
for i, s in enumerate(segs):
    c = s["code"]
    if not c:
        continue
    holding = (i == len(segs) - 1)
    # 观测到该标的的首日是成交次日（当日 14:30 成交、次日净值才单边体现），买入日回退一个交易日
    si = di.get(s["start"], 0)
    buy_d = rows[max(si - 1, 0)][0] if not holding else s["start"]
    p0 = px_on(c, buy_d)
    p1 = None if holding else px_on(c, s["end"])
    if not p0:
        continue
    sh = int(s["v0"] / p0 // 100) * 100
    if anchor[1] == c and holding:
        p0, sh = anchor[2], anchor[3]
    out.append({"c": c, "n": NAME[c], "sh": sh, "p0": round(p0, 4),
                "p1": None if holding else round(p1, 4),
                "buy": buy_d, "sell": None if holding else s["end"],
                "amt0": round(sh * p0, 2),
                "amt1": None if holding else round(sh * p1, 2),
                "pnl": None if holding else round((p1 - p0) * sh, 2),
                "days": None if holding else (di.get(s["end"], 0) - si),
                "hold": holding})

print("段数", len(out), "逐笔", len(out) * 2 - (1 if out and out[-1]["hold"] else 0))
print("官方 stock_returns 换仓次数:", [(x["etf_code"], x["trade_count"], x["total_hold_days"]) for x in data["stock_returns"]])
for x in out[-8:]:
    print(x["buy"], "买", x["n"], x["p0"], x["sh"], "| 卖", x["sell"], x["p1"], "盈亏", x["pnl"], "持有", x["days"])

json.dump(out, open("trades_bank.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# 合并写入 assets/offtrades.js
p = r"G:\AI_DEMO\纯粹策略\workbench-v2\assets\offtrades.js"
txt = open(p, encoding="utf-8").read()
pre = "window.OFFTR="
obj = json.loads(txt[len(pre):].rstrip().rstrip(";"))
obj["p96560"] = {"id": "96070", "src": "官方净值逐日反推", "trades": out, "nav": rows}
open(p, "w", encoding="utf-8").write(pre + json.dumps(obj, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("offtrades.js updated:", list(obj.keys()))
