const fs = require('fs'), vm = require('vm');
['G:/AI_DEMO/纯粹策略/workbench-v2/assets/snapdata.js',
 'G:/AI_DEMO/纯粹策略/workbench-v2/assets/official_sync.js'].forEach(function (f) {
  const code = fs.readFileSync(f, 'utf8');
  const ctx = { window: {}, console: console };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const S = ctx.window.SNAP;
  console.log('### ' + f.split('/').pop() + ' gen=' + S.gen + ' keys=' + Object.keys(S.s).join(','));
  Object.keys(S.s).forEach(function (k) {
    const d = S.s[k], o = {};
    for (const f2 in d) {
      const v = d[f2];
      if (Array.isArray(v)) o[f2] = 'arr[' + v.length + ']';
      else if (v && typeof v === 'object') o[f2] = JSON.stringify(v).slice(0, 240);
      else o[f2] = v;
    }
    console.log(k + ' :: ' + JSON.stringify(o));
  });
});
