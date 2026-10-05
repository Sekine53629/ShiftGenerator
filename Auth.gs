/**
 * Auth.gs — 誰が、どの店舗の、何をしてよいか
 *
 * 仕様: docs/DEPLOY-PLAN.md §1・§3
 *
 * この移植には SQL が無いので SQL インジェクションは起こらない。
 * 代わりに、この構成で実際に起きる不正は次の3つ。ここはその1つ目を受け持つ。
 *
 *   1. 権限の詐称 … 画面から送られてくる店舗 ID を信じてしまう（← ここ）
 *   2. 数式インジェクション … 入力がセルで数式になる（Sanitize.gs）
 *   3. 反射 XSS … エラー文をそのまま HTML に埋める（WebApp.gs doGet）
 *
 * **原則: 画面から来た店舗 ID・社員 ID・権限は、すべて信用しない。**
 * 誰であるかは Session が決め、何をしてよいかは社員マスタが決める。
 * 画面側の出し分けは目くらましにすぎない。押せるかどうかを画面だけで決めない。
 */

const MODULE_AUTH = 'Auth';

/** 権限。上ほど強い。社員マスタの「権限」列に入る値 */
const ROLE = Object.freeze({
  STAFF: 'staff',       // 自店のシフトを見るだけ
  MANAGER: 'manager',   // 自店のシフトを作る・直す
  ADMIN: 'admin',       // 全店とマスタ
});

/** 強さの順。比較にだけ使う */
const ROLE_RANK = Object.freeze({ staff: 1, manager: 2, admin: 3 });

/**
 * 認証まわりの失敗。呼び出し側が握りつぶさないよう、専用の目印を付ける。
 * 画面へ返すときは reason をそのまま出さない（何が登録されているか漏れる）。
 */
function authError_(reason) {
  const e = new Error(reason);
  e.authFailure = true;
  return e;
}

/**
 * メールアドレスの正規化。
 * 大文字小文字は無視し、前後の空白を落とす。比較は必ずこれを通す。
 */
function normalizeEmail_(v) {
  return String(v == null ? '' : v).trim().toLowerCase();
}

/**
 * 「登録されているメールアドレスか」の形だけを見る。
 * 実在確認ではない。マスタに変な値が入っていたときに素通りさせないための門。
 */
function looksLikeEmail_(v) {
  const s = normalizeEmail_(v);
  return s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s);
}

/**
 * いま操作している人。**画面からは受け取らない。**
 *
 * Web アプリを「アクセスしているユーザーとして実行」でデプロイしていることが前提。
 * 「自分として実行」だと全員が同じ人に見えるため、この関数は意味を失う。
 * 空文字が返るときはデプロイ設定が違う。
 */
function currentEmail_() {
  try {
    return normalizeEmail_(Session.getActiveUser().getEmail());
  } catch (error) {
    // 権限が下りていないと例外になる。素通りさせず空にする
    console.error(`[${MODULE_AUTH}.currentEmail_] ${error.message}`);
    return '';
  }
}

/**
 * 社員マスタの1行から、権限の情報だけを取り出す。
 *
 * @param {Object} row  { email, stores, role, name, id, retired }
 * @return {Object|null} 使える形に整えたもの。使えなければ null
 */
function toPrincipal_(row) {
  if (!row) return null;
  const email = normalizeEmail_(row.email);
  if (!looksLikeEmail_(email)) return null;
  if (row.retired) return null;                     // 退職者は残っていても通さない

  const role = ROLE_RANK[row.role] ? row.role : ROLE.STAFF;   // 不明な値は最弱に倒す
  const stores = (Array.isArray(row.stores) ? row.stores : [])
    .map(s => String(s == null ? '' : s).trim())
    .filter(s => s !== '');

  return Object.freeze({
    email: email,
    id: String(row.id == null ? '' : row.id),
    name: String(row.name == null ? '' : row.name),
    role: role,
    stores: Object.freeze(stores),
  });
}

/**
 * いまの操作者を社員マスタから引く。登録が無ければ例外。
 *
 * @param {Array<Object>} members 社員マスタの行（読み手が渡す。ここではシートを読まない）
 * @return {Object} toPrincipal_ の返り値
 */
function resolveUser_(members, emailForTest) {
  try {
    const email = emailForTest === undefined ? currentEmail_() : normalizeEmail_(emailForTest);
    if (!email) {
      throw authError_('実行ユーザーを特定できません。'
        + 'Web アプリを「アクセスしているユーザーとして実行」でデプロイしてください');
    }
    const hit = (members || []).find(m => normalizeEmail_(m && m.email) === email);
    const who = toPrincipal_(hit);
    if (!who) {
      // 何が登録されているかは画面に出さない。ログにだけ残す
      console.error(`[${MODULE_AUTH}.resolveUser_] 未登録のアクセス: ${email}`);
      throw authError_('この Google アカウントは登録されていません');
    }
    return who;
  } catch (error) {
    if (!error.authFailure) {
      console.error(`[${MODULE_AUTH}.resolveUser_] ${error.message}\nStack: ${error.stack}`);
    }
    throw error;
  }
}

/** その店舗を見てよいか */
function canRead_(user, storeId) {
  if (!user) return false;
  if (user.role === ROLE.ADMIN) return true;          // 全店
  const id = String(storeId == null ? '' : storeId).trim();
  if (!id) return false;                              // 店舗を指さない読み出しは許さない
  return user.stores.indexOf(id) >= 0;
}

/** その店舗のシフトを書いてよいか */
function canEdit_(user, storeId) {
  if (!user) return false;
  if (ROLE_RANK[user.role] < ROLE_RANK[ROLE.MANAGER]) return false;
  return canRead_(user, storeId);
}

/** マスタを書いてよいか。全店に効くので admin だけ */
function canEditMaster_(user) {
  return !!user && user.role === ROLE.ADMIN;
}

/**
 * 書き込みの入口で必ず通す門。通らなければ例外を投げて処理を止める。
 * 「画面でボタンを隠したから大丈夫」は通用しない。
 */
function assertCanEdit_(user, storeId) {
  if (!canEdit_(user, storeId)) {
    console.error(`[${MODULE_AUTH}.assertCanEdit_] 拒否: `
      + `${user ? user.email : '(不明)'} → 店舗 ${storeId}`);
    throw authError_('この店舗を編集する権限がありません');
  }
  return true;
}

/** 読み出しの入口。返す前に必ず通す */
function assertCanRead_(user, storeId) {
  if (!canRead_(user, storeId)) {
    console.error(`[${MODULE_AUTH}.assertCanRead_] 拒否: `
      + `${user ? user.email : '(不明)'} → 店舗 ${storeId}`);
    throw authError_('この店舗を閲覧する権限がありません');
  }
  return true;
}

/**
 * 画面に出してよい店舗の一覧。
 * **画面から送られてきた店舗 ID は、必ずこの一覧に含まれるか確かめてから使う。**
 */
function visibleStores_(user, allStoreIds) {
  const all = (allStoreIds || []).map(s => String(s == null ? '' : s).trim())
    .filter(s => s !== '');
  if (!user) return [];
  if (user.role === ROLE.ADMIN) return all;
  return all.filter(id => user.stores.indexOf(id) >= 0);
}

/**
 * 画面から来た店舗 ID を、実在しかつ権限のあるものに絞る。
 * 通らなければ例外。**あるはずのない ID を黙って既定値に読み替えない**
 * （黙って読み替えると、別店舗を編集したつもりの取り違えが起きる）。
 */
function requireStore_(user, storeId, allStoreIds) {
  const id = String(storeId == null ? '' : storeId).trim();
  const ok = visibleStores_(user, allStoreIds);
  if (ok.indexOf(id) < 0) {
    console.error(`[${MODULE_AUTH}.requireStore_] 拒否: `
      + `${user ? user.email : '(不明)'} → 店舗 ${id || '(空)'}`);
    throw authError_('指定された店舗を扱う権限がありません');
  }
  return id;
}
