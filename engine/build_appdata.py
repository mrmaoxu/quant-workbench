#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""参数 + 行情 → data/appdata.json + data/clist.json

原则：参数从平台 strategy_setting 原样读取，不手改阈值、不凑收益。
官方策略（p13429 / p96242）不跑本地引擎，沿用 --official-json 里的官方净值与逐日盈亏。

用法：
  python3 engine/build_appdata.py --raw data/raw_snapshot.json \
      --params-dir data/params --official-json data/appdata.json \
      --out data/appdata.json --clist data/clist.json
"""
import argparse
import datetime
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "local_engine.py")
OFFICIAL_IDS = {"p13429", "p96242"}

META = {
    "p96561": ("大类资产轮动", "7 大类资产 · 25日加权斜率 · 阈值0~2 · 回撤10%止损",
               "本地引擎复现：7 只大类资产、25 日加权斜率、阈值 0~2、回撤 10% 止损（冷却 1 天）、14:30 执行。收益为本地复算，非平台回测记录。"),
    "p96563": ("七龙珠V2", "6 只龙头 ETF · 25日加权斜率 · MA10>MA20 过滤 · 回撤5%止损",
               "本地引擎复现：6 只龙头 ETF、25 日加权斜率、阈值 0~3、MA10 上穿 MA20 才买、回撤 5% 止损（冷却 5 天）、14:50 执行。收益为本地复算，非平台回测记录。"),
    "p96560": ("银行等股灾", "159552 银行ETF · 515020 兜底 · 10日斜率 · 站上MA10 才持有",
               "本地引擎复现：159552 银行 ETF + 515020 兜底、10 日加权斜率、阈值 0.35~2.7、站上 MA10 才持有、最短持 7 个自然日、14:30 执行。收益为本地复算。"),
}


def dash(d):
    """20200102 → 2020-01-02"""
    return f"{d[:4]}-{d[4:6]}-{d[6:]}" if d and len(d) == 8 and d.isdigit() else d


def mom_of(st):
    period = int(st.get("momentum_period") or 25)
    m2 = None
    for g in (st.get("momentum_config_groups") or []):
        if int(g.get("period") or 0) > period:
            m2 = int(g["period"])
            break
    ctype = st.get("momentum_calculation_type") or "weighted_slope"
    return {
        "type": "pct" if "pct" in ctype else "wslope",
        "m1": period,
        "m2": m2,
        "m1lo": float(st.get("momentum_threshold") or 0),
        "m1hi": float(st.get("momentum_upper_threshold") or 0),
        "m2lo": 0,
        "m2hi": float(st.get("momentum_upper_threshold") or 0),
    }


def cfg_of(st):
    return {
        "minHold": int(st.get("min_hold_days") or 1),
        "topN": int(st.get("top_n") or 1),
        "exec": st.get("execute_time") or "",
        "comm": float(st.get("commission") or 0),
        "slip": float(st.get("slippage") or 0),
        "reserve": float(st.get("capital_reserve_ratio") or 0),
        "fallback": str(st.get("fallback_etf") or "0"),
        "limit": st.get("extreme_filter_conditions") or [],
        "ddStop": float(st.get("drawdown_stop_threshold") or 0),
        "ddFreeze": int(st.get("stop_loss_freeze_days") or 0),
        "filters": st.get("condition_filter_config") or [],
        "calDays": st.get("days_count_type") == "calendar_days",
    }


def holds_from(trades, last_holdings):
    if not last_holdings:
        return []
    code = list(last_holdings)[0]
    qty = last_holdings[code]
    px = date = None
    for t in reversed(trades):
        if t.get("act") == "buy" and t.get("code") == code:
            px, date = t.get("px"), t.get("date")
            break
    return [{"code": code, "qty": qty, "px": px, "date": dash(date)}]


def metrics_of(m, trades):
    pct = lambda x: None if x is None else round(float(x) * 100, 2)
    return {
        "total": pct(m.get("total_return")),
        "annual": pct(m.get("annual_return")),
        "vol": pct(m.get("volatility")),
        "sharpe": None if m.get("sharpe") is None else round(float(m["sharpe"]), 2),
        "mdd": None if m.get("max_drawdown") is None else abs(pct(m["max_drawdown"])),
        "calmar": None,
        "win": None,
        "plr": None,
        "trades": len(trades),
    }


def run_engine(params_file, raw, out, start, end):
    """区间必须来自策略自身的 start_date/end_date，不能用引擎默认值，
    否则会多跑掉头几年，收益整体失真。"""
    subprocess.run([sys.executable, ENGINE, "--params", params_file, "--raw", raw,
                    "--start", start, "--end", end, "--out", out],
                   check=True, stdout=subprocess.DEVNULL)
    return json.load(open(out, encoding="utf-8"))


def build_clist(raw_path, out_path, since="20200101"):
    raw = json.load(open(raw_path, encoding="utf-8"))
    ax = sorted({d for rows in raw.values() for d, _ in rows if d >= since})
    idx = {d: i for i, d in enumerate(ax)}
    d = {}
    for code, rows in raw.items():
        arr = [0] * len(ax)
        for dt, cl in rows:
            if dt in idx:
                arr[idx[dt]] = int(round(float(cl) * 1000))
        d[code] = arr
    json.dump({"ax": ax, "d": d}, open(out_path, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"[clist] {len(ax)} 天 × {len(d)} 只 → {out_path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--params-dir", default="data/params")
    ap.add_argument("--official-json", default=None, help="已有 appdata.json，用于继承官方策略数据")
    ap.add_argument("--out", default="data/appdata.json")
    ap.add_argument("--clist", default=None, help="同时生成 clist.json 时给路径")
    ap.add_argument("--clist-since", default="20200101", help="clist 起始日（8 位）")
    ap.add_argument("--tmp", default="/tmp")
    a = ap.parse_args()

    official = {}
    if a.official_json and os.path.exists(a.official_json):
        official = json.load(open(a.official_json, encoding="utf-8")).get("S", {}).get("s", {})

    S = {}
    for fn in sorted(os.listdir(a.params_dir)):
        if not fn.endswith(".json"):
            continue
        pid = fn[:-5]
        pf = os.path.join(a.params_dir, fn)
        pd_ = json.load(open(pf, encoding="utf-8"))
        st = pd_.get("strategy_setting", pd_)
        pool = [str(c) for c in (st.get("etf_pool") or [])]

        if pid in OFFICIAL_IDS:
            if pid not in official:
                print(f"[skip] {pid} 官方数据缺失，需先提供 --official-json")
                continue
            S[pid] = official[pid]
            print(f"[official] {pid} 官方值沿用")
            continue

        name, sub, note = META.get(pid, (pid, "", ""))
        init = float(pd_.get("init_capital") or st.get("initial_capital") or 100000)
        start = str(st.get("start_date") or "2020-01-01").replace("-", "")
        end = str(st.get("end_date") or "").replace("-", "") or "20261118"
        lout = os.path.join(a.tmp, f"l_{pid}.json")
        res = run_engine(pf, a.raw, lout, start, end)

        S[pid] = {
            "id": pid,
            "name": name,
            "sub": sub,
            "note": note,
            "official": False,
            "engine": True,
            "init": init,
            "pool": pool,
            "start": start,
            "end": str(res["nav"][-1][0]) if res.get("nav") else "",
            "mom": mom_of(st),
            "cfg": cfg_of(st),
            "nav": res["nav"],
            "daily": res["daily"],
            "pts": res.get("pts") or [],
            "trades": res.get("trades") or [],
            "holds": holds_from(res.get("trades") or [], res.get("last_holdings")),
            "metrics": metrics_of(res.get("metrics") or {}, res.get("trades") or []),
        }
        m = S[pid]["metrics"]
        print(f"[engine] {pid} {name}: 总收益 {m['total']}% 年化 {m['annual']}% 回撤 {m['mdd']}% 笔数 {m['trades']}")

    out = {"s": S, "gen": datetime.date.today().isoformat()}
    json.dump({"S": out}, open(a.out, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"[out] {len(S)} 个策略 → {a.out}")

    if a.clist:
        build_clist(a.raw, a.clist, a.clist_since)


if __name__ == "__main__":
    main()
