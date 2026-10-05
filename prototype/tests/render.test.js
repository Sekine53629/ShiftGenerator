// 表を組み立てた時点で、セルの中身まで書けているかを確かめる。
//
// 「データは正しいのに表示だけ空」は、集計だけが動くので気づきにくい。
// 実際、tbody を document に入れる前に document.querySelector で
// セルを探していたため、スタッフ欄が空のまま出る不具合があった。
// 最小限の DOM を用意して、組み立て結果を直接見る。
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

/* ── 最小限の DOM ────────────────────────────────────── */
function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    children: [], _text: '', className: '', title: '', colSpan: 1,
    dataset: {}, style: {}, attrs: {},
    classList: {
      add(c) { if (!node.className.split(' ').includes(c)) node.className = (node.className + ' ' + c).trim(); },
      remove(c) { node.className = node.className.split(' ').filter(x => x && x !== c).join(' '); },
      contains(c) { return node.className.split(' ').includes(c); },
      toggle(c, on) { if (on) node.classList.add(c); else node.classList.remove(c); },
    },
    appendChild(c) { node.children.push(c); return c; },
    setAttribute(k, v) { node.attrs[k] = v; },
    addEventListener() {},
    get textContent() {
      return node._text + node.children.map(c => c.textContent).join('');
    },
    set textContent(v) { node._text = String(v); node.children = []; },
    querySelector(sel) {
      const hit = n => (sel.startsWith('.')
        ? n.classList && n.classList.contains(sel.slice(1))
        : n.tagName === sel.toUpperCase());
      const walk = n => {
        for (const c of n.children) {
          if (hit(c)) return c;
          const r = walk(c);
          if (r) return r;
        }
        return null;
      };
      return walk(node);
    },
  };
  return node;
}
const document = {
  createElement: makeNode,
  querySelector: () => null,          // ここが null を返すのが以前の落とし穴
  querySelectorAll: () => [],
};

/* ── 本体から必要な関数を取り出す ─────────────────────── */
const FN = ['seedDb', 'nthMonday', 'holidaysOf', 'parseMonthDay', 'daysOfRangeInMonth',
  'closureMap', 'holidayInfoOf', 'storeRows', 'hoursOf', 'buildDays', 'addRollShares_', 'normDow_',
  'syncDemand_', 'migrateDb_', 'inService', 'belongsHere', 'buildRows', 'needOf_', 'reqPlusOf_', 'offQuotaBase',
  'offQuotaFor', 'annualQuotaOf', 'clearAnnualCache_', 'staffTip', 'dayClass',
  'dayTip', 'headCells', 'el', 'naDay_', 'fillCell_', 'isUserCell_', 'buildBody', 'clerkCapOf_'];

// 医師名欄の行数まわり（clamp_ / DOC_ROWS_* / docRowCount_ / busyDocN_）を
// HTML から丸ごと取る。seedDb と migrateDb_ がこれを参照する。
const DOC_BLOCK = src.slice(src.indexOf('const clamp_ ='),
  src.indexOf('}', src.indexOf('function busyDocN_')) + 1);

// 保存済みデータの版と、古い値の手当て。seedDb / migrateDb_ が参照する
const MIG_BLOCK = src.slice(src.indexOf('const SCHEMA_VERSION ='),
  src.indexOf('\n  }', src.indexOf('function fixOldValues_')) + 4);

const run = new Function('document', [
  'const DAY_COLS=31; const DOC_ROWS=5;',
  'const DOW=["日","月","火","水","木","金","土"];',
  RULE, DOC_BLOCK, MIG_BLOCK, L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  src.slice(src.indexOf('const AGG_COLS'), src.indexOf('];', src.indexOf('const AGG_COLS')) + 2),
  L('  const aggHead_ ='),   // 「◯診出勤」の見出しは設定で変わるので描くときに作る
  FN.map(grab).join('\n'),
  L('  const isInput ='), upto('const dowNames_ ='), L('  const closedClass ='),
  L('  const isClosed ='), L('  const byOrder ='),
  'const DB=migrateDb_(seedDb()); const activeStore="st1";',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const values=new Map(); let curYm="2026-10";',
  'let days=buildDays(2026,10);',
  upto('const cellKey ='), upto('const handKey ='), upto('const isHand ='),
  // 色の印。記号とは別の層で背景を塗る
  upto('const markKey ='), L('  const getMark ='), L('  const markOf ='),
  'const get=(r,c)=>values.get(cellKey(r,c))||"";',
  'const setV=(r,c,v)=>{if(v)values.set(cellKey(r,c),v);else values.delete(cellKey(r,c));};',
  'const docCount=()=>0;',
  'let ROWS=buildRows(2026,10);',
  // 医師・スタッフ・備考に値を入れてから組み立てる
  'ROWS.forEach(r=>{',
  '  if(r.kind==="doctor") setV(r,0,"医A");',
  '  if(r.kind==="staff"){ setV(r,0,"○"); setV(r,1,"公休"); }',
  '  if(r.kind==="note") setV(r,0,"銀行"); });',
  'const body = buildBody();',
  'return { body, ROWS };'
].join('\n'))(document);

/* ── 検査 ────────────────────────────────────────────── */
let ng = 0;
const check = (ok, label, detail) => {
  if (!ok) { ng++; console.log('  NG  ' + label + (detail ? '  ' + detail : '')); }
};

// 組み立てた tbody から、行ごとの1〜2日目の中身を拾う
function readRow(body, rowIndex) {
  const tr = body.children.find(t =>
    t.children.some(td => td.dataset && String(td.dataset.row) === String(rowIndex)));
  if (!tr) return null;
  const cells = tr.children.filter(td => td.dataset && td.dataset.col !== undefined);
  return cells.slice(0, 2).map(td => {
    const inp = td.querySelector('input');
    if (inp) return inp.value || '';
    const v = td.querySelector('.v');
    return v ? v.textContent : '';
  });
}

console.log('■ 表を組み立てた時点で、セルの中身が書けているか');
const kinds = { doctor: null, staff: null, note: null };
run.ROWS.forEach(r => {
  if (kinds[r.kind] === null) kinds[r.kind] = readRow(run.body, r.index);
});
Object.keys(kinds).forEach(k => {
  const got = kinds[k];
  console.log('  ' + k.padEnd(8) + JSON.stringify(got));
});
check(kinds.doctor && kinds.doctor[0] === '医A', '医師名欄が書けている', JSON.stringify(kinds.doctor));
check(kinds.staff && kinds.staff[0] === '○' && kinds.staff[1] === '公休',
  'スタッフ欄が書けている', JSON.stringify(kinds.staff));
check(kinds.note && kinds.note[0] === '銀行', '備考行が書けている', JSON.stringify(kinds.note));

console.log('');
console.log('■ 出られない曜日が灰色になるか（実物と同じ扱い）');

// 実物のシフト表は、出られない曜日のセルを #d0cece で潰している。
// マスタには入っているのに表からは読み取れず、空欄と見分けが付かなかった。
const naRun = new Function('document', [
  'const DAY_COLS=31;', DOC_BLOCK, MIG_BLOCK,
  'const DOW=["日","月","火","水","木","金","土"];',
  RULE, L('const DAYS_IN_MONTH'), L('const vernalDay'), L('const autumnalDay'),
  src.slice(src.indexOf('const AGG_COLS'), src.indexOf('];', src.indexOf('const AGG_COLS')) + 2),
  L('  const aggHead_ ='),
  FN.map(grab).join('\n'),
  L('  const isInput ='), upto('const dowNames_ ='),
  L('  const closedClass ='), L('  const isClosed ='), L('  const byOrder ='),
  'let DB=migrateDb_(seedDb()); const activeStore="st1";',
  'const workSyms=()=>DB.patterns.filter(p=>p.work).map(p=>p.sym);',
  'const isWork=v=>v==="◯"||workSyms().indexOf(v)>=0;',
  'const pubOffSyms=()=>DB.patterns.filter(p=>!p.work&&p.pubOff).map(p=>p.sym);',
  'const isPubOff=v=>!!v&&pubOffSyms().indexOf(v)>=0;',
  'const values=new Map(); let curYm="2026-10";',
  'let curYear_=2026, curMonth_=10;',
  upto('const cellKey ='), upto('const handKey ='), upto('const isHand ='),
  // 色の印。記号とは別の層で背景を塗る
  upto('const markKey ='), L('  const getMark ='), L('  const markOf ='),
  'const get=(r,c)=>values.get(cellKey(r,c))||"";',
  'const setV=(r,c,v)=>{if(v)values.set(cellKey(r,c),v);else values.delete(cellKey(r,c));};',
  'const docCount=()=>0; const paintRow=()=>{};',
  'let days=buildDays(2026,10);',
  // 1人だけ 月火金土 しか出られなくする（実物の「(月火金土18時)」と同じ形）
  'DB.staff.forEach((s,i)=>{ s.availDow = i===0 ? [0,1,1,0,0,1,1] : [1,1,1,1,1,1,1]; });',
  'let ROWS=buildRows(2026,10);',
  'const body = buildBody();',
  'return { body, ROWS, days, DB };'
].join('\n'))(document);

function cellsOf(body, rowIndex) {
  const tr = body.children.find(t =>
    t.children.some(td => td.dataset && String(td.dataset.row) === String(rowIndex)));
  if (!tr) return [];
  return tr.children.filter(td => td.dataset && td.dataset.col !== undefined);
}

const limited = naRun.ROWS.find(r => r.kind === 'staff');
const free = naRun.ROWS.filter(r => r.kind === 'staff')[1];
const limCells = cellsOf(naRun.body, limited.index);
const freeCells = cellsOf(naRun.body, free.index);

let wrongOn = 0, wrongOff = 0;
limCells.forEach((td, c) => {
  const info = naRun.days[c];
  if (!info || !info.inMonth) return;
  const na = String(td.className).split(/\s+/).indexOf('na') >= 0;
  const canWork = !!limited.staff.availDow[info.dow];
  if (canWork && na) wrongOn++;          // 出られる日に灰色が付いた
  if (!canWork && !na) wrongOff++;       // 出られない日に灰色が付かない
});
check(wrongOn === 0, '出られる曜日に灰色を付けていない', '誤 ' + wrongOn + ' 件');
check(wrongOff === 0, '出られない曜日をすべて灰色にした', '漏れ ' + wrongOff + ' 件');

const anyFree = freeCells.some(td => String(td.className).split(/\s+/).indexOf('na') >= 0);
check(!anyFree, '全曜日出られる人には灰色を付けない');

const naCount = limCells.filter(td =>
  String(td.className).split(/\s+/).indexOf('na') >= 0).length;
console.log('  月火金土のみ出勤の人: 灰色 ' + naCount + ' 日 / 31 日中');
check(naCount > 0, '灰色が1つも付いていない');

// 医師欄・備考行には付けない（出られる曜日は社員だけの設定）
const docRow = naRun.ROWS.find(r => r.kind === 'doctor');
const docNa = cellsOf(naRun.body, docRow.index).some(td =>
  String(td.className).split(/\s+/).indexOf('na') >= 0);
check(!docNa, '医師欄には灰色を付けない');

console.log('');
console.log('■ 今月の入力を消す（医師シフトとそれ以外を分ける）');

// 先に医師シフトを入れてから自動生成する手順なので、スタッフをやり直すたびに
// 医師名まで消えると入れ直しになる。だから2つに分けてある。
const clearRun = new Function([
  "const curYm = '2026-08';",
  'const values = new Map();',
  grab('clearMonth_'),
  'return { values, clearMonth_ };',
].join('\n'))();

function seedCells() {
  const v = clearRun.values;
  v.clear();
  v.set('doc1|2026-08|1', '医A');
  v.set('doc6|2026-08|3', '医B');
  v.set('mark:doc1|2026-08|1', 'mk1');
  v.set('s001|2026-08|1', '○');
  v.set('s012|2026-08|5', '公休');
  v.set('mark:s001|2026-08|1', 'mk1');
  v.set('note|2026-08|9', '棚卸');
  v.set('memo|2026-08', '【1on1日程】…');
  v.set('doc1|2026-09|1', '医C');       // 別の月
  v.set('s001|2026-09|1', '▲');         // 別の月
  return v;
}
const keys = () => Array.from(clearRun.values.keys()).sort();

seedCells();
clearRun.clearMonth_('doctor');
check(!clearRun.values.has('doc1|2026-08|1'), '医師シフトが消える');
check(!clearRun.values.has('doc6|2026-08|3'), '医師6行目も消える');
check(!clearRun.values.has('mark:doc1|2026-08|1'), '医師欄の色の印も消える');
check(clearRun.values.has('s001|2026-08|1'), 'スタッフは残る', keys().join(' '));
check(clearRun.values.has('mark:s001|2026-08|1'), 'スタッフの色の印は残る');
check(clearRun.values.has('note|2026-08|9'), '備考行は残る');
check(clearRun.values.has('memo|2026-08'), '注記は残る');
check(clearRun.values.has('doc1|2026-09|1'), '別の月の医師シフトは残る');

seedCells();
clearRun.clearMonth_('other');
check(clearRun.values.has('doc1|2026-08|1'), '医師シフトは残る');
check(clearRun.values.has('mark:doc1|2026-08|1'), '医師欄の色の印は残る');
check(!clearRun.values.has('s001|2026-08|1'), 'スタッフが消える');
check(!clearRun.values.has('s012|2026-08|5'), '公休も消える');
check(!clearRun.values.has('mark:s001|2026-08|1'), 'スタッフの色の印も消える');
check(!clearRun.values.has('note|2026-08|9'), '備考行も消える');
check(clearRun.values.has('memo|2026-08'), '注記は消さない（1on1や休憩の割り当てが入る）');
check(clearRun.values.has('s001|2026-09|1'), '別の月のスタッフは残る');

seedCells();
clearRun.clearMonth_('doctor');
clearRun.clearMonth_('other');
check(keys().join(' ') === 'doc1|2026-09|1 memo|2026-08 s001|2026-09|1',
  '両方押すと、今月は注記だけが残る', keys().join(' '));

console.log('');
console.log('■ 印刷の倍率と行の高さ');

// **倍率は横幅に合わせる。** 高さで倍率を下げると幅も一緒に痩せて、
// 紙の右側が大きく余る。高さは行を詰めて合わせる。
const fitRun = new Function([
  L('  const PRINT_W ='), L('  const PRINT_H ='),
  L('  const PRINT_MIN_ZOOM ='), L('  const PRINT_CELL_MIN ='),
  L('  const PRINT_TEXT_MIN ='),
  "const PRINT_SIZES = { '--cell-h': '15px' };",
  'let printZoom = 1; let W = 0, H = 0; let CELL = null;',
  // 印刷指定の写しは DOM が要る。ここでは着せずに素通りさせる
  'function printMetrics_(){}',
  'const document = { documentElement: { style: {',
  '  setProperty(k, v){ if (k === "--cell-h") { CELL = parseFloat(v);',
  '    H = H * (CELL / 15); } },',
  '  removeProperty(){} } } };',
  'const $ = () => ({ scrollWidth: W, get scrollHeight(){ return H; },',
  '  querySelectorAll: () => [] });',
  grab('widthEm_'),
  'document.querySelector = () => ({ offsetHeight: 0 });',
  grab('fitPrint_'),
  'return { set: (w,h) => { W=w; H=h; CELL=null; }, fitPrint_,',
  '         zoom: () => printZoom, cell: () => CELL };',
].join('\n'))();

fitRun.set(1078, 400);
check(fitRun.fitPrint_() === 1, '入りきるときは縮めない', String(fitRun.fitPrint_()));

fitRun.set(1078, 900);          // 高さが1.4倍
fitRun.fitPrint_();
check(fitRun.zoom() === 1, '高さが余っても倍率は下げない（幅が痩せる）',
  String(fitRun.zoom()));
check(fitRun.cell() !== null && fitRun.cell() < 15,
  '行を詰めて高さを合わせる', String(fitRun.cell()));

fitRun.set(1600, 400);          // 幅が超過
const z3 = fitRun.fitPrint_();
check(z3 > 0.68 && z3 < 0.7, '幅が超えたときだけ倍率を下げる', z3.toFixed(3));

fitRun.set(1078, 300);
check(fitRun.fitPrint_() === 1, '拡大はしない', String(fitRun.fitPrint_()));

fitRun.set(1078, 4000);         // 行が極端に多い
fitRun.fitPrint_();
check(fitRun.cell() >= 9, '行の高さは下限で止める', String(fitRun.cell()));
check(fitRun.zoom() < 1, '詰めきれないときは倍率も下げる', String(fitRun.zoom()));
check(fitRun.zoom() >= 0.5, '倍率の下限は守る', String(fitRun.zoom()));

// 画面の見た目のまま測ると外す。注記は画面では入力欄、紙では 7pt の本文。
// 実測で 244px も多く見積もり、要らない縮小がかかっていた。
{
  const fp = grab('fitPrint_');
  check(/printMetrics_\(true\)/.test(fp) && fp.indexOf('printMetrics_(true)')
        < fp.indexOf('scrollWidth'),
    '測る前に印刷用の見た目を着せている');
  check((fp.match(/printMetrics_\(false\)/g) || []).length >= 2,
    '測り終えたら脱ぐ（早く返る道も含めて）');
  const pm = grab('printMetrics_');
  check(/\/print\/\.test/.test(pm), '@media print の指定を写している');
  check(/zoom/.test(pm) && /replace/.test(pm),
    '倍率だけは写さない（これから決めるので）');
  // 印刷の寸法は一箇所からしか出ない。二重に書くと片方だけ直して食い違う
  check(!/@media print\{:root\{[^}]*--cell-h:\s*\d/.test(src.replace(/\s+/g, '')),
    '印刷の寸法を CSS に直書きしていない');
}

// スクロールしたまま刷ると、貼り付いた見出しと氏名列がその量ぶんずれて
// 表の中に降りてくる（氏名列が真ん中に重なり、日付行が4行目に出ていた）
{
  const print = src.slice(src.indexOf('@media print'));
  check(/#grid thead th[^{]*\{[^}]*position: static !important/.test(print),
    '紙でも見出しを貼り付けたままにしている');
  check(/#grid \.nm/.test(print.slice(print.indexOf('position: static !important') - 200,
    print.indexOf('position: static !important'))),
    '氏名列の貼り付けを外していない');
  const fp = grab('fitPrint_');
  check(/scrollLeft = 0/.test(fp) && /scrollTop = 0/.test(fp),
    'スクロール位置を戻していない');
}

// 医師名は input に入れていたが、input は中身がはみ出すと左端から見せる。
// 実測で2文字（25px の枠に27px）でも切れ、中央にも寄っていなかった
{
  const print = src.slice(src.indexOf('@media print'));
  check(/#grid td\.text input \{ display: none !important; \}/.test(print),
    '紙でも input のまま出している');
  check(/#grid td\.text \.pv/.test(print), '文字として出す欄が無い');
  check(/text-align: center/.test(print.slice(print.indexOf('.pv'),
    print.indexOf('.pv') + 400)), '中央に寄せていない');
  const build = grab('buildBody');
  check(/el\('span', 'pv', get\(row, c\)\)/.test(build),
    '組み立て時に中身を入れていない（空のまま刷られる）');
  const fill = grab('fillCell_');
  check(/pv\.textContent = t/.test(fill), '書き換えたときに合わせていない');
  const fp = grab('fitPrint_');
  check(/--print-text-fs/.test(fp), '字の大きさを決めていない');
  check(/em <= 3/.test(fp), '3文字が入る大きさにしていない');
}

// 幅の見積もり。全角1・半角0.5で数える
{
  const w = new Function(grab('widthEm_') + ' return widthEm_;')();
  check(w('医A') === 1.5, '全角＋半角', String(w('医A')));
  check(w('医師名') === 3, '全角3文字', String(w('医師名')));
  check(w('甲野 太郎') === 4.5, '空白入りの氏名', String(w('甲野 太郎')));
  check(w('ﾊﾝｶｸ') === 2, '半角カナ', String(w('ﾊﾝｶｸ')));
  check(w('') === 0, '空');
}

console.log('');
console.log('■ document から探さずに書けているか（未挿入でも効くこと）');
console.log('  document.querySelector は常に null を返す状態で組み立てた');
check(kinds.staff && kinds.staff[0] !== '', '画面に載せる前でもスタッフ欄が埋まる');

console.log('');
console.log(ng ? ('★ NG ' + ng + ' 件') : '描画: すべて意図どおり');
process.exit(ng ? 1 : 0);
