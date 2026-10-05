/**
 * Intake.gs — レセコンからの日次実績の受け口
 *
 * 仕様: docs/RECEIPT-API.md / 特徴量: docs/FEATURE-COLLECTION.md
 *
 * ベンダー（シグマ）に依存しない**正規形**をこちらで定義し、変換はアダプタが担う。
 * こうしておくと、
 *   - ベンダーとの交渉が「この形に寄せられますか」で済む
 *   - レセコンを替えてもアダプタの差し替えで済む
 *   - サンプルデータが来る前に、検証と保存を書いて試せる
 *
 * 経路は3つ。どれを使っても同じ正規形に落ちてから中へ入る。
 *   A. CSV 手動アップロード（まずこれ。API が無くても始められる）
 *   B. Drive のフォルダ監視
 *   C. Web API（doPost）
 *
 * このファイルで**実装済みなのは契約の部分だけ**（検証・正規化・項目定義）。
 * 経路とアダプタはサンプルデータが来てから書く。
 *
 * 【加算の数え方】項目ごとに違う。取り違えると特徴量として使えない。
 *   一包化   … 1処方箋につき1回。**作業量に比例しない**（14日分も90日分も「1」）
 *              工数は投与日数で決まるので onePackDays を併せて取る
 *   計量混合 … 混ぜた回数だけ。比例する
 *   自家製剤 … 1処方に複数取れる（剤ごと）。比例する
 *
 * 【名前で持たない】診療報酬は改定で名称・区分が変わる。加算名をキーにすると
 * 改定のたびに系列が切れるので、キーは「何の作業か」で持つ。
 *
 * 【患者の個票】次回来局日の予測は患者単位でしか作れない（残日数を追うため）。
 * 通し患者番号があるのでキーには困らないが、**それは患者を特定できる番号**
 * なので生のままシートへ置かない。境界（patientKeyOf_）でハッシュ化し、
 * 保存するのはハッシュだけにする。氏名・生年月日が入っていたらその行は弾く。
 */

const MODULE_INTAKE = 'Intake';

/**
 * 受け取る項目の定義。**ここが仕様そのもの。**
 *
 * unit は「1件が何を指すか」。ベンダーとの合意事項で、
 * ここが食い違うと数字が数倍変わり、あとから遡って直せない。
 */
const INTAKE_SCHEMA = Object.freeze({
  counts: Object.freeze({
    prescriptions:     { label: '処方箋枚数', unit: '枚', work: '量' },
    newPatients:       { label: '新患',       unit: '人', work: '指導' },

    // 加算は数え方が項目ごとに違う。work が「作業量に比例するか」
    onePack:           { label: '一包化加算', unit: '1処方箋につき1回', work: '比例しない' },
    // 一包化の工数は投与日数で決まる。14日分と90日分が同じ「1」になるので、
    // 件数だけでは足りない。日数を併せて取る
    onePackDays:       { label: '一包化 投与日数（合計）', unit: '日', work: '比例する' },
    mixing:            { label: '計量混合調剤加算', unit: '混ぜた回数', work: '比例する' },
    compounding:       { label: '自家製剤加算', unit: '剤ごと（1処方に複数可）', work: '比例する' },
    duplicationCheck:  { label: '重複投薬・相互作用等防止加算', unit: '算定回数', work: '照会1件' },
    narcotics:         { label: '麻薬管理指導加算', unit: '算定回数', work: '手続き' },
    homeVisit:         { label: '在宅患者訪問薬剤管理指導料', unit: '算定回数', work: '別枠' },
    internalDrugUnits: { label: '内服薬の剤数', unit: '剤', work: '比例する' },
  }),
  /**
   * 処方日数 → 件数。患者台帳（patients）が取れないときの代替。
   * 集計値なので**残日数を追えない**ぶん、精度は落ちる。
   */
  dispenseDays: { label: '処方日数の分布', unit: '件' },

  /**
   * 患者ごとの1行。**次回来局日の予測はここからしか作れない。**
   *
   *   次回来局予定 = 今回の来局日 + 今回の処方最大日数 + 前回の残日数
   *   前回の残日数 = 前回(来局日 + 処方日数) − 今回の来局日   （負なら 0）
   *
   * 集計値（dispenseDays）では残日数が追えないので、早めに来た患者の
   * 手持ちが次回にずれ込むぶんを表せない。
   *
   * 【個人情報】患者を特定できる項目は受け取らない。
   * patientKey は**仮名化済みの識別子**（レセコンの患者番号のハッシュなど）。
   * 氏名・生年月日・保険証番号・住所が入っていたら、その行は取り込まない。
   */
  patients: { label: '患者ごとの来局と処方日数', unit: '行' },

  /** 医師コード → 枚数 */
  byDoctor: { label: '医師ごとの処方箋枚数', unit: '枚' },
});

/**
 * 患者の行に入っていてはいけないキー。
 * 仮名化されていない情報を受け取らないための歯止め。
 */
const INTAKE_FORBIDDEN_KEYS = Object.freeze([
  'name', 'kana', 'birth', 'birthday', 'birthDate', 'address', 'tel', 'phone',
  'insuranceNo', 'insuranceNumber', 'myNumber', 'email',
  '氏名', '生年月日', '住所', '電話', '保険証番号',
]);

/** 取り込みの経路 */
const INTAKE_SOURCE = Object.freeze({
  CSV: 'csv',
  DRIVE: 'drive',
  API: 'api',
});

/**
 * 正規形を検証する。
 *
 * 行単位で見て、通った行と弾いた行を分けて返す。
 * 1行の不備で全体を止めない。止めると、直すまで何も溜まらない。
 *
 * @param {Object} payload 正規形のペイロード
 * @return {{ok: Array<Object>, ng: Array<{index: number, reason: string}>}}
 */
function validateIntake_(payload) {
  const ok = [];
  const ng = [];
  try {
    if (!payload || !Array.isArray(payload.records)) {
      return { ok: ok, ng: [{ index: -1, reason: 'records が配列ではありません' }] };
    }
    payload.records.forEach((rec, i) => {
      const reason = intakeRowError_(rec);
      if (reason) ng.push({ index: i, reason: reason });
      else ok.push(rec);
    });
    return { ok: ok, ng: ng };
  } catch (error) {
    logError(MODULE_INTAKE, 'validateIntake_', error, JSON.stringify(payload).slice(0, 500));
    return { ok: [], ng: [{ index: -1, reason: String(error && error.message) }] };
  }
}

/** 1行を見て、駄目な理由を返す。問題なければ空文字 */
function intakeRowError_(rec) {
  if (!rec || typeof rec !== 'object') return '行がオブジェクトではありません';
  if (!rec.storeCode) return 'storeCode がありません';
  if (!isIsoDate_(rec.date)) return 'date が yyyy-mm-dd ではありません: ' + rec.date;

  const counts = rec.counts || {};
  const keys = Object.keys(counts);
  for (let i = 0; i < keys.length; i++) {
    const v = counts[keys[i]];
    if (v === null || v === undefined || v === '') continue;   // 欠測は許す
    if (typeof v !== 'number' || !isFinite(v) || v < 0) {
      return keys[i] + ' が 0 以上の数ではありません: ' + v;
    }
  }
  if (rec.dispenseDays) {
    const dd = Object.keys(rec.dispenseDays);
    for (let i = 0; i < dd.length; i++) {
      if (!/^\d+$/.test(dd[i])) return '処方日数が整数ではありません: ' + dd[i];
    }
  }
  if (rec.patients) {
    if (!Array.isArray(rec.patients)) return 'patients が配列ではありません';
    for (let i = 0; i < rec.patients.length; i++) {
      const reason = patientRowError_(rec.patients[i]);
      if (reason) return 'patients[' + i + ']: ' + reason;
    }
  }
  return '';
}

/**
 * 患者の1行を見る。
 * **患者を特定できる項目が入っていたら受け取らない。** 黙って捨てると、
 * 送る側は送り続けてしまう。行ごと弾いて理由を返し、送信元を直してもらう。
 */
function patientRowError_(row) {
  if (!row || typeof row !== 'object') return '行がオブジェクトではありません';

  const keys = Object.keys(row);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    for (let j = 0; j < INTAKE_FORBIDDEN_KEYS.length; j++) {
      if (k.toLowerCase() === String(INTAKE_FORBIDDEN_KEYS[j]).toLowerCase()) {
        return '患者を特定できる項目は受け取れません: ' + k;
      }
    }
  }
  // 通し患者番号（patientNo）か、ハッシュ済みの patientKey のどちらか。
  // patientNo で来た場合は取り込みのときにハッシュ化し、生の番号は保存しない
  if (!row.patientNo && !row.patientKey) {
    return 'patientNo か patientKey がありません';
  }
  if (row.patientKey && String(row.patientKey).length < 16) {
    return 'patientKey が短すぎます（ハッシュ化されていない可能性）: ' + row.patientKey;
  }
  const d = row.days;
  if (d === null || d === undefined || d === '') return 'days がありません';
  if (typeof d !== 'number' || !isFinite(d) || d <= 0 || d > 400) {
    return 'days が 1〜400 の数ではありません: ' + d;
  }
  return '';
}

/**
 * 通し患者番号からシートに保存する患者キーを作る。
 *
 * **生の患者番号をシートへ書かない。** シートは共有・書き出し・控えの対象なので、
 * そこに患者番号が乗ると、持ち出された時点で氏名まで辿れる（薬局側に対応表がある）。
 *
 * ソルトはスクリプトプロパティに置く。患者番号の空間は小さい（数万程度）ため、
 * ソルト無しのハッシュは総当たりですぐ逆引きできる。
 *
 * 【これが守るもの・守らないもの】
 *   守る   … シートが外へ出たときに、そこから患者を辿れないこと
 *   守らない … スクリプトを触れる人はソルトを読めるので、その人には無力。
 *              法令上の「匿名加工情報」にはならない。取扱いは個人情報のまま
 *
 * @param {string|number} rawNo 通し患者番号
 * @return {string} 24文字のハッシュ
 */
function patientKeyOf_(rawNo) {
  const salt = ensurePatientSalt_();
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + '|' + String(rawNo), Utilities.Charset.UTF_8);
  return bytes
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
}

/**
 * ソルトを取り出す。無ければ作る。
 * **一度作ったら変えないこと。** 変えると過去の患者キーと突き合わせられなくなり、
 * 残日数の追跡が切れる。控えを取っておくこと。
 */
function ensurePatientSalt_() {
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty(CONFIG.PROP_PATIENT_SALT);
  if (!salt) {
    salt = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(CONFIG.PROP_PATIENT_SALT, salt);
    logError(MODULE_INTAKE, 'ensurePatientSalt_',
      '患者キーのソルトを新しく作りました。控えを取ってください。'
      + '失うと過去の患者キーと突き合わせられなくなります。', '', true);
  }
  return salt;
}

/**
 * 次回来局予定日を出す。
 *
 *   残日数 = 前回(来局日 + 処方日数) − 今回の来局日     （負なら 0）
 *   次回   = 今回の来局日 + 今回の処方日数 + 残日数
 *
 * 早めに来た患者は手持ちが残るので、そのぶん次回が後ろへずれる。
 * ここを見ないと、来局の山が実際より前に出る。
 *
 * @param {string} visitDate 今回の来局日 yyyy-mm-dd
 * @param {number} days 今回の処方最大日数
 * @param {{visitDate: string, days: number}=} prev 前回の来局
 * @return {{next: string, carryOver: number}}
 */
function nextVisitOf_(visitDate, days, prev) {
  const toDate = v => {
    const p = String(v).split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  };
  const fmt = d => d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');

  const cur = toDate(visitDate);
  let carry = 0;
  if (prev && prev.visitDate && prev.days) {
    const prevEnd = toDate(prev.visitDate);
    prevEnd.setDate(prevEnd.getDate() + Number(prev.days));
    const diff = Math.round((prevEnd - cur) / 86400000);
    carry = Math.max(0, diff);
  }
  const next = new Date(cur);
  next.setDate(next.getDate() + Number(days) + carry);
  return { next: fmt(next), carryOver: carry };
}

/** yyyy-mm-dd か。実在する日付かまで見る（2026-02-30 を弾く） */
function isIsoDate_(v) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const p = v.split('-').map(Number);
  const d = new Date(p[0], p[1] - 1, p[2]);
  return d.getFullYear() === p[0] && d.getMonth() === p[1] - 1 && d.getDate() === p[2];
}

/**
 * 1行を保存できる形に正規化する。
 *
 * **欠測と 0 を区別する。** 項目が来なかった日と 0 件だった日は別物なので、
 * 欠測は null のままにして 0 で埋めない。埋めると「その日は暇だった」と
 * 誤って学習される。
 *
 * **契約に無いキーは捨てず extra に残す。** 捨てると、あとで
 * 「その項目も欲しかった」となったときに遡れない。
 *
 * @param {Object} rec 検証を通った1行
 * @param {Object} meta {source, fetchedAt}
 * @return {Object} 保存用のオブジェクト
 */
function normalizeRecord_(rec, meta) {
  const counts = rec.counts || {};
  const out = {
    storeCode: String(rec.storeCode),
    date: rec.date,
    source: (meta && meta.source) || '',
    fetchedAt: (meta && meta.fetchedAt) || new Date().toISOString(),
  };

  Object.keys(INTAKE_SCHEMA.counts).forEach(key => {
    const v = counts[key];
    out[key] = (v === null || v === undefined || v === '') ? null : Number(v);
  });

  out.dispenseDays = rec.dispenseDays || null;
  // 生の患者番号はここで落とす。保存するのはハッシュだけ
  out.patients = (rec.patients || []).map(row => ({
    patientKey: row.patientKey || patientKeyOf_(row.patientNo),
    days: Number(row.days),
  }));
  if (!out.patients.length) out.patients = null;
  out.byDoctor = rec.byDoctor || null;

  // 契約に無いキー
  const known = Object.keys(INTAKE_SCHEMA.counts);
  const extra = {};
  Object.keys(counts).forEach(k => { if (known.indexOf(k) < 0) extra[k] = counts[k]; });
  out.extra = Object.keys(extra).length ? extra : null;

  return out;
}

/**
 * 取り込みの本体。経路によらずここを通る。
 *
 * @param {Object} payload 正規形
 * @return {{saved: number, rejected: Array<Object>}}
 */
function intake(payload) {
  try {
    const meta = {
      source: (payload && payload.source) || '',
      fetchedAt: (payload && payload.fetchedAt) || new Date().toISOString(),
    };
    const checked = validateIntake_(payload);
    const rows = checked.ok.map(r => normalizeRecord_(r, meta));
    const saved = upsertDaily_(rows);
    if (checked.ng.length) {
      logError(MODULE_INTAKE, 'intake',
        checked.ng.length + ' 行を取り込めませんでした',
        JSON.stringify(checked.ng).slice(0, 900));
    }
    logSuccess(MODULE_INTAKE, 'intake',
      `取り込み ${saved} 行 / 除外 ${checked.ng.length} 行 / 出所 ${meta.source}`);
    return { saved: saved, rejected: checked.ng };
  } catch (error) {
    logError(MODULE_INTAKE, 'intake', error, '', true);
    throw error;
  }
}

/* ═══ ここから下は未実装 ══════════════════════════════════
   サンプルデータが来てから書く。契約（上）は先に固めてある。 */

/**
 * 日次実績シートへ書く。**冪等**にすること。
 * 店舗ID × 日付 で upsert し、追記しない。
 * レセコンの値はあとから確定するので、再取り込みは日常的に起きる。
 * @param {Array<Object>} rows 正規化済みの行
 * @return {number} 書いた行数
 */
function upsertDaily_(rows) {
  return notImplemented_(MODULE_INTAKE, 'upsertDaily_', 9); // TODO(P9)
}

/** 経路A: CSV を手で選んで取り込む */
function importFromCsv(csvText) {
  return notImplemented_(MODULE_INTAKE, 'importFromCsv', 9); // TODO(P9)
}

/** 経路B: Drive のフォルダに置かれた CSV を時間主導トリガで拾う */
function watchDriveFolder() {
  return notImplemented_(MODULE_INTAKE, 'watchDriveFolder', 9); // TODO(P9)
}

/**
 * 経路C: Web API。X-Api-Key をスクリプトプロパティと突き合わせること。
 * GAS の Web アプリは URL を知られると誰でも叩けるので、
 * 「リンクを知っている全員」で公開するなら認証は必須。
 */
function doPostIntake(e) {
  return notImplemented_(MODULE_INTAKE, 'doPostIntake', 9); // TODO(P9)
}

/**
 * シグマの出力を正規形へ直す。
 * **サンプルデータが来てから書く。** 想像で書くと必ず外れる。
 * @param {Array<Object>} raw ベンダーの生データ
 * @return {Object} 正規形のペイロード
 */
function adaptSigma_(raw) {
  return notImplemented_(MODULE_INTAKE, 'adaptSigma_', 9); // TODO(P9)
}
