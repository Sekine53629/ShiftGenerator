/**
 * FormatProfile.gs — 運用中のシフト表から書式を吸い出し、生成に使う
 *
 * VBA 版には無い機能。仕様書 §3.1 はシートの「構造」だけを決めていて、
 * 色・行の高さ・文字サイズといった見た目は決めていない。
 * 実物に合わせて生成するために、実物から測って持っておく。
 *
 * 【位置ではなく「行の役割」で持つ】
 *   セル位置ごとに丸写しすると、スタッフが1人増えただけで全部ずれる。
 *   「日付行の背景色」「入力欄の文字サイズ」という単位なら、
 *   行数が変わっても、来年の表にもそのまま効く。
 *
 * 【値（セルの中身）は取らない】
 *   取るのは書式と、位置が決まっているラベル（集計行の見出しなど）だけ。
 *   氏名・医師名・面談日程は対象外。リポジトリには入れない。
 *
 * 【置き場：スクリプトプロパティが「正」】
 *   環境ごとの設定なので、GAS で .env に相当するスクリプトプロパティ
 *   （CONFIG.PROP_FORMAT_PROFILE）に JSON 1件で持つ。
 *   ADMIN_EMAIL / EXPORT_FOLDER_ID と同じ置き場で、利用者が誤って壊せない。
 *
 *   「書式プロファイル」シートは**控えと手直し用**。生成はシートを読まない。
 *   手で直したら「書式プロファイルを反映」を実行して書き戻す。
 *   2か所を同時に正にすると、どちらが効いているのか分からなくなるため、
 *   反映は明示的な一手にしてある。
 *
 *      取り込み : 実物のシート ──▶ プロパティ（正）─┬─▶ 控えシート
 *      手直し   : 控えシート ──「反映」──▶ プロパティ（正）
 *      生成     : プロパティ（正）──▶ 新しいシフト表
 *
 * 【読み書きの約束（§8.3-3）】
 *   書式の読み出しは表示ブロックを丸ごと1回。行の高さと列幅だけは
 *   単発 API しか無いので、役割の数（9回）と列の種類（3回）に絞る。
 */

const MODULE_FORMATPROFILE = 'FormatProfile';

/**
 * メニュー「実物の書式を取り込む」。
 * いま開いているシートの書式を測り、「書式プロファイル」シートへ書く。
 */
function captureFormatProfile() {
  const started = Date.now();
  try {
    const ui = SpreadsheetApp.getUi();
    const sheet = SpreadsheetApp.getActiveSheet();

    let layout;
    try {
      layout = resolveLayout(sheet);
    } catch (ignored) {
      ui.alert([
        `シート「${sheet.getName()}」はシフト表として読めませんでした。`,
        '',
        '取り込みたい実物のシフト表を開いてから、もう一度実行してください。',
        '（B列に日付の数式が2つあり、A列に「備考」がある形が目印です）',
      ].join('\n'));
      return null;
    }

    const profile = readSheetFormat_(sheet, layout);
    const saved = saveFormatProfile_(profile);      // ← 正はこちら
    writeProfileSheet_(profile, sheet.getName());   // 控え（人が読む・直す用）
    SpreadsheetApp.flush();

    logSuccess(MODULE_FORMATPROFILE, 'captureFormatProfile',
      `from=${sheet.getName()}; keys=${Object.keys(saved).length}; `
      + `cfRules=${(profile._conditionalFormats || []).length}; `
      + `elapsedMs=${Date.now() - started}`);

    const cfRules = profile._conditionalFormats || [];
    const cfUsed = Object.keys(deriveDayColorsFromRules_(cfRules)).length;

    ui.alert([
      `「${sheet.getName()}」の書式を取り込みました。`,
      '',
      `${Object.keys(saved).length} 項目をスクリプトプロパティに保存しました。`,
      cfRules.length > 0
        ? `条件付き書式が ${cfRules.length} 件見つかり、うち ${cfUsed} 件を`
          + '土日・月外の色として使いました。'
          + `残り ${cfRules.length - cfUsed} 件は引き継いでいません`
          + `（「${CONFIG.SHEET_PROFILE}」シートの末尾に一覧があります）。`
        : '条件付き書式は見つかりませんでした。',
      `同じ内容を「${CONFIG.SHEET_PROFILE}」シートにも控えとして書いています。`,
      '',
      '次に作るシフト表からこの書式で生成されます。',
      'シートの値を手で直した場合は「書式プロファイルを反映」を実行してください',
      '（生成が読むのはスクリプトプロパティのほうです）。',
      '',
      '※ 氏名・医師名・面談日程などセルの中身は取り込んでいません。',
      '※ 元のシフト表は読んだだけで、書き換えていません。',
    ].join('\n'));
    return profile;
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'captureFormatProfile', error, '', true);
    SpreadsheetApp.getUi().alert(`書式の取り込みに失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * シートの書式を測って、キーと値の辞書にする。
 *
 * 役割ごとに「代表セル」を1つ決めて、そこの書式を役割全体の書式とみなす。
 * 代表セルは日付列の先頭（B列）。A列は氏名なので書式が違い、
 * 集計列は別の書式を持つため、どちらも代表には向かない。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 実物のシフト表
 * @param {Object} layout resolveLayout の戻り値
 * @return {Object<string,*>}
 */
function readSheetFormat_(sheet, layout) {
  const profile = {};

  // --- 書式は1回の読みで全部取る ---
  const block = sheet.getRange(1, 1, layout.shortageRow, LAYOUT.COL_KIND_WORK);
  const bg = block.getBackgrounds();
  const fg = block.getFontColors();
  const size = block.getFontSizes();
  const weight = block.getFontWeights();
  const align = block.getHorizontalAlignments();
  const numFmt = block.getNumberFormats();
  const values = block.getValues();
  const at = function (grid, row, col) { return grid[row - 1][col - 1]; };

  const roleRow = roleRowMap_(layout);
  FORMAT_PROFILE.ROLES.forEach(function (role) {
    const row = roleRow[role.key];
    const col = layout.firstCol;
    profile[`role.${role.key}.height`] = sheet.getRowHeight(row);
    profile[`role.${role.key}.bg`] = at(bg, row, col);
    profile[`role.${role.key}.fontColor`] = at(fg, row, col);
    profile[`role.${role.key}.fontSize`] = at(size, row, col);
    profile[`role.${role.key}.bold`] = at(weight, row, col) === 'bold';
    profile[`role.${role.key}.hAlign`] = at(align, row, col);
  });

  // --- 列幅。日付列と集計列は代表を1つずつ取る ---
  profile['col.name.width'] = sheet.getColumnWidth(1);
  profile['col.day.width'] = sheet.getColumnWidth(layout.firstCol);
  profile['col.agg.width'] = sheet.getColumnWidth(LAYOUT.COL_AGG_FIRST);

  // --- 曜日ごとの色 ---
  //
  // 【落とし穴】getBackgrounds() はセルに直接設定された色しか返さない。
  // 条件付き書式で付いた色は返らず、下地（たいてい白）が返る。
  // 実物が条件付き書式で土日を色分けしていると、ここが真っ白になる。
  // エラーも出ないので、静的な色と条件付き書式の両方から拾って突き合わせる。
  const staticColors = readWeekdayColors_(sheet, layout, bg, fg, values);
  const cfRules = readConditionalFormats_(sheet);
  const cfColors = deriveDayColorsFromRules_(cfRules);

  ['day.satBg', 'day.sunBg', 'day.outMonthBg', 'day.outMonthFg'].forEach(function (key) {
    profile[key] = pickDayColor_(staticColors[key], cfColors[key], FORMAT_DEFAULT[key]);
  });
  profile._conditionalFormats = cfRules;   // 控えシートに載せるための添え物（保存はしない）

  // --- 表示形式 ---
  profile['format.date'] = at(numFmt, layout.dateRow, layout.firstCol);
  profile['format.month'] = at(numFmt, layout.headerRow, 1);

  // --- ラベル（位置が決まっているものだけ。氏名や医師名は取らない） ---
  profile['label.doc'] = labelOrDefault_(at(values, layout.docRow, 1), 'label.doc');
  profile['label.pharm'] = labelOrDefault_(at(values, layout.pharmRow, 1), 'label.pharm');
  profile['label.shortage'] = labelOrDefault_(at(values, layout.shortageRow, 1), 'label.shortage');
  profile['label.note'] = labelOrDefault_(at(values, layout.noteRow, 1), 'label.note');

  const aggHeads = [];
  for (let c = LAYOUT.COL_AGG_FIRST; c <= LAYOUT.COL_AGG_LAST; c++) {
    aggHeads.push(String(at(values, layout.repeatDateRow, c) || '').trim());
  }
  if (aggHeads.some(function (h) { return h !== ''; })) {
    profile['label.agg'] = aggHeads.join(',');
  }

  return profile;
}

/**
 * 役割 → 代表行の対応。
 * 自由行は「医師名欄の1行下」で、Layout は名前を持っていないのでここで決める。
 */
function roleRowMap_(layout) {
  return {
    header: layout.headerRow,
    date: layout.dateRow,
    week: layout.weekRow,
    doctor: layout.doctorTop,
    free: layout.doctorBottom + 1,
    repeatDate: layout.repeatDateRow,
    grid: layout.gridTop,
    note: layout.noteRow,
    total: layout.docRow,
  };
}

/**
 * 土曜・日曜・月外の色を、日付行から実際にその曜日の列を探して拾う。
 *
 * 月によって曜日の並びが変わるので、列位置を決め打ちにはできない。
 * 見つからない曜日は既定値のまま（プロファイルに書かない）。
 */
function readWeekdayColors_(sheet, layout, bg, fg, values) {
  const out = {};
  const monthValue = values[layout.headerRow - 1][0];
  const targetMonth = (monthValue instanceof Date) ? monthValue.getMonth() : -1;

  for (let c = layout.firstCol; c <= layout.lastCol; c++) {
    const date = values[layout.dateRow - 1][c - 1];
    if (!(date instanceof Date)) continue;

    const cellBg = bg[layout.dateRow - 1][c - 1];
    if (targetMonth >= 0 && date.getMonth() !== targetMonth) {
      if (!out['day.outMonthBg']) {
        out['day.outMonthBg'] = cellBg;
        out['day.outMonthFg'] = fg[layout.dateRow - 1][c - 1];
      }
      continue;
    }
    if (date.getDay() === 6 && !out['day.satBg']) out['day.satBg'] = cellBg;
    if (date.getDay() === 0 && !out['day.sunBg']) out['day.sunBg'] = cellBg;
  }
  return out;
}

/**
 * シートの条件付き書式を、扱いやすい形にして返す。
 *
 * getBackgrounds() では条件付き書式の色が取れないので、ルール側から直接読む。
 * ここで読んだものは色の抽出に使い、**使わなかったルールも控えシートに載せる**。
 * 黙って落とすと「実物にあった色分けが再現されない」理由が誰にも分からなくなる。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 実物のシフト表
 * @return {Array<{index:number, kind:string, formula:string, bg:string,
 *                 fontColor:string, ranges:string}>}
 */
function readConditionalFormats_(sheet) {
  try {
    return sheet.getConditionalFormatRules().map(function (rule, i) {
      const ranges = rule.getRanges()
        .map(function (r) { return r.getA1Notation(); }).join(', ');
      const cond = rule.getBooleanCondition();
      if (!cond) {
        // グラデーションルール。色の抽出には使えない
        return { index: i + 1, kind: 'グラデーション', formula: '', bg: '',
                 fontColor: '', ranges: ranges };
      }
      const values = cond.getCriteriaValues() || [];
      return {
        index: i + 1,
        kind: String(cond.getCriteriaType()),
        formula: values.length ? String(values[0]) : '',
        bg: cond.getBackground() || '',
        fontColor: cond.getFontColor() || '',
        ranges: ranges,
      };
    });
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'readConditionalFormats_', error, '');
    return [];
  }
}

/**
 * 条件付き書式のルールから、土曜・日曜・月外の色を推測する。
 * SpreadsheetApp を呼ばない純粋関数なのでテストできる。
 *
 * 数式の中身から役割を当てる**推測**であることに注意。
 * 当たらなかったものは控えシートに残るので、利用者が見て直せる。
 *
 * @param {Array<Object>} rules readConditionalFormats_ の戻り値
 * @return {Object<string,string>}
 */
function deriveDayColorsFromRules_(rules) {
  const out = {};
  (rules || []).forEach(function (rule) {
    const f = String(rule.formula || '');
    if (f === '' || !rule.bg) return;

    // 月外の判定を先に見る。WEEKDAY と MONTH の両方を含む式もあるため
    if (/MONTH\s*\(/i.test(f) && /<>/.test(f)) {
      if (!out['day.outMonthBg']) {
        out['day.outMonthBg'] = rule.bg;
        if (rule.fontColor) out['day.outMonthFg'] = rule.fontColor;
      }
      return;
    }
    if (/WEEKDAY\s*\([^)]*\)\s*=\s*7/i.test(f) && !out['day.satBg']) {
      out['day.satBg'] = rule.bg;
      return;
    }
    if (/WEEKDAY\s*\([^)]*\)\s*=\s*1/i.test(f) && !out['day.sunBg']) {
      out['day.sunBg'] = rule.bg;
    }
  });
  return out;
}

/**
 * 静的な背景色と、条件付き書式から拾った色のどちらを採るか決める。
 *
 * 静的な色が白／未設定なら「塗っていない」とみなし、条件付き書式の色を採る。
 * どちらも無ければ既定値。
 *
 * @param {string} staticColor getBackgrounds() から拾った色
 * @param {string} cfColor 条件付き書式から拾った色
 * @param {string} fallback 既定値
 * @return {string}
 */
function pickDayColor_(staticColor, cfColor, fallback) {
  const isBlank = function (c) {
    const v = String(c || '').trim().toLowerCase();
    return v === '' || v === '#ffffff' || v === 'white' || v === '#fff';
  };
  if (!isBlank(staticColor)) return staticColor;
  if (!isBlank(cfColor)) return cfColor;
  return fallback;
}

/** ラベルが空なら既定値を使う。手で変えた見出しは尊重する。 */
function labelOrDefault_(value, key) {
  const v = String(value == null ? '' : value).trim();
  return v === '' ? FORMAT_DEFAULT[key] : v;
}

/**
 * プロファイルをシートへ書く。既存の行は値だけ更新し、無いキーは追記する。
 * 利用者が手で直した値を消さないため、キーで突き合わせる。
 */
function writeProfileSheet_(profile, sourceName) {
  const got = getOrAddSheet_(CONFIG.SHEET_PROFILE);
  const sheet = got.sheet;

  setIfBlank_(sheet.getRange(FORMAT_PROFILE.HDR_ROW, FORMAT_PROFILE.COL_KEY, 1, 3),
    [FORMAT_PROFILE.HEADS]);
  styleHeaderRange_(sheet.getRange(FORMAT_PROFILE.HDR_ROW, FORMAT_PROFILE.COL_KEY, 1, 3));

  // `_` で始まるキーは添え物（保存対象ではない）。設定として並べない
  const rows = Object.keys(profile)
    .filter(function (key) { return key.indexOf('_') !== 0; })
    .sort()
    .map(function (key) { return [key, profile[key], describeProfileKey_(key)]; });

  rows.push(['(取り込み元)', sourceName, `${new Date().toLocaleString('ja-JP')} に取り込み`]);
  rows.push(['(このシートについて)', '控え',
    '生成が読むのはスクリプトプロパティです。ここを直したら'
    + '「初期設定 → 書式プロファイルを反映」を実行してください']);

  // --- 見つけた条件付き書式を全部載せる ---
  //   色として拾えたものだけを黙って使うと、拾えなかったルールの存在が
  //   誰にも見えなくなる。「実物にあった色分けが再現されない」理由を
  //   追えるように、使わなかったものも含めて並べる。
  const cfRules = profile._conditionalFormats || [];
  if (cfRules.length > 0) {
    rows.push(['(条件付き書式)', `${cfRules.length} 件`,
      '下は実物にあったルールの一覧です。設定項目ではありません。'
      + '土日・月外の色はここから拾っています。'
      + 'それ以外のルール（担当者の色分けなど）は引き継いでいません']);
    cfRules.forEach(function (rule) {
      rows.push([
        `(条件付き書式 ${rule.index})`,
        rule.bg || '(色なし)',
        `${rule.ranges} / ${rule.kind} / ${rule.formula}`,
      ]);
    });
  }

  const last = sheet.getLastRow();
  if (last >= FORMAT_PROFILE.FIRST_ROW) {
    sheet.getRange(FORMAT_PROFILE.FIRST_ROW, FORMAT_PROFILE.COL_KEY,
      last - FORMAT_PROFILE.FIRST_ROW + 1, 3).clearContent();
  }
  sheet.getRange(FORMAT_PROFILE.FIRST_ROW, FORMAT_PROFILE.COL_KEY, rows.length, 3)
    .setValues(rows);

  if (got.created) {
    sheet.setColumnWidth(FORMAT_PROFILE.COL_KEY, 210);
    sheet.setColumnWidth(FORMAT_PROFILE.COL_VALUE, 130);
    sheet.setColumnWidth(FORMAT_PROFILE.COL_NOTE, 320);
    sheet.setFrozenRows(FORMAT_PROFILE.HDR_ROW);
  }
}

/** キーの意味を日本語で返す。プロファイルシートを人が読めるようにするため。 */
function describeProfileKey_(key) {
  const parts = key.split('.');
  if (parts[0] === 'role') {
    const role = FORMAT_PROFILE.ROLES.filter(function (r) { return r.key === parts[1]; })[0];
    const attr = FORMAT_PROFILE.ATTRS.filter(function (a) { return a.key === parts[2]; })[0];
    if (role && attr) return `${role.label} の ${attr.label}`;
  }
  const fixed = {
    'col.name.width': '氏名列（A）の幅',
    'col.day.width': '日付列（B〜AF）の幅',
    'col.agg.width': '集計列（AH〜AM）の幅',
    'day.satBg': '土曜の背景色',
    'day.sunBg': '日曜・祝日の背景色',
    'day.outMonthBg': '月外の日の背景色',
    'day.outMonthFg': '月外の日の文字色',
    'format.date': '日付の表示形式',
    'format.month': '年月セルの表示形式',
    'title.col': '和暦の見出しを置く列（1=A / 4=D）',
    'title.formula': '和暦の見出しの数式。{month} が年月セルに置き換わる。'
      + '空にすると書かない（手で入力する）',
    '_excelMonthFormat': '（参考）Excel 側の年月セルの表示形式。Sheets には持ち込めません',
    'label.doc': '集計行 A列の見出し（医師数）',
    'label.pharm': '集計行 A列の見出し（薬剤師出勤数）',
    'label.shortage': '集計行 A列の見出し（過不足）',
    'label.note': '備考行 A列の見出し',
    'label.doctors': '医師名欄 A列の見出し',
    'label.agg': '集計列の見出し（カンマ区切り6個）',
    'sheet.borderColor': '罫線の色',
    'sheet.leaveBg': '休業者の行に塗る色',
  };
  return fixed[key] || '';
}

/**
 * 書式プロファイルを読む。既定値に、シートの値を上書きして返す。
 * シートが無くても既定値で必ず動く（実物を取り込む前でもシートは作れる）。
 * @return {Object<string,*>}
 */
function loadFormatProfile() {
  try {
    const json = PropertiesService.getScriptProperties()
      .getProperty(CONFIG.PROP_FORMAT_PROFILE);
    return parseProfileJson_(json, FORMAT_DEFAULT);
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'loadFormatProfile', error, '');
    return parseProfileJson_(null, FORMAT_DEFAULT);   // 読めなくても既定値で動かす
  }
}

/**
 * スクリプトプロパティの JSON を既定値へ重ねる。SpreadsheetApp を呼ばない純粋関数。
 *
 * 壊れた JSON でも例外にしない。書式が読めないことで
 * シフト表そのものが作れなくなるのは割に合わないので、既定値で作る側に倒す。
 *
 * @param {string|null} json 保存されている JSON
 * @param {Object<string,*>} defaults 既定値
 * @return {Object<string,*>}
 */
function parseProfileJson_(json, defaults) {
  if (!json) return mergeProfileRows_(defaults, []);

  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (ignored) {
    console.error(`[${MODULE_FORMATPROFILE}.parseProfileJson_] `
      + '書式プロファイルの JSON が壊れています。既定値で続行します。');
    return mergeProfileRows_(defaults, []);
  }
  if (!parsed || typeof parsed !== 'object') return mergeProfileRows_(defaults, []);

  const rows = Object.keys(parsed).map(function (key) { return [key, parsed[key]]; });
  return mergeProfileRows_(defaults, rows);
}

/**
 * メニュー「書式プロファイルを読み込む」。
 * Excel 側のエクスポータ（tools/ExportFormatProfile.bas）が出した JSON を貼る画面を出す。
 */
function showProfileImportDialog() {
  try {
    const html = HtmlService.createHtmlOutputFromFile('ImportProfileView')
      .setWidth(720).setHeight(520);
    SpreadsheetApp.getUi().showModalDialog(html, '書式プロファイルを読み込む');
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'showProfileImportDialog', error, '');
    throw error;
  }
}

/**
 * Excel から書き出した JSON を取り込み、スクリプトプロパティへ保存する。
 *
 * 【なぜ Excel 側で測るのか】
 *   Excel ブックを Google スプレッドシートへ取り込むと、条件付き書式の数式や
 *   一部の書式が落ちる。落ちたあとを測っても元の見た目は分からない。
 *   Excel 側で測れば、変換で失われる前の値が取れる。
 *
 * 知らないキーは捨てるが、**捨てたことは呼び出し元へ返す**。
 * 黙って落とすと「Excel で見えている書式が反映されない」理由が追えなくなる。
 *
 * @param {string} jsonText 貼り付けられた JSON
 * @return {{keys:number, cfRules:number, cfUsed:number, unknown:string[], changed:number}}
 */
function importFormatProfileJson(jsonText) {
  const started = Date.now();
  try {
    const parsed = parseImportedJson_(jsonText);

    // 条件付き書式から土日・月外の色を拾い、静的な塗りが無いところを埋める
    const cfRules = Array.isArray(parsed._conditionalFormats) ? parsed._conditionalFormats : [];
    const cfColors = deriveDayColorsFromRules_(cfRules);
    ['day.satBg', 'day.sunBg', 'day.outMonthBg', 'day.outMonthFg'].forEach(function (key) {
      parsed[key] = pickDayColor_(parsed[key], cfColors[key], FORMAT_DEFAULT[key]);
    });

    const unknown = Object.keys(parsed).filter(function (key) {
      return key.indexOf('_') !== 0
        && !Object.prototype.hasOwnProperty.call(FORMAT_DEFAULT, key);
    });

    const merged = parseProfileJson_(JSON.stringify(parsed), FORMAT_DEFAULT);
    const saved = saveFormatProfile_(merged);

    merged._conditionalFormats = cfRules;
    writeProfileSheet_(merged, 'Excel からの読み込み');
    SpreadsheetApp.flush();

    const changed = Object.keys(saved).filter(function (key) {
      return saved[key] !== FORMAT_DEFAULT[key];
    }).length;

    logSuccess(MODULE_FORMATPROFILE, 'importFormatProfileJson',
      `keys=${Object.keys(saved).length}; changed=${changed}; cfRules=${cfRules.length}; `
      + `cfUsed=${Object.keys(cfColors).length}; unknown=${unknown.length}; `
      + `elapsedMs=${Date.now() - started}`);

    return {
      keys: Object.keys(saved).length,
      changed: changed,
      cfRules: cfRules.length,
      cfUsed: Object.keys(cfColors).length,
      unknown: unknown,
    };
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'importFormatProfileJson', error,
      `length=${jsonText && jsonText.length}`);
    throw error;
  }
}

/**
 * 貼り付けられた文字列を JSON として読む。読めない理由を具体的に返す。
 * SpreadsheetApp を呼ばない純粋関数。
 *
 * @param {string} jsonText
 * @return {Object}
 */
function parseImportedJson_(jsonText) {
  const text = String(jsonText == null ? '' : jsonText).trim();
  if (text === '') throw new Error('何も貼られていません。');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (ignored) {
    throw new Error('JSON として読めませんでした。'
      + 'Excel 側の「GAS書式JSON」シート A1 の中身を、途中で切らずに'
      + 'すべてコピーできているか確かめてください。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('JSON の形が違います。{ ... } の形である必要があります。');
  }
  return parsed;
}

/**
 * 書式プロファイルをスクリプトプロパティへ保存する（ここが「正」）。
 * 既定値と同じ項目だけを保存する（知らないキーを持ち込まない）。
 */
function saveFormatProfile_(profile) {
  const clean = {};
  Object.keys(FORMAT_DEFAULT).forEach(function (key) {
    if (profile[key] !== undefined) clean[key] = profile[key];
  });
  PropertiesService.getScriptProperties()
    .setProperty(CONFIG.PROP_FORMAT_PROFILE, JSON.stringify(clean));
  return clean;
}

/**
 * メニュー「書式プロファイルを反映」。
 * 控えシートを手で直したあと、その内容をスクリプトプロパティ（正）へ書き戻す。
 *
 * 生成はシートを読まないので、**この一手を踏まないと直しは効かない**。
 * 2か所を同時に正にするとどちらが効いているか分からなくなるため、
 * あえて明示的な操作にしてある。
 */
function applyProfileSheet() {
  const started = Date.now();
  try {
    const ui = SpreadsheetApp.getUi();
    const sheet = getSheetOrNull(CONFIG.SHEET_PROFILE);
    if (!sheet) {
      ui.alert([
        `「${CONFIG.SHEET_PROFILE}」シートがありません。`,
        '',
        '先に「初期設定 → 実物の書式を取り込む」を実行してください。',
      ].join('\n'));
      return null;
    }

    const last = sheet.getLastRow();
    const rows = last < FORMAT_PROFILE.FIRST_ROW ? [] :
      sheet.getRange(FORMAT_PROFILE.FIRST_ROW, FORMAT_PROFILE.COL_KEY,
        last - FORMAT_PROFILE.FIRST_ROW + 1, 2).getValues();

    const merged = mergeProfileRows_(FORMAT_DEFAULT, rows);
    const saved = saveFormatProfile_(merged);
    const changed = Object.keys(saved).filter(function (key) {
      return saved[key] !== FORMAT_DEFAULT[key];
    });

    logSuccess(MODULE_FORMATPROFILE, 'applyProfileSheet',
      `keys=${Object.keys(saved).length}; nonDefault=${changed.length}; `
      + `elapsedMs=${Date.now() - started}`);

    ui.alert([
      '書式プロファイルを反映しました。',
      '',
      `${Object.keys(saved).length} 項目を保存（うち既定値と違うもの ${changed.length} 件）。`,
      '次に作るシフト表からこの書式になります。',
    ].join('\n'));
    return saved;
  } catch (error) {
    logError(MODULE_FORMATPROFILE, 'applyProfileSheet', error, '', true);
    SpreadsheetApp.getUi().alert(`反映に失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * プロファイルシートの行を既定値へ重ねる。SpreadsheetApp を呼ばない純粋関数。
 *
 * 既定値に無いキーは捨てる（打ち間違いや古いキーが混ざっても壊れないため）。
 * 空欄も捨てる（消しただけで既定値に戻る、という直感に合わせる）。
 *
 * @param {Object<string,*>} defaults 既定値（破壊せず複製して返す）
 * @param {Array<Array<*>>} rows [[キー, 値], ...]
 * @return {Object<string,*>}
 */
function mergeProfileRows_(defaults, rows) {
  const out = {};
  Object.keys(defaults).forEach(function (key) { out[key] = defaults[key]; });

  (rows || []).forEach(function (row) {
    const key = String(row[0] == null ? '' : row[0]).trim();
    if (!Object.prototype.hasOwnProperty.call(out, key)) return;

    const raw = row[1];
    if (raw === null || raw === undefined || String(raw).trim() === '') return;

    out[key] = coerceProfileValue_(out[key], raw);
  });
  return out;
}

/**
 * シートから読んだ値を、既定値と同じ型に揃える。
 * シートは数値も真偽値も文字列で返しうるので、型が混ざると
 * setFontSize に文字列を渡すような失敗になる。
 */
function coerceProfileValue_(defaultValue, raw) {
  if (typeof defaultValue === 'number') {
    const n = Number(raw);
    return isNaN(n) ? defaultValue : n;
  }
  if (typeof defaultValue === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const t = String(raw).trim().toLowerCase();
    if (['true', '1', 'はい', 'yes', '○'].indexOf(t) >= 0) return true;
    if (['false', '0', 'いいえ', 'no', '×', ''].indexOf(t) >= 0) return false;
    return defaultValue;
  }
  return String(raw);
}

/**
 * 役割の書式をまとめて取り出す。SheetBuilder が範囲へ当てるときに使う。
 * @param {Object<string,*>} profile loadFormatProfile の戻り値
 * @param {string} role 役割のキー
 * @return {{height:number, bg:string, fontColor:string, fontSize:number,
 *           bold:boolean, hAlign:string}}
 */
function roleFormat(profile, role) {
  return {
    height: profile[`role.${role}.height`],
    bg: profile[`role.${role}.bg`],
    fontColor: profile[`role.${role}.fontColor`],
    fontSize: profile[`role.${role}.fontSize`],
    bold: profile[`role.${role}.bold`],
    hAlign: profile[`role.${role}.hAlign`],
  };
}

/**
 * 役割の書式を範囲へ当てる。書式ごとに setXxx を1回ずつ呼ぶ（範囲まるごと）。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 対象シート
 * @param {number} row 行
 * @param {Object} fmt roleFormat の戻り値
 * @param {number} firstCol 先頭列
 * @param {number} numCols 列数
 */
function applyRoleFormat_(sheet, row, fmt, firstCol, numCols) {
  sheet.setRowHeight(row, fmt.height);
  sheet.getRange(row, firstCol, 1, numCols)
    .setBackground(fmt.bg)
    .setFontColor(fmt.fontColor)
    .setFontSize(fmt.fontSize)
    .setFontWeight(fmt.bold ? 'bold' : 'normal')
    .setHorizontalAlignment(normalizeHAlign_(fmt.hAlign));
}

/**
 * 横位置を Sheets が受ける語に揃える。
 * Excel の「標準」は general という語で出てくるが、Sheets の
 * setHorizontalAlignment はこれを受けない。落ちる代わりに left へ寄せる。
 * @param {string} value
 * @return {string} 'left' | 'center' | 'right'
 */
function normalizeHAlign_(value) {
  const v = String(value || '').trim().toLowerCase();
  return ['left', 'center', 'right'].indexOf(v) >= 0 ? v : 'left';
}
