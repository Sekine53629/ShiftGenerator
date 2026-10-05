// チェック（表の下に出す点検）のうち、数だけで決まるものを確かめる。
//   週の出勤 5日以内 / 連続出勤 5日以内（前月末からの続きも数える）/
//   薬剤師の早番 1人以上 / 薬剤師の遅番 2〜3人
//
//   node prototype/tests/checks.test.js
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
  'let DB = { rules: {} };',
  grab('checkLimits_'), grab('staffCheck_'), grab('dayCheck_'), grab('symbolHands_'), grab('rotateRank_'), grab('moveStaff_'), grab('defaultYm_'), grab('moveInGroup_'), grab('addToGroup_'),
  'return { staffCheck_, dayCheck_, checkLimits_, symbolHands_, rotateRank_, moveStaff_, defaultYm_, moveInGroup_, addToGroup_,',
  '  setRules: r => { DB.rules = r; }, setStaff: l => { DB.staff = l; }, staff: () => DB.staff };'
].join('\n'))();

const LIM = { weekMax: 5, consMax: 5, earlyMin: 1, lateMin: 2, lateMax: 3, handTol: 1 };
// 2026年11月（1日が日曜）。日曜始まりの週の番号
const WEEK = Array.from({ length: 30 }, (_, i) => Math.floor(i / 7));
const W = s => s.split('').map(ch => ch === '1');   // '1' が出勤

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};

console.log('■ 既定値');
ok('週5日・連勤5日・早番1人以上・遅番2〜3人', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(api.checkLimits_())), LIM);
});
ok('設定で変えられる', () => {
  api.setRules({ checkWeekMax: 4, checkConsMax: 4, checkLateMax: 4 });
  const l = api.checkLimits_();
  api.setRules({});
  assert.strictEqual(l.weekMax, 4);
  assert.strictEqual(l.consMax, 4);
  assert.strictEqual(l.lateMax, 4);
});

console.log('■ 週の出勤');
ok('週5日は通る', () => {
  //            日月火水木金土
  const work = W('0111110' + '1110110' + '0111110' + '1101110' + '00');
  assert.deepStrictEqual(api.staffCheck_(work, WEEK, 0, 0, LIM), []);
});
ok('週6日は引っかかる', () => {
  const work = W('0111111' + '0000000' + '0000000' + '0000000' + '00');
  const m = api.staffCheck_(work, WEEK, 0, 0, LIM);
  assert.ok(m.some(t => t.indexOf('第1週の出勤が 6 日') >= 0), JSON.stringify(m));
});
ok('先頭の週は前月ぶんも数える', () => {
  const work = W('1110000' + '0000000' + '0000000' + '0000000' + '00');
  assert.deepStrictEqual(api.staffCheck_(work, WEEK, 2, 0, LIM), []);
  const m = api.staffCheck_(work, WEEK, 3, 0, LIM);
  assert.ok(m.some(t => t.indexOf('前月 3 日を含む') >= 0), JSON.stringify(m));
});

console.log('■ 連続出勤');
ok('5連勤は通る', () => {
  const work = W('0111110' + '0000000' + '0000000' + '0000000' + '00');
  assert.deepStrictEqual(api.staffCheck_(work, WEEK, 0, 0, LIM), []);
});
ok('週をまたぐ6連勤は引っかかる（週はどちらも5日以内）', () => {
  //            日月火水木金土   日月火水木金土
  const work = W('0001111' + '1100000' + '0000000' + '0000000' + '00');
  const m = api.staffCheck_(work, WEEK, 0, 0, LIM);
  assert.ok(m.some(t => t.indexOf('連続出勤が 6 日') >= 0), JSON.stringify(m));
  assert.ok(!m.some(t => t.indexOf('週の出勤') >= 0), JSON.stringify(m));
});
ok('前月末から続く連勤も数える', () => {
  const work = W('1110000' + '0000000' + '0000000' + '0000000' + '00');
  const m = api.staffCheck_(work, WEEK, 0, 3, LIM);
  assert.ok(m.some(t => t.indexOf('連続出勤が 6 日（前月末から 3 日を含む）') >= 0), JSON.stringify(m));
});

console.log('■ 早番と遅番（薬剤師）');
ok('○▲●▲● は通る（早番1・遅番2）', () => {
  assert.deepStrictEqual(api.dayCheck_(['○', '▲', '●', '▲', '●'], '○', '▲', LIM), []);
});
ok('早番がいない日は引っかかる', () => {
  const m = api.dayCheck_(['●', '▲', '▲'], '○', '▲', LIM);
  assert.ok(m.some(t => t.indexOf('○ が 0 人') >= 0), JSON.stringify(m));
});
ok('遅番が1人の日は引っかかる', () => {
  const m = api.dayCheck_(['○', '▲', '●'], '○', '▲', LIM);
  assert.ok(m.some(t => t.indexOf('▲ が 1 人') >= 0), JSON.stringify(m));
});
ok('遅番が4人の日は引っかかる', () => {
  const m = api.dayCheck_(['○', '▲', '▲', '▲', '▲'], '○', '▲', LIM);
  assert.ok(m.some(t => t.indexOf('▲ が 4 人') >= 0), JSON.stringify(m));
});
ok('誰も出ていない日（休業）は何も言わない', () => {
  assert.deepStrictEqual(api.dayCheck_([], '○', '▲', LIM), []);
});

console.log('■ 持ち札（symbolHands_）');
const sum = a => a.reduce((x, v) => x + v, 0);
ok('各自の合計は出勤日数、記号ごとの合計は月の枠', () => {
  // 5人。出勤 21/21/20/17/21 日。月の枠 ○25 ●25 ▲50（＝100）
  const workN = [21, 21, 20, 17, 21];
  const totals = [25, 25, 50];
  const can = workN.map(() => [true, true, true]);
  const h = api.symbolHands_(workN, totals, can);
  h.forEach((row, i) => assert.strictEqual(sum(row), workN[i], i + ' 人目の合計'));
  [0, 1, 2].forEach(k => assert.strictEqual(sum(h.map(r => r[k])), totals[k], k + ' 番目の記号の合計'));
});
ok('出勤日数に比例する（差は1回まで）', () => {
  const workN = [21, 21, 20, 17, 21];
  const totals = [25, 25, 50];
  const h = api.symbolHands_(workN, totals, workN.map(() => [true, true, true]));
  const W = sum(workN);
  h.forEach((row, i) => row.forEach((v, k) => {
    const ideal = workN[i] * totals[k] / W;
    assert.ok(Math.abs(v - ideal) < 1, i + '人目 ' + k + ': ' + v + ' / 理想 ' + ideal.toFixed(2));
  }));
});
ok('同じ出勤日数の人は、早番の持ち札が1回以内で揃う', () => {
  const h = api.symbolHands_([20, 20, 20, 20], [21, 19, 40], [0, 1, 2, 3].map(() => [true, true, true]));
  const e = h.map(r => r[0]);
  assert.ok(Math.max.apply(null, e) - Math.min.apply(null, e) <= 1, JSON.stringify(e));
});
ok('使えない記号の持ち札は0。そのぶんは使える人へ回る', () => {
  // 3人目は遅番ができない
  const workN = [20, 20, 20];
  const totals = [15, 15, 30];
  const can = [[true, true, true], [true, true, true], [true, true, false]];
  const h = api.symbolHands_(workN, totals, can);
  assert.strictEqual(h[2][2], 0);
  h.forEach((row, i) => assert.strictEqual(sum(row), workN[i]));
  [0, 1, 2].forEach(k => assert.strictEqual(sum(h.map(r => r[k])), totals[k]));
});

ok('早番の札は開局日ぶんを、早番ができる人だけに先に配る', () => {
  // 4人・各20日。早番の枠 30（開局日 30 日ぶん）。2人目は早番をしない（使える記号に ○ が無い）
  const workN = [20, 20, 20, 20];
  const totals = [30, 20, 30];
  const can = [[true, true, true], [false, true, true], [true, true, true], [true, true, true]];
  const h = api.symbolHands_(workN, totals, can);
  assert.strictEqual(h[1][0], 0, '早番をしない人に早番の札');
  assert.strictEqual(sum(h.map(r => r[0])), 30, '早番の札が開局日ぶんでない');
  [0, 2, 3].forEach(i => assert.ok(h[i][0] === 10, i + '人目の早番 ' + h[i][0] + '（30 ÷ 3人 = 10）'));
  h.forEach((row, i) => assert.strictEqual(sum(row), workN[i], i + '人目の合計'));
});
ok('早番しかできない人は、出勤日数ぶん全部が早番', () => {
  const workN = [10, 20, 20];
  const totals = [20, 10, 20];
  const can = [[true, false, false], [true, true, true], [true, true, true]];
  const h = api.symbolHands_(workN, totals, can);
  assert.deepStrictEqual(h[0], [10, 0, 0]);
  assert.strictEqual(sum(h.map(r => r[0])), 20);
});

console.log('■ 起点の順番（月ごとにずらす）');
ok('（年×12＋月）を人数で割った余りの番号の人が先頭。余り 0 は最後の人', () => {
  // 5人。2026年11月 → 2026×12＋11 = 24323、÷5 の余り 3 → 3番の人（位置 2）が先頭
  const r = api.rotateRank_(5, 2026 * 12 + 11);
  assert.strictEqual(r.indexOf(0), 2);
  // 2026年12月 → 余り 4 → 4番の人（位置 3）。2027年1月 → 余り 0 → 5番の人（位置 4）
  assert.strictEqual(api.rotateRank_(5, 2026 * 12 + 12).indexOf(0), 3);
  assert.strictEqual(api.rotateRank_(5, 2027 * 12 + 1).indexOf(0), 4);
  // 2027年2月 → 余り 1 → 1番の人（位置 0）。年をまたいでも 1 ずつ進む
  assert.strictEqual(api.rotateRank_(5, 2027 * 12 + 2).indexOf(0), 0);
});
ok('先頭の次は並び順に続く（最後の人の次は1番）', () => {
  assert.deepStrictEqual(api.rotateRank_(5, 2026 * 12 + 11), [3, 4, 0, 1, 2]);
});
ok('同じ出勤日数なら、余りの早番はその月の先頭の人に行く', () => {
  // 4人・各20日。早番の枠 21 → 1人だけ 6、ほかは 5
  const workN = [20, 20, 20, 20];
  const totals = [21, 19, 40];
  const can = workN.map(() => [true, true, true]);
  const who = order => api.symbolHands_(workN, totals, can, order).findIndex(r => r[0] === 6);
  assert.strictEqual(who([0, 1, 2, 3]), 0);
  assert.strictEqual(who([2, 3, 0, 1]), 2);
  assert.strictEqual(who([1, 2, 3, 0]), 3);
});

console.log('■ 社員の並べ替え（moveStaff_）');
ok('同じ区分の中で入れ替わる（間の事務員は飛ばす）', () => {
  const P = (id, kind, emp) => ({ id, kind, employment: emp || '社員' });
  api.setStaff([P('a', '薬剤師'), P('x', '事務員'), P('b', '薬剤師'), P('d', '薬剤師', '派遣'), P('c', '薬剤師')]);
  const ids = () => api.staff().map(s => s.id).join('');
  assert.ok(api.moveStaff_(api.staff()[2], -1));          // b を上へ → a と入れ替わる
  assert.strictEqual(ids(), 'bxadc');
  assert.ok(api.moveStaff_(api.staff()[2], 1));           // a を下へ → 派遣の d を飛ばして c と
  assert.strictEqual(ids(), 'bxcda');
  assert.ok(!api.moveStaff_(api.staff()[0], -1));         // いちばん上はそれ以上上がらない
  assert.ok(!api.moveStaff_(api.staff()[1], 1));          // 事務員は1人だけ。動かない
});

console.log('■ 区分の中でドラッグ（moveInGroup_）・区分の最後に追加（addToGroup_）');
{
  const P = (id, kind, emp) => ({ id, kind, employment: emp || '社員' });
  const isPharm = s => s.kind !== '事務員' && s.employment !== '派遣';
  const ids = l => l.map(s => s.id).join('');
  ok('薬剤師の中で動かしても、事務員と派遣の位置は動かない', () => {
    const l = [P('a', '薬剤師'), P('x', '事務員'), P('b', '薬剤師'), P('d', '薬剤師', '派遣'), P('c', '薬剤師')];
    // c を a の前へ
    assert.ok(api.moveInGroup_(l, isPharm, l[4], l[0], false));
    assert.strictEqual(ids(l), 'cxadb');
    // c を b の後ろへ（いちばん下）
    assert.ok(api.moveInGroup_(l, isPharm, l[0], l[4], true));
    assert.strictEqual(ids(l), 'axbdc');
  });
  ok('ほかの区分の人の上には落とせない', () => {
    const l = [P('a', '薬剤師'), P('x', '事務員')];
    assert.ok(!api.moveInGroup_(l, isPharm, l[0], l[1], false));
    assert.strictEqual(ids(l), 'ax');
  });
  ok('同じ場所に落としたら動かない', () => {
    const l = [P('a', '薬剤師'), P('b', '薬剤師')];
    assert.ok(!api.moveInGroup_(l, isPharm, l[0], l[1], false));   // a を b の前 ＝ いまのまま
  });
  ok('追加は区分の最後に入る（下から持ち上げなくてよい）', () => {
    const l = [P('a', '薬剤師'), P('b', '薬剤師'), P('x', '事務員'), P('y', '事務員')];
    api.addToGroup_(l, isPharm, P('n', '薬剤師'));
    assert.strictEqual(ids(l), 'abnxy');
    api.addToGroup_(l, s => s.employment === '派遣', P('d', '薬剤師', '派遣'));   // 区分の人がいなければ最後
    assert.strictEqual(ids(l), 'abnxyd');
  });
}

console.log('■ 起動したときに開く月（defaultYm_）');
const TODAY = new Date(2026, 9, 5);       // 2026年10月5日
ok('確定が無ければ今日の翌月', () => {
  assert.deepStrictEqual(api.defaultYm_({}, 'st1', TODAY), [2026, 11]);
  assert.deepStrictEqual(api.defaultYm_({}, 'st1', new Date(2026, 11, 20)), [2027, 1]);
});
ok('その店舗でいちばん新しい確定月の翌月', () => {
  const fin = { 'st1|2026-10': 't', 'st1|2026-11': 't', 'st2|2027-03': 't' };
  assert.deepStrictEqual(api.defaultYm_(fin, 'st1', TODAY), [2026, 12]);
  assert.deepStrictEqual(api.defaultYm_(fin, 'st2', TODAY), [2027, 4]);
});
ok('12月を確定したら翌年1月', () => {
  assert.deepStrictEqual(api.defaultYm_({ 'st1|2026-12': 't' }, 'st1', TODAY), [2027, 1]);
});
ok('前の月を確定し直しても、新しい確定月のほうが効く', () => {
  const fin = { 'st1|2026-12': 't', 'st1|2026-09': 't' };
  assert.deepStrictEqual(api.defaultYm_(fin, 'st1', TODAY), [2027, 1]);
});
ok('確定を取り消した月は数えない', () => {
  assert.deepStrictEqual(api.defaultYm_({ 'st1|2026-12': '' }, 'st1', TODAY), [2026, 11]);
});

console.log(fail ? ('■ ' + fail + ' 件 NG') : '■ すべて OK');
process.exit(fail ? 1 : 0);
