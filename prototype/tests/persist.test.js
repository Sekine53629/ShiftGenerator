// シフトの中身が再読み込みで残るかを、DOM 無しで確かめる。
//
// これが無かったころは values（シフトの中身）を localStorage に一度も
// 書いておらず、再読み込みで丸ごと消えていた。しかも起動時に
// autoGenerate() が走るので作り直された表が出て、消えたことに気づけなかった。
//
//   node prototype/tests/persist.test.js
const fs = require('fs');
const assert = require('assert');
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

// localStorage の代わり。容量を絞ると、あふれる挙動も見られる
function makeStore(limit) {
  const data = {};
  return {
    dump: data,
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (limit !== undefined && v.length > limit) {
        const e = new Error('QuotaExceeded');
        e.name = 'QuotaExceededError';
        throw e;
      }
      data[k] = v;
    },
    removeItem: k => { delete data[k]; },
  };
}

function build(limit) {
  const store = makeStore(limit);
  const api = new Function('localStorage', [
    line('  const CELLS_KEY'),
    line('  let cellsPersist'),
    'const values = new Map();',
    grab('saveCells'), grab('loadCells'),
    'return { values, saveCells, loadCells,',
    '         persist: () => cellsPersist };',
  ].join('\n'))(store);
  return { api, store };
}

let fail = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  OK  ' + name); }
  catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
};

console.log('■ シフトの中身が残るか');

ok('書いたものが読み戻せる', () => {
  const a = build();
  a.api.values.set('s001|2026-10|1', '○');
  a.api.values.set('doc1|2026-10|1', '医A');
  a.api.values.set('note|2026-10|3', '棚卸');
  assert.strictEqual(a.api.saveCells(), true);

  // 別の起動として読み直す
  const b = build();
  b.store.dump[Object.keys(a.store.dump)[0]] = a.store.dump[Object.keys(a.store.dump)[0]];
  assert.strictEqual(b.api.loadCells(), 3, '3件読めるはず');
  assert.strictEqual(b.api.values.get('s001|2026-10|1'), '○');
  assert.strictEqual(b.api.values.get('doc1|2026-10|1'), '医A');
  assert.strictEqual(b.api.values.get('note|2026-10|3'), '棚卸');
});

ok('月をまたいでも別々に残る', () => {
  const a = build();
  a.api.values.set('s001|2026-10|1', '○');
  a.api.values.set('s001|2026-11|1', '▲');
  a.api.saveCells();
  const b = build();
  Object.assign(b.store.dump, a.store.dump);
  b.api.loadCells();
  assert.strictEqual(b.api.values.get('s001|2026-10|1'), '○');
  assert.strictEqual(b.api.values.get('s001|2026-11|1'), '▲');
});

ok('空欄は書かない（消した分が復活しない）', () => {
  const a = build();
  a.api.values.set('s001|2026-10|1', '○');
  a.api.values.set('s001|2026-10|2', '');
  a.api.saveCells();
  const b = build();
  Object.assign(b.store.dump, a.store.dump);
  assert.strictEqual(b.api.loadCells(), 1);
  assert.strictEqual(b.api.values.has('s001|2026-10|2'), false);
});

ok('控えが空でも壊れない', () => {
  const a = build();
  assert.strictEqual(a.api.loadCells(), 0, '何も無ければ0件');
});

console.log('■ 壊れた控えで表を壊さない');

ok('JSON として読めない控えは捨てる', () => {
  const a = build();
  a.store.dump['shiftgrid.cells.v1'] = '{壊れている';
  assert.strictEqual(a.api.loadCells(), 0);
  assert.strictEqual(a.api.values.size, 0);
});

ok('形の違うキーは通さない', () => {
  const a = build();
  a.store.dump['shiftgrid.cells.v1'] = JSON.stringify({
    's001|2026-10|1': '○',        // 正しい
    's001|2026-10': '×',           // 日が無い
    'bad-key': '×',                // 区切りが無い
    's001|26-10|1': '×',           // 年が4桁でない
    's001|2026-10|': '×',          // 日が空
    's001|2026-10|1|2': '×',       // 余分な区切り
  });
  assert.strictEqual(a.api.loadCells(), 1, '正しい1件だけ通す');
  assert.strictEqual(a.api.values.get('s001|2026-10|1'), '○');
});

console.log('■ 保存できないときに黙らない');

ok('容量を超えたら保存失敗を返し、印を立てる', () => {
  const a = build(10);            // 10文字しか入らない
  a.api.values.set('s001|2026-10|1', '○');
  assert.strictEqual(a.api.saveCells(), false, '失敗を返す');
  assert.strictEqual(a.api.persist(), false, '保存できていない印が立つ');
});

ok('保存できなくても値はメモリに残る（作業は続けられる）', () => {
  const a = build(10);
  a.api.values.set('s001|2026-10|1', '○');
  a.api.saveCells();
  assert.strictEqual(a.api.values.get('s001|2026-10|1'), '○');
});

ok('一度失敗しても、通れば印は戻る', () => {
  const a = build(10);
  a.api.values.set('s001|2026-10|1', '○');
  a.api.saveCells();
  assert.strictEqual(a.api.persist(), false);
  a.api.values.clear();           // 中身を減らせば入る
  assert.strictEqual(a.api.saveCells(), true);
  assert.strictEqual(a.api.persist(), true);
});

console.log('■ サーバへの送信と、この端末の保存を混ぜない');

// サーバに送れないこと（圏外・権限・デプロイ前）と、この端末に書けないこと
// （容量オーバー）は別。混ぜると「保存できていません」が出続ける
ok('サーバ送信が失敗しても、この端末の保存は成立する', () => {
  const store = makeStore();
  const api = new Function('localStorage', [
    line('  const CELLS_KEY'),
    line('  let cellsPersist'),
    'const values = new Map();',
    'const console = { error(){} };',
    'function syncTouchMonth(){ throw new Error("圏外"); }',
    grab('saveCells'),
    'return { values, saveCells, persist: () => cellsPersist };',
  ].join('\n'))(store);
  api.values.set('s001|2026-10|1', '○');
  assert.strictEqual(api.saveCells(), true, 'サーバの失敗で保存が失敗扱いになった');
  assert.strictEqual(api.persist(), true, '保存できていない印が立った');
  assert.ok(store.dump['shiftgrid.cells.v1'], '控えが書かれていない');
});

ok('この端末に書けないときは、サーバへ送らない', () => {
  let sent = 0;
  const store = makeStore(10);      // 10文字しか入らない
  const api = new Function('localStorage', 'tick', [
    line('  const CELLS_KEY'),
    line('  let cellsPersist'),
    'const values = new Map();',
    'const console = { error(){} };',
    'function syncTouchMonth(){ tick(); }',
    grab('saveCells'),
    'return { values, saveCells };',
  ].join('\n'))(store, () => { sent++; });
  api.values.set('s001|2026-10|1', '○');
  assert.strictEqual(api.saveCells(), false);
  assert.strictEqual(sent, 0, '書けていないのにサーバへ送った');
});

console.log('■ 同期の配線');

ok('保存待ちの控えを、送ったあとに消している', () => {
  // 消さないと setTimeout の id が真のまま残り、「保存待ちがある」と
  // 見なされて、ほかの人の保存を一度も取り込まなくなる（実際そうなっていた）
  ['syncTouchDb', 'syncTouchMonth'].forEach(n => {
    const f = grab(n);
    assert.ok(/Wait = null/.test(f), n + ' が控えを消していない');
  });
});

ok('取り込みの最中は保存を呼ばない', () => {
  // 取り込み → renderGrid → recalc → saveCells と回るので、
  // 印を立てておかないとサーバへ送り返してしまう
  const f = grab('applyMonth_');
  assert.ok(/SYNC\.applying = true/.test(f) && /finally/.test(f),
    'applying の印が無い、または戻していない');
  ['syncTouchDb', 'syncTouchMonth'].forEach(n => {
    assert.ok(/SYNC\.applying/.test(grab(n)), n + ' が印を見ていない');
  });
});

ok('取り込みは、その月ぶんを消してから入れる', () => {
  // 足すだけだと、向こうで消された記号がこちらに残る
  const f = grab('applyMonth_');
  assert.ok(/values\.delete\(k\)/.test(f), '消してから入れていない');
});

ok('衝突したら、書かずに知らせる', () => {
  ['syncPushDb_', 'syncPushMonth_'].forEach(n => {
    const f = grab(n);
    assert.ok(/res && res\.ok/.test(f) && /syncConflict_/.test(f),
      n + ' が衝突を握りつぶしている');
  });
  const c = grab('syncConflict_');
  assert.ok(/updatedBy/.test(c), '誰の編集とぶつかったか出していない');
});

ok('月を切り替えた直後に、古い版で書かない', () => {
  const f = grab('syncPushMonth_');
  assert.ok(/SYNC\.monthKey !== syncKey_\(\)/.test(f), '版と月の対応を見ていない');
  assert.ok(/SYNC\.monthKey !== store \+ '\|' \+ ym/.test(f),
    '往復の間に月が変わった場合を見ていない');
});

console.log('■ 起動の配線');

ok('起動時に読み戻し、読めたときは自動生成しない', () => {
  // 起動部分は DOM に触るので、ソースの並びで確かめる
  const boot = src.slice(src.indexOf('/* ═══ 起動'));
  assert.ok(/const restored = loadCells\(\);/.test(boot),
    '起動時に loadCells を呼んでいない');
  assert.ok(/if \(!restored\) \{[\s\S]{0,200}autoGenerate\(\);/.test(boot),
    '読み戻せたときに autoGenerate を止めていない（作り直した表で上書きされる）');
});

ok('起動はサーバの読み込みを待ってから自動生成を決める', () => {
  // 先に走らせると、ほかの人が作った表を、こちらで作り直したもので上書きする
  const boot = src.slice(src.indexOf('/* ═══ 起動'));
  assert.ok(/onServer\(\)/.test(boot), '起動でサーバかどうかを見ていない');
  assert.ok(/syncBoot\(\)\.then\(/.test(boot), 'サーバの読み込みを待っていない');
  assert.ok(/!okServer && !restored/.test(boot),
    'サーバに繋がっているのに autoGenerate を走らせている');
});

ok('月・店舗を切り替えたら、その月をサーバから読み直す', () => {
  // 版は「店舗×年月」に紐づく。古い版のまま書くと、別の月を上書きしかねない
  const at = src.indexOf("['yy', 'mm'].forEach");
  const block = src.slice(at, at + 900);
  assert.ok(/syncLoadMonth\(\)/.test(block), '年月の切り替えで読み直していない');
  assert.strictEqual((block.match(/syncLoadMonth\(\)/g) || []).length, 2,
    '年月と店舗の両方で読み直していない');
});

ok('表が変わるたびに保存する', () => {
  const recalc = grab('recalc');
  assert.ok(/saveCells\(\);/.test(recalc),
    'recalc から saveCells を呼んでいない');
});

ok('保存できていないことを画面に出す', () => {
  const check = grab('checkRules');
  assert.ok(/cellsPersist/.test(check) && /dbPersist/.test(check),
    'checkRules が保存失敗を拾っていない');
  assert.ok(/保存できていません/.test(check), '文言が無い');
});

ok('マスタの保存も、失敗を黙って捨てない', () => {
  const save = grab('save');
  assert.ok(/dbPersist = false/.test(save), 'save が失敗を握りつぶしている');
});

console.log('■ 注記の既定');

// 注記は毎月ほとんど同じなので、既定を置いて月ごとに書き換える。
// 「まだ触っていない」と「空にした」を見分けないと、消したそばから既定が戻る。
const memoRun = (() => {
  const src2 = src;
  const grabMemo = () => {
    const a = src2.indexOf("const memo = values.has(memoKey())");
    return src2.slice(a, src2.indexOf(';', a) + 1);
  };
  return new Function([
    'const values = new Map();',
    'let curYm = "2026-10";',
    'const DB = { memoDefault: "きほんの文面" };',
    'const memoKey = () => "memo|" + curYm;',
    'function read() { ' + grabMemo() + ' return memo; }',
    'function write(v) { values.set(memoKey(), v); }',
    'function reset() { values.delete(memoKey()); }',
    'return { read, write, reset, month: v => { curYm = v; }, values };',
  ].join('\n'))();
})();

ok('触っていない月は既定が出る', () => {
  assert.strictEqual(memoRun.read(), 'きほんの文面');
});

ok('書き換えたらその文面が出る', () => {
  memoRun.write('この月だけの文面');
  assert.strictEqual(memoRun.read(), 'この月だけの文面');
});

ok('別の月は既定のまま', () => {
  memoRun.month('2026-11');
  assert.strictEqual(memoRun.read(), 'きほんの文面');
  memoRun.month('2026-10');
  assert.strictEqual(memoRun.read(), 'この月だけの文面', '元の月の文面が消えた');
});

ok('空にしたら既定は戻らない', () => {
  memoRun.write('');
  assert.strictEqual(memoRun.read(), '', '消したのに既定が戻ってきた');
});

ok('既定に戻すと読み直す', () => {
  memoRun.reset();
  assert.strictEqual(memoRun.read(), 'きほんの文面');
});

console.log(fail ? '\n■ ' + fail + ' 件 NG' : '\n■ すべて OK');
process.exit(fail ? 1 : 0);
