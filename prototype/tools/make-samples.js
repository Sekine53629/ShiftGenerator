// prototype/samples/ にテスト用の JSON を作り、そのまま配置に通して結果を出す。
// 氏名はすべて架空。実在の職員・医師は書かない（Tier 3）。
const fs = require('fs');
const path = require('path');

const OUT = 'prototype/samples';
fs.mkdirSync(OUT, { recursive: true });

const ALL = [1, 1, 1, 1, 1, 1, 1];
const dow = (...ok) => [0, 1, 2, 3, 4, 5, 6].map(d => (ok.indexOf(d) >= 0 ? 1 : 0));

let seq = 0;
function person(o) {
  seq++;
  return Object.assign({
    id: 's' + String(seq).padStart(3, '0'),
    name: '', kind: '薬剤師', employment: '社員',
    weekDays: 5, annualOff: '', maxCons: 5,
    patterns: ['○', '●', '▲'], availDow: ALL.slice(), fixedDow: [0, 0, 0, 0, 0, 0, 0],
    canClose: true, from: '', to: '', rule: '通常', memo: '',
    hq: false, stores: []   // 担当店舗が空＝全店
  }, o);
}

function leaveFor(staff) {
  return staff.filter(s => s.employment === '社員')
    .map((s, i) => ({
      id: 'lv' + String(i + 1).padStart(3, '0'), staffId: s.id,
      grantDate: '2026-04-01', grantDays: 10 + (i % 5), usedDays: i % 4
    }));
}

// ─────────────────────────────────────────────────────────
// 社員・派遣のパターン
// ─────────────────────────────────────────────────────────
const PATTERNS = {};

seq = 0;
PATTERNS['staff-standard'] = {
  title: '標準構成',
  aim: '常勤中心。全員が土日祝も出られる。まずここが素直に組めるか',
  staff: [
    ...'ABCDEF'.split('').map(x => person({ name: '薬剤師 ' + x })),
    person({ name: '薬剤師 G', weekDays: 4, maxCons: 4, rule: '週N日', availDow: dow(0, 1, 2, 5, 6) }),
    person({ name: '派遣 1', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false, memo: '調剤のみ。締め不可' }),
    person({ name: '派遣 2', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false, memo: '調剤のみ。締め不可' }),
    ...'ABC'.split('').map(x => person({ name: '事務 ' + x, kind: '事務員', patterns: ['○', '●'] })),
    person({ name: '事務 D', kind: '事務員', weekDays: 4, maxCons: 4, rule: '週N日',
             patterns: ['○'], availDow: dow(1, 2, 3, 5), canClose: false })
  ]
};

seq = 0;
PATTERNS['staff-short'] = {
  title: '人手不足',
  aim: '常勤4名＋派遣2名。曜日下限を割る日が出るか、過不足がマイナスに振れるか',
  staff: [
    ...'ABCD'.split('').map(x => person({ name: '薬剤師 ' + x })),
    person({ name: '派遣 1', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false }),
    person({ name: '派遣 2', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false }),
    ...'AB'.split('').map(x => person({ name: '事務 ' + x, kind: '事務員', patterns: ['○', '●'] }))
  ]
};

seq = 0;
PATTERNS['staff-strict-run'] = {
  title: '連勤上限が厳しい',
  aim: '全員3日まで。連勤の入れ替えが働き、公休がノルマちょうどのままか',
  staff: [
    ...'ABCDEFGH'.split('').map(x => person({ name: '薬剤師 ' + x, maxCons: 3 })),
    ...'ABC'.split('').map(x => person({ name: '事務 ' + x, kind: '事務員',
             maxCons: 3, patterns: ['○', '●'] }))
  ]
};

seq = 0;
PATTERNS['staff-parttime'] = {
  title: 'パート中心',
  aim: '週3〜4が多い。公休枠を超える休みが空欄で出て、有休・夏休の判断が要る形になるか',
  staff: [
    ...'AB'.split('').map(x => person({ name: '薬剤師 ' + x })),
    person({ name: '薬剤師 C', weekDays: 4, maxCons: 4, rule: '週N日', availDow: dow(0, 1, 2, 4, 6) }),
    person({ name: '薬剤師 D', weekDays: 4, maxCons: 4, rule: '週N日', availDow: dow(1, 3, 4, 5, 6) }),
    person({ name: '薬剤師 E', weekDays: 3, maxCons: 3, rule: '固定曜日',
             fixedDow: dow(2, 3, 5), availDow: dow(2, 3, 5, 6),
             patterns: ['●'], canClose: false, memo: '火水金 固定' }),
    person({ name: '薬剤師 F', weekDays: 3, maxCons: 3, rule: '週N日',
             availDow: dow(0, 1, 4, 5), patterns: ['○'], canClose: false }),
    person({ name: '派遣 1', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false }),
    ...'AB'.split('').map(x => person({ name: '事務 ' + x, kind: '事務員',
             weekDays: 4, maxCons: 4, patterns: ['○', '●'] }))
  ]
};

seq = 0;
PATTERNS['staff-turnover'] = {
  title: '入退職あり',
  aim: '在籍期間で表に出る人が月ごとに変わるか。10月で1名退職、11月から1名入職',
  staff: [
    ...'ABCD'.split('').map(x => person({ name: '薬剤師 ' + x })),
    person({ name: '薬剤師 E', to: '2026-10', memo: '2026年10月末で退職' }),
    person({ name: '薬剤師 F', from: '2026-11', memo: '2026年11月入職' }),
    person({ name: '派遣 1', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false }),
    ...'AB'.split('').map(x => person({ name: '事務 ' + x, kind: '事務員', patterns: ['○', '●'] }))
  ]
};

seq = 0;
PATTERNS['setup-onsite'] = {
  title: '現場の構成に近い形',
  aim: '実際に使われている構成と曜日別下限を写したもの。氏名は伏せてある。'
     + '薬剤師7名（うち1名は日水木が出られず締め不可、1名は週4）＋派遣2名＋事務2名。'
     + '連続出勤の上限は4日。薬剤師1のみ本人の希望で3日',
  // 曜日別の薬剤師 下限（日 月 火 水 木 金 土）
  pharmMin: [2, 6, 5, 3, 5, 6, 3],
  rules: { maxConsDefault: 4, maxOffRun: 14, reqPlus: 1, earlyN: 1, midN: 1 },
  staff: [
    // 実測では4連勤が18.7%あり、3日上限は現場より厳しい
    // （docs/REAL-SHIFT-ANALYSIS.md §6）。既定を4日にした。
    // 薬剤師1だけは本人の希望で3日のまま。
    person({ name: '薬剤師 1', maxCons: 3, memo: '本人の希望で3連勤まで' }),
    ...[2, 3, 4, 5].map(i => person({ name: '薬剤師 ' + i, maxCons: 4 })),
    person({ name: '薬剤師 6', maxCons: 4, availDow: dow(1, 2, 5, 6), canClose: false,
             memo: '日・水・木は出られない。締め作業不可' }),
    person({ name: '薬剤師 7', weekDays: 4, maxCons: 4, rule: '週N日', memo: '週4' }),
    person({ name: '派遣 1', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲'], canClose: false, memo: '遅番のみ' }),
    person({ name: '派遣 2', employment: '派遣', rule: '手動', weekDays: 0, maxCons: 6,
             patterns: ['▲', '●'], canClose: false, memo: '中長期' }),
    ...[1, 2].map(i => person({ name: '事務 ' + i, kind: '事務員', maxCons: 4,
             patterns: ['○', '▲'] }))
  ]
};

Object.keys(PATTERNS).forEach(key => {
  const p = PATTERNS[key];
  const body = {
    _comment: '社員マスタの見本【' + p.title + '】' + p.aim
      + ' / 実在の職員ではありません。データ書き出しタブに貼って「貼り付けた内容を取り込む」。'
      + (p.pharmMin ? ' staff / leave / hours / rules を差し替えます。'
                    : ' staff と leave だけを差し替えます。'),
    staff: p.staff,
    leave: leaveFor(p.staff)
  };
  // 曜日別の下限は店舗営業マスタが持つので、指定があれば一緒に入れる
  if (p.pharmMin) {
    body.hours = [0, 1, 2, 3, 4, 5, 6].map(d => ({
      id: 'h' + d, storeId: 'st1', dow: d, open: true,
      from: '10:00', to: '20:00',
      pharmMin: p.pharmMin[d], clerkMin: 1
    }));
    body.rules = Object.assign({
      // 日ごとに配る記号の数。早番と遅半を配った残りが全員 遅番になるので
      // lateN は持たない（画面側の DB.rules と揃える）
      reqPlus: 1, earlyN: 1, midN: 1, clerkEarlyN: 1,
      countNationalOff: true, maxConsDefault: 5, maxOffRun: 3,
      needCloser: true, wishMax: 3, carryOver: true
    }, p.rules || {});
  }
  fs.writeFileSync(path.join(OUT, key + '.json'), JSON.stringify(body, null, 2) + '\n', 'utf8');
});


// ─────────────────────────────────────────────────────────
// 医師の出勤表 — 10 パターン
//
// 現場の実態:
//   月火金 … 5診 が多い
//   日     … 3診（確定）
//   その他 … 4診 の場合がある
// これを基本に、混雑・閑散・偏りなどを振ったものを揃える。
// 氏名は架空。実在の医師は書かない。
// ─────────────────────────────────────────────────────────
/** その月の第 n 月曜（ハッピーマンデーの祝日を出すのに使う） */
function nthMonday(y, m, n) {
  return 1 + ((8 - new Date(y, m - 1, 1).getDay()) % 7) + (n - 1) * 7;
}

/**
 * 見本の医師名。**明らかに架空と分かる表記にする。**
 *
 * 以前はありふれた姓を使っていたが、実在の医師・派遣薬剤師に
 * 同じ姓の方がいて、リポジトリを読んだ人に架空か実在か区別が付かなかった。
 * 実名は絶対に書かない（Tier 3）。
 */
const DOC_NAMES = ['医A', '医B', '医C', '医D', '医E', '医F', '医G', '医H', '医I', '医J'];

/**
 * その曜日に出る医師の顔ぶれ。曜日ごとに顔ぶれをずらして、
 * 「同じ曜日には同じ先生が来る」という実態に近づける。
 */
function roster(dow, n, shift) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(DOC_NAMES[(dow * 2 + i + (shift || 0)) % DOC_NAMES.length]);
  }
  return out;
}

// 曜日ごとの診療数（日 月 火 水 木 金 土）
const DOC_PATTERNS = [
  { file: 'doctor-01-standard', title: '標準',
    aim: '月火金5診・日3診・その他4診。いちばんよくある形',
    counts: [3, 5, 5, 4, 4, 5, 4] },
  { file: 'doctor-02-busy', title: '混雑',
    aim: '平日はすべて5診。人員が足りるかを見る',
    counts: [3, 5, 5, 5, 5, 5, 4] },
  { file: 'doctor-03-light', title: '閑散',
    aim: '全体に1診少ない。人が余る側の挙動を見る',
    counts: [2, 4, 4, 3, 3, 4, 3] },
  { file: 'doctor-04-valley', title: '中日が薄い',
    aim: '月火金5診に対し水木は3診。週の真ん中が谷になる形',
    counts: [3, 5, 5, 3, 3, 5, 4] },
  { file: 'doctor-05-late-week', title: '週後半厚め',
    aim: '木金土が厚い。週の後ろに寄せたときの連勤を見る',
    counts: [3, 4, 4, 4, 5, 5, 5] },
  { file: 'doctor-06-sat-heavy', title: '土曜厚め',
    aim: '土曜5診。休日診療に人を回せるかを見る',
    counts: [3, 5, 5, 4, 4, 5, 5] },
  { file: 'doctor-07-holiday-closed', title: '祝日は休診',
    aim: '標準と同じだが祝日だけ医師0。薬局は開くので曜日下限だけで人を置く',
    counts: [3, 5, 5, 4, 4, 5, 4], holidayCount: 0 },
  { file: 'doctor-08-holiday-open', title: '祝日も通常どおり',
    aim: '祝日でも曜日どおりの診療数。休みが減らない月を見る',
    counts: [3, 5, 5, 4, 4, 5, 4], holidaySameAsDow: true },
  { file: 'doctor-09-rotating', title: '隔週で顔ぶれが替わる',
    aim: '第1・3週と第2・4週で担当医が入れ替わる。診療数は標準のまま',
    counts: [3, 5, 5, 4, 4, 5, 4], rotate: true },
  { file: 'doctor-10-variable', title: '週ごとに変動',
    aim: '週によって±1動く。読みにくい月を見る',
    counts: [3, 5, 5, 4, 4, 5, 4], vary: true },

  /* ここから下は実物のシフト表 8 か月分から起こしたもの。
     docs/REAL-SHIFT-ANALYSIS.md §4・§5 の曜日別平均を四捨五入した値。
     01〜10 は「月火金5診・日3診」という想定で作ったが、実測はそうなって
     いなかった。実測は曜日差が小さく、月を追って全体が底上げされている。 */
  { file: 'doctor-11-real-early', title: '実測・前半（R8.1〜3月）',
    aim: '実測の曜日別平均。金曜だけ厚く、木土日が薄い。平均3.5診',
    counts: [3, 4, 4, 4, 3, 5, 3] },
  { file: 'doctor-12-real-late', title: '実測・後半（R8.6〜8月）',
    aim: '半年で底上げされたあとの実測。曜日差がほぼ消えて平均4.4診',
    counts: [4, 5, 4, 4, 4, 5, 4] },
  { file: 'doctor-13-six', title: '6診が常態',
    aim: '底上げの傾向をもう一段進めた想定。医師名欄が5行では入らない',
    counts: [4, 5, 5, 4, 5, 6, 5] },
];

const DOC_Y = 2026, DOC_M = 10;
/**
 * 医師名欄の行数。ここを超える診療数は表に入らない。
 * 画面側は DB.rules.docRows で変えられる（既定 6）。実物のシフト表も
 * 月ごとに 4〜6 行で増減している。ここはその最大値に合わせておく。
 */
const DOC_ROWS = 6;

DOC_PATTERNS.forEach(p => {
  const last = new Date(DOC_Y, DOC_M, 0).getDate();
  const hol = {};
  hol[nthMonday(DOC_Y, 10, 2)] = 'スポーツの日';

  const shift = {};
  for (let i = 1; i <= DOC_ROWS; i++) shift['doc' + i] = {};
  const counts = [];

  for (let day = 1; day <= last; day++) {
    const dow = new Date(DOC_Y, DOC_M - 1, day).getDay();
    const nth = Math.floor((day - 1) / 7) + 1;
    const isHol = !!hol[day];

    let n = p.counts[dow];
    if (isHol && p.holidayCount !== undefined) n = p.holidayCount;
    else if (isHol && !p.holidaySameAsDow) n = p.counts[0];   // 既定は日曜と同じ扱い
    // 変動は下側だけに振る。doctor-10 の想定を変えないため、上へは振らない
    if (p.vary) n = Math.max(2, n + [0, -1, 0, -2, -1][nth - 1]);

    if (n > DOC_ROWS) {
      throw new Error(p.file + ': ' + n + ' 診は医師名欄（' + DOC_ROWS + ' 行）に入りません');
    }
    const names = roster(dow, n, p.rotate ? (nth % 2) * 3 : 0);
    names.forEach((name, i) => { shift['doc' + (i + 1)][day] = name; });
    counts.push(n);
  }

  // 一度も使わなかった行は書かない。医師名欄の行数は画面側の設定で変わるので、
  // 空の doc6 を持たせても意味がなく、差分が読みにくくなるだけ
  for (let i = 1; i <= DOC_ROWS; i++) {
    if (!Object.keys(shift['doc' + i]).length) delete shift['doc' + i];
  }

  fs.writeFileSync(path.join(OUT, p.file + '.json'), JSON.stringify({
    _comment: '医師の出勤表【' + p.title + '】' + p.aim
      + ' / 実在の医師ではありません。データ書き出しタブに貼って「貼り付けた内容を取り込む」。'
      + ' 医師名欄だけを差し替えます。',
    targetMonth: DOC_Y + '-' + String(DOC_M).padStart(2, '0'),
    shift: shift,
  }, null, 2) + '\n', 'utf8');
  p.counts_ = counts;
});

console.log('');
console.log('■ 医師の出勤表（' + DOC_Y + '年' + DOC_M + '月・日〜土の診療数）');
console.log('  ファイル                        日 月 火 水 木 金 土   5診の日  医師0の日  延べ');
DOC_PATTERNS.forEach(p => {
  const c = p.counts_;
  const five = c.filter(n => n >= 5).length;
  const zero = c.filter(n => n === 0).length;
  const total = c.reduce((a, b) => a + b, 0);
  console.log('  ' + (p.file + '.json').padEnd(32)
    + p.counts.join('  ')
    + String(five).padStart(8) + String(zero).padStart(10) + String(total).padStart(7));
});
