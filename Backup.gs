/**
 * Backup.gs — シートの控えを取り、戻せるようにする
 *
 * VBA 版には無い機能。VBA 版は「変更ログにセル単位の差分を積み、
 * セッション単位で逆再生する」形だった（仕様書 §3.4 / ChangeLog.gs）。
 *
 * 【なぜ先に控えを作るか】
 *   セル単位の巻き戻しは正確だが実装が重い。いま怖いのは
 *   「自動作成を回したら希望休が消えた」という取り返しのつかない事故で、
 *   それはシートまるごとの控えがあれば防げる。
 *   安全網としての費用対効果が段違いに高いので、こちらを先に置く。
 *
 * 【いつ取るか】
 *   壊しうる操作の**直前**に自動で取る。利用者が覚えておく必要をなくす。
 *     ・シフト自動作成
 *     ・シフト白紙化
 *     ・Web アプリからの一括保存
 *
 * 【何を戻すか】
 *   控えはシートまるごと。**戻すのは入力欄の値だけ**にしてある。
 *   シート全体を差し替えると、あとから直した書式や集計行まで巻き戻り、
 *   「なぜ戻したい以外のものまで変わったのか」が分からなくなる。
 */

const MODULE_BACKUP = 'Backup';

/**
 * 壊しうる操作の直前に控えを取る。
 *
 * 失敗しても**本来の操作は止めない**。控えが取れないことより、
 * 操作そのものができないことのほうが困るため。ただしログには残す。
 *
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet 控えを取るシート
 * @param {string} reason 何の直前か（'自動作成' など）
 * @return {string} 作った控えのシート名。取れなければ空文字
 */
function snapshotBeforeChange(sheet, reason) {
  try {
    return createBackup_(sheet, reason);
  } catch (error) {
    logError(MODULE_BACKUP, 'snapshotBeforeChange', error,
      `sheet=${sheet && sheet.getName()}; reason=${reason}`);
    return '';
  }
}

/**
 * 控えを1つ作る。
 * @return {string} 控えのシート名
 */
function createBackup_(sheet, reason) {
  const ss = SpreadsheetApp.getActive();
  const stamp = Utilities.formatDate(new Date(), CONFIG.TIMEZONE_HINT, 'yyyyMMdd-HHmmss');
  const name = `${BACKUP.PREFIX}${sheet.getName()}${BACKUP.SEP}${stamp}`;

  const copy = sheet.copyTo(ss);
  copy.setName(sanitizeSheetName_(name));
  copy.hideSheet();

  // 何の直前に取ったかを控え自身へ書いておく。あとで見分けるため
  copy.getRange(1, LAYOUT.COL_KIND_WORK + 1)
    .setValue(`${BACKUP.NOTE_HEAD}${reason || ''}`);

  pruneBackups_(sheet.getName());
  logSuccess(MODULE_BACKUP, 'createBackup_',
    `source=${sheet.getName()}; backup=${copy.getName()}; reason=${reason}`);
  return copy.getName();
}

/**
 * シート名に使えない文字を落とし、長さも詰める。
 * Google スプレッドシートのシート名は 100 文字までで、
 * `[ ] * ? / \ :` が使えない。控えの名前は日付を含むので長くなりがち。
 */
function sanitizeSheetName_(name) {
  const cleaned = String(name).replace(/[\[\]\*\?\/\\:]/g, '_');
  return cleaned.length <= 100 ? cleaned : cleaned.slice(0, 100);
}

/**
 * 控えの一覧。新しい順。
 * @param {string=} sourceName 元のシート名で絞る。省略すると全部
 * @return {Array<{name:string, source:string, takenAt:string, reason:string}>}
 */
function listBackups(sourceName) {
  try {
    return SpreadsheetApp.getActive().getSheets()
      .map(function (sh) { return parseBackupName_(sh.getName()); })
      .filter(function (b) {
        if (!b) return false;
        return !sourceName || b.source === sourceName;
      })
      .sort(function (a, b) { return a.takenAt < b.takenAt ? 1 : -1; });
  } catch (error) {
    logError(MODULE_BACKUP, 'listBackups', error, `sourceName=${sourceName}`);
    return [];
  }
}

/**
 * 控えのシート名を分解する。控えでなければ null。
 * SpreadsheetApp を呼ばない純粋関数。
 */
function parseBackupName_(name) {
  const s = String(name || '');
  if (s.indexOf(BACKUP.PREFIX) !== 0) return null;

  const rest = s.slice(BACKUP.PREFIX.length);
  const cut = rest.lastIndexOf(BACKUP.SEP);
  if (cut < 0) return null;

  const source = rest.slice(0, cut);
  const stamp = rest.slice(cut + BACKUP.SEP.length);
  if (!/^\d{8}-\d{6}$/.test(stamp)) return null;

  return {
    name: s,
    source: source,
    takenAt: stamp,
    label: `${stamp.slice(4, 6)}/${stamp.slice(6, 8)} `
      + `${stamp.slice(9, 11)}:${stamp.slice(11, 13)}`,
  };
}

/**
 * 古い控えを消す。元のシートごとに BACKUP.KEEP 件まで残す。
 *
 * 控えが際限なく増えるとシート一覧が埋まり、ブックも重くなる。
 * ただし**消すのは自分が作った控えだけ**。名前の形で判別する。
 */
function pruneBackups_(sourceName) {
  const ss = SpreadsheetApp.getActive();
  const olds = listBackups(sourceName).slice(BACKUP.KEEP);
  olds.forEach(function (b) {
    const sh = ss.getSheetByName(b.name);
    if (sh) ss.deleteSheet(sh);
  });
  if (olds.length > 0) {
    logSuccess(MODULE_BACKUP, 'pruneBackups_',
      `source=${sourceName}; deleted=${olds.length}`);
  }
}

/**
 * 控えから入力欄の値を戻す。
 *
 * **戻すのは入力欄の値だけ。**シート全体を差し替えると、
 * あとから直した書式や集計行まで巻き戻り、何が変わったのか分からなくなる。
 *
 * 戻す前に**現状の控えをもう1つ取る**。戻す操作自体も取り消せるようにするため。
 *
 * @param {string} backupName 控えのシート名
 * @return {{restored:number, safety:string}}
 */
function restoreBackup(backupName) {
  try {
    const info = parseBackupName_(backupName);
    if (!info) throw new Error(`「${backupName}」は控えのシートではありません。`);

    const backup = getSheetOrNull(backupName);
    if (!backup) throw new Error(`控え「${backupName}」が見つかりません。`);
    const target = getSheetOrNull(info.source);
    if (!target) throw new Error(`戻し先のシート「${info.source}」が見つかりません。`);

    // 戻す操作自体を取り消せるように、先に現状を控える
    const safety = snapshotBeforeChange(target, '復元の直前');

    const layout = resolveLayout(target);
    const nP = layout.gridBottom - layout.gridTop + 1;
    const nD = layout.lastCol - layout.firstCol + 1;

    const values = backup.getRange(layout.gridTop, layout.firstCol, nP, nD).getValues();
    target.getRange(layout.gridTop, layout.firstCol, nP, nD).setValues(values);
    SpreadsheetApp.flush();

    logSuccess(MODULE_BACKUP, 'restoreBackup',
      `from=${backupName}; to=${info.source}; cells=${nP * nD}; safety=${safety}`);
    return { restored: nP * nD, safety: safety };
  } catch (error) {
    logError(MODULE_BACKUP, 'restoreBackup', error, `backupName=${backupName}`, true);
    throw error;
  }
}

/* ================================================================
 *  メニューから使うもの
 * ================================================================ */

/** メニュー「いまの状態を控える」。 */
function createBackupNow() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const name = createBackup_(sheet, '手動');
    SpreadsheetApp.getUi().alert(
      `「${sheet.getName()}」の控えを取りました。\n\n${name}\n\n`
      + `控えは非表示のシートとして残ります（${BACKUP.KEEP} 件まで）。`);
    return name;
  } catch (error) {
    logError(MODULE_BACKUP, 'createBackupNow', error, '');
    SpreadsheetApp.getUi().alert(`控えを取れませんでした。\n\n${error.message}`);
    throw error;
  }
}

/** メニュー「控えから戻す」。一覧を出して選ばせる。 */
function showRestoreDialog() {
  try {
    const sheet = SpreadsheetApp.getActiveSheet();
    const list = listBackups(sheet.getName());
    if (list.length === 0) {
      SpreadsheetApp.getUi().alert(
        `「${sheet.getName()}」の控えはまだありません。\n\n`
        + '自動作成や白紙化の直前には自動で控えが取られます。');
      return;
    }

    const template = HtmlService.createTemplateFromFile('RestoreView');
    template.sourceJson = JSON.stringify(sheet.getName());
    template.listJson = JSON.stringify(list);
    SpreadsheetApp.getUi().showModalDialog(
      template.evaluate().setWidth(520).setHeight(420), '控えから戻す');
  } catch (error) {
    logError(MODULE_BACKUP, 'showRestoreDialog', error, '');
    throw error;
  }
}

/** 画面から呼ぶ復元。 */
function apiRestoreBackup(backupName) {
  return restoreBackup(backupName);
}

/** 画面から呼ぶ控えの一覧。 */
function apiListBackups(sourceName) {
  return listBackups(sourceName);
}
