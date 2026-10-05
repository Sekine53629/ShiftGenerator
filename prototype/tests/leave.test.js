// 有休の計算（社員マスタで「有休管理」をオンにした人）を確かめる。
//   入社6か月で最初の付与、以降1年ごと。日数は労働基準法の表（週4日以下は比例付与）。
//   付与日から2年で失効。使った有休は古い付与から順に引く。
//
//   node prototype/tests/leave.test.js
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(n) {
  const at = src.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('見つからない: ' + n);
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
}
const api = new Function([
  ['leaveTable_', 'addMonthsYmd_', 'normYmd_', 'leaveGrants_', 'leaveLedger_'].map(grab).join('\n'),
  'return { leaveTable_, addMonthsYmd_, normYmd_, leaveGrants_, leaveLedger_ };'
].join('\n'))();
const plain = v => JSON.parse(JSON.stringify(v));

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};

console.log('■ 日付');
ok('6か月後。月末は月末で止める', () => {
  assert.strictEqual(api.addMonthsYmd_('2024-04-01', 6), '2024-10-01');
  assert.strictEqual(api.addMonthsYmd_('2024-08-31', 6), '2025-02-28');
  assert.strictEqual(api.addMonthsYmd_('2023-08-31', 6), '2024-02-29');   // うるう年
});
ok('入社日の書き方はゆるく読む', () => {
  assert.strictEqual(api.normYmd_('2024/4/1'), '2024-04-01');
  assert.strictEqual(api.normYmd_('2024-04-01'), '2024-04-01');
  assert.strictEqual(api.normYmd_('2024年4月1日'), '2024-04-01');
  assert.strictEqual(api.normYmd_('4/1'), '');
});

console.log('■ 付与');
ok('週5日: 10 → 11 → 12 → 14 → 16 → 18 → 20、以降 20', () => {
  // 2018-04-01 入社なら 2018-10 から 2026-10 まで 9 回の付与
  const g = api.leaveGrants_('2018-04-01', 5, '2026-12-31');
  assert.deepStrictEqual(plain(g.map(x => x.days)), [10, 11, 12, 14, 16, 18, 20, 20, 20]);
  assert.strictEqual(g[0].date, '2018-10-01');
  assert.strictEqual(g[1].date, '2019-10-01');
});
ok('週4日以下は比例付与（週4: 7・8・9 / 週3: 5・6・6 / 週2: 3・4・4 / 週1: 1・2・2）', () => {
  const days = w => plain(api.leaveGrants_('2023-04-01', w, '2026-12-31').map(x => x.days));
  assert.deepStrictEqual(days(4), [7, 8, 9, 10]);
  assert.deepStrictEqual(days(3), [5, 6, 6, 8]);
  assert.deepStrictEqual(days(2), [3, 4, 4, 5]);
  assert.deepStrictEqual(days(1), [1, 2, 2, 2]);
});
ok('入社6か月までは付与なし', () => {
  assert.deepStrictEqual(plain(api.leaveGrants_('2026-06-01', 5, '2026-11-30')), []);
});
ok('失効日は付与日の2年後', () => {
  const g = api.leaveGrants_('2024-04-01', 5, '2026-12-31');
  assert.strictEqual(g[0].expires, '2026-10-01');
});

console.log('■ 台帳（古い付与から引く・2年で失効）');
const G = api.leaveGrants_('2024-04-01', 5, '2026-12-31');
// 付与: 2024-10-01 10日（〜2026-10-01） / 2025-10-01 11日（〜2027-10-01） / 2026-10-01 12日
ok('古い付与から引く', () => {
  const lg = api.leaveLedger_(G, {}, ['2025-11-10', '2025-11-11', '2025-11-12']);
  assert.strictEqual(lg.grants[0].used, 3);
  assert.strictEqual(lg.grants[1].used, 0);
  assert.deepStrictEqual(plain(lg.short), []);
});
ok('記録の前に使ったぶん（取得済み）を先に引く', () => {
  const lg = api.leaveLedger_(G, { '2024-10-01': 9 }, ['2025-11-10', '2025-11-11']);
  assert.strictEqual(lg.grants[0].used, 10);     // 9 ＋ 1
  assert.strictEqual(lg.grants[1].used, 1);      // 残りは次の付与から
});
ok('失効した付与からは引かない', () => {
  // 2024-10-01 付与は 2026-10-01 から使えない。2026-10-05 の有休は 2025-10-01 付与から引く
  const lg = api.leaveLedger_(G, {}, ['2026-10-05']);
  assert.strictEqual(lg.grants[0].used, 0);
  assert.strictEqual(lg.grants[1].used, 1);
});
ok('付与の前の日の有休は引けない（足りない日として出す）', () => {
  const lg = api.leaveLedger_(G, {}, ['2024-09-30']);
  assert.deepStrictEqual(plain(lg.short), ['2024-09-30']);
});
ok('使い切ったら足りない日として出す', () => {
  const uses = [];
  for (let d = 1; d <= 11; d++) uses.push('2025-03-' + String(d).padStart(2, '0'));   // 10日しか無い時期に11日
  const lg = api.leaveLedger_(G, {}, uses);
  assert.strictEqual(lg.grants[0].left, 0);
  assert.deepStrictEqual(plain(lg.short), ['2025-03-11']);
});

console.log(fail ? ('■ ' + fail + ' 件 NG') : '■ すべて OK');
process.exit(fail ? 1 : 0);
