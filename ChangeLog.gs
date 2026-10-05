/**
 * ChangeLog.gs — 変更ログ・セッション単位の巻き戻し・白紙化
 *
 * 移植元: ShiftAutoLog.bas（GetLogSheet / LogLastRow / NextSession / LogChange /
 *         シフト変更を戻す / シフト白紙化 / LogManualSession /
 *         シフト期替わり確認 / シフトログリセット）
 * 仕様書: §3.4 / §6.6 / §6.7
 *
 * ログの列（CHANGELOG_SHEET）:
 *   1=セッション 2=日時 3=操作 4=セル 5=変更前 6=変更後
 *   7=取消済 8=前文字色 9=前太字 10=前塗り色
 *
 * 【VBA 版との違い】
 *   VBA は Worksheet_SelectionChange で旧値を退避し Worksheet_Change で書いていた。
 *   GAS にこの経路は無い。サイドバー経由の変更は、書き込む直前に旧値を読んで
 *   ログに積む（サイドバーが唯一の入力経路なのでこれで漏れない）。
 *   セル直接編集はログに残らない。README に明記すること。
 */

const MODULE_CHANGELOG = 'ChangeLog';

/**
 * 変更ログシートを取得（無ければ Schema.gs に生成を委譲）。
 * GAS 版は最初から 10 列の見出しを書くので、VBA の「7〜10 列を後付け」は不要。
 * 移植元: GetLogSheet
 */
function getChangeLogSheet() {
  return notImplemented_(MODULE_CHANGELOG, 'getChangeLogSheet', 5); // TODO(P5)
}

/** ログの最終行。見出し行より小さくならない。移植元: LogLastRow */
function getChangeLogLastRow_(logSheet) {
  return notImplemented_(MODULE_CHANGELOG, 'getChangeLogLastRow_', 5); // TODO(P5)
}

/** 次のセッション番号。移植元: NextSession */
function getNextSessionNo_(logSheet) {
  return notImplemented_(MODULE_CHANGELOG, 'getNextSessionNo_', 5); // TODO(P5)
}

/**
 * 1セッション分の差分をまとめて記録する。
 * 【性能】1行ずつ書かず、配列に溜めて最後に setValues() で一括（§8.3-3）。
 * 移植元: LogChange / LogManualSession
 *
 * @param {Sheet} logSheet 変更ログシート
 * @param {number} sessionNo セッション番号
 * @param {string} op 操作の名前（'自動作成' / 'スタンプ' など）
 * @param {Array<{a1:string, before:string, after:string,
 *                fontColor:string, bold:boolean, background:string}>} entries
 */
function appendChangeLog(logSheet, sessionNo, op, entries) {
  return notImplemented_(MODULE_CHANGELOG, 'appendChangeLog', 5); // TODO(P5)
}

/**
 * メニュー「変更を戻す」。最後のセッションを逆再生して復元する。
 * 繰り返し実行で1回ずつ遡れる。取消済（7列目）に印を付ける。
 * 移植元: Public Sub シフト変更を戻す()
 */
function undoLastSession() {
  return notImplemented_(MODULE_CHANGELOG, 'undoLastSession', 5); // TODO(P5)
}

/**
 * メニュー「シフト白紙化」。入力欄を消す（数式セルには触らない）。
 * 消す前の状態を1セッションとしてログに残し、戻せるようにする。
 * 移植元: Public Sub シフト白紙化()
 */
function clearShiftGrid() {
  return notImplemented_(MODULE_CHANGELOG, 'clearShiftGrid', 5); // TODO(P5)
}

/**
 * メニュー「変更ログをリセット」。
 * 移植元: Public Sub シフトログリセット()
 * @param {boolean=} ask 確認ダイアログを出すか（既定 true）
 */
function resetChangeLog(ask) {
  return notImplemented_(MODULE_CHANGELOG, 'resetChangeLog', 5); // TODO(P5)
}

/**
 * 期替わり判定 — 対象月が変わったら変更ログをリセットするか問う。
 *
 * VBA 版の3つの約束をそのまま守る（§6.7）:
 *   1. 初回は記憶するだけで問わない
 *   2. 比較は年月の粒度で行う
 *   3. 問う前に記憶を更新する
 * 記憶先は PropertiesService.getDocumentProperties()（CONFIG.PROP_LAST_MONTH）。
 * 移植元: Public Sub シフト期替わり確認()
 */
function checkMonthRollover() {
  return notImplemented_(MODULE_CHANGELOG, 'checkMonthRollover', 5); // TODO(P5)
}
