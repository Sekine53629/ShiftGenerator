// 編集履歴（控えの積み方・容量あふれ・差分・復元）を DOM 無しで確かめる。
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
const line = t => src.split(/\r?\n/).find(l => l.includes(t));

// localStorage の代わり。容量を小さくして、あふれる挙動も見る
function makeStore(limit) {
  let data = {};
  return {
    limit: limit,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (v.length > limit) { const e = new Error('QuotaExceeded'); e.name = 'QuotaExceededError'; throw e; }
      data[k] = v;
    },
    removeItem: k => { delete data[k]; },
  };
}

function build(limit) {
  return new Function('localStorage', [
    line('const HISTORY_KEY'), line('const HISTORY_KEEP'),
    line('  let historyMem'), line('  let historyPersist'),
    grab('loadHistory_'), grab('saveHistory_'), grab('dropOldestSnapshot_'),
    grab('diffCount_'),
    // currentCells_ / snapshot_ は ROWS と days に依存するので、ここでは薄く作る
    'let cellsNow = {};',
    'let curYm = "2026-10";',
    'function currentCells_() { return JSON.parse(JSON.stringify(cellsNow)); }',
    grab('snapshot_'),
    'return { snapshot_, loadHistory_, diffCount_,',
    '  set: c => { cellsNow = c; }, ym: v => { curYm = v; },',
    '  HISTORY_KEEP };'
  ].join('\n'))(makeStore(limit));
}

let ng = 0;
const check = (ok, label, detail) => {
  if (!ok) { ng++; console.log('  NG  ' + label + (detail ? '  ' + detail : '')); }
};

console.log('■ 同じ内容なら積まない');
{
  const h = build(5000000);
  h.set({ s1: { 1: '○' } });
  console.log('  1回目: ' + (h.snapshot_('自動生成の直前') ? '積んだ' : '積まない'));
  console.log('  2回目（内容そのまま）: ' + (h.snapshot_('手で保存') ? '★積んだ' : '積まない'));
  h.set({ s1: { 1: '公休' } });
  console.log('  3回目（1日目を変えた）: ' + (h.snapshot_('手で保存') ? '積んだ' : '★積まない'));
  const list = h.loadHistory_()['2026-10'];
  check(list.length === 2, '控えの数', '実際 ' + list.length);
  console.log('  → 控え ' + list.length + ' 件');
}

console.log('');
console.log('■ 差分の数え方');
{
  const h = build(5000000);
  const a = { s1: { 1: '○', 2: '○', 3: '公休' }, s2: { 1: '○' } };
  const b = { s1: { 1: '○', 2: '公休', 3: '公休' }, s2: { 1: '○', 2: '○' } };
  const n = h.diffCount_(a, b);
  console.log('  s1の2日目を変更 ＋ s2の2日目を追加 → 差分 ' + n);
  check(n === 2, '差分の数', '実際 ' + n);
}

console.log('');
console.log('■ 保持数の上限（' + build(5000000).HISTORY_KEEP + ' 件）');
{
  const h = build(5000000);
  for (let i = 1; i <= 30; i++) { h.set({ s1: { 1: 'v' + i } }); h.snapshot_('保存' + i); }
  const list = h.loadHistory_()['2026-10'];
  console.log('  30回積んだあと: ' + list.length + ' 件');
  console.log('  先頭（最新）: ' + list[0].label + ' / 末尾（最古）: ' + list[list.length - 1].label);
  check(list.length === h.HISTORY_KEEP, '上限で頭打ち', '実際 ' + list.length);
  check(list[0].label === '保存30', '新しい順', list[0].label);
}

console.log('');
console.log('■ 容量があふれたとき（古い月から捨てて入れ直す）');
{
  const h = build(2600);   // わざと小さくする
  let saved = 0;
  ['2026-08', '2026-09', '2026-10'].forEach(ym => {
    h.ym(ym);
    for (let i = 1; i <= 6; i++) {
      h.set({ s1: { 1: ym + '-' + i, 2: 'x'.repeat(20) } });
      if (h.snapshot_('保存' + i)) saved++;
    }
  });
  const all = h.loadHistory_();
  const months = Object.keys(all).sort();
  console.log('  積もうとした ' + saved + ' 件 → 残った月: ' + months.join(' / '));
  months.forEach(m => console.log('    ' + m + ': ' + all[m].length + ' 件'));
  const total = months.reduce((a, m) => a + all[m].length, 0);
  console.log('  → あふれても保存は続いた（残 ' + total + ' 件）');
  check(total > 0, 'あふれても残る');
  check(months.indexOf('2026-10') >= 0, '最新の月が残る');
}

console.log('');
console.log('■ 月ごとに分かれる');
{
  const h = build(5000000);
  h.ym('2026-10'); h.set({ s1: { 1: '○' } }); h.snapshot_('10月');
  h.ym('2026-11'); h.set({ s1: { 1: '公休' } }); h.snapshot_('11月');
  const all = h.loadHistory_();
  console.log('  2026-10: ' + all['2026-10'].length + ' 件 / 2026-11: ' + all['2026-11'].length + ' 件');
  check(all['2026-10'][0].cells.s1['1'] === '○', '10月の中身');
  check(all['2026-11'][0].cells.s1['1'] === '公休', '11月の中身');
}

console.log('');
console.log('■ 「戻す」を連打すると一段ずつ遡る');
{
  const src2 = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');
  const g = n => {
    const at = src2.indexOf('function ' + n + '(');
    let d = 0;
    for (let j = src2.indexOf('{', at); j < src2.length; j++) {
      if (src2[j] === '{') d++; else if (src2[j] === '}') { d--; if (!d) return src2.slice(at, j + 1); }
    }
  };
  const L = t => src2.split(/\r?\n/).find(l => l.includes(t));
  const u = new Function('localStorage', [
    L('const HISTORY_KEY'), L('const HISTORY_KEEP'), L('  let undoPos'),
    L('  let historyMem'), L('  let historyPersist'),
    g('loadHistory_'), g('saveHistory_'), g('dropOldestSnapshot_'), g('diffCount_'),
    'let cellsNow = {}; let curYm = "2026-10"; let last = "";',
    'function currentCells_() { return JSON.parse(JSON.stringify(cellsNow)); }',
    'function applySnapshot_(s) { cellsNow = JSON.parse(JSON.stringify(s.cells)); }',
    'function renderGrid() {} function renderHistory() {}',
    'function fmtWhen_() { return ""; } function histStat_() {}',
    'function $() { return null; } function updateUndoButtons_() {}',
    'function undoStat_(t) { last = t; }',
    g('snapshot_'), g('undoOnce_'), g('markEdited_'),
    'return { snapshot_, undoOnce_, markEdited_, set: c => { cellsNow = c; },',
    '  now: () => cellsNow, msg: () => last, pos: () => undoPos };'
  ].join('\n'))(makeStore(5000000));

  const V = v => ({ s1: { 1: v } });
  ['A', 'B', 'C'].forEach(v => { u.set(V(v)); u.snapshot_('手で保存 ' + v); u.markEdited_(); });
  u.set(V('D')); u.markEdited_();

  const seen = [];
  for (let i = 0; i < 5; i++) { u.undoOnce_(); seen.push(u.now().s1['1']); }
  console.log('  D（未保存）から連打 → ' + seen.join(' → '));
  check(seen.join(',') === 'C,B,A,A,A', '一段ずつ遡って止まる', seen.join(','));

  u.set(V('E')); u.markEdited_();
  check(u.pos() === -1, '編集で遡りが切れる', String(u.pos()));
  u.undoOnce_();
  console.log('  E に編集してから戻す → ' + u.now().s1['1']);
  check(u.now().s1['1'] === 'D', '編集後の1回目はその直前へ', u.now().s1['1']);
}

console.log('');
console.log('■ 戻す・進める の往復');
{
  const src3 = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');
  const g = n => {
    const at = src3.indexOf('function ' + n + '(');
    let d = 0;
    for (let j = src3.indexOf('{', at); j < src3.length; j++) {
      if (src3[j] === '{') d++; else if (src3[j] === '}') { d--; if (!d) return src3.slice(at, j + 1); }
    }
  };
  const L = t => src3.split(/\r?\n/).find(l => l.includes(t));
  const u = new Function('localStorage', [
    L('const HISTORY_KEY'), L('const HISTORY_KEEP'), L('  let undoPos'),
    L('  let historyMem'), L('  let historyPersist'),
    g('loadHistory_'), g('saveHistory_'), g('dropOldestSnapshot_'), g('diffCount_'),
    'let cellsNow = {}; let curYm = "2026-10"; let last = "";',
    'function currentCells_() { return JSON.parse(JSON.stringify(cellsNow)); }',
    'function applySnapshot_(s) { cellsNow = JSON.parse(JSON.stringify(s.cells)); }',
    'function renderGrid() {} function renderHistory() {}',
    'function fmtWhen_() { return ""; } function histStat_() {}',
    'function $() { return null; } function updateUndoButtons_() {}',
    'function undoStat_(t) { last = t; updateUndoButtons_(); }',
    g('snapshot_'), g('undoOnce_'), g('redoOnce_'), g('markEdited_'),
    'return { snapshot_, undoOnce_, redoOnce_, markEdited_, set: c => { cellsNow = c; },',
    '  now: () => (cellsNow.s1 ? cellsNow.s1["1"] : ""), msg: () => last, pos: () => undoPos };'
  ].join('\n'))(makeStore(5000000));

  const V = v => ({ s1: { 1: v } });
  ['A', 'B', 'C'].forEach(v => { u.set(V(v)); u.snapshot_('保存 ' + v); u.markEdited_(); });
  u.set(V('D')); u.markEdited_();

  const back = [];
  for (let i = 0; i < 3; i++) { u.undoOnce_(); back.push(u.now()); }
  const fwd = [];
  for (let i = 0; i < 3; i++) { u.redoOnce_(); fwd.push(u.now()); }
  console.log('  戻す×3 → ' + back.join(' ') + '   進める×3 → ' + fwd.join(' '));
  check(back.join(',') === 'C,B,A', '戻すが一段ずつ', back.join(','));
  check(fwd.join(',') === 'B,C,D', '進めるで元に戻る', fwd.join(','));

  u.redoOnce_();
  check(u.msg().indexOf('これ以上') >= 0, '進めすぎで止まる', u.msg());

  u.markEdited_(); u.redoOnce_();
  check(u.msg().indexOf('戻していない') >= 0, '戻していなければ進めない', u.msg());

  u.set(V('D')); u.markEdited_();
  u.undoOnce_();
  u.set(V('X')); u.markEdited_();
  u.redoOnce_();
  console.log('  戻す→編集→進める: 表示 ' + u.now() + '（編集が消えない）');
  check(u.now() === 'X', '編集後は進めず、編集内容が残る', u.now());
}

console.log('');
console.log('■ 保存できない環境でも戻す・進めるが効く');
{
  const src4 = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');
  const g = n => {
    const at = src4.indexOf('function ' + n + '(');
    let d = 0;
    for (let j = src4.indexOf('{', at); j < src4.length; j++) {
      if (src4[j] === '{') d++; else if (src4[j] === '}') { d--; if (!d) return src4.slice(at, j + 1); }
    }
  };
  const L = t => src4.split(/\r?\n/).find(l => l.includes(t));

  const make = mode => {
    let data = {};
    const store = {
      getItem: k => (k in data ? data[k] : null),
      setItem: (k, v) => {
        if (mode === 'fail' || (mode === 'small' && v.length > 3000)) {
          const e = new Error('Quota'); e.name = 'QuotaExceededError'; throw e;
        }
        data[k] = v;
      },
      removeItem: k => { delete data[k]; },
    };
    return new Function('localStorage', [
      L('const HISTORY_KEY'), L('const HISTORY_KEEP'), L('  let undoPos'),
    L('  let historyMem'), L('  let historyPersist'),
      g('loadHistory_'), g('saveHistory_'), g('dropOldestSnapshot_'), g('diffCount_'),
      'let cellsNow = {}; let curYm = "2026-10"; let last = "";',
      'function currentCells_() { return JSON.parse(JSON.stringify(cellsNow)); }',
      'function applySnapshot_(s) { cellsNow = JSON.parse(JSON.stringify(s.cells)); }',
      'function renderGrid() {} function renderHistory() {}',
      'function fmtWhen_() { return ""; } function histStat_() {}',
      'function $() { return null; } function updateUndoButtons_() {}',
      'function undoStat_(t) { last = t; }',
      g('snapshot_'), g('undoOnce_'), g('redoOnce_'), g('markEdited_'),
      'return { snapshot_, undoOnce_, redoOnce_, markEdited_, set: c => { cellsNow = c; },',
      '  now: () => (cellsNow.s1 ? cellsNow.s1["1"] : ""), persist: () => historyPersist,',
      '  hist: () => loadHistory_()["2026-10"] || [] };'
    ].join('\n'))(store);
  };

  [['保存が通る', 'ok'], ['保存が一切通らない', 'fail'], ['容量が小さい', 'small']].forEach(([label, mode]) => {
    const u = make(mode);
    const V = v => ({ s1: { 1: v } });
    u.set(V('手で組んだ')); u.markEdited_();
    u.snapshot_('自動生成の直前'); u.markEdited_();
    u.set(V('自動生成の結果'));
    u.undoOnce_();
    const back = u.now();
    u.redoOnce_();
    const fwd = u.now();
    console.log('  ' + label.padEnd(18) + '戻す→' + back + '  進める→' + fwd
      + '  控え' + u.hist().length + '件 保存' + (u.persist() ? '成功' : '失敗'));
    check(back === '手で組んだ', label + ': 戻せる', back);
    check(fwd === '自動生成の結果', label + ': 進められる', fwd);
    check(u.hist().length === 2, label + ': 控えが残る', String(u.hist().length));
  });
}

console.log('');
console.log(ng ? ('★ NG ' + ng + ' 件') : '編集履歴: すべて意図どおり');
process.exit(ng ? 1 : 0);
