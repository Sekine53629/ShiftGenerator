// 医師パターン × 派遣の量3水準 を全部回して、派遣がどれだけ効くかを見る。
// パターンは samples/doctor-*.json を拾うので、足せばそのぶん増える。
//
// 実際の手順に合わせる: 派遣を先に置いてから自動生成する。
// 自動配置はその日の人数に派遣も数えるので、置いてから回すと
// 社員の配置が派遣に合わせて動く。
//
//   node prototype/tests/dispatch.test.js
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
  'let DB=migrateDb_(seedDb()); const activeStore="st1";',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const pubOffSyms=()=>DB.patterns.filter(p=>!p.work&&p.pubOff).map(p=>p.sym);',
  'const isPubOff=v=>!!v&&pubOffSyms().indexOf(v)>=0;',
  'const values=new Map(); let curYm=""; let days=[]; let ROWS=[]; let docByDay={};',
  'let curYear_=0, curMonth_=0;',
  upto('const cellKey ='), upto('const handKey ='), upto('const isHand ='),
  'const get=(r,c)=>values.get(cellKey(r,c))||"";',
  'const setV=(r,c,v)=>{if(v)values.set(cellKey(r,c),v);else values.delete(cellKey(r,c));};',
  'const docCount=(c)=>docByDay[days[c].day]||0;',
  'const paintRow=()=>{}; let autoNotes = []; let allocInfo = ""; let allocByCol = [];',
  'const note_=t=>{if(autoNotes.indexOf(t)<0)autoNotes.push(t);};',

  // 1回ぶんの試行
  'function trial(setup, doc, dispatchDays){',
  '  DB = migrateDb_(seedDb());',
  '  if(setup.staff) DB.staff = JSON.parse(JSON.stringify(setup.staff));',
  '  if(setup.hours) DB.hours = JSON.parse(JSON.stringify(setup.hours));',
  '  if(setup.rules) Object.assign(DB.rules, setup.rules);',
  '  docByDay = {};',
  '  Object.values(doc).forEach(row => Object.keys(row).forEach(d => {',
  '    docByDay[d] = (docByDay[d]||0) + 1; }));',
  '  curYm="2026-10"; curYear_=2026; curMonth_=10;',
  '  days = buildDays(2026,10); ROWS = buildRows(2026,10);',
  '  values.clear(); autoNotes=[];',
  '  const im=[]; for(let c=0;c<31;c++) if(days[c].inMonth) im.push(c);',

  // 必要人数の多い日から派遣を置く（現場の判断に近い）
  '  const manual = ROWS.filter(r=>r.kind==="staff" && r.staff.rule===RULE_MANUAL);',
  '  const ranked = im.slice().sort((a,b)=> needOf_(b).target - needOf_(a).target || a-b);',
  '  let placed=0, k=0;',
  '  while(placed < dispatchDays && manual.length){',
  '    const c = ranked[k % ranked.length];',
  '    const who = manual[placed % manual.length];',
  '    if(!get(who,c) && days[c].open){',
  '      const sym = (who.staff.patterns||["▲"])[0];',
  '      setV(who,c,sym); placed++;',
  '    }',
  '    k++;',
  '    if(k > ranked.length * manual.length + 10) break;',
  '  }',

  // 自動生成
  '  const w = buildWeeks();',
  '  placeAllStaff_(w,"公休");',
  // もう一度回して同じになるか。前回の結果に引きずられないこと
  '  const once = JSON.stringify([...values]); placeAllStaff_(w,"公休");',
  '  const rerun = once === JSON.stringify([...values]);',

  // 集計
  '  let low=0, lowSum=0, high=0, blank=0, work=0, quotaNg=0, closer=0;',
  '  const byDow = [0,0,0,0,0,0,0], lowByDow = [0,0,0,0,0,0,0];',
  '  im.forEach(c=>{',
  '    let on=0, canClose=0;',
  '    ROWS.forEach(r=>{ if(r.kind==="staff" && r.role!=="clerk" && isWork(get(r,c))){',
  '      on++; if(r.staff.canClose) canClose++; } });',
  '    const n = needOf_(c);',
  '    if(on < n.min){ low++; lowSum += (n.min-on); lowByDow[days[c].dow]++; }',
  '    if(on > n.max) high++;',
  '    if(canClose===0) closer++;',
  '    work += on; byDow[days[c].dow] += on;',
  '  });',
  '  const q = offQuotaBase();',
  '  ROWS.forEach(r=>{ if(r.kind!=="staff") return;',
  '    im.forEach(c=>{ if(!get(r,c)) blank++; });',
  '    if(r.staff.rule===RULE_NORMAL){',
  '      let pub=0; im.forEach(c=>{ if(isPubOff(get(r,c))) pub++; });',
  '      if(pub!==q) quotaNg++; } });',
  '  return {low, lowSum, high, blank, work, quotaNg, closer, placed, lowByDow, rerun};',
  '}',
  'return { trial };'
].join('\n'))();

/* ── 試行 ────────────────────────────────────────────── */
const setup = JSON.parse(fs.readFileSync('prototype/samples/setup-onsite.json', 'utf8'));
const files = fs.readdirSync('prototype/samples')
  .filter(f => f.startsWith('doctor-') && f.endsWith('.json')).sort();

const LEVELS = [
  { name: '少', days: 0, note: '派遣なし' },
  { name: '中', days: 12, note: '2名で計12人日' },
  { name: '多', days: 26, note: '2名で計26人日' },
];

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const rows = [];
let ng = 0;

files.forEach(f => {
  const doc = JSON.parse(fs.readFileSync('prototype/samples/' + f, 'utf8')).shift;
  LEVELS.forEach(lv => {
    const r = api.trial(JSON.parse(JSON.stringify(setup)), doc, lv.days);
    rows.push({ pattern: f.replace('.json', '').replace('doctor-', ''), level: lv, r });
    if (!r.rerun) { ng++; console.log('  NG 2回目で結果が変わった ' + f + ' / 派遣' + lv.name); }
    if (r.quotaNg) { ng++; console.log('  NG 公休ノルマ違反 ' + f + ' / 派遣' + lv.name + ' → ' + r.quotaNg + ' 名'); }
  });
});

/* ── 結果 ────────────────────────────────────────────── */
console.log('医師パターン10種 × 派遣3水準 = ' + rows.length + ' 通り   2026年10月・現場構成');
console.log('');
console.log('  医師パターン        派遣  実配置  延べ出勤  下限割れ  不足人日  上限超え  締め不在');
let cur = '';
rows.forEach(x => {
  const head = x.pattern === cur ? ''.padEnd(18) : x.pattern.padEnd(18);
  cur = x.pattern;
  console.log('  ' + head + x.level.name.padEnd(5)
    + String(x.r.placed).padStart(4) + '日'
    + String(x.r.work).padStart(8) + '人日'
    + String(x.r.low).padStart(8) + '日'
    + String(x.r.lowSum).padStart(9) + '人日'
    + String(x.r.high).padStart(8) + '日'
    + String(x.r.closer).padStart(8) + '日');
});

/* ── 分析 ────────────────────────────────────────────── */
console.log('');
console.log('══ 分析 ═══════════════════════════════════════════');

console.log('');
console.log('■ 派遣を増やすと不足はどれだけ減るか（不足人日）');
console.log('  ※ 不足は needOf_ の下限に対する数。曜日別下限は医師名が入った日には');
console.log('    効かない（rules.floorOnlyWhenNoDoctor）ので、医師シフトを入れた');
console.log('    この試行では下限は医師0人の日にしか出てこない');
console.log('  医師パターン        少 → 中 → 多      中の効き  多の効き  1人日あたり');
rows.filter(x => x.level.name === '少').forEach(a => {
  const b = rows.find(x => x.pattern === a.pattern && x.level.name === '中');
  const c = rows.find(x => x.pattern === a.pattern && x.level.name === '多');
  const g1 = a.r.lowSum - b.r.lowSum;
  const g2 = b.r.lowSum - c.r.lowSum;
  const eff = c.r.placed ? ((a.r.lowSum - c.r.lowSum) / c.r.placed) : 0;
  console.log('  ' + a.pattern.padEnd(18)
    + (a.r.lowSum + ' → ' + b.r.lowSum + ' → ' + c.r.lowSum).padEnd(18)
    + String(g1).padStart(6) + String(g2).padStart(10)
    + eff.toFixed(2).padStart(12));
});

console.log('');
console.log('■ 不足が出る曜日（派遣なしのとき）');
console.log('  医師パターン        ' + DOW.map(d => d + '曜').join(' '));
rows.filter(x => x.level.name === '少').forEach(a => {
  console.log('  ' + a.pattern.padEnd(18)
    + a.r.lowByDow.map(n => String(n).padStart(2) + '日').join(' '));
});

console.log('');
console.log('■ 派遣は社員の出勤を減らさない（延べ出勤の内訳）');
console.log('  派遣  延べ出勤  うち派遣  社員ぶん');
LEVELS.forEach(lv => {
  const set = rows.filter(x => x.level.name === lv.name);
  const work = Math.round(set.reduce((a, x) => a + x.r.work, 0) / set.length);
  const disp = Math.round(set.reduce((a, x) => a + x.r.placed, 0) / set.length);
  console.log('  ' + lv.name.padEnd(5) + String(work).padStart(6) + '人日'
    + String(disp).padStart(8) + '人日' + String(work - disp).padStart(8) + '人日');
});
console.log('  → 社員ぶんは動かない。公休ノルマで総量が決まっているため。');
console.log('    派遣はそのぶん上乗せになる');

console.log('');
console.log('■ 不足と過剰のつり合い（平均）');
console.log('  派遣   不足日数  上限超え日数');
LEVELS.forEach(lv => {
  const set = rows.filter(x => x.level.name === lv.name);
  const low = (set.reduce((a, x) => a + x.r.low, 0) / set.length).toFixed(1);
  const high = (set.reduce((a, x) => a + x.r.high, 0) / set.length).toFixed(1);
  console.log('  ' + lv.name.padEnd(6) + String(low).padStart(7) + '日'
    + String(high).padStart(11) + '日');
});
const anyLow = rows.some(x => x.r.low > 0);
if (anyLow) {
  console.log('  → 派遣を増やすと不足は消えるが、代わりに上限超えが増える。');
  console.log('    社員を減らせない以上、入れた派遣はどこかで余る');
} else {
  console.log('  → 医師シフトが入っていれば、派遣なしでも全パターンで不足ゼロ。');
  console.log('    社員の総量は公休ノルマで決まっていて動かないので、');
  console.log('    入れた派遣はまるごと上乗せになり、上限超えだけが増える');
}

console.log('');
console.log('■ 派遣を最大まで入れても残る不足');
const rest = rows.filter(x => x.level.name === '多' && x.r.lowSum > 0)
  .sort((a, b) => b.r.lowSum - a.r.lowSum);
if (!rest.length) console.log('  なし（すべて解消）');
rest.forEach(x => console.log('  ' + x.pattern.padEnd(18) + x.r.lowSum + ' 人日'));

console.log('');
console.log('■ 締め作業ができる人がいない日');
const noCloser = rows.filter(x => x.r.closer > 0);
if (!noCloser.length) console.log('  なし');
else {
  const worst = noCloser.sort((a, b) => b.r.closer - a.r.closer)[0];
  console.log('  最大 ' + worst.r.closer + ' 日（' + worst.pattern + ' / 派遣' + worst.level.name + '）');
  console.log('  ※ 派遣は締め作業ができないので、増やしても解消しない');
}

console.log('');
console.log('■ 公休ノルマ');
console.log(ng ? ('  ★ 違反 ' + ng + ' 件')
  : '  全' + rows.length + '通りで全員ノルマちょうど（派遣の量に影響されない）');

console.log('');
console.log(ng ? ('★ NG ' + ng + ' 件')
  : rows.length + '通り: 公休ノルマを崩さずに回りきった');
process.exit(ng ? 1 : 0);
