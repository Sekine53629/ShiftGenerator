// 「必ず出る曜日」が どの勤務ルールでも守られるかを確かめる。
const fs = require('fs');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(n) {
  const at = src.indexOf('function ' + n + '(');
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
  'offQuotaFor', 'buildWeeks', 'seamWorkedOf_', 'planOf_', 'seamRunOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_', 'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_', 'verifyWeeks_', 'needOf_', 'reqPlusOf_', 'needOf_', 'clerkCapOf_', 'firstOverrun_', 'normDow_', 'syncDemand_', 'migrateDb_'];

// 医師名欄の行数まわり（clamp_ / DOC_ROWS_* / docRowCount_ / busyDocN_）を
// HTML から丸ごと取る。seedDb と migrateDb_ がこれを参照する。
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);

// 保存済みデータの版と、古い値の手当て。seedDb / migrateDb_ が参照する
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);

const run = new Function('staff', 'y', 'm', [
  'const DAY_COLS=31; const DOW=["日","月","火","水","木","金","土"];',
  RULE, DOC_BLOCK, MIG_BLOCK, L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  upto('const dowNames_ ='), FN.map(grab).join('\n'),
  'const DB=migrateDb_(seedDb()); const activeStore="st1";',
  'DB.staff=staff; DB.rules.maxConsDefault=3;',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const pubOffSyms=()=>DB.patterns.filter(p=>!p.work&&p.pubOff).map(p=>p.sym);',
  'const isPubOff=v=>!!v&&pubOffSyms().indexOf(v)>=0;',
  'let curYear_=y, curMonth_=m;',
  'const values=new Map(); let curYm=y+"-"+String(m).padStart(2,"0");',
  'let days=buildDays(y,m);',
  upto('const cellKey ='), upto('const handKey ='), upto('const isHand ='),
  'const get=(r,c)=>values.get(cellKey(r,c))||"";',
  'const setV=(r,c,v)=>{if(v)values.set(cellKey(r,c),v);else values.delete(cellKey(r,c));};',
  'const docCount=()=>0; const paintRow=()=>{}; let autoNotes = []; let allocInfo = ""; let allocByCol = [];',
  'const note_=t=>{if(autoNotes.indexOf(t)<0)autoNotes.push(t);};',
  'const ROWS=staff.map((s,i)=>({kind:"staff",index:i,key:s.id,label:s.name,staff:s,',
  '  role:s.kind==="事務員"?"clerk":(s.employment==="派遣"?"dispatch":"pharm")}));',
  'const w=buildWeeks();',
  'placeAllStaff_(w,"公休");',
  'return {days,ROWS,get,isWork,isPubOff,notes:autoNotes,quota:offQuotaBase()};'
].join('\n'));

const DOW = ['日', '月', '火', '水', '木', '金', '土'];
const dow = (...ok) => [0, 1, 2, 3, 4, 5, 6].map(d => (ok.indexOf(d) >= 0 ? 1 : 0));
const ALL = [1, 1, 1, 1, 1, 1, 1], NONE = [0, 0, 0, 0, 0, 0, 0];
const P = (id, name, rule, week, avail, fixed, cons, wantOff) => ({
  id, name, kind: '薬剤師', employment: '社員', weekDays: week, maxCons: cons || 5,
  patterns: ['○', '●', '▲'], availDow: avail, fixedDow: fixed,
  wantOffDow: wantOff || NONE, canClose: true,
  from: '', to: '', rule, memo: '', annualOff: '', hq: false, stores: ['st1']
});

const staff = [
  P('a', '通常・指定なし', '通常', 5, ALL, NONE),
  P('b', '通常・月必ず', '通常', 5, ALL, dow(1)),
  P('c', '通常・月木必ず', '通常', 5, ALL, dow(1, 4)),
  P('d', '週N日・火金必ず', '週N日', 4, ALL, dow(2, 5)),
  P('e', '固定曜日・月水金', '固定曜日', 3, ALL, dow(1, 3, 5)),
  P('f', '固定曜日・指定なし', '固定曜日', 3, dow(1, 2, 5, 6), NONE),
  P('g', '通常・出られない日を必須', '通常', 5, dow(1, 2, 3, 4, 5), dow(0)),
  P('h', '通常・水木は休みたい', '通常', 5, ALL, NONE, 5, dow(3, 4)),
];

let bad = 0;
[[2026, 10], [2026, 11]].forEach(([y, m]) => {
  const r = run(staff, y, m);
  const im = [];
  for (let c = 0; c < 31; c++) if (r.days[c].inMonth) im.push(c);
  console.log('');
  console.log('══ ' + y + '年' + m + '月  公休ノルマ ' + r.quota + ' 日');
  r.ROWS.forEach(row => {
    const s = row.staff;
    const must = im.filter(c => s.fixedDow[r.days[c].dow]);
    const missed = must.filter(c => !r.isWork(r.get(row, c)));
    const work = im.filter(c => r.isWork(r.get(row, c)));
    const pub = im.filter(c => r.isPubOff(r.get(row, c))).length;
    const dows = [...new Set(work.map(c => r.days[c].dow))].sort().map(d => DOW[d]).join('');
    const okMust = missed.length === 0;
    // 出られない曜日を必須にした人は、守れなくて当然（矛盾として警告が出る）
    const expectFail = s.fixedDow.some((v, i) => v && !s.availDow[i]);
    if (!okMust && !expectFail) { bad++; }
    console.log('  ' + s.name.padEnd(24) + s.rule.padEnd(8)
      + ' 出勤' + String(work.length).padStart(3) + ' 公休' + String(pub).padStart(3)
      + '  必須' + String(must.length).padStart(2) + '日中 守れた'
      + String(must.length - missed.length).padStart(2) + '日'
      + (okMust ? '  OK' : (expectFail ? '  （矛盾。警告あり）' : '  ★NG'))
      + '   出た曜日:' + (dows || 'なし'));
  });
  if (r.notes.length) {
    // 「できるだけ休みたい曜日」が効いているか。指定なしの人と比べる
  {
    const cnt = (id, dows) => {
      const row = r.ROWS.find(x => x.staff.id === id);
      return im.filter(c => dows.indexOf(r.days[c].dow) >= 0 && r.isWork(r.get(row, c))).length;
    };
    const base = cnt('a', [3, 4]);
    const want = cnt('h', [3, 4]);
    console.log('  水木の出勤 … 指定なし ' + base + ' 日 / 休みたい ' + want + ' 日'
      + (want < base ? '  効いている' : '  ★効いていない'));
    if (want >= base) bad++;
  }
  console.log('  申し送り:');
    [...new Set(r.notes)].forEach(t => console.log('    ・' + t));
  }
});

console.log('');
console.log(bad ? ('★ 守られなかった組 ' + bad) : '「必ず出る曜日」はすべてのルールで守られた');
process.exit(bad ? 1 : 0);
