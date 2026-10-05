/**
 * Log.gs — エラー/成功ログ
 *
 * 移植元: ErrorLogger（VBA）  仕様書: §7.1
 *
 * VBA 版は C:\VBAErrorLogs\ErrorLog_YYYYMMDD.csv に CSV を吐いていた。
 * GAS 版は console + 実行ログシート + 致命的なものだけメール通知の3段構え。
 *
 * 【規約】
 *   - Logger.log() は使わない（Tier 2 の禁止事項）
 *   - 全関数の正常終了時に logSuccess() を呼ぶ。VBA 版から続く
 *     「テストの合否をログで判定する」運用を維持するため
 *   - 自動作成の実行時間は logSuccess の details に elapsedMs を必ず載せる（§8.3-5）
 *
 * 【logError は絶対に投げない】
 *   catch 節から呼ばれる関数なので、ここで例外を出すと本来のエラーが握り潰される。
 *   シートへの追記もメール送信も、失敗したら console に落として黙って続ける。
 */

const MODULE_LOG = 'Log';

/**
 * 実装が終わっていない関数の目印。
 * 骨組みの段階でシートを壊さないよう、黙って何もせず終わらせずに必ず投げる。
 * @param {string} moduleName モジュール名
 * @param {string} funcName 関数名
 * @param {number} phase 実装フェーズ（仕様書 §9）
 */
function notImplemented_(moduleName, funcName, phase) {
  throw new Error(`未実装: ${moduleName}.${funcName}（実装フェーズ ${phase} / docs/GAS-PORTING-SPEC.md §9）`);
}

/**
 * エラーを記録する。console.error → 実行ログシート → 致命的ならメール。
 * @param {string} moduleName モジュール名
 * @param {string} funcName 関数名
 * @param {Error|string} error 捕捉した例外
 * @param {string=} context 呼び出し時の状況（引数の値など）
 * @param {boolean=} notify 管理者へメール通知するか
 */
function logError(moduleName, funcName, error, context, notify) {
  const message = (error && error.message) ? error.message : String(error);
  const stack = (error && error.stack) ? error.stack : '(no stack)';
  const ctx = context || '';

  console.error(`[${moduleName}.${funcName}] ${message}\ncontext: ${ctx}\nstack: ${stack}`);

  try {
    appendRunLogRow_('ERROR', moduleName, funcName, message, ctx);
  } catch (e) {
    console.error(`[${MODULE_LOG}.logError] 実行ログへの追記に失敗: ${e.message}`);
  }

  if (notify) {
    try {
      MailApp.sendEmail(
        getAdminEmail_(),
        `GAS Error: ${moduleName}.${funcName}`,
        `Error: ${message}\nContext: ${ctx}\nTime: ${new Date().toISOString()}\n\n${stack}`
      );
    } catch (e) {
      console.error(`[${MODULE_LOG}.logError] メール通知に失敗: ${e.message}`);
    }
  }
}

/**
 * 正常終了を記録する。
 * @param {string} moduleName モジュール名
 * @param {string} funcName 関数名
 * @param {string} details 処理件数・所要時間など
 */
function logSuccess(moduleName, funcName, details) {
  const text = details || '';
  console.log(`[${moduleName}.${funcName}] ${text}`);
  try {
    appendRunLogRow_('OK', moduleName, funcName, text, '');
  } catch (e) {
    console.error(`[${MODULE_LOG}.logSuccess] 実行ログへの追記に失敗: ${e.message}`);
  }
}

/**
 * 実行ログシートへ1行追記する。上限行数を超えたら古い行から削る。
 * @param {string} level 'OK' | 'ERROR'
 * @param {string} moduleName モジュール名
 * @param {string} funcName 関数名
 * @param {string} message 本文
 * @param {string} context 補足
 */
function appendRunLogRow_(level, moduleName, funcName, message, context) {
  const sheet = getRunLogSheet_();
  if (!sheet) return;
  sheet.appendRow([new Date(), level, moduleName, funcName, message, context]);
  trimRunLog_(sheet);
}

/**
 * 実行ログシートを取得（無ければ作る）。
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getRunLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CONFIG.SHEET_RUNLOG);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.SHEET_RUNLOG);
  const heads = ['日時', '種別', 'モジュール', '関数', '内容', '補足'];
  sheet.getRange(1, 1, 1, heads.length)
    .setValues([heads])
    .setFontWeight('bold')
    .setBackground('#d9d9d9');
  sheet.setFrozenRows(1);
  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(5, 420);
  return sheet;
}

/**
 * 保持行数（CONFIG.RUNLOG_MAX_ROWS）を超えた古い行を削る。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 実行ログシート
 */
function trimRunLog_(sheet) {
  const dataRows = sheet.getLastRow() - 1;   // 見出し行を除く
  const excess = dataRows - CONFIG.RUNLOG_MAX_ROWS;
  if (excess > 0) sheet.deleteRows(2, excess);
}

/**
 * 管理者の通知先。スクリプトプロパティ優先、無ければ実行ユーザー。
 * コードにメールアドレスを書かないための入口（Tier 1）。
 * @return {string}
 */
function getAdminEmail_() {
  const prop = PropertiesService.getScriptProperties().getProperty(CONFIG.PROP_ADMIN_EMAIL);
  if (prop) return prop.trim();
  return Session.getEffectiveUser().getEmail();
}
