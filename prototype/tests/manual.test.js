// 手で入れたものが自動生成で消えないかを見る。
//
// 実際の手順:
//   1. 希望休を入れる（自動配置される社員の欄）
//   2. 派遣薬剤師の出勤を入れる（勤務ルールが「手動」の行）
//   3. 自動生成をかける
// このあと 1 と 2 がそのまま残っていること。
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
  'offQuotaFor', 'buildWeeks', 'seamWorkedOf_', 'planOf_', 'seamRunOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_', 'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_', 'verifyWeeks_', 'needOf_', 'reqPlusOf_',
  'clerkCapOf_', 'firstOverrun_', 'normDow_', 'syncDemand_', 'migrateDb_',
  'inService', 'belongsHere', 'buildRows'];

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
  FN.map(grab).join('\n'),
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
  'function open_(y,m){ curYm=y+"-"+String(m).padStart(2,"0"); curYear_=y; curMonth_=m;',
  '  days=buildDays(y,m); ROWS=buildRows(y,m); }',
  // 画面で手で押したのと同じ。休みなら「手で入れた」印も付ける（applyStamp と同じ）
  'function putHand(rowKey, day, sym){',
  '  const row = ROWS.find(r=>r.key===rowKey);',
  '  const c = days.findIndex(d=>d.inMonth && d.day===day);',
  '  setV(row,c,sym); values.set(handKey(row,c),"1"); }',
  'function put(rowKey, day, sym){',
  '  const row = ROWS.find(r=>r.key===rowKey); if(!row) throw new Error("行が無い: "+rowKey);',
  '  const c = days.findIndex(d=>d.inMonth && d.day===day);',
  '  if(c<0) throw new Error("日が無い: "+day); setV(row,c,sym); }',
  'function read(rowKey, day){',
  '  const row = ROWS.find(r=>r.key===rowKey); if(!row) return "(行なし)";',
  '  const c = days.findIndex(d=>d.inMonth && d.day===day);',
  '  return c<0 ? "(日なし)" : get(row,c); }',
  'function autoRun(){ autoNotes=[]; const w=buildWeeks();',
  '  placeAllStaff_(w,"公休"); }',
  'function countOf(rowKey, pred){',
  '  const row = ROWS.find(r=>r.key===rowKey); let n=0;',
  '  for(let c=0;c<DAY_COLS;c++){ if(!days[c].inMonth) continue;',
  '    if(pred(get(row,c))) n++; } return n; }',
  'return { open_, put, putHand, read, autoRun, countOf, isWork, isPubOff,',
  '  quota: ()=>offQuotaBase(), rows: ()=>ROWS, notes: ()=>autoNotes, DB };'
].join('\n'))();

let ng = 0;
const check = (ok, label, detail) => {
  if (!ok) { ng++; console.log('  NG  ' + label + (detail ? '  ' + detail : '')); }
};

// 現場に近い構成（setup-onsite）でも同じ手順を試せるようにする
const FIXTURE = process.env.FIXTURE || '';
if (FIXTURE) {
  const j = JSON.parse(fs.readFileSync('prototype/samples/' + FIXTURE, 'utf8'));
  if (j.staff) api.DB.staff = j.staff;
  if (j.hours) api.DB.hours = j.hours;
  if (j.rules) Object.assign(api.DB.rules, j.rules);
  console.log('（' + FIXTURE + ' を読み込んだ）');
  console.log('');
}

api.open_(2026, 10);

// 対象を選ぶ
const staffRows = api.rows().filter(r => r.kind === 'staff');
const auto = staffRows.filter(r => r.staff.rule !== '手動').slice(0, 3);
const manual = staffRows.filter(r => r.staff.rule === '手動').slice(0, 2);

console.log('■ 手順1: 希望休を入れる');
const WISH = [
  { key: auto[0].key, name: auto[0].label, days: [7, 8, 21] },
  { key: auto[1].key, name: auto[1].label, days: [14] },
  { key: auto[2].key, name: auto[2].label, days: [3, 4] },
];
WISH.forEach(w => {
  w.days.forEach(d => api.put(w.key, d, '希休'));
  console.log('  ' + w.name.padEnd(9) + w.days.map(d => d + '日').join(' '));
});

console.log('');
console.log('■ 手順2: 派遣薬剤師の出勤を入れる（勤務ルール「手動」）');
const DISPATCH = [
  { key: manual[0].key, name: manual[0].label, days: [1, 8, 15, 22, 29], sym: '▲' },
  { key: manual[1].key, name: manual[1].label, days: [5, 12, 19, 26], sym: '●' },
];
DISPATCH.forEach(x => {
  x.days.forEach(d => api.put(x.key, d, x.sym));
  console.log('  ' + x.name.padEnd(9) + x.sym + ' ' + x.days.map(d => d + '日').join(' '));
});

// 有休も1つ置いて、枠外の休みが残るかも見る
api.put(auto[0].key, 16, '有休');
console.log('');
console.log('  ' + auto[0].label + ' の 16日 に有休も置いた（公休枠の外）');

console.log('');
console.log('■ 手順3: 自動生成');
api.autoRun();

console.log('');
console.log('■ 希望休が残っているか');
WISH.forEach(w => {
  const got = w.days.map(d => api.read(w.key, d));
  const ok = got.every(v => v === '希休');
  console.log('  ' + w.name.padEnd(9) + w.days.map((d, i) => d + '日=' + (got[i] || '空')).join(' ')
    + (ok ? '' : '   ★消えた'));
  check(ok, w.name + ' の希望休が残っていない', got.join(','));
});

console.log('');
console.log('■ 有休が残っているか');
{
  const v = api.read(auto[0].key, 16);
  console.log('  ' + auto[0].label + ' 16日 = ' + (v || '空'));
  check(v === '有休', '有休が残っていない', v);
}

console.log('');
console.log('■ 派遣の入力が残っているか（自動生成が触っていないこと）');
DISPATCH.forEach(x => {
  const got = x.days.map(d => api.read(x.key, d));
  const ok = got.every(v => v === x.sym);
  // 入れていない日が勝手に埋まっていないかも見る
  const filled = api.countOf(x.key, v => !!v);
  console.log('  ' + x.name.padEnd(9) + x.days.map((d, i) => d + '日=' + (got[i] || '空')).join(' ')
    + '   埋まっているセル ' + filled + ' 個'
    + (ok && filled === x.days.length ? '' : '   ★変わった'));
  check(ok, x.name + ' の入力が残っていない', got.join(','));
  check(filled === x.days.length, x.name + ' に勝手な書き込みがある', String(filled));
});

console.log('');
console.log('■ 希望休の日に出勤が入っていないか');
WISH.forEach(w => {
  const bad = w.days.filter(d => api.isWork(api.read(w.key, d)));
  check(bad.length === 0, w.name + ' の希望休の日に出勤が入った', bad.join(','));
});
console.log('  すべての希望休の日で出勤なし');

console.log('');
console.log('■ 公休枠（公休＋希望休）がノルマちょうどか');
const quota = api.quota();
console.log('  今月のノルマ ' + quota + ' 日');
auto.forEach(r => {
  const pub = api.countOf(r.key, v => api.isPubOff(v));
  const wish = api.countOf(r.key, v => v === '希休');
  const paid = api.countOf(r.key, v => v === '有休');
  const ok = r.staff.rule !== '通常' || pub === quota;
  console.log('  ' + r.label.padEnd(9) + r.staff.rule.padEnd(8)
    + '公休枠 ' + pub + '（うち希望休 ' + wish + '）  有休 ' + paid
    + (ok ? '' : '   ★ノルマと違う'));
  check(ok, r.label + ' の公休枠がノルマと違う', pub + ' / ' + quota);
});

if (api.notes().length) {
  console.log('');
  console.log('■ 申し送り');
  [...new Set(api.notes())].slice(0, 5).forEach(t => console.log('  ・' + t));
}

console.log('');
console.log('');
console.log('■ 手で入れた「公休」も書き換えない（希望休のつもりで公休を押した場合）');
{
  // 自動生成の結果の公休と、手で押した公休は記号だけでは見分けられない。手で押した印で見分ける
  const r = auto[1];
  // 出勤になっている日を探して、そこに手で公休を押す
  let day = 0;
  for (let d = 1; d <= 31 && !day; d++) if (api.isWork(api.read(r.key, d))) day = d;
  api.putHand(r.key, day, '公休');
  api.autoRun();
  api.autoRun();          // 2回回しても残る
  const v = api.read(r.key, day);
  console.log('  ' + r.label + ' ' + day + '日に手で公休 → 自動生成を2回 → ' + (v || '空'));
  check(v === '公休', r.label + ' の手で入れた公休が書き換わった', v);
  // 公休枠の数え方も崩れない（手で入れた公休は公休枠を使う）
  const pub = api.countOf(r.key, x => api.isPubOff(x));
  check(r.staff.rule !== '通常' || pub === api.quota(), r.label + ' の公休枠がノルマと違う', pub + ' / ' + api.quota());
}

console.log('');
console.log('■ 手で入れたシフト（○早番など）も書き換えない');
{
  const r = auto[2];
  // 自動生成で休みになった日を探して、そこに手で ▲ を入れる（自動なら出勤にしない日）
  let day = 0;
  for (let d = 1; d <= 31 && !day; d++) if (api.read(r.key, d) === '公休') day = d;
  api.putHand(r.key, day, '▲');
  api.autoRun();
  api.autoRun();
  const v = api.read(r.key, day);
  console.log('  ' + r.label + ' ' + day + '日に手で ▲ → 自動生成を2回 → ' + (v || '空'));
  check(v === '▲', r.label + ' の手で入れた ▲ が書き換わった', v);
  // 手で入れた出勤も出勤日に数える。公休はノルマちょうどのまま
  const pub = api.countOf(r.key, x => api.isPubOff(x));
  check(r.staff.rule !== '通常' || pub === api.quota(), r.label + ' の公休枠がノルマと違う', pub + ' / ' + api.quota());
  console.log('  公休枠 ' + pub + ' / ノルマ ' + api.quota());
}

console.log('');
console.log(ng ? ('★ NG ' + ng + ' 件') : '手で入れたものは自動生成で消えない');
process.exit(ng ? 1 : 0);
