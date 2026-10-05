// prototype/samples/staff-*.json を実際に配置へ通し、結果を要約する。
const fs = require('fs');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(n) {
  const at = src.indexOf('function ' + n + '(');
  if (at < 0) throw new Error(n);
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++;
    else if (src[j] === '}') { d--; if (!d) return src.slice(at, j + 1); }
  }
}
const L = t => src.split(/\r?\n/).find(l => l.includes(t));
const RULE_BLOCK = (() => {
  const a = src.indexOf('const RULE_NORMAL');
  const b = src.indexOf('const usesQuota');
  return src.slice(a, src.indexOf(';', b) + 1);
})();
const FNS = ['seedDb', 'nthMonday', 'holidaysOf', 'parseMonthDay', 'daysOfRangeInMonth',
  'closureMap', 'holidayInfoOf', 'storeRows', 'hoursOf', 'buildDays', 'addRollShares_', 'offQuotaBase',
  'offQuotaFor', 'buildWeeks', 'seamWorkedOf_', 'planOf_', 'seamRunOf_', 'busyDays_', 'placeAllStaff_', 'priorityOf_', 'rotateRank_', 'needModel_', 'needModelOf_', 'staffNeedOf_', 'staffNeedAt_', 'avgDocsOf_', 'quietDow_', 'staffBaseOf_', 'allocateStaff_', 'verifyWeeks_', 'needOf_', 'reqPlusOf_', 'needOf_', 'clerkCapOf_', 'firstOverrun_'];

// 医師名欄の行数まわり（clamp_ / DOC_ROWS_* / docRowCount_ / busyDocN_）を
// HTML から丸ごと取る。seedDb と migrateDb_ がこれを参照する。
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);

// 保存済みデータの版と、古い値の手当て。seedDb / migrateDb_ が参照する
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);

const make = new Function([
  'const DAY_COLS=31;', DOC_BLOCK, MIG_BLOCK, RULE_BLOCK,
  L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  FNS.map(grab).join('\n'),
  'const DB=seedDb(); const activeStore="st1";',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const pubOffSyms=()=>DB.patterns.filter(p=>!p.work&&p.pubOff).map(p=>p.sym);',
  'const isPubOff=v=>!!v&&pubOffSyms().indexOf(v)>=0;',
  'let curYear_=0, curMonth_=0;',
  'const values=new Map();',
  'const get=(row,c)=>values.get(row.key+"|"+c)||"";',
  'const setV=(row,c,v)=>{if(v)values.set(row.key+"|"+c,v);else values.delete(row.key+"|"+c);};',
  'const isHand=()=>false;',
  'let docShift=null;',
  'function docCount(c){ if(!docShift) return 0; let n=0;',
  '  ["doc1","doc2","doc3","doc4","doc5"].forEach(k=>{ if(docShift[k]&&docShift[k][days[c].day]) n++; }); return n; }',
  'const paintRow=()=>{}; let autoNotes = []; let allocInfo = ""; let allocByCol = [];',
  'const note_=t=>{if(autoNotes.indexOf(t)<0)autoNotes.push(t);};',
  'let ROWS=[]; let days=[];',
  'function inService(s,y,m){ const ym=y*100+m;',
  '  const num=t=>{const p=String(t||"").split(/[-\\/]/); return p.length>=2?Number(p[0])*100+Number(p[1]):0;};',
  '  const f=num(s.from), t=num(s.to); if(f&&ym<f) return false; if(t&&ym>t) return false; return true; }',
  'return function(staffList, y, m, doc, hours, rules){',
  '  DB.staff = staffList; docShift = doc; curYear_=y; curMonth_=m;',
  '  // 指定が無いパターンは初期値へ戻す。前のパターンの設定が残ると数字が狂う',
  '  const base = seedDb();',
  '  DB.hours = hours ? hours : base.hours;',
  '  DB.rules = Object.assign(base.rules, rules || {});',
  '  curYear_=y; curMonth_=m; days = buildDays(y,m); values.clear(); autoNotes=[];',
  '  const live = staffList.filter(s=>inService(s,y,m));',
  '  ROWS = live.map((s,i)=>({kind:"staff",index:i,key:s.id,label:s.name,staff:s,',
  '    role: s.kind==="事務員"?"clerk":(s.employment==="派遣"?"dispatch":"pharm")}));',
  '  const weeks = buildWeeks();',
  '  placeAllStaff_(weeks,"公休");',
  '  return {days,weeks,ROWS,DB,get,isWork,isPubOff,offQuotaFor,needOf_,',
  '          quota:offQuotaBase(),notes:autoNotes,docCount};',
  '};'
].join('\n'))();

const longest = (pred, cols) => {
  let b = 0, c = 0;
  cols.forEach(x => { if (pred(x)) { c++; b = Math.max(b, c); } else c = 0; });
  return b;
};

const staffFiles = fs.readdirSync('prototype/samples')
  .filter(f => (f.startsWith('staff-') || f.startsWith('setup-')) && f.endsWith('.json'));
const doc = JSON.parse(fs.readFileSync('prototype/samples/doctor-01-standard.json', 'utf8')).shift;

let bad = 0;
staffFiles.forEach(f => {
  const j = JSON.parse(fs.readFileSync('prototype/samples/' + f, 'utf8'));
  [[2026, 10], [2026, 11]].forEach(([y, m]) => {
    const r = make(j.staff, y, m, m === 10 ? doc : null, j.hours, j.rules);
    const im = [];
    for (let c = 0; c < 31; c++) if (r.days[c].inMonth) im.push(c);

    let ok = true, blanks = 0, autoN = 0;
    r.ROWS.forEach(row => {
      const s = row.staff;
      if (s.rule === '手動') return;
      autoN++;
      const pub = im.filter(c => r.isPubOff(r.get(row, c))).length;
      const q = r.offQuotaFor();
      const cap = s.maxCons || r.DB.rules.maxConsDefault;
      const run = longest(c => r.isWork(r.get(row, c)), im);
      blanks += im.filter(c => !r.get(row, c)).length;
      if (s.rule === '通常' && pub !== q) { ok = false; console.log('    NG 公休 ' + s.name + ' ' + pub + '≠' + q); bad++; }
      if (run > cap) { ok = false; console.log('    NG 連勤 ' + s.name + ' ' + run + '>' + cap); bad++; }
      if (s.rule !== '固定曜日') r.weeks.forEach((w, i) => {
        const on = w.cols.filter(c => r.isWork(r.get(row, c))).length;
        const lim = Math.min(Number(s.weekDays) || 0, w.cols.length);
        if (on > lim) { ok = false; console.log('    NG 週 ' + s.name + ' 第' + (i + 1) + '週 ' + on + '>' + lim); bad++; }
      });
    });

    // 必要人数を割る日。
    // 必要人数は needOf_ が決める。曜日別下限はその内訳のひとつでしかなく、
    // 既定では医師名が入っている日には効かない。生の下限で測ると、
    // エンジンが見ていない値を割った日まで数えてしまう。
    let shortDays = 0, floorDays = 0;
    im.forEach(c => {
      if (!r.days[c].open) return;
      let on = 0;
      r.ROWS.forEach(row => {
        if (row.role !== 'clerk' && r.isWork(r.get(row, c))) on++;
      });
      if (on < r.needOf_(c).min) shortDays++;
      if (on < r.days[c].pharmMin) floorDays++;      // 参考値
    });

    console.log('  ' + f.replace('.json', '').padEnd(20) + y + '/' + String(m).padStart(2, '0')
      + '  在籍' + String(r.ROWS.length).padStart(2) + '名(自動' + autoN + ')'
      + '  ノルマ' + String(r.quota).padStart(2)
      + '  記号未定' + String(blanks).padStart(3) + '日'
      + '  必要人数割れ' + String(shortDays).padStart(2) + '日'
      + '（曜日下限では' + String(floorDays).padStart(2) + '日）'
      + '  ' + (ok ? '整合OK' : '★NG'));
    if (r.notes.length) {
      const uniq = [...new Set(r.notes.map(t => t.replace(/^[^：]+：/, '')))];
      uniq.slice(0, 3).forEach(t => console.log('      ・' + t));
      if (uniq.length > 3) console.log('      ・ほか ' + (uniq.length - 3) + ' 種');
    }
  });
});

console.log('');
console.log(bad ? ('整合 NG ' + bad + ' 件') : 'すべてのパターンで 公休ビタビタ／連勤上限／週上限 を満たした');
process.exit(bad ? 1 : 0);
