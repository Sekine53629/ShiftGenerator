// 組み方（アルゴリズム）だけを、画面もマスタも通さずに確かめる。
//
// 5人の架空の店で、医師シフトのパターンを何通りも回す。
// 結果を 0〜3 の配列にして、ルールを**優先順位の順に**検査する。
//
//   0 = 休み（公休・希望休・有休・空欄）  1 = ○早番  2 = ●遅半  3 = ▲遅番
//
// 店は実物に合わせる: **毎日営業。休業は年末年始 12/30〜1/3 だけ。**
// 祝日は営業するが、公休ノルマには数える。
//
// 優先順位は docs/SHIFT-ALGORITHM.md「ルールの優先順位」と同じ番号。
// 検査は組み方のコードを使わず、ここで独立に書く。同じコードで確かめると、
// 組み方の誤りをそのまま見逃すため。
//
//   node prototype/tests/rules.test.js                 全パターンの要約
//   PATTERN=標準 node prototype/tests/rules.test.js    そのパターンの表も出す
//   PATTERN=all  node prototype/tests/rules.test.js    全パターンの表を出す
const fs = require('fs');
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
const upto = m => { const a = src.indexOf(m); return src.slice(a, src.indexOf(';', a) + 1); };
const RULE = src.slice(src.indexOf('const RULE_NORMAL'),
  src.indexOf(';', src.indexOf('const usesQuota')) + 1);
const FLOOR = src.slice(src.indexOf('const FLOOR_OFF'), src.indexOf('const FLOOR_OPTS'));

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/* ── 人 ─────────────────────────────────────────── */
const ALL = [1, 1, 1, 1, 1, 1, 1], NONE = [0, 0, 0, 0, 0, 0, 0];
const dows = (...ok) => [0, 1, 2, 3, 4, 5, 6].map(d => (ok.indexOf(d) >= 0 ? 1 : 0));
const P = (id, name, o) => Object.assign({
  id: id, name: name, kind: '薬剤師', employment: '社員', rule: '通常',
  weekDays: 5, maxCons: 4, patterns: ['○', '●', '▲'],
  availDow: ALL, fixedDow: NONE, wantOffDow: NONE, canClose: true
}, o);

const STAFF = [
  P('a', 'A', {}),                                         // 希望休 3日
  P('b', 'B', { availDow: dows(0, 1, 2, 4, 5, 6) }),       // 水曜は出られない
  P('c', 'C', { wantOffDow: dows(1) }),                    // 月曜はできるだけ休みたい ＋ 有休1日
  P('d', 'D', { rule: '週N日', weekDays: 4 }),             // 週4日
  P('e', 'E', { canClose: false })                         // 締め作業はできない
];

// 手で入れる休み（業務の手順1）。day は 1 始まり
const FIXED = [
  { id: 'a', day: 5, sym: '希休' }, { id: 'a', day: 6, sym: '希休' }, { id: 'a', day: 17, sym: '希休' },
  { id: 'c', day: 20, sym: '有休' },
  { id: 'e', day: 12, sym: '希休' }
];

const RULES = () => ({
  earlyN: 1, midN: 1, clerkEarlyN: 1, clerkMidN: 0, lateMinN: 2, clerkLateMinN: 1,
  maxConsDefault: 4, weekdayFloor: 'off', needCloser: true, reqPlus: 1,
  needDocA: 3, needPharmA: 4, needDocB: 7, needPharmB: 7, baseMinPharm: 2
});
const DEMAND = [   // 必要人数マスタ（いまは収容上限と表示にだけ使う）
  { doctors: 0, min: 1, target: 1 }, { doctors: 1, min: 2, target: 2 },
  { doctors: 2, min: 2, target: 3 }, { doctors: 3, min: 3, target: 3 },
  { doctors: 4, min: 3, target: 4 }, { doctors: 5, min: 4, target: 5 },
  { doctors: 6, min: 4, target: 6 }
];
const CAP_PHARM = 6;

/* ── 医師シフトのパターン ─────────────────────────────
   どれも「その日の医師数」。曜日ごとの人数（日〜土）から作る */
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const dowOfYM = (y, m, c) => new Date(y, m - 1, c + 1).getDay();
const byDow = (y, m, arr) => Array.from({ length: daysIn(y, m) }, (_, c) => arr[dowOfYM(y, m, c)]);
const lcg = seed => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const STD = [3, 4, 4, 3, 3, 4, 2];

const PATTERNS = [
  { name: '標準',       y: 2026, m: 11, holidays: [3, 23], note: '日3 月4 火4 水3 木3 金4 土2',
    doctors: byDow(2026, 11, STD) },
  { name: '閑散',       y: 2026, m: 11, holidays: [3, 23], note: '日1 月2 火2 水1 木1 金2 土1',
    doctors: byDow(2026, 11, [1, 2, 2, 1, 1, 2, 1]) },
  { name: '繁忙',       y: 2026, m: 11, holidays: [3, 23], note: '日4 月6 火5 水5 木4 金6 土3',
    doctors: byDow(2026, 11, [4, 6, 5, 5, 4, 6, 3]) },
  { name: '谷',         y: 2026, m: 11, holidays: [3, 23], note: '第2・3週だけ 1〜2 人。ほかは標準',
    doctors: byDow(2026, 11, STD).map((v, c) => (c >= 7 && c <= 20 ? Math.max(1, v - 2) : v)) },
  { name: '週後半重い', y: 2026, m: 11, holidays: [3, 23], note: '日2 月2 火2 水3 木5 金6 土3（前半少なく後半多い）',
    doctors: byDow(2026, 11, [2, 2, 2, 3, 5, 6, 3]) },
  { name: '不規則',     y: 2026, m: 11, holidays: [3, 23], note: '日ごとに 1〜6 人（決まった種の乱数）',
    doctors: (() => { const rnd = lcg(20261105); return Array.from({ length: 30 }, () => 1 + Math.floor(rnd() * 6)); })() },
  { name: '6診の山',    y: 2026, m: 11, holidays: [3, 23], note: '標準 ＋ 11・12・18・19日だけ 6 人',
    doctors: byDow(2026, 11, STD).map((v, c) => ([10, 11, 17, 18].indexOf(c) >= 0 ? 6 : v)) },
  // ローリング: 12/30〜1/1 の3日ぶんを前の3日（12/27〜29）へ、1/2〜1/3 の2日ぶんを後ろの2日（1/4・1/5）へ
  { name: '年末',       y: 2026, m: 12, holidays: [], closed: [30, 31], roll: { 27: 1, 28: 1, 29: 1 },
    note: '標準。30・31日は休業。27〜29日が休業ぶんを引き受ける',
    doctors: byDow(2026, 12, STD).map((v, c) => (c + 1 >= 30 ? 0 : v)) },
  { name: '年始',       y: 2027, m: 1, holidays: [11], closed: [1, 2, 3], roll: { 4: 1, 5: 1 },
    note: '標準。1〜3日は休業、11日は成人の日（営業）。4・5日が休業ぶんを引き受ける',
    doctors: byDow(2027, 1, STD).map((v, c) => (c + 1 <= 3 ? 0 : v)) }
];

/* ── 組み方だけを動かす ───────────────────────────── */
const engine = new Function('STAFF', 'FIXED', 'RULES', 'DEMAND', 'CAP', 'DOCS', 'CLOSED', 'HOL', 'ROLL', 'Y', 'M', 'N', [
  RULE, FLOOR,
  'const DOW = ["日","月","火","水","木","金","土"];',
  'const DAY_COLS = N;',
  'const DB = { rules: RULES, demand: DEMAND,',
  '  stores: [{ id: "st", capPharm: CAP, capClerk: 9 }], patterns: [',
  '  { sym: "○", start: "10:00", end: "19:00", work: true, order: 1 },',
  '  { sym: "●", start: "10:30", end: "19:30", work: true, order: 2 },',
  '  { sym: "▲", start: "11:00", end: "20:00", work: true, order: 3 },',
  '  { sym: "公休", work: false, pubOff: true, order: 4 },',
  '  { sym: "希休", work: false, pubOff: true, order: 5 },',
  '  { sym: "有休", work: false, pubOff: false, order: 6 } ] };',
  'const activeStore = "st";',
  'let curYear_ = Y, curMonth_ = M;',
  L('  const byOrder ='), upto('const dowNames_ ='),
  'const workSyms = () => DB.patterns.filter(p => p.work).map(p => p.sym);',
  'const isWork = v => workSyms().indexOf(v) >= 0;',
  'const pubOffSyms = () => DB.patterns.filter(p => !p.work && p.pubOff).map(p => p.sym);',
  'const isPubOff = v => !!v && pubOffSyms().indexOf(v) >= 0;',
  // 日付。CLOSED の日だけ休業。土日・祝日・休業日を公休ノルマに数える（buildDays と同じ）
  'const days = [];',
  'for (let c = 0; c < N; c++) {',
  '  const dow = new Date(Y, M - 1, c + 1).getDay();',
  '  const open = CLOSED.indexOf(c + 1) < 0;',
  '  days.push({ day: c + 1, inMonth: true, dow: dow, open: open,',
  '    countsOff: dow === 0 || dow === 6 || HOL.indexOf(c + 1) >= 0 || !open,',
  '    from: "10:00", to: "20:00", pharmMin: 0, clerkMin: 0, rollShare: ROLL[c + 1] || 0 });',
  '}',
  'const offQuotaFor = () => days.filter(d => d.countsOff).length;',
  'const docCount = c => DOCS[c];',
  'const values = new Map();',
  'const get = (r, c) => values.get(r.key + "|" + c) || "";',
  'const setV = (r, c, v) => { if (v) values.set(r.key + "|" + c, v); else values.delete(r.key + "|" + c); };',
  'const isHand = () => false;   // 手入力の印は manual.test.js で見る',
  'let autoNotes = []; let allocInfo = ""; let allocByCol = [];',
  'const note_ = t => { if (autoNotes.indexOf(t) < 0) autoNotes.push(t); };',
  'const ROWS = STAFF.map((s, i) => ({ kind: "staff", role: "pharm", index: i, key: s.id, label: s.name, staff: s }));',
  ['buildWeeks', 'seamWorkedOf_', 'seamRunOf_', 'planOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_',
    'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_',
    'verifyWeeks_', 'needOf_', 'reqPlusOf_', 'clerkCapOf_', 'firstOverrun_', 'minOf_',
    'staffSymbolSeq_', 'symbolHands_', 'pharmHands_', 'assignShiftSymbols_']
    .map(grab).join('\n'),
  // 業務の手順1: 休みを手で入れる
  'FIXED.forEach(f => { if (f.day <= N) setV(ROWS.find(r => r.key === f.id), f.day - 1, f.sym); });',
  // 手順3: 自動生成（autoGenerate と同じ順）
  'placeAllStaff_(buildWeeks(), "公休");',
  'assignShiftSymbols_(new Set());',
  'return { days, cell: (i, c) => get(ROWS[i], c), notes: autoNotes, quota: offQuotaFor(), allocInfo: allocInfo, allocByCol: allocByCol };'
].join('\n'));

/* ── 仕様（組み方のコードは使わずに書く） ─────────── */

// 仕事率モデル: 医師3人→4人、医師7人→7人 の2点を通る P0 × (d/D0)^e。7人以上は比が一定
const needReal = d => {
  if (d <= 0) return 0;
  if (d >= 7) return d;
  return 4 * Math.pow(d / 3, Math.log(7 / 4) / Math.log(7 / 3));
};
const needInt = d => Math.max(1, Math.round(needReal(d)));
const baseOf = d => Math.max(2, d - 1);
// ローリングの日: 休業日 share 日ぶん × その月の平均の医師数 を足して計算。ただし 医師数＋1 まで
const needRolled = (d, share, avg) => (share > 0 && avg > 0
  ? Math.max(needInt(d), Math.min(d + 1, Math.max(1, Math.round(needReal(d + share * avg)))))
  : needInt(d));
// 人数ごとの記号: 1 ○ / 2 ▲ / 3 ▲ / 4 ● / 5〜 ● ▲ ○ ▲ の繰り返し（3人の日は ○▲▲）
const seqCounts = k => {
  const head = [1, 3, 3, 2], cyc = [2, 3, 1, 3], out = { 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < k; i++) out[i < 4 ? head[i] : cyc[(i - 4) % 4]]++;
  return out;
};

/* ── 1つのパターンを回して検査する ────────────────── */
function runPattern(pt, show) {
  const N = daysIn(pt.y, pt.m);
  const closed = pt.closed || [];
  const r = engine(JSON.parse(JSON.stringify(STAFF)), FIXED, RULES(), DEMAND, CAP_PHARM,
    pt.doctors, closed, pt.holidays || [], pt.roll || {}, pt.y, pt.m, N);

  const CODE = { '○': 1, '●': 2, '▲': 3 };
  const grid = [];
  for (let c = 0; c < N; c++) grid.push(STAFF.map((s, i) => CODE[r.cell(i, c)] || 0));
  const raw = (i, c) => r.cell(i, c);
  const work = (i, c) => grid[c][i] > 0;
  const onOf = c => grid[c].filter(v => v > 0).length;
  const docs = c => pt.doctors[c];
  const dowC = c => r.days[c].dow;
  const isFixed = (s, c) => FIXED.some(f => f.id === s.id && f.day === c + 1);
  const freeOn = c => STAFF.filter(s => s.availDow[dowC(c)] && !isFixed(s, c)).length;

  const weeks = [];
  for (let c = 0; c < N; c++) {
    if (!weeks.length || dowC(c) === 0) weeks.push([]);
    weeks[weeks.length - 1].push(c);
  }
  const weekOf = c => weeks.findIndex(w => w.indexOf(c) >= 0);
  const openDays = [];
  for (let c = 0; c < N; c++) if (r.days[c].open) openDays.push(c);
  const avgDocs = (() => {
    const ds = openDays.map(docs).filter(d => d > 0);
    return ds.length ? ds.reduce((a, d) => a + d, 0) / ds.length : 0;
  })();
  const needOfDay = c => needRolled(docs(c), (pt.roll || {})[c + 1] || 0, avgDocs);

  // 配分を仕様から計算し直す
  //   延べ出勤（予定）… 通常  ＝ min(出られる日 − max(0, 公休枠 − 出られない日), 週の上限の合計)
  //                     週N日 ＝ 週の上限の合計
  //   土台 ＝ max(2, 医師数 − 1)。残りは「必要人数 − 人数」が大きい日から1人ずつ
  //   （同じなら医師数の多い日、忙しい日、その週にまだ足していない日、日付の早い日）。上限 ＝ min(収容上限, 出られる人数)
  const plan = STAFF.map(s => {
    const free = [], forced = [];
    for (let c = 0; c < N; c++) {
      if (isFixed(s, c)) continue;
      if (r.days[c].open && s.availDow[dowC(c)]) free.push(c); else forced.push(c);
    }
    const capSum = weeks.reduce((a, w) => a + Math.min(s.weekDays, w.filter(c => free.indexOf(c) >= 0).length), 0);
    if (s.rule !== '通常') return capSum;
    const room = r.quota - FIXED.filter(f => f.id === s.id && f.sym === '希休' && f.day <= N).length;
    return Math.min(free.length - Math.max(0, room - forced.length), capSum);
  });
  const supplyPlan = plan.reduce((a, v) => a + v, 0);
  const hiOf = c => Math.min(CAP_PHARM, freeOn(c));
  const busyOf = (() => {          // 休み明け・休み前（busyDays_ の仕様）
    const hasDoc = openDays.some(c => docs(c) > 0);
    const rest = k => k >= 0 && k < N && (!r.days[k].open || (hasDoc && docs(k) === 0));
    return c => {
      if (!r.days[c].open || rest(c)) return 0;
      let n = 0;
      for (let k = c - 1; rest(k) && n < 2; k--) n++;
      if (rest(c + 1)) n++;
      return n;
    };
  })();
  const allocT = (() => {
    const n = {};
    openDays.forEach(c => { n[c] = Math.min(baseOf(docs(c)), hiOf(c)); });
    let left = supplyPlan - openDays.reduce((a, c) => a + n[c], 0);
    [2, 1].forEach(lim => {
      while (left < 0) {
        const cs = openDays.filter(c => n[c] > lim).sort((a, b) =>
          (n[b] - needOfDay(b)) - (n[a] - needOfDay(a)) || docs(a) - docs(b) || b - a);
        if (!cs.length) break;
        n[cs[0]]--; left++;
      }
    });
    // 同点なら 日曜は後回し、まだ足していない週の日、まだ足していない曜日の日から
    const added = {}, addedDow = {};
    const sun = c => (dowC(c) === 0 ? 1 : 0);
    while (left > 0) {
      const cs = openDays.filter(c => n[c] < hiOf(c)).sort((a, b) =>
        (needOfDay(b) - n[b]) - (needOfDay(a) - n[a]) || docs(b) - docs(a)
        || busyOf(b) - busyOf(a) || sun(a) - sun(b)
        || (added[weekOf(a)] || 0) - (added[weekOf(b)] || 0)
        || (addedDow[dowC(a)] || 0) - (addedDow[dowC(b)] || 0) || a - b);
      if (!cs.length) break;
      const c0 = cs[0];
      n[c0]++; left--;
      added[weekOf(c0)] = (added[weekOf(c0)] || 0) + 1;
      addedDow[dowC(c0)] = (addedDow[dowC(c0)] || 0) + 1;
    }
    return n;
  })();
  const allocOf = c => allocT[c];
  // 組み方の配分が仕様どおりか（allocByCol と突き合わせる）
  const allocDiff = openDays.filter(c => r.allocByCol[c] !== allocT[c])
    .map(c => (c + 1) + '日 配分が 組み方 ' + r.allocByCol[c] + ' / 仕様 ' + allocT[c]);
  const baseAt = c => Math.min(baseOf(docs(c)), hiOf(c), allocOf(c));

  const results = [];
  const check = (no, label, bad, info) => results.push({ no, label, bad, info: info || [] });

  /**
   * その人を x に足せるか。出られる曜日・手で入れた休みでない・その日の上限に空きがある・
   * 週の出勤が週勤務日数未満・足しても連続出勤が上限以下。
   * 足せる日が残っているのに出勤が足りないなら、組み方の見落とし。
   */
  const addable = (i, x) => {
    const s = STAFF[i];
    if (work(i, x) || !r.days[x].open || !s.availDow[dowC(x)] || isFixed(s, x)) return false;
    if (onOf(x) >= hiOf(x)) return false;
    if (weeks[weekOf(x)].filter(c => work(i, c)).length >= s.weekDays) return false;
    let run = 0, worst = 0;
    for (let c = 0; c < N; c++) {
      run = (c === x || work(i, c)) ? run + 1 : 0;
      worst = Math.max(worst, run);
    }
    return worst <= s.maxCons;
  };

  /* ── 絶対に守る ── */

  check(1, '手で入れた休み（希望休・有休）を動かさない', FIXED.filter(f => f.day <= N).filter(f => {
    const i = STAFF.findIndex(s => s.id === f.id);
    return raw(i, f.day - 1) !== f.sym;
  }).map(f => f.id + ' ' + f.day + '日'));

  {
    const bad = [];
    weeks.forEach((w, wi) => STAFF.forEach((s, i) => w.forEach(c => {
      if (!work(i, c)) return;
      if (!r.days[c].open) bad.push(s.name + ' ' + (c + 1) + '日 休業日');
      else if (!s.availDow[dowC(c)]) bad.push(s.name + ' 第' + (wi + 1) + '週 ' + (c + 1) + '日 出られない曜日');
    })));
    check(2, '休業日・出られない曜日に入れない（週ごと）', bad);
  }

  check(3, '必ず出る曜日に出る', STAFF.flatMap((s, i) => openDays
    .filter(c => s.fixedDow[dowC(c)] && s.availDow[dowC(c)] && !work(i, c))
    .map(c => s.name + ' ' + (c + 1) + '日')));

  {
    const bad = [];
    weeks.forEach((w, wi) => STAFF.forEach((s, i) => {
      const n = w.filter(c => work(i, c)).length;
      if (n > s.weekDays) bad.push(s.name + ' 第' + (wi + 1) + '週 ' + n + '日 > ' + s.weekDays);
      if (s.rule === '週N日' && n < s.weekDays) {
        const x = w.find(c => addable(i, c));
        if (x !== undefined) bad.push(s.name + ' 第' + (wi + 1) + '週 ' + n + '日（週N日。' + (x + 1) + '日に足せる）');
      }
    }));
    check(4, '週の出勤日数が上限以下（週ごと）', bad);
  }

  check(5, '連続出勤が上限以下', STAFF.map((s, i) => {
    let run = 0, worst = 0;
    for (let c = 0; c < N; c++) { run = work(i, c) ? run + 1 : 0; worst = Math.max(worst, run); }
    return worst > s.maxCons ? s.name + ' ' + worst + '連勤' : '';
  }).filter(Boolean));

  check(6, '店舗の収容上限を超えない', openDays.filter(c => onOf(c) > CAP_PHARM)
    .map(c => (c + 1) + '日 ' + onOf(c) + '人'));

  let blanks = 0;
  {
    const bad = [], info = [];
    STAFF.forEach((s, i) => {
      let pub = 0, blank = 0, worked = 0;
      for (let c = 0; c < N; c++) {
        const v = raw(i, c);
        if (v === '公休' || v === '希休') pub++;
        if (!v) blank++;
        if (work(i, c)) worked++;
      }
      blanks += blank;
      const x = blank ? openDays.find(c => !raw(i, c) && addable(i, c)) : undefined;
      if (s.rule === '通常' && pub !== r.quota) bad.push(s.name + ' 公休枠 ' + pub + ' / ノルマ ' + r.quota);
      if (blank && x !== undefined) bad.push(s.name + ' 空欄 ' + blank + '日（' + (x + 1) + '日に出られる）');
      if (blank && x === undefined) info.push(s.name + ' の空欄 ' + blank + ' 日は避けられない（週の上限・連勤上限・'
        + 'その日の上限で、どの空欄にも出られない。出勤 ' + worked + ' 日）');
    });
    check(7, '公休がノルマちょうど（空欄は避けられないものだけ）', bad, info);
  }

  /* ── できるだけ守る ── */

  /**
   * 直せる不足かどうか。**同じ人を、同じ週の中で1日ずらすだけ**で x の不足が埋まるか。
   *   ・その人は x に出ておらず、x は出られる曜日で、手で入れた休みでもない
   *   ・同じ週の y に出ていて、y から1人抜いても y は keep(y) 人を割らない
   *   ・ずらしたあとも連続出勤が上限以下
   *   ・締め作業ができる人なら、y に締め作業の人がほかにもいる
   * これで直せる不足が残っていたら、組み方の見落とし。
   */
  const fixable = (x, keep) => {
    const out = [];
    STAFF.forEach((s, i) => {
      if (work(i, x) || !r.days[x].open || !s.availDow[dowC(x)] || isFixed(s, x)) return;
      weeks[weekOf(x)].forEach(y => {
        if (y === x || !work(i, y) || onOf(y) - 1 < keep(y)) return;
        if (s.canClose && STAFF.filter((t, k) => t.canClose && work(k, y)).length <= 1) return;
        let run = 0, worst = 0;
        for (let c = 0; c < N; c++) {
          const on = c === x ? true : (c === y ? false : work(i, c));
          run = on ? run + 1 : 0;
          worst = Math.max(worst, run);
        }
        if (worst <= s.maxCons) out.push(s.name + ' ' + (y + 1) + '日→' + (x + 1) + '日');
      });
    });
    return out;
  };
  const unfixed = (list, keep, want1) => list.flatMap(x => {
    const f = fixable(x, keep);
    return f.length ? [(x + 1) + DOW[dowC(x)] + ' ' + onOf(x) + '/' + want1(x) + '（' + f[0] + ' で直せる）'] : [];
  });

  // 8. 土台（医師数 − 1、最低2人）
  const lowBase = openDays.filter(c => onOf(c) < baseAt(c));
  check(8, '毎日 土台（医師数−1、最低2人）以上（直せる不足が残っていない）',
    unfixed(lowBase, baseAt, baseAt),
    lowBase.length ? ['土台に届かない日 ' + lowBase.length + ' 日: ' + lowBase.map(c =>
      (c + 1) + DOW[dowC(c)] + '(医' + docs(c) + ' ' + onOf(c) + '/' + baseAt(c)
      + ' 出られる人 ' + freeOn(c) + ')').join(' ')] : []);

  // 9. 配分（土台 ＋ 必要人数との差が大きい日から1人ずつ）
  const shortAlloc = openDays.filter(c => onOf(c) < allocOf(c));
  const devSum = openDays.reduce((a, c) => a + Math.abs(onOf(c) - allocOf(c)), 0);
  check(9, '配分が仕様どおり・配分どおりに置けている（直せるずれが残っていない）',
    allocDiff.concat(unfixed(shortAlloc, y => Math.max(baseAt(y), allocOf(y)), allocOf)),
    ['延べ ' + supplyPlan + ' 人日。配分とのずれ 合計 ' + devSum + ' 人日（配分に届かない日 ' + shortAlloc.length + ' 日）']);

  // 10. 必要人数（仕事率モデル）。足りない月は届かないのが正しいので報告だけ
  const shortNeed = openDays.filter(c => onOf(c) < needOfDay(c));
  const demand = openDays.reduce((a, c) => a + Math.min(hiOf(c), needOfDay(c)), 0);
  const rollDays = Object.keys(pt.roll || {}).map(Number);
  check(10, '必要人数（仕事率モデル）', [],
    ['必要 ' + demand + ' 人日 / 延べ ' + supplyPlan + ' 人日。'
      + (shortNeed.length ? '届かない日 ' + shortNeed.length + ' 日' : '全営業日で必要人数以上')]
      .concat(rollDays.length ? ['ローリングの日: ' + rollDays.map(d => d + '日 医師' + docs(d - 1)
        + ' → 必要 ' + needOfDay(d - 1) + '（ふだんは ' + needInt(docs(d - 1)) + '）').join(' / ')] : []));

  // 11. 記号は人数ごとの並びどおり（○▲▲● のあと ●▲○▲）。締め作業の人もいる
  check(11, '記号は人数ごとの並びどおり・締め作業の人がいる', openDays.flatMap(c => {
    const g = grid[c], k = onOf(c), want = seqCounts(k), out = [];
    [1, 2, 3].forEach(v => {
      const got = g.filter(x => x === v).length;
      if (got !== want[v]) out.push((c + 1) + '日 ' + k + '人で ' + '○●▲'[v - 1] + ' が ' + got + '（' + want[v] + ' のはず）');
    });
    const closerFree = STAFF.some(s => s.canClose && s.availDow[dowC(c)] && !isFixed(s, c));
    if (k && closerFree && !STAFF.some((s, i) => s.canClose && g[i] > 0)) out.push((c + 1) + '日 締め作業なし');
    return out;
  }));

  // 12. 医師数ごとの平均人数（報告）
  const groups = {};
  openDays.forEach(c => { (groups[docs(c)] = groups[docs(c)] || []).push(onOf(c)); });
  const avgByDoc = Object.keys(groups).map(Number).sort((a, b) => a - b)
    .map(k => ({ k, avg: groups[k].reduce((a, v) => a + v, 0) / groups[k].length, n: groups[k].length }));
  check(12, '医師数ごとの人数（報告）', [],
    [avgByDoc.map(x => '医' + x.k + '→' + x.avg.toFixed(1) + '人/必要' + needInt(x.k) + '(' + x.n + '日)').join('  ')]);

  // 13. できるだけ休みたい曜日。その曜日の出勤を、配分を崩さずに同じ週の別の日へ
  //     ずらせるのに、ずらしていなければ NG
  {
    const bad = [];
    STAFF.forEach((s, i) => {
      if (!s.wantOffDow.some(v => v)) return;
      openDays.forEach(x => {
        if (!work(i, x) || !s.wantOffDow[dowC(x)]) return;
        if (onOf(x) - 1 < Math.max(baseAt(x), allocOf(x))) return;
        if (s.canClose && STAFF.filter((t, k) => t.canClose && work(k, x)).length <= 1) return;
        weeks[weekOf(x)].forEach(y => {
          if (y === x || work(i, y) || !r.days[y].open || !s.availDow[dowC(y)] || isFixed(s, y)) return;
          if (s.wantOffDow[dowC(y)] || onOf(y) >= hiOf(y)) return;
          let run = 0, worst = 0;
          for (let c = 0; c < N; c++) {
            const on = c === y ? true : (c === x ? false : work(i, c));
            run = on ? run + 1 : 0;
            worst = Math.max(worst, run);
          }
          if (worst <= s.maxCons) bad.push(s.name + ' ' + (x + 1) + DOW[dowC(x)] + '→' + (y + 1) + DOW[dowC(y)]);
        });
      });
    });
    const iC = STAFF.findIndex(s => s.id === 'c');
    const mons = openDays.filter(c => dowC(c) === 1);
    check(13, 'できるだけ休みたい曜日を避ける（配分を崩さずにずらせる日が残っていない）', bad,
      ['C の月曜出勤 ' + mons.filter(c => work(iC, c)).length + ' / ' + mons.length + ' 日']);
  }

  // 14. 記号の回数が持ち札どおり（出勤日数に比例）。仕様: 持ち札 ＝ 月の枠 × 出勤日数 ÷ 全員の出勤日数
  //     （この店では全員がすべての記号を使える）。整数にするぶんと、日ごとの並びで動かせないぶんで
  //     1回ずつ、合わせて2回未満のずれまで許す
  const share = STAFF.map((s, i) => {
    const n = [0, 0, 0, 0];
    for (let c = 0; c < N; c++) n[grid[c][i]]++;
    const w = n[1] + n[2] + n[3];
    return { name: s.name, w, n, r: [1, 2, 3].map(k => (w ? n[k] / w : 0)) };
  });
  {
    const W = share.reduce((a, x) => a + x.w, 0);
    const T = [1, 2, 3].map(k => share.reduce((a, x) => a + x.n[k], 0));
    const bad = [];
    share.forEach(x => [1, 2, 3].forEach((k, j) => {
      const ideal = W ? x.w * T[j] / W : 0;
      if (Math.abs(x.n[k] - ideal) >= 2) {
        bad.push(x.name + ' ' + '○●▲'[j] + ' ' + x.n[k] + '回（出勤日数からは ' + ideal.toFixed(1) + '回）');
      }
    }));
    check(14, '早番・遅半・遅番の回数が持ち札どおり（出勤日数に比例）', bad);
  }

  /* ── 表示 ── */
  if (show) {
    console.log('');
    console.log('════ ' + pt.name + '（' + pt.y + '年' + pt.m + '月。' + pt.note + '）');
    console.log('  ' + r.allocInfo);
    console.log('  日 曜 医師 土台/必要/配分  ' + STAFF.map(s => s.name).join('  ') + '   人数');
    for (let c = 0; c < N; c++) {
      const d = r.days[c];
      const cells = STAFF.map((s, i) => (isFixed(s, c) ? '[' + grid[c][i] + ']' : ' ' + grid[c][i] + ' ')).join('');
      const mark = d.open && onOf(c) !== allocOf(c) ? '  ← 配分 ' + allocOf(c) : '';
      console.log('  ' + String(c + 1).padStart(2) + ' ' + DOW[d.dow] + '  '
        + (d.open ? String(docs(c)).padStart(3) + '   ' + String(baseAt(c)).padStart(2) + ' /' + String(needOfDay(c)).padStart(2)
          + ' /' + String(allocOf(c)).padStart(2) + '     '
          : ' 休業                ')
        + cells + '   ' + onOf(c) + mark);
    }
    console.log('  配列: ' + JSON.stringify(grid));
    console.log('');
    console.log('  氏名 ルール   出勤  ○  ●  ▲');
    share.forEach((x, i) => console.log('  ' + x.name.padEnd(4) + STAFF[i].rule.padEnd(6)
      + String(x.w).padStart(4) + String(x.n[1]).padStart(4) + String(x.n[2]).padStart(3)
      + String(x.n[3]).padStart(3)));
    console.log('');
    results.forEach(x => {
      console.log('  ' + (x.bad.length ? 'NG' : 'OK') + ' ' + String(x.no).padStart(2) + '. ' + x.label);
      x.bad.slice(0, 6).forEach(b => console.log('          ★ ' + b));
      x.info.forEach(b => console.log('          ' + b));
    });
    if (r.notes.length) r.notes.forEach(t => console.log('  ・' + t));
  }

  return {
    pt, results, supplyPlan, demand, blanks, devSum,
    ng: results.filter(x => x.bad.length),
    lowBase: lowBase.length, shortNeed: shortNeed.length, avgByDoc
  };
}

/* ── 全パターン ───────────────────────────────────── */
const want = process.env.PATTERN || '';
const runs = PATTERNS.map(pt => runPattern(pt, want === 'all' || want === pt.name));

console.log('');
console.log('■ 医師シフト ' + PATTERNS.length + ' パターン × 5人（毎日営業・年末年始 12/30〜1/3 休業・収容上限 '
  + CAP_PHARM + ' 人）');
console.log('');
console.log('  パターン     年月      延べ出勤  必要人数  配分ずれ  土台割れ  必要未達  空欄  NG');
runs.forEach(x => {
  console.log('  ' + x.pt.name.padEnd(9) + (x.pt.y + '-' + String(x.pt.m).padStart(2, '0')).padStart(8)
    + String(x.supplyPlan).padStart(8) + String(x.demand).padStart(9)
    + (String(x.devSum) + '人日').padStart(9)
    + (String(x.lowBase) + '日').padStart(8)
    + (String(x.shortNeed) + '日').padStart(9)
    + String(x.blanks).padStart(5)
    + '  ' + (x.ng.length ? x.ng.map(n => '#' + n.no).join(',') : '-'));
});
console.log('');
console.log('  ※ 延べ出勤＝5人の今月の出勤日数の合計。必要人数＝仕事率モデル（医師3人→4人、7人→7人）の合計。');
console.log('    配分ずれ＝実際の人数と配分の差の合計（連勤・週の上限で動かせないぶん）');

console.log('');
console.log('■ 医師数ごとの平均人数 / 必要人数');
runs.forEach(x => console.log('  ' + x.pt.name.padEnd(9) + x.avgByDoc.map(a =>
  '医' + a.k + '→' + a.avg.toFixed(1) + '/' + needInt(a.k)).join('  ')));

const failed = runs.filter(x => x.ng.length);
if (failed.length) {
  console.log('');
  console.log('■ NG の中身');
  failed.forEach(x => x.ng.forEach(n => {
    console.log('  ' + x.pt.name + ' #' + n.no + ' ' + n.label);
    n.bad.slice(0, 6).forEach(b => console.log('      ★ ' + b));
  }));
}
console.log('');
console.log(failed.length ? ('★ NG ' + failed.length + ' パターン') : '全 ' + PATTERNS.length + ' パターンで全項目 OK');
process.exit(failed.length ? 1 : 0);
