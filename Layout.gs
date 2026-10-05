/**
 * Layout.gs — シート上の位置解決
 *
 * 移植元: ShiftCommon v3.2 の関数部  仕様書: §3.2
 *
 * 【最重要の約束】
 *   1回の実行で1度だけ解決し、返ったオブジェクトを持ち回ること。
 *   VBA 版のように毎回呼び直すと API 呼び出しが跳ね上がり 6 分制限に当たる（§8.3）。
 *   resolveLayout() は B 列と A 列を1回ずつ読むだけで全部を決める。
 *
 * 【仕様書 §3.2 と §5.5 の食い違いについて】
 *   §3.2 は「名前付き範囲を優先し、無ければ計算で解決する」（VBA 版の挙動）、
 *   §5.5 は「Layout の計算解決を正とし、名前付き範囲は目印」と書いている。
 *   Sheets の名前付き範囲は数式を持てず、行を増減しても追随しない。
 *   古い名前を優先すると入力欄の外へ書き込む事故になるため、
 *   **§5.5 を採り、計算解決を正とした**。名前付き範囲とのずれは
 *   getShiftRangeDrift() が返し、設定チェックが警告する。
 *
 * 【パレット関連は移植しない】
 *   IsDoctorStamp / PaletteLabel / LastDoctorIndex / PaletteRange /
 *   PaletteBodyRow は、サイドバー化（§6）に伴い丸ごと不要。
 */

const MODULE_LAYOUT = 'Layout';

/**
 * シフトシートの位置をまとめて解決する。
 *
 * 「数式かつ日付」の判定は B 列を getFormulas() と getValues() で1回ずつ読んで
 * 突き合わせる（hasFormula に相当する単発 API は無い）。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet シフトシート
 * @return {{dateRow:number, repeatDateRow:number, headerRow:number, weekRow:number,
 *           doctorTop:number, doctorBottom:number, noteRow:number, docRow:number,
 *           pharmRow:number, shortageRow:number, gridTop:number, gridBottom:number,
 *           firstCol:number, lastCol:number}}
 */
function resolveLayout(sheet) {
  try {
    const scanRows = Math.min(LAYOUT.MAX_SCAN_ROWS, sheet.getMaxRows());
    const colB = sheet.getRange(1, LAYOUT.COL_FIRST, scanRows, 1);
    const bFormulas = colB.getFormulas();
    const bValues = colB.getValues();
    const aValues = sheet.getRange(1, 1, scanRows, 1).getValues();

    const dateRows = findDateRows_(bValues);
    if (dateRows.length < 2) {
      throw new Error(describeDateRowFailure_(dateRows, bValues));
    }
    const dateRow = dateRows[0];
    const repeatDateRow = dateRows[1];

    const weekRow = dateRow + 1;
    const doctorTop = weekRow + 1;
    const doctorBottom = doctorTop + LAYOUT.DOC_BLOCK_ROWS - 1;

    const noteRow = findLabelRow_(aValues, LABEL.NOTE);
    const docRow = noteRow > 0
      ? noteRow + LAYOUT.NOTE_TO_DOC
      : findLabelRow_(aValues, LABEL.DOC);
    if (docRow === 0) {
      throw new Error(`A列に「${LABEL.NOTE}」も「${LABEL.DOC}」も見つかりません。集計行を判定できません。`);
    }

    const shortageRow = findLabelRow_(aValues, LABEL.SHORT) || (docRow + 2);

    return {
      dateRow: dateRow,
      repeatDateRow: repeatDateRow,
      headerRow: dateRow - 1,
      weekRow: weekRow,
      doctorTop: doctorTop,
      doctorBottom: doctorBottom,
      noteRow: noteRow,
      docRow: docRow,
      pharmRow: docRow + 1,
      shortageRow: shortageRow,
      gridTop: repeatDateRow + LAYOUT.DATE_REPEAT_GAP,
      gridBottom: docRow - LAYOUT.DOC_GAP,
      firstCol: LAYOUT.COL_FIRST,
      lastCol: LAYOUT.COL_LAST,
    };
  } catch (error) {
    logError(MODULE_LAYOUT, 'resolveLayout', error, `sheet=${sheet && sheet.getName()}`);
    throw error;
  }
}

/**
 * シフトシートを取得。CONFIG.SHEET_SHIFT が無ければアクティブシート。
 * 月ごとにシートを分ける運用（SheetBuilder）ではアクティブシートが対象になる。
 * 移植元: ShiftSheet
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getShiftSheet() {
  try {
    return getSheetOrNull(CONFIG.SHEET_SHIFT) || SpreadsheetApp.getActiveSheet();
  } catch (error) {
    logError(MODULE_LAYOUT, 'getShiftSheet', error, '');
    throw error;
  }
}

/**
 * 名前でシートを取得。無ければ null。移植元: SheetOrNothing / SheetExists
 * @return {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getSheetOrNull(name) {
  try {
    return SpreadsheetApp.getActive().getSheetByName(name);
  } catch (error) {
    logError(MODULE_LAYOUT, 'getSheetOrNull', error, `name=${name}`);
    return null;
  }
}

/**
 * 名前付き範囲を取得。無ければ null。移植元: NamedRangeOrNothing
 * @return {GoogleAppsScript.Spreadsheet.Range|null}
 */
function getNamedRangeOrNull(name) {
  try {
    return SpreadsheetApp.getActive().getRangeByName(name);
  } catch (error) {
    logError(MODULE_LAYOUT, 'getNamedRangeOrNull', error, `name=${name}`);
    return null;
  }
}

/**
 * B 列で日付が入っている行を、上から順に返す。
 * 移植元: DateFormulaRow（1つ目が日付行 / 2つ目が再掲日付行）
 *
 * 【VBA 版から緩めた点】
 *   VBA は「数式**かつ**日付」を目印にしていた。Excel の日付行が
 *   `=DATE(...)` の連なりだったため。
 *   GAS 版はシートに数式を持たせない方針になり（REQUIREMENTS §4.6）、
 *   Excel から移したシートでも取り込みの過程で数式が値に変わる。
 *   数式の有無を問わず「値が日付」だけで判定する。
 *
 *   B 列に日付が入るのは日付行と再掲日付行だけなので、緩めても取り違えない
 *   （入力欄には ○▲公休 などの文字列しか入らない）。
 *
 * @param {*[][]} values B列の値（1行目から）
 * @return {number[]} 日付が入っていた行番号（1 起点）を上から順に
 */
function findDateRows_(values) {
  const rows = [];
  for (let r = 0; r < values.length; r++) {
    if (values[r][0] instanceof Date) rows.push(r + 1);
  }
  return rows;
}

/**
 * 日付行が足りないときに、何が起きているかを言い当てるメッセージを作る。
 * 「読めません」だけだと利用者が次の一手を打てないため。
 * @param {number[]} dateRows 見つかった日付行
 * @param {*[][]} values B列の値
 * @return {string}
 */
function describeDateRowFailure_(dateRows, values) {
  const numbers = values.filter(function (row) { return typeof row[0] === 'number'; }).length;

  if (dateRows.length === 0 && numbers > 0) {
    return `B列に日付が1つもありません。代わりに数値が ${numbers} 個あります。`
      + '日付行の「1」「2」が日付ではなく、ただの数値になっている可能性があります。'
      + '（シフト → レイアウト診断 で中身を確認できます）';
  }
  if (dateRows.length === 0) {
    return 'B列に日付が1つもありません。日付行を判定できないため中止します。'
      + '（シフト → レイアウト診断 で中身を確認できます）';
  }
  return `B列の日付行が1つ（${dateRows[0]} 行目）しか見つかりません。`
    + '入力欄の上端は「2つ目の日付行（再掲）」の下と決めているため、'
    + '再掲の行が要ります。';
}

/**
 * A 列ラベルの前方一致で行を探す。見つからなければ 0。移植元: LabelRow
 * @param {*[][]} aValues A列の値（1行目から）
 * @param {string} label 探すラベル
 * @return {number} 行番号（1 起点）
 */
function findLabelRow_(aValues, label) {
  for (let r = 0; r < aValues.length; r++) {
    const v = String(aValues[r][0] || '').trim();
    if (v !== '' && v.indexOf(label) === 0) return r + 1;
  }
  return 0;
}

/**
 * 列番号を列文字へ（1 → A / 32 → AF）。移植元: ColLetter
 * @param {number} colNo 1 起点の列番号
 * @return {string}
 */
function toColumnLetter(colNo) {
  let n = colNo;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/**
 * 入力欄の下端が名前付き範囲と計算解決でどれだけずれているかを返す。
 * 設定チェックが使う。移植元: ShiftRangeDrift
 * @return {number} ずれの行数（0 なら一致。名前付き範囲が無ければ 0）
 */
function getShiftRangeDrift(sheet, layout) {
  try {
    const named = getNamedRangeOrNull(NAMED_RANGE.SHIFT);
    if (!named) return 0;
    if (named.getSheet().getSheetId() !== sheet.getSheetId()) return 0;
    return named.getLastRow() - layout.gridBottom;
  } catch (error) {
    logError(MODULE_LAYOUT, 'getShiftRangeDrift', error, '');
    return 0;
  }
}

/** 年月セル（A{headerRow}）を返す。移植元: MonthCell */
function getMonthCell(sheet, layout) {
  return sheet.getRange(layout.headerRow, 1);
}

/**
 * 対象月を Date で返す。移植元: MonthValue
 * @return {Date}
 */
function getMonthValue(sheet, layout) {
  try {
    const v = getMonthCell(sheet, layout).getValue();
    if (v instanceof Date) return v;
    throw new Error(`年月セル A${layout.headerRow} が日付ではありません（値: ${v}）。`);
  } catch (error) {
    logError(MODULE_LAYOUT, 'getMonthValue', error, '');
    throw error;
  }
}

/**
 * 早番記号か（○ と ◯ の入力揺れを吸収）。移植元: IsEarlySym
 * 判定は Engine.matchWorkSym に委ねる。分類・集計・表示で規則を1つに保つため。
 * @return {boolean}
 */
function isEarlySym(value) {
  return matchWorkSym(value) === SYM.EARLY;
}

/**
 * 氏名でない行のラベルか（空欄 or NON_NAME_LABELS の前方一致）。移植元: IsNonName
 * @return {boolean}
 */
function isNonName(value) {
  const v = String(value || '').trim();
  if (v === '') return true;
  return NON_NAME_LABELS.some(function (label) { return v.indexOf(label) === 0; });
}
