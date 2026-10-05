// prototype/ShiftGrid.html から配置まわりの関数だけ取り出して回す。
// DOM は使わないので node でそのまま検証できる。
const fs = require('fs');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('見つからない: ' + name);
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
  throw new Error('括弧が閉じない: ' + name);
}
const line = t => src.split(/\r?\n/).find(l => l.includes(t));

const RULE_BLOCK = (() => {
  const a = src.indexOf('const RULE_NORMAL');
  const b = src.indexOf('const usesQuota');
  return src.slice(a, src.indexOf(';', b) + 1);
})();
const FNS = ['seedDb', 'nthMonday', 'holidaysOf', 'parseMonthDay', 'daysOfRangeInMonth',
  'closureMap', 'holidayInfoOf', 'storeRows', 'hoursOf', 'buildDays', 'addRollShares_',
  'offQuotaBase', 'offQuotaFor', 'buildWeeks', 'seamWorkedOf_', 'planOf_', 'seamRunOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_', 'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_', 'verifyWeeks_', 'needOf_', 'reqPlusOf_', 'clerkCapOf_', 'firstOverrun_'];

// 医師名欄の行数まわり（clamp_ / DOC_ROWS_* / docRowCount_ / busyDocN_）を
// HTML から丸ごと取る。seedDb と migrateDb_ がこれを参照する。
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);

// 保存済みデータの版と、古い値の手当て。seedDb / migrateDb_ が参照する
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);

const harness = `
  const DAY_COLS = 31;
  const DOW = ['日','月','火','水','木','金','土'];
  ${RULE_BLOCK}
  ${DOC_BLOCK}
  ${MIG_BLOCK}
  ${line('const DAYS_IN_MONTH')}
  ${line('const vernalDay')}
  ${line('const autumnalDay')}
  ${FNS.map(grab).join('\n')}

  const DB = seedDb();
  const activeStore = 'st1';
  const isClosed = info => !info.inMonth || !info.open;
  const workSyms = () => DB.patterns.filter(p => p.work).map(p => p.sym);
  const isWork = v => v === '◯' || workSyms().indexOf(v) >= 0;
  const pubOffSyms = () => DB.patterns.filter(p => !p.work && p.pubOff).map(p => p.sym);
  const isPubOff = v => !!v && pubOffSyms().indexOf(v) >= 0;

  let curYear_ = 0, curMonth_ = 0;
  const values = new Map();
  const get = (row, c) => values.get(row.key + '|' + c) || '';
  const setV = (row, c, v) => { if (v) values.set(row.key + '|' + c, v); else values.delete(row.key + '|' + c); };
  const isHand = () => false;   // 手入力の印はこの試験では使わない
  const docCount = () => 0;
  const paintRow = () => {};
  let autoNotes = []; let allocInfo = ""; let allocByCol = [];
  const note_ = t => { if (autoNotes.indexOf(t) < 0) autoNotes.push(t); };

  const ROWS = DB.staff.map((s, i) => ({
    kind: 'staff', index: i, key: s.id, label: s.name, staff: s,
    role: s.kind === '事務員' ? 'clerk' : (s.employment === '派遣' ? 'dispatch' : 'pharm')
  }));

  let days = [];
  function run(y, m) {
    curYear_ = y; curMonth_ = m;
    days = buildDays(y, m);
    values.clear();
    autoNotes = [];
    const weeks = buildWeeks();
    const offSym = (DB.patterns.find(p => !p.work) || { sym: '公休' }).sym;
    placeAllStaff_(weeks, offSym);
    return { days, weeks, ROWS, DB, get, offSym, isPubOff,
             quotaBase: offQuotaBase(), offQuotaFor, notes: autoNotes, isWork };
  }
  return run;
`;
const run = new Function(harness)();

function longestRun(pred, cols) {
  let best = 0, cur = 0;
  cols.forEach(c => { if (pred(c)) { cur++; best = Math.max(best, cur); } else cur = 0; });
  return best;
}

let failures = 0;
function check(ok, label, detail) {
  if (!ok) { failures++; console.log('  NG  ' + label + (detail ? '  ' + detail : '')); }
  return ok;
}

// 配列の共有。1人を直すと全員が変わる不具合を二度と入れない
(function () {
  const r = run(2026, 10);
  const list = r.DB.staff;
  let shared = 0;
  list.forEach((a, i) => list.forEach((b, j) => {
    if (i >= j) return;
    ['availDow', 'fixedDow', 'patterns'].forEach(k => {
      if (a[k] === b[k]) { shared++; console.log('  NG  ' + k + ' を共有: ' + a.name + ' と ' + b.name); }
    });
  }));
  if (shared) failures += shared;
  console.log('配列の共有: ' + (shared ? '★' + shared + ' 組' : 'なし')
    + ' ／ 出られる曜日の既定: '
    + (list.every(s => s.availDow.every(v => v === 1)) ? '全ON' : '★全ONでない'));
})();

[[2026, 10], [2026, 11], [2027, 1], [2028, 2]].forEach(([y, m]) => {
  const r = run(y, m);
  const inMonth = [];
  for (let c = 0; c < 31; c++) if (r.days[c].inMonth) inMonth.push(c);

  console.log('');
  console.log('══ ' + y + '年' + m + '月  (' + inMonth.length + '日 / 公休ノルマ ' + r.quotaBase + '日)');
  console.log('  氏名       ルール    公休 ノルマ 空欄 出勤 週別出勤        最長連勤/上限 最長連休');

  r.ROWS.forEach(row => {
    const s = row.staff;
    if (s.rule === '手動') return;
    const off = inMonth.filter(c => r.isPubOff(r.get(row, c))).length;
    const blank = inMonth.filter(c => !r.get(row, c)).length;
    const work = inMonth.filter(c => r.isWork(r.get(row, c))).length;
    const quota = r.offQuotaFor();
    const perWeek = r.weeks.map(w => w.cols.filter(c => r.isWork(r.get(row, c))).length);
    const cap = s.maxCons || r.DB.rules.maxConsDefault;
    const runW = longestRun(c => r.isWork(r.get(row, c)), inMonth);
    const runO = longestRun(c => !r.isWork(r.get(row, c)), inMonth);
    const weekLimit = r.weeks.map(w => Math.min(s.weekDays || 0, w.cols.length));
    const overWeek = s.rule !== '固定曜日' && perWeek.some((n, i) => n > weekLimit[i]);

    console.log('  ' + s.name.padEnd(9) + s.rule.padEnd(8)
      + String(off).padStart(3) + String(quota).padStart(6)
      + String(blank).padStart(5) + String(work).padStart(5) + '  [' + perWeek.join(' ') + ']'
      + ('  週上限[' + weekLimit.join(' ') + ']').padEnd(20)
      + String(runW).padStart(4) + '/' + cap
      + String(runO).padStart(8));

    if (s.rule === '通常') check(off === quota, s.name + ' の公休がノルマとビタビタでない', '公休' + off + ' ノルマ' + quota);
    check(runW <= cap, s.name + ' が連勤上限を超えた', runW + ' > ' + cap);
    check(!overWeek, s.name + ' の週出勤が上限を超えた', perWeek.join(',') + ' 上限' + weekLimit.join(','));
  });

  if (r.notes.length) {
    console.log('  申し送り:');
    r.notes.forEach(t => console.log('    - ' + t));
  }
});

console.log('');
console.log(failures ? ('検査 NG ' + failures + ' 件') : '検査 すべて通過');
process.exit(failures ? 1 : 0);
