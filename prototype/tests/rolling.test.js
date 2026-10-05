// 年末年始のローリング（休業日の仕事量を前後の営業日に振り分ける）を確かめる。
//
// 祝日マスタの初期値（年末年始休業 12/30〜1/3）から、buildDays が
// 12/30〜1/1 の3日ぶんを前の3日（12/27〜29）へ、1/2〜1/3 の2日ぶんを後ろの2日（1/4・1/5）へ
// 1日ぶんずつ振り分けるか。月をまたぐので、12月と1月の両方から見る。
//
//   node prototype/tests/rolling.test.js
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
const L = t => src.split(/\r?\n/).find(l => l.includes(t));
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);
const RULE = src.slice(src.indexOf('const RULE_NORMAL'),
  src.indexOf(';', src.indexOf('const usesQuota')) + 1);

const api = new Function([
  'const DAY_COLS = 31;',
  'const DOW = ["日","月","火","水","木","金","土"];',
  RULE, DOC_BLOCK, MIG_BLOCK,
  L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  ['seedDb', 'normDow_', 'syncDemand_', 'migrateDb_', 'nthMonday', 'holidaysOf', 'parseMonthDay',
    'daysOfRangeInMonth', 'closureMap', 'holidayInfoOf', 'storeRows', 'hoursOf',
    'buildDays', 'addRollShares_'].map(grab).join('\n'),
  'let DB = migrateDb_(seedDb()); const activeStore = "st1";',
  // 実物の店に合わせて毎日営業にする
  'DB.hours.forEach(h => { h.open = true; });',
  'return { DB, buildDays, migrateDb_, seedDb };'
].join('\n'))();

const sharesOf = (y, m) => {
  const out = {};
  api.buildDays(y, m).forEach(d => { if (d.inMonth && d.rollShare) out[d.day] = d.rollShare; });
  return out;
};
const closedOf = (y, m) => api.buildDays(y, m).filter(d => d.inMonth && !d.open).map(d => d.day);

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};

console.log('■ 祝日マスタの初期値');
ok('年末年始休業は 12/30〜1/3（12/29 は開ける）', () => {
  assert.deepStrictEqual(closedOf(2026, 12), [30, 31]);
  assert.deepStrictEqual(closedOf(2027, 1), [1, 2, 3]);
});
ok('前の版の初期値（12/29〜1/3）は 12/30〜1/3 に直る', () => {
  const db = api.seedDb();
  db.holidays[0].from = '12/29';
  const fixed = api.migrateDb_(db);
  assert.strictEqual(fixed.holidays[0].from, '12/30');
});
ok('利用者が書き換えた行は直さない', () => {
  const db = api.seedDb();
  db.holidays[0].from = '12/29';
  db.holidays[0].memo = '本社の指示で 12/29 から';
  const fixed = api.migrateDb_(db);
  assert.strictEqual(fixed.holidays[0].from, '12/29');
});

console.log('■ 事務員と派遣薬剤師は、はじめは手動（版 3）');
ok('初期データの事務員と派遣は手動、社員薬剤師は自動', () => {
  const db = api.seedDb();
  db.staff.forEach(x => {
    const manual = x.kind === '事務員' || x.employment === '派遣';
    if (manual) assert.strictEqual(x.rule, '手動', x.name);
    else assert.notStrictEqual(x.rule, '手動', x.name);
  });
});
ok('前の版の保存データは、事務員と派遣を一度だけ手動に切り替える', () => {
  const db = api.seedDb();
  db.schemaVersion = 2;
  db.staff.forEach(x => { x.rule = '通常'; });
  const fixed = api.migrateDb_(db);
  fixed.staff.forEach(x => {
    const manual = x.kind === '事務員' || x.employment === '派遣';
    assert.strictEqual(x.rule, manual ? '手動' : '通常', x.name);
  });
});
ok('切り替えたあとに自動へ戻した人は、もう触らない', () => {
  const db = api.migrateDb_(api.seedDb());
  const clerk = db.staff.find(x => x.kind === '事務員');
  clerk.rule = '通常';                     // 利用者が自動に戻した
  const again = api.migrateDb_(JSON.parse(JSON.stringify(db)));
  assert.strictEqual(again.staff.find(x => x.id === clerk.id).rule, '通常');
});

console.log('■ 振り分け');
ok('12月: 12/30〜1/1 の3日ぶんが 27・28・29日へ1日ずつ', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2026, 12))), { 27: 1, 28: 1, 29: 1 });
});
ok('1月: 1/2〜1/3 の2日ぶんが 4・5日へ1日ずつ', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2027, 1))), { 4: 1, 5: 1 });
});
ok('ふだんの月は振り分けが無い', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2026, 11))), {});
});
ok('1日だけの休業は振り分けない（rollMinClosed 2）', () => {
  api.DB.closures = [{ id: 'x', storeId: 'st1', label: '棚卸', kind: '休業', from: '11/11', to: '11/11' }];
  try {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2026, 11))), {});
  } finally { api.DB.closures = []; }
});
ok('前後の日数を設定で変えられる（前2日・後ろ3日）', () => {
  const keep = [api.DB.rules.rollBefore, api.DB.rules.rollAfter];
  api.DB.rules.rollBefore = 2; api.DB.rules.rollAfter = 3;
  try {
    // 5日を 2:3 に分ける → 12/30・12/31 の2日ぶんを 28・29日へ、1/1〜1/3 の3日ぶんを 1/4〜1/6 へ
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2026, 12))), { 28: 1, 29: 1 });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(sharesOf(2027, 1))), { 4: 1, 5: 1, 6: 1 });
  } finally { api.DB.rules.rollBefore = keep[0]; api.DB.rules.rollAfter = keep[1]; }
});
ok('年間の公休ノルマの集計は振り分けの影響を受けない', () => {
  const a = api.buildDays(2026, 12, true).filter(d => d.inMonth && d.countsOff).length;
  const b = api.buildDays(2026, 12).filter(d => d.inMonth && d.countsOff).length;
  assert.strictEqual(a, b);
});

console.log(fail ? ('■ ' + fail + ' 件 NG') : '■ すべて OK');
process.exit(fail ? 1 : 0);
