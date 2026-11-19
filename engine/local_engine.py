#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""次方量化策略 · 独立复现引擎（不依赖平台，平台倒闭也能跑）

只吃「策略参数 + 行情」，参数从平台 strategy_setting 原样读取，不手改阈值。
支持 weighted_slope(V2) / weighted_slope_v1 / weighted_slope_close(_v2) / simple_close
以及 MA 过滤（ma_golden_cross / close_above_ma）、回撤止损 + 冷却、自然日/交易日最短持有、
止盈、货币兜底、成本、备用金、涨跌停过滤。

用法:
  python3 local_engine.py --params p.json --raw raw_all.json --start 20180101 --end 20261118 --out r.json
  python3 local_engine.py --params p.json --raw raw_all.json --official s_official.json   # 逐日对账
"""
import argparse
import json
import math
from datetime import datetime

import numpy as np


def wslope_v2(prices, n):
    p = np.asarray(prices[-n:], dtype=float)
    if len(p) < n or np.any(p <= 0):
        return None
    y = np.log(p)
    x = np.arange(n, dtype=float)
    w = np.linspace(1.0, 2.0, n)
    slope, intercept = np.polyfit(x, y, 1, w=w)
    annual = math.exp(slope * 250) - 1
    y_pred = slope * x + intercept
    y_bar = float(np.sum(w * y) / np.sum(w))
    ss_res = float(np.sum(w * (y - y_pred) ** 2))
    ss_tot = float(np.sum(w * (y - y_bar) ** 2))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return float(annual * r2)


def wslope_v1(prices, n):
    p = [float(x) for x in prices[-n:]]
    if len(p) < n or any(x <= 0 for x in p):
        return None
    lp = [math.log(x) for x in p]
    w = [1.0 + i / (n - 1) for i in range(n)]
    sw2 = sxw = syw = sxxw = sxyw = 0.0
    for i in range(n):
        w2 = w[i] * w[i]
        sw2 += w2
        sxw += w2 * i
        syw += w2 * lp[i]
        sxxw += w2 * i * i
        sxyw += w2 * i * lp[i]
    denom = sw2 * sxxw - sxw * sxw
    if denom == 0:
        return None
    slope = (sw2 * sxyw - sxw * syw) / denom
    intercept = (syw - slope * sxw) / sw2
    try:
        annualized = math.exp(slope * 250) - 1
    except OverflowError:
        return None
    mean_y = sum(lp) / n
    ss_res = ss_tot = 0.0
    for i in range(n):
        y_pred = slope * i + intercept
        ss_res += w[i] * (lp[i] - y_pred) ** 2
        ss_tot += w[i] * (lp[i] - mean_y) ** 2
    r2 = 1 - ss_res / ss_tot if ss_tot != 0 else 0.0
    return int(annualized * r2 * 10000)


def load_raw(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for code, rows in data.items():
        if rows and isinstance(rows[0], dict):
            items = [(r["date"], float(r["close"])) for r in rows]
        else:
            items = [(r[0], float(r[1])) for r in rows]
        out[code] = dict(sorted((d.replace("-", ""), p) for d, p in items))
    return out


def metrics(nav, init):
    eq = np.asarray([v for _, v in nav], dtype=float)
    n = len(eq)
    if n == 0:
        return {}
    total = eq[-1] / init - 1
    ann = (eq[-1] / init) ** (252 / n) - 1
    daily = np.diff(np.log(eq)) if n > 1 else np.array([0.0])
    vol = float(daily.std() * math.sqrt(252)) if n > 1 else 0.0
    peak = np.maximum.accumulate(eq)
    mdd = (eq / peak - 1).min()
    return {"total_return": round(float(total), 4), "annual_return": round(float(ann), 4),
            "volatility": round(vol, 4), "sharpe": round(float((ann - 0.02) / vol), 2) if vol > 0 else 0,
            "max_drawdown": round(float(mdd), 4), "trading_days": n}


def _dt(d):
    return datetime(int(d[:4]), int(d[4:6]), int(d[6:8]))


class Engine:
    def __init__(self, params, raw):
        st = params.get("strategy_setting", params)
        self.pool = [str(c) for c in st.get("etf_pool", [])]
        self.type = st.get("momentum_calculation_type", "weighted_slope")
        self.period = int(st.get("momentum_period", 0) or 0)
        self.groups = st.get("momentum_config_groups") or []
        self.lo = float(st.get("momentum_threshold", 0) or 0)
        self.hi = float(st.get("momentum_upper_threshold", 0) or 0)
        self.top_n = int(st.get("top_n", 1) or 1)
        self.min_hold = int(st.get("min_hold_days", 1) or 1)
        self.tp = float(st.get("take_profit_threshold", 0) or 0) if st.get("take_profit_enabled") else 0
        self.fb = str(st.get("fallback_etf") or "")
        if self.fb in ("0", "0.0", "None", "none", ""):
            self.fb = ""
        self.comm = float(st.get("commission", 0) or 0)
        self.slip = float(st.get("slippage", 0) or 0)
        self.reserve = float(st.get("capital_reserve_ratio", 0) or 0)
        self.extreme = st.get("extreme_filter_conditions") or []
        self.filters = st.get("condition_filter_config") or []
        self.dd_stop = float(st.get("drawdown_stop_threshold", 0) or 0) \
            if (st.get("stop_loss_enabled") and "drawdown" in (st.get("stop_loss_methods") or [])) else 0
        self.dd_freeze = int(st.get("stop_loss_freeze_days", 0) or 0) if self.dd_stop else 0
        self.calendar_hold = st.get("days_count_type") == "calendar_days"
        self.freeze = {}
        self.raw = raw
        self.ma_cache = {}

    def ma(self, c, d, n):
        key = (c, d, n)
        if key in self.ma_cache:
            return self.ma_cache[key]
        s = self.raw.get(c, {})
        if d not in s:
            return None
        ds = [k for k in sorted(s) if k <= d]
        if len(ds) < n:
            return None
        v = sum(s[k] for k in ds[-n:]) / n
        self.ma_cache[key] = v
        return v

    def filters_ok(self, c, d):
        s = self.raw.get(c, {})
        for f in self.filters:
            t = f.get("type")
            if t == "close_above_ma":
                n = int(f.get("period") or 10)
                m = self.ma(c, d, n)
                if m is None or s.get(d) is None or s[d] <= m:
                    return False
            elif t == "ma_golden_cross":
                fa = int(f.get("fast_period") or 10)
                sl = int(f.get("slow_period") or 20)
                mf, ms = self.ma(c, d, fa), self.ma(c, d, sl)
                if mf is None or ms is None or mf <= ms:
                    return False
            elif t == "premium_limit":
                # 溢价率需 IOPV，免费源没有 → 不拦截（如实标注）
                continue
        return True

    def score(self, c, d):
        s = self.raw.get(c, {})
        if d not in s:
            return None
        if not self.filters_ok(c, d):
            return None
        closes = [p for k, p in s.items() if k <= d]
        if self.type == "simple_close":
            need = (self.period or 1) + 1
            if len(closes) < need:
                return None
            return closes[-1] / closes[-1 - (self.period or 1)] - 1
        if self.groups:
            vals = []
            for g in self.groups:
                days = int(g.get("days") or g.get("period") or g.get("momentum_period"))
                v = wslope_v1(closes, days) if "v1" in self.type else wslope_v2(closes, days)
                if v is None:
                    return None
                lo = float(g.get("low", g.get("momentum_threshold", 0)) or 0)
                hi = float(g.get("high", g.get("momentum_upper_threshold", 0)) or 0)
                if not (lo < v < hi):
                    return None
                vals.append(v)
            return vals[0]
        days = self.period or 25
        if len(closes) < days:
            return None
        return wslope_v1(closes, days) if "v1" in self.type else wslope_v2(closes, days)

    def pick(self, d):
        cands = []
        for c in self.pool:
            s = self.raw.get(c, {})
            if d not in s:
                continue
            fz = self.freeze.get(c)
            if fz and self.dd_freeze and (_dt(d) - _dt(fz)).days < self.dd_freeze:
                continue
            v = self.score(c, d)
            if v is None:
                continue
            if self.type == "simple_close":
                if not (self.lo <= v <= self.hi):
                    continue
            if self.extreme and not c.startswith(("51", "15", "16", "50", "58", "56")):
                prev = [p for k, p in s.items() if k < d][-1]
                if abs(s[d] / prev - 1) >= 0.099:
                    continue
            cands.append((-v, c))
        cands.sort()
        return [c for _, c in cands[: self.top_n]]

    def run(self, start, end, init):
        need = set(self.pool + ([self.fb] if self.fb else []))
        dates = sorted({d for c in need if c in self.raw for d in self.raw[c] if start <= d <= end})
        di = {d: i for i, d in enumerate(dates)}
        cash, hold, last = float(init), None, {}
        nav, trades, pts = [], [], []

        def p(c, d):
            return self.raw.get(c, {}).get(d)

        def pv(c, d):
            x = p(c, d)
            if x:
                last[c] = x
            return last.get(c)

        def held_days(h, d):
            if self.calendar_hold:
                return (_dt(d) - _dt(h["d"])).days
            return di[d] - di[h["d"]]

        for d in dates:
            targets = self.pick(d)
            target = targets[0] if targets else None
            if hold:
                mv = hold["s"] * pv(hold["c"], d)
                if mv > hold.get("max", 0):
                    hold["max"] = mv
                reason = None
                if self.dd_stop and hold.get("max") and mv <= hold["max"] * (1 - self.dd_stop):
                    reason = "drawdown_stop"
                elif self.tp and mv >= hold["mv"] * (1 + self.tp):
                    reason = "take_profit"
                elif hold["c"] == self.fb and target:
                    reason = "switch"
                elif hold["c"] != self.fb and held_days(hold, d) >= self.min_hold and target != hold["c"]:
                    reason = "rotate"
                if reason:
                    px = p(hold["c"], d)
                    if px:
                        cash += hold["s"] * px * (1 - self.slip) * (1 - self.comm)
                        trades.append({"date": d, "act": "sell", "code": hold["c"], "px": round(px, 4),
                                       "shares": hold["s"], "reason": reason})
                        if reason == "drawdown_stop":
                            self.freeze[hold["c"]] = d
                        hold = None
            if hold is None:
                tgt = target or self.fb or None
                if tgt:
                    fz = self.freeze.get(tgt)
                    if fz and self.dd_freeze and (_dt(d) - _dt(fz)).days < self.dd_freeze:
                        tgt = self.fb or None
                if tgt:
                    px = p(tgt, d)
                    if px:
                        pb = px * (1 + self.slip)
                        shares = int(cash * (1 - self.reserve) / (pb * (1 + self.comm)) // 100) * 100
                        if shares >= 100:
                            cash -= shares * pb * (1 + self.comm)
                            hold = {"c": tgt, "s": shares, "d": d, "mv": shares * pb, "max": shares * pb}
                            trades.append({"date": d, "act": "buy", "code": tgt, "px": round(pb, 4),
                                           "shares": shares, "reason": "target" if target else "fallback"})
            eq = cash + (hold["s"] * pv(hold["c"], d) if hold else 0.0)
            nav.append((d, round(eq, 2)))
            pts.append([d, hold["c"] if hold else None])
        return {"nav": nav, "trades": trades, "pts": pts, "metrics": metrics(nav, init),
                "last_holdings": {hold["c"]: hold["s"]} if hold else {}}


def daily_of(nav):
    out, prev = {}, None
    for d, v in nav:
        out[d] = {"p": round(v - prev, 2) if prev is not None else 0.0,
                  "a": round((v / prev - 1) * 100, 4) if prev else 0.0}
        prev = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--params", required=True)
    ap.add_argument("--raw", required=True)
    ap.add_argument("--start", default="20180101")
    ap.add_argument("--end", default="20261118")
    ap.add_argument("--init", type=float, default=None)
    ap.add_argument("--out", default="result.json")
    ap.add_argument("--official", default=None)
    a = ap.parse_args()

    params = json.load(open(a.params, encoding="utf-8"))
    raw = load_raw(a.raw)
    init = a.init or float(params.get("init_capital") or 5000)
    res = Engine(params, raw).run(a.start, a.end, init)
    res["daily"] = daily_of(res["nav"])
    json.dump(res, open(a.out, "w", encoding="utf-8"), ensure_ascii=False)
    m = res["metrics"]
    print(f"总收益 {m['total_return']:.2%} 年化 {m['annual_return']:.2%} "
          f"波动 {m['volatility']:.2%} 夏普 {m['sharpe']} 回撤 {m['max_drawdown']:.2%} 交易日 {m['trading_days']}")
    print(f"买入 {sum(1 for t in res['trades'] if t['act']=='buy')} "
          f"卖出 {sum(1 for t in res['trades'] if t['act']=='sell')} 期末 {res['last_holdings']}")
    if a.official:
        off = json.load(open(a.official, encoding="utf-8"))
        for key, o in off.items():
            if not isinstance(o, dict) or "nav" not in o:
                continue
            onav = {d.replace("-", ""): v for d, v in o["nav"]}
            lnv = dict(res["nav"])
            common = sorted(set(onav) & set(lnv))
            if not common:
                continue
            errs = [abs(lnv[d] / onav[d] - 1) for d in common if onav[d]]
            print(f"[{key}] 共同日 {len(common)} 平均日误差 {sum(errs)/len(errs):.4%} "
                  f"末日比值 {lnv[common[-1]]/onav[common[-1]]:.4f}")


if __name__ == "__main__":
    main()
