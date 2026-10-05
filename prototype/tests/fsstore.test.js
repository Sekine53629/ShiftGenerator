// 保存先フォルダ（ローカル運用）と、版を上げるときの控えを確かめる。
//
// ブラウザのフォルダ（File System Access API）は node では使えないので、
// 同じ形の「メモリ上のフォルダ」を作って、本体の関数をそのまま回す。
//
//   node prototype/tests/fsstore.test.js
const fs = require('fs');
const assert = require('assert');
const src = fs.readFileSync('prototype/ShiftGrid.html', 'utf8');

function grab(n) {
  const at = src.indexOf('function ' + n + '(');
  if (at < 0) throw new Error('見つからない: ' + n);
  // async function も拾う
  const start = src.lastIndexOf('\n', at) + 1;
  let d = 0;
  for (let j = src.indexOf('{', at); j < src.length; j++) {
    if (src[j] === '{') d++; else if (src[j] === '}') { d--; if (!d) return src.slice(start, j + 1); }
  }
}
const upto = m => { const a = src.indexOf(m); return src.slice(a, src.indexOf(');', a) + 2); };

/** メモリ上のフォルダ。書いたファイル名を log に残す */
function makeDir(name) {
  const files = new Map(), dirs = new Map(), log = [];
  const notFound = () => Object.assign(new Error('見つからない'), { name: 'NotFoundError' });
  return {
    kind: 'directory', name, files, dirs, log,
    async getDirectoryHandle(n, o) {
      if (!dirs.has(n)) { if (!(o && o.create)) throw notFound(); dirs.set(n, makeDir(n)); }
      return dirs.get(n);
    },
    async getFileHandle(n, o) {
      if (!files.has(n)) { if (!(o && o.create)) throw notFound(); files.set(n, ''); }
      return {
        kind: 'file', name: n,
        async getFile() { return { async text() { return files.get(n); } }; },
        async createWritable() {
          let buf = '';
          return { async write(t) { buf += t; }, async close() { files.set(n, buf); log.push(n); } };
        }
      };
    },
    async removeEntry(n) { files.delete(n); },
    async *entries() {
      for (const [n] of files) yield [n, { kind: 'file', name: n }];
      for (const [n, h] of dirs) yield [n, h];
    }
  };
}

function build(storage) {
  return new Function('localStorage', [
    "const STORE_KEY = 'shiftgrid.db.v1';",
    'const SCHEMA_VERSION = 3;',
    upto('const LOCAL_DIR = Object.freeze({'),
    "const FS = { dir: null, base: '', on: false, timer: 0, dirty: {}, error: '', written: {} };",
    'let DB = { staff: [], rules: {} };',
    'const values = new Map();',
    // 画面まわりは何もしない
    'const migrateDb_ = d => d; const seedDb = () => ({ staff: [], rules: {}, seeded: true });',
    'const syncActiveStore = () => {}; const openDefaultMonth_ = () => {}; const COLS = {};',
    'const renderMaster = () => {}; const renderRules = () => {}; const renderMemoDefault = () => {};',
    'const refreshAll = () => {}; const fsNote_ = () => {};',
    ['readJson_', 'writeJson_', 'writeText_', 'cellsByMonth_', 'dataDirOf_', 'fsAttach_', 'fsFlush_',
      'load', 'backupBeforeUpgrade_'].map(grab).join('\n'),
    'return { FS, values, getDB: () => DB, setDB: d => { DB = d; }, cellsByMonth_, fsAttach_, fsFlush_, load };'
  ].join('\n'))(storage);
}
function makeStore() {
  const dump = {};
  return { dump, getItem: k => (k in dump ? dump[k] : null), setItem: (k, v) => { dump[k] = String(v); } };
}

let fail = 0;
const tests = [];
const ok = (name, fn) => tests.push([name, fn]);

/* ── 月ごとに分ける ── */
ok('シフトの中身を月ごとに分ける（注記も、その月に）', async () => {
  const a = build(makeStore());
  const m = new Map([
    ['s1|2026-10|1', '○'], ['s1|2026-11|3', '公休'], ['hand:s1|2026-11|3', '1'],
    ['memo|2026-11', '注記'], ['s1|2026-11|4', ''], ['こわれた', 'x']
  ]);
  const by = a.cellsByMonth_(m);
  assert.deepStrictEqual(Object.keys(by).sort(), ['2026-10', '2026-11']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(by['2026-11'])),
    { 's1|2026-11|3': '公休', 'hand:s1|2026-11|3': '1', 'memo|2026-11': '注記' });
});

/* ── 前の形（cells.json 1つ）からの移し替え ── */
ok('前の形の cells.json は月ごとに分けて書き、元は cells.json.bak で残す', async () => {
  const a = build(makeStore());
  const root = makeDir('ShiftGenerator');
  const data = await root.getDirectoryHandle('data', { create: true });
  data.files.set('db.json', JSON.stringify({ staff: [{ id: 's1' }], rules: {} }));
  data.files.set('cells.json', JSON.stringify({ 's1|2026-10|1': '○', 's1|2026-11|2': '▲', 'memo|2026-11': 'メモ' }));
  await a.fsAttach_(root);
  const cells = data.dirs.get('cells');
  assert.ok(cells, 'cells フォルダが無い');
  assert.deepStrictEqual([...cells.files.keys()].sort(), ['2026-10.json', '2026-11.json']);
  assert.strictEqual(JSON.parse(cells.files.get('2026-11.json'))['s1|2026-11|2'], '▲');
  assert.ok(!data.files.has('cells.json'), '前の形が残っている（読み直すたびに二重になる）');
  assert.ok(data.files.has('cells.json.bak'), '前の形の控えが無い');
  assert.strictEqual(a.values.get('s1|2026-10|1'), '○');
  assert.strictEqual(a.getDB().staff[0].id, 's1');
});

/* ── 変わった月だけ書く ── */
ok('直した月のファイルだけを書く', async () => {
  const a = build(makeStore());
  const root = makeDir('ShiftGenerator');
  const data = await root.getDirectoryHandle('data', { create: true });
  const cells = await data.getDirectoryHandle('cells', { create: true });
  data.files.set('db.json', JSON.stringify({ staff: [], rules: {} }));
  cells.files.set('2026-10.json', JSON.stringify({ 's1|2026-10|1': '○' }, null, 1));
  cells.files.set('2026-11.json', JSON.stringify({ 's1|2026-11|1': '▲' }, null, 1));
  await a.fsAttach_(root);
  cells.log.length = 0;
  a.values.set('s1|2026-11|2', '公休');
  a.FS.dirty.cells = true;
  await a.fsFlush_();
  assert.deepStrictEqual(cells.log, ['2026-11.json'], '書いたファイル: ' + JSON.stringify(cells.log));
  assert.strictEqual(JSON.parse(cells.files.get('2026-11.json'))['s1|2026-11|2'], '公休');
});
ok('全部消した月は {} を書く（消した入力が戻らない）', async () => {
  const a = build(makeStore());
  const root = makeDir('ShiftGenerator');
  const data = await root.getDirectoryHandle('data', { create: true });
  const cells = await data.getDirectoryHandle('cells', { create: true });
  data.files.set('db.json', JSON.stringify({ staff: [], rules: {} }));
  cells.files.set('2026-10.json', JSON.stringify({ 's1|2026-10|1': '○' }, null, 1));
  await a.fsAttach_(root);
  a.values.delete('s1|2026-10|1');
  a.FS.dirty.cells = true;
  await a.fsFlush_();
  assert.deepStrictEqual(JSON.parse(cells.files.get('2026-10.json')), {});
});

/* ── 空のフォルダ ── */
ok('空のフォルダには、いまの中身（マスタと全部の月）を書く', async () => {
  const a = build(makeStore());
  a.setDB({ staff: [{ id: 'x' }], rules: {} });
  a.values.set('x|2026-09|5', '○');
  a.values.set('x|2026-10|5', '▲');
  const docs = makeDir('Documents');                 // ドキュメントを選んだ → ShiftGenerator を作る
  await a.fsAttach_(docs);
  const data = docs.dirs.get('ShiftGenerator').dirs.get('data');
  assert.ok(data.files.has('db.json'));
  assert.strictEqual(JSON.parse(data.files.get('db.json')).staff[0].id, 'x');
  assert.deepStrictEqual([...data.dirs.get('cells').files.keys()].sort(), ['2026-09.json', '2026-10.json']);
});

/* ── 版を上げる直前の控え ── */
ok('前の版のデータを読むと、直す前の中身を控える', async () => {
  const st = makeStore();
  const raw = JSON.stringify({ staff: [{ id: 'a', rule: '通常' }], rules: {}, schemaVersion: 2 });
  st.setItem('shiftgrid.db.v1', raw);
  const a = build(st);
  a.load();
  assert.strictEqual(st.dump['shiftgrid.db.v1.before-v3'], raw);
});
ok('いまの版のデータでは控えない。控えは一度だけ（上書きしない）', async () => {
  const st = makeStore();
  st.setItem('shiftgrid.db.v1', JSON.stringify({ staff: [], rules: {}, schemaVersion: 3 }));
  build(st).load();
  assert.ok(!('shiftgrid.db.v1.before-v3' in st.dump));
  st.setItem('shiftgrid.db.v1.before-v3', '最初の控え');
  st.setItem('shiftgrid.db.v1', JSON.stringify({ staff: [], rules: {}, schemaVersion: 2 }));
  build(st).load();
  assert.strictEqual(st.dump['shiftgrid.db.v1.before-v3'], '最初の控え');
});

/* ── 取り込みで「月の確定」も戻す ── */
ok('データの取り込みは「月の確定」（finalized）も受け取る', async () => {
  const at = src.indexOf("$('dataApply')");
  const keys = src.slice(src.indexOf('const KEYS = [', at), src.indexOf('];', src.indexOf('const KEYS = [', at)));
  assert.ok(/'finalized'/.test(keys), keys);
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); console.log('  OK  ' + name); }
    catch (e) { fail++; console.log('  NG  ' + name + '\n      ' + e.message); }
  }
  console.log(fail ? ('■ ' + fail + ' 件 NG') : '■ すべて OK');
  process.exit(fail ? 1 : 0);
})();
