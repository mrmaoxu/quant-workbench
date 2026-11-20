# -*- coding: utf-8 -*-
"""官方净值反推 → 平滑 + 官方持仓锚定 → 输出官方口径换仓记录"""
import json, urllib.request

POOL = ["518880", "159941", "512890", "159915", "159985", "513520", "161127"]
NAME = {"518880": "黄金ETF", "159941": "纳指ETF", "512890": "红利低波ETF", "159915": "创业板ETF",
        "159985": "豆粕ETF", "513520": "日经ETF", "161127": "标普生物ETF"}
raw = json.load(open("raw_qlz.json", encoding="utf-8"))
data = json.loads(urllib.request.urlopen(
    "http://127.0.0.1:8765/api/off/26867", timeout=30).read().decode("utf-8"))["data"]
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


# 1) 逐日匹配（1 日 + 3 日双窗口，取更优）
seq = []
for i, (d, v) in enumerate(rows):
    if i == 0:
        seq.append((d, None, 9.9, v))
        continue
    pv = rows[i - 1][1]
    r1 = v / pv - 1
    best = (9.9, None)
    for c in POOL:
        a = ret(c, d)
        if a is None:
            continue
        e = abs(r1 - a)
        if e < best[0]:
            best = (e, c)
    # 3 日窗口交叉验证
    if i >= 3:
        pv3 = rows[i - 3][1]
        r3 = v / pv3 - 1
        alt = (9.9, None)
        for c in POOL:
            ser = raw.get(c, {})
            ds = [x for x in ser if x <= d]
            if len(ds) < 4:
                continue
            r = ser[ds[-1]] / ser[ds[-4]] - 1
            e3 = abs(r3 - r)
            if e3 < alt[0]:
                alt = (e3, c)
        if alt[1] and best[1] and alt[1] != best[1]:
            best = alt if alt[0] < 0.002 else best
    seq.append((d, best[1] if best[0] < 0.006 else None, best[0], v))

# 2) 抖动平滑：孤立一日切换还原
for _ in range(3):
    for i in range(1, len(seq) - 1):
        if seq[i][1] != seq[i - 1][1] and seq[i + 1][1] == seq[i - 1][1]:
            seq[i] = (seq[i][0], seq[i - 1][1], seq[i][2], seq[i][3])

# 3) 官方持仓锚定（唯一持仓来自 holding_etfs）
anchor = None
if data.get("holding_etfs"):
    h = data["holding_etfs"][0]
    anchor = (str(h["buy_date"]).replace("-", ""), str(h["code"]), float(h["buy_price"]))
if anchor:
    for i, s in enumerate(seq):
        if s[0] >= anchor[0]:
            seq[i] = (s[0], anchor[1], 0.0, s[3])

# 4) 生成段
segs = []
cur = None
for d, c, e, v in seq:
    if cur is None or c != cur["code"]:
        if cur:
            cur["end"] = prev_d
            segs.append(cur)
        cur = {"code": c, "start": d, "end": d, "v0": v}
    prev_d = d
if cur:
    cur["end"] = prev_d
    segs.append(cur)

trades = []
for s in segs:
    c = s["code"]
    if c is None:
        continue
    p0 = px_on(c, s["start"])
    p1 = px_on(c, s["end"])
    if not p0 or not p1:
        continue
    sh = int(s["v0"] / p0 // 100) * 100
    if sh < 100:
        continue
    trades.append({"buy": s["start"], "sell": s["end"], "code": c, "name": NAME[c],
                   "buy_px": round(p0, 4), "sell_px": round(p1, 4), "shares": sh,
                   "buy_amt": round(sh * p0, 2), "sell_amt": round(sh * p1, 2),
                   "pnl": round((p1 - p0) * sh, 2)})

print("段数", len(segs), "有效持仓段", len(trades), "总笔数", len(trades) * 2)
print("收益合计 %.0f%%" % ((rows[-1][1] / rows[0][1] - 1) * 100))
for t in trades[-10:]:
    print(t["buy"], "买", t["name"], t["buy_px"], t["shares"], "→", t["sell"], "卖", t["sell_px"], "盈亏", t["pnl"])
json.dump({"segs": segs, "trades": trades, "rows": rows},
          open("official_trades.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
