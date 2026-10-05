/**
 * Setup.gs — 初期設定（数式・名前付き範囲）
 *
 * 移植元: ShiftSetup.bas（パレット生成の約 250 行は不要になった）
 * 仕様書: §5（数式の移植）/ §5.5（名前付き範囲）
 *
 * 【移植しないもの】
 *   ShiftSetup_パレット生成 / SS_パレット* / SS_PalVals / SS_PalLabs /
 *   SS_PaletteFormula … すべてサイドバー化（§6）で不要。
 *
 * 【見出しの上書き規則】
 *   集計行・集計列の見出しは「空欄」or「過去にマクロが書いた見出し」の
 *   ときだけ上書きする。既知の見出し一覧を持ち、それ以外は手書きとみなして触らない。
 */

const MODULE_SETUP = 'Setup';

/** マクロが書いた既知の集計見出し。これ以外は手書きとみなす。移植元: SS_AggHeadsKnown */
const SETUP_KNOWN_HEADS = Object.freeze([
  '休', 'ノルマ休', '公休', '有休', '○早番', '▲遅番', '●遅半', '5診出勤',
]);

/**
 * メニュー「数式・名前付き範囲を作り直す」。
 * ヘッダ数式 → 集計行数式 → 集計列数式 → 区分の作業列 → 名前付き範囲 の順で実行。
 * 移植元: ShiftSetup_初期設定実行
 */
function runInitialSetup() {
  return notImplemented_(MODULE_SETUP, 'runInitialSetup', 2); // TODO(P2)
}

/**
 * ヘッダ数式 — 年月・日付行・曜日行・祝日サマリー。
 *
 *   日付行   =DATE(1900,AG4,1) と +1 の連なり（そのまま通る）
 *   曜日行   =TEXT(B5,"aaa")（そのまま通る）
 *   祝日サマリー I4 は LET(...) のまま通る。wk+hol は targetOff と必ず一致する
 *
 * 【和暦は落ちる（§5.2）】
 *   VBA: NumberFormatLocal = "[$-ja-JP]ge""."" m""月"""
 *   GAS: setNumberFormat('yyyy"年"m"月"') … 西暦
 *   和暦が必要なら別セルに文字列を組むが、元号の切り替わりに追従できないことを
 *   利用者に明示すること。
 * 移植元: ShiftSetup_ヘッダ数式
 */
function setupHeaderFormulas() {
  return notImplemented_(MODULE_SETUP, 'setupHeaderFormulas', 2); // TODO(P2)
}

/**
 * 集計行数式 — 医師数(診) / 薬剤師出勤数 / 過不足 の3行（B〜AF 各列）。
 * A 列の見出しは空欄のときだけ補う。
 * 移植元: ShiftSetup_集計行数式
 */
function setupAggregateRowFormulas() {
  return notImplemented_(MODULE_SETUP, 'setupAggregateRowFormulas', 2); // TODO(P2)
}

/**
 * ★ Sheets 非互換への対策（§5.3）— 区分の作業列（AN 列）を作る。
 *
 * VBA 版の薬剤師出勤数は SUMPRODUCT の中で MATCH に配列を渡していたが、
 * Google Sheets では MATCH の第1引数に配列を渡しても配列は返らない
 * （先頭要素の1件だけを見る）。エラーにならず黙って誤った人数を返す。
 *
 * 対策は行ごとに1件ずつ引く作業列を置くこと。
 *   AN14 : =IFERROR(INDEX(自動作成設定!$B:$B, MATCH($A14, 自動作成設定!$A:$A, 0)), "")
 * 列は非表示にし、入力欄の行数に合わせて生成する。Layout の解決対象にも加える。
 */
function setupKindHelperColumn() {
  return notImplemented_(MODULE_SETUP, 'setupKindHelperColumn', 2); // TODO(P2)
}

/**
 * 薬剤師出勤数の数式を組む（作業列方式）。
 *   =SUMPRODUCT(($AN$14:$AN$27="薬剤師")*((B14:B27="○")+(B14:B27="◯")+(B14:B27="▲")+(B14:B27="●")))
 * 移植元: SS_PharmFormula（MATCH 配列渡しをやめた版）
 */
function buildPharmCountFormula_(colLetter, gridTop, gridBottom) {
  const kindCol = toColumnLetter(LAYOUT.COL_KIND_WORK);
  const kindRange = `$${kindCol}$${gridTop}:$${kindCol}$${gridBottom}`;
  const dayRange = `${colLetter}${gridTop}:${colLetter}${gridBottom}`;
  return '=' + WORK_SYMS.map(function (sym) {
    return `COUNTIFS(${kindRange},"${KIND.PHARM}",${dayRange},"${workSymCriteria_(sym)}")`;
  }).join('+');
}

/**
 * 出勤記号を COUNTIF / COUNTIFS の条件式にする。
 * WORK_SYM_PREFIX_MATCH が true なら末尾に `*` を付け、
 * 「▲医A」のような記号＋氏名の複合テキストも数える。
 * Engine.matchWorkSym と同じ規則にすること。
 */
function workSymCriteria_(sym) {
  return WORK_SYM_PREFIX_MATCH ? `${sym}*` : sym;
}

/**
 * 集計列数式 — AH 公休 / AI 有休 / AJ ○早番 / AK ▲遅番 / AL ●遅半 / AM 5診出勤。
 *
 *   - 休み記号の全体（SYM.OFF_ALL）を設定 L11「ノルマ外の休み記号」の
 *     部分一致で AH（ノルマ対象）と AI（ノルマ外）に振り分ける。
 *     判定は Engine.isPaidOff と必ず同じ規則にすること。
 *     既定 '有休,夏休' なら AH=公休,希休 / AI=夏休,有休,有休※。
 *   - 数える記号が0個になる場合は '=0' を書く（'=' だけでは壊れる）
 *   - A 列に氏名が無い行は集計列を空にする
 * 移植元: ShiftSetup_集計列数式
 */
function setupAggregateColumnFormulas() {
  return notImplemented_(MODULE_SETUP, 'setupAggregateColumnFormulas', 2); // TODO(P2)
}

/**
 * COUNTIF の和を組む。数える記号が0個なら '=0'（'=' だけでは壊れる）。
 * 移植元: SS_CountFormula
 */
function buildCountifSumFormula_(row, symbols, asWorkSyms) {
  if (!symbols || symbols.length === 0) return '=0';
  const first = toColumnLetter(LAYOUT.COL_FIRST);
  const last = toColumnLetter(LAYOUT.COL_LAST);
  const range = `${first}${row}:${last}${row}`;
  return '=' + symbols
    .map(function (s) {
      // 休み記号は完全一致のまま。緩めると「公休」が「公休(半)」なども拾い、
      // 公休ノルマの数え方が Engine.isPaidOff とずれる
      return `COUNTIF(${range},"${asWorkSyms ? workSymCriteria_(s) : s}")`;
    })
    .join('+');
}

/**
 * 5診出勤（混雑日の出勤回数）。移植元: SS_BusyDayFormula
 *
 * 仕様書 §5.4 は SUMPRODUCT だが、COUNTIFS にした。理由は2つ。
 *   1. 先頭一致（WORK_SYM_PREFIX_MATCH）を条件式で書ける。
 *      SUMPRODUCT の中で LEFT を配列に効かせる書き方は Sheets では挙動が読みにくい
 *   2. 医師数行と入力行はどちらも 1 行 × 31 列なので COUNTIFS の形が揃う
 */
function buildBusyDayFormula_(row, docRow) {
  const first = toColumnLetter(LAYOUT.COL_FIRST);
  const last = toColumnLetter(LAYOUT.COL_LAST);
  const docRange = `$${first}$${docRow}:$${last}$${docRow}`;
  const dayRange = `${first}${row}:${last}${row}`;
  return '=' + WORK_SYMS.map(function (sym) {
    return `COUNTIFS(${docRange},${DOC_BUSY_N},${dayRange},"${workSymCriteria_(sym)}")`;
  }).join('+');
}

/**
 * 休み記号をノルマ対象/外に振り分ける。Engine.isPaidOff と同じ規則を使う
 * （設定 L11 に「有休」とだけ書けば「有休※」も外れる、という約束を守るため）。
 * 移植元: SS_OffSymsByQuota
 * @param {string} paidSyms 設定 L11 の値（カンマ区切り）
 * @param {boolean} wantQuota true ならノルマ対象（AH）/ false ならノルマ外（AI）
 * @return {string[]}
 */
function splitOffSymbolsByQuota_(paidSyms, wantQuota) {
  return SYM.OFF_ALL.filter(function (sym) {
    return isPaidOff(sym, paidSyms) !== wantQuota;
  });
}

/**
 * マクロが書いた見出しか（上書きしてよいか）。空欄も上書き可とみなす。
 * これ以外は手書きとみなして触らない。移植元: SS_HeadIsOurs
 */
function isOurHeading_(value) {
  const v = String(value || '').trim();
  return v === '' || SETUP_KNOWN_HEADS.indexOf(v) >= 0;
}

/** 見出しを空欄のときだけ補う。移植元: SS_FillHeading */
function fillHeadingIfBlank_(sheet, row, text) {
  return notImplemented_(MODULE_SETUP, 'fillHeadingIfBlank_', 2); // TODO(P2)
}

/**
 * 名前付き範囲を貼り直す（§5.5）。
 *
 * 【VBA 版との違い】
 *   VBA は OFFSET / INDEX を使った相対参照の名前定義にしていたが、
 *   Sheets の名前付き範囲は数式を持てず範囲アドレスしか持てない。
 *   setNamedRange(name, range) で毎回貼り直す形になり、
 *   「行を増減すると名前が古くなる」問題は VBA 版より起きやすい。
 *   → Layout の計算解決を正とし、名前付き範囲は利用者向けの目印と位置づける。
 *     ずれは SettingsCheck が警告する。
 *
 * 廃止した名前（NAMED_RANGE.OBSOLETE）はここで削除する。
 * 移植元: ShiftSetup_名前付き範囲更新 / SS_DeleteObsoleteNames
 */
function refreshNamedRanges() {
  return notImplemented_(MODULE_SETUP, 'refreshNamedRanges', 2); // TODO(P2)
}
