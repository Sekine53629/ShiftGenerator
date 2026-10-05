// 月をまたぐ週（継ぎ目の週）で、週の勤務上限を超えていないかを見る。
//
// buildWeeks() は月内だけで週を切るので、継ぎ目の週は前月ぶんと今月ぶんに
// 分断される。それぞれが上限まで埋まると、暦の1週間としては上限を超える。
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

const FN = ['seedDb', 'nthMonday', 'holidaysOf', 'parseMonthDay', 'daysOfRangeInMonth',
  'closureMap', 'holidayInfoOf', 'storeRows', 'hoursOf', 'buildDays', 'addRollShares_', 'offQuotaBase',
  'offQuotaFor', 'buildWeeks', 'planOf_', 'seamRunOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_', 'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_', 'verifyWeeks_', 'needOf_', 'reqPlusOf_', 'clerkCapOf_',
  'firstOverrun_', 'normDow_', 'syncDemand_', 'migrateDb_',
  'inService', 'belongsHere', 'buildRows', 'seamWorkedOf_'];

const has = n => src.indexOf('function ' + n + '(') >= 0;
const FN2 = FN.filter(has);

// 医師名欄の行数まわり（clamp_ / DOC_ROWS_* / docRowCount_ / busyDocN_）を
// HTML から丸ごと取る。seedDb と migrateDb_ がこれを参照する。
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);

// 保存済みデータの版と、古い値の手当て。seedDb / migrateDb_ が参照する
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);

const api = new Function([
  'const DAY_COLS=31; const DOC_ROWS=5;',
  'const DOW=["日","月","火","水","木","金","土"];',
  RULE, DOC_BLOCK, MIG_BLOCK, L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  FN2.map(grab).join('\n'),
  L('  const isInput ='), upto('const dowNames_ ='),
  L('  const closedClass ='), L('  const isClosed ='), L('  const byOrder ='),
  'const DB=migrateDb_(seedDb()); const activeStore="st1";',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const pubOffSyms=()=>DB.patterns.filter(p=>!p.work&&p.pubOff).map(p=>p.sym);',
  'const isPubOff=v=>!!v&&pubOffSyms().indexOf(v)>=0;',
  'const values=new Map(); let curYm=""; let days=[]; let ROWS=[];',
  'let curYear_=0, curMonth_=0;',
  upto('const cellKey ='), upto('const handKey ='), upto('const isHand ='),
  'const get=(r,c)=>values.get(cellKey(r,c))||"";',
  'const setV=(r,c,v)=>{if(v)values.set(cellKey(r,c),v);else values.delete(cellKey(r,c));};',
  'const docCount=()=>0; const paintRow=()=>{}; let autoNotes = []; let allocInfo = ""; let allocByCol = [];',
  'const note_=t=>{if(autoNotes.indexOf(t)<0)autoNotes.push(t);};',
  'function gen(y,m){',
  '  curYm = y+"-"+String(m).padStart(2,"0"); curYear_=y; curMonth_=m;',
  '  days = buildDays(y,m);',
  '  ROWS = buildRows(y,m);',
  '  const w = buildWeeks();',
  '  placeAllStaff_(w,"公休");',
  '}',
  // 指定した日の記号を、月をまたいで引く
  'function valOn(staffId, y, m, d){',
  '  return values.get(staffId+"|"+y+"-"+String(m).padStart(2,"0")+"|"+d) || "";',
  '}',
  'function setOn(staffId, y, m, d, v){',
  '  values.set(staffId+"|"+y+"-"+String(m).padStart(2,"0")+"|"+d, v);',
  '}',
  'return { gen, valOn, setOn, isWork, DB, staff: () => DB.staff };'
].join('\n'))();

const DOW = ['日', '月', '火', '水', '木', '金', '土'];

/** 対象月の1日を含む暦の1週間（日〜土）を、月をまたいで返す */
function seamWeek(y, m) {
  const first = new Date(y, m - 1, 1);
  const sun = new Date(first);
  sun.setDate(sun.getDate() - first.getDay());     // その週の日曜まで戻る
  const out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(sun);
    d.setDate(d.getDate() + i);
    out.push({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), dow: d.getDay() });
  }
  return out;
}

let ng = 0;
const check = (ok, label, detail) => {
  if (!ok) { ng++; console.log('  NG  ' + label + (detail ? '  ' + detail : '')); }
};

// 継ぎ目が週の途中に来る月を選ぶ（1日が日曜だと分断が起きない）
const CASES = [[2026, 9, 2026, 10], [2026, 10, 2026, 11], [2026, 11, 2026, 12], [2027, 1, 2027, 2]];

CASES.forEach(([py, pm, ny, nm]) => {
  api.gen(py, pm);          // 前月を組む
  api.gen(ny, nm);          // 今月を組む（前月の入力は残る）

  const week = seamWeek(ny, nm);
  const split = week.filter(x => x.m === pm).length;
  console.log('');
  console.log('══ ' + py + '/' + pm + ' → ' + ny + '/' + nm
    + '   継ぎ目の週: ' + week.map(x => x.m + '/' + x.d).join(' ')
    + '（前月 ' + split + ' 日 ＋ 今月 ' + (7 - split) + ' 日）');
  if (split === 0) { console.log('  1日が日曜なので分断なし'); return; }

  console.log('  氏名       ルール   週上限  継ぎ目の週の出勤  内訳');
  api.staff().forEach(s => {
    if (s.rule === '手動') return;
    const marks = week.map(x => api.valOn(s.id, x.y, x.m, x.d));
    const n = marks.filter(v => api.isWork(v)).length;
    const cap = Number(s.weekDays) || 0;
    const over = s.rule !== '固定曜日' && cap > 0 && n > cap;
    console.log('  ' + s.name.padEnd(9) + s.rule.padEnd(8)
      + String(cap).padStart(4) + String(n).padStart(14) + '        '
      + week.map((x, i) => DOW[x.dow] + (api.isWork(marks[i]) ? '出' : '休')).join(' ')
      + (over ? '   ★上限超え' : ''));
    check(!over, s.name + ' の継ぎ目の週が週上限を超えた', n + ' > ' + cap);
  });
});

/* ── 前月末から続く連勤 ─────────────────────────────
   引き継がないと、前月末の連勤に今月1日からの連勤が足されて上限を超える
   （最悪、前月末4日＋今月頭の連勤で 10 連勤になりうる）。 */
const capOf = st => Number(st.maxCons) || Number(api.DB.rules.maxConsDefault) || 4;
const lastDay = (y, m) => new Date(y, m, 0).getDate();

console.log('');
console.log('■ 前月末から続く連勤（月をまたいで数える）');
CASES.forEach(([py, pm, ny, nm]) => {
  api.gen(py, pm);
  api.gen(ny, nm);
  api.staff().forEach(st => {
    if (st.rule === '手動') return;
    // 前月の最後の10日 ＋ 今月の最初の10日 を続けて見る
    const line = [];
    for (let d = lastDay(py, pm) - 9; d <= lastDay(py, pm); d++) line.push(api.valOn(st.id, py, pm, d));
    for (let d = 1; d <= 10; d++) line.push(api.valOn(st.id, ny, nm, d));
    let run = 0, worst = 0;
    line.forEach(v => { run = api.isWork(v) ? run + 1 : 0; worst = Math.max(worst, run); });
    check(worst <= capOf(st), st.name + ' の ' + pm + '月末〜' + nm + '月頭の連勤が上限を超えた',
      worst + ' > ' + capOf(st));
  });
});
console.log('  ' + CASES.length + ' 通りの月の継ぎ目で、全員が連勤上限以内か見た');

console.log('');
console.log('■ 前月末が上限ちょうどの連勤なら、今月1日は休みになる');
{
  const [py, pm, ny, nm] = [2026, 10, 2026, 11];
  api.gen(py, pm);
  const st = api.staff().find(x => x.rule === '通常');
  const cap = capOf(st);
  // 前月の最後の cap 日をすべて出勤、その前の日を休みにする
  const ld = lastDay(py, pm);
  api.setOn(st.id, py, pm, ld - cap, '公休');
  for (let d = ld - cap + 1; d <= ld; d++) api.setOn(st.id, py, pm, d, '▲');
  api.gen(ny, nm);
  const day1 = api.valOn(st.id, ny, nm, 1);
  console.log('  ' + st.name + '：' + pm + '月の最後の ' + cap + ' 日が出勤 → ' + nm + '月1日は「' + (day1 || '空欄') + '」');
  check(!api.isWork(day1), st.name + ' の ' + nm + '月1日が出勤（前月末から ' + (cap + 1) + ' 連勤）', day1);
}

console.log('');
console.log(ng ? ('★ NG ' + ng + ' 件') : '継ぎ目の週の上限と、前月末から続く連勤を守れている');
process.exit(ng ? 1 : 0);
