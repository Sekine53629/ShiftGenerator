/**
 * Store.gs — 複数の PC から編集するための保存層
 *
 * VBA 版にも仕様書にも無い。`docs/DEPLOY-PLAN.md` 構成B の「保存先だけ Sheets に」を、
 * 実際に組むときの置き場として起こしたもの。
 *
 * 【なぜ隠しシートに JSON なのか】
 *   Apps Script に本物のデータベースは無い。永続する置き場は限られる。
 *
 *     PropertiesService  1値 9KB・全体 500KB   設定値どまり。マスタには小さい
 *     CacheService       最大6時間で消える     保存には使えない
 *     Drive のファイル    実質無制限           **`.../auth/drive` が要る**
 *     このスプレッドシート  1セル 5万文字        追加の権限が要らない
 *
 *   Drive に置くほうが素直だが、`DriveApp` は Drive **全体**への権限を求める。
 *   このプロジェクトの `appsscript.json` は `spreadsheets.currentonly` まで
 *   絞ってあり、シフト表のために利用者の Drive 全部を開けさせるのは割に合わない。
 *   いま開いているスプレッドシートの中なら、既にある権限で足りる。
 *
 *   マスタは入れ子の構造（社員が使える記号の配列、店舗ごとの営業時間…）なので、
 *   セルの表に展開すると項目を足すたびに列対応を書き直すことになる。
 *   **JSON のまま1行に置く。** 画面が持つ形をそのまま保存できる。
 *
 *   1セルは5万文字までなので、超える分は右の列へ分けて入れる。
 *   人が読む表は Export.gs が別のシートに出す。こちらは触らせない。
 *
 * 【同時編集】
 *   行ごとに版番号（rev）を持つ。保存するときは「読んだときの rev」を送り、
 *   サーバ側で今の rev と突き合わせる。**違っていたら書かない。**
 *   誰かの編集を黙って消すより、画面に出して読み直してもらう。
 *
 *   最後に書いた人と時刻も返す。「誰の編集と衝突したのか」が分からないと、
 *   読み直す前に声を掛けることができない。
 *
 * 【書き込みの直列化】
 *   読んで・比べて・書く、の間に他の実行が割り込むと版番号の意味が無くなる。
 *   LockService で囲う。待つのは最大 20 秒。
 */

const MODULE_STORE = 'Store';

/** マスタを入れる行の名前 */
const STORE_DB_FILE = 'masters.json';

/** 書き込みの順番待ちの上限（ミリ秒） */
const STORE_LOCK_WAIT_MS = 20000;

/**
 * 1セルに入れる文字数。Sheets の上限は 50,000 なので余裕を見る。
 * これを超えた分は右の列へ続ける。
 */
const STORE_CHUNK = 40000;

/** JSON が始まる列（A:名前 B:版 C:時刻 D:書いた人 E以降:中身） */
const STORE_COL_JSON = 5;

/** 1件の上限。事故で肥大したものを弾く */
const STORE_MAX_CHUNKS = 20;

/**
 * 保存データのシート。無ければ作って隠す。
 *
 * **人が触るシートではない。**隠しておかないと、行を消されたり
 * 並べ替えられたりして、保存が丸ごと壊れる。
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function storeSheet_() {
  try {
    const ss = SpreadsheetApp.getActive();
    let sheet = ss.getSheetByName(CONFIG.SHEET_DATA);
    if (!sheet) {
      sheet = ss.insertSheet(CONFIG.SHEET_DATA);
      sheet.getRange(1, 1, 1, 5)
        .setValues([['名前', '版', '更新時刻', '更新者',
                     '⚠ アプリが使う保存データです。手で書き換えないでください']])
        .setFontWeight('bold');
      sheet.setFrozenRows(1);
      sheet.hideSheet();
      /**
       * 手で書き換えようとしたら警告を出す。
       *
       * **これは事故を防ぐだけで、隠すことにはならない。**
       * 非表示のシートは「表示 → 非表示のシート」で誰でも開ける。
       * スプレッドシートを開ける人からは中身が読める。
       * 読ませたくない相手には、そもそもスプレッドシートを共有しないこと
       * （ウェブアプリを「自分として実行」でデプロイすれば、
       * 利用者にスプレッドシートの権限は要らない）。
       *
       * 警告どまりにするのは、スクリプトからの書き込みを止めないため。
       * 完全な保護にすると、実行ユーザー本人が書けなくなる。
       */
      try {
        sheet.protect()
          .setDescription('アプリの保存データ')
          .setWarningOnly(true);
      } catch (ignored) {
        // 保護を付けられない環境でも保存自体は動かす
        console.error(`[${MODULE_STORE}.storeSheet_] 保護を付けられませんでした`);
      }
    }
    return sheet;
  } catch (error) {
    logError(MODULE_STORE, 'storeSheet_', error, '');
    throw error;
  }
}

/**
 * 月ごとのシフトを入れる行の名前。
 * 店舗と年月で1行。**分けることが同時編集の単位になる。**
 * 1行にまとめると、別の店・別の月を触っただけで衝突する。
 */
function storeCellsFile_(storeId, ym) {
  const s = String(storeId || '').trim();
  const m = String(ym || '').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(s)) {
    throw new Error('[storeCellsFile_] 店舗 ID が不正です: ' + storeId);
  }
  if (!/^\d{4}-\d{2}$/.test(m)) {
    throw new Error('[storeCellsFile_] 年月が不正です: ' + ym);
  }
  return 'cells-' + s + '-' + m;
}

/** 名前が入っている行番号。無ければ 0 */
function storeRowOf_(sheet, name) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const names = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < names.length; i++) {
    if (String(names[i][0]) === name) return i + 2;
  }
  return 0;
}

/**
 * 読み出す。まだ無ければ rev 0 と null を返す。
 *
 * **「無い」と「読めない」を分ける。** 壊れた中身を「無い」として
 * 扱うと、次の保存で内容を消してしまう。
 *
 * @return {{rev:number, data:Object|null, updatedAt:string, updatedBy:string}}
 */
function storeRead_(name) {
  try {
    const sheet = storeSheet_();
    const row = storeRowOf_(sheet, name);
    if (!row) return { rev: 0, data: null, updatedAt: '', updatedBy: '' };

    const width = Math.max(sheet.getLastColumn(), STORE_COL_JSON);
    const cells = sheet.getRange(row, 1, 1, width).getValues()[0];
    const text = cells.slice(STORE_COL_JSON - 1).join('');
    if (!text) return { rev: 0, data: null, updatedAt: '', updatedBy: '' };

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      throw new Error('保存されている内容が JSON として読めません: ' + name);
    }
    return {
      rev: Number(cells[1]) || 0,
      data: data,
      updatedAt: String(cells[2] || ''),
      updatedBy: String(cells[3] || '')
    };
  } catch (error) {
    logError(MODULE_STORE, 'storeRead_', error, `name=${name}`);
    throw error;
  }
}

/**
 * 書き込む。**読んだときの rev と今の rev が違えば書かない。**
 *
 * 衝突したときは、いま入っている中身をそのまま返す。画面はそれを見せて
 * 「読み直す」か「自分の内容で上書きする」かを選ばせる。
 * 中身を返さずに「衝突しました」だけ言うと、何が違うのか分からない。
 *
 * @param {string} name 行の名前
 * @param {number} baseRev 読んだときの版。0 は「まだ無いはず」
 * @param {Object} data 書く中身
 * @param {boolean} force true なら版を見ずに上書きする（画面で選んだときだけ）
 * @return {{ok:boolean, rev:number, conflict:Object|undefined}}
 */
function storeWrite_(name, baseRev, data, force) {
  const started = Date.now();
  const lock = LockService.getScriptLock();
  try {
    if (!lock.tryLock(STORE_LOCK_WAIT_MS)) {
      throw new Error('ほかの保存が終わるのを待てませんでした。少し置いて試してください');
    }
    const now = storeRead_(name);
    if (!force && Number(baseRev) !== now.rev) {
      logSuccess(MODULE_STORE, 'storeWrite_',
        `conflict; name=${name}; base=${baseRev}; now=${now.rev}`);
      return { ok: false, rev: now.rev, conflict: now };
    }

    const text = JSON.stringify(data);
    const chunks = [];
    for (let i = 0; i < text.length; i += STORE_CHUNK) {
      chunks.push(text.slice(i, i + STORE_CHUNK));
    }
    if (chunks.length > STORE_MAX_CHUNKS) {
      throw new Error('保存する内容が大きすぎます: ' + text.length + ' 文字');
    }

    const sheet = storeSheet_();
    const row = storeRowOf_(sheet, name) || (sheet.getLastRow() + 1);
    // 前より短くなったとき、残った古い断片が後ろにくっつく。
    // 書く幅は「今までの幅」と「これから書く幅」の広いほうに揃えて空で潰す
    const width = Math.max(sheet.getLastColumn(), STORE_COL_JSON + chunks.length - 1);
    const line = new Array(width).fill('');
    line[0] = name;
    line[1] = now.rev + 1;
    line[2] = new Date().toISOString();
    line[3] = storeWho_();
    chunks.forEach((c, i) => { line[STORE_COL_JSON - 1 + i] = c; });

    sheet.getRange(row, 1, 1, width).setValues([line]);
    SpreadsheetApp.flush();

    logSuccess(MODULE_STORE, 'storeWrite_',
      `name=${name}; rev=${line[1]}; chars=${text.length}; chunks=${chunks.length}; `
      + `elapsedMs=${Date.now() - started}`);
    return { ok: true, rev: line[1] };
  } catch (error) {
    logError(MODULE_STORE, 'storeWrite_', error, `name=${name}; base=${baseRev}`);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/**
 * いま書いている人。分からなければ空。
 * 衝突したときに「誰の編集とぶつかったか」を出すために持つ。
 */
function storeWho_() {
  try {
    return Session.getActiveUser().getEmail() || '';
  } catch (ignored) {
    return '';                       // 権限が無いデプロイでは取れない
  }
}
