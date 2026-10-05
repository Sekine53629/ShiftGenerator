/**
 * Survey.gs — シート構造の調査（読み取り専用）
 *
 * 移植元: ShiftSurvey.bas  仕様書: §7.4
 *
 * 優先度は最後でよい。位置解決が疑わしいときの切り分けに使う。
 *
 * 【必ず守る】氏名のマスク（Config.MASK_NAMES）は個人情報保護のため
 * 常に有効にしておくこと。調査結果を人に見せる場面で使う機能なので、
 * ここを外すと氏名がそのまま出る。
 *
 * 【移植しない】SV_WritePalette / SV_PaletteRole … パレット廃止に伴い不要。
 */

const MODULE_SURVEY = 'Survey';

/**
 * メニュー「レイアウト診断」。
 *
 * resolveLayout が「シフト表として読めない」と言うとき、
 * **何が足りないのか**を実物から拾って見せる。推測で判定を緩める前に、
 * 実物が何を持っているかを確かめるための道具。
 *
 * 氏名はマスクする。既知のラベル（備考・医師数など）だけをそのまま出し、
 * それ以外の A 列の文字列は伏せる。
 */
function diagnoseSheetLayout() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const scanRows = Math.min(LAYOUT.MAX_SCAN_ROWS, sheet.getMaxRows());

    const colB = sheet.getRange(1, LAYOUT.COL_FIRST, scanRows, 1);
    const bFormulas = colB.getFormulas();
    const bValues = colB.getValues();
    const aValues = sheet.getRange(1, 1, scanRows, 1).getValues();
    // 日付が B 列以外にあるかも確かめたいので、左から数列ぶんまとめて読む
    const wideCols = Math.min(10, sheet.getMaxColumns());
    const wide = sheet.getRange(1, 1, Math.min(scanRows, 40), wideCols).getValues();

    const report = buildLayoutDiagnosis_(
      sheet.getName(), bFormulas, bValues, aValues, wide);

    showReportDialog('レイアウト診断', report);
    logSuccess(MODULE_SURVEY, 'diagnoseSheetLayout',
      `sheet=${sheet.getName()}; scanRows=${scanRows}`);
    return report;
  } catch (error) {
    logError(MODULE_SURVEY, 'diagnoseSheetLayout', error, '');
    SpreadsheetApp.getUi().alert(`診断に失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * 診断の本文を組み立てる。SpreadsheetApp を呼ばない純粋関数なのでテストできる。
 *
 * @param {string} sheetName シート名
 * @param {string[][]} bFormulas B列の数式
 * @param {*[][]} bValues B列の値
 * @param {*[][]} aValues A列の値
 * @param {*[][]} wide 左から数列ぶんの値（日付が B 列以外にある場合の確認用）
 * @return {string}
 */
function buildLayoutDiagnosis_(sheetName, bFormulas, bValues, aValues, wide) {
  const lines = [];
  const push = function (s) { lines.push(s); };

  push(`シート: ${sheetName}`);
  push(`走査した行数: ${bFormulas.length}`);
  push('');

  // --- B列の中身をそのまま見せる（型の食い違いはここでしか分からない） ---
  push('■ B列の中身（先頭20行・氏名は伏せます）');
  push('  「1」が数値なのか日付なのかは画面では見分けが付きません。');
  for (let r = 0; r < Math.min(20, bValues.length); r++) {
    const desc = describeCellForDiagnosis_(bValues[r][0], bFormulas[r][0]);
    push(`  行 ${String(r + 1).padStart(2, ' ')}: ${desc}`);
  }
  push('');

  // --- B列: 日付行の候補 ---
  push('■ B列（日付行の判定）');
  push('  Layout は「値が日付」の行を上から2つ探します（数式の有無は問いません）。');
  const hits = [];
  for (let r = 0; r < bFormulas.length; r++) {
    const hasFormula = bFormulas[r][0] !== '';
    const isDate = bValues[r][0] instanceof Date;
    if (!hasFormula && !isDate) continue;

    if (isDate) {
      hits.push(r + 1);
      push(`  行 ${r + 1}: 日付（${hasFormula ? '数式あり' : '数式なし'}） → 候補 ${hits.length} 個目`);
    } else if (hasFormula) {
      push(`  行 ${r + 1}: 数式あり + 日付でない`);
    }
  }
  if (hits.length === 0) {
    push('  該当なし。B列に日付が1つもありません。');
  }
  push('');

  // --- 日付が B 列以外にある場合 ---
  const elsewhere = [];
  for (let r = 0; r < wide.length; r++) {
    for (let c = 0; c < wide[r].length; c++) {
      if (c + 1 === LAYOUT.COL_FIRST) continue;
      if (wide[r][c] instanceof Date) {
        elsewhere.push(`行 ${r + 1} / ${toColumnLetter(c + 1)}列`);
        break;
      }
    }
  }
  if (elsewhere.length > 0) {
    push('■ B列以外にある日付（先頭40行・左10列まで）');
    push(`  ${elsewhere.slice(0, 12).join(' , ')}`);
    push('  日付の開始列が B でない場合、Config の LAYOUT.COL_FIRST を見直します。');
    push('');
  }

  // --- A列のラベル ---
  push('■ A列のラベル（氏名は伏せます）');
  const known = NON_NAME_LABELS.concat([LABEL.WEEK, LABEL.NOTE, LABEL.DOC,
    LABEL.PHARM, LABEL.CLERK, LABEL.SHORT, LABEL.DOCTORS]);
  let shown = 0;
  for (let r = 0; r < aValues.length; r++) {
    const v = String(aValues[r][0] || '').trim();
    if (v === '') continue;
    const match = known.filter(function (k) { return v.indexOf(k) === 0; })[0];
    if (match) {
      push(`  行 ${r + 1}: 「${v}」  → 既知のラベル`);
      shown++;
    }
  }
  if (shown === 0) push('  既知のラベルが1つもありません（「備考」「医師数」など）。');
  push('');

  // --- 判定 ---
  push('■ 判定');
  const noteRow = findLabelRow_(aValues, LABEL.NOTE);
  const docRow = noteRow > 0 ? noteRow + LAYOUT.NOTE_TO_DOC
    : findLabelRow_(aValues, LABEL.DOC);

  push(`  日付行      : ${hits[0] || '見つからない'}`);
  push(`  再掲日付行  : ${hits[1] || '見つからない'}`);
  push(`  備考行      : ${noteRow || '見つからない'}`);
  push(`  集計行(医師数): ${docRow || '見つからない'}`);
  push('');

  const problems = [];
  if (!hits[0]) problems.push('日付行が見つかりません。');
  if (!hits[1]) problems.push('再掲日付行（2つ目の日付行）が見つかりません。');
  if (!docRow) problems.push('A列に「備考」も「医師数」もありません。');

  if (problems.length === 0) {
    push('  → 読めます。このシートは自動作成に使えます。');
  } else {
    push('  → 読めません。原因:');
    problems.forEach(function (p) { push(`     ・${p}`); });
    push('');
    push('  よくある原因:');
    push('   ・日付行の「1」「2」が日付ではなく、ただの数値になっている。');
    push('   ・A列の「備考」が別の文字（空欄・全角空白など）になっている。');
    push('   ・日付行が1つしかない（再掲の行が無い）。');
  }

  return lines.join('\n');
}

/**
 * 診断用にセルの中身を言い表す。**値そのものは原則出さない。**
 *
 * 医師名欄も B 列にあるので、生の文字列を並べると氏名が漏れる。
 * 型と長さだけを出し、シフト記号のように伏せる必要がないものだけそのまま見せる。
 *
 * @param {*} value セルの値
 * @param {string} formula セルの数式（無ければ空文字）
 * @return {string}
 */
function describeCellForDiagnosis_(value, formula) {
  const hasFormula = String(formula || '') !== '';
  const mark = hasFormula ? '数式あり' : '数式なし';

  if (value instanceof Date) {
    return `${mark} / 日付 ${toDateKey(value)}  ← 日付行の候補になれます`;
  }
  if (typeof value === 'number') {
    return `${mark} / 数値 ${value}  ← ★日付ではないので候補になりません`;
  }
  const s = String(value == null ? '' : value).trim();
  if (s === '') return `${mark} / 空欄`;

  // 伏せなくてよいもの（記号）だけそのまま出す
  const safe = WORK_SYMS.concat(SYM.OFF_ALL);
  if (safe.indexOf(s) >= 0) return `${mark} / 文字列「${s}」`;
  return `${mark} / 文字列（${s.length}文字・伏せます）`;
}

/**
 * メニュー「シート構造を表示」。
 * 調査結果は CONFIG.SHEET_SURVEY シートへ書く（既存があれば作り直す）。
 * 移植元: ShiftSurvey_シート構造調査
 */
function runSheetSurvey() {
  return notImplemented_(MODULE_SURVEY, 'runSheetSurvey', 8); // TODO(P8)
}

/** 調査結果シートを用意する。移植元: SV_PrepareReport */
function prepareSurveySheet_() {
  return notImplemented_(MODULE_SURVEY, 'prepareSurveySheet_', 8); // TODO(P8)
}

/** ブック情報（シート一覧・行数・列数）。移植元: SV_WriteBookInfo */
function surveyBookInfo_(rows) {
  return notImplemented_(MODULE_SURVEY, 'surveyBookInfo_', 8); // TODO(P8)
}

/** 名前付き範囲の一覧。移植元: SV_WriteNames */
function surveyNamedRanges_(rows) {
  return notImplemented_(MODULE_SURVEY, 'surveyNamedRanges_', 8); // TODO(P8)
}

/** Layout の解決結果を並べる。移植元: SV_WriteDetected */
function surveyDetectedLayout_(rows, sheet) {
  return notImplemented_(MODULE_SURVEY, 'surveyDetectedLayout_', 8); // TODO(P8)
}

/**
 * 行のダンプ（値 / 数式 / 空 の別）。氏名は MASK_NAMES に従って伏せる。
 * 移植元: SV_WriteRowDump / SV_CellKind
 */
function surveyRowDump_(rows, sheet, rowNo) {
  return notImplemented_(MODULE_SURVEY, 'surveyRowDump_', 8); // TODO(P8)
}

/** 列幅の一覧。移植元: SV_WriteColWidths */
function surveyColumnWidths_(rows, sheet) {
  return notImplemented_(MODULE_SURVEY, 'surveyColumnWidths_', 8); // TODO(P8)
}

/** 自動作成設定シートの状態。移植元: SV_WriteConfigSheet / SV_CountMembers */
function surveyConfigSheet_(rows) {
  return notImplemented_(MODULE_SURVEY, 'surveyConfigSheet_', 8); // TODO(P8)
}

/** 氏名を伏せる（MASK_NAMES が true のとき）。 */
function maskName_(name) {
  return notImplemented_(MODULE_SURVEY, 'maskName_', 8); // TODO(P8)
}
