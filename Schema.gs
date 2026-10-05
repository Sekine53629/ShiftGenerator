/**
 * Schema.gs — 不足シートの生成
 *
 * 移植元: ShiftSchema.bas（祝日の取込は Holidays.gs へ分離）
 * 仕様書: §3.3 / §3.4 / §6.4
 *
 * 【生成の約束】
 *   空欄のセルにしか書かない。既存の値は絶対に消さない（VBA の SC_SetIfBlank と同じ）。
 *   すでに運用しているブックに対して何度実行しても壊れないこと、が唯一の要件。
 *
 * 【なぜ手作業ではだめか】
 *   自動作成設定は列の位置が固定で、A=氏名 / B=区分 がずれると
 *   区分の作業列（AN）が照合に失敗し、薬剤師出勤数が黙って 0 になる。
 *   エラーにならないので気づきにくい。だから生成をコードに寄せる。
 */

const MODULE_SCHEMA = 'Schema';

/**
 * メニュー「不足シートを生成」。
 * 自動作成設定 / 祝日マスタ / シフト変更ログ のうち、無いものだけ作る。
 * すでにあるシートには見出しと入力規則を補うだけで、データには触らない。
 */
function buildMissingSheets() {
  const started = Date.now();
  try {
    const report = [
      buildConfigSheet(),
      buildDoctorMaster(),
      buildPatternMaster(),
      buildNoteMaster(),
      buildHolidaySheet(),
      buildChangeLogSheet(),
    ];
    SpreadsheetApp.flush();

    const lines = report.map(function (r) {
      return `・${r.name}: ${r.created ? '作りました' : 'すでにあります（見出しだけ補いました）'}`;
    });
    const createdCount = report.filter(function (r) { return r.created; }).length;

    logSuccess(MODULE_SCHEMA, 'buildMissingSheets',
      `created=${createdCount}/${report.length}; elapsedMs=${Date.now() - started}`);

    SpreadsheetApp.getUi().alert([
      'シートの確認が終わりました。',
      '',
    ].concat(lines).concat([
      '',
      '次にやること:',
      '・「自動作成設定」にメンバーを登録（A列=氏名 / B列=区分）',
      '・「医師マスタ」に医師名を登録（Web アプリの医師名スタンプになります）',
      '・「シフトパターン」を確認（記号・時間帯）',
      '・「備考マスタ」を確認（備考行に押す文字。銀行など）',
      '・「初期設定 → 祝日マスタを取り込む」で祝日を入れる',
    ]).join('\n'));

    return report;
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildMissingSheets', error, '', true);
    SpreadsheetApp.getUi().alert(`シートの生成に失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * 自動作成設定シートを作る。
 *   メンバー表（見出し4行目 / 5行目〜）
 *   + 全体設定（K=ラベル / L=値。既定値を空欄のときだけ入れる）
 *   + 医師名リスト（N 列。§6.4。VBA 版がパレットに持っていた医師名の置き場）
 *
 * @return {{name:string, created:boolean}}
 */
function buildConfigSheet() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_CFG);
    const sheet = got.sheet;

    // --- メンバー表の見出し（A〜I） ---
    const memberHeads = SCHEMA.CFG_MEMBER_HEADS;
    setIfBlank_(sheet.getRange(CFG_MEMBER.HDR_ROW, CFG_MEMBER.COL_NAME, 1, memberHeads.length),
      [memberHeads]);
    styleHeaderRange_(sheet.getRange(CFG_MEMBER.HDR_ROW, CFG_MEMBER.COL_NAME,
      1, memberHeads.length));

    // --- 全体設定（K=ラベル / L=値） ---
    setIfBlank_(sheet.getRange(CFG_SETTING.ROW, CFG_SETTING.COL_KEY, 1, 2),
      [SCHEMA.CFG_SETTING_HEADS]);
    styleHeaderRange_(sheet.getRange(CFG_SETTING.ROW, CFG_SETTING.COL_KEY, 1, 2));

    const keys = Object.keys(SETTING_DEFAULT);
    const settingRows = keys.map(function (key) {
      return [SETTING_DEFAULT[key].label, SETTING_DEFAULT[key].value];
    });
    setIfBlank_(sheet.getRange(CFG_SETTING.ROW + 1, CFG_SETTING.COL_KEY,
      settingRows.length, 2), settingRows);

    // --- 医師名リスト（N） ---
    setIfBlank_(sheet.getRange(CFG_SETTING.ROW, CFG_SETTING.COL_DOCTOR),
      [[SCHEMA.CFG_DOCTOR_HEAD]]);
    styleHeaderRange_(sheet.getRange(CFG_SETTING.ROW, CFG_SETTING.COL_DOCTOR));

    // --- 入力規則。打ち間違いをここで止める ---
    addColumnValidation_(sheet, CFG_MEMBER.COL_KIND, [KIND.PHARM, KIND.CLERK]);
    addColumnValidation_(sheet, CFG_MEMBER.COL_CLOSED, SCHEMA.CHOICE_CLOSED);
    addColumnValidation_(sheet, CFG_MEMBER.COL_RULE,
      [RULE.NORMAL, RULE.FIXED_DOW, RULE.WEEK_N, RULE.MANUAL]);
    addColumnValidation_(sheet, CFG_MEMBER.COL_LATE, SCHEMA.CHOICE_LATE);

    if (got.created) {
      sheet.setColumnWidth(CFG_MEMBER.COL_NAME, 120);
      sheet.setColumnWidth(CFG_SETTING.COL_KEY, 240);
      sheet.setColumnWidth(CFG_SETTING.COL_DOCTOR, 120);
      sheet.setFrozenRows(CFG_MEMBER.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildConfigSheet',
      `sheet=${CONFIG.SHEET_CFG}; created=${got.created}; settings=${settingRows.length}`);
    return { name: CONFIG.SHEET_CFG, created: got.created };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildConfigSheet', error, '');
    throw error;
  }
}

/**
 * 医師マスタを作る。
 *
 * これまで医師名は 自動作成設定 の N 列に1列だけ間借りしていて、
 * 略称も表示順も持てなかった。別シートに切り出す。
 * 中身は空で作る。**実名はコードに書かない**（Tier 3）。
 *
 * @return {{name:string, created:boolean}}
 */
function buildDoctorMaster() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_DOCTOR);
    const sheet = got.sheet;
    const heads = DOCTOR_MASTER.HEADS;

    setIfBlank_(sheet.getRange(DOCTOR_MASTER.HDR_ROW, 1, 1, heads.length), [heads]);
    styleHeaderRange_(sheet.getRange(DOCTOR_MASTER.HDR_ROW, 1, 1, heads.length));

    if (got.created) {
      sheet.setColumnWidth(DOCTOR_MASTER.COL_NAME, 140);
      sheet.setColumnWidth(DOCTOR_MASTER.COL_MEMO, 240);
      sheet.setFrozenRows(DOCTOR_MASTER.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildDoctorMaster',
      `sheet=${CONFIG.SHEET_DOCTOR}; created=${got.created}`);
    return { name: CONFIG.SHEET_DOCTOR, created: got.created };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildDoctorMaster', error, '');
    throw error;
  }
}

/**
 * シフトパターンのマスタを作る。記号・名称・時間帯・種別・表示順。
 *
 * これまで記号は Config に埋め込みで、時間帯も備考スタンプ（銀行）も
 * 置き場が無かった。ここに集める。
 *
 * 初期値は実物の凡例に合わせて入れるが、**空欄のセルにしか書かない**ので、
 * あとから自由に足したり直したりできる。
 *
 * @return {{name:string, created:boolean}}
 */
function buildPatternMaster() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_PATTERN);
    const sheet = got.sheet;
    const heads = PATTERN_MASTER.HEADS;

    setIfBlank_(sheet.getRange(PATTERN_MASTER.HDR_ROW, 1, 1, heads.length), [heads]);
    styleHeaderRange_(sheet.getRange(PATTERN_MASTER.HDR_ROW, 1, 1, heads.length));

    const seed = PATTERN_MASTER.SEED;
    setIfBlank_(sheet.getRange(PATTERN_MASTER.FIRST_ROW, 1, seed.length, heads.length),
      seed.map(function (row) { return row.slice(); }));

    addColumnValidationFrom_(sheet, PATTERN_MASTER.COL_KIND, PATTERN_MASTER.FIRST_ROW,
      [PATTERN_MASTER.KIND_WORK, PATTERN_MASTER.KIND_OFF, PATTERN_MASTER.KIND_NOTE]);

    if (got.created) {
      sheet.setColumnWidth(PATTERN_MASTER.COL_SYM, 70);
      sheet.setColumnWidth(PATTERN_MASTER.COL_NAME, 140);
      sheet.setFrozenRows(PATTERN_MASTER.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildPatternMaster',
      `sheet=${CONFIG.SHEET_PATTERN}; created=${got.created}; seed=${seed.length}`);
    return { name: CONFIG.SHEET_PATTERN, created: got.created };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildPatternMaster', error, '');
    throw error;
  }
}

/**
 * 備考マスタを作る。備考行に押す文字（銀行など）。
 *
 * シフトパターンとは別にする。銀行はシフトのパターンではなく、
 * 混ぜると開始・終了の列が意味を持たない行ができる。
 *
 * @return {{name:string, created:boolean}}
 */
function buildNoteMaster() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_NOTE);
    const sheet = got.sheet;
    const heads = NOTE_MASTER.HEADS;

    setIfBlank_(sheet.getRange(NOTE_MASTER.HDR_ROW, 1, 1, heads.length), [heads]);
    styleHeaderRange_(sheet.getRange(NOTE_MASTER.HDR_ROW, 1, 1, heads.length));

    const seed = NOTE_MASTER.SEED;
    setIfBlank_(sheet.getRange(NOTE_MASTER.FIRST_ROW, 1, seed.length, heads.length),
      seed.map(function (row) { return row.slice(); }));

    if (got.created) {
      sheet.setColumnWidth(NOTE_MASTER.COL_TEXT, 100);
      sheet.setColumnWidth(NOTE_MASTER.COL_DESC, 220);
      sheet.setFrozenRows(NOTE_MASTER.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildNoteMaster',
      `sheet=${CONFIG.SHEET_NOTE}; created=${got.created}; seed=${seed.length}`);
    return { name: CONFIG.SHEET_NOTE, created: got.created };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildNoteMaster', error, '');
    throw error;
  }
}

/**
 * 祝日マスタシートを作る（見出しだけ。データの取込は Holidays.gs）。
 * @return {{name:string, created:boolean, sheet:GoogleAppsScript.Spreadsheet.Sheet}}
 */
function buildHolidaySheet() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_HOLIDAY);
    const sheet = got.sheet;

    setIfBlank_(sheet.getRange(HOLIDAY_SHEET.HDR_ROW, HOLIDAY_SHEET.COL_DATE, 1, 2),
      [SCHEMA.HOLIDAY_HEADS]);
    styleHeaderRange_(sheet.getRange(HOLIDAY_SHEET.HDR_ROW, HOLIDAY_SHEET.COL_DATE, 1, 2));

    if (got.created) {
      // 日付列は必ず日付型で持つ。文字列だと COUNTIF が一致せず、
      // 祝日サマリーも条件付き書式も静かに 0 件になる
      sheet.getRange(HOLIDAY_SHEET.FIRST_ROW, HOLIDAY_SHEET.COL_DATE,
        sheet.getMaxRows() - HOLIDAY_SHEET.FIRST_ROW + 1, 1)
        .setNumberFormat('yyyy/mm/dd');
      sheet.setColumnWidth(HOLIDAY_SHEET.COL_DATE, 110);
      sheet.setColumnWidth(HOLIDAY_SHEET.COL_NAME, 180);
      sheet.setFrozenRows(HOLIDAY_SHEET.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildHolidaySheet',
      `sheet=${CONFIG.SHEET_HOLIDAY}; created=${got.created}`);
    return { name: CONFIG.SHEET_HOLIDAY, created: got.created, sheet: sheet };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildHolidaySheet', error, '');
    throw error;
  }
}

/**
 * 変更ログシートを作る。見出しは最初から 10 列（CHANGELOG_SHEET.HEADS）。
 * VBA 版は見出し 6 列で作り、GetLogSheet が 7〜10 列を後付けしていた（§3.4）。
 * @return {{name:string, created:boolean}}
 */
function buildChangeLogSheet() {
  try {
    const got = getOrAddSheet_(CONFIG.SHEET_LOG);
    const sheet = got.sheet;
    const heads = CHANGELOG_SHEET.HEADS;

    setIfBlank_(sheet.getRange(CHANGELOG_SHEET.HDR_ROW, 1, 1, heads.length), [heads]);
    styleHeaderRange_(sheet.getRange(CHANGELOG_SHEET.HDR_ROW, 1, 1, heads.length));

    if (got.created) {
      // 変更前/変更後は文字列で持つ。"公休" などが日付に化けるのを防ぐ
      const rows = sheet.getMaxRows() - CHANGELOG_SHEET.FIRST_ROW + 1;
      sheet.getRange(CHANGELOG_SHEET.FIRST_ROW, CHANGELOG_SHEET.COL_BEFORE, rows, 2)
        .setNumberFormat('@');
      sheet.setFrozenRows(CHANGELOG_SHEET.HDR_ROW);
    }

    logSuccess(MODULE_SCHEMA, 'buildChangeLogSheet',
      `sheet=${CONFIG.SHEET_LOG}; created=${got.created}`);
    return { name: CONFIG.SHEET_LOG, created: got.created };
  } catch (error) {
    logError(MODULE_SCHEMA, 'buildChangeLogSheet', error, '');
    throw error;
  }
}

/**
 * シートを取得、無ければ追加。移植元: SC_GetOrAdd
 * @return {{sheet:GoogleAppsScript.Spreadsheet.Sheet, created:boolean}}
 */
function getOrAddSheet_(name) {
  const ss = SpreadsheetApp.getActive();
  const existing = ss.getSheetByName(name);
  if (existing) return { sheet: existing, created: false };
  return { sheet: ss.insertSheet(name), created: true };
}

/**
 * 空欄のセルにだけ書く。既存の値を消さないための唯一の入口。移植元: SC_SetIfBlank
 *
 * 範囲まるごと1回読んで1回書く（§8.3-3）。1セルでも埋まっていれば、
 * そのセルは元の値のまま残す。
 *
 * @param {GoogleAppsScript.Spreadsheet.Range} range 書き込む範囲
 * @param {Array<Array<*>>} values 範囲と同じ形の値
 */
function setIfBlank_(range, values) {
  const current = range.getValues();
  let changed = false;

  const out = current.map(function (row, i) {
    return row.map(function (v, j) {
      const blank = String(v == null ? '' : v).trim() === '';
      const wanted = (values[i] && values[i][j] !== undefined) ? values[i][j] : v;
      if (blank && String(wanted).trim() !== '') {
        changed = true;
        return wanted;
      }
      return v;
    });
  });

  if (changed) range.setValues(out);
}

/** 見出しの体裁を整える。移植元: SC_StyleHeader */
function styleHeaderRange_(range) {
  range.setFontWeight('bold').setBackground(SHEET_BUILD.COLOR_HEADER_BG);
}

/**
 * 列に選択リスト（データの検証）を付ける。移植元: SC_AddList
 *
 * 入力を止めるのではなく警告にする。実物のシートには「薬剤師（時短）」のような
 * 想定外の書き方が入っていることがあり、拒否すると既存データを壊すため。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 対象シート
 * @param {number} colNo 列番号
 * @param {string[]} choices 選択肢
 */
function addColumnValidation_(sheet, colNo, choices) {
  addColumnValidationFrom_(sheet, colNo, CFG_MEMBER.FIRST_ROW, choices);
}

/** 開始行を指定できる版。マスタごとに見出し行の位置が違うため。 */
function addColumnValidationFrom_(sheet, colNo, firstRow, choices) {
  const rows = sheet.getMaxRows() - firstRow + 1;
  if (rows <= 0) return;
  const rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(choices, true)
    .setAllowInvalid(true)
    .setHelpText(`候補: ${choices.join(' / ')}`)
    .build();
  sheet.getRange(firstRow, colNo, rows, 1).setDataValidation(rule);
}
