# 量化工作台

多策略复现 + 每日换仓看板。一个单文件网页 / Android App，把几个 ETF 动量轮动策略的运行状态、每日该买该卖、历史收益（日/月/年日历）装在一起。

**在线版**：<https://mrmaoxu.github.io/quant-workbench/>

## 它解决什么问题

第三方量化平台（次方量化等）上的策略，收益好看但依赖平台：平台改规则、接口关停、账号受限，策略就悬空了。这个工作台把策略规则 **独立复现** 成本地引擎，行情自己拉，净值自己算，不依赖任何平台接口。

同时保留平台口径：官方策略的历史净值、每日盈亏直接来自平台公开接口，标为「官方真值」；自己算出来的标为「本地复现」，两者不混。

## 当前内置策略

| 策略 | 类型 | 标的池 | 核心规则 |
|---|---|---|---|
| 纯粹 | 官方真值 | 12 只 ETF | 平台 13429 策略，官方净值与逐日盈亏 |
| ETF动量轮动 | 官方真值 | 10 只 ETF | 平台 96242 策略（10:30 早盘信号） |
| 大类资产轮动 | 本地复现 | 黄金/纳指/红利低波/创业板/豆粕/日经/中概互联 | 25 日加权斜率，TOP1，阈值 0~2，回撤 10% 止损冷却 1 天，14:30 执行 |
| 七龙珠V2 | 本地复现 | 创业板/德国/豆粕/黄金/日经/纳指 | 25 日加权斜率，阈值 0~3，MA10 上穿 MA20 过滤，回撤 5% 止损冷却 5 天，14:50 执行 |
| 银行等股灾 | 本地复现 | 159552 + 515020 兜底 | 10 日加权斜率，阈值 0.35~2.7，站上 MA10 才持有，最短持 7 个自然日，14:30 执行 |

## 目录

```
index.html            成品网页（数据已内联，双击即可打开，断网可用）
src/part1.html        CSS / 全局样式
src/part2.html        行情工具、回测引擎、路由、首页
src/part3.html        详情页：收益走势、日历、排名、持仓、换仓指令
src/part4.html        自定义策略表单
data/appdata.json     五个策略的净值/盈亏/持仓/信号/指标
data/clist.json       27 只 ETF 的日收盘价矩阵（price × 1000）
data/raw_snapshot.json  行情原始快照 {code: [[date, close]]}
engine/local_engine.py  复现引擎（动量计算 + 轮动 + 风控 + 净值）
engine/build_appdata.py 数据构建：参数 + 行情 → appdata.json
assets/icon.png       App 图标
```

## 网页怎么用

直接打开 `index.html` 就行，数据全内联，不联网也能看。联网时点详情页的「刷新」会用腾讯行情接口拉最新价。

移动端建议浏览器「添加到主屏幕」，跟 App 一个体验。

## 重新构建数据

```bash
# 1. 拉行情（腾讯 newfqkline，分段绕开 800 根上限）
python3 engine/local_engine.py --params data/params.json --raw data/raw_snapshot.json \
        --start 2020-01-01 --end 2026-11-19 --out /tmp/l13429.json

# 2. 五策略全量构建（官方接口 + 本地引擎）
python3 engine/build_appdata.py --raw data/raw_snapshot.json --out data/appdata.json
```

## 数据来源与口径声明

- **官方真值**：`https://www.cifangquant.com/api/etf/strategy/<id>/info`，公开只读接口，含逐日净值 `daily_pnl` 与官方绩效 `performance_metrics`。
- **本地复现**：腾讯前复权日 K → `engine/local_engine.py`。与平台会有小偏差，来源是平台盘中 14:30/14:50 撮合价，日线只有收盘价。
- **溢价率过滤**：七龙珠V2 的 `max_premium` 需要实时 IOPV，免费源拿不到，该条未生效。
- 所有数字均可由仓库内代码重算，不含任何手填或拟合数据。

## 复现引擎要点

动量得分用的是次方量化的加权斜率：

```python
w = linspace(1, 2, n)                    # 权重线性递增
slope = polyfit(log(price), w)          # 加权最小二乘
annual = exp(slope * 250) - 1
score = annual * R²                      # R² 用加权均值
```

V1 版本（部分老策略）用 `int(annual * R² * 10000)` 截断。版本用错会让排名边界整体漂移，对应关系见 `engine/local_engine.py` 里的 `wslope` 分支。

## Android

`量化工作台3.apk`（包名 `com.purity.tool3`）是把 `index.html` 塞进最小 WebView 壳，离线可用。构建链见 `engine/` 同级的打包脚本说明。

## 免责

仅供研究与记录，不构成投资建议。策略历史收益不代表未来表现，实盘请自行承担风险。

## v45 · 动量实验室（新增）

首页新增「动量实验室 · 官网 9 种算法」，与次方量化 `/tool/momentum` 的 9 个按钮一一对应：

| 方法 | 口径 |
|---|---|
| 区间涨幅 / 区间涨幅(分时版) | `P_t / P_{t-N} - 1`，分时版取每日 14:30 价 |
| 斜率 / 斜率(分时版) | `ln P` 等权 OLS，年化 `exp(slope×250)-1` 乘 R² |
| 加权斜率 / 加权斜率(分时版)（V1） | 回归用 w=1→2，R² 的总方差用未加权均值（历史实现，可能负 R²） |
| 加权斜率-V2 / 加权斜率(分时版)-V2 | 回归、残差、总方差、加权均值全部用 w²；实测 512890 得分 0.4261，与平台弹窗逐位一致 |
| RSRS动量 | high~low 回归得 β×R²，质量过滤后取历史 2N 期 Z-Score |

- 代码：`assets/momentum.js`（统一入口 `MOM.calc(method, data, {n})`）、`assets/ohlc.js`（7 只 ETF 日线高低价）。
- 页面可切换 9 种方法、改周期（3~120 日），7 只 ETF 实时排名；512890 的分时 V2 直接吃平台弹窗 25 点真值，打「官网」徽标。
- 官方策略已同步：纯粹 13429、ETF动量轮动 96242、七龙珠V2 96563、**银行等股灾 96560**、大类资产轮动 96561，另有买地球 22753 作官方对照。

## v46 · 动量计算工具（完整仿官网）

- 面板与 `cifangquant.com/tool/momentum` 对齐：ETF 多选（搜索添加、删除、清空、最多 50 只、localStorage 记忆）、9 个算法按钮、动量日期（datetime）、计算周期（3–120）、分时时间（09:30–15:00 七档）。
- 在线（`serve.py` 本地代理）直接 POST 平台公开接口 `/api/etf/realtime-momentum`，结果与官网逐位一致；断网/静态页回落本地复算，7 只 ETF 内置平台 25 日真值。
- 新增 `assets/lab.js`、`assets/offmom_all.js`；`serve.py` 增加 `/api/momentum`、`/api/fund-search` 代理。
- 实测：加权斜率(分时版) 512890 = 0.4235、加权斜率(分时版)-V2 = 0.4321、斜率 = 0.3484、RSRS = -1.3774；自定义加入 515020 银行ETF 正常出分。

## v50 · 实时数据修复

- 日线源切换：东财 push2his 在浏览器端被拒（ERR_EMPTY_RESPONSE），改为腾讯 fqkline（script+_var，file:// 可用）优先、东财兜底；34 只全部更新到当日。
- 盘中每 60s 刷新实时价并按 10 分钟节流补日线重算三策略；收盘后强制补一次最终收盘价；刷新按钮强制全量重拉。
- 今日bar收盘价用实时行情三位小数覆盖（腾讯日线仅两位小数）。
- 动量面板：内置官方真值仅限 2026-11-22 快照日期，其他日期一律在线接口或最新日线本地复算；分时版/RSRS 本地轨支持新日期（TDXR 快照区间外回退日线+实时价，OHLC 用腾讯 high/low 延伸）。
- 修复 isTradingDay 在 idx 未就绪时的崩溃；补 sw.js（network-first）消除 404。
- 实测 11-23：512890 加权斜率(分时版)-V2 = 0.4584，与官方接口逐位一致；三策略净值按当日收盘重算。
