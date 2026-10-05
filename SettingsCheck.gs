/**
 * SettingsCheck.gs — 設定チェック（事前診断）
 *
 * 移植元: ShiftAutoLog.bas の シフト設定チェック  仕様書: §1
 *
 * 出力先はモーダルダイアログ（Menu.showReportDialog）。
 * 自動作成を実行する前に、シートと設定の食い違いをまとめて見せる。
 */

const MODULE_SETTINGSCHECK = 'SettingsCheck';

/**
 * メニュー「設定チェック」の入口。
 *
 * 見るもの:
 *   - 必要なシートが揃っているか（シフト / 自動作成設定 / 祝日マスタ / シフト変更ログ）
 *   - Layout の解決結果（日付行・入力欄・備考行・集計行）が妥当か
 *   - 名前付き範囲と計算解決のずれ（Layout.getShiftRangeDrift）
 *     ※ Sheets の名前付き範囲は数式を持てず範囲アドレス固定なので、
 *       行を増減すると VBA 版より古くなりやすい（§5.5）
 *   - 区分が 薬剤師/事務員 以外のメンバー
 *   - 勤務ルールが正規値以外のメンバー
 *   - 月間休日数が RULE.NORMAL 以外の行に入っている（読まれない設定）
 *   - 同名重複
 *   - マスタにあるがシフト表に無い氏名 / シフト表にあるがマスタに無い氏名
 *   - 祝日マスタが対象月をカバーしているか
 *   - 全体設定の欠落行（既定値で動くが、どの値が使われるかを見せる）
 * 移植元: Public Sub シフト設定チェック()
 */
function runSettingsCheck() {
  return notImplemented_(MODULE_SETTINGSCHECK, 'runSettingsCheck', 4); // TODO(P4)
}

/**
 * 設定シートの現物と、あるべきスキーマ（Config の CFG_*）の差分を文字列で返す。
 * 移植元: ShiftSchema_設定差分
 * @return {string} 差分なしなら空文字
 */
function diffConfigSheet() {
  return notImplemented_(MODULE_SETTINGSCHECK, 'diffConfigSheet', 4); // TODO(P4)
}
