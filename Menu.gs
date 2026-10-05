/**
 * Menu.gs — onOpen とメニュー
 *
 * 移植元: パレットの動作ボタン（ShiftClick の IDX_AUTO / IDX_UNDO / IDX_EXPORT）と
 *         VBA のマクロ一覧  仕様書: §6
 *
 * メニューの表示名だけは日本語。関数名は camelCase の英語にする（Tier 2）。
 */

const MODULE_MENU = 'Menu';

/** スプレッドシートを開いたときに走る簡易トリガ。 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('シフト')
      .addItem('Web アプリを開く', 'openWebApp')
      .addSeparator()
      .addItem('シフト自動作成', 'runAutoShift')
      .addItem('設定チェック', 'runSettingsCheck')
      .addItem('事前診断', 'runPreflightDiagnosis')
      .addSeparator()
      .addItem('いまの状態を控える', 'createBackupNow')
      .addItem('控えから戻す', 'showRestoreDialog')
      .addSeparator()
      .addItem('変更を戻す', 'undoLastSession')
      .addItem('シフト白紙化', 'clearShiftGrid')
      .addItem('変更ログをリセット', 'resetChangeLog')
      .addSeparator()
      .addSubMenu(SpreadsheetApp.getUi().createMenu('初期設定')
        .addItem('シフト表シートを生成', 'createMonthlyShiftSheet')
        .addItem('実物の書式を取り込む', 'captureFormatProfile')
        .addItem('書式プロファイルを読み込む（Excel から）', 'showProfileImportDialog')
        .addItem('書式プロファイルを反映', 'applyProfileSheet')
        .addItem('不足シートを生成', 'buildMissingSheets')
        .addItem('数式・名前付き範囲を作り直す', 'runInitialSetup')
        .addItem('祝日マスタを取り込む', 'importHolidays'))
      .addSeparator()
      .addItem('PDF 出力', 'exportShiftPdf')
      .addItem('レイアウト診断', 'diagnoseSheetLayout')
      .addItem('シート構造を表示', 'runSheetSurvey')
      .addToUi();
  } catch (error) {
    console.error(`[${MODULE_MENU}.onOpen] ${error.message}\nstack: ${error.stack}`);
  }
}

/**
 * デプロイ済み Web アプリを新しいタブで開く。
 * ダイアログから window.open するのは、GAS のメニューから直接タブを開けないため。
 */
function openWebApp() {
  try {
    const url = getWebAppUrl();
    if (!url) {
      SpreadsheetApp.getUi().alert([
        'Web アプリがまだデプロイされていません。',
        '',
        'Apps Script エディタの「デプロイ」→「新しいデプロイ」→',
        '種類に「ウェブアプリ」を選んでデプロイしてください。',
      ].join('\n'));
      return;
    }
    const html = HtmlService
      .createHtmlOutput(`<script>window.open(${JSON.stringify(url)},'_blank');`
        + 'google.script.host.close();</script>')
      .setHeight(10).setWidth(10);
    SpreadsheetApp.getUi().showModalDialog(html, 'Web アプリを開いています');
  } catch (error) {
    logError(MODULE_MENU, 'openWebApp', error, '');
  }
}

/**
 * 長文レポートを表示する。
 * getUi().alert() は長文に向かないので HtmlService のモーダルを使う（§4.5）。
 * @param {string} title 見出し
 * @param {string} body 本文（プレーンテキスト）
 */
function showReportDialog(title, body) {
  try {
    const escaped = String(body == null ? '' : body)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const html = HtmlService
      .createHtmlOutput(
        '<style>body{font:12px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace;'
        + 'margin:0;padding:10px;white-space:pre-wrap;word-break:break-all}</style>'
        + `<div>${escaped}</div>`)
      .setWidth(760)
      .setHeight(560);
    SpreadsheetApp.getUi().showModalDialog(html, title);
  } catch (error) {
    logError(MODULE_MENU, 'showReportDialog', error, `title=${title}`);
    // レポートが出せないだけで処理を止めない。中身はログに残す
    console.log(`[${MODULE_MENU}.showReportDialog] ${title}\n${body}`);
  }
}
