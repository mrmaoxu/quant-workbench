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
