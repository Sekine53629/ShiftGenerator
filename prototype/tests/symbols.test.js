// 早番・遅半・遅番の配り方を確かめる。
//
// これが無かったころは placeOneStaff_ が「その人の使える記号の1つ目」を
// 全日に使っており、全員が毎日 ○早番 になっていた。
//
//   node prototype/tests/symbols.test.js
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

/**
 * 配りの部分だけを動かす。表や日付の組み立ては要らないので、
 * 出勤する人が決まった状態を作って assignShiftSymbols_ に渡す。
 *
 * @param {Array<Array<string>>} pats 人ごとの使える記号
 * @param {Object} rules earlyN / midN / clerkEarlyN
 * @param {number} nDays 日数
 * @param {Array<number>} offOf 人ごとの休みの日（0始まり）
 * @param {Object} handOf 人ごとの、手で入れた記号 { 人: { 日: 記号 } }（0始まり）
 */
function run(pats, rules, nDays, offOf, handOf) {
  const api = new Function([
    'const DAY_COLS = ' + nDays + ';',
    'const PATS = ' + JSON.stringify(pats) + ';',
    'const OFF = ' + JSON.stringify(offOf || []) + ';',
    'const HAND = ' + JSON.stringify(handOf || {}) + ';',
    'const DB = { rules: ' + JSON.stringify(rules) + ', patterns: [',
    '  { sym: "○", start: "10:00", end: "19:00", work: true, order: 1 },',
    '  { sym: "●", start: "10:30", end: "19:30", work: true, order: 2 },',
    '  { sym: "▲", start: "11:00", end: "20:00", work: true, order: 3 },',
    '  { sym: "公休", work: false, order: 4 } ] };',
    'const byOrder = l => l.slice().sort((a,b) => (a.order||0)-(b.order||0));',
    'const isWork = v => ["○","●","▲"].indexOf(v) >= 0;',
    'const cells = new Map();',
    'const key = (r,c) => r.index + "|" + c;',
    'const get = (r,c) => cells.get(key(r,c)) || "";',
    'const setV = (r,c,v) => { if (v) cells.set(key(r,c), v); else cells.delete(key(r,c)); };',
    'const days = [];',
    'for (let c = 0; c < DAY_COLS; c++) days.push({ inMonth: true, open: true, day: c + 1, from: "10:00", to: "20:00" });',
    'const ROWS = PATS.map((p, i) => ({',
    '  kind: "staff", index: i, key: "s" + i, label: "s" + i,',
    '  role: p.role || "pharm",',
    '  staff: { patterns: p.syms } }));',
    // 休み以外は全部出勤にしておく
    'ROWS.forEach((r, i) => { for (let c = 0; c < DAY_COLS; c++) {',
    '  if ((OFF[i] || []).indexOf(c) >= 0) { setV(r, c, "公休"); continue; }',
    '  setV(r, c, "▲"); } });',
    // 手で入れた記号（自動生成は動かさない。印のあるセル）
    'const HANDSET = new Set();',
    'Object.keys(HAND).forEach(i => Object.keys(HAND[i]).forEach(c => {',
    '  setV(ROWS[i], Number(c), HAND[i][c]); HANDSET.add(i + "|" + c); }));',
    // 開局を覆えるだけの早番を置くので、時刻の読み取りも要る
    'const RULE_MANUAL = "手動"; const isHand = (r, c) => HANDSET.has(r.index + "|" + c);', grab('minOf_'), grab('staffSymbolSeq_'), grab('rotateRank_'), grab('priorityOf_'), grab('symbolHands_'), grab('pharmHands_'), grab('assignShiftSymbols_'),
    'assignShiftSymbols_(HANDSET);',
    'return { ROWS, get, days };',
  ].join('\n'))();

  const per = api.ROWS.map(r => {
    const c2 = {};
    const dayOf = {};
    for (let c = 0; c < nDays; c++) {
      const v = api.get(r, c);
      if (!['○', '●', '▲'].includes(v)) continue;
      c2[v] = (c2[v] || 0) + 1;
      (dayOf[v] = dayOf[v] || []).push(c);
    }
    return { label: r.label, syms: r.staff.patterns, count: c2, dayOf: dayOf };
  });
  const byDay = [];
  for (let c = 0; c < nDays; c++) {
    const d = {};
    api.ROWS.forEach(r => {
      const v = api.get(r, c);
      if (['○', '●', '▲'].includes(v)) d[v] = (d[v] || 0) + 1;
    });
    byDay.push(d);
  }
  return { per: per, byDay: byDay };
}

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};
const ALL = ['○', '●', '▲'];
const RULES = { earlyN: 1, midN: 1, clerkEarlyN: 1 };

console.log('■ 使える記号しか当てない');

ok('その人が使えない記号は出ない', () => {
  const r = run([{ syms: ['○', '●'] }, { syms: ['▲'] }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 28);
  r.per.forEach(p => {
    Object.keys(p.count).forEach(sym => {
      assert.ok(p.syms.indexOf(sym) >= 0,
        p.label + ' に使えない ' + sym + ' が当たっている');
    });
  });
});

ok('記号が1つだけの人は毎日それになる', () => {
  const r = run([{ syms: ['○'] }, { syms: ALL }, { syms: ALL }, { syms: ALL }],
    RULES, 28);
  assert.strictEqual(r.per[0].count['○'], 28);
  assert.strictEqual(Object.keys(r.per[0].count).length, 1);
});

console.log('■ 人の間で均等に配る');

ok('全員が同じ記号を使えるとき、早番の数がほぼ揃う', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  const n = r.per.map(p => p.count['○'] || 0);
  assert.ok(Math.max.apply(null, n) - Math.min.apply(null, n) <= 1,
    '早番の差が2以上ある: ' + JSON.stringify(n));
});

ok('遅番をやらない人は、遅番の分母から外れる', () => {
  // 5人のうち1人が遅番なし。残り4人で遅番を分ける
  const r = run([{ syms: ['○', '●'] }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  assert.strictEqual(r.per[0].count['▲'], undefined, '遅番なしの人に遅番が付いた');
  const n = r.per.slice(1).map(p => p.count['▲'] || 0);
  assert.ok(Math.max.apply(null, n) - Math.min.apply(null, n) <= 2,
    '残り4人の遅番が偏っている: ' + JSON.stringify(n));
});

ok('遅半の数も人の間で揃う', () => {
  // 5人なら 1日に遅半2人（○▲●▲●）。30日・5人なら1人12回が理想で、11〜13に収まればよい
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  const n = r.per.map(p => p.count['●'] || 0);
  assert.ok(Math.max.apply(null, n) - Math.min.apply(null, n) <= 2,
    '遅半の差が3以上ある: ' + JSON.stringify(n));
  const ideal = 30 * 2 / 5;
  n.forEach(x => assert.ok(Math.abs(x - ideal) <= 1,
    '理想の ' + ideal + ' 回から2回以上ずれている: ' + JSON.stringify(n)));
});

console.log('■ 手で入れた早番は、その人の持ち札から使う');

ok('手で ○ を入れた人がいても、早番の合計は出勤日数に比例する', () => {
  // 5人・30日・毎日5人（早番は1日1人）。1人目に手で ○ を4日入れる。
  // 外して数えると、1人目だけ 4 回上乗せになっていた（実データの11月で 2〜6回 にばらついた）
  const hand = { 0: { 0: '○', 7: '○', 14: '○', 21: '○' } };
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }], RULES, 30, [], hand);
  const n = r.per.map(p => p.count['○'] || 0);
  assert.ok(Math.max.apply(null, n) - Math.min.apply(null, n) <= 0, '早番の合計がそろっていない: ' + JSON.stringify(n));
  // 手で入れた4日はそのまま
  [0, 7, 14, 21].forEach(c => assert.ok(r.per[0].dayOf['○'].indexOf(c) >= 0, c + ' 日目の手入力が消えた'));
});

ok('手で ○ を持ち札より多く入れた人には、自動では早番を配らない', () => {
  // 持ち札は 30 ÷ 5 = 6。1人目に手で 8 日入れる → 自動の早番は 0
  const days8 = {};
  [0, 3, 6, 9, 12, 15, 18, 21].forEach(c => { days8[c] = '○'; });
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }], RULES, 30, [], { 0: days8 });
  assert.strictEqual(r.per[0].count['○'], 8, '手入力の 8 日のほかに早番が付いた');
});

console.log('■ 日の中で散らす');

ok('同じ人が早番を続けない', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  r.per.forEach(p => {
    const d = p.dayOf['○'] || [];
    for (let i = 1; i < d.length; i++) {
      assert.ok(d[i] - d[i - 1] > 1,
        p.label + ' が ' + d[i - 1] + ' と ' + d[i] + ' で続けて早番');
    }
  });
});

ok('早番の間隔がほぼ一定になる', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  const d = r.per[0].dayOf['○'] || [];
  assert.ok(d.length >= 4, '早番が少なすぎて確かめられない');
  const gaps = d.slice(1).map((x, i) => x - d[i]);
  assert.ok(Math.max.apply(null, gaps) - Math.min.apply(null, gaps) <= 2,
    '間隔がばらついている: ' + JSON.stringify(gaps));
});

console.log('■ 1日の必要数を守る');

ok('早番は1日1人（使える人がいる限り）', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  r.byDay.forEach((d, c) => {
    assert.strictEqual(d['○'] || 0, 1, (c + 1) + '日目の早番が ' + (d['○'] || 0) + ' 人');
  });
});

ok('遅番ができない人がいても、早番の定員は広がらない', () => {
  // 遅番なしが2人。この人たちは早番か遅半に入るしかない
  const r = run([{ syms: ['○', '●'] }, { syms: ['○', '●'] }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  const over = r.byDay.filter(d => (d['○'] || 0) > 1).length;
  assert.strictEqual(over, 0, '早番が2人以上の日が ' + over + ' 日');
});

ok('5人の日は 早番1・遅番2・遅半2（○▲●▲●）', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30);
  r.byDay.forEach((d, c) => {
    assert.strictEqual((d['○'] || 0) + (d['●'] || 0) + (d['▲'] || 0), 5,
      (c + 1) + '日目の合計が5人でない');
    assert.strictEqual(d['○'] || 0, 1, (c + 1) + '日目の早番が1人でない');
    assert.strictEqual(d['▲'] || 0, 2, (c + 1) + '日目の遅番が2人でない');
    assert.strictEqual(d['●'] || 0, 2, (c + 1) + '日目の遅半が2人でない');
  });
});

console.log('■ 休みの人には当てない');

ok('公休の日は記号を置き換えない', () => {
  const off = [[0, 1, 2], [], [], [], []];
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }], RULES, 30, off);
  const d = r.per[0].dayOf;
  ALL.forEach(sym => {
    (d[sym] || []).forEach(c => {
      assert.ok(c > 2, '休みの ' + c + ' 日目に ' + sym + ' が付いた');
    });
  });
});

console.log('■ 早番は開局の1人だけ（遅半のほうが優先）');

// 早番に要るのは開局を覆う1人だけ。それ以上増やす理由が無い。
// 実物も R8.8月で ○40 / ●47 / ▲120 と、早番がいちばん少ない。
//
// 以前は minOnDuty（同時にいてほしい薬剤師）をそのまま早番の人数にしていた。
// 既定の2人が毎日早番に入り、遅半より多くなっていた。

ok('minOnDuty を上げても、早番は1人のまま', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 1, minOnDuty: 3 }, 20);
  r.byDay.forEach((d, c) => {
    assert.strictEqual(d['○'] || 0, 1,
      (c + 1) + '日目の早番が ' + (d['○'] || 0) + ' 人。minOnDuty を人数にしている');
  });
});

ok('3人の日は earlyN を増やしても 早番1・遅番2（○▲▲）', () => {
  // 薬剤師の記号は人数で決まる。earlyN は薬剤師には効かない
  const off = [[], [], [], [0], [0]];
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 3, midN: 1, minOnDuty: 2 }, 10, off);
  assert.strictEqual(r.byDay[0]['○'] || 0, 1, '早番が1人でない');
  assert.strictEqual(r.byDay[0]['▲'] || 0, 2, '遅番が2人でない');
  assert.strictEqual(r.byDay[0]['●'] || 0, 0, '遅半がいる');
});

ok('早番は0人にしない（開局に誰もいない日を作らない）', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 0, midN: 3, minOnDuty: 1 }, 20);
  r.byDay.forEach((d, c) => {
    assert.ok((d['○'] || 0) >= 1, (c + 1) + '日目に早番がいない');
  });
});

ok('薬剤師の記号は設定（早番・遅半・遅番の人数）に左右されない', () => {
  // 薬剤師はその日の人数で並びが決まる。earlyN / midN / lateMinN は事務にだけ効く
  const five = [{ syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }];
  const a = run(five, { earlyN: 1, midN: 1, lateMinN: 2 }, 10);
  const b = run(five, { earlyN: 3, midN: 3, lateMinN: 5 }, 10);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(b.byDay)), JSON.parse(JSON.stringify(a.byDay)));
});

ok('minOnDuty 1 なら早番は1人のまま', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 1, minOnDuty: 1 }, 20);
  r.byDay.forEach(d => assert.strictEqual(d['○'] || 0, 1));
});

ok('出勤が少ない日でも、締めの1人は必ず残す', () => {
  // 2人しか出ない日。minOnDuty 3 でも早番2人にはしない。
  // 全員を早番にすると遅番が0になり、遅半が上がったあとが無人になる
  const off = [[], [], [0], [0], [0]];
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 1, minOnDuty: 3 }, 10, off);
  assert.strictEqual(r.byDay[0]['▲'] || 0, 1, '閉局まで残る人がいない');
  assert.strictEqual((r.byDay[0]['○'] || 0) + (r.byDay[0]['●'] || 0), 1);
});

ok('早番の均等さは保たれる', () => {
  // 開局の1人は遅半より先に取る。遅半に取られた残りから選ぶと、
  // 早番が特定の人に寄る（実測で差が2に開いた）
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 1, minOnDuty: 2 }, 20);
  const n = r.per.map(p => p.count['○'] || 0);
  assert.ok(Math.max.apply(null, n) - Math.min.apply(null, n) <= 1,
    '早番が偏っている: ' + JSON.stringify(n));
});

console.log('■ 薬剤師は その日の人数で並びが決まる（○▲▲● のあと ●▲○▲ の繰り返し）');

// 締め作業は代わりが利かない。遅番が1人だと、その人が休んだ日に詰む。
// やや余裕を持たせて 薬剤師2・事務1 を既定にしている。
// 余った人も遅番へ流れるので、たいていはこれより多くなる。

ok('遅番は最低の人数を必ず満たす', () => {
  const five = [{ syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }, { syms: ALL }];
  const r = run(five, { earlyN: 1, midN: 1, lateMinN: 2 }, 20);
  r.byDay.forEach((d, c) => {
    assert.ok((d['▲'] || 0) >= 2, (c + 1) + '日目の遅番が ' + (d['▲'] || 0) + ' 人');
  });
});

ok('人数ごとの並び（1〜8人）', () => {
  // 1人目 早番 / 2人目 遅番 / 3人目 遅番 / 4人目 遅半 / 5人目から 遅半 → 遅番 → 早番 → 遅番
  const expect = {
    1: { '○': 1 },
    2: { '○': 1, '▲': 1 },
    3: { '○': 1, '▲': 2 },
    4: { '○': 1, '▲': 2, '●': 1 },
    5: { '○': 1, '▲': 2, '●': 2 },
    6: { '○': 1, '▲': 3, '●': 2 },
    7: { '○': 2, '▲': 3, '●': 2 },
    8: { '○': 2, '▲': 4, '●': 2 }
  };
  Object.keys(expect).forEach(k => {
    const pats = [];
    for (let i = 0; i < Number(k); i++) pats.push({ syms: ALL });
    const r = run(pats, RULES, 3);
    r.byDay.forEach((d, c) => {
      ['○', '●', '▲'].forEach(sym => {
        assert.strictEqual(d[sym] || 0, expect[k][sym] || 0,
          k + '人の日の ' + sym + ' が ' + (d[sym] || 0) + ' 人（' + (expect[k][sym] || 0) + ' 人のはず）');
      });
    });
  });
});

ok('3人の日は 早番1・遅番2（○▲▲。遅番2〜3人のチェックを満たす）', () => {
  const off = [[], [], [], [0], [0]];
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 1, lateMinN: 5 }, 10, off);
  assert.strictEqual(r.byDay[0]['○'] || 0, 1, '早番が1人でない');
  assert.strictEqual(r.byDay[0]['▲'] || 0, 2, '遅番が2人でない');
  assert.strictEqual(r.byDay[0]['●'] || 0, 0, '遅半がいる');
});

ok('事務は事務の最低で数える（薬剤師の数に巻き込まれない）', () => {
  const rows = [{ syms: ALL }, { syms: ALL }, { syms: ALL },
                { syms: ALL, role: 'clerk' }, { syms: ALL, role: 'clerk' }];
  const r = run(rows, { earlyN: 1, midN: 1, clerkEarlyN: 1,
                        lateMinN: 2, clerkLateMinN: 1 }, 10);
  // 事務2人 → 早番1・遅番1
  const clerkLate = r.per.slice(3).reduce((t, p) => t + (p.count['▲'] || 0), 0);
  const clerkEarly = r.per.slice(3).reduce((t, p) => t + (p.count['○'] || 0), 0);
  assert.strictEqual(clerkEarly, 10, '事務の早番が毎日1人でない: ' + clerkEarly);
  assert.strictEqual(clerkLate, 10, '事務の遅番が毎日1人でない: ' + clerkLate);
});

ok('薬剤師の●遅半の設定は、事務に効かない', () => {
  // midN は薬剤師の設定。事務にも効いていて、事務が毎日2人 遅半に入っていた。
  // 実物の事務は ○15 / ●0 / ▲5 で、遅半を使っていない
  const rows = [{ syms: ALL }, { syms: ALL }, { syms: ALL },
                { syms: ['○', '●'], role: 'clerk' },
                { syms: ['○', '●'], role: 'clerk' },
                { syms: ['○', '●'], role: 'clerk' }];
  const r = run(rows, { earlyN: 1, midN: 3, clerkEarlyN: 1, clerkMidN: 0,
                        lateMinN: 2, clerkLateMinN: 1 }, 10);
  const mid = r.per.slice(3).reduce((t, p) => t + (p.count['●'] || 0), 0);
  assert.strictEqual(mid, 0, '事務が遅半に回っている: ' + mid);
});

ok('▲を持たない事務は、余っても早番になる（遅半に流れない）', () => {
  // 事務の役目は受付で処方入力で、開局からの時間に寄る。
  // 「使えるいちばん遅い記号」に落とすと、全員が遅半になっていた
  const rows = [{ syms: ALL }, { syms: ALL }, { syms: ALL },
                { syms: ['○', '●'], role: 'clerk' },
                { syms: ['○', '●'], role: 'clerk' },
                { syms: ['○', '●'], role: 'clerk' }];
  const r = run(rows, { earlyN: 1, midN: 1, clerkEarlyN: 1, clerkMidN: 0,
                        lateMinN: 2, clerkLateMinN: 1 }, 10);
  const early = r.per.slice(3).reduce((t, p) => t + (p.count['○'] || 0), 0);
  assert.strictEqual(early, 30, '事務が早番になっていない: ' + early);
});

ok('▲を持つ事務は、設定どおり遅番に1人入る', () => {
  const rows = [{ syms: ALL }, { syms: ALL }, { syms: ALL },
                { syms: ALL, role: 'clerk' }, { syms: ALL, role: 'clerk' },
                { syms: ALL, role: 'clerk' }];
  const r = run(rows, { earlyN: 1, midN: 1, clerkEarlyN: 1, clerkMidN: 0,
                        lateMinN: 2, clerkLateMinN: 1 }, 10);
  r.byDay.forEach((d, c) => {
    const late = r.per.slice(3).filter(p => (p.dayOf['▲'] || []).indexOf(c) >= 0).length;
    assert.strictEqual(late, 1, (c + 1) + '日目の事務の遅番が ' + late + ' 人');
  });
});

ok('事務が1人しか出ない日は、その人を早番にする', () => {
  // 受付が空くほうが困る。締め作業は薬剤師の仕事
  const off = [[], [], [], [], [0], [0]];
  const rows = [{ syms: ALL }, { syms: ALL }, { syms: ALL },
                { syms: ALL, role: 'clerk' }, { syms: ALL, role: 'clerk' },
                { syms: ALL, role: 'clerk' }];
  const r = run(rows, { earlyN: 1, midN: 1, clerkEarlyN: 1, clerkMidN: 0,
                        lateMinN: 2, clerkLateMinN: 1 }, 10, off);
  assert.strictEqual(r.per[3].dayOf['○'][0], 0, '1日目の事務が早番でない');
});

ok('設定が無い古いデータでも動く（最低1人）', () => {
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL }], { earlyN: 1, midN: 1 }, 10);
  r.byDay.forEach(d => assert.ok((d['▲'] || 0) >= 1, '遅番が0人の日がある'));
});

console.log('■ 時間帯の薄さ');

// 記号ごとに勤務時間が30分ずつずれているので、頭数が足りていても
// 開局直後だけ1人、ということが起きる。実物は
//   早番 10:00〜19:00 / 遅半 10:30〜19:30 / 遅番 11:00〜20:00
// なので、早番が1人だと 10:00〜10:30 が1人になる。

const cov = new Function([
  'const DB = { patterns: [',
  '  { sym: "○", start: "10:00", end: "19:00", work: true },',
  '  { sym: "●", start: "10:30", end: "19:30", work: true },',
  '  { sym: "▲", start: "11:00", end: "20:00", work: true } ] };',
  'const isWork = v => ["○","●","▲"].indexOf(v) >= 0;',
  'let SYMS = [];',
  'const days = [{ from: "10:00", to: "20:00" }];',
  'const ROWS = [];',
  'const get = (r) => r.v;',
  grab('minOf_'), grab('coverageOf_'),
  'return { set: a => { ROWS.length = 0;',
  '  a.forEach((v, i) => ROWS.push({ kind: "staff", role: "pharm", v: v })); },',
  '  coverageOf_ };',
].join('\n'))();

ok('開局直後は早番しかいない', () => {
  cov.set(['○', '▲', '▲', '▲']);
  const r = cov.coverageOf_(0);
  assert.strictEqual(r.min, 1, '4人出ていても 10:00 は1人');
  assert.strictEqual(r.at, '10:00');
});

ok('早番が2人なら開局も2人', () => {
  cov.set(['○', '○', '▲', '▲']);
  assert.strictEqual(cov.coverageOf_(0).min, 2);
});

ok('早番1人＋遅半1人でも、10:00〜10:30 は1人', () => {
  cov.set(['○', '●', '▲', '▲']);
  const r = cov.coverageOf_(0);
  assert.strictEqual(r.min, 1, '遅半は 10:30 からなので開局は覆えない');
  assert.strictEqual(r.at, '10:00');
});

ok('誰も出ていない日は0人', () => {
  cov.set([]);
  assert.strictEqual(cov.coverageOf_(0).min, 0);
});

ok('知らない記号は数えない', () => {
  cov.set(['○', '×']);          // × はマスタに無い記号
  const r = cov.coverageOf_(0);
  assert.strictEqual(r.min, 0, '早番が19:00に上がったあと誰もいない');
  assert.strictEqual(r.at, '19:00');
});

console.log('■ 閉局まで残る人');

ok('遅番が0人の日は、閉局前が無人になると分かる', () => {
  // 早番10:00-19:00 と 遅半10:30-19:30 だけ。閉局は20:00
  cov.set(['○', '●', '●']);
  const r = cov.coverageOf_(0);
  assert.strictEqual(r.min, 0, '19:30〜20:00 が無人なのに気づいていない');
  assert.strictEqual(r.at, '19:30', '締め作業ができない時間帯');
});

ok('遅番が1人いれば閉局まで埋まる', () => {
  cov.set(['○', '●', '▲']);
  assert.ok(cov.coverageOf_(0).min >= 1);
});

ok('自動生成は遅番を0人にしない', () => {
  // 遅半を2人にしても、締めの1人は残る
  const r = run([{ syms: ALL }, { syms: ALL }, { syms: ALL },
                 { syms: ALL }, { syms: ALL }],
    { earlyN: 1, midN: 2, minOnDuty: 2 }, 20);
  r.byDay.forEach((d, c) => {
    assert.ok((d['▲'] || 0) >= 1, (c + 1) + '日目の遅番が0人');
  });
});

console.log(fail ? '\n■ ' + fail + ' 件 NG' : '\n■ すべて OK');
process.exit(fail ? 1 : 0);
