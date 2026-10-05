/**
 * Config.gs — 定数の一元管理
 *
 * 移植元: ShiftCommon v3.2 の定数部 + AutoShiftGenerator / ShiftAutoPlace の定数
 * 仕様書: docs/GAS-PORTING-SPEC.md §3
 *
 * ここ以外の .gs にシート名・ラベル・列番号・行オフセットを書かないこと
 * （Tier 1「No Hard-Coded Paths」/ Tier 2「Configuration」）。
 *
 * 【GAS 固有の注意】
 *   .gs ファイルはすべて同じグローバルスコープを共有する。
 *   トップレベルの const 名・function 名はプロジェクト全体で一意にすること。
 */

/** シート名・外部リソース・運用パラメータ */
const CONFIG = Object.freeze({
  SHEET_SHIFT: 'シフト',
  SHEET_CFG: '自動作成設定',
  SHEET_HOLIDAY: '祝日マスタ',
  SHEET_LOG: 'シフト変更ログ',
  /**
   * 保存データの置き場（隠しシート）。
   * 名前の頭の `_` は「人が触るシートではない」の印。
   */
  SHEET_DATA: '_保存データ',
  SHEET_RUNLOG: '実行ログ',
  SHEET_SURVEY: 'シート構造調査',
  SHEET_PROFILE: '書式プロファイル',
  SHEET_DOCTOR: '医師マスタ',
  SHEET_PATTERN: 'シフトパターン',
  SHEET_NOTE: '備考マスタ',

  /** appsscript.json の timeZone と必ず同じ値にすること */
  TIMEZONE_HINT: 'Asia/Tokyo',

  /**
   * 版。**画面に出して、動いているコードを見分けるために使う。**
   *
   * Web アプリはデプロイ時点のバージョンを動かし続けるので、
   * clasp push だけでは URL の中身が変わらない。
   * 「直したのに反映されない」の切り分けがこれ無しでは付かない。
   * コードを変えたら必ず上げること。
   */
  APP_VERSION: '2026-09-07b',

  /** 内閣府 祝日 CSV（Shift_JIS） */
  HOLIDAY_CSV_URL: 'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',

  /**
   * 出力ファイル名（PDF / xlsx 共通）。実物の運用に合わせる。
   *
   *   さくら薬局北口店R08.09月シフト.pdf
   *
   * {store} 店舗名（設定シートが正。ここに書かない）
   * {wa}    和暦の年。2桁ゼロ詰め（2026年 → 08）
   * {mm}    月。2桁ゼロ詰め（9月 → 09）
   *
   * ★ 和暦は令和固有の計算（西暦 − 2018）。元号が変わったら WAREKI_BASE を直す。
   *   自動では追従できない。
   */
  EXPORT_NAME: '{store}R{wa}.{mm}月シフト',
  /** 令和の基準年。令和元年 = 2019 なので 2018 を引く */
  WAREKI_BASE: 2018,

  /**
   * 出力するシートの見た目。**実物のブックを測った値**
   *   （docs/OUTPUT-FORMAT.md §1〜§3。原本の xl/styles.xml を直読みして取った）
   *
   * 日付行だけ Arial、曜日行だけ ＭＳ Ｐゴシック、ほかは游ゴシック。
   * 揃っていないが、実物がそうなっているのでそのまま写す。
   *
   * 列幅は Excel の文字数単位、行高と文字はポイント。px への換算は Export.gs。
   */
  EXPORT_FORMAT: Object.freeze({
    FONT_BODY: '游ゴシック',
    FONT_DATE: 'Arial',
    FONT_DOW: 'ＭＳ Ｐゴシック',
    PT_TITLE: 28,        // 表題（A1）
    PT_NOTE: 10,         // 公休告知・凡例・注記
    PT_BODY: 11,         // 本文
    PT_ROW: 18,          // 行の高さ
    W_NAME: 12.4,        // 氏名列
    W_DAY: 5.5,          // 日付列
    W_AGG: 6.6,          // 集計列
    RULE_COLOR: '#808080'
  }),

  /**
   * 管理者への通知先 / PDF の保存先。
   * 値はコードに書かず、スクリプトプロパティに置く（キー名だけをここに持つ）。
   */
  PROP_ADMIN_EMAIL: 'ADMIN_EMAIL',
  PROP_EXPORT_FOLDER_ID: 'EXPORT_FOLDER_ID',
  /** 期替わり判定で覚えている対象月（ドキュメントプロパティ） */
  PROP_LAST_MONTH: 'LAST_TARGET_MONTH',
  /**
   * 患者キーを作るときのソルト。スクリプトプロパティに置き、シートには出さない。
   * 患者番号の空間は小さい（数万程度）ので、ソルト無しのハッシュは総当たりで
   * すぐ逆引きされる。ソルトは必須。
   * **失うと過去の患者キーと突き合わせられなくなる**ので控えを取ること。
   */
  PROP_PATIENT_SALT: 'PATIENT_KEY_SALT',
  /**
   * 書式プロファイル（スクリプトプロパティ）。JSON 1件で持つ。
   * ここが「正」で、書式プロファイルシートは控えと手直し用。
   * シートを直したら「書式プロファイルを反映」で明示的に書き戻す。
   */
  PROP_FORMAT_PROFILE: 'FORMAT_PROFILE',

  /** 実行ログシートの保持行数。超えた分は古い行から削る */
  RUNLOG_MAX_ROWS: 2000,
});

/** シフトシート A 列の基準ラベル（前方一致で探す） */
const LABEL = Object.freeze({
  WEEK: '曜日',
  NOTE: '備考',
  DOC: '医師数',
  PHARM: '薬剤師出勤数',
  CLERK: '事務員出勤数',
  SHORT: '過不足',
  DOCTORS: '医師名',
});

/** 名前付き範囲の名前（§5.5） */
const NAMED_RANGE = Object.freeze({
  SHIFT: 'シフト入力範囲',
  DOCLIST: '医師名リスト範囲',
  NOTEROW: '備考行範囲',
  /** 廃止した名前。初期設定の実行時に削除する（パレット廃止に伴う） */
  OBSOLETE: ['シフトパレット', 'シフトパレット範囲'],
});

/** シフトシートの列・行オフセット（移植元: ShiftCommon の同名定数） */
const LAYOUT = Object.freeze({
  COL_FIRST: 2,   // B 列（日付・シフトの開始）
  COL_LAST: 32,   // AF 列（日付・シフトの終端）
  COL_MONTH: 33,  // AG 列（年月シリアル）
  COL_AGG_FIRST: 34, // AH 列（集計列の開始）
  COL_AGG_LAST: 39,  // AM 列（集計列の終端）
  COL_KIND_WORK: 40, // AN 列（区分の作業列。§5.3 の MATCH 非互換対策）

  DOC_GAP: 4,          // 入力欄の下端 = 医師数行 - 4
  NOTE_TO_DOC: 2,      // 医師数行 = 備考行 + 2
  NOTE_GAP: 2,         // 入力欄の下端 = 備考行 - 2
  DOC_BLOCK_ROWS: 5,   // 医師名欄の行数
  DATE_REPEAT_GAP: 1,  // 入力欄の上端 = 再掲日付行 + 1
  MAX_SCAN_ROWS: 200,  // 日付数式セルを探す行数の上限
});

/** シフト記号（全モジュール共通） */
const SYM = Object.freeze({
  EARLY: '○',
  EARLY_ALT: '◯',  // 全角の別字体。入力揺れとして受ける（isEarlySym）
  MID: '●',
  LATE: '▲',
  OFF: '公休',
  /** 休み記号の全体。ノルマ対象/外の振り分けは設定 L11 の部分一致で決まる */
  OFF_ALL: ['公休', '希休', '夏休', '有休', '有休※'],
});

/**
 * 出勤記号の判定を「先頭一致」にするか。★ VBA 版と結果が変わる箇所
 *
 * 実物のシフト表では、派遣行に「▲医A」のように記号と氏名が同じセルに入る。
 * VBA 版は完全一致でしか出勤を数えないので、これらは
 *   - 既存分類で ST_FOFF（休み）になり
 *   - 薬剤師出勤数の COUNTIF にも入らない
 * ため、派遣が出ている日を「人が足りない日」と誤判定していた。
 *
 * true にすると先頭一致で出勤として数える（配置は別の話で、
 * 派遣行は勤務ルールを「手動」にして自動配置の対象から外す）。
 *
 * false に戻せば VBA 版と同じ完全一致に戻る。移植の突き合わせ検証
 * （仕様書 §9 フェーズ3）では **false にして比べること**。
 */
const WORK_SYM_PREFIX_MATCH = true;

/** 出勤とみなす記号の全体（○ の別字体 ◯ を含む） */
const WORK_SYMS = Object.freeze(['○', '◯', '▲', '●']);

/** 区分の正規値。これ以外は設定チェックで警告する */
const KIND = Object.freeze({ PHARM: '薬剤師', CLERK: '事務員' });

/** 勤務ルールの正規値 */
const RULE = Object.freeze({
  NORMAL: '通常',
  FIXED_DOW: '固定曜日',
  WEEK_N: '週N日',
  MANUAL: '手動',
});

/** 予定ステータス（§4.2）。ST_FWORK / ST_FOFF は自動処理で絶対に書き換えない */
const ST_SKIP = -1;   // 月外・休業・空行・集計行
const ST_NONE = 0;    // 未決定
const ST_WORK = 1;    // 自動:出勤
const ST_OFF = 2;     // 自動:公休
const ST_FWORK = 3;   // 既存入力:出勤（○◯●▲）
const ST_FOFF = 4;    // 既存入力:休み（希休・有休・公休など）

/** 自動作成設定シート: メンバー表（§3.3） */
const CFG_MEMBER = Object.freeze({
  HDR_ROW: 4,
  FIRST_ROW: 5,
  COL_NAME: 1,     // A 氏名
  COL_KIND: 2,     // B 区分
  COL_CLOSED: 3,   // C 休業
  COL_RULE: 4,     // D 勤務ルール
  COL_FIXDOW: 5,   // E 固定曜日
  COL_WEEKN: 6,    // F 週勤務日数
  COL_OFFDAY: 7,   // G 月間休日数（RULE.NORMAL のときだけ読む）
  COL_LATE: 8,     // H 遅番・遅半 可否
  COL_MEMO: 9,     // I 備考
});

/** 自動作成設定シート: 全体設定（K=ラベル / L=値）と医師名リスト（N 列） */
const CFG_SETTING = Object.freeze({
  ROW: 4,        // 見出し行
  COL_KEY: 11,   // K ラベル
  COL_VAL: 12,   // L 値
  COL_DOCTOR: 14, // N 医師名リスト（§6.4。VBA 版のパレットの置き換え）
  SCAN_ROWS: 30, // 見出し行から何行下まで走査するか
});

/**
 * 全体設定の既定値（§3.3）。
 * 設定シートに行が無い / 空欄 / 非数値のときは必ずこの値へフォールバックする
 * （既存ブックには新しい設定行が無いため）。
 */
const SETTING_DEFAULT = Object.freeze({
  earlyN: { label: '早番(○) 人数/日', value: 1 },
  lateMin: { label: '遅番(▲) 最低人数/日', value: 3 },
  maxRun: { label: '連勤の上限(日)', value: 3 },
  maxOffRun: { label: '連休の上限(日)', value: 3 },
  weekBase: { label: '週の基本休日数', value: 2 },
  /** matchKey は数式の MATCH に埋める前方一致キー（VBA 版は "必要出勤*"） */
  reqPlus: { label: '必要出勤数(医師数+n)の n', value: 1, matchKey: '必要出勤' },
  paidSyms: { label: 'ノルマ外の休み記号(カンマ区切り)', value: '有休,夏休' },
  gSym: { label: '事務員の2人目以降の記号', value: '●' },
  clerkEarlyN: { label: '事務員の早番(○) 人数/日', value: 1 },
  lateBusy: { label: '混雑日_医師5名_の遅番(▲) 最低人数/日', value: 0 },
  runBonus: { label: '不足を埋めるときの連勤上限の上乗せ(日)', value: 0 },
});

/**
 * 生成するシートの見出しと入力規則（Schema.gs が使う）。
 * 見出しの文言を変えると既存ブックとの照合が崩れるので、
 * 変えるときは実物のシートと突き合わせること。
 */
const SCHEMA = Object.freeze({
  /** 自動作成設定 メンバー表の見出し（A〜I。CFG_MEMBER の列順と必ず揃える） */
  CFG_MEMBER_HEADS: ['氏名', '区分', '休業', '勤務ルール', '固定曜日',
                     '週勤務日数', '月間休日数', '遅番・遅半 可否', '備考'],
  /** 全体設定の見出し（K/L） */
  CFG_SETTING_HEADS: ['設定項目', '値'],
  /** 医師名リストの見出し（N。§6.4 の置き場） */
  CFG_DOCTOR_HEAD: '医師名',
  /** 祝日マスタの見出し */
  HOLIDAY_HEADS: ['日付', '名称'],

  /** 入力規則の選択肢 */
  CHOICE_CLOSED: ['○'],          // 休業（空欄 = 休業でない）
  CHOICE_LATE: ['可', '不可'],    // 遅番・遅半 可否
});

/**
 * マスタの構成（リレーショナルに分ける）。
 *
 * 【なぜ分けるか】
 *   医師名は 自動作成設定 の N 列に1列だけ間借りしていて、略称も表示順も
 *   持てなかった。シフト記号は Config に埋め込みで、時間帯（10:00〜19:00）も
 *   備考スタンプ（銀行）も置き場が無かった。表に出す凡例も作れない。
 *
 * 【従業員マスタはどこか】
 *   `自動作成設定` の A〜I 列がそれ。**別シートに切り出していない。**
 *   シート名と列位置は Layout・エンジン・数式が参照していて、
 *   移し替えると影響範囲が広い。移植が固まってからにする。
 *
 * 【ノルマ対象/外はここに持たない】
 *   休み記号がノルマを食うかは 自動作成設定 L列「ノルマ外の休み記号」が正。
 *   ここにも持つと二重管理になり、どちらが効いているのか分からなくなる。
 */
const DOCTOR_MASTER = Object.freeze({
  HDR_ROW: 1,
  FIRST_ROW: 2,
  COL_NAME: 1,     // A 医師名（シフト表の医師名欄に押す文字）
  COL_SHORT: 2,    // B 略称（狭い欄に入れたいとき）
  COL_ORDER: 3,    // C 表示順（小さいほど先。空欄は最後）
  COL_MEMO: 4,     // D 備考
  HEADS: ['医師名', '略称', '表示順', '備考'],
});

/**
 * 備考マスタ（備考行に押す文字）。
 *
 * シフトパターンとは別のシートにする。銀行はシフトのパターンではないし、
 * 混ぜると `開始` `終了` の列が意味を持たない行ができて、
 * シフトパターンというシートの意味自体が曖昧になる。
 */
const NOTE_MASTER = Object.freeze({
  HDR_ROW: 1,
  FIRST_ROW: 2,
  COL_TEXT: 1,     // A 備考（備考行に入る文字そのもの）
  COL_DESC: 2,     // B 説明
  COL_ORDER: 3,    // C 表示順
  HEADS: ['備考', '説明', '表示順'],
  SEED: [
    ['銀行', '銀行対応の日', 1],
  ],
});

/** シフトパターン（記号・名称・時間帯・種別） */
const PATTERN_MASTER = Object.freeze({
  HDR_ROW: 1,
  FIRST_ROW: 2,
  COL_SYM: 1,      // A 記号（セルに入る文字そのもの）
  COL_NAME: 2,     // B 名称
  COL_FROM: 3,     // C 開始
  COL_TO: 4,       // D 終了
  COL_KIND: 5,     // E 種別
  COL_ORDER: 6,    // F 表示順
  HEADS: ['記号', '名称', '開始', '終了', '種別', '表示順'],

  /**
   * 種別。出勤か休みか。
   * KIND_NOTE は**旧い版との互換のためだけ**に残してある。
   * 備考は 備考マスタ が正で、こちらに書いても新しくは読まない
   * （備考マスタが空のときだけ拾う）。
   */
  KIND_WORK: '出勤',
  KIND_OFF: '休み',
  KIND_NOTE: '備考',

  /**
   * 初期値。実物の凡例に合わせてある。
   * 生成は空欄のセルにしか書かないので、あとから自由に足せる。
   */
  SEED: [
    ['○', '早番', '10:00', '19:00', '出勤', 1],
    ['●', '遅半', '10:30', '19:30', '出勤', 2],
    ['▲', '遅番', '11:00', '20:00', '出勤', 3],
    ['公休', '公休', '', '', '休み', 11],
    ['希休', '希望休', '', '', '休み', 12],
    ['夏休', '夏季休暇', '', '', '休み', 13],
    ['有休', '有給休暇', '', '', '休み', 14],
    ['有休※', '有給休暇（※）', '', '', '休み', 15],
  ],
});

/** 祝日マスタ（§3.4） */
const HOLIDAY_SHEET = Object.freeze({
  HDR_ROW: 1, FIRST_ROW: 2, COL_DATE: 1, COL_NAME: 2,
});

/**
 * シフト変更ログ（§3.4）。
 * VBA 版は見出し 6 列 + GetLogSheet が 7〜10 列を後付けしていた。
 * GAS 版は最初から 10 列の見出しを書く。
 */
const CHANGELOG_SHEET = Object.freeze({
  HDR_ROW: 1,
  FIRST_ROW: 2,
  HEADS: ['セッション', '日時', '操作', 'セル', '変更前', '変更後',
          '取消済', '前文字色', '前太字', '前塗り色'],
  COL_SESSION: 1, COL_TIME: 2, COL_OP: 3, COL_ADDR: 4,
  COL_BEFORE: 5, COL_AFTER: 6, COL_UNDONE: 7,
  COL_FONT_COLOR: 8, COL_BOLD: 9, COL_FILL: 10,
});

/** 配置エンジンの打ち切り条件（§8） */
const ENGINE_LIMIT = Object.freeze({
  CB_MAX_PASS: 500,
  /**
   * CB_2名移す（玉突き）の打ち切り。VBA 版には無い GAS 独自の制限。
   * 500 巡すべてが玉突きに落ちると 60 億ステップになり 6 分制限を超えるため。
   * README に明記すること（§8.3-2）。
   */
  CB_CHAIN_MAX_PASS: 50,
  FB_MAX_PASS: 100,
  SYMBOL_MAX_PASS: 300,
  REPAIR_RUNS_PASS: 3,
  OFF_QUOTA_MAX_PASS: 100,
  /** 上限判定が答えを出せないときに返す値（VBA: CNT_LARGE / CNT_INF） */
  CNT_LARGE: 32767,
  SCORE_INF: -1e30,
});

/** 「混雑日」とみなす医師数。集計列の「5診出勤」と均等化で共有する */
const DOC_BUSY_N = 5;

/** 氏名でない行のラベル（前方一致。移植元: AutoShiftGenerator.IsNonName） */
const NON_NAME_LABELS = Object.freeze([
  '医師数', '薬剤師出勤数', '事務員出勤数', '過不足', '合計',
  'シフトパレット', '備考', '医師名',
]);

/**
 * シートの控え（Backup.gs）。VBA 版に無い機能。
 *
 * 控えのシート名は `控_<元のシート名>_<yyyyMMdd-HHmmss>` の形にする。
 * 名前の形で「自分が作った控え」を見分けるので、
 * **prefix と区切りを変えると過去の控えが認識できなくなる**。
 */
const BACKUP = Object.freeze({
  PREFIX: '控_',
  SEP: '_',
  /** 元のシートごとに残す件数。超えた分は古いものから消す */
  KEEP: 10,
  /** 控えの中に書き残す「何の直前か」の見出し */
  NOTE_HEAD: '控えを取った理由: ',
});

/** シート構造調査の氏名マスク（§7.4。個人情報保護のため必ず true を保つ） */
const MASK_NAMES = true;

/**
 * 書式プロファイル（FormatProfile.gs）。
 *
 * 運用中のシフト表から書式を吸い出し、生成時に同じ見た目を再現するための仕組み。
 * VBA 版には無い。
 *
 * 【位置ではなく「行の役割」で持つ】
 *   セル位置ごとに丸写しすると、スタッフが1人増えただけで全部ずれる。
 *   また、丸写しは医師名や面談日程まで持ち出すことになる。
 *   だから「日付行の背景色」「入力欄の文字サイズ」という単位で取る。
 *
 * 【値（セルの中身）は取らない】
 *   取るのは書式と、位置が決まっているラベル（集計行の見出しなど）だけ。
 *   氏名・医師名・面談日程は対象外。プロファイルはスプレッドシート上に置き、
 *   リポジトリには入れない。
 */
const FORMAT_PROFILE = Object.freeze({
  HDR_ROW: 1,
  FIRST_ROW: 2,
  COL_KEY: 1,
  COL_VALUE: 2,
  COL_NOTE: 3,
  HEADS: ['項目', '値', '説明'],

  /** 行の役割。プロファイルのキー `role.<役割>.<属性>` の前半になる */
  ROLES: Object.freeze([
    { key: 'header', label: '年月・タイトル行' },
    { key: 'date', label: '日付行' },
    { key: 'week', label: '曜日行' },
    { key: 'doctor', label: '医師名欄' },
    { key: 'free', label: '自由行（発注担当など）' },
    { key: 'repeatDate', label: '日付の再掲行' },
    { key: 'grid', label: 'シフト入力欄' },
    { key: 'note', label: '備考行' },
    { key: 'total', label: '集計行（医師数・出勤数・過不足）' },
  ]),

  /** 役割ごとに取る書式 */
  ATTRS: Object.freeze([
    { key: 'height', label: '行の高さ(px)' },
    { key: 'bg', label: '背景色' },
    { key: 'fontColor', label: '文字色' },
    { key: 'fontSize', label: '文字サイズ' },
    { key: 'bold', label: '太字' },
    { key: 'hAlign', label: '横位置' },
  ]),
});

/**
 * 書式プロファイルの既定値。
 * プロファイルシートが無い／項目が欠けているときは必ずここへ落ちる。
 * 実物から吸い出す前でもシートが作れること、が要件。
 */
const FORMAT_DEFAULT = Object.freeze({
  'col.name.width': 118,
  'col.day.width': 34,
  'col.agg.width': 48,

  'day.satBg': '#dce6f1',
  'day.sunBg': '#f2dcdb',
  'day.outMonthBg': '#f2f2f2',
  'day.outMonthFg': '#999999',
  'sheet.borderColor': '#808080',
  'sheet.leaveBg': '#bfbfbf',

  'role.header.height': 24,
  'role.header.bg': '#ffffff',
  'role.header.fontColor': '#000000',
  'role.header.fontSize': 14,
  'role.header.bold': true,
  'role.header.hAlign': 'left',

  'role.date.height': 20,
  'role.date.bg': '#d9d9d9',
  'role.date.fontColor': '#000000',
  'role.date.fontSize': 10,
  'role.date.bold': true,
  'role.date.hAlign': 'center',

  'role.week.height': 20,
  'role.week.bg': '#d9d9d9',
  'role.week.fontColor': '#000000',
  'role.week.fontSize': 10,
  'role.week.bold': true,
  'role.week.hAlign': 'center',

  'role.doctor.height': 20,
  'role.doctor.bg': '#ffffff',
  'role.doctor.fontColor': '#000000',
  'role.doctor.fontSize': 10,
  'role.doctor.bold': false,
  'role.doctor.hAlign': 'center',

  'role.free.height': 20,
  'role.free.bg': '#ffffff',
  'role.free.fontColor': '#000000',
  'role.free.fontSize': 9,
  'role.free.bold': false,
  'role.free.hAlign': 'center',

  'role.repeatDate.height': 20,
  'role.repeatDate.bg': '#d9d9d9',
  'role.repeatDate.fontColor': '#000000',
  'role.repeatDate.fontSize': 10,
  'role.repeatDate.bold': true,
  'role.repeatDate.hAlign': 'center',

  'role.grid.height': 20,
  'role.grid.bg': '#ffffff',
  'role.grid.fontColor': '#000000',
  'role.grid.fontSize': 10,
  'role.grid.bold': false,
  'role.grid.hAlign': 'center',

  'role.note.height': 20,
  'role.note.bg': '#ffffff',
  'role.note.fontColor': '#000000',
  'role.note.fontSize': 9,
  'role.note.bold': false,
  'role.note.hAlign': 'center',

  'role.total.height': 20,
  'role.total.bg': '#d9d9d9',
  'role.total.fontColor': '#000000',
  'role.total.fontSize': 10,
  'role.total.bold': true,
  'role.total.hAlign': 'center',

  'format.date': 'd',
  'format.month': 'yyyy"年"m"月"',

  /**
   * 和暦の見出し（§5.2）。
   *
   * Sheets に和暦の「表示形式」は無いので、年月セルを和暦で表示することはできない。
   * ただし文字列を数式で組むことはできるので、別セルに出す。
   * 毎月手で入力させないための逃げ道。
   *
   * {month} は年月セル（A列）の参照に置き換わる。
   * 既定は実物に合わせた R08.08 形式。空文字にすると何も書かないので、
   * 手で入力したい場合はそうする。
   *
   * ★ -2018 は令和固有。元号が変わったらここを直す（自動追従はできない）。
   */
  'title.col': 4,
  'title.formula': '="R"&TEXT(YEAR({month})-2018,"00")&"."&TEXT(MONTH({month}),"00")',

  'label.doc': '医師数(診)',
  'label.pharm': '薬剤師出勤数',
  'label.shortage': '過不足',
  'label.note': '備考',
  'label.doctors': '医師名',
  'label.agg': '公休,有休,○早番,▲遅番,●遅半,5診出勤',
});

/**
 * シフト表シートの生成（SheetBuilder.gs）。
 * VBA 版には無い機能。VBA 版は既存の Excel ブックが前提で、シフトシート自体を
 * 作る手段が無かった（ShiftSetup は既存シートに数式を当てるだけ）。
 */
const SHEET_BUILD = Object.freeze({
  /** 自動作成設定にメンバーが1人もいないときに用意する空のスタッフ行数 */
  DEFAULT_STAFF_ROWS: 16,
  /** メンバー数に上乗せする予備行（派遣の自由記入行など） */
  SPARE_STAFF_ROWS: 4,
  /** 月ごとにシートを分けるときのシート名 */
  MONTH_SHEET_FORMAT: 'yyyy年M月',

  /** 集計列（AH〜AM）の見出し。§5.4 の並びと一致させること */
  AGG_HEADS: ['公休', '有休', '○早番', '▲遅番', '●遅半', '5診出勤'],
  /** 集計行（A列）の見出し */
  ROW_HEAD_DOC: '医師数(診)',
  ROW_HEAD_PHARM: '薬剤師出勤数',
  ROW_HEAD_SHORTAGE: '過不足',

  COL_WIDTH_NAME: 118,
  COL_WIDTH_DAY: 34,
  COL_WIDTH_AGG: 48,

  COLOR_HEADER_BG: '#d9d9d9',
  COLOR_SAT_BG: '#dce6f1',
  COLOR_SUN_BG: '#f2dcdb',
  COLOR_OUT_MONTH_BG: '#f2f2f2',
  COLOR_BORDER: '#808080',
  /** 休業者の行に塗る色（マクロが塗った色。これと同じときだけ塗りを外す） */
  COLOR_LEAVE_BG: '#bfbfbf',
});
