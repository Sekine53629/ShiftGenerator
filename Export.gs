/**
 * Export.gs — 印刷用の出力（PDF）
 *
 * 移植元: ShiftExport.bas  仕様書: §7.3
 *
 * VBA 版は「値と書式を固めた別ブックを作って印刷設定を当てる」手順だったが、
 * Sheets はエクスポート URL に範囲と印刷設定を渡せるので、その手順ごと不要。
 * XP_BuildBook / XP_BakeFormats / XP_SetPageSetup は移植しない。
 *
 * 出力範囲は VBA 版と同じ 年月・タイトル行 〜 過不足行 / A 〜 AM。
 * Excel(.xlsx) 出力は優先度低。必要なら同じ URL の format=xlsx で足りる。
 */

const MODULE_EXPORT = 'Export';

/** PDF の余白。VBA 版 MARGIN_CM = 0.6 をインチへ直した値 */
const EXPORT_MARGIN_INCH = 0.24;

/**
 * メニュー「PDF 出力」。
 *
 *   const url = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?` +
 *     `format=pdf&gid=${sheet.getSheetId()}` +
 *     `&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false` +
 *     `&top_margin=...&bottom_margin=...&left_margin=...&right_margin=...` +
 *     `&r1=${top-1}&r2=${bottom}&c1=0&c2=${lastCol}`;
 *   const blob = UrlFetchApp.fetch(url, {
 *     headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
 *   }).getBlob().setName(fileName + '.pdf');
 *
 * 保存先は CONFIG.PROP_EXPORT_FOLDER_ID（スクリプトプロパティ）。
 * ロジックにフォルダ ID をハードコードしない（Tier 1 / Tier 2）。
 * 移植元: ShiftExport_シフト表出力
 */
function exportShiftPdf() {
  return notImplemented_(MODULE_EXPORT, 'exportShiftPdf', 7); // TODO(P7)
}

/**
 * 出力範囲（年月・タイトル行 〜 過不足行 / A 〜 AM）を返す。
 * 移植元: XP_SourceRange
 */
function getExportRange_(sheet, layout) {
  return notImplemented_(MODULE_EXPORT, 'getExportRange_', 7); // TODO(P7)
}

/**
 * 西暦の年を令和の2桁表記にする。2026 → '08'。
 *
 * ★ 令和固有。元号が変わったら CONFIG.WAREKI_BASE を直す。自動追従はできない。
 * 令和元年（2019）より前は和暦が変わるので、扱わずに例外にする。
 */
function warekiYear_(year) {
  const n = Number(year) - CONFIG.WAREKI_BASE;
  if (!(n >= 1)) {
    throw new Error('[warekiYear_] 令和元年より前は扱えません: ' + year);
  }
  return String(n).padStart(2, '0');
}

/**
 * 既定のファイル名（拡張子は付けない）。
 *
 *   さくら薬局北口店R08.09月シフト
 *
 * 実物の運用に合わせた形。ひな型は CONFIG.EXPORT_NAME が持ち、
 * 店舗名は設定シートから来る（ロジックに店名を書かない — Tier 1）。
 *
 * 移植元: XP_DefaultName
 */
function buildExportFileName_(store, year, month) {
  try {
    const name = String(store || '').trim();
    const m = Number(month);
    if (!(m >= 1 && m <= 12)) {
      throw new Error('月が不正です: ' + month);
    }
    return CONFIG.EXPORT_NAME
      .replace('{store}', name)
      .replace('{wa}', warekiYear_(year))
      .replace('{mm}', String(m).padStart(2, '0'));
  } catch (error) {
    console.error(`[buildExportFileName_] ${error.message}\nStack: ${error.stack}`);
    throw error;
  }
}

/**
 * 保存先フォルダ。スクリプトプロパティに無ければマイドライブ直下。
 * @return {Folder}
 */
function getExportFolder_() {
  return notImplemented_(MODULE_EXPORT, 'getExportFolder_', 7); // TODO(P7)
}

/* ================================================================
 *  スプレッドシートへ出力
 *
 *  画面で組んだ表を、そのままシートにする。**新しいシートを挿し込む。**
 *  既にあるシフト表シートは触らない。
 *
 *  作成用（Setup.gs / SheetBuilder.gs）とは目的が違う。あちらは
 *  「これから入力する枠」を作る。こちらは「もう出来上がった表」を
 *  配布と保管のために置く。だから数式も名前付き範囲も入れない。
 *  値と見た目だけの、動かないシートにする。
 * ================================================================ */

/**
 * Excel の文字数単位の列幅を px に直す。
 * Excel は「標準フォントの 0 が何個入るか」、Sheets は px で持つ。
 * px = 文字数 × 7 + 5（標準 11pt のときの換算）。
 */
function exportColPx_(chars) {
  return Math.round(Number(chars) * 7 + 5);
}

/** ポイントの行高を px に直す（1pt = 4/3 px） */
function exportRowPx_(points) {
  return Math.round(Number(points) * 4 / 3);
}

/**
 * 出力するシートの名前。同じ月を2回出しても前を消さない。
 *
 * **上書きしない。** 配ったあとに作り直すことがあり、
 * どちらを配ったのか分からなくなるほうが困る。
 */
function exportSheetName_(ss, base) {
  const name = String(base || '').trim().slice(0, 90) || 'シフト';
  if (!ss.getSheetByName(name)) return name;
  for (let i = 2; i < 100; i++) {
    const t = name + ' (' + i + ')';
    if (!ss.getSheetByName(t)) return t;
  }
  throw new Error('同じ名前のシートが多すぎます: ' + name);
}

/**
 * 画面の表（sheetModel_ が返す格子）を、新しいシートに書く。
 *
 * 書き込みは**範囲ごとに1回ずつ**。セル単位で回すと、38列×40行で
 * 1,500 往復になり、6分の制限に触れる（Tier 2・Tier 3）。
 *
 * @param {Object} model 画面から来た表。信用しない — すべて cellSafe_ を通す
 * @return {{sheetName:string, url:string, rows:number, cols:number}}
 */
function exportModelToSheet_(model) {
  const started = Date.now();
  try {
    if (!model || !Array.isArray(model.rows)) {
      throw new Error('表の中身がありません');
    }
    const ss = SpreadsheetApp.getActive();
    const XF = CONFIG.EXPORT_FORMAT;
    const cols = Math.max(1, Number(model.cols) || 1);
    const dayCols = Math.max(1, Math.min(cols - 1, Number(model.dayCols) || 31));

    /* ── 1. 値・色・書式を、画面の格子から二次元配列に組む ── */
    const values = [];
    const backs = [];
    const weights = [];
    const families = [];
    const sizes = [];
    const heights = [];
    const merges = [];

    const at = () => values.length + 1;                    // これから積む行の番号
    const blank = () => new Array(cols).fill('');
    const pushRow = (vals, bgs, w, fam, sz, ht) => {
      values.push(vals);
      backs.push(bgs);
      weights.push(w);
      families.push(fam);
      sizes.push(sz);
      heights.push(ht);
    };
    const uniform = v => new Array(cols).fill(v);

    // 表題の行。A に表題、右に公休の内訳と店名（実物と同じ並び）
    const head = blank();
    head[0] = model.title || '';
    if (cols > 3) head[3] = model.quota || '';
    if (cols > 6) head[6] = model.store || '';
    const headFam = uniform(XF.FONT_BODY);
    const headSz = uniform(XF.PT_BODY);
    headSz[0] = XF.PT_TITLE;
    if (cols > 3) headSz[3] = XF.PT_NOTE;
    if (cols > 6) headSz[6] = XF.PT_NOTE;
    pushRow(head, uniform(null), uniform('bold'), headFam, headSz,
      exportRowPx_(XF.PT_TITLE + 20));
    merges.push({ r: at() - 1, c: 1, n: 3 });
    if (cols > 5) merges.push({ r: at() - 1, c: 4, n: 3 });
    if (cols > 9) merges.push({ r: at() - 1, c: 7, n: 4 });

    // 表そのもの
    model.rows.forEach(row => {
      const vals = blank();
      const bgs = uniform(null);
      const fam = uniform(row.kind === 'date' ? XF.FONT_DATE
        : row.kind === 'dow' ? XF.FONT_DOW : XF.FONT_BODY);
      const sz = uniform(XF.PT_BODY);
      // 集計の見出しだけ太字にしない（実物の計測どおり）
      const w = uniform(row.kind === 'agg' ? 'normal' : 'bold');
      const cells = row.cells || [];
      for (let i = 0; i < cols && i < cells.length; i++) {
        const c = cells[i];
        if (!c) continue;                                  // 結合の続き
        vals[i] = c.v === undefined || c.v === null ? '' : c.v;
        bgs[i] = c.bg || null;
        if (c.name) fam[i] = XF.FONT_BODY;             // 氏名列は本文の書体
        if (c.span > 1) merges.push({ r: at(), c: i + 1, n: Math.min(c.span, cols - i) });
      }
      pushRow(vals, bgs, w, fam, sz, exportRowPx_(XF.PT_ROW));
      // 区分の帯（薬剤師・派遣・事務・備考）は右端まで結合する
      if (row.kind === 'band') {
        merges.push({ r: at() - 1, c: 1, n: cols });
      }
    });

    // 凡例と注記。表の下に置く（実物と同じ位置）
    pushRow(blank(), uniform(null), uniform('normal'), uniform(XF.FONT_BODY),
      uniform(XF.PT_BODY), exportRowPx_(6));
    const textRow = (text, bg) => {
      const vals = blank();
      const bgs = uniform(null);
      if (bg) {
        bgs[0] = bg;                                       // A に色だけの見本セル
        vals[1] = text;
      } else {
        vals[0] = text;
      }
      pushRow(vals, bgs, uniform('normal'), uniform(XF.FONT_BODY),
        uniform(XF.PT_NOTE), exportRowPx_(XF.PT_ROW));
      merges.push({ r: at() - 1, c: bg ? 2 : 1, n: Math.min(cols - (bg ? 1 : 0), 12) });
    };
    (model.legend || []).forEach(t => textRow(t, null));
    // 色の凡例は、色だけのセルと説明。文字で「緑」と書いても照合できない
    (model.marks || []).forEach(k => textRow(k.label, k.color));
    (model.memo || []).forEach(t => textRow(t, null));

    /* ── 2. シートを挿して、まとめて書く ── */
    const base = buildExportFileName_(model.store, model.year, model.month);
    const sheet = ss.insertSheet(exportSheetName_(ss, base), ss.getNumSheets());
    const rows = values.length;
    const range = sheet.getRange(1, 1, rows, cols);

    // 画面から来た文字列は、そのままではシートで数式になる（"=" 始まり）。
    // **必ず cellSafe_ を通す。**（Sanitize.gs の役目）
    range.setValues(cellSafeGrid_(values));
    range.setBackgrounds(backs);
    range.setFontWeights(weights);
    range.setFontFamilies(families);
    range.setFontSizes(sizes);
    range.setHorizontalAlignment('center');   // 実物は氏名列も中央（§3）
    range.setVerticalAlignment('middle');
    range.setBorder(true, true, true, true, true, true,
      XF.RULE_COLOR, SpreadsheetApp.BorderStyle.SOLID);

    merges.forEach(m => {
      if (m.n > 1 && m.r >= 1 && m.r <= rows) {
        sheet.getRange(m.r, m.c, 1, m.n).merge();
      }
    });
    // 行の高さは、同じ値が続くところをまとめて渡す。
    // 1行ずつ呼ぶと 40 往復。ほとんどの行は同じ高さなので数回で済む
    for (let i = 0; i < heights.length;) {
      let j = i;
      while (j + 1 < heights.length && heights[j + 1] === heights[i]) j++;
      if (heights[i]) sheet.setRowHeights(i + 1, j - i + 1, heights[i]);
      i = j + 1;
    }

    sheet.setColumnWidth(1, exportColPx_(XF.W_NAME));
    sheet.setColumnWidths(2, dayCols, exportColPx_(XF.W_DAY));
    if (cols > dayCols + 1) {
      sheet.setColumnWidths(dayCols + 2, cols - dayCols - 1,
        exportColPx_(XF.W_AGG));
    }
    sheet.setHiddenGridlines(true);
    sheet.setFrozenRows(Math.min(3, rows));
    SpreadsheetApp.flush();

    const url = ss.getUrl() + '#gid=' + sheet.getSheetId();
    logSuccess(MODULE_EXPORT, 'exportModelToSheet_',
      `sheet=${sheet.getName()}; rows=${rows}; cols=${cols}; `
      + `merges=${merges.length}; elapsedMs=${Date.now() - started}`);
    return { sheetName: sheet.getName(), url: url, rows: rows, cols: cols };
  } catch (error) {
    logError(MODULE_EXPORT, 'exportModelToSheet_', error,
      `store=${model && model.store}; rows=${model && model.rows && model.rows.length}`);
    throw error;
  }
}
