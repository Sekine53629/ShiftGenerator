/**
 * WebApp.gs — Web アプリのサーバ側 API
 *
 * 画面は WebAppView.html。
 * ※ Apps Script はファイル名が拡張子をまたいで一意でなければならないので、
 *   `WebApp.gs` と `WebApp.html` は同居できない。だから画面側は別名にしてある。
 *
 * 仕様書 §6 は「クリック入力はサイドバー」としていたが、
 * **利用者の判断でシフト表ごと Web アプリ化する方針に変更した**（2026-09-03）。
 * 経緯と割り切りは docs/WEBAPP-DESIGN.md にまとめてある。
 * 旧サイドバーの骨組みは archive/ に置いた。
 *
 * 【サイドバーとの決定的な違い】
 *   Web アプリからは `getActiveRange()` が使えない（選択の概念が無い）。
 *   だから「押した瞬間の選択範囲に作用する」というサイドバーの設計は成立せず、
 *   **グリッドを自前で描いて、押されたセルを自分で覚える**必要がある。
 *
 * 【読み書きの約束（§8.3-3）】
 *   読みは表示ブロックを丸ごと1回。書きは編集の外接矩形を1回。
 *   セルごとに API を呼ばない。
 */

const MODULE_WEBAPP = 'WebApp';

/**
 * Web アプリの画面。**シフト表エディタ本体を出す。**
 *
 * clasp はサブディレクトリを 'prototype/ShiftGrid' という名前で送る。
 * 直下にコピーを置くと二重管理になる（片方だけ直して食い違う）ので、
 * 出どころは prototype/ShiftGrid.html 1つにしてある。
 * .claspignore で明示的に送る指定をしていないと push されない。
 */
const WEBAPP_VIEW_FILE = 'prototype/ShiftGrid';

/**
 * Web アプリの入口。
 * @param {Object} e クエリパラメータ
 * @return {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  try {
    // ?probe=1 … テンプレートも JavaScript も使わない最小の応答。
    // 「配信されているコードが新しいか」だけを1クリックで確かめるための入口。
    // 画面が構文エラーで真っ白なときでも、ここは必ず出る
    if (e && e.parameter && e.parameter.probe) {
      // 版だけを返す。クエリの中身は一切 echo しない（反射 XSS の口になる）
      return HtmlService.createHtmlOutput(
        `<pre style="font:14px monospace">版 ${escapeHtml_(CONFIG.APP_VERSION)}</pre>`);
    }

    /**
     * シフト表エディタ本体。**テンプレートを通さない。**
     *
     * `createTemplateFromFile` は `<? ?>` をスクリプトレットとして解釈する。
     * エディタは xlsx を組み立てる箇所で `<?xml version="1.0" ... ?>` を
     * 6か所持っているので、テンプレートに通すと画面ごと壊れる。
     * 埋め込む値も無いので、ファイルをそのまま出す。
     */
    return HtmlService.createHtmlOutputFromFile(WEBAPP_VIEW_FILE)
      .setTitle('シフト表')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (error) {
    logError(MODULE_WEBAPP, 'doGet', error, '', true);
    // ★ error.message にはクエリの中身が混ざりうる。生で埋めると反射 XSS になる。
    //   詳細はログにだけ残し、画面には出さない（何が動いているかも漏らさない）
    return HtmlService.createHtmlOutput(
      '<p>画面を開けませんでした。管理者に連絡してください。</p>'
      + `<p style="color:#666;font:12px monospace">版 ${escapeHtml_(CONFIG.APP_VERSION)}</p>`);
  }
}

/* ================================================================
 *  複数の PC から編集する（保存は Store.gs）
 *
 *  画面は「読んだときの版（rev）」を覚えておき、保存のときに一緒に送る。
 *  サーバは今の版と突き合わせ、**違っていたら書かずに今の中身を返す。**
 *  誰かの編集を黙って消さないための約束（docs/DEPLOY-PLAN.md）。
 * ================================================================ */

/**
 * マスタを読む。まだ何も無ければ rev 0 と null。
 * @return {{rev:number, data:Object|null, updatedAt:string, updatedBy:string}}
 */
function apiDbLoad() {
  try {
    return storeRead_(STORE_DB_FILE);
  } catch (error) {
    logError(MODULE_WEBAPP, 'apiDbLoad', error, '');
    throw error;
  }
}

/**
 * マスタを書く。rev が合わなければ書かずに衝突を返す。
 * @param {number} baseRev 読んだときの版
 * @param {Object} db 画面のマスタ
 * @param {boolean} force 画面で「自分の内容で上書き」を選んだときだけ true
 */
function apiDbSave(baseRev, db, force) {
  try {
    if (!db || typeof db !== 'object' || Array.isArray(db)) {
      throw new Error('マスタの形が違います');
    }
    return storeWrite_(STORE_DB_FILE, baseRev, db, !!force);
  } catch (error) {
    logError(MODULE_WEBAPP, 'apiDbSave', error, `baseRev=${baseRev}`);
    throw error;
  }
}

/**
 * その店の、その月のシフトを読む。
 * @param {string} storeId 店舗 ID
 * @param {string} ym 'yyyy-mm'
 */
function apiMonthLoad(storeId, ym) {
  try {
    return storeRead_(storeCellsFile_(storeId, ym));
  } catch (error) {
    logError(MODULE_WEBAPP, 'apiMonthLoad', error, `store=${storeId}; ym=${ym}`);
    throw error;
  }
}

/**
 * その店の、その月のシフトを書く。
 *
 * 中身は '<行キー>|日' → 記号 の平たい object。
 * **月ごとにファイルを分けてある**ので、別の月を触っている人とはぶつからない。
 */
function apiMonthSave(storeId, ym, baseRev, cells, force) {
  try {
    if (!cells || typeof cells !== 'object' || Array.isArray(cells)) {
      throw new Error('シフトの形が違います');
    }
    return storeWrite_(storeCellsFile_(storeId, ym), baseRev, cells, !!force);
  } catch (error) {
    logError(MODULE_WEBAPP, 'apiMonthSave', error,
      `store=${storeId}; ym=${ym}; baseRev=${baseRev}`);
    throw error;
  }
}

/**
 * 画面で組んだ表を、新しいシートにして返す。
 *
 * 画面から来る値は**中身が何であれ信用しない**。
 * とくに `=` で始まる文字列は、シートに置いた瞬間に数式になる
 * （`=IMPORTRANGE(...)` を書かれると他所のデータを引かせられる）。
 * 通り道は exportModelToSheet_ 1本で、そこで cellSafe_ に通している。
 *
 * TODO(P5): 誰が出したかの検証。Auth.gs は揃っているが、
 *   社員マスタ（email / 権限 / 担当店舗）の読み手がまだ無いので繋げていない。
 *   保存 API（apiDbSave / apiMonthSave）も同じ状態なので、まとめて入れる。
 *   なお、この関数が書くのは**開いているスプレッドシート内の新しいシート**で、
 *   既にある表は触らない。持ち出しにはならない。
 *
 * @param {Object} model 画面の表（ShiftGrid の sheetModel_ が返す形）
 * @return {{sheetName:string, url:string, rows:number, cols:number}}
 */
function apiExportToSheet(model) {
  try {
    return exportModelToSheet_(model);
  } catch (error) {
    logError(MODULE_WEBAPP, 'apiExportToSheet', error,
      `store=${model && model.store}; ym=${model && model.year}-${model && model.month}`);
    throw error;
  }
}

/**
 * デプロイ済み Web アプリの URL。メニューから開けるようにするために使う。
 * デプロイ前は空文字を返す。
 * @return {string}
 */
function getWebAppUrl() {
  try {
    return ScriptApp.getService().getUrl() || '';
  } catch (error) {
    logError(MODULE_WEBAPP, 'getWebAppUrl', error, '');
    return '';
  }
}
