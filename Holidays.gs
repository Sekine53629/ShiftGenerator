/**
 * Holidays.gs — 祝日マスタの取込
 *
 * 移植元: ShiftSchema.bas の ShiftSchema_祝日マスタ取込 / SC_祝日M式（Power Query）
 * 仕様書: §7.2
 *
 * Power Query → UrlFetchApp。VBA 版の「Excel 2016 以降が要る」制限は消える。
 * `script.external_request` スコープが要る。
 *
 * 【日付は必ず日付型で書く】
 *   文字列で入れると、祝日サマリーの COUNTIF も条件付き書式も一致せず、
 *   エラーにならないまま「祝日 0 件」として動く。§5.3 の MATCH と同じ質の罠。
 */

const MODULE_HOLIDAYS = 'Holidays';

/**
 * メニュー「祝日マスタを取り込む」。
 * 内閣府の CSV を丸ごと取り直し、既存データを消してから1回で書く（§8.3-3）。
 */
function importHolidays() {
  const started = Date.now();
  try {
    const res = UrlFetchApp.fetch(CONFIG.HOLIDAY_CSV_URL, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) {
      throw new Error(`祝日 CSV を取得できませんでした（HTTP ${res.getResponseCode()}）。`);
    }
    // 内閣府の CSV は Shift-JIS
    const text = res.getBlob().getDataAsString('Shift_JIS');
    const rows = parseHolidayCsv_(text);
    if (rows.length === 0) {
      throw new Error('祝日 CSV を読めましたが、日付が1件も取れませんでした。書式が変わった可能性があります。');
    }

    const sheet = buildHolidaySheet().sheet;
    const last = sheet.getLastRow();
    if (last >= HOLIDAY_SHEET.FIRST_ROW) {
      sheet.getRange(HOLIDAY_SHEET.FIRST_ROW, HOLIDAY_SHEET.COL_DATE,
        last - HOLIDAY_SHEET.FIRST_ROW + 1, 2).clearContent();
    }
    sheet.getRange(HOLIDAY_SHEET.FIRST_ROW, HOLIDAY_SHEET.COL_DATE, rows.length, 2)
      .setValues(rows);
    sheet.getRange(HOLIDAY_SHEET.FIRST_ROW, HOLIDAY_SHEET.COL_DATE, rows.length, 1)
      .setNumberFormat('yyyy/mm/dd');
    SpreadsheetApp.flush();

    const first = rows[0][0];
    const lastDate = rows[rows.length - 1][0];
    logSuccess(MODULE_HOLIDAYS, 'importHolidays',
      `rows=${rows.length}; from=${toDateKey(first)}; to=${toDateKey(lastDate)}; `
      + `elapsedMs=${Date.now() - started}`);

    SpreadsheetApp.getUi().alert(
      `祝日を ${rows.length} 件取り込みました。\n`
      + `${toDateKey(first)} 〜 ${toDateKey(lastDate)}`);
    return rows.length;
  } catch (error) {
    logError(MODULE_HOLIDAYS, 'importHolidays', error, '', true);
    SpreadsheetApp.getUi().alert(`祝日の取込に失敗しました。\n\n${error.message}`);
    throw error;
  }
}

/**
 * CSV のテキストを [[Date, 名称], ...] に整える。
 * @param {string} csvText Shift_JIS からデコード済みのテキスト
 * @return {Array<Array<*>>}
 */
function parseHolidayCsv_(csvText) {
  return toHolidayRows_(Utilities.parseCsv(csvText));
}

/**
 * parseCsv の結果を [[Date, 名称], ...] にする。
 * ネットワークにも SpreadsheetApp にも触らない純粋関数なのでテストできる。
 *
 * 内閣府の CSV は1行目が見出し（「国民の祝日・休日月日」「…名称」）で、
 * 日付は "2026/1/1" 形式。読めない行は黙って捨てる
 * （見出しや空行が混ざっていても止まらないようにするため）。
 *
 * @param {Array<Array<string>>} rows parseCsv の結果
 * @return {Array<Array<*>>}
 */
function toHolidayRows_(rows) {
  const out = [];
  (rows || []).forEach(function (row) {
    if (!row || row.length < 1) return;
    const date = parseHolidayDate_(row[0]);
    if (!date) return;
    out.push([date, String(row[1] == null ? '' : row[1]).trim()]);
  });
  return out;
}

/**
 * "2026/1/1" や "2026-01-01" を Date にする。読めなければ null。
 * new Date(文字列) に頼らないのは、区切りや桁数で解釈が環境任せになるため。
 *
 * @param {string} text
 * @return {Date|null}
 */
function parseHolidayDate_(text) {
  const m = String(text == null ? '' : text).trim().match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (!m) return null;

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(year, month - 1, day);
  // 2026/2/30 のような存在しない日は Date が繰り上げてしまうので弾く
  if (date.getFullYear() !== year || date.getMonth() !== month - 1
    || date.getDate() !== day) return null;
  return date;
}

/**
 * 祝日マスタを「日付キー → 名称」の辞書として読む。
 * 自動作成の工程2（日情報）と Web アプリの表示が使う。シートは1回だけ読む。
 * 祝日マスタが無い／空でも例外にせず空の辞書を返す（祝日なしとして続行できる）。
 * @return {Object<string,string>}
 */
function loadHolidayMap() {
  try {
    const sheet = getSheetOrNull(CONFIG.SHEET_HOLIDAY);
    if (!sheet) return {};
    const last = sheet.getLastRow();
    if (last < HOLIDAY_SHEET.FIRST_ROW) return {};

    const rows = sheet.getRange(HOLIDAY_SHEET.FIRST_ROW, HOLIDAY_SHEET.COL_DATE,
      last - HOLIDAY_SHEET.FIRST_ROW + 1, 2).getValues();
    const map = {};
    rows.forEach(function (r) {
      if (r[0] instanceof Date) map[toDateKey(r[0])] = String(r[1] || '');
    });
    return map;
  } catch (error) {
    logError(MODULE_HOLIDAYS, 'loadHolidayMap', error, '');
    return {};
  }
}

/**
 * 日付を 'yyyy-MM-dd' のキーにする。祝日の突き合わせに使う。
 * Date をそのまま比較すると時刻の差で外れるので、必ずこのキーで比べること。
 * @param {Date} date
 * @return {string}
 */
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
