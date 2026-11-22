/* 动量计算工具（模仿 cifangquant.com/tool/momentum 全功能面板）
   9 种方法 · 最多 50 只 ETF 自选 · 动量日期 / 周期 / 分时时间 · 结果表 + 计算过程
   在线（localhost 代理）优先调官方 /api/etf/realtime-momentum，离线回落本地复算 */
window.LABVIEW = (function () {
  var METHODS = [
    { k: 'simple_close', n: '区间涨幅', src: 'close', d: '首尾收盘价涨跌幅' },
    { k: 'rsrs', n: 'RSRS动量', src: 'ohlc', d: '高价对低价回归 β×R²，再取 2N 期 Z-Score' },
    { k: 'slope_close', n: '斜率', src: 'close', d: 'ln 收盘价等权回归，年化 × R²' },
    { k: 'weighted_slope_close', n: '加权斜率', src: 'close', d: 'V1：近期权重 1→2，R² 口径不一致' },
    { k: 'simple', n: '区间涨幅(分时版)', src: 'intraday', d: '首尾取 14:30 分时价' },
    { k: 'slope', n: '斜率(分时版)', src: 'intraday', d: 'ln 分时价等权回归' },
    { k: 'weighted_slope', n: '加权斜率(分时版)', src: 'intraday', d: 'V1 分时价版本' },
    { k: 'weighted_slope_close_v2', n: '加权斜率-V2', src: 'close', d: '回归/残差/总方差全 w²（推荐）' },
    { k: 'weighted_slope_v2', n: '加权斜率(分时版)-V2', src: 'intraday', d: 'V2 分时价版本，官网弹窗同口径' }
  ];
  var TIMES = ['09:30', '10:30', '13:00', '14:00', '14:30', '14:50', '15:00'];
  var DEFAULT_POOL = ['512890', '161127', '159985', '159941', '518880', '513520', '159915'];

  var S = null;

  function nowLocal() {
    var d = new Date();
    function p(x) { return String(x).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function state() {
    if (!S) {
      var pool = DEFAULT_POOL.slice();
      try { var saved = JSON.parse(localStorage.getItem('labpool') || 'null'); if (saved && saved.length) pool = saved; } catch (e) { }
      S = { m: 'weighted_slope_v2', n: 25, pool: pool, date: nowLocal(), time: '14:30', res: null, src: '', err: '', busy: false, sug: [] };
    }
    return S;
  }
  function savePool() { try { localStorage.setItem('labpool', JSON.stringify(S.pool)); } catch (e) { } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function nameOf(code) { return (window.LABDATA && LABDATA.names[code]) || code; }
  function method() { for (var i = 0; i < METHODS.length; i++) if (METHODS[i].k === state().m) return METHODS[i]; return METHODS[0]; }

  function card() {
    var st = state();
    return '<div class="card labcard" id="labbox">' +
      '<div class="chd"><span class="bar gold"></span><h2>动量计算工具</h2><span class="rt">9 种算法 · 最多 50 只</span></div>' +
      '<div class="labsec"><b>选择ETF产品</b><i id="labCount">（已选择 ' + st.pool.length + '/50 个）</i>' +
      '<button class="lnk" data-act="clear">清空全部</button></div>' +
      '<div class="labpool" id="labPool">' + poolChips() + '</div>' +
      '<div class="labsearch"><input id="labSearch" placeholder="搜索ETF代码或名称..." autocomplete="off"><div class="labsug" id="labSug"></div></div>' +
      '<div class="labsec"><b>动量计算方式</b><button class="lnk" data-act="help">计算说明</button></div>' +
      '<div class="labgrid">' + METHODS.map(function (m) {
        return '<div class="labopt ' + (m.k === st.m ? 'on' : '') + '" data-act="method" data-k="' + m.k + '">' + m.n + '</div>';
      }).join('') + '</div>' +
      '<div class="labrows">' +
      '<label class="labfield"><span>动量日期</span><input type="datetime-local" id="labDate" value="' + esc(st.date) + '"><em>取该时刻已结算K线</em></label>' +
      '<label class="labfield"><span>计算周期</span><div class="numbox"><button data-act="minus">−</button><input type="number" id="labN" min="3" max="120" value="' + st.n + '"><button data-act="plus">+</button></div><em>建议 5–60 天</em></label>' +
      '<label class="labfield"><span>分时时间</span><select id="labTime">' + TIMES.map(function (t) { return '<option ' + (t === st.time ? 'selected' : '') + '>' + t + '</option>'; }).join('') + '</select><em>历史日取该时刻分时价</em></label>' +
      '</div>' +
      '<div class="labgo"><button class="btn pri" data-act="calc" id="labGo">▶ 开始计算</button><span class="labmsg" id="labMsg">' + esc(st.err) + '</span></div>' +
      '<div id="labRes">' + resultHTML() + '</div>' +
      '<div class="vnote" style="margin-top:8px">在线时直连平台公开接口（本地代理，无 CORS），结果与官网逐位一致；接口不可用时用本地复算并标注「本地」。512890 等 7 只已内置平台 25 日真值。</div>' +
      '</div>' + modalHTML();
  }

  function poolChips() {
    if (!state().pool.length) return '<span class="labempty">暂无选择的ETF产品，请使用搜索框添加</span>';
    return state().pool.map(function (c) {
      return '<span class="labchip">' + esc(nameOf(c)) + '(' + c + ')<button data-act="del" data-c="' + c + '">×</button></span>';
    }).join('');
  }

  function resultHTML() {
    var st = state();
    if (st.busy) return '<div class="labres loading">计算中…</div>';
    if (!st.res) return '';
    var rows = st.res.rows || [];
    return '<div class="labres"><div class="labreshead">计算结果 · 动量类型：' + esc(st.res.label || method().n) +
      ' ｜ 计算周期：' + st.res.n + ' 天 <span class="labsrc">' + esc(st.src) + '</span></div>' +
      '<div class="tablewrap"><table class="tbl labtbl"><thead><tr><th>排名</th><th>代码</th><th>名称</th><th>动量值</th><th>操作</th></tr></thead><tbody>' +
      rows.map(function (r, i) {
        return '<tr><td class="num">' + (i + 1) + '</td><td class="num">' + r.c + '</td><td>' + esc(r.n) + '</td>' +
          '<td class="num ' + (r.v >= 0 ? 'up' : 'dn') + '"><b>' + (r.v == null ? '—' : r.v.toFixed(4)) + '</b></td>' +
          '<td><button class="lnk" data-act="detail" data-i="' + i + '">详情</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  function modalHTML() { return '<div class="labmask" id="labMask"><div class="labmodal"><div class="labmhd"><span id="labMTitle">计算过程</span><button data-act="close">×</button></div><div class="labmbody" id="labMBody"></div></div></div>'; }

  function paint() {
    var box = document.getElementById('labbox');
    if (!box) return;
    box.outerHTML = card();
    bindSug();
  }

  function bindSug() {
    var inp = document.getElementById('labSearch');
    if (!inp) return;
    var t = null;
    inp.addEventListener('input', function () {
      clearTimeout(t);
      var kw = inp.value.trim();
      if (!kw) { document.getElementById('labSug').innerHTML = ''; return; }
      t = setTimeout(function () { search(kw); }, 350);
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var kw = inp.value.trim();
        if (/^\d{6}$/.test(kw)) { add(kw); inp.value = ''; document.getElementById('labSug').innerHTML = ''; }
      }
    });
  }

  function search(kw) {
    var box = document.getElementById('labSug');
    var done = function (list) {
      state().sug = list;
      box.innerHTML = list.slice(0, 8).map(function (x) {
        return '<div class="sugitem" data-act="add" data-c="' + x.c + '" data-n="' + esc(x.n) + '">' +
          '<b>' + x.c + '</b> ' + esc(x.n) + '</div>';
      }).join('') || '<div class="sugitem dim">未找到匹配的 ETF</div>';
    };
    var local = [];
    for (var c in (window.LABDATA ? LABDATA.names : {})) {
      if (c.indexOf(kw) >= 0 || (LABDATA.names[c] || '').indexOf(kw) >= 0) local.push({ c: c, n: LABDATA.names[c] });
    }
    done(local);
    if (location.protocol.indexOf('http') === 0) {
      fetch('/api/fund-search?kw=' + encodeURIComponent(kw)).then(function (r) { return r.json(); }).then(function (j) {
        var arr = (j && (j.data || j.list || j.result)) || [];
        if (!Array.isArray(arr)) return;
        var mapped = arr.map(function (x) {
          return { c: x.etf_code || x.code || x.sec_code || x.fund_code, n: x.etf_name || x.name || x.sec_name || x.fund_name };
        }).filter(function (x) { return x.c && /^\d{6}$/.test(String(x.c)); });
        if (mapped.length) done(mapped);
      }).catch(function () { });
    }
  }

  function add(code, nm) {
    code = String(code).trim();
    if (!/^\d{6}$/.test(code)) return;
    if (S.pool.indexOf(code) >= 0) return;
    if (S.pool.length >= 50) { S.err = '最多 50 只'; return; }
    S.pool.push(code);
    if (nm && window.LABDATA) LABDATA.names[code] = nm;
    S.err = ''; savePool(); paint();
  }

  function del(code) { S.pool = S.pool.filter(function (c) { return c !== code; }); savePool(); paint(); }

  function setMethod(k) { S.m = k; S.res = null; paint(); }

  function localCompute() {
    var m = method(), rows = [], srcNote = '本地';
    var date = (S.date || '').slice(0, 10).replace(/-/g, '');
    var all = window.OFFMOM_ALL || {};
    for (var i = 0; i < S.pool.length; i++) {
      var code = S.pool[i], v = null, series = null;
      var off = all[m.k] && all[m.k][code];
      if (off && S.n === 25) { v = off.v; series = off.h.map(function (x) { return x[1]; }).concat([off.t[1]]); srcNote = '官方内置'; }
      else {
        var data = LABDATA ? LABDATA.dataFor(code, date, m.src) : null;
        if (data) {
          var r = MOM.calc(m.k, data, { n: S.n });
          if (r) { v = r.score; series = data[m.src === 'intraday' ? 'intraday' : 'close']; }
        }
      }
      rows.push({ c: code, n: nameOf(code), v: v, ser: series });
    }
    rows.sort(function (a, b) { return (b.v == null ? -99 : b.v) - (a.v == null ? -99 : a.v); });
    return { rows: rows, n: S.n, label: m.n, src: srcNote };
  }

  function calc() {
    var m = method(), st = state();
    st.busy = true; st.err = ''; st.res = null; paint();
    var dt = (st.date || nowLocal()).split('T');
    var body = {
      momentum_calculation_type: m.k, momentum_period: +st.n, etf_pool: st.pool.slice(),
      end_date: dt[0], end_time: (dt[1] ? dt[1] + ':00' : st.time + ':00')
    };
    var fallback = function (msg) {
      st.busy = false; st.src = '本地复算';
      st.res = localCompute();
      if (msg) st.err = msg;
      paint();
    };
    if (location.protocol.indexOf('http') !== 0) return fallback('');
    fetch('/api/momentum', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (!j || j.code !== 0 || !j.data) return fallback((j && j.message) || '接口返回异常');
        var rows = (j.data.etf_momentum_data || []).map(function (x) {
          var s = x.calculation_series || {};
          var ser = (s.history || []).map(function (h) { return h.price; }).concat([(s.target || {}).price]);
          return { c: x.etf_code, n: x.etf_name, v: x.momentum_value / 10000.0, ser: ser, raw: s };
        });
        st.busy = false; st.src = '官方'; st.err = '';
        st.res = { rows: rows, n: j.data.momentum_period || +st.n, label: m.n };
        paint();
      }).catch(function () { fallback('接口不可达'); });
  }

  function detail(i) {
    var r = state().res.rows[i], m = method();
    document.getElementById('labMTitle').textContent = '动量计算过程：' + r.n + '(' + r.c + ')';
    var body = '<div class="labmnote">' + m.n + '｜' + state().res.n + ' 天｜' + esc(state().src) + '</div>';
    if (r.ser && r.ser.length) {
      var w = 1, y = r.ser.map(function (x) { return x > 0 ? Math.log(x) : null; });
      body += '<div class="tablewrap"><table class="tbl"><thead><tr><th>#</th><th>价格</th><th>ln(P)</th><th>权重 w</th></tr></thead><tbody>';
      for (var k = 0; k < r.ser.length; k++) {
        body += '<tr><td class="num">' + (k + 1) + '</td><td class="num">' + (+r.ser[k]).toFixed(4) + '</td><td class="num">' + (y[k] == null ? '—' : y[k].toFixed(6)) + '</td><td class="num">' + (1 + k / (r.ser.length - 1)).toFixed(4) + '</td></tr>';
      }
      body += '</tbody></table></div>';
      var c = MOM.calc(m.k, { close: r.ser, intraday: r.ser }, { n: r.ser.length });
      if (c) body += '<div class="labstats"><span>得分 <b>' + c.score.toFixed(4) + '</b></span>' +
        '<span>年化 <b>' + (c.annual * 100).toFixed(2) + '%</b></span>' +
        '<span>R² <b>' + (c.r2 == null ? '—' : (c.r2 * 100).toFixed(2) + '%') + '</b></span>' +
        '<span>斜率 <b>' + (c.slope == null ? '—' : c.slope.toExponential(4)) + '</b></span></div>';
    } else body += '<div class="labmnote">该标的没有可用的计算序列</div>';
    document.getElementById('labMBody').innerHTML = body;
    document.getElementById('labMask').classList.add('on');
  }

  function init() {
    bindSug();
    if (window.__labBound) return;
    window.__labBound = 1;
    document.addEventListener('click', function (e) {
      var t = e.target.closest('[data-act]');
      if (!t) return;
      var act = t.getAttribute('data-act');
      if (act === 'method') { e.preventDefault(); setMethod(t.getAttribute('data-k')); }
      else if (act === 'del') { e.preventDefault(); del(t.getAttribute('data-c')); }
      else if (act === 'add') { e.preventDefault(); add(t.getAttribute('data-c'), t.getAttribute('data-n')); var inp = document.getElementById('labSearch'); if (inp) inp.value = ''; var sg = document.getElementById('labSug'); if (sg) sg.innerHTML = ''; }
      else if (act === 'clear') { e.preventDefault(); S.pool = []; savePool(); paint(); }
      else if (act === 'minus') { e.preventDefault(); S.n = Math.max(3, +S.n - 1); paint(); }
      else if (act === 'plus') { e.preventDefault(); S.n = Math.min(120, +S.n + 1); paint(); }
      else if (act === 'calc') { e.preventDefault(); calc(); }
      else if (act === 'detail') { e.preventDefault(); detail(+t.getAttribute('data-i')); }
      else if (act === 'close') { e.preventDefault(); document.getElementById('labMask').classList.remove('on'); }
      else if (act === 'help') { e.preventDefault(); location.hash = ''; alert('9 种算法：区间涨幅、RSRS、斜率、加权斜率、区间涨幅(分时版)、斜率(分时版)、加权斜率(分时版)、加权斜率-V2、加权斜率(分时版)-V2。\n得分 = 年化收益 × R²（RSRS 为 Z-Score）；年化 = exp(slope×250)-1；权重 1→2 线性递增。'); }
    });
    document.addEventListener('change', function (e) {
      var id = e.target.id;
      if (id === 'labN') { S.n = Math.max(3, Math.min(120, +e.target.value || 25)); }
      else if (id === 'labDate') { S.date = e.target.value; }
      else if (id === 'labTime') { S.time = e.target.value; }
      else if (id === 'labSearch') { }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id === 'labN') S.n = Math.max(3, Math.min(120, +e.target.value || 25));
    });
  }

  return { card: card, init: init, state: state, METHODS: METHODS };
})();
